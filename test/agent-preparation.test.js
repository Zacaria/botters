import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OnlineGame } from '../online/game.js'
import { MemoryStore } from '../online/store.js'
import { LiveStore } from '../online/live-store.js'
import { LiveRuntime } from '../online/live-runtime.js'
import { createHandler } from '../online/http.js'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'

import { createPreparation, preparationReady, savePreparation } from '../agent-preparation.js'

const opening = [{ if: 'always', then: 'hold', on: true }]
const options = { vs: 'easy', minutes: 3, planets: 16, planning: 10, withAgent: true }
const q = token => new URLSearchParams({ token })
function fixture(storeFactory = now => new MemoryStore(now)) {
  let now = Date.now()
  const store = storeFactory(() => now), game = new OnlineGame(store, { now: () => now })
  const call = (s, method, path, body = {}, role = 'human') => game.request(method, path, q(s[`${role}Token`]), body)
  const session = name => game.request('POST', '/session', undefined, { name, setup: 'agent' })
  const prepare = async (s, opts = options) => {
    const result = await call(s, 'POST', '/prepare', opts)
    await call(s, 'POST', '/input', { preparationId: result.preparation.id, gambits: opening, why: 'defend first' }, 'agent')
    return result.preparation
  }
  return { store, game, call, session, prepare, advance: ms => { now += ms } }
}

test('prepare → agent save → absent agent → human starts with tick-zero agent rules', async () => {
  const f = fixture(), s = await f.session('ready')
  const prep = await f.prepare(s)
  assert.equal([...f.store.data.keys()].some(k => k.startsWith('match:')), false)
  const next = await f.call(s, 'GET', '/next', {}, 'agent')
  assert.equal(next.match, null); assert.equal(next.preparation.id, prep.id)
  assert.equal(next.preparation.ready, true, 'a returning agent sees that its opening was already saved')
  f.advance(91000)
  const lobby = await f.call(s, 'GET', '/lobby')
  assert.equal(lobby.agent, null); assert.equal(lobby.preparation.ready, true)
  await f.call(s, 'POST', '/play', options)
  const state = await f.call(s, 'GET', '/state')
  assert.deepEqual(state.view.gambits, opening)
  assert.deepEqual(state.gambitsBy, { who: 'agent', t: 0, why: 'defend first' })
  assert.equal((await f.call(s, 'GET', '/next', {}, 'agent')).match.openingBy, 'prepared')
  const log = JSON.parse(await f.store.get(`log:${state.matchId}:0`))
  assert.deepEqual(log[0], { tick: 0, side: 0, role: 'agent', input: { gambits: opening } })
})

test('shared helper snapshots canonical settings and rejects stale IDs, doctrine, versions and invalid real gambits', () => {
  const s = { doctrine: 'defend', agentVersion: 4, agentGranted: true }
  s.preparation = createPreparation(s, { ...options, opening, injected: true }, 'one')
  assert.deepEqual(s.preparation.options, { mode: '1v1', minutes: 3, planets: 16, vs: 'easy', planning: 10 })
  assert.equal(preparationReady(s), false)
  for (const gambits of [[], [{ if: 'constructor', then: 'hold' }], [{ if: 'always', then: 'bad' }], [{ if: 'always', then: 'hold', p: 0 }]]) {
    assert.throws(() => savePreparation(s, { preparationId: 'one', gambits }), { status: 400 })
    assert.equal(preparationReady(s), false)
  }
  savePreparation(s, { preparationId: 'one', gambits: [{ if: 'always', then: 'hold', extra: 'drop' }], why: ' defend ' })
  assert.deepEqual(s.preparation.gambits, opening); assert.equal(s.preparation.why, 'defend')
  assert.equal(preparationReady(s, options), true)
  assert.equal(preparationReady(s, { ...options, planning: 30 }), false)
  for (const change of [{ doctrine: 'attack' }, { agentVersion: 5 }, { agentGranted: false }]) {
    const changed = { ...s, ...change }
    assert.equal(preparationReady(changed), false)
    assert.throws(() => savePreparation(changed, { preparationId: 'one', gambits: opening }), { status: 409 })
  }
  const before = structuredClone(s.preparation)
  assert.throws(() => savePreparation(s, { preparationId: 'old', gambits: opening }), { status: 409 })
  assert.deepEqual(s.preparation, before)
})

