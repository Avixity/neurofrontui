"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const accounts = require("./accounts-server.cjs")
const A = "11111111-1111-4111-8111-111111111111"
const B = "22222222-2222-4222-8222-222222222222"
const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" }
const token = "Bearer a-valid-test-token-longer-than-twenty"
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status })
const features = { mean: 1, rms: 1, stdDev: 0, peakToPeak: 0, derivativeMean: 0 }
function baseline() {
  return { schemaVersion: 1, calculationVersion: "neurofront-features-v1", deviceName: "NeuroFront", serviceUuid: "service", characteristicUuid: "characteristic", unit: "uV", sampleIntervalMs: 50, calibrationDurationMs: 20000, createdAt: "2026-01-01T10:00:00.000Z", samples: [1, 1, 1], features }
}
function capture(id = "capture-one", score = 60) {
  const saved = baseline()
  return { id, schemaVersion: 1, calculationVersion: saved.calculationVersion, device: { name: "NeuroFront", serviceUuid: "service", characteristicUuid: "characteristic" },
    startedAt: "2026-01-02T10:00:00.000Z", completedAt: "2026-01-02T10:00:15.000Z", durationMs: 15000, sampleIntervalMs: 50, unit: "uV", samples: [1, 2, 3], axisMin: 0, axisMax: 4,
    stress: { score, label: score < 35 ? "Relaxed" : score < 60 ? "Balanced" : score < 78 ? "Elevated" : "High" }, summary: { average: 2, peak: 3, minimum: 1, activityLabel: "Stable" },
    baseline: { ...features, createdAt: saved.createdAt, calculationVersion: saved.calculationVersion, unit: "uV", sampleIntervalMs: 50, durationMs: 20000, samples: saved.samples }
  }
}

test("configuration publishes only a public key and never service-role or secret keys", () => {
  assert.deepEqual(accounts.config(env), { url: env.SUPABASE_URL, publishableKey: env.SUPABASE_PUBLISHABLE_KEY })
  for (const key of ["sb_secret_danger", `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`, ""]) assert.equal(accounts.config({ ...env, SUPABASE_PUBLISHABLE_KEY: key }), null)
  assert.equal(accounts.config({ ...env, SUPABASE_URL: "http://example.supabase.co" }), null)
  assert.equal(accounts.config({ ...env, SUPABASE_URL: "https://name:secret@example.supabase.co" }), null)
})

test("authentication is verified with the Auth server, not decoded client claims", async () => {
  let request
  const user = await accounts.verifyUser(token, env, async (url, options) => { request = { url, options }; return reply({ id: A }) }, new AbortController().signal)
  assert.equal(user.id, A)
  assert.equal(request.url, `${env.SUPABASE_URL}/auth/v1/user`)
  assert.equal(request.options.headers.Authorization, token)
  assert.equal(request.options.redirect, "error")
  await assert.rejects(accounts.verifyUser(token, env, async () => reply({}, 401)), error => error.code === "unauthorized" && error.status === 401)
  await assert.rejects(accounts.verifyUser("Bearer short", env, async () => { throw Error("Must not fetch") }), error => error.code === "unauthorized")
})

test("account context requests only authenticated ownership and rejects other-user or missing IDs", async () => {
  const user = { id: A, settings: accounts.config(env), headers: { Authorization: token, apikey: "public" } }
  const urls = []
  const selected = capture()
  const context = await accounts.accountContext(user, selected.id, async url => {
    urls.push(new URL(url))
    return reply(urls.length === 1 ? [{ owner_id: A, id: selected.id, payload: selected }] : [])
  })
  assert.equal(context.selected.id, selected.id)
  assert.equal(context.historyAvailable, true)
  assert.equal(context.selected.baseline.fingerprint.length, 64)
  assert.equal(context.selected.baseline.samples, undefined)
  assert.ok(urls.every(url => url.searchParams.get("owner_id") === `eq.${A}`))
  await assert.rejects(accounts.accountContext(user, selected.id, async () => reply([{ owner_id: B, id: selected.id, payload: selected }])), error => error.code === "capture_not_found")
  await assert.rejects(accounts.accountContext(user, "not-owned", async () => reply([])), error => error.status === 404)
  await assert.rejects(accounts.accountContext(user, "x&owner_id=other", async () => { throw Error("Must not fetch") }), error => error.status === 400)
})

