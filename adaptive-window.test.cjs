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
        getAttribute(key) { return this[key] }, setAttribute(key, value) { this[key] = value },
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
  function start(minutes = 5, custom) {
    el("modeSelect").value = "adaptive"; el("modeSelect").change()
    el("adaptiveDuration").value = custom !== undefined ? "custom" : minutes ? String(minutes) : "unlimited"
    if (custom !== undefined) el("adaptiveCustomMinutes").value = custom
    el("adaptiveDuration").change()
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
test("each rejected input has the right reason and yields no estimate or saved capture", () => {
  const cases = {
    sparse:"discardSparse", flat:"discardFlat", stale:"discardStale", sleep:"discardStale",
    stop:"discardTooShort", owner:"discardAccount", baseline:"discardBaseline", reset:"",
    disconnect:"discardDisconnected", reconnect:"discardReconnecting", hidden:"discardVisibility", malformed:"discardInvalid"
  }
  for (const [kind, expected] of Object.entries(cases)) {
    const f=fixture(), start=f.start()
    if (kind==="sparse" || kind==="flat") {
      const stride=kind==="sparse"?200:50
      for(let t=0;t<15000;t+=stride) f.at(start+t,kind==="flat"?1:Math.sin(t))
      f.at(start+15000)
    } else if(kind==="stale") f.at(start+1001)
    else if(kind==="sleep"){f.sleep(); f.at(start+5,1)}
    else if(kind==="stop") f.el("adaptiveStop").click()
    else if(kind==="owner"){f.switchUser();f.at(start+100)}
    else if(kind==="baseline"){f.state.baseline.createdAt="other";f.at(start+100)}
    else if(kind==="reset")f.api.reset()
    else if(kind==="disconnect"){f.disconnect();f.at(start+100)}
    else if(kind==="reconnect")f.api.cancel("discardReconnecting")
    else if(kind==="hidden"){f.document.hidden=true;f.events.get("visibilitychange")()}
    else f.api.sample(1,start+10,"1broken")
    assert.equal(f.api.busy(),false,kind)
    assert.equal(f.el("adaptiveStatus").textContent,expected ? "dash."+expected : "",kind)
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
test("custom duration strictly validates whole minutes from 1 to 60 and snapshots the chosen timer", () => {
  for (const raw of ["","0","61","1.1","1e1","1.0","-1","Infinity","NaN"]) {
    const f=fixture()
    f.start(0,raw)
    assert.equal(f.api.busy(),false,raw)
    assert.equal(f.el("adaptiveStart").disabled,true,raw)
    assert.equal(f.el("adaptiveCustomError").hidden,false,raw)
  }
  const bounded=fixture()
  bounded.start(0,"60")
  assert.equal(bounded.api.busy(),true)
  assert.equal(bounded.el("adaptiveCustomMinutes").disabled,true)
  assert.equal(bounded.el("adaptiveDuration").disabled,true)
  const f=fixture(),start=f.start(0,"1")
  f.el("adaptiveCustomMinutes").value="60"
  f.el("adaptiveCustomMinutes").input()
  assert.equal(f.el("adaptiveCustomMinutes").value,"1")
  f.el("adaptiveDuration").value="unlimited"
  f.el("adaptiveDuration").change()
  assert.equal(f.el("adaptiveDuration").value,"custom")
  for(let n=0;n<1200;n++) f.at(start+50*n,Math.sin(n))
  f.at(start+60000)
  assert.equal(f.api.busy(),false)
  assert.deepEqual(JSON.parse(JSON.stringify(f.archive[0].record)),{
    type:"adaptive", completedAt:1234567890000, durationMs:60000, presetMs:60000, end:"timer", count:4, score:50, custom:true
  })
})
test("account reset keeps an active interruption visible but clears the timer and personal settings", () => {
  const f=fixture(), start=f.start(0,"37")
  f.at(start+110,2)
  f.switchUser()
  f.api.reset("discardAccount")
  assert.equal(f.api.busy(),false)
  assert.equal(f.api.selected(),true)
  assert.equal(f.el("adaptivePanel").hidden,false)
  assert.equal(f.el("adaptiveStatus").textContent,"dash.discardAccount")
  assert.equal(f.el("adaptiveTime").textContent,"00:00")
  assert.equal(f.el("adaptiveDuration").value,"unlimited")
  assert.equal(f.el("adaptiveCustomMinutes").value,"15")
  assert.equal(f.archive.length,0)
  f.api.reset("discardAccount")
  assert.equal(f.api.selected(),false)
  assert.equal(f.el("adaptiveStatus").textContent,"")
})
test("every actionable discard explanation is localized in all supported languages", () => {
  const locales=["en","hi","mr","bn","ta","te","kn","ml","gu","pa","or","as","ur"]
  const dictionaries=Object.fromEntries(locales.map(locale=>[locale,{}]))
  vm.runInNewContext(fs.readFileSync(__dirname+"/dashboard-language.js","utf8"),{window:{NEUROFRONT_TRANSLATIONS:dictionaries}})
  const keys=["discardDisconnected","discardReconnecting","discardStale","discardInvalid","discardSparse","discardFlat",
    "discardVisibility","discardTooShort","discardAccount","discardBaseline","adaptiveBaselineInvalid","discardGeneric"]
  for(const locale of locales) {
    for(const name of keys) {
      const key="dash."+name
      assert.ok(dictionaries[locale][key]?.length > 15,locale+" "+key)
      if(locale!=="en") assert.notEqual(dictionaries[locale][key],dictionaries.en[key],locale+" "+key)
    }
  }
})