test('room preparation snapshots shared settings, stays private, and starts without agent presence', async () => {
  const f = fixture(), a = await f.session('host'), b = await f.session('guest')
  const roomOptions = { ...options, vs: 'player' }
  const room = await f.call(a, 'POST', '/rooms', roomOptions)
  await f.call(b, 'POST', '/rooms/join', { code: room.code })
  const prep = await f.prepare(a, { ...options, minutes: 8 })
  assert.equal(prep.options.minutes, 3); assert.equal(prep.options.vs, 'player')
  assert.equal(JSON.stringify(await f.call(b, 'GET', '/room')).includes(prep.id), false)
  assert.equal((await f.call(b, 'GET', '/lobby')).preparation, null)
  await f.call(a, 'POST', '/rooms/settings', { ...roomOptions, minutes: 8 })
  assert.equal((await f.call(a, 'GET', '/lobby')).preparation.ready, false)
  const before = structuredClone([...f.store.data])
  await assert.rejects(f.call(a, 'POST', '/rooms/start'), { status: 409 })
  assert.deepEqual([...f.store.data], before)
  await assert.rejects(f.call(a, 'POST', '/input', { preparationId: prep.id, gambits: opening }, 'agent'), { status: 409 })
  await f.prepare(a, roomOptions)
  f.advance(91000)
  await f.call(a, 'POST', '/rooms/start')
  const frame = await f.call(a, 'GET', '/state')
  assert.equal(frame.options.minutes, 8); assert.equal(frame.me.withAgent, true)
  assert.deepEqual(frame.view.gambits, opening); assert.equal(frame.gambitsBy.who, 'agent')
})


test('role denials, invalid saves, stale request/doctrine/settings and active-match precedence', async () => {
  const f = fixture(), s = await f.session('roles')
  await assert.rejects(f.call(s, 'POST', '/prepare', options, 'agent'), { status: 401 })
  await assert.rejects(f.call(s, 'POST', '/play', options, 'agent'), { status: 401 })
  await assert.rejects(f.call(s, 'POST', '/play', options), { status: 409 })
  const first = (await f.call(s, 'POST', '/prepare', options)).preparation
  await assert.rejects(f.call(s, 'POST', '/input', { preparationId: first.id, gambits: opening }), { status: 401 })
  await assert.rejects(f.call(s, 'POST', '/input', { preparationId: first.id, gambits: [] }, 'agent'), { status: 400 })
  assert.equal((await f.call(s, 'GET', '/lobby')).preparation.ready, false)
  const second = await f.prepare(s)
  await assert.rejects(f.call(s, 'POST', '/input', { preparationId: first.id, gambits: opening, why: 'stale' }, 'agent'), { status: 409 })
  assert.equal((await f.call(s, 'GET', '/lobby')).preparation.id, second.id)
  assert.equal((await f.call(s, 'GET', '/lobby')).preparation.why, 'defend first')
  for (const change of [{ minutes: 8 }, { planets: 40 }, { planning: 30 }, { vs: 'hard' }, { mode: '2v2' }]) {
    await assert.rejects(f.call(s, 'POST', '/play', { ...options, ...change }), { status: 409 })
  }
  await f.call(s, 'POST', '/profile', { doctrine: 'different' })
  await assert.rejects(f.call(s, 'POST', '/input', { preparationId: second.id, gambits: opening }, 'agent'), { status: 409 })
  assert.equal((await f.call(s, 'GET', '/lobby')).preparation.ready, false)
  await f.prepare(s)
  await f.call(s, 'POST', '/play', options)
  const next = await f.call(s, 'GET', '/next', {}, 'agent')
  assert.ok(next.match); assert.equal(next.preparation, undefined)
  await assert.rejects(f.call(s, 'POST', '/prepare', options), { status: 409 })
  await assert.rejects(f.call(s, 'POST', '/input', { preparationId: second.id, gambits: opening }, 'agent'), { status: 409 })
})

test('solo default and manual human openings bypass preparation', async () => {
  for (const opts of [{}, { withAgent: true, opening }]) {
    const f = fixture(), s = await f.session('solo')
    await f.call(s, 'POST', '/play', { ...options, withAgent: undefined, ...opts })
    const state = await f.call(s, 'GET', '/state')
    assert.equal(state.me.withAgent, opts.withAgent === true)
    if (opts.opening) { assert.equal(state.gambitsBy.who, 'you'); assert.deepEqual(state.view.gambits, opening) }
    else await assert.rejects(f.call(s, 'POST', '/input', { gambits: opening }, 'agent'), { status: 403 })
  }
})

