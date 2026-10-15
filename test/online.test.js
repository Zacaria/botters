import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OnlineGame } from '../online/game.js'
import { MemoryStore } from '../online/store.js'
import { replay } from '../sim.js'

function fixture() {
  let now = 1_800_000_000_000
  const store = new MemoryStore(() => now)
  const game = new OnlineGame(store, { now: () => now, origin: 'https://example.test' })
  const call = (s, method, path, body = {}, role = 'human') => game.request(method, path, new URLSearchParams({ token: s?.[`${role}Token`] || '', timeout: '0' }), body)
  const session = (name, setup) => game.request('POST', '/session', new URLSearchParams(), { name, setup })
  return { game, store, call, session, advance: ms => { now += ms } }
}

test('role-scoped capabilities, validation, fog and server authority', async () => {
  const f = fixture(), a = await f.session('<A>', 'codex')
  assert.notEqual(a.humanToken, a.agentToken)
  assert.ok(a.humanToken.length >= 32)
  await assert.rejects(f.call(a, 'POST', '/profile', { name: 'bad' }, 'agent'), { status: 401 })
  await assert.rejects(f.call(a, 'POST', '/play', { opening: [{ if: 'constructor', then: 'hold' }] }), { status: 400 })
  await f.call(a, 'POST', '/play', { vs: 'easy', withAgent: false, planning: 10 })
  const state = await f.call(a, 'GET', '/state')
  assert.equal(state.view.enemies.length, 0)
  assert.equal(state.s, undefined); assert.equal(state.log, undefined)
  assert.equal(state.opponent.name, 'house (easy)')
  await assert.rejects(f.call(a, 'POST', '/input', { toggle: 0 }, 'agent'), { status: 403 })
  await assert.rejects(f.call(a, 'POST', '/input', { order: { swarm: 1, x: 200, y: 200 } }), { status: 409 })
  await assert.rejects(f.call({ humanToken: 'bad' }, 'GET', '/state'), { status: 401 })
})

test('atomic compatible matchmaking, any settings, cancellation, no duplicate/self match', async () => {
  const f = fixture(), a = await f.session('a'), b = await f.session('b'), c = await f.session('c')
  await f.call(a, 'POST', '/play', { vs: 'player', minutes: 8, planets: 40 })
  await f.call(b, 'POST', '/play', { vs: 'player', minutes: 3, planets: 16 })
  assert.equal((await f.call(a, 'GET', '/lobby')).queued, true)
  await f.call(c, 'POST', '/play', { vs: 'player', minutes: 'any', planets: 'any' })
  const [aa, cc] = await Promise.all([f.call(a, 'GET', '/state'), f.call(c, 'GET', '/state')])
  assert.equal(aa.matchId, cc.matchId); assert.deepEqual(aa.options, { minutes: 8, planets: 40 })
  assert.equal((await f.call(b, 'GET', '/lobby')).queued, true)
  await f.call(b, 'POST', '/cancel')
  assert.equal((await f.call(b, 'GET', '/lobby')).queued, false)
  await assert.rejects(f.call(a, 'POST', '/play', { vs: 'player' }), { status: 409 })
})

test('room host authority, code/link, settings, concurrent membership, finish and rematch', async () => {
  const f = fixture(), a = await f.session('a', 'A'), b = await f.session('b', 'B'), c = await f.session('c')
  const room = await f.call(a, 'POST', '/rooms', { minutes: 3, planets: 16, planning: 10 })
  assert.match(room.code, /^[A-Z2-9]{6}$/); assert.equal(room.link, `https://example.test/r/${room.code}`)
  const joins = await Promise.allSettled([f.call(b, 'POST', '/rooms/join', { code: room.code.toLowerCase() }), f.call(c, 'POST', '/rooms/join', { code: room.code })])
  assert.equal(joins.filter(r => r.status === 'fulfilled').length, 1)
  const guest = joins[0].status === 'fulfilled' ? b : c
  await assert.rejects(f.call(guest, 'POST', '/rooms/start'), { status: 403 })
  await f.call(a, 'POST', '/rooms/start')
  f.advance(191_000)
  const end = await f.call(a, 'GET', '/state')
  assert.ok(end.view.ended); assert.ok(end.report)
  const old = end.matchId
  await f.call(guest, 'POST', '/rooms/rematch')
  assert.equal((await f.call(a, 'GET', '/room')).ready.length, 1)
  await f.call(a, 'POST', '/rooms/rematch')
  const again = await f.call(a, 'GET', '/state')
  assert.notEqual(again.matchId, old)
  assert.equal(again.matchId, (await f.call(guest, 'GET', '/state')).matchId)
  assert.equal((await f.call(a, 'GET', '/lobby')).history.length, 1)
})

test('cold instance resumes, concurrent agent rate limit is shared, replay and Elo finish exactly once', async () => {
  const f = fixture(), a = await f.session('a', 'codex'), b = await f.session('b', 'claude')
  await f.call(a, 'POST', '/play', { vs: 'player', minutes: 3, planning: 10 })
  await f.call(b, 'POST', '/play', { vs: 'player', minutes: 3, planning: 10 })
  await f.call(a, 'GET', '/next', {}, 'agent')
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => f.call(a, 'POST', '/input', { gambits: [{ if: 'always', then: 'hold' }] }, 'agent')))
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 5)
  assert.equal(results.filter(r => r.reason?.status === 429).length, 3)
  f.advance(15_000)
  const before = await f.call(a, 'GET', '/state')
  const cold = new OnlineGame(f.store, { now: f.game.now, origin: 'https://example.test' })
  const after = await cold.request('GET', '/state', new URLSearchParams({ token: a.humanToken }))
  assert.deepEqual(before, after)
  f.advance(180_000)
  await Promise.all(Array.from({ length: 6 }, () => f.call(a, 'GET', '/state')))
  const lobby = await f.call(a, 'GET', '/lobby')
  assert.equal(lobby.history.length, 1)
  assert.equal(lobby.leaderboard.length, 2)
  assert.ok(lobby.leaderboard.every(p => p.games === 1 && p.setup))
  const persisted = new OnlineGame(f.store, { now: f.game.now })
  assert.deepEqual(await persisted.request('GET', '/leaderboard', new URLSearchParams()), { leaderboard: lobby.leaderboard })
  const m = JSON.parse(await f.store.get(`match:${before.matchId}`))
  const log = (await Promise.all(Array.from({ length: Math.ceil(m.logCount / 64) }, (_, i) => f.store.get(`log:${m.id}:${i}`).then(JSON.parse)))).flat()
  assert.deepEqual(replay(m.s.seed, log, m.s.opts), m.s)
})

test('abandoned queue expires, room leave removes stale membership, ended input rejected', async () => {
  const f = fixture(), a = await f.session('a'), b = await f.session('b')
  await f.call(a, 'POST', '/play', { vs: 'player' })
  f.advance(100_000)
  await f.call(b, 'POST', '/play', { vs: 'player' })
  assert.equal((await f.call(b, 'GET', '/lobby')).live, false)
  await f.call(b, 'POST', '/cancel')
  await f.call(b, 'POST', '/rooms')
  await f.call(b, 'POST', '/rooms/leave')
  assert.equal((await f.call(b, 'GET', '/lobby')).room, null)
  await f.call(b, 'POST', '/play', { vs: 'normal', minutes: 3 })
  f.advance(220_000)
  await assert.rejects(f.call(b, 'POST', '/input', { toggle: 0 }), { status: 409 })
})
