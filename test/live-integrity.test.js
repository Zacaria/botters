import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { LiveRuntime } from '../online/live-runtime.js'
import { LiveStore } from '../online/live-store.js'
import { MemoryStore } from '../online/store.js'
const q = token => new URLSearchParams({ token })
const keyFor = token => `token:${createHash('sha256').update(token).digest('hex')}`

test('durable revocation, owner deletion, expiry and disconnected authorization fail closed', async t => {
  const store = new LiveStore(), runtime = new LiveRuntime(store); t.after(() => runtime.close())
  const a = await runtime.request('POST', '/session', undefined, { name: 'auth' })
  await runtime.request('POST', '/play', q(a.humanToken), { minutes: 3, planning: 10 })
  const matchId = (await runtime.request('GET', '/state', q(a.humanToken))).matchId
  const key = keyFor(a.humanToken), token = store.raw(key), sessionKey = `session:${JSON.parse(token).id}`, session = store.raw(sessionKey)
  let update, connected = true, closed = 0
  runtime.options.authority = async (_, adopt) => {
    update = adopt; await adopt({ token, session, expiresAt: Date.now() + 600000 })
    return { checkedAt: Date.now(), expiresAt: Date.now() + 600000, connected: () => connected, close: async () => { closed++ } }
  }
  await runtime.authorize(a.humanToken)
  assert.ok(store.data.get(sessionKey).expires > 0 && store.data.get(sessionKey).expires <= Date.now() + 600000, 'Imported sessions must not become immortal process cache entries')
  assert.equal(runtime.canFrame(a.humanToken, matchId, 0), true)
  let release
  const blocker = runtime.serialize(() => new Promise(resolve => { release = resolve }))
  const queued = runtime.request('POST', '/profile', q(a.humanToken), { name: 'must not apply' })
  await new Promise(resolve => setImmediate(resolve))
  connected = false
  assert.equal(runtime.canFrame(a.humanToken, matchId, 0), false, 'Stop frames immediately, not at the next tick')
  release(); await blocker
  await assert.rejects(queued, e => e.status === 503)
  assert.equal(JSON.parse(store.raw(sessionKey)).name, 'auth')
  await assert.rejects(runtime.authorize(a.humanToken), e => e.status === 503)
  connected = true
  await update({ token, session: null, expiresAt: Date.now() + 600000 })
  await assert.rejects(runtime.authorize(a.humanToken), e => e.status === 401)
  assert.equal(closed, 1); assert.equal(runtime.authorities.size, 0)
  assert.equal(store.raw(key), null)
  runtime.options.authority = async (_, adopt) => {
    await adopt({ token: JSON.stringify({ ...JSON.parse(token), expires: Date.now() - 1 }), session, expiresAt: Date.now() - 1 })
    return { checkedAt: Date.now(), expiresAt: Date.now() - 1, connected: () => true, close: async () => { closed++ } }
  }
  await assert.rejects(runtime.authorize(a.humanToken), e => e.status === 401)
  assert.equal(runtime.authorities.size, 0)
})

test('a committed result with a lost response is recovered without double Elo or history', async t => {
  let now = Date.now(), lose = false
  const durable = new MemoryStore(() => now)
  const store = new LiveStore({ get: k => durable.get(k), read: keys => Promise.resolve(keys.map(k => durable.raw(k))),
    commit: async entries => { const ok = await durable.commit(entries); if (lose) { lose = false; throw new Error('lost response') } return ok },
  }, { now: () => now })
  const runtime = new LiveRuntime(store, { now: () => now }); t.after(() => runtime.close())
  const a = await runtime.request('POST', '/session', undefined, { name: 'recover' })
  await runtime.request('POST', '/play', q(a.humanToken), { minutes: 3, planning: 10 })
  now += 200000; lose = true
  await assert.rejects(runtime.request('GET', '/state', q(a.humanToken)), /lost response/)
  const savedRatings = [...durable.data].filter(([k]) => k.startsWith('elo:')).map(([k, v]) => [k, v.value])
  const frame = await runtime.request('GET', '/state', q(a.humanToken))
  assert.ok(frame.report)
  assert.deepEqual([...durable.data].filter(([k]) => k.startsWith('elo:')).map(([k, v]) => [k, v.value]), savedRatings)
  const s = JSON.parse(durable.raw(`session:${JSON.parse(store.raw(keyFor(a.humanToken))).id}`))
  assert.equal(s.history.length, 1)
})

test('finishing an old match and starting another atomically records both boundaries', async t => {
  let now = Date.now()
  const durable = new MemoryStore(() => now)
  const store = new LiveStore({ get: k => durable.get(k), read: keys => Promise.resolve(keys.map(k => durable.raw(k))), commit: entries => durable.commit(entries) }, { now: () => now })
  const runtime = new LiveRuntime(store, { now: () => now }); t.after(() => runtime.close())
  const a = await runtime.request('POST', '/session', undefined, { name: 'boundaries' })
  await runtime.request('POST', '/play', q(a.humanToken), { minutes: 3, planning: 10 })
  const old = (await runtime.request('GET', '/state', q(a.humanToken))).matchId
  now += 200000
  await runtime.request('POST', '/play', q(a.humanToken), { minutes: 3, planning: 10 })
  const next = (await runtime.request('GET', '/state', q(a.humanToken))).matchId
  assert.notEqual(next, old)
  assert.ok(JSON.parse(durable.raw(`result:${old}`)).report)
  assert.equal(JSON.parse(durable.raw(`live:${next}`)).id, next)
})
