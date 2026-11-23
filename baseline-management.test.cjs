const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const { webcrypto } = require("node:crypto")
const fixture = () => {
  const window = { addEventListener() {}, NeuroFrontDevice: { busy: () => window.busy, validBaseline: value => Boolean(value), setSavedBaseline(active, options) { window.choices = { active, options } } } }
  let remote, cached
  const db = { transaction() { const tx = { objectStore: () => ({ put(value) { cached = structuredClone(value); queueMicrotask(() => tx.oncomplete()) } }) }; return tx } }
  const fetch = async (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer test-owner")
    if (url.endsWith("/rpc/nf_save_profile")) {
      const data = JSON.parse(options.body)
      assert.equal(data.p_expected_revision, remote.profile.revision)
      remote.profile = { ...remote.profile, revision: remote.profile.revision + 1, preferences: data.p_preferences, active_baseline_id: data.p_active_baseline_id }
      return { ok: true, json: async () => structuredClone(remote.profile) }
    }
    if (url.includes("/nf_profiles?")) return { ok: true, json: async () => [structuredClone(remote.profile)] }
    if (url.includes("/nf_baselines?")) return { ok: true, json: async () => structuredClone(remote.baselines) }
    if (url.includes("/nf_captures?")) return { ok: true, json: async () => remote.captures.map(payload => ({ payload: structuredClone(payload) })) }
    return { ok: true, json: async () => [] }
  }
  const ctx = vm.createContext({ window, document: { addEventListener() {}, dispatchEvent() {} }, CustomEvent: class {}, structuredClone, crypto: webcrypto, TextEncoder, AbortController, AbortSignal, fetch, navigator: { onLine: true }, db, queueMicrotask() {} })
  const source = fs.readFileSync(__dirname + "/account-store.js", "utf8").replace(/\r\n/g, "\n").replace("  initialize()\n})()", '  window.test = { set(next) { user = next ? { id: next.owner } : null; bucket = next; }, bucket: () => bucket, connect() { dbPromise = Promise.resolve(db); client = { auth: { getSession: async () => ({ data: { session: { user, access_token: "test-owner" } } }) } }; config = { url: "https://test.invalid" } }, refresh: () => refresh(), flush: () => flush() }; })()')
  vm.runInContext(source, ctx)
  const payload = { createdAt: "2026-11-10T00:00:00.000Z", samples: [1, 4, 2] }
  const primary = { owner: "one", profile: { active_baseline_id: "b-1", revision: 1, preferences: { expanded: true } }, outbox: [], baselines: [{ id: "b-1", payload }, { id: "b-2", payload }], captures: [{ id: "capture", baseline: payload, completedAt: "2026-11-10T00:01:00.000Z", stress: { score: 73 }, cloudSaved: true }] }
  remote = structuredClone(primary)
  window.test.set(primary)
  window.test.connect()
  return { window, primary, remote, cached: () => cached, api: window.NeuroFrontAccount }
}
;(async () => {
  const { window, primary, remote, cached, api } = fixture()
  const original = JSON.stringify(api.getState().captures)
  await api.changeSavedBaseline("b-1", { label: "  Evening  " })
  assert.equal(api.getState().baselines[0].label, "Evening")
  assert.equal(window.choices.options[0].label, "Evening")
  assert.equal(primary.profile.preferences.expanded, true)
  assert.equal(api.getState().pending, 1)
  await window.test.flush()
  assert.equal(remote.profile.preferences.baselineMetadata["b-1"].label, "Evening")
  await window.test.refresh()
  assert.equal(window.choices.options[0].label, "Evening")
  window.busy = true
  await assert.rejects(api.changeSavedBaseline("b-1", { removed: true }), { code: "activeCapture" })
  window.busy = false
  await assert.rejects(api.changeSavedBaseline("b-1", { label: " " }), { code: "baselineName" })
  await api.changeSavedBaseline("b-1", { removed: true })
  assert.equal(primary.profile.active_baseline_id, null)
  assert.equal(window.choices.active, null)
  assert.equal(api.getState().baselines.length, 1)
  assert.equal(primary.baselines.length, 2)
  assert.equal(JSON.stringify(api.getState().captures), original)
  await assert.rejects(api.setActiveBaseline("b-1"), { code: "baseline" })
  await assert.rejects(api.changeSavedBaseline("b-1", { label: "Restore" }), { code: "baseline" })
  await window.test.flush()
  assert.equal(remote.profile.active_baseline_id, null)
  assert.deepEqual(remote.profile.preferences.baselineMetadata["b-1"], { removed: true })
  assert.equal(cached().profile.preferences.baselineMetadata["b-1"].removed, true)
  window.test.set(structuredClone(cached()))
  await window.test.refresh()
  assert.equal(api.getState().pending, 0)
  assert.equal(api.getState().baselines.length, 1)
  assert.equal(window.choices.active, null)
  assert.equal(JSON.stringify(api.getState().captures), original)
  window.test.set({ ...primary, owner: "two", profile: { preferences: {} } })
  assert.equal(api.getState().baselines.length, 2)
  assert.equal(api.getState().baselines[0].label, "")
  window.test.set(null)
  await assert.rejects(api.changeSavedBaseline("b-1", { removed: true }), { code: "authentication" })
  assert.equal(api.getState().baselines.length, 0)
  console.log("Baseline management: scoped names, persistent tombstones, active reset, busy guard and immutable capture snapshots")
})().catch(error => { console.error(error); process.exitCode = 1 })
