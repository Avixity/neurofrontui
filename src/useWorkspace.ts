import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Session } from "@supabase/supabase-js";
import {
  createAcquisition,
  compatible,
  isValidBaseline,
} from "./core/acquisition";
import { createDeviceClient, type ConnectionSnapshot } from "./core/device";
import { makeSimulatedBluetooth } from "./core/simulator";
import type {
  Baseline,
  Conversation,
  Measurement,
  Preferences,
  Profile,
  SaveState,
} from "./types";
import * as auth from "./services/auth";
import * as cloud from "./services/cloud";
import {
  clearGuest,
  defaultPreferences,
  readGuest,
  guestPreferences as readPreferences,
  saveGuest,
  savePreferences,
} from "./services/local";

export function useWorkspace() {
  const [initial] = useState(readGuest);
  const [entered, setEntered] = useState(() => {
    try {
      return sessionStorage.getItem("neurofront.entered") === "1";
    } catch {
      return false;
    }
  });
  const [session, setSession] = useState<Session | null>(null);
  const owner = useRef<string | null>(null);
  const [profile, setProfile] = useState<Profile>(() => ({
    displayName: "",
    email: "",
    preferences: readPreferences(),
    activeBaselineId: initial.activeBaselineId,
  }));
  const [baselines, setBaselines] = useState<Baseline[]>(() =>
    initial.baselines.filter(isValidBaseline),
  );
  const [measurements, setMeasurements] = useState<Measurement[]>(
    initial.measurements,
  );
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [pendingGuest, setPendingGuest] = useState<ReturnType<
    typeof readGuest
  > | null>(null);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(false),
    [hasMore, setHasMore] = useState(false),
    [identity, setIdentity] = useState(0);
  const [hasMoreBaselines, setHasMoreBaselines] = useState(false);
  const baselineOffset = useRef(0),
    remoteBaselineIds = useRef(new Set<string>());
  const refs = useRef({
    profile,
    baselines,
    measurements,
    session,
    saveStates,
  });
  refs.current = { profile, baselines, measurements, session, saveStates };
  const switching = useRef(false),
    generation = useRef(0),
    loadSequence = useRef(0),
    profileRevision = useRef(0),
    recordRevision = useRef(0);
  const tombstones = useRef(new Set<string>()),
    pendingSaves = useRef(new Map<string, Promise<boolean>>());
  const profileWrites = useRef(new Map<number, Promise<void>>());
  const profileDirty = useRef(false);
  const authEvents = useRef(0),
    signingOut = useRef(false);
  const callbacks = useRef({
    baseline: (_b: Baseline) => {},
    result: (_m: Measurement) => {},
  });
  const [acquisition] = useState(() =>
    createAcquisition({
      onBaseline: (b) => callbacks.current.baseline(b),
      onComplete: (m) => callbacks.current.result(m),
    }),
  );
  const snapshot = useSyncExternalStore(
    acquisition.subscribe,
    acquisition.getSnapshot,
  );
  const [connection, setConnection] = useState<ConnectionSnapshot>({
    status: "disconnected",
    device: null,
    error: null,
  });
  const [simulator] = useState(() =>
    new URLSearchParams(location.search).get("simulate") === "1"
      ? makeSimulatedBluetooth()
      : null,
  );
  const [client] = useState(() =>
    createDeviceClient(
      {
        onSample: acquisition.acceptSample,
        onInvalidPacket: acquisition.invalidPacket,
        onConnection: (value) => {
          setConnection(value);
          if (value.status === "connected" && value.device)
            acquisition.connect(value.device);
          else if (value.status !== "connecting") acquisition.disconnect();
        },
      },
      simulator ? { bluetooth: simulator, source: simulator.source } : {},
    ),
  );
  const enter = useCallback(() => {
    setEntered(true);
    try {
      sessionStorage.setItem("neurofront.entered", "1");
    } catch {
      /* Entry remains usable without storage. */
    }
  }, []);
  const current = (user: string | null, version: number) =>
    owner.current === user && generation.current === version;

  function markSave(id: string, state: SaveState) {
    refs.current.saveStates = { ...refs.current.saveStates, [id]: state };
    setSaveStates(refs.current.saveStates);
  }
  function saveCurrentProfile(user: string, version: number) {
    const next = refs.current.profile,
      revision = profileRevision.current;
    const task = (profileWrites.current.get(version) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (
          current(user, version) &&
          !switching.current &&
          profileRevision.current === revision
        ) {
          await cloud.saveProfile(next);
          if (current(user, version) && profileRevision.current === revision)
            profileDirty.current = false;
        }
      });
    profileWrites.current.set(version, task);
    return task;
  }
  function persist(record: Baseline | Measurement): Promise<boolean> {
    const user = owner.current,
      version = generation.current,
      key = `${version}:${record.id}`;
    if (!user || switching.current) return Promise.resolve(false);
    const pending = pendingSaves.current.get(key);
    if (pending) return pending;
    markSave(record.id, "saving");
    let task: Promise<boolean>;
    task = (async () => {
      try {
        if ("baselineId" in record) await cloud.saveMeasurement(record);
        else await cloud.saveBaseline(record);
        if (!current(user, version) || switching.current) return false;
        markSave(record.id, "saved");
        if (
          !("baselineId" in record) &&
          !remoteBaselineIds.current.has(record.id)
        ) {
          remoteBaselineIds.current.add(record.id);
          baselineOffset.current++;
        }
        if (
          !("baselineId" in record) &&
          refs.current.profile.activeBaselineId === record.id
        ) {
          await saveCurrentProfile(user, version);
        }
        return true;
      } catch {
        if (current(user, version)) markSave(record.id, "error");
        return false;
      } finally {
        pendingSaves.current.delete(key);
      }
    })();
    pendingSaves.current.set(key, task);
    return task;
  }
  callbacks.current.baseline = (baseline) => {
    if (switching.current) return;
    recordRevision.current++;
    profileRevision.current++;
    profileDirty.current = true;
    refs.current.baselines = [
      baseline,
      ...refs.current.baselines.filter((item) => item.id !== baseline.id),
    ];
    refs.current.profile = {
      ...refs.current.profile,
      activeBaselineId: baseline.id,
    };
    setBaselines(refs.current.baselines);
    setProfile(refs.current.profile);
    void persist(baseline);
  };
  callbacks.current.result = (measurement) => {
    if (switching.current) return;
    recordRevision.current++;
    refs.current.measurements = [
      measurement,
      ...refs.current.measurements.filter((item) => item.id !== measurement.id),
    ];
    setMeasurements(refs.current.measurements);
    if (measurement.traces.primary.length) void persist(measurement);
  };

  async function load(user = owner.current, version = generation.current) {
    if (!user || switching.current) return;
    const request = ++loadSequence.current,
      profileAtStart = profileRevision.current,
      recordsAtStart = recordRevision.current;
    setLoading(true);
    setError(null);
    try {
      const data = await cloud.loadAccount();
      if (
        !current(user, version) ||
        request !== loadSequence.current ||
        switching.current
      )
        return;
      const localChanged = recordRevision.current !== recordsAtStart;
      const preserve = <T extends Baseline | Measurement>(
        local: T[],
        remote: T[],
      ) => {
        const keep = local.filter(
          (item) =>
            localChanged || refs.current.saveStates[item.id] !== "saved",
        );
        const ids = new Set(keep.map((item) => item.id));
        return [...keep, ...remote.filter((item) => !ids.has(item.id))]
          .filter((item) => !tombstones.current.has(item.id))
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      };
      const nextBaselines = preserve(
        refs.current.baselines,
        data.baselines.filter(isValidBaseline),
      );
      const nextMeasurements = preserve(
        refs.current.measurements,
        data.measurements,
      );
      const nextProfile =
        !profileDirty.current && profileRevision.current === profileAtStart
          ? data.profile
          : refs.current.profile;
      const nextStates = { ...refs.current.saveStates };
      for (const item of [...data.baselines, ...data.measurements]) {
        if (!["saving", "error"].includes(nextStates[item.id]))
          nextStates[item.id] = "saved";
      }
      refs.current = {
        ...refs.current,
        baselines: nextBaselines,
        measurements: nextMeasurements,
        profile: nextProfile,
        saveStates: nextStates,
      };
      setProfile(nextProfile);
      setBaselines(nextBaselines);
      setMeasurements(nextMeasurements);
      setSaveStates(nextStates);
      setBookmarks(data.bookmarks);
      setConversations(data.conversations);
      setHasMore(data.hasMoreMeasurements);
      setHasMoreBaselines(data.hasMoreBaselines);
      const loadedIds = new Set(data.baselines.map((item) => item.id));
      const oldest =
        data.baselines[Math.max(0, data.baselinePageSize - 1)]?.createdAt;
      const recentExtras = nextBaselines.filter(
        (item) =>
          nextStates[item.id] === "saved" &&
          !loadedIds.has(item.id) &&
          (!oldest || Date.parse(item.createdAt) >= Date.parse(oldest)),
      );
      baselineOffset.current = data.baselinePageSize + recentExtras.length;
      remoteBaselineIds.current = new Set([
        ...loadedIds,
        ...recentExtras.map((item) => item.id),
      ]);
      acquisition.setBaseline(
        nextBaselines.find(
          (baseline) => baseline.id === nextProfile.activeBaselineId,
        ) || null,
      );
    } catch {
      if (current(user, version) && request === loadSequence.current)
        setError("error.load");
    } finally {
      if (current(user, version) && request === loadSequence.current)
        setLoading(false);
    }
  }

  function clearPrivate(next: Session | null, keepGuest = false) {
    switching.current = true;
    const guestData =
      keepGuest && !owner.current
        ? {
            baselines: refs.current.baselines,
            measurements: refs.current.measurements,
            activeBaselineId: refs.current.profile.activeBaselineId,
          }
        : null;
    client.disconnect();
    acquisition.clearSession();
    generation.current++;
    loadSequence.current++;
    owner.current = next?.user.id || null;
    tombstones.current.clear();
    profileRevision.current = 0;
    recordRevision.current = 0;
    profileDirty.current = false;
    const nextProfile = {
      displayName: "",
      email: next?.user.email || "",
      preferences: next ? defaultPreferences() : readPreferences(),
      activeBaselineId: null,
    };
    refs.current = {
      profile: nextProfile,
      baselines: [],
      measurements: [],
      session: next,
      saveStates: {},
    };
    setSession(next);
    setIdentity(generation.current);
    setProfile(nextProfile);
    setMeasurements([]);
    setBaselines([]);
    setSaveStates({});
    setBookmarks([]);
    setConversations([]);
    setHasMore(false);
    setHasMoreBaselines(false);
    setError(null);
    setLoading(false);
    setRecovery(false);
    baselineOffset.current = 0;
    remoteBaselineIds.current.clear();
    const guestPending =
      next &&
      guestData &&
      (guestData.baselines.length || guestData.measurements.length)
        ? guestData
        : null;
    setPendingGuest(guestPending);
    if (!guestPending) clearGuest();
    switching.current = false;
  }
  useEffect(() => {
    if (simulator)
      (
        window as Window & { __neurofrontSimulation?: typeof simulator }
      ).__neurofrontSimulation = simulator;
    setConnection(client.getSnapshot());
    acquisition.setBaseline(
      initial.baselines.find((b) => b.id === initial.activeBaselineId) || null,
    );
    let disposed = false;
    const receive = (next: Session | null, event?: string) => {
      if (disposed || (signingOut.current && next)) return;
      const nextOwner = next?.user.id || null;
      if (nextOwner === owner.current) {
        setSession(next);
        refs.current.session = next;
        if (event === "PASSWORD_RECOVERY") setRecovery(true);
        if (next) enter();
        return;
      }
      clearPrivate(next, true);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (next) {
        enter();
        const version = generation.current;
        queueMicrotask(() => {
          if (current(nextOwner, version)) void load(nextOwner, version);
        });
      }
    };
    const eventVersion = authEvents.current;
    const unsubscribe = auth.subscribeAuth((next, event) => {
      authEvents.current++;
      receive(next, event);
    });
    void auth
      .getSession()
      .then((next) => {
        if (!disposed && authEvents.current === eventVersion) receive(next);
      })
      .catch(() => {
        if (!disposed) setError("auth.sessionExpired");
      });
    const visibility = () => {
      if (document.hidden) acquisition.interrupt("hidden");
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      switching.current = true;
      generation.current++;
      unsubscribe();
      document.removeEventListener("visibilitychange", visibility);
      client.dispose();
      simulator?.dispose();
      acquisition.dispose();
      if (simulator)
        delete (
          window as Window & { __neurofrontSimulation?: typeof simulator }
        ).__neurofrontSimulation;
    };
  }, []);
  useEffect(() => {
    if (!session && !owner.current && !switching.current) {
      if (
        !saveGuest({
          baselines,
          measurements,
          activeBaselineId: profile.activeBaselineId,
        })
      )
        setError("error.save");
    }
  }, [session, baselines, measurements, profile.activeBaselineId]);

  async function updateProfile(next: Profile) {
    if (switching.current) return;
    const user = owner.current,
      version = generation.current;
    profileRevision.current++;
    refs.current.profile = next;
    setProfile(next);
    profileDirty.current = true;
    if (!user) {
      savePreferences(next.preferences);
      return;
    }
    try {
      const pending = next.activeBaselineId
        ? pendingSaves.current.get(`${version}:${next.activeBaselineId}`)
        : undefined;
      if (pending) await pending;
      if (!current(user, version)) return;
      await saveCurrentProfile(user, version);
      if (current(user, version)) setError(null);
    } catch {
      if (current(user, version)) setError("profile.failure");
    }
  }
  function preferences(next: Preferences) {
    void updateProfile({ ...refs.current.profile, preferences: next });
  }
  function selectBaseline(baseline: Baseline) {
    if (!switching.current && acquisition.setBaseline(baseline))
      void updateProfile({
        ...refs.current.profile,
        activeBaselineId: baseline.id,
      });
  }
  async function importGuest() {
    const data = pendingGuest,
      user = owner.current,
      version = generation.current;
    if (!data || !user || switching.current) return;
    setLoading(true);
    try {
      for (const baseline of data.baselines) {
        if (!current(user, version)) return;
        await cloud.saveBaseline(baseline);
      }
      for (const measurement of data.measurements) {
        if (!current(user, version)) return;
        if (measurement.traces.primary.length)
          await cloud.saveMeasurement(measurement);
      }
      if (current(user, version)) {
        clearGuest();
        setPendingGuest(null);
        await load(user, version);
      }
    } catch {
      if (current(user, version)) setError("error.save");
    } finally {
      if (current(user, version)) setLoading(false);
    }
  }
  async function notes(record: Measurement, text: string, tags: string[]) {
    if (switching.current) return;
    const user = owner.current,
      version = generation.current,
      next = { ...record, notes: text, tags };
    const pending = pendingSaves.current.get(`${version}:${record.id}`);
    if (pending) await pending;
    if (!current(user, version)) return;
    if (user && refs.current.saveStates[record.id] === "saved")
      await cloud.updateNotes(record.id, text, tags);
    if (!current(user, version)) return;
    recordRevision.current++;
    refs.current.measurements = refs.current.measurements.map((item) =>
      item.id === record.id ? next : item,
    );
    setMeasurements(refs.current.measurements);
    if (user && refs.current.saveStates[record.id] !== "saved")
      void persist(next);
  }
  async function removeRecord(id: string) {
    if (switching.current) return;
    const user = owner.current,
      version = generation.current,
      pending = pendingSaves.current.get(`${version}:${id}`);
    if (pending) await pending;
    if (!current(user, version)) return;
    if (user) await cloud.deleteMeasurement(id);
    if (!current(user, version)) return;
    recordRevision.current++;
    tombstones.current.add(id);
    refs.current.measurements = refs.current.measurements.filter(
      (item) => item.id !== id,
    );
    setMeasurements(refs.current.measurements);
  }
  async function removeBaseline(id: string) {
    if (switching.current) return;
    if (["baseline", "capture"].includes(acquisition.getSnapshot().phase))
      throw new auth.CloudError(
        "account_busy",
        "Finish or cancel the active recording before deleting a baseline.",
      );
    const user = owner.current,
      version = generation.current,
      pending = pendingSaves.current.get(`${version}:${id}`);
    if (pending) await pending;
    if (!current(user, version)) return;
    if (refs.current.measurements.some((item) => item.baselineId === id))
      throw new auth.CloudError(
        "baseline_in_use",
        "This baseline is retained by a measurement.",
      );
    if (user) await cloud.deleteBaseline(id);
    if (!current(user, version)) return;
    recordRevision.current++;
    tombstones.current.add(id);
    refs.current.baselines = refs.current.baselines.filter(
      (item) => item.id !== id,
    );
    setBaselines(refs.current.baselines);
    if (refs.current.profile.activeBaselineId === id) {
      acquisition.setBaseline(null);
      await updateProfile({ ...refs.current.profile, activeBaselineId: null });
    }
  }
  async function bookmark(id: string) {
    if (switching.current) return;
    const user = owner.current,
      version = generation.current,
      enable = !bookmarks.includes(id);
    await cloud.toggleBookmark(id, enable);
    if (current(user, version))
      setBookmarks((rows) =>
        enable
          ? [...new Set([...rows, id])]
          : rows.filter((item) => item !== id),
      );
  }
  async function more() {
    const user = owner.current,
      version = generation.current;
    if (!user || switching.current) return;
    setLoading(true);
    try {
      const page = await cloud.loadMoreMeasurements(
        refs.current.measurements.filter(
          (item) => refs.current.saveStates[item.id] === "saved",
        ).length,
      );
      if (!current(user, version)) return;
      const ids = new Set(refs.current.measurements.map((item) => item.id));
      refs.current.measurements = [
        ...refs.current.measurements,
        ...page.filter(
          (item) => !ids.has(item.id) && !tombstones.current.has(item.id),
        ),
      ];
      refs.current.saveStates = {
        ...refs.current.saveStates,
        ...Object.fromEntries(
          page.map((item) => [item.id, "saved" as SaveState]),
        ),
      };
      setMeasurements(refs.current.measurements);
      setSaveStates(refs.current.saveStates);
      setHasMore(page.length === 200);
    } catch {
      if (current(user, version)) setError("error.load");
    } finally {
      if (current(user, version)) setLoading(false);
    }
  }
  async function signOut() {
    signingOut.current = true;
    clearPrivate(null);
    try {
      await auth.signOut();
    } catch (reason) {
      setError("auth.sessionExpired");
      throw reason;
    } finally {
      signingOut.current = false;
    }
  }
  async function moreBaselines() {
    const user = owner.current,
      version = generation.current;
    if (!user || switching.current) return;
    setLoading(true);
    try {
      const page = await cloud.loadMoreBaselines(baselineOffset.current);
      if (!current(user, version)) return;
      baselineOffset.current += page.length;
      page.forEach((item) => remoteBaselineIds.current.add(item.id));
      const ids = new Set(refs.current.baselines.map((item) => item.id));
      refs.current.baselines = [
        ...refs.current.baselines,
        ...page.filter(
          (item) =>
            !ids.has(item.id) &&
            !tombstones.current.has(item.id) &&
            isValidBaseline(item),
        ),
      ];
      refs.current.saveStates = {
        ...refs.current.saveStates,
        ...Object.fromEntries(
          page.map((item) => [item.id, "saved" as SaveState]),
        ),
      };
      setBaselines(refs.current.baselines);
      setSaveStates(refs.current.saveStates);
      setHasMoreBaselines(page.length === 200);
    } catch {
      if (current(user, version)) setError("error.load");
    } finally {
      if (current(user, version)) setLoading(false);
    }
  }
  async function clearAccountData(scope: "data" | "account") {
    const user = owner.current,
      version = generation.current;
    if (!user || switching.current) return;
    switching.current = true;
    client.disconnect();
    acquisition.clearSession();
    setIdentity((value) => value + 1);
    setLoading(true);
    try {
      await cloud.deleteAccount(scope);
      if (!current(user, version)) return;
      const next = scope === "account" ? null : refs.current.session;
      clearPrivate(next);
      if (scope === "account") {
        signingOut.current = true;
        try {
          await auth.signOut();
        } finally {
          signingOut.current = false;
        }
      }
    } finally {
      if (current(user, version)) {
        switching.current = false;
        setLoading(false);
      }
    }
  }
  return {
    entered,
    enter,
    session,
    profile,
    preferences,
    updateProfile,
    baselines,
    measurements,
    bookmarks,
    conversations,
    setConversations,
    saveStates,
    persist,
    pendingGuest,
    importGuest,
    discardGuest: () => {
      clearGuest();
      setPendingGuest(null);
    },
    loading,
    error,
    setError,
    recovery,
    setRecovery,
    identity,
    hasMore,
    more,
    hasMoreBaselines,
    moreBaselines,
    load,
    acquisition,
    snapshot,
    client,
    connection,
    simulator,
    selectBaseline,
    notes,
    removeRecord,
    removeBaseline,
    bookmark,
    signOut,
    clearAccountData,
    availableBaselines: baselines.filter((baseline) =>
      compatible(baseline, snapshot.device),
    ),
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;