test('queue validation and any-settings mismatch roll back without consuming either entry', async () => {
  const f = fixture(), a = await f.session('queued'), b = await f.session('incoming')
  const prepared = { ...options, vs: 'player', minutes: 5 }
  await f.prepare(a, prepared)
  await f.call(a, 'POST', '/play', { ...prepared, minutes: 'any' })
  await f.call(b, 'GET', '/lobby')
  await assert.rejects(f.call(a, 'POST', '/prepare', prepared), { status: 409 })
  let before = structuredClone([...f.store.data])
  await assert.rejects(f.call(a, 'POST', '/play', { ...prepared, minutes: 8 }), { status: 409 })
  assert.deepEqual([...f.store.data], before)
  await assert.rejects(f.call(b, 'POST', '/play', { ...prepared, withAgent: false, minutes: 8 }), { status: 409 })
  assert.deepEqual([...f.store.data], before)
  await f.call(b, 'POST', '/play', { ...prepared, withAgent: false })
  assert.equal((await f.call(a, 'GET', '/state')).matchId, (await f.call(b, 'GET', '/state')).matchId)
})

test('private rematch validates preparation before recording readiness or creating invitation', async () => {
  for (const privateRoom of [true, false]) {
    const f = fixture(), a = await f.session('host'), b = await f.session('guest')
    const opts = { ...options, vs: 'player' }
    if (privateRoom) {
      const room = await f.call(a, 'POST', '/rooms', opts)
      await f.call(b, 'POST', '/rooms/join', { code: room.code })
      await f.prepare(a, opts)
      await f.call(a, 'POST', '/rooms/start')
    } else {
      await f.prepare(a, opts)
      await f.call(a, 'POST', '/play', opts)
      await f.call(b, 'POST', '/play', { ...opts, withAgent: false })
    }
    await f.call(a, 'POST', '/surrender')
    await f.call(a, 'POST', '/profile', { doctrine: 'changed' })
    const before = structuredClone([...f.store.data])
    await assert.rejects(f.call(a, 'POST', '/rooms/rematch', opts), { status: 409 })
    assert.deepEqual([...f.store.data], before)
    await f.prepare(a, opts)
    await f.call(a, 'POST', '/rooms/rematch', opts)
    await f.call(b, 'POST', '/rooms/rematch', { ...opts, withAgent: false })
    assert.equal((await f.call(a, 'GET', '/state')).gambitsBy.who, 'agent')
  }
})

test('LiveStore rejects a stale save instead of overwriting newer durable plan or doctrine', async () => {
  for (const change of ['plan', 'doctrine', 'version']) {
    const durable = new MemoryStore(), cold = new OnlineGame(durable)
    const store = new LiveStore({ get: key => durable.get(key), read: keys => Promise.resolve(keys.map(k => durable.raw(k))), commit: entries => durable.commit(entries) })
    const live = new OnlineGame(store)
    const s = await live.request('POST', '/session', undefined, { name: change, setup: 'agent' })
    const prep = (await live.request('POST', '/prepare', q(s.humanToken), options)).preparation
    if (change === 'plan') await cold.request('POST', '/prepare', q(s.humanToken), options)
    else if (change === 'doctrine') await cold.request('POST', '/profile', q(s.humanToken), { doctrine: 'new doctrine' })
    else {
      const key = [...durable.data.keys()].find(k => k.startsWith('session:'))
      const raw = durable.raw(key), session = JSON.parse(raw)
      await durable.commit([{ key, raw, value: JSON.stringify({ ...session, agentVersion: 1, agentGranted: false }), ttl: 0 }])
    }
    const before = structuredClone([...durable.data])
    await assert.rejects(live.request('POST', '/input', q(s.agentToken), { preparationId: prep.id, gambits: opening }), { status: 409 })
    assert.deepEqual([...durable.data], before)
    assert.equal((await live.request('GET', '/lobby', q(s.humanToken))).preparation.ready, false)
  }
})

test('LiveStore fences cached prepared starts against newer durable doctrine and preparation', async () => {
  for (const change of ['doctrine', 'preparation']) {
    const identity = { id: 'start-owner', name: 'Owner', emailVerified: true }
    const durable = new MemoryStore(), cold = new OnlineGame(durable, { requireAccount: true, identity })
    const s = await cold.request('POST', '/session', undefined, {})
    const pair = await cold.request('POST', '/agent/pair', undefined, { setup: 'agent' })
    await cold.request('POST', '/agent/approve', q(s.humanToken), { id: pair.id })
    const store = new LiveStore({ get: key => durable.get(key), read: keys => Promise.resolve(keys.map(k => durable.raw(k))), commit: entries => durable.commit(entries) })
    for (const [key, row] of durable.data) store.put(key, row.value)
    const live = new OnlineGame(store, { requireAccount: true, identity })
    const prep = (await live.request('POST', '/prepare', q(s.humanToken), options)).preparation
    await live.request('POST', '/input', q(pair.agentToken), { preparationId: prep.id, gambits: opening, why: 'Old opening.' })
    if (change === 'doctrine') await cold.request('POST', '/profile', q(s.humanToken), { doctrine: 'NEW HUMAN DOCTRINE' })
    else await cold.request('POST', '/prepare', q(s.humanToken), options)
    const before = structuredClone([...durable.data])
    await assert.rejects(live.request('POST', '/play', q(s.humanToken), options), { status: 409 })
    assert.deepEqual([...durable.data], before, 'a rejected start cannot overwrite newer durable human state')
    assert.equal([...store.data.keys()].some(k => k.startsWith('match:')), false)
    const lobby = await live.request('GET', '/lobby', q(s.humanToken))
    assert.equal(lobby.inMatch, false, 'no phantom local match pointer survives rejection')
    assert.equal(lobby.preparation.ready, false)
  }
})

