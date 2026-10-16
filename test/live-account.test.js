import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { LiveRuntime } from '../online/live-runtime.js'
import { LiveStore } from '../online/live-store.js'
import { createLiveServer } from '../online/live-server.js'
import { liveCookieProof, liveCookieName } from '../online/live-cookie.js'
const hash = s => createHash('sha256').update(s).digest('hex')

test('account live HTTP, queued actions and frame admission require the bound cookie, never an asserted account ID', async t => {
  const store = new LiveStore(), runtime = new LiveRuntime(store, { requireAccount: true })
  t.after(() => runtime.close())
  const bearer = 'a'.repeat(32), proof = hash('b'.repeat(32)), id = 'owner', expires = Date.now() + 60000
  store.put('session:' + id, JSON.stringify({ id, accountId: 'verified', agentVersion: 1, name: 'Owner', history: [], match: 'match', side: 0 }))
  store.put('token:' + hash(bearer), JSON.stringify({ id, accountId: 'verified', role: 'human', expires, liveCookieHash: proof, authSessionId: 'real-session' }))
  await assert.rejects(runtime.authorize(bearer), { status: 401 })
  await assert.rejects(runtime.authorize(bearer, hash('c'.repeat(32))), { status: 401 })
  assert.equal((await runtime.authorize(bearer, proof)).session.id, id)
  assert.equal(runtime.canFrame(bearer, 'match', 0, proof), true)
  assert.equal(runtime.canFrame(bearer, 'match', 0), false)
  const q = new URLSearchParams({ token: bearer })
  await assert.rejects(runtime.request('GET', '/lobby', q, {}, null), { status: 401 })
  await assert.rejects(runtime.request('GET', '/leaderboard', q, {}, null), { status: 401 })
  let release
  const gate = runtime.serialize(() => new Promise(resolve => { release = resolve }))
  await new Promise(resolve => setImmediate(resolve))
  const request = runtime.request('POST', '/profile', q, { name: 'not allowed' }, proof)
  await new Promise(resolve => setImmediate(resolve))
  store.put('token:' + hash(bearer), null)
  release(); await gate
  await assert.rejects(request, { status: 401 })
  assert.equal(JSON.parse(store.raw('session:' + id)).name, 'Owner')
  assert.equal(runtime.canFrame(bearer, 'match', 0, proof), false)
})

test('production exchange sets a secure host-only cookie and rejects untrusted origins before consuming a ticket', async t => {
  let calls = 0
  const remote = { async exchange(ticketHash, proof) { calls++; assert.equal(ticketHash, hash('a'.repeat(32))); assert.match(proof, /^[a-f0-9]{64}$/); return { expiresAt: Date.now() + 60000 } } }
  const service = await createLiveServer({ remote, authority: () => { throw new Error('Not needed for exchange') }, requireAccount: true, origin: 'https://botters.example.test', origins: ['https://botters.example.test'] })
  t.after(() => service.close())
  const { port } = await service.listen(), url = `http://127.0.0.1:${port}/exchange`
  const post = (origin, cookie) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify({ ticket: 'a'.repeat(32) }) })
  assert.equal((await post('https://evil.example')).status, 403)
  assert.equal((await post()).status, 403); assert.equal(calls, 0)
  const r = await post('https://botters.example.test')
  assert.equal(r.status, 200); assert.equal(calls, 1)
  const cookie = r.headers.get('set-cookie')
  assert.match(cookie, /^__Host-botters-live=[\w-]{32}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800$/)
  assert.doesNotMatch(cookie, /Domain=/i)
  const pair = cookie.split(';')[0]
  const second = await post('https://botters.example.test', pair)
  assert.equal(second.headers.get('set-cookie').split(';')[0], pair, 'Opening a new tab preserves the live cookie binding of existing tabs')
  assert.match(liveCookieProof(pair), /^[a-f0-9]{64}$/)
  assert.equal(liveCookieProof(pair + '; ' + pair), null, 'Ambiguous duplicate cookies never become authority')
  assert.equal(liveCookieProof(`${liveCookieName}=short`), null)
})
