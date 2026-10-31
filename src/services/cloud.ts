import type { Baseline, Conversation, Measurement, Profile } from "../types";
import { DEFAULT_GRAPHS } from "../types";
import {
  accountClient,
  accountDeletionBarrier,
  CloudError,
  getSession,
} from "./auth";

const LIMIT = 200;
type DatabaseError = { code?: string; message: string } | null;
function check(error: DatabaseError) {
  if (!error) return;
  const code =
    error.code === "23503"
      ? "baseline_in_use"
      : error.code === "23505"
        ? "snapshot_conflict"
        : error.code === "42501"
          ? "access_denied"
          : error.code === "22023"
            ? "invalid_snapshot"
            : "cloud_error";
  throw new CloudError(code, error.message);
}
function bounded(value: unknown, limit: number) {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > limit)
    throw new CloudError(
      "snapshot_too_large",
      "This record is too large for account storage.",
    );
}
function snapshotGuard(value: Baseline | Measurement) {
  bounded(value, 1_048_576);
  if (
    !value.traces.primary.length ||
    Object.values(value.traces).some((trace) => trace.length > 20_000)
  ) {
    throw new CloudError(
      "invalid_snapshot",
      "A saved capture needs a bounded, nonempty primary signal.",
    );
  }
}

export async function loadAccount() {
  const { user, db } = await accountClient();
  const result = await Promise.all([
    db
      .from("profiles")
      .select("display_name,preferences,active_baseline_id")
      .eq("id", user.id)
      .maybeSingle(),
    db
      .from("baselines")
      .select("snapshot")
      .order("created_at", { ascending: false })
      .order("id")
      .limit(LIMIT + 1),
    db
      .from("measurements")
      .select("snapshot,baseline_snapshot,notes,tags")
      .order("created_at", { ascending: false })
      .order("id")
      .limit(LIMIT + 1),
    db
      .from("bookmarks")
      .select("resource_id")
      .order("created_at", { ascending: false })
      .limit(LIMIT + 1),
    db
      .from("conversations")
      .select("snapshot")
      .order("updated_at", { ascending: false })
      .limit(LIMIT + 1),
  ]);
  result.forEach((item) => check(item.error));
  const row = result[0].data;
  const preferences = {
    language: "en",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    graphs: { ...DEFAULT_GRAPHS },
    saveChat: false,
    ...(row?.preferences || {}),
  };
  preferences.graphs = {
    ...DEFAULT_GRAPHS,
    ...(row?.preferences?.graphs || {}),
  };
  const profile: Profile = {
    displayName: row?.display_name || user.user_metadata.display_name || "",
    email: user.email || "",
    preferences,
    activeBaselineId: row?.active_baseline_id || null,
  };
  const baselines = (result[1].data || [])
    .slice(0, LIMIT)
    .map((row) => row.snapshot as Baseline);
  if (
    profile.activeBaselineId &&
    !baselines.some((item) => item.id === profile.activeBaselineId)
  ) {
    const { data, error } = await db
      .from("baselines")
      .select("snapshot")
      .eq("id", profile.activeBaselineId)
      .maybeSingle();
    check(error);
    if (data) baselines.push(data.snapshot as Baseline);
  }
  const measurements = (result[2].data || []).slice(0, LIMIT).map(
    (row) =>
      ({
        ...row.snapshot,
        baseline: row.baseline_snapshot,
        notes: row.notes,
        tags: row.tags,
      }) as Measurement,
  );
  const bookmarks = (result[3].data || [])
    .slice(0, LIMIT)
    .map((row) => row.resource_id as string);
  const conversations = (result[4].data || [])
    .slice(0, LIMIT)
    .map((row) => row.snapshot as Conversation);
  return {
    profile,
    baselines,
    measurements,
    bookmarks,
    conversations,
    hasMoreMeasurements: (result[2].data?.length || 0) > LIMIT,
    hasMoreBaselines: (result[1].data?.length || 0) > LIMIT,
    baselinePageSize: Math.min(result[1].data?.length || 0, LIMIT),
    truncated: result
      .slice(1)
      .some((item) => Array.isArray(item.data) && item.data.length > LIMIT),
  };
}

export async function saveBaseline(baseline: Baseline) {
  const { db } = await accountClient();
  snapshotGuard(baseline);
  const { data, error } = await db.rpc("save_baseline", {
    p_baseline: baseline,
  });
  check(error);
  return data;
}
export async function loadMoreMeasurements(
  offset: number,
): Promise<Measurement[]> {
  const { db } = await accountClient();
  if (!Number.isInteger(offset) || offset < 0)
    throw new CloudError("invalid_request", "Invalid history page.");
  const { data, error } = await db
    .from("measurements")
    .select("snapshot,baseline_snapshot,notes,tags")
    .order("created_at", { ascending: false })
    .order("id")
    .range(offset, offset + LIMIT - 1);
  check(error);
  return (data || []).map(
    (row) =>
      ({
        ...row.snapshot,
        baseline: row.baseline_snapshot,
        notes: row.notes,
        tags: row.tags,
      }) as Measurement,
  );
}
export async function loadMoreBaselines(offset: number): Promise<Baseline[]> {
  const { db } = await accountClient();
  if (!Number.isInteger(offset) || offset < 0)
    throw new CloudError("invalid_request", "Invalid baseline page.");
  const { data, error } = await db
    .from("baselines")
    .select("snapshot")
    .order("created_at", { ascending: false })
    .order("id")
    .range(offset, offset + LIMIT - 1);
  check(error);
  return (data || []).map((row) => row.snapshot as Baseline);
}

