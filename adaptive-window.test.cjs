"use strict"
const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const { test } = require("node:test")
const source = fs.readFileSync(__dirname + "/dashboard-session.js", "utf8")
function fixture() {
  const controls = new Map(), events = new Map(), calls = [], archive = []
  const baseline = { createdAt: "synthetic", ready: true, mean: 0, rms: 2, stdDev: 2, peakToPeak: 4, derivativeMean: 1 }
  let now = 2000, wall = 1234567890000, owner = "test-owner", connected = true
  const document = { hidden: false, body: { classList: { toggle() {}, remove() {} } },
    addEventListener(key, cb) { events.set(key,cb) }, getElementById(id) {
      if (!controls.has(id)) controls.set(id, { value: "", hidden: false, disabled: false, focus() {},
        addEventListener(event, fn) { this[event] = fn } })
      return controls.get(id)
    } }
  const state = { baseline, calculationVersion: "synthetic", characteristic: {}, flow:"ready",
    calibration:{ active:false }, measurement:{ active:false }, lastIncomingTime:now }
  const window = { addEventListener() {}, NeuroFrontAccount: { owner: () => owner, deviceBusy() {} },
    NeuroFrontAdaptiveHistory: { save(record, id) { archive.push({record,id}); return true }, formatDuration: String },
    NeuroFrontI18n: { setText(el, value) { el.textContent = value }, setMessage(el, key, details) {
      el.textContent = key; el.values = details
    } } }
  const ctx = vm.createContext({ document, window, state, Date:{now:()=>wall}, MEASUREMENT_MS:15000, SAMPLE_INTERVAL:50, performance:{ now:() => now },
    isDeviceConnected:() => connected, refs:{ measurementDialog:{ open:false } }, hasFreshBluetoothSignal:() => true,
    updateControlsAvailability() {}, estimateWindowScore(values, reference) {
      calls.push({ length:values.length, ref:reference.peakToPeak })
      return calls.length % 2 === 0 ? 70 : 30
    } })
  vm.runInContext(source, ctx)
  const el = id => controls.get(id), api = window.NeuroFrontAdaptive
  function start(minutes = 5) {
    el("modeSelect").value = minutes ? "adaptive-" + minutes : "adaptive"; el("modeSelect").change()
    el("adaptiveStart").click()
    return now
  }
  function at(time, value) {
    now = time
    if (value === undefined) api.tick(now)
    else { state.lastIncomingTime = now; api.sample(value, now, String(value)) }
  }
  return { start, at, el, api, state, calls, archive, document, events,
    sleep(){wall += 300000}, switchUser(){owner = "other"}, disconnect(){connected = false} }
}
test("10-minute estimate averages forty original-model calls and retains at most one 300-slot window", () => {
  const f = fixture(); const start = f.start(10)
  f.el("adaptiveStart").click()
  for (let i=0; i<12000; i++) {
    const t=start+50*i+1
    f.at(t,Math.sin(i)); f.at(t,Math.sin(i+.1)); f.at(t+1,Math.sin(i+.2))
  }
  f.at(start+600000)
  assert.equal(f.api.busy(),false)
  assert.equal(f.calls.length,40)
  assert.ok(f.calls.every(call => call.length===300 && call.ref===4))
  assert.equal(f.el("adaptiveStatus").values.score,50)
  assert.equal(f.el("adaptiveTime").textContent,"10:00")
  assert.equal(f.archive.length,1)
  assert.equal(f.archive[0].record.end,"timer")
  assert.equal(f.archive[0].record.durationMs,600000)
  assert.equal(f.archive[0].record.type,"adaptive")
})
test("sparse, flat, stale, stopped, and account-switched inputs never yield an estimate", () => {
  for (const kind of ["sparse","flat","stale","sleep","stop","owner","reset","disconnect","hidden","malformed"]) {
    const f=fixture(), start=f.start()
    if (kind==="sparse" || kind==="flat") {
      const stride=kind==="sparse"?200:50
      for(let t=0;t<15000;t+=stride) f.at(start+t,kind==="flat"?1:Math.sin(t))
      f.at(start+15000)
    } else if(kind==="stale") f.at(start+1001)
    else if(kind==="sleep"){f.sleep(); f.at(start+5,1)}
    else if(kind==="stop") f.el("adaptiveStop").click()
    else if(kind==="owner"){f.switchUser();f.at(start+100)}
    else if(kind==="reset")f.api.reset()
    else if(kind==="disconnect"){f.disconnect();f.at(start+100)}
    else if(kind==="hidden"){f.document.hidden=true;f.events.get("visibilitychange")()}
    else f.api.sample(1,start+10,"1broken")
    assert.equal(f.api.busy(),false,kind)
    assert.notEqual(f.el("adaptiveStatus").textContent,"dash.completed",kind)
    assert.ok(f.el("adaptiveCoverage").hidden,kind)
    assert.equal(f.calls.length,0,kind)
    assert.equal(f.archive.length,0,kind)
  }
})
test("mode selection, signal or missing calibration never auto-start a run", () => {
  const f=fixture()
  f.state.baseline.ready=false;f.start();assert.equal(f.api.busy(),false)
  f.state.baseline.ready=true;f.at(2040,1);assert.equal(f.api.busy(),false)
  f.at(6000);f.el("adaptiveStart").click();assert.equal(f.api.busy(),false)
})
test("unlimited runs beyond ten minutes and saves elapsed separately from counted windows on Stop", () => {
  const f=fixture(), start=f.start(0)
  const duration=617231
  for (let i=0; i<Math.ceil(duration/50); i++) f.at(start+50*i,Math.sin(i))
  f.at(start+duration)
  assert.equal(f.api.busy(),true)
  assert.equal(f.archive.length,0)
  f.el("adaptiveStop").click()
  assert.equal(f.api.busy(),false)
  const {record,id}=f.archive[0]
  assert.equal(id,"test-owner")
  assert.deepEqual(JSON.parse(JSON.stringify(record)),{type:"adaptive",completedAt:1234567890000,durationMs:duration,presetMs:0,end:"manual",count:41,score:50})
  assert.equal(f.el("adaptiveTime").textContent,"10:17")
})
test("manual early stop is never labeled a finished timed cycle; stale stop never archives", () => {
  for (const stale of [false,true]) {
    const f=fixture(), start=f.start(5)
    for (let t=0;t<15000;t+=50) f.at(start+t,Math.sin(t))
    f.at(start+15010,3)
    if (stale) f.sleep()
    f.el("adaptiveStop").click()
    assert.equal(f.api.busy(),false)
    if (stale) assert.equal(f.archive.length,0)
    else {
      assert.equal(f.archive[0].record.end,"manual")
      assert.equal(f.archive[0].record.presetMs,300000)
      assert.equal(f.archive[0].record.durationMs,15010)
    }
  }
})
