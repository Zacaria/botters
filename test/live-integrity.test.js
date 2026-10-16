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

test('failed authorization channels recover on retry and retired callbacks cannot overwrite the new lease', async t => {
  const store = new LiveStore(), runtime = new LiveRuntime(store); t.after(() => runtime.close())
  const a = await runtime.request('POST', '/session', undefined, { name: 'recovery' }), key = keyFor(a.humanToken)
  const token = store.raw(key), session = store.raw(`session:${JSON.parse(token).id}`), updates = []
  let created = 0, closed = 0
  runtime.options.authority = async (_key, adopt) => {
    created++; updates.push(adopt)
    await adopt({ token, session, expiresAt: Date.now() + 600000 })
    return { checkedAt: Date.now(), expiresAt: Date.now() + 600000, connected: () => true, close: async () => { closed++ } }
  }
  await runtime.authorize(a.humanToken)
  runtime.authorities.get(key).error = new Error('temporary provider failure')
  assert.equal(runtime.ready(a.humanToken), false)
  await assert.rejects(runtime.authorize(a.humanToken), e => e.status === 503)
  await runtime.authorize(a.humanToken)
  assert.equal(created, 2); assert.equal(closed, 1); assert.equal(runtime.ready(a.humanToken), true)
  await updates[0]({ token: null, session: null, expiresAt: Date.now() - 1 })
  assert.equal(runtime.ready(a.humanToken), true, 'Late callbacks from the retired socket are fenced')
})

test('private-room solo choice and openings survive authority refreshes and new agent channels', async t => {
  let now = Date.now()
  const durable = new MemoryStore(() => now)
  const store = new LiveStore({ get: k => durable.get(k), read: keys => Promise.resolve(keys.map(k => durable.raw(k))), commit: entries => durable.commit(entries) }, { now: () => now })
  const runtime = new LiveRuntime(store, { now: () => now }); t.after(() => runtime.close())
  const a = await runtime.request('POST', '/session', undefined, { name: 'solo', setup: 'connected-agent' })
  const b = await runtime.request('POST', '/session', undefined, { name: 'assisted', setup: 'connected-agent' })
  const opening = [{ if: 'always', then: 'hold', on: true }]
  const prefs = { minutes: 3, planning: 10, withAgent: false, opening }
  let refreshes = 0, channels = 0
  runtime.options.authority = async (key, adopt) => {
    channels++
    const entry = { checkedAt: Date.now(), expiresAt: Date.now() + 600000, connected: () => true, close: async () => {},
      async refresh() {
        refreshes++
        const token = durable.raw(key), session = durable.raw(`session:${JSON.parse(token).id}`)
        assert.equal(JSON.parse(session).roomPrefs, undefined, 'Preferences remain process-local')
        await adopt({ token, session, expiresAt: entry.expiresAt }); entry.checkedAt = Date.now()
      },
    }
    await entry.refresh(); return entry
  }
  const room = await runtime.request('POST', '/rooms', q(a.humanToken), prefs)
  await runtime.request('POST', '/rooms/join', q(b.humanToken), { ...prefs, code: room.code, withAgent: true })
  const reauthorize = async () => {
    const before = refreshes
    runtime.authorities.get(keyFor(a.humanToken)).checkedAt = Date.now() - 90001
    await runtime.request('GET', '/room', q(a.humanToken))
    assert.ok(refreshes > before, 'Exercise the 90-second authority refresh path')
    await runtime.request('GET', '/next', q(a.agentToken))
    const old = runtime.authorities.get(keyFor(b.agentToken))
    if (old) { old.error = new Error('reconnect'); await assert.rejects(runtime.authorize(b.agentToken), e => e.status === 503) }
    const created = channels
    await runtime.request('GET', '/next', q(b.agentToken))
    assert.equal(channels, created + 1, 'Exercise a new agent authority channel')
    const peer = await runtime.request('GET', '/room', q(b.humanToken))
    assert.equal(peer.players.length, 2)
    assert.ok(peer.players.every(player => player.agent), 'Both agents are connected even when the human chooses solo')
    for (const player of peer.players) assert.deepEqual(Object.keys(player).sort(), ['agent', 'name', 'setup', 'you'])
    assert.equal(JSON.stringify(peer).includes('opening'), false, 'Do not expose the other player’s opening')
  }
  const assertMatch = async () => {
    const solo = await runtime.request('GET', '/state', q(a.humanToken))
    const assisted = await runtime.request('GET', '/state', q(b.humanToken))
    assert.equal(solo.matchId, assisted.matchId)
    assert.equal(solo.me.withAgent, false, 'A connected agent must not override the solo choice')
    assert.equal(assisted.me.withAgent, true)
    for (const frame of [solo, assisted]) {
      assert.equal(frame.gambitsBy.who, 'you')
      assert.deepEqual(frame.view.gambits, opening)
    }
    await assert.rejects(runtime.request('POST', '/input', q(a.agentToken), { gambits: opening }), e => e.status === 403)
    return solo.matchId
  }
  await reauthorize()
  await runtime.request('POST', '/rooms/start', q(a.humanToken))
  const first = await assertMatch()
  now += 200000
  await runtime.request('GET', '/state', q(a.humanToken))
  // Re-save preferences after finish so the next adoption must preserve local state,
  // not rely on an incidental durable match-boundary snapshot.
  await runtime.request('POST', '/rooms/player', q(a.humanToken), prefs)
  await runtime.request('POST', '/rooms/player', q(b.humanToken), { ...prefs, withAgent: true })
  await reauthorize()
  assert.deepEqual(await runtime.request('POST', '/rooms/rematch', q(a.humanToken)), { ok: true, waiting: true })
  await runtime.request('POST', '/rooms/rematch', q(b.humanToken))
  assert.notEqual(await assertMatch(), first)
})

