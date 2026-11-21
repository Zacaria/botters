import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OnlineGame } from '../online/game.js'
import { MemoryStore } from '../online/store.js'
import { runGame } from '../cloudflare/http.js'
import { D1Store } from '../cloudflare/d1-store.js'
import { runtime, client } from './helpers/cloudflare.js'

test('match cache invalidates after another owner changes a committed same-tick input', async()=>{
  const store=new MemoryStore(),stateCache=new Map()
  const cached=new OnlineGame(store,{stateCache}),fresh=new OnlineGame(store)
  const s=await cached.request('POST','/session')
  const q=new URLSearchParams({token:s.humanToken})
  await cached.request('POST','/play',q,{withAgent:false,vs:'easy',minutes:3,planning:10})
  await cached.request('GET','/state',q)
  assert.equal(stateCache.size,1)
  await fresh.request('POST','/input',q,{gambits:[{if:'always',then:'hold'}]})
  const state=await cached.request('GET','/state',q)
  assert.deepEqual(state.view.gambits,[{if:'always',then:'hold',on:true}])
})

test('real D1: lost match-end acknowledgement cannot duplicate result/history/Elo', {timeout:40000},async t=>{
  const {mf,db,mail}=await runtime();t.after(()=>mf.dispose())
  const players=[]
  for(const name of ['Alice','Bob']){
    const c=client(mf);await c.signUp(name)
    const v=new URL(mail.at(-1).text.match(/http:\/\/[^\s]+/)[0]);await c.call('GET',v.pathname+v.search)
    const s=(await c.call('POST','/session',{})).body;await c.call('POST','/exchange',{ticket:s.liveTicket});players.push({c,s,user:(await c.call('GET','/account')).body.user})
  }
  // Set up via the same game/D1 path without gameHTTP's match alarm: otherwise
  // the live DO can finish the backdated match before the injected commit runs.
  const env={DB:db,SITE_URL:'http://localhost:8787'},cache=new Map()
  const game=(player,method,path,data={})=>runGame(env,method,path,new URLSearchParams({token:player.s.humanToken}),data,player.user)
  const [a,b]=players,room=await game(a,'POST','/rooms',{withAgent:false,minutes:3,planning:10,planets:16})
  await game(b,'POST','/rooms/join',{code:room.code})
  await game(a,'POST','/rooms/start')
  const state=await game(a,'GET','/state')
  // Exercise the human-only end path directly; natural finishes now require
  // multiple bounded catch-up batches rather than a single /tick.
  let lost=false
  class LostAck extends D1Store {
    async commit(entries){const ok=await super.commit(entries);if(ok&&!lost&&entries.some(e=>e.key===`match:${state.matchId}`&&e.value&&JSON.parse(e.value).report)){lost=true;throw new Error('Injected lost D1 acknowledgement')}return ok}
  }
  await assert.rejects(runGame(env,'POST','/surrender',new URLSearchParams({token:a.s.humanToken}),{matchId:state.matchId},a.user,new LostAck(db),cache),/lost D1 acknowledgement/)
  assert.equal(lost,true)
  assert.equal(cache.size,0,'uncertain acknowledgement does not publish speculative state')
  await assert.rejects(runGame(env,'POST','/surrender',new URLSearchParams({token:a.s.humanToken}),{matchId:state.matchId},a.user,undefined,cache),/Match is over/)
  const frame=await runGame(env,'INTERNAL','/tick',new URLSearchParams(),{id:state.matchId},null,undefined,cache)
  assert.ok(frame.frames[0].result)
  assert.ok(cache.size>0,'confirmed state is retained for the next frame')
  const ratings=await db.prepare("SELECT value FROM game_records WHERE key LIKE 'verified:elo:%'").all()
  assert.deepEqual(ratings.results.map(r=>JSON.parse(r.value).games),[1,1])
  assert.equal((await a.c.call('GET',`/lobby?token=${a.s.humanToken}`)).body.history.length,1)
  assert.equal((await b.c.call('GET',`/lobby?token=${b.s.humanToken}`)).body.history.length,1)
})
