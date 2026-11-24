"use strict"
const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const { test } = require("node:test")
const source = fs.readFileSync(__dirname + "/adaptive-history.js", "utf8")
const prefix = "neurofront.adaptiveHistory.v1."
const example = {type:"adaptive", completedAt:1700000000000, durationMs:19000, presetMs:0, end:"manual", count:1, score:53}
function fixture(storage = new Map(), id = null, resolved = true, adaptiveSync) {
  const elements = new Map(), events = new Map(), windowEvents = new Map()
  const node = () => ({
    children:[], open:false, hidden:false, textContent:"",
    classList:{toggle() {}}, setAttribute() {}, before(...children) { this.controls = children }, after(...children) { this.controls = children }, addEventListener(name,fn) { this[name] = fn }, append(...children) { this.children.push(...children) },
    replaceChildren(...children) { this.children = children }
  })
  const document = {
    documentElement:{lang:"en"}, createElement: node, createTextNode: value=>value, addEventListener(name, fn) { events.set(name, fn) },
    getElementById(id) { if (!elements.has(id)) elements.set(id,node()); return elements.get(id) }
  }
  const window = { addEventListener(name,fn){windowEvents.set(name,fn)}, NEUROFRONT_TRANSLATIONS:{en:{"dash.adaptiveEntryElapsed":"{duration} elapsed","dash.customPreset":"Custom · {minutes} min","dash.unlimited":"Unlimited"}},
    NeuroFrontAccount:{owner:()=>id,sessionResolved:()=>resolved,adaptiveSync} }
  let failWrite = false
  const localStorage = {get length(){return storage.size}, key:i=>[...storage.keys()][i], removeItem:key=>storage.delete(key), getItem:key=>storage.get(key), setItem:(key,value)=>{ if(failWrite) throw Error("quota"); storage.set(key,value) }}
  vm.runInNewContext(source, {document,window,AbortController,localStorage,crypto:require("node:crypto"),confirm:()=>true})
  return { archive:window.NeuroFrontAdaptiveHistory, list:elements.get("adaptiveArchiveList"), ui:elements,
    session(next, ready = true) { id = next; resolved = ready; events.get("neurofront:accountreset")() },
    async online() { windowEvents.get("online")(); await new Promise(r=>setImmediate(r)) },
    opt(value) { const choice = elements.get("adaptiveArchiveTitle").controls[0].children[0].children[0].children[0]; choice.checked=value; choice.change() },
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


test("future-only opt-in uses owner durable outbox, retries same id, and ignores guest and old rows", async () => {
  const storage = new Map(), calls = [], table = new Map()
  let down = true
  const f = fixture(storage,"owner-a",true,async (op,p,id) => {
    calls.push([op,p,id])
    if (down) throw Error("offline")
    if (op === "list") return [...table.values()].filter(row=>row.owner===id)
    if (op === "save") table.set(id+p.p_id,{owner:id,id:p.p_id,completed_at_ms:p.p_completed_at_ms,duration_ms:p.p_duration_ms,preset_ms:p.p_preset_ms,ended:p.p_ended,window_count:p.p_window_count,score:p.p_score,custom:p.p_custom})
    if (op === "remove") table.delete(id+p.p_id)
  })
  await f.online()
  f.archive.save(example,"owner-a")
  f.opt(true)
  f.archive.save({...example,samples:[1,2,3],completedAt:example.completedAt+1},"owner-a")
  await f.online()
  const queued = [...storage.keys()].filter(k=>k.includes("outbox"))
  assert.equal(queued.length,1)
  f.session("owner-b"); await f.online()
  assert.equal(f.list.children.length,0)
  assert.equal(calls.some(([op,,owner])=>op==="save"&&owner==="owner-b"),false)
  down=false
  f.session("owner-a"); await f.online()
  const saves=calls.filter(([op])=>op==="save")
  assert.ok(saves.length>=2)
  assert.ok(saves.every(([,p,o])=>o==="owner-a" && p.p_id===saves[0][1].p_id && !Object.hasOwn(p,"samples")))
  assert.equal(f.list.children.length,2)
  assert.equal(table.size,1)
  f.list.children[0].children.at(-1).click()
  await f.online()
  assert.equal(table.size,0)
  assert.equal(f.list.children.length,1)
  f.session(null); f.archive.save(example,null); await f.online()
  assert.equal(table.size,0)
})
