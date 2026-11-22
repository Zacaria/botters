import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { runtime, client, ORIGIN } from './helpers/cloudflare.js'
import { runGame } from '../cloudflare/http.js'
const digest=s=>createHash('sha256').update(s).digest('hex')
async function account(mf,mail,name) {
  const c=client(mf),signup=await c.signUp(name); assert.equal(signup.status,200)
  const message=mail.find(m=>m.to===signup.email || m.to?.[0]===signup.email || m.to?.[0]?.email===signup.email)
  const verify=new URL(message.text.match(/http:\/\/[^\s]+/)[0]); await c.call('GET',verify.pathname+verify.search)
  const session=(await c.call('POST','/session',{})).body; await c.call('POST','/exchange',{ticket:session.liveTicket})
  return {c,session,signup}
}
async function socket(mf,c,token) {
  const r=await mf.dispatchFetch(ORIGIN+`/socket?token=${token}`,{headers:{upgrade:'websocket',origin:ORIGIN,cookie:[...c.cookies].map(([k,v])=>`${k}=${v}`).join('; ')}})
  assert.equal(r.status,101);r.webSocket.accept();return r.webSocket
}
const closed=ws=>new Promise((resolve,reject)=>{ws.addEventListener('close',e=>resolve(e.code),{once:true});setTimeout(()=>reject(new Error('Socket remained open past 2s')),1950).unref()})
const frame=ws=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('No frame')),3000);timer.unref()
  ws.addEventListener('message',e=>{clearTimeout(timer);resolve(e.data)},{once:true})
  ws.addEventListener('close',e=>{clearTimeout(timer);reject(new Error(`Socket closed before frame: ${e.code}`))},{once:true})
})

test('workerd: reconnect/eviction, sign-out <2s, password reset revokes agent, deletion cleans account', {timeout:60000},async t=>{
  const {mf,db,mail}=await runtime();t.after(()=>mf.dispose())
  const {c,session:s,signup}=await account(mf,mail,'Reset')
  const pair=(await c.call('POST','/agent/pair',{})).body
  await c.call('POST',`/agent/approve?token=${s.humanToken}`,{id:pair.id})
  await c.call('POST',`/play?token=${s.humanToken}`,{vs:'easy',withAgent:true,planning:10,minutes:3,planets:16})
  const next=(await c.call('GET',`/next?token=${pair.agentToken}`)).body
  const ws=await socket(mf,c,s.humanToken); await frame(ws); const f={matchId:next.match.id}
  ws.close()
  const reconnected=await socket(mf,c,s.humanToken),f2=await frame(reconnected)
  assert.ok(new Uint8Array(f2)[0] & 1)
  const ns=await mf.getDurableObjectNamespace('MATCHES'),id=ns.idFromName(f.matchId).toString()
  reconnected.close();await new Promise(r=>setTimeout(r,150))
  await mf.unsafeEvictDurableObject('botters-local','MatchRoom',{id})
  const after=(await c.call('GET',`/state?token=${s.humanToken}`)).body
  assert.equal(after.matchId,f.matchId)
  const revoked=await socket(mf,c,s.humanToken);await frame(revoked)
  const closePromise=closed(revoked),started=performance.now()
  assert.equal((await c.call('POST','/api/auth/sign-out',{})).status,200)
  assert.equal(await closePromise,4401)
  const revokeMs=performance.now()-started;assert.ok(revokeMs<2000)
  assert.equal((await c.call('POST',`/input?token=${s.humanToken}`,{gambits:[{if:'always',then:'hold'}]})).status,401)
  // Consent explicitly survives ordinary sign-out, unlike password reset.
  assert.equal((await c.call('POST',`/input?token=${pair.agentToken}`,{gambits:[{if:'always',then:'hold'}],why:'authorized agent'})).status,200)
  assert.equal((await c.call('POST','/api/auth/request-password-reset',{email:signup.email,redirectTo:ORIGIN})).status,200)
  const resetMail=mail.find(m=>m.subject==='Reset your Botters password')
  const link=new URL(resetMail.text.match(/http:\/\/[^\s]+/)[0])
  const token=link.pathname.split('/').at(-1)
  assert.equal((await c.call('POST','/api/auth/reset-password',{token,newPassword:'Changed-local-password-98765'})).status,200)
  assert.equal((await c.call('POST',`/input?token=${pair.agentToken}`,{gambits:[{if:'always',then:'hold'}]})).status,401)
  assert.equal((await c.call('POST','/api/auth/sign-in/email',{email:signup.email,password:'Changed-local-password-98765'})).status,200)
  const fresh=(await c.call('POST','/session',{})).body;await c.call('POST','/exchange',{ticket:fresh.liveTicket})
  const captured=(await c.call('GET','/account')).body.user
  const oldAuth=await db.prepare('SELECT id,"expiresAt" FROM "session" WHERE "userId"=?').bind(captured.id).first()
  assert.equal((await c.call('POST','/api/auth/delete-user',{password:'Changed-local-password-98765'})).status,200)
  assert.equal((await c.call('GET','/account')).body.user,null)
  assert.equal((await c.call('GET',`/state?token=${fresh.humanToken}`)).status,401)
  await assert.rejects(runGame({DB:db,SITE_URL:ORIGIN},'POST','/session',new URLSearchParams(),{}, {...captured,authSessionId:oldAuth.id,authExpires:+new Date(oldAuth.expiresAt)}), e=>e.status===503)
  assert.equal((await db.prepare('SELECT value FROM game_records WHERE key=?').bind(`session:${s.sessionId}`).first()),null)
  console.log(JSON.stringify({proof:'local-revocation',signOutSocketCloseMs:revokeMs,matchRestoredAfterEviction:true,agentMatchId:next.match.id}))
})

test('workerd: D1 ISO session expiry closes a socket without another HTTP request', {timeout:20000},async t=>{
  const {mf,db,mail}=await runtime();t.after(()=>mf.dispose())
  const {c,session:s}=await account(mf,mail,'Revoke')
  await c.call('POST',`/play?token=${s.humanToken}`,{vs:'easy',withAgent:false,planning:10,minutes:3,planets:16})
  const ws=await socket(mf,c,s.humanToken);await frame(ws)
  const closure=closed(ws)
  await db.prepare('UPDATE "session" SET "expiresAt"=?').bind(new Date(Date.now()-1000).toISOString()).run()
  assert.equal(await closure,4401)
})

test('workerd: real D1 authority failure denies new inputs and closes existing socket <2s', {timeout:30000},async t=>{
  const {mf,db,mail}=await runtime();t.after(()=>mf.dispose())
  const {c,session:s}=await account(mf,mail,'Revoke')
  await c.call('POST',`/play?token=${s.humanToken}`,{vs:'easy',withAgent:false,planning:10,minutes:3,planets:16})
  const ws=await socket(mf,c,s.humanToken);await frame(ws)
  const closure=closed(ws),start=performance.now()
  await db.prepare('ALTER TABLE "session" RENAME TO unavailable_auth_session').run()
  assert.equal((await c.call('POST',`/input?token=${s.humanToken}`,{gambits:[{if:'always',then:'hold'}]})).status,503)
  assert.equal(await closure,4401)
  const ms=performance.now()-start;assert.ok(ms<2000)
  await db.prepare('ALTER TABLE unavailable_auth_session RENAME TO "session"').run()
  console.log(JSON.stringify({proof:'local-primary-failure',socketCloseMs:ms}))
})
