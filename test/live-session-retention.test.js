import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { OnlineGame } from '../online/game.js'
import { LiveRuntime } from '../online/live-runtime.js'
import { LiveStore } from '../online/live-store.js'
import { MemoryStore } from '../online/store.js'
const hash = s => createHash('sha256').update(s).digest('hex')
const keyFor = token => `token:${hash(token)}`
const q = token => new URLSearchParams({ token })
const proof = hash('b'.repeat(32))
const day = 86400000

// Synthetic authority transport, real account grants/game/runtime/durable CAS.
// Mock only Date so expiry ordering is deterministic without sleeping.
async function fixture(t) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const now = () => Date.now(), durable = new MemoryStore(now)
  const authority = async (key, adopt) => {
    const entry = { checkedAt: 0, expiresAt: 0, connected: () => true, close: async () => {} }
    entry.refresh = async () => {
      const token = durable.raw(key), grant = token && JSON.parse(token)
      entry.expiresAt = grant?.expires || Date.now()
      await adopt({ token, session: grant && durable.raw(`session:${grant.id}`), expiresAt: entry.expiresAt })
      entry.checkedAt = Date.now()
    }
    await entry.refresh(); return entry
  }
  const store = new LiveStore({ get: k => durable.get(k), read: keys => Promise.all(keys.map(k => durable.get(k))), commit: entries => durable.commit(entries) }, { now })
  const runtime = new LiveRuntime(store, { requireAccount: true, authority, now })
  t.after(() => runtime.close())
  const human = async (id, lifetime) => {
    const identity = { id, name: id, emailVerified: true, authSessionId: `${id}-${lifetime}`, authExpires: Date.now() + lifetime }
    const control = new OnlineGame(durable, { requireAccount: true, liveExchange: true, identity, now })
    const grant = await control.request('POST', '/session')
    const key = keyFor(grant.humanToken), row = durable.data.get(key)
    row.value = JSON.stringify({ ...JSON.parse(row.value), liveCookieHash: proof })
    return { ...grant, control }
  }
  const agent = async human => {
    const pair = await human.control.request('POST', '/agent/pair', undefined, { setup: 'independent-agent' })
    await human.control.request('POST', '/agent/approve', q(human.humanToken), { id: pair.id })
    return pair.agentToken
  }
  const request = (method, path, token, body) => runtime.request(method, path, q(token), body, proof)
  return { durable, store, runtime, human, agent, request }
}

test('human-last expiry preserves an independently approved agent, private match and longer human lease', async t => {
  const { store, runtime, human, agent, request } = await fixture(t)
  const short = await human('owner', 1500), long = await human('owner', 3600000), peer = await human('peer', 3600000)
  const bearer = await agent(long)
  const prefs = { minutes: 3, planning: 10, withAgent: true, opening: [{ if: 'always', then: 'hold', on: true }] }
  const room = await request('POST', '/rooms', short.humanToken, prefs)
  await request('POST', '/rooms/join', peer.humanToken, { code: room.code, withAgent: false })
  await request('POST', '/rooms/start', short.humanToken)
  const first = await request('GET', '/next', bearer)
  const sessionKey = `session:${short.sessionId}`, before = JSON.parse(store.raw(sessionKey))
  assert.ok(first.match?.id)
  await request('GET', '/room', long.humanToken)
  await runtime.authorities.get(keyFor(short.humanToken)).refresh() // Shortest human imports last.
  t.mock.timers.tick(1700)
  assert.equal(runtime.canFrame(short.humanToken, first.match.id, before.side, proof), false)
  await assert.rejects(request('GET', '/state', short.humanToken), { status: 401 })
  const continued = await request('GET', '/next', bearer) // First request, not a retry.
  assert.equal(continued.match?.id, first.match.id)
  assert.equal(runtime.canFrame(long.humanToken, first.match.id, before.side, proof), true)
  assert.equal(runtime.canFrame(bearer, first.match.id, before.side), false, 'Agents do not gain human WebSocket access')
  const after = JSON.parse(store.raw(sessionKey))
  for (const key of ['match', 'side', 'room', 'roomPrefs']) assert.deepEqual(after[key], before[key], key)
  const resumed = await request('GET', '/room', long.humanToken)
  assert.equal(resumed.code, room.code); assert.equal(resumed.players.length, 2)
  assert.equal(resumed.matchId, first.match.id)
  await assert.rejects(runtime.authorize(long.humanToken), { status: 401 }) // Retention cannot bypass cookie binding.

  const replacement = await agent(long)
  await runtime.authorities.get(keyFor(bearer)).refresh()
  await assert.rejects(request('GET', '/next', bearer), { status: 401 })
  assert.equal(runtime.canFrame(bearer, first.match.id, before.side), false)
  assert.equal((await request('GET', '/next', replacement)).match?.id, first.match.id)
})