test('HTTP next long poll returns a preparation immediately', async () => {
  const f = fixture(), s = await f.session('http')
  await f.prepare(s)
  const res = new EventEmitter()
  res.setHeader = () => {}; res.writeHead = status => { res.status = status }; res.end = raw => { res.body = JSON.parse(raw) }
  const start = performance.now()
  await createHandler(f.store)({ method: 'GET', url: `/next?token=${s.agentToken}&timeout=1`, headers: { host: 'example.test' } }, res)
  assert.equal(res.status, 200); assert.ok(res.body.preparation)
  assert.ok(performance.now() - start < 500, 'Preparation must stop long polling')
})

test('LiveRuntime human/agent authority channels retain durable preparation and fence revocation', async t => {
  let now = Date.now()
  const durable = new MemoryStore(() => now)
  const remote = { get: key => durable.get(key), read: keys => Promise.resolve(keys.map(k => durable.raw(k))), commit: entries => durable.commit(entries) }
  const store = new LiveStore(remote, { now: () => now }), runtime = new LiveRuntime(store, { now: () => now })
  t.after(() => runtime.close())
  const s = await runtime.request('POST', '/session', undefined, { name: 'persist', setup: 'agent' })
  const tokenKey = bearer => `token:${createHash('sha256').update(bearer).digest('hex')}`
  const sessionKey = `session:${JSON.parse(durable.raw(tokenKey(s.humanToken))).id}`
  const updates = new Map()
  runtime.options.authority = async (key, adopt) => {
    updates.set(key, adopt)
    const entry = { checkedAt: Date.now(), expiresAt: Date.now() + 600000, connected: () => true, close: async () => {}, async refresh() {
      await adopt({ token: durable.raw(key), session: durable.raw(sessionKey), expiresAt: entry.expiresAt }); entry.checkedAt = Date.now()
    } }
    await entry.refresh(); return entry
  }
  const call = (method, path, body = {}, role = 'human') => runtime.request(method, path, q(s[`${role}Token`]), body)
  const prep = (await call('POST', '/prepare', options)).preparation
  assert.equal(JSON.parse(durable.raw(sessionKey)).preparation.id, prep.id)
  assert.equal((await call('GET', '/next', {}, 'agent')).preparation.id, prep.id)
  await call('POST', '/input', { preparationId: prep.id, gambits: opening, why: 'persisted' }, 'agent')
  assert.equal(JSON.parse(durable.raw(sessionKey)).preparation.why, 'persisted')
  await runtime.authorities.get(tokenKey(s.humanToken)).refresh()
  assert.equal((await call('GET', '/lobby')).preparation.ready, true)
  now += 91000
  await call('POST', '/play', options)
  assert.equal((await call('GET', '/state')).gambitsBy.who, 'agent')
  await call('POST', '/surrender')
  // An authority refresh may carry an old preparation, never a usable old grant.
  const revoked = { ...JSON.parse(durable.raw(sessionKey)), agentVersion: 1, agentGranted: false }
  await durable.commit([{ key: sessionKey, raw: durable.raw(sessionKey), value: JSON.stringify(revoked), ttl: 0 }])
  await runtime.authorities.get(tokenKey(s.humanToken)).refresh()
  assert.equal((await call('GET', '/lobby')).preparation?.ready ?? false, false)
  await assert.rejects(call('POST', '/play', options), { status: 409 })
  const approved = { ...revoked, agentVersion: 2, agentGranted: true }
  await durable.commit([{ key: sessionKey, raw: durable.raw(sessionKey), value: JSON.stringify(approved), ttl: 0 }])
  await runtime.authorities.get(tokenKey(s.humanToken)).refresh()
  assert.equal((await call('GET', '/lobby')).preparation?.ready ?? false, false)
  await assert.rejects(call('POST', '/play', options), { status: 409 })
})


