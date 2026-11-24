const assert=require('node:assert/strict');
const fs=require('node:fs'), http=require('node:http'), {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const src=fs.readFileSync('adaptive-history.js');
const dom='<html lang="en"><body><details open id="adaptiveArchive"><summary>Adaptive sessions</summary><p id="adaptiveArchiveEmpty"></p><p id="adaptiveArchiveStatus"></p><ol id="adaptiveArchiveList"></ol></details><script src="/adaptive.js"></script></body></html>';
const valid={type:'adaptive',completedAt:1700000000000,durationMs:18000,presetMs:0,end:'manual',count:1,score:51,samples:[900]};
const record=(i)=>({id:'99999999-9999-4999-8999-'+String(i).padStart(12,'0'),completed_at_ms:1700000000000-i,duration_ms:18000,preset_ms:0,ended:'manual',window_count:1,score:40,custom:false});
;(async()=>{
const service=http.createServer(async(req,res)=>{
 if(req.url==='/adaptive.js')return res.writeHead(200,{'Content-type':'application/javascript'}).end(src);
 return res.writeHead(200,{'Content-type':'text/html'}).end(dom)
}).listen(0,'127.0.0.1'); await new Promise(r=>service.once('listening',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined});
try {
const page=await browser.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message)); const calls=[], clear=new Map(), old=new Map(Array.from({length:52},(_,i)=>{let r=record(i);return[r.id,r]}));let failSave=true, failList=false;
await page.route('**/test-rpc/*',async route=>{
 const req=route.request(), p=req.postDataJSON(), op=req.url().split('/').at(-1), user=req.headers()['x-synthetic-owner'];
 calls.push({op,user,p});
 const data=user==='owner-a'?old:clear;
 if(op==='list'&&failList)return route.fulfill({status:503,json:{error:'Synthetic offline'}});
 if(op==='save'){
  if(failSave)return route.fulfill({status:503,json:{error:'Synthetic offline'}});
  if(!data.has(p.p_id))data.set(p.p_id,{id:p.p_id,completed_at_ms:p.p_completed_at_ms,duration_ms:p.p_duration_ms,preset_ms:p.p_preset_ms,ended:p.p_ended,window_count:p.p_window_count,score:p.p_score,custom:p.p_custom});
 } else if(op==='remove')data.delete(p.p_id);
 const rows=[...data.values()].sort((a,b)=>b.completed_at_ms-a.completed_at_ms || b.id.localeCompare(a.id));
 return route.fulfill({json:op==='list'?rows.filter(r=>!p.p_before_id || r.completed_at_ms<p.p_before_ms || (r.completed_at_ms===p.p_before_ms&&r.id<p.p_before_id)).slice(0,51):null})
});
await page.addInitScript(()=>{
 let owner=sessionStorage.getItem('test-owner') || 'owner-a';
 const setItem=Storage.prototype.setItem; Storage.prototype.setItem=function(k,v){if(window.failAdaptiveQueue&&k.includes('.outbox.'))throw new DOMException('synthetic quota','QuotaExceededError');return setItem.call(this,k,v)};
 window.switchSynthetic=(next)=>{owner=next;sessionStorage.setItem('test-owner',next);document.dispatchEvent(new Event('neurofront:accountreset'))};
 window.NEUROFRONT_TRANSLATIONS={en:{}};
 window.NeuroFrontAccount={owner:()=>owner,sessionResolved:()=>true,adaptiveSync:async(op,p,expected,signal)=>{
   if(owner!==expected)throw Error('scope'); const r=await fetch('/test-rpc/'+op,{method:'POST',signal,headers:{'Content-Type':'application/json','X-Synthetic-Owner':expected},body:JSON.stringify(p)});
   if(!r.ok)throw Error('Synthetic offline');return r.json()
 }};
});
await page.goto('http://127.0.0.1:'+service.address().port); const open=async()=>page.evaluate(()=>document.getElementById('adaptiveArchive').open=true);
await open(); const option=page.getByRole('checkbox',{name:'Sync new Adaptive summaries to this account'});
assert.equal(await option.isChecked(),false);
await page.evaluate(r=>window.NeuroFrontAdaptiveHistory.save(r,'owner-a'),valid);
assert.equal(calls.filter(e=>e.op==='save').length,0);
await option.check(); await page.getByText('Sync on for new summaries.').waitFor();
await page.evaluate(r=>window.NeuroFrontAdaptiveHistory.save({...r,completedAt:r.completedAt+1},'owner-a'),valid);
await page.getByText('Sync unavailable.',{exact:false}).waitFor();
const first=calls.find(c=>c.op==='save'); assert.ok(first); assert.deepEqual(Object.keys(first.p).sort(),['p_completed_at_ms','p_custom','p_duration_ms','p_ended','p_id','p_preset_ms','p_score','p_window_count'].sort());
await page.reload(); await open(); assert.equal(await option.isChecked(),true);
await page.getByText('Sync unavailable.',{exact:false}).waitFor();
await page.evaluate(()=>window.switchSynthetic('owner-b'));await open();assert.equal(await option.isChecked(),false);
assert.equal(await page.locator('#adaptiveArchiveList li').count(),0);
assert.equal(calls.some(c=>c.op==='save'&&c.user==='owner-b'),false);
failSave=false;
await page.evaluate(()=>window.switchSynthetic('owner-a'));await open();
await page.getByRole('button',{name:'Load older account summaries'}).click();
await page.waitForFunction(()=>document.querySelectorAll('#adaptiveArchiveList li').length===54);
assert.ok(calls.some(c=>c.op==='list'&&c.p.p_before_ms&&c.p.p_before_id));
assert.ok(calls.filter(c=>c.op==='save').every(c=>c.p.p_id===first.p.p_id));
page.once('dialog',d=>d.accept()); await page.getByRole('button',{name:'Delete Adaptive summary'}).last().click();
await page.waitForFunction(()=>document.querySelectorAll('#adaptiveArchiveList li').length===51);
assert.equal(old.size,52); assert.equal(calls.filter(c=>c.op==='remove').at(-1).user,'owner-a');
failSave=true;
await page.evaluate(r=>window.NeuroFrontAdaptiveHistory.save({...r,completedAt:r.completedAt+3},'owner-a'),valid);
await page.getByText('Sync unavailable.',{exact:false}).waitFor();
await option.uncheck();
const savesBefore=calls.filter(e=>e.op==='save').length;
failSave=false; await page.evaluate(()=>window.dispatchEvent(new Event('online')));
await page.getByText('Sync paused for new summaries.').waitFor();
assert.equal(calls.filter(e=>e.op==='save').length,savesBefore);
const synced=first.p.p_id;
old.delete(synced); await page.evaluate(()=>window.dispatchEvent(new Event('online')));
await page.waitForFunction(id=>!JSON.parse(localStorage.getItem('neurofront.adaptiveHistory.v1.owner.owner-a')||'[]').some(x=>x.id===id),synced);
failList=true; await page.reload(); await open(); await page.getByText('Sync unavailable.',{exact:false}).waitFor();
assert.equal(await page.evaluate(id=>JSON.parse(localStorage.getItem('neurofront.adaptiveHistory.v1.owner.owner-a')||'[]').some(x=>x.id===id),synced),false);
failList=false; await option.check(); await page.getByText('Sync on for new summaries.').waitFor();
await page.evaluate(()=>window.failAdaptiveQueue=true);
const existingSaves=calls.filter(c=>c.op==='save').length;
assert.equal(await page.evaluate(r=>window.NeuroFrontAdaptiveHistory.save({...r,completedAt:r.completedAt+5},'owner-a'),valid),true);
await page.getByText('Some summaries are only in this browser and will not sync automatically.',{exact:false}).waitFor();
assert.equal(calls.filter(c=>c.op==='save').length,existingSaves);
await page.reload(); await open();
await page.getByText('Some summaries are only in this browser and will not sync automatically.',{exact:false}).waitFor();
assert.deepEqual(errors,[]);console.log('PASS synthetic Chromium Adaptive consent, exact HTTP fields, persistent owner retry, isolation, keyset pagination, older deletion, opt-out cancellation, durable cross-device deletion, local-only fallback under quota, zero page errors');
} finally { await browser.close();service.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
