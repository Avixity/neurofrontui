// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import type { Baseline, Measurement, Profile } from "../src/types";
import {
  defaultPreferences,
  readGuest,
  saveGuest,
} from "../src/services/local";
import { useWorkspace } from "../src/useWorkspace";

const state = vi.hoisted(() => ({
  session: null as Session | null,
  listener: null as null | ((session: Session | null, event?: string) => void),
  onBaseline: null as null | ((baseline: Baseline) => void),
  onComplete: null as null | ((measurement: Measurement) => void),
  clearSession: vi.fn(),
  disconnect: vi.fn(),
  signOut: vi.fn(),
  loadAccount: vi.fn(),
  saveBaseline: vi.fn(),
  saveMeasurement: vi.fn(),
  saveProfile: vi.fn(),
  deleteAccount: vi.fn(),
  updateNotes: vi.fn(),
  deleteMeasurement: vi.fn(),
  deleteBaseline: vi.fn(),
  loadMoreBaselines: vi.fn(),
}));
vi.mock("../src/services/auth", () => ({
  getSession: async () => state.session,
  subscribeAuth: (callback: typeof state.listener) => {
    state.listener = callback;
    return () => {
      state.listener = null;
    };
  },
  signOut: state.signOut,
  CloudError: class extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("../src/services/cloud", () => ({
  loadAccount: state.loadAccount,
  saveBaseline: state.saveBaseline,
  saveMeasurement: state.saveMeasurement,
  saveProfile: state.saveProfile,
  deleteAccount: state.deleteAccount,
  updateNotes: state.updateNotes,
  deleteMeasurement: state.deleteMeasurement,
  deleteBaseline: state.deleteBaseline,
  toggleBookmark: vi.fn(),
  loadMoreMeasurements: vi.fn().mockResolvedValue([]),
  loadMoreBaselines: state.loadMoreBaselines,
}));
vi.mock("../src/core/acquisition", () => ({
  compatible: () => true,
  isValidBaseline: () => true,
  createAcquisition: (options: {
    onBaseline: (baseline: Baseline) => void;
    onComplete: (measurement: Measurement) => void;
  }) => {
    state.onBaseline = options.onBaseline;
    state.onComplete = options.onComplete;
    const snapshot = { phase: "idle", device: null, connected: false };
    return {
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
      setBaseline: () => true,
      clearSession: state.clearSession,
      connect: vi.fn(),
      disconnect: vi.fn(),
      acceptSample: vi.fn(),
      invalidPacket: vi.fn(),
      interrupt: vi.fn(),
      reset: vi.fn(),
      dispose: vi.fn(),
    };
  },
}));
vi.mock("../src/core/device", () => ({
  createDeviceClient: () => ({
    disconnect: state.disconnect,
    getSnapshot: () => ({ status: "unavailable", device: null, error: null }),
    dispose: vi.fn(),
  }),
}));

function session(id: string): Session {
  return {
    access_token: `token-${id}`,
    refresh_token: "refresh",
    token_type: "bearer",
    expires_in: 3600,
    user: {
      id,
      email: `${id}@example.com`,
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: "2026-11-01",
    },
  };
}
function fixture() {
  const baseline: Baseline = {
    id: crypto.randomUUID(),
    createdAt: "2026-11-01T00:00:00Z",
    durationMs: 20_000,
    sampleCount: 2,
    traces: {
      primary: [
        { t: 0, timestamp: 1793491200000, value: 1 },
        { t: 50, timestamp: 1793491200050, value: 2 },
      ],
      temperature: [],
      gsr: [],
    },
    units: { primary: "device units", temperature: "°C", gsr: "µS" },
    features: {
      mean: 1.5,
      rms: 1.58,
      stdDev: 0.5,
      peakToPeak: 1,
      derivativeMean: 1,
    },
    quality: {
      status: "limited",
      issues: [],
      validSamples: 2,
      invalidPackets: 0,
      maxGapMs: 50,
    },
    device: {
      name: "NeuroFront",
      source: "simulated",
      protocol: "test",
      setup: "test",
      serviceUuid: "service",
      characteristicUuid: "characteristic",
      timestampSource: "browser-receipt",
    },
    algorithmVersion: "test",
    acquisitionVersion: "test",
    schemaVersion: 2,
  };
  const measurement: Measurement = {
    ...structuredClone(baseline),
    id: crypto.randomUUID(),
    durationMs: 15_000,
    baselineId: baseline.id,
    baseline,
    score: 50,
    status: "completed",
    notes: "",
    tags: [],
  };
  return { baseline, measurement };
}
function account(
  id: string,
  measurements: Measurement[] = [],
  baselines: Baseline[] = [],
) {
  const profile: Profile = {
    displayName: id,
    email: `${id}@example.com`,
    preferences: defaultPreferences(),
    activeBaselineId: null,
  };
  return {
    profile,
    measurements,
    baselines,
    bookmarks: [],
    conversations: [],
    truncated: false,
    hasMoreMeasurements: false,
    hasMoreBaselines: false,
    baselinePageSize: baselines.length,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function emit(id: string | null) {
  await act(async () => {
    state.session = id ? session(id) : null;
    state.listener?.(state.session, id ? "SIGNED_IN" : "SIGNED_OUT");
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  state.session = null;
  state.listener = null;
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  state.loadAccount
    .mockReset()
    .mockImplementation(async () => account(state.session?.user.id || "none"));
  state.saveBaseline.mockReset().mockResolvedValue({});
  state.saveMeasurement.mockReset().mockResolvedValue({});
  state.saveProfile.mockReset().mockResolvedValue({});
  state.signOut.mockReset().mockResolvedValue(undefined);
  state.deleteAccount.mockReset().mockResolvedValue(undefined);
  state.loadMoreBaselines.mockReset().mockResolvedValue([]);
});
afterEach(cleanup);

describe("workspace identity and persistence lifecycle", () => {
  it("keeps guest transfer explicit and retains pending records until the decision", async () => {
    const { baseline, measurement } = fixture();
    saveGuest({
      baselines: [baseline],
      measurements: [measurement],
      activeBaselineId: baseline.id,
    });
    const { result } = renderHook(useWorkspace);
    await emit("account-a");
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.measurements).toHaveLength(0);
    expect(result.current.pendingGuest?.measurements[0].id).toBe(
      measurement.id,
    );
    expect(readGuest().measurements[0].id).toBe(measurement.id);
    expect(state.saveBaseline).not.toHaveBeenCalled();
    expect(state.saveMeasurement).not.toHaveBeenCalled();
    state.loadAccount.mockResolvedValue(
      account("account-a", [measurement], [baseline]),
    );
    await act(async () => {
      await result.current.importGuest();
    });
    expect(state.saveBaseline).toHaveBeenCalledOnce();
    expect(state.saveMeasurement).toHaveBeenCalledOnce();
    expect(result.current.pendingGuest).toBeNull();
    expect(readGuest().measurements).toHaveLength(0);
    expect(result.current.measurements[0].id).toBe(measurement.id);
  });
  it("clears private state immediately while sign-out is still pending", async () => {
    const { measurement } = fixture();
    state.loadAccount.mockResolvedValue(account("account-a", [measurement]));
    const { result } = renderHook(useWorkspace);
    await emit("account-a");
    await waitFor(() => expect(result.current.measurements).toHaveLength(1));
    const logout = deferred<void>();
    state.signOut.mockReturnValue(logout.promise);
    let signingOut!: Promise<void>;
    act(() => {
      signingOut = result.current.signOut();
    });
    expect(result.current.session).toBeNull();
    expect(result.current.measurements).toHaveLength(0);
    expect(result.current.baselines).toHaveLength(0);
    expect(result.current.conversations).toHaveLength(0);
    expect(state.clearSession).toHaveBeenCalled();
    expect(state.disconnect).toHaveBeenCalled();
    await act(async () => {
      logout.resolve();
      await signingOut;
    });
  });
  it("ignores account A loading after account B has become active", async () => {
    const old = deferred<ReturnType<typeof account>>();
    state.loadAccount
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(account("account-b"));
    const { result } = renderHook(useWorkspace);
    await emit("account-a");
    await waitFor(() => expect(state.loadAccount).toHaveBeenCalledTimes(1));
    await emit("account-b");
    await waitFor(() =>
      expect(result.current.profile.displayName).toBe("account-b"),
    );
    await act(async () => {
      old.resolve(account("account-a", [fixture().measurement]));
      await old.promise;
    });
    expect(result.current.profile.displayName).toBe("account-b");
    expect(result.current.measurements).toHaveLength(0);
  });
  it("preserves a failed local capture when refreshing account history", async () => {
    const { measurement } = fixture();
    state.saveMeasurement.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(useWorkspace);
    await emit("account-a");
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      state.onComplete?.(measurement);
    });
    await waitFor(() =>
      expect(result.current.saveStates[measurement.id]).toBe("error"),
    );
    await act(async () => {
      await result.current.load();
    });
    expect(result.current.measurements[0].id).toBe(measurement.id);
    expect(result.current.saveStates[measurement.id]).toBe("error");
  });
  it("preserves a newly selected unsaved baseline through an account refresh", async () => {
    const { baseline } = fixture();
    state.saveBaseline.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(useWorkspace);
    await emit("account-a");
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      state.onBaseline?.(baseline);
    });
    await waitFor(() =>
      expect(result.current.saveStates[baseline.id]).toBe("error"),
    );
    await act(async () => {
      await result.current.load();
    });
    expect(result.current.profile.activeBaselineId).toBe(baseline.id);
    expect(result.current.baselines[0].id).toBe(baseline.id);
  });
  it("pages older baselines without counting the separately fetched active baseline twice", async () => {
    const first = Array.from({ length: 201 }, () => fixture().baseline);
    state.loadAccount.mockResolvedValue({
      ...account("account-a", [], first),
      hasMoreBaselines: true,
      baselinePageSize: 200,
    });
    const older = fixture().baseline;
    state.loadMoreBaselines.mockResolvedValue([older]);
    const { result } = renderHook(useWorkspace);
    await emit("account-a");
    await waitFor(() => expect(result.current.hasMoreBaselines).toBe(true));
    await act(async () => {
      await result.current.moreBaselines();
    });
    expect(state.loadMoreBaselines).toHaveBeenCalledWith(200);
    expect(result.current.baselines).toHaveLength(202);
    expect(result.current.hasMoreBaselines).toBe(false);
  });
  it("does not copy a late save or its state into the next account", async () => {
    const { measurement } = fixture();
    const saving = deferred<object>();
    state.saveMeasurement.mockReturnValue(saving.promise);
    const { result } = renderHook(useWorkspace);
    await emit("account-a");
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      state.onComplete?.(measurement);
    });
    expect(result.current.saveStates[measurement.id]).toBe("saving");
    await emit("account-b");
    await act(async () => {
      saving.resolve({});
      await saving.promise;
    });
    expect(result.current.profile.displayName).toBe("account-b");
    expect(result.current.measurements).toHaveLength(0);
    expect(result.current.saveStates[measurement.id]).toBeUndefined();
  });
  it("keeps deleted account data cleared when an older save resolves", async () => {
    const { measurement } = fixture();
    const saving = deferred<object>();
    state.saveMeasurement.mockReturnValue(saving.promise);
    const { result } = renderHook(useWorkspace);
    await emit("account-a");
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      state.onComplete?.(measurement);
    });
    await act(async () => {
      await result.current.clearAccountData("data");
    });
    expect(result.current.session?.user.id).toBe("account-a");
    expect(result.current.measurements).toHaveLength(0);
    await act(async () => {
      saving.resolve({});
      await saving.promise;
    });
    expect(result.current.measurements).toHaveLength(0);
    expect(result.current.saveStates[measurement.id]).toBeUndefined();
  });
});
