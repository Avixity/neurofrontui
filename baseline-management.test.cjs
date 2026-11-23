const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const { webcrypto } = require("node:crypto")
const fixture = () => {
  const window = { addEventListener() {}, NeuroFrontDevice: { busy: () => window.busy, validBaseline: value => Boolean(value), setSavedBaseline(active, options) { window.choices = { active, options } } } }
  const ctx = vm.createContext({ window, document: { addEventListener() {}, dispatchEvent() {} }, CustomEvent: class {}, structuredClone, crypto: webcrypto, TextEncoder, queueMicrotask() {} })
  const source = fs.readFileSync(__dirname + "/account-store.js", "utf8").replace(/\r\n/g, "\n").replace("  initialize()\n})()", '  window.test = { set(next) { user = next ? { id: next.owner } : null; bucket = next; }, bucket: () => bucket }; })()')
  vm.runInContext(source, ctx)
  const payload = { createdAt: "2026-11-10T00:00:00.000Z", samples: [1, 4, 2] }
  const primary = { owner: "one", profile: { active_baseline_id: "b-1", revision: 1, preferences: { expanded: true } }, outbox: [], baselines: [{ id: "b-1", payload }, { id: "b-2", payload }], captures: [{ id: "capture", baseline: payload }] }
  window.test.set(primary)
  return { window, primary, api: window.NeuroFrontAccount }
}
;(async () => {
  const { window, primary, api } = fixture()
  const original = JSON.stringify(api.getState().captures)
  await api.changeSavedBaseline("b-1", { label: "  Evening  " })
  assert.equal(api.getState().baselines[0].label, "Evening")
  assert.equal(window.choices.options[0].label, "Evening")
  assert.equal(primary.profile.preferences.expanded, true)
  assert.equal(api.getState().pending, 1)
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
  window.test.set(structuredClone(primary))
  assert.equal(api.getState().baselines.length, 1)
  window.test.set({ ...primary, owner: "two", profile: { preferences: {} } })
  assert.equal(api.getState().baselines.length, 2)
  assert.equal(api.getState().baselines[0].label, "")
  window.test.set(null)
  await assert.rejects(api.changeSavedBaseline("b-1", { removed: true }), { code: "authentication" })
  assert.equal(api.getState().baselines.length, 0)
  console.log("Baseline management: scoped names, persistent tombstones, active reset, busy guard and immutable capture snapshots")
})().catch(error => { console.error(error); process.exitCode = 1 })