test("a previous-history failure remains unavailable rather than a fabricated comparison", async () => {
  const user = { id: A, settings: accounts.config(env), headers: {} }
  let calls = 0
  const context = await accounts.accountContext(user, "capture-one", async () => ++calls === 1 ? reply([{ owner_id: A, id: "capture-one", payload: capture() }]) : reply({}, 503))
  assert.equal(context.historyAvailable, false)
  assert.deepEqual(context.previous, [])
})

test("assistant authenticates and loads its own records before provider access, never trusting submitted context", async () => {
  const { createHandler } = require("./assistant-server.cjs")
  let providerCalls = 0, authCalls = 0, recordCalls = 0
  const sent = []
  const handler = createHandler({ env: { ...env, GROQ_API_KEY: "model-test-key" }, fetch: async (url, options) => {
    if (url.endsWith("/auth/v1/user")) { authCalls++; return options.headers.Authorization === token ? reply({ id: A }) : reply({}, 401) }
    if (url.includes("/rest/v1/nf_captures")) {
      recordCalls++
      const params = new URL(url).searchParams
      assert.equal(params.get("owner_id"), `eq.${A}`)
      assert.equal(options.headers.Authorization, token)
      if (!params.has("id")) return reply([])
      return reply(params.get("id") === "eq.capture-one" ? [{ owner_id: A, id: "capture-one", payload: capture() }] : [])
    }
    assert.equal(url, "https://api.groq.com/openai/v1/chat/completions")
    assert.equal(options.headers.Authorization, "Bearer model-test-key")
    sent.push(JSON.parse(options.body))
    const output = [{ allowed: true }, { paragraphs: ["Use the placement guide."], resourceIds: ["placement"] }, { safe: true, grounded: true, languageMatched: true }][providerCalls++ % 3]
    return reply({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }] })
  } })
  const invoke = async (body, authorization = token) => {
    const req = { method: "POST", body, headers: { host: "localhost:5180", origin: "http://localhost:5180", "content-type": "application/json", authorization }, socket: { remoteAddress: "127.0.0.1" } }
    const res = { setHeader() {}, end(value) { this.body = JSON.parse(value); this.writableEnded = true } }
    await handler(req, res)
    return res
  }
  const request = { language: "en", messages: [{ role: "user", content: "Explain this capture" }], context: null, accountCaptureId: "capture-one" }
  assert.equal((await invoke(request)).statusCode, 200)
  assert.equal(authCalls, 1)
  assert.equal(recordCalls, 2)
  const generation = JSON.parse(sent[1].messages[1].content)
  assert.equal(generation.guestContext.selected.id, "capture-one")
  assert.equal(generation.guestContext.selected.score, 60)
  assert.ok(!JSON.stringify(sent).includes(token))
  assert.ok(!JSON.stringify(sent).includes(A))
  const priorProviderCalls = providerCalls
  assert.equal((await invoke({ ...request, accountCaptureId: "other-users-capture" })).statusCode, 404)
  assert.equal((await invoke(request, "Bearer invalid-test-token-longer-than-twenty")).statusCode, 401)
  assert.equal((await invoke({ ...request, context: { selected: capture() } })).statusCode, 400)
  assert.equal((await invoke({ ...request, user_id: B })).statusCode, 400)
  assert.equal(providerCalls, priorProviderCalls)
  assert.equal((await invoke({ ...request, accountCaptureId: null })).statusCode, 200)
})

