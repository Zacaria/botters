import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OnlineGame } from '../online/game.js'
import { MemoryStore } from '../online/store.js'
import { runGame } from '../cloudflare/http.js'
import { D1Store } from '../cloudflare/d1-store.js'
import { runtime, client } from './helpers/cloudflare.js'

test('match cache invalidates after another owner changes a committed same-tick input', async()=>{
  const store=new MemoryStore(),handles=new Map()
  const cached=new OnlineGame(store,{handles}),fresh=new OnlineGame(store)
  const s=await cached.request('POST','/session')
  const q=new URLSearchParams({token:s.humanToken})
  await cached.request('POST','/play',q,{withAgent:false,vs:'easy',minutes:3,planning:10})
  await cached.request('GET','/state',q)
  await fresh.request('POST','/input',q,{gambits:[{if:'always',then:'hold'}]})
  const state=await cached.request('GET','/state',q)
  assert.deepEqual(state.view.gambits,[{if:'always',then:'hold',on:true}])
  for(const h of handles.values())h.free()
})

test('real D1: lost match-end acknowledgement cannot duplicate result/history/Elo', {timeout:40000},async t=>{
  const {mf,db,mail}=await runtime();t.after(()=>mf.dispose())
  const players=[]
  for(const name of ['Alice','Bob']){
    const c=client(mf);await c.signUp(name)
    const v=new URL(mail.at(-1).text.match(/http:\/\/[^\s]+/)[0]);await c.call('GET',v.pathname+v.search)
    const s=(await c.call('POST','/session',{})).body;await c.call('POST','/exchange',{ticket:s.liveTicket});players.push({c,s})
  }
  const [a,b]=players,room=(await a.c.call('POST',`/rooms?token=${a.s.humanToken}`,{withAgent:false,minutes:3,planning:10,planets:16})).body
  await b.c.call('POST',`/rooms/join?token=${b.s.humanToken}`,{code:room.code})
  await a.c.call('POST',`/rooms/start?token=${a.s.humanToken}`,{})
  const state=(await a.c.call('GET',`/state?token=${a.s.humanToken}`)).body
  // Fault fixture only: advance the durable clock boundary past a natural finish.
  await db.prepare("UPDATE game_records SET value=json_set(value,'$.startsAt',?) WHERE key=?").bind(Date.now()-200000,`match:${state.matchId}`).run()
  let lost=false
  class LostAck extends D1Store {
    async commit(entries){const ok=await super.commit(entries);if(ok&&!lost&&entries.some(e=>e.key===`match:${state.matchId}`&&e.value&&JSON.parse(e.value).report)){lost=true;throw new Error('Injected lost D1 acknowledgement')}return ok}
  }
  const env={DB:db,SITE_URL:'http://localhost:8787'},cache=new Map()
  await assert.rejects(runGame(env,'INTERNAL','/tick',new URLSearchParams(),{id:state.matchId},null,new LostAck(db),cache),/lost D1 acknowledgement/)
  assert.equal(lost,true)
  assert.equal(cache.size,0,'uncertain acknowledgement discards speculative WASM handles')
  const frames=await runGame(env,'INTERNAL','/tick',new URLSearchParams(),{id:state.matchId},null,undefined,cache)
  assert.ok(frames[0].view.ended)
  assert.ok(cache.size>0,'confirmed DO state is retained for the next frame')
  const ratings=await db.prepare("SELECT value FROM game_records WHERE key LIKE 'verified:elo:%'").all()
  assert.deepEqual(ratings.results.map(r=>JSON.parse(r.value).games),[1,1])
  assert.equal((await a.c.call('GET',`/lobby?token=${a.s.humanToken}`)).body.history.length,1)
  assert.equal((await b.c.call('GET',`/lobby?token=${b.s.humanToken}`)).body.history.length,1)
  for(const h of cache.values())h.free()
})
