import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runtime, client } from './helpers/cloudflare.js'
import { createBottersTools } from '../tools.js'

test('disabled preview is not exposed and tools are absent', async t=>{
  const {mf}=await runtime(); t.after(()=>mf.dispose())
  const c=client(mf)
  assert.equal((await c.call('GET','/rounds')).status,404)
  assert.notEqual((await c.call('GET','/live-config.json')).body.rounds,true)
  const server=await createBottersTools({server:'http://localhost:8787',fetchImpl:async()=>Response.json({})})
  assert.equal(Object.hasOwn(server._registeredTools,'wait_for_pause'),false)
  assert.equal(Object.hasOwn(server._registeredTools,'set_bot'),false)
})

test('enabled preview enforces account and agent roles', {timeout:120000}, async t=>{
  const {mf,mail}=await runtime({bindings:{ROUNDS_ENABLED:'1'},durableObjects:{MATCHES:{className:'MatchRoom',useSQLite:true},AGENTS:{className:'AgentGateway',useSQLite:true},ROUNDS:{className:'RoundsRoom',useSQLite:true}}}); t.after(()=>mf.dispose())
  const c=client(mf); await c.signUp('RoundsTester')
  const link=new URL(mail.at(-1).text.match(/http:\/\/[^\s]+/)[0]); await c.call('GET',link.pathname+link.search)
  const s=(await c.call('POST','/session',{})).body; await c.call('POST','/exchange',{ticket:s.liveTicket})
  const token=`?token=${s.humanToken}`
  assert.equal((await c.call('GET','/live-config.json')).body.rounds,true)
  assert.equal((await c.call('GET','/rounds'+token)).body.match,null)
  const start=await c.call('POST','/rounds/start'+token,{breed:'tank'}); assert.equal(start.status,200); assert.equal(start.body.match.bot.breed,'tank')
  const edit=await c.call('POST','/rounds/bot'+token,{round:1,breed:'runner',gambits:[{if:'always',then:'hold'}],why:'test'})
  assert.equal(edit.body.match.versions[0].who,'you')
  const pair=(await c.call('POST','/agent/pair',{setup:'test'})).body
  await c.call('POST',`/agent/approve${token}`,{id:pair.id})
  const agent=`?token=${pair.agentToken}`
  assert.equal((await c.call('GET','/rounds'+agent)).status,200)
  assert.equal((await c.call('POST','/rounds/ready'+agent,{round:1})).status,401)
  assert.equal((await c.call('POST','/rounds/start'+agent,{breed:'tank'})).status,401)
  assert.equal((await c.call('POST','/rounds/leave'+agent,{})).status,401)
  const changed=await c.call('POST','/rounds/bot'+agent,{round:1,gambits:[{if:'always',then:'hold'}],why:'agent edit'})
  assert.equal(changed.status,200); assert.equal(changed.body.match.versions.at(-1).who,'agent')
  assert.equal((await c.call('GET','/rounds?token=bad')).status,401)
  assert.equal((await c.call('POST','/rounds/leave'+token,{})).body.match,null)
})
