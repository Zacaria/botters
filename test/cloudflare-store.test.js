import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'

import { body } from '../cloudflare/http.js'
import { MemoryStore, transaction } from '../online/store.js'
const module = await import('../cloudflare/d1-store.js').catch(() => ({}))
test('explicit TTL on set replaces the TTL of an earlier read in the same transaction',async()=>{
  let now=0;const store=new MemoryStore(()=>now)
  await transaction(store,async tx=>{await tx.get('ticket');await tx.set('ticket',{used:true},60)})
  now=61000
  assert.equal(await store.get('ticket'),null)
})
test('Worker accepts an empty POST stream and bounds malformed/oversized bodies',async()=>{
  const request=()=>new Request('http://localhost/cancel',{method:'POST',headers:{'content-type':'application/json'},body:new ReadableStream({start(c){c.close()}}),duplex:'half'})
  assert.deepEqual(await body(request()),{})
  await assert.rejects(body(new Request('http://localhost/input',{method:'POST',headers:{'content-type':'application/json'},body:'{'})),e=>e.status===400)
  await assert.rejects(body(new Request('http://localhost/input',{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(16385)})),e=>e.status===413)
})
test('D1 CAS rejects stale multi-record writes atomically and concurrent double consumption', async t => {
  assert.equal(typeof module.D1Store, 'function', 'Cloudflare D1 adapter is required')
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: ['DB'] }))
  t.after(() => mf.dispose())
  const db = await mf.getD1Database('DB')
  await db.exec('CREATE TABLE game_records (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL DEFAULT 0); CREATE TABLE cas_guard (id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid = 1));')
  const store = new module.D1Store(db)
  assert.equal(await store.commit([{ key: 'ticket', raw: null, value: '{"used":false}', ttl: 60 }]), 1)
  const raw = await store.get('ticket')
  const consume = () => store.commit([{ key: 'ticket', raw, value: '{"used":true}', ttl: 60 }, { key: 'receipt', raw: null, value: '{"ok":true}', ttl: 60 }])
  assert.deepEqual((await Promise.all([consume(), consume()])).sort(), [0, 1])
  assert.equal(await store.commit([{ key: 'ticket', raw, value: '{"bad":true}', ttl: 60 }, { key: 'leak', raw: null, value: '1', ttl: 60 }]), 0)
  assert.equal(await store.get('leak'), null)
  assert.equal(await store.get('ticket'), '{"used":true}')
  const writes = store.writes
  assert.equal(await store.commit([{ key: 'ticket', raw: '{"used":true}', value: '', ttl: 60 }]), 1)
  assert.equal(store.writes, writes, 'read-only CAS must not spend D1 row writes')
  assert.equal((await db.prepare('SELECT count(*) AS n FROM cas_guard').first()).n, 0)
})
