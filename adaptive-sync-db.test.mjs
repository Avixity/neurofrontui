import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite()
const u1='00000000-0000-4000-a000-000000000001',u2='00000000-0000-4000-a000-000000000002',rid='10000000-0000-4000-a000-000000000000'
await db.exec(`create role anon; create role authenticated; create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
insert into auth.users values ('${u1}'),('${u2}');`)
const migration = readFileSync(new URL('./accounts-adaptive-sync.sql',import.meta.url),'utf8')
await db.exec(migration); await db.exec(migration)
const query = (text,args=[])=>db.query(text,args)
const session = (role,u='') => db.exec(`reset role; set role ${role}; select set_config('request.jwt.claim.sub','${u}',false);`)
const save=(score=52)=>query("select public.nf_save_adaptive_summary($1,1700000000000,18000,0,'manual',1,$2,false)",[rid,score])
const list=async()=> (await query("select * from public.nf_list_adaptive_summaries()")).rows
const remove=()=>query("select public.nf_remove_adaptive_summary($1)",[rid])
await session('anon'); await assert.rejects(save); await assert.rejects(list); await assert.rejects(remove)
await session('authenticated',u1); await assert.rejects(query("select * from nf_adaptive_private.summaries")); await assert.rejects(()=>save(101)); await save(); await save(60); assert.equal((await list())[0].score,52)
await session('authenticated',u2); assert.equal((await list()).length,0); await save(31); assert.equal((await list())[0].score,31); await remove(); assert.equal((await list()).length,0); await save(30); assert.equal((await list()).length,0)
await session('authenticated',u1); assert.equal((await list())[0].score,52)
for (let i = 0; i < 53; i++) {
  const key = '20000000-0000-4000-a000-' + String(i).padStart(12,'0')
  await query("select public.nf_save_adaptive_summary($1,1700000000020,18000,0,'manual',1,54,false)",[key])
}
const first=await list()
assert.equal(first.length,51)
const tail=first[49], older=(await query("select * from public.nf_list_adaptive_summaries($1,$2)",[tail.completed_at_ms,tail.id])).rows
assert.equal(older.length,4)
assert.equal(new Set([...first.slice(0,50),...older].map(row=>row.id)).size,54)
await query("select public.nf_remove_adaptive_summary($1)",[older.at(-1).id])
assert.equal((await query("select * from public.nf_list_adaptive_summaries($1,$2)",[tail.completed_at_ms,tail.id])).rows.length,3)
await db.exec("reset role;"); const tomb=await query("select removed,score,completed_at_ms from nf_adaptive_private.summaries where owner_id=$1",[u2]); assert.deepEqual(tomb.rows,[{removed:true,score:null,completed_at_ms:null}])
await query("delete from auth.users where id=$1",[u2]); assert.equal((await query("select id from nf_adaptive_private.summaries where owner_id=$1",[u2])).rows.length,0)
console.log("PASS migration rerun, anonymous and direct table denial, type validation, two-owner isolation, idempotent write and deletion tombstone, account cascade, cursor tie-break and deletion on older page")
await db.close()