test("migration ownership, immutable snapshots, duplicate retries and stale revisions in PostgreSQL", { skip: !process.env.PGLITE_MODULE }, async () => {
  const { PGlite } = require(process.env.PGLITE_MODULE)
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth, public, storage to anon, authenticated;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id integer generated always as identity,bucket_id text,name text);
      create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
      alter table storage.objects enable row level security;
      grant select,insert,update,delete on storage.objects to authenticated;
      grant usage,select on all sequences in schema storage to authenticated;
      insert into auth.users values('${A}'),('${B}');
    `)
    await db.exec(fs.readFileSync(require.resolve("./accounts-migration.sql"), "utf8"))
    const login = async user => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]); await db.exec("set role authenticated") }
    const saveBaseline = (id, payload = baseline()) => db.query("select (public.nf_save_baseline($1,$2::jsonb)).*", [id, JSON.stringify(payload)])
    const saveCapture = (id, baselineId, payload = capture(id)) => db.query("select (public.nf_save_capture($1,$2,$3::jsonb)).*", [id, baselineId, JSON.stringify(payload)])
    const saveProfile = (revision, preferences, baselineId = "baseline-a") => db.query("select to_jsonb(public.nf_save_profile($1,'A',null,$2::jsonb,$3)) as saved", [revision, JSON.stringify(preferences), baselineId])
    await login(A)
    await saveBaseline("baseline-a")
    await saveBaseline("baseline-a")
    assert.equal((await db.query("select * from public.nf_baselines")).rows.length, 1)
    await assert.rejects(saveBaseline("baseline-a", { ...baseline(), deviceName: "changed" }), error => error.code === "23505")
    await assert.rejects(saveBaseline("bad", { ...baseline(), samples: ["not a number"] }), error => error.code === "22023")
    await saveCapture("capture-a", "baseline-a")
    await saveCapture("capture-a", "baseline-a")
    assert.equal((await db.query("select * from public.nf_captures")).rows.length, 1)
    await assert.rejects(saveCapture("capture-a", "baseline-a", capture("capture-a", 80)), error => error.code === "23505")
    await assert.rejects(saveCapture("wrong-snapshot", "baseline-a", { ...capture("wrong-snapshot"), baseline: { ...capture().baseline, mean: 2 } }), error => error.code === "23503")
    for (const score of [0, 34.999, 35, 59.999, 60, 77.999, 78, 100]) {
      const item = capture("boundary", score)
      item.stress.label = require("./score-config.js").classify(score).label
      await saveCapture("boundary", "baseline-a", item)
      await db.query("delete from public.nf_captures where id='boundary'")
    }
    await assert.rejects(saveCapture("wrong-category", "baseline-a", { ...capture("wrong-category", 80), stress: { score: 80, label: "Balanced" } }), error => error.code === "22023")
    const profile = await saveProfile(0, { language: "hi" })
    assert.equal(profile.rows[0].saved.revision, 1)
    assert.equal((await saveProfile(0, { language: "hi" })).rows[0].saved.revision, 1)
    await assert.rejects(saveProfile(0, { language: "en" }), error => error.code === "40001")
    const message = { id: "message-a", ordinal: 0, payload: { role: "assistant", status: "completed", captureId: "capture-a", content: "Saved explanation" } }
    const saveThread = (revision, messages = [message], captureId = "capture-a") => db.query("select to_jsonb(public.nf_save_thread('thread-a',$1,'Result',$2,$3::jsonb)) as saved", [revision, captureId, JSON.stringify(messages)])
    assert.equal((await saveThread(0)).rows[0].saved.revision, 1)
    assert.equal((await saveThread(0)).rows[0].saved.revision, 1)
    await assert.rejects(saveThread(0, [{ ...message, payload: { ...message.payload, content: "stale overwrite" } }]), error => error.code === "40001")
    await assert.rejects(saveThread(1, [{ ...message, payload: { ...message.payload, role: "system" } }]), error => error.code === "22023")
    await assert.rejects(saveThread(1, [{ ...message, payload: { ...message.payload, capture: { id: "capture-a", stress: { score: 99 } } } }]), error => error.code === "23503")
    await db.query("insert into storage.objects(bucket_id,name) values('nf-avatars',$1)", [`${A}/own.webp`])
    await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('nf-avatars',$1)", [`${B}/other.webp`]), error => error.code === "42501")
    await assert.rejects(db.query("update public.nf_captures set payload='{}'::jsonb where id='capture-a'"), error => error.code === "42501")
    await login(B)
    for (const table of ["nf_profiles", "nf_baselines", "nf_captures", "nf_threads", "nf_messages"]) assert.equal((await db.query(`select * from public.${table}`)).rows.length, 0, `${table} isolates owners`)
    assert.equal((await db.query("select * from storage.objects")).rows.length, 0)
    await assert.rejects(saveCapture("foreign-baseline", "baseline-a"), error => error.code === "23503")
    await assert.rejects(saveProfile(0, {}), error => error.code === "23503")
    await assert.rejects(saveThread(0), error => error.code === "23503")
    await assert.rejects(saveThread(0, [message], null), error => error.code === "23503")
    await db.query("delete from public.nf_captures where id='capture-a'")
    await login(A)
    assert.equal((await db.query("select * from public.nf_captures")).rows.length, 1)
    await db.exec("reset role; set role anon")
    await assert.rejects(db.query("select * from public.nf_captures"), error => error.code === "42501")
    await assert.rejects(saveBaseline("guest"), error => error.code === "42501")
  } finally { await db.close() }
})
