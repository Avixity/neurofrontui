"use strict"
const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const { test } = require("node:test")
const source = fs.readFileSync(__dirname + "/adaptive-history.js", "utf8")
const prefix = "neurofront.adaptiveHistory.v1."
const example = {type:"adaptive", completedAt:1700000000000, durationMs:19000, presetMs:0, end:"manual", count:1, score:53}
function fixture(storage = new Map(), id = null, resolved = true) {
  const elements = new Map(), events = new Map()
  const node = () => ({
    children:[], open:false, hidden:false, textContent:"",
    setAttribute() {}, append(...children) { this.children.push(...children) },
    replaceChildren(...children) { this.children = children }
  })
  const document = {
    documentElement:{lang:"en"}, createElement: node, addEventListener(name, fn) { events.set(name, fn) },
    getElementById(id) { if (!elements.has(id)) elements.set(id,node()); return elements.get(id) }
  }
  const window = { addEventListener(){}, NEUROFRONT_TRANSLATIONS:{en:{"dash.adaptiveEntryElapsed":"{duration} elapsed","dash.customPreset":"Custom · {minutes} min","dash.unlimited":"Unlimited"}},
    NeuroFrontAccount:{owner:()=>id,sessionResolved:()=>resolved} }
  let failWrite = false
  vm.runInNewContext(source, {document,window,localStorage:{
    getItem:key=>storage.get(key),
    setItem:(key,value)=>{ if(failWrite) throw Error("quota"); storage.set(key,value) }
  }})
  return { archive:window.NeuroFrontAdaptiveHistory, list:elements.get("adaptiveArchiveList"), ui:elements,
    session(next, ready = true) { id = next; resolved = ready; events.get("neurofront:accountreset")() },
    fail() { failWrite = true }
  }
}
test("archive strips unexpected fields, validates typed metadata, and bounds storage to fifty entries", () => {
  const storage = new Map(), { archive, list } = fixture(storage)
  for(let i=0;i<61;i++) assert.equal(archive.save({...example, completedAt:example.completedAt+i,samples:[8],baseline:[9]},null),true)
  const rows = JSON.parse(storage.get(prefix+"guest"))
  assert.equal(rows.length,50)
  assert.equal(list.children.length,50)
  assert.deepEqual(rows[0], {...example,completedAt:example.completedAt+60})
  assert.equal(rows[49].completedAt,example.completedAt+11)
  for (const malformed of [
    {type:"standard"}, {durationMs:10000}, {count:2}, {end:"timer"}, {score:101}, {score:NaN},
    {presetMs:333}, {end:"timer",presetMs:300000,durationMs:295000,count:19},
    {end:"manual",presetMs:300000,durationMs:300000,count:20}
  ]) assert.equal(archive.save({...example,...malformed},null),false)
  assert.deepEqual(JSON.parse(storage.get(prefix+"guest")),rows)
})
test("session restoration, guest and different owners cannot see or save each other's archive", () => {
  const storage = new Map([[prefix+"guest",JSON.stringify([example])]])
  const f = fixture(storage,null,false)
  assert.equal(f.list.children.length,0)
  assert.equal(f.archive.save(example,null),false)
  f.session("owner-a")
  assert.equal(f.list.children.length,0)
  assert.equal(f.archive.save(example,null),false)
  assert.equal(f.archive.save(example,"owner-a"),true)
  assert.equal(f.list.children.length,1)
  f.ui.get("adaptiveArchive").open = true
  f.session("owner-b")
  assert.equal(f.ui.get("adaptiveArchive").open,false)
  assert.equal(f.list.children.length,0)
  assert.equal(f.archive.save(example,"owner-a"),false)
  f.session(null)
  assert.equal(f.list.children.length,1)
  const reload = fixture(storage,"owner-a")
  assert.equal(reload.list.children.length,1)
  assert.deepEqual(JSON.parse(storage.get(prefix+"guest")),[example])
  assert.deepEqual(JSON.parse(storage.get(prefix+"owner.owner-a")),[example])
  f.fail()
  assert.equal(f.archive.save({...example,score:60},null),false)
  assert.deepEqual(JSON.parse(storage.get(prefix+"guest")),[example])
})
test("custom rows are additive without relabeling or deleting previous archive entries", () => {
  const storage = new Map([[prefix+"guest",JSON.stringify([example])]])
  const {archive,list}=fixture(storage)
  for (const presetMs of [0, 59999, 60001, "60000", 3660000]) {
    assert.equal(archive.save({...example,presetMs,custom:true},null),false)
  }
  const custom={...example,presetMs:300000,custom:true}
  assert.equal(archive.save(custom,null),true)
  assert.deepEqual(JSON.parse(storage.get(prefix+"guest")),[custom,example])
  assert.match(list.children[0].children[1].children[1].textContent,/Custom.*5 min/)
  assert.match(list.children[1].children[1].children[1].textContent,/Unlimited/)
  const reloaded=fixture(storage)
  assert.equal(reloaded.list.children.length,2)
})