test('shorter human expiry cannot discard a longer human-only match', async t => {
  const { runtime, human, request } = await fixture(t)
  const short = await human('owner', 1500), long = await human('owner', 3600000)
  await request('POST', '/play', long.humanToken, { minutes: 3, planning: 10, withAgent: false })
  const before = await request('GET', '/state', long.humanToken)
  await request('GET', '/state', short.humanToken)
  await runtime.authorities.get(keyFor(short.humanToken)).refresh() // Short snapshot arrives after game writes.
  t.mock.timers.tick(1700)
  const after = await request('GET', '/state', long.humanToken)
  assert.equal(after.matchId, before.matchId)
  assert.equal(after.me.withAgent, false)
  await assert.rejects(request('GET', '/state', short.humanToken), { status: 401 })
  assert.equal(runtime.canFrame(short.humanToken, before.matchId, 0, proof), false)
})

test('shared account cache is bounded after game writes without expiring durable account state', async t => {
  const { durable, store, runtime, human, request } = await fixture(t)
  const owner = await human('owner', 7 * day), sessionKey = `session:${owner.sessionId}`
  await request('POST', '/profile', owner.humanToken, { doctrine: 'Hold the home planet.' })
  assert.equal(store.data.get(sessionKey).expires, Date.now() + day)
  assert.equal(durable.data.get(sessionKey).expires, 0)
  t.mock.timers.tick(day + 1)
  runtime.sweep()
  await runtime.serialize(() => {})
  assert.equal(store.data.has(sessionKey), false)
  assert.ok(durable.raw(sessionKey), 'Local retention does not delete durable accounts/history')
})

test('anonymous game-session writes retain their existing bounded seven-day lifetime', async t => {
  const store = new LiveStore(), runtime = new LiveRuntime(store)
  t.after(() => runtime.close())
  const owner = await runtime.request('POST', '/session', undefined, { name: 'anonymous' })
  await runtime.request('POST', '/profile', q(owner.humanToken), { doctrine: 'Hold the home planet.' })
  const id = JSON.parse(store.raw(keyFor(owner.humanToken))).id
  const expires = store.data.get(`session:${id}`).expires
  assert.ok(expires > Date.now() + 6 * day && expires <= Date.now() + 7 * day)
})

test('retained shared state grants no access after durable token or owner deletion', async t => {
  const { durable, store, runtime, human, agent, request } = await fixture(t)
  const owner = await human('owner', 3600000), bearer = await agent(owner)
  await request('POST', '/play', owner.humanToken, { minutes: 3, planning: 10 })
  await request('GET', '/next', bearer)
  const sessionKey = `session:${owner.sessionId}`, matchId = JSON.parse(store.raw(sessionKey)).match
  durable.data.delete(keyFor(bearer))
  await runtime.authorities.get(keyFor(bearer)).refresh()
  await assert.rejects(request('GET', '/next', bearer), { status: 401 })
  assert.equal(runtime.canFrame(bearer, matchId, 0), false)
  assert.ok(store.raw(sessionKey))
  durable.data.delete(sessionKey)
  await runtime.authorities.get(keyFor(owner.humanToken)).refresh()
  await assert.rejects(request('GET', '/state', owner.humanToken), { status: 401 })
  assert.equal(runtime.canFrame(owner.humanToken, matchId, 0, proof), false)
})