test('room capacity rejects play, start and rematch atomically, then a two-player rematch succeeds when space frees', async t => {
  let now = Date.now()
  const store = new LiveStore(null, { now: () => now }), runtime = new LiveRuntime(store, { now: () => now })
  t.after(() => runtime.close())
  runtime.createRoom = async id => `room-${id}`
  const a = await runtime.request('POST', '/session', undefined, { name: 'host' })
  const b = await runtime.request('POST', '/session', undefined, { name: 'guest' })
  const c = await runtime.request('POST', '/session', undefined, { name: 'queue' })
  const prefs = { minutes: 3, planning: 10, withAgent: false, opening: [{ if: 'always', then: 'hold' }] }
  const room = await runtime.request('POST', '/rooms', q(a.humanToken), prefs)
  await runtime.request('POST', '/rooms/join', q(b.humanToken), { ...prefs, code: room.code })
  await runtime.request('POST', '/rooms/start', q(a.humanToken))
  const first = (await runtime.request('GET', '/state', q(a.humanToken))).matchId
  now += 200000
  assert.ok((await runtime.request('GET', '/state', q(a.humanToken))).report)
  runtime.rooms.delete(first) // Colyseus disposes completed rooms after the report grace period.
  for (let i = 0; i < 24; i++) runtime.rooms.set(`occupied-${i}`, `room-${i}`)
  const rejectedWithoutMutation = async (path, bearer, body = {}) => {
    const before = structuredClone([...store.data])
    await assert.rejects(runtime.request('POST', path, q(bearer), body), e => e.status === 503 && /occupied/.test(e.message))
    assert.deepEqual([...store.data], before, `${path} must not change readiness, membership, sessions, queue or match records`)
    assert.equal(runtime.rooms.size, 24)
  }
  await rejectedWithoutMutation('/play', c.humanToken, { vs: 'player' })
  await rejectedWithoutMutation('/rooms/start', a.humanToken)
  await rejectedWithoutMutation('/rooms/rematch', a.humanToken)
  runtime.rooms.delete('occupied-0')
  assert.deepEqual(await runtime.request('POST', '/rooms/rematch', q(a.humanToken)), { ok: true, waiting: true })
  runtime.rooms.set('occupied-0', 'room-0')
  await rejectedWithoutMutation('/rooms/rematch', b.humanToken)
  assert.deepEqual((await runtime.request('GET', '/room', q(a.humanToken))).ready, [0])
  runtime.rooms.delete('occupied-0')
  await runtime.request('POST', '/rooms/rematch', q(b.humanToken))
  const next = (await runtime.request('GET', '/state', q(a.humanToken))).matchId
  assert.notEqual(next, first)
  assert.equal((await runtime.request('GET', '/state', q(b.humanToken))).matchId, next)
  const after = await runtime.request('GET', '/room', q(a.humanToken))
  assert.deepEqual(after.ready, []); assert.equal(after.players.length, 2)
  assert.equal(runtime.rooms.size, 24)
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