export async function exportAccount() {
  const { user, db } = await accountClient();
  let bytes = 0;
  async function allRows(table: string, columns: string, order: string) {
    const records: Record<string, any>[] = [];
    for (let offset = 0; offset <= 10_000; offset += 100) {
      if ((await getSession())?.user.id !== user.id)
        throw new CloudError(
          "account_changed",
          "The signed-in account changed during export.",
        );
      const { data, error } = await db
        .from(table)
        .select(columns)
        .order(order)
        .range(offset, offset + 99);
      check(error);
      const rows = (data || []) as unknown as Record<string, any>[];
      bytes += new TextEncoder().encode(JSON.stringify(rows)).byteLength;
      if (bytes > 100 * 1024 * 1024 || records.length + rows.length > 10_000)
        throw new CloudError(
          "export_too_large",
          "This account exceeds the browser export limit. Request a database export from the project administrator.",
        );
      records.push(...rows);
      if (rows.length < 100) return records;
    }
    throw new CloudError(
      "export_too_large",
      "This account exceeds the browser export limit.",
    );
  }
  const { data: profile, error } = await db
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  check(error);
  const baselines = await allRows("baselines", "snapshot,version", "id");
  const measurements = await allRows(
    "measurements",
    "snapshot,baseline_snapshot,notes,tags",
    "id",
  );
  const bookmarks = await allRows("bookmarks", "resource_id", "resource_id");
  const conversations = await allRows("conversations", "snapshot", "id");
  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    profile,
    baselines: baselines.map((row) => ({
      ...row.snapshot,
      cloudVersion: row.version,
    })),
    measurements: measurements.map((row) => ({
      ...row.snapshot,
      baseline: row.baseline_snapshot,
      notes: row.notes,
      tags: row.tags,
    })),
    bookmarks: bookmarks.map((row) => row.resource_id),
    conversations: conversations.map((row) => row.snapshot),
  };
}
export async function saveMeasurement(measurement: Measurement) {
  const { db } = await accountClient();
  snapshotGuard(measurement);
  snapshotGuard(measurement.baseline);
  const { data, error } = await db.rpc("save_capture", {
    p_capture: measurement,
  });
  check(error);
  return data;
}
export async function updateNotes(id: string, notes: string, tags: string[]) {
  const { db } = await accountClient();
  if (
    notes.length > 4000 ||
    tags.length > 12 ||
    tags.some((tag) => tag.length > 40)
  )
    throw new CloudError(
      "invalid_notes",
      "Notes or tags exceed the storage limit.",
    );
  const { error } = await db
    .from("measurements")
    .update({ notes, tags })
    .eq("id", id);
  check(error);
}
export async function saveProfile(profile: Profile) {
  const { user, db } = await accountClient();
  bounded(profile.preferences, 4096);
  const { error } = await db.from("profiles").upsert({
    id: user.id,
    display_name: profile.displayName.slice(0, 80),
    preferences: profile.preferences,
    active_baseline_id: profile.activeBaselineId,
  });
  check(error);
}
export async function toggleBookmark(id: string, bookmarked: boolean) {
  const { user, db } = await accountClient();
  const query = bookmarked
    ? db.from("bookmarks").insert({ user_id: user.id, resource_id: id })
    : db
        .from("bookmarks")
        .delete()
        .eq("user_id", user.id)
        .eq("resource_id", id);
  const { error } = await query;
  if (!(bookmarked && error?.code === "23505")) check(error);
}
export async function deleteMeasurement(id: string) {
  const { db } = await accountClient();
  const { error } = await db.from("measurements").delete().eq("id", id);
  check(error);
}
export async function deleteBaseline(id: string) {
  const { db } = await accountClient();
  const { error } = await db.from("baselines").delete().eq("id", id);
  check(error);
}
export async function saveConversation(conversation: Conversation) {
  const { user, db } = await accountClient();
  bounded(conversation, 262_144);
  const { error } = await db.from("conversations").upsert({
    id: conversation.id,
    user_id: user.id,
    snapshot: conversation,
    updated_at: new Date().toISOString(),
  });
  check(error);
}
export async function deleteConversation(id: string) {
  const { db } = await accountClient();
  const { error } = await db.from("conversations").delete().eq("id", id);
  check(error);
}
export async function deleteAccount(scope: "data" | "account") {
  const session = await getSession();
  if (!session)
    throw new CloudError(
      "authentication_required",
      "Sign in before deleting account data.",
    );
  const release = await accountDeletionBarrier(session.user.id);
  try {
    const response = await fetch("/api/account", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ scope, confirmation: "DELETE" }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new CloudError(
        result.code || "cloud_error",
        result.message || "Account deletion did not complete.",
      );
    }
  } finally {
    release();
  }
}
