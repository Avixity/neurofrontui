import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Baseline, Measurement } from "../src/types";

const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
function baseline(): Baseline {
  return {
    id: randomUUID(),
    createdAt: "2026-11-01T00:00:00Z",
    durationMs: 20_000,
    sampleCount: 2,
    traces: {
      primary: [
        { t: 0, timestamp: 1793491200000, value: 10 },
        { t: 50, timestamp: 1793491200050, value: 12 },
      ],
      temperature: [],
      gsr: [],
    },
    units: { primary: "device units", temperature: "°C", gsr: "µS" },
    features: {
      mean: 11,
      rms: Math.sqrt(122),
      stdDev: 1,
      peakToPeak: 2,
      derivativeMean: 2,
    },
    quality: {
      status: "limited",
      issues: ["short"],
      validSamples: 2,
      invalidPackets: 0,
      maxGapMs: 50,
    },
    device: {
      name: "NeuroFront",
      serviceUuid: "service",
      characteristicUuid: "characteristic",
      protocol: "text",
      setup: "headband",
      timestampSource: "browser-receipt",
      source: "simulated",
    },
    algorithmVersion: "legacy-activity-v1",
    acquisitionVersion: "notification-v1",
    schemaVersion: 2,
  };
}
function capture(base = baseline()): Measurement {
  return {
    ...structuredClone(base),
    id: randomUUID(),
    durationMs: 15_000,
    baselineId: base.id,
    baseline: base,
    score: 50,
    status: "completed",
    notes: "",
    tags: [],
  };
}
async function asUser<T>(id: string, operation: () => Promise<T>) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  try {
    return await operation();
  } finally {
    await db.exec("reset role");
  }
}
const save = (measurement: Measurement) =>
  db.query("select (public.save_capture($1::jsonb)).*", [
    JSON.stringify(measurement),
  ]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated, service_role;
    grant usage on schema public to authenticated, service_role;
    insert into auth.users(id) values ('${a}'), ('${b}');`);
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/202611010001_neurofront.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe("actual PostgreSQL migration, ownership and immutable captures", () => {
  it("saves a measurement and its versioned baseline atomically and idempotently", async () => {
    const measurement = capture();
    await asUser(a, async () => {
      await save(measurement);
      await save(measurement);
      const { rows } = await db.query<{ count: number }>(
        "select count(*)::integer as count from public.measurements where id=$1",
        [measurement.id],
      );
      expect(rows[0].count).toBe(1);
      const { rows: baselines } = await db.query<{
        snapshot: Baseline;
        version: number;
      }>("select snapshot,version from public.baselines where id=$1", [
        measurement.baselineId,
      ]);
      expect(baselines[0].snapshot).toEqual(measurement.baseline);
      expect(baselines[0].version).toBeGreaterThan(0);
      await expect(save({ ...measurement, score: 80 })).rejects.toMatchObject({
        code: "23505",
      });
      await expect(
        db.query("update public.measurements set snapshot=$1 where id=$2", [
          JSON.stringify({}),
          measurement.id,
        ]),
      ).rejects.toMatchObject({ code: "42501" });
      await db.query(
        "update public.measurements set notes=$1,tags=$2 where id=$3",
        ["My note", ["rest"], measurement.id],
      );
      const { rows: frozen } = await db.query<{
        snapshot: Measurement;
        notes: string;
      }>("select snapshot,notes from public.measurements where id=$1", [
        measurement.id,
      ]);
      expect(frozen[0].snapshot.notes).toBe("");
      expect(frozen[0].notes).toBe("My note");
    });
  });
  it("RLS hides another account and rejects reusing its baseline or writing its bookmarks", async () => {
    const measurement = capture();
    await asUser(a, () => save(measurement));
    await asUser(b, async () => {
      expect(
        (
          await db.query("select * from public.measurements where id=$1", [
            measurement.id,
          ])
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await db.query(
            "update public.measurements set notes=$1 where id=$2 returning id",
            ["changed", measurement.id],
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await db.query(
            "delete from public.measurements where id=$1 returning id",
            [measurement.id],
          )
        ).rows,
      ).toHaveLength(0);
      await expect(save(capture(measurement.baseline))).rejects.toMatchObject({
        code: "42501",
      });
      await db.query(
        "insert into public.bookmarks(user_id,resource_id) values($1,$2)",
        [b, "baseline-guide"],
      );
      await expect(
        db.query(
          "insert into public.bookmarks(user_id,resource_id) values($1,$2)",
          [a, "baseline-guide"],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        db.query(
          "insert into public.profiles(id,active_baseline_id) values($1,$2)",
          [b, measurement.baselineId],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });
  it("rolls back invalid captures and preserves baseline snapshots", async () => {
    const measurement = capture();
    measurement.traces.primary[1].t = -1;
    await asUser(a, async () => {
      await expect(save(measurement)).rejects.toMatchObject({ code: "22023" });
      expect(
        (
          await db.query("select id from public.baselines where id=$1", [
            measurement.baselineId,
          ])
        ).rows,
      ).toHaveLength(0);
      const valid = capture();
      await save(valid);
      const changed = {
        ...valid.baseline,
        features: { ...valid.baseline.features, mean: 999 },
      };
      await expect(
        db.query("select public.save_baseline($1::jsonb)", [
          JSON.stringify(changed),
        ]),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        db.query("delete from public.baselines where id=$1", [
          valid.baselineId,
        ]),
      ).rejects.toMatchObject({ code: "23503" });
    });
  });
  it("deletes only the caller data and cascades full account deletion", async () => {
    const ma = capture();
    const mb = capture();
    await asUser(a, () => save(ma));
    await asUser(b, () => save(mb));
    await asUser(b, async () => {
      await db.query("select public.delete_my_data()");
      expect(
        (await db.query("select id from public.measurements")).rows,
      ).toHaveLength(0);
    });
    expect(
      (
        await db.query("select id from public.measurements where id=$1", [
          ma.id,
        ])
      ).rows,
    ).toHaveLength(1);
    await asUser(b, () => save(capture()));
    await db.query("delete from auth.users where id=$1", [b]);
    expect(
      (await db.query("select id from public.baselines where user_id=$1", [b]))
        .rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query("select id from public.measurements where user_id=$1", [
          b,
        ])
      ).rows,
    ).toHaveLength(0);
  });
});

describe("database-backed assistant quota", () => {
  it("blocks authenticated direct quota manipulation", async () => {
    await asUser(a, async () => {
      await expect(
        db.query("select * from public.assistant_usage"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        db.query("select public.consume_assistant_quota($1,$2,4,12)", [
          "a".repeat(64),
          randomUUID(),
        ]),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });
  it("consumes quotas atomically, rejects replays, and cannot exceed the limit", async () => {
    await db.exec("set role service_role");
    try {
      const subject = "f".repeat(64);
      const firstId = randomUUID();
      const consume = (id: string) =>
        db.query<{ result: { allowed: boolean; reason?: string } }>(
          "select public.consume_assistant_quota($1,$2,4,12) as result",
          [subject, id],
        );
      expect((await consume(firstId)).rows[0].result.allowed).toBe(true);
      expect((await consume(firstId)).rows[0].result.reason).toBe("replayed");
      const attempts = await Promise.all(
        Array.from({ length: 8 }, () => consume(randomUUID())),
      );
      expect(
        attempts.filter((item) => item.rows[0].result.allowed),
      ).toHaveLength(3);
      const counts = await db.query<{ requests: number }>(
        "select requests from public.assistant_usage where subject_hash=$1",
        [subject],
      );
      expect(counts.rows.map((row) => row.requests)).toEqual([4, 4]);
    } finally {
      await db.exec("reset role");
    }
  });
});
