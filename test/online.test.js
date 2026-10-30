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

test('house match waits for agent, then gives the full planning window', async () => {
  const f = fixture(), a = await f.session('a', 'agent')
  await f.call(a, 'POST', '/play', { vs: 'normal', withAgent: true, planning: 20 })
  f.advance(120000)
  const waiting = await f.call(a, 'GET', '/state')
  assert.equal(waiting.waitingForAgent, true); assert.equal(waiting.startsIn, null); assert.equal(waiting.view.tick, 0)
  await assert.rejects(f.call(a, 'POST', '/input', { order: { swarm: 1, x: 100, y: 100 } }), { status: 409 })
  const joined = await f.call(a, 'GET', '/next', {}, 'agent')
  assert.equal(joined.match.startsIn, 20)
  f.advance(5000)
  const planning = await f.call(a, 'GET', '/state')
  assert.equal(planning.waitingForAgent, false); assert.equal(planning.startsIn, 15); assert.equal(planning.view.tick, 0)
})

test('waiting house match expires or can be cancelled without results', async () => {
  for (const timeout of [true, false]) {
    const f = fixture(), a = await f.session('a', 'agent')
    await f.call(a, 'POST', '/play', { withAgent: true })
    const id = (await f.call(a, 'GET', '/state')).matchId
    if (timeout) f.advance(300000); else await f.call(a, 'POST', '/cancel')
    const lobby = await f.call(a, 'GET', '/lobby')
    assert.equal(lobby.live, false); assert.equal(lobby.inMatch, false); assert.match(lobby.notice, /cancelled/i)
    assert.deepEqual(lobby.history, []); assert.deepEqual(lobby.leaderboard, [])
    const saved = JSON.parse(await f.store.get(`match:${id}`))
    assert.equal(saved.cancelled, true); assert.equal(saved.report, undefined)
    assert.equal([...f.store.data.keys()].some(key => key.startsWith('elo:')), false)
  }
})

test('start without agent starts planning and rooms still start immediately', async () => {
  const f = fixture(), a = await f.session('a', 'agent'), b = await f.session('b', 'agent')
  await f.call(a, 'POST', '/play', { withAgent: true, planning: 10 })
  f.advance(30000); await f.call(a, 'POST', '/start-without-agent')
  const frame = await f.call(a, 'GET', '/state')
  assert.equal(frame.startsIn, 10); assert.equal(frame.waitingForAgent, false); assert.equal(frame.me.withAgent, false)
  await f.call(a, 'POST', '/surrender')
  const room = await f.call(a, 'POST', '/rooms', { withAgent: true, planning: 10 })
  await f.call(b, 'POST', '/rooms/join', { code: room.code, withAgent: true })
  await f.call(a, 'POST', '/rooms/start', { withAgent: true, planning: 10 })
  const roomFrame = await f.call(a, 'GET', '/state')
  assert.equal(roomFrame.waitingForAgent, false); assert.equal(roomFrame.startsIn, 10)
})

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
  assert.equal(aa.matchId, cc.matchId); assert.deepEqual(aa.options, { minutes: 8, planets: 40, mode: '1v1' })
  assert.equal((await f.call(b, 'GET', '/lobby')).queued, true)
  await f.call(b, 'POST', '/cancel')
  assert.equal((await f.call(b, 'GET', '/lobby')).queued, false)
  await assert.rejects(f.call(a, 'POST', '/play', { vs: 'player' }), { status: 409 })
})

test('lobby shows players online in the last two minutes and the queue size', async () => {
  const f = fixture(), a = await f.session('a'), b = await f.session('b')
  await f.call(a, 'GET', '/lobby'); await f.call(b, 'POST', '/play', { vs: 'player' })
  assert.deepEqual((({ playersOnline, inQueue }) => ({ playersOnline, inQueue }))(await f.call(a, 'GET', '/lobby')), { playersOnline: 2, inQueue: 1 })
  f.advance(100000); await f.call(a, 'GET', '/lobby') // b stays queued but stops polling
  f.advance(30000)
  assert.deepEqual((({ playersOnline, inQueue }) => ({ playersOnline, inQueue }))(await f.call(a, 'GET', '/lobby')), { playersOnline: 1, inQueue: 0 })
})

test('matchmaking rematch keeps the same two players and settings, with separate human consent', async () => {
  const f = fixture(), a = await f.session('a', 'codex'), b = await f.session('b', 'claude'), c = await f.session('c')
  const prefs = { vs: 'player', minutes: 8, planets: 40, planning: 30, withAgent: false }
  await f.call(a, 'POST', '/play', prefs); await f.call(b, 'POST', '/play', prefs)
  const first = await f.call(a, 'GET', '/state')
  assert.equal(first.opponent.human, true)
  await assert.rejects(f.call(a, 'POST', '/rooms/rematch', { matchId: first.matchId }), { status: 409 })
  await f.call(a, 'POST', '/surrender')
  await assert.rejects(f.call(a, 'POST', '/rooms/rematch', { matchId: first.matchId }, 'agent'), { status: 401 })
  await assert.rejects(f.call(c, 'POST', '/rooms/rematch', { matchId: first.matchId }), { status: 409 })
  await assert.rejects(f.call(a, 'POST', '/rooms/rematch', { matchId: first.matchId, opening: [{ if: 'bad', then: 'hold' }] }), { status: 400 })
  assert.equal((await f.call(a, 'GET', '/lobby')).room, null)
  assert.deepEqual(await f.call(a, 'POST', '/rooms/rematch', { ...prefs, matchId: first.matchId }), { ok: true, waiting: true })
  const waiting = await f.call(a, 'GET', '/lobby')
  assert.equal(waiting.live, false); assert.equal(waiting.room.players.length, 1)
  assert.equal((await f.call(b, 'GET', '/lobby')).room, null, 'Do not move the opponent without their consent')
  assert.equal((await f.call(b, 'GET', '/state')).matchId, first.matchId)
  assert.equal(waiting.room.ready.length, 1)
  assert.deepEqual(await f.call(a, 'POST', '/rooms/rematch', { matchId: first.matchId }), { ok: true, waiting: true })
  await assert.rejects(f.call(c, 'POST', '/rooms/join', { code: waiting.room.code }), { status: 403 })
  assert.equal((await f.call(c, 'GET', '/lobby')).room, null)
  assert.equal((await f.call(a, 'GET', '/room')).players.length, 1)
  const opening = [{ if: 'always', then: 'hold' }]
  await f.call(b, 'POST', '/rooms/rematch', { matchId: first.matchId, minutes: 3, planets: 16, planning: 10, withAgent: false, opening })
  const again = await f.call(a, 'GET', '/state'), other = await f.call(b, 'GET', '/state')
  assert.equal(again.matchId, other.matchId); assert.notEqual(again.matchId, first.matchId)
  assert.equal(again.opponent.name, 'b'); assert.equal(other.opponent.name, 'a')
  assert.deepEqual(again.options, { minutes: 8, planets: 40, mode: '1v1' }); assert.equal(again.startsIn, 30)
  assert.equal(again.roomCode, waiting.room.code); assert.equal(other.roomCode, again.roomCode)
  assert.equal(again.me.withAgent, false); assert.equal(other.me.withAgent, false)
  assert.deepEqual(other.view.gambits, [{ ...opening[0], on: true }])
  assert.equal((await f.call(a, 'GET', '/lobby')).history.length, 1)
})

test('matchmaking rematch handles concurrent acceptance and refuses stale or departed opponents', async () => {
  for (const departure of [null, 'queue', 'house', 'room']) {
    const f = fixture(), a = await f.session('a'), b = await f.session('b')
    const prefs = { vs: 'player', minutes: 3, planets: 16, planning: 10 }
    await f.call(a, 'POST', '/play', prefs); await f.call(b, 'POST', '/play', prefs)
    await f.call(a, 'POST', '/surrender')
    const old = await f.call(a, 'GET', '/state'), body = { matchId: old.matchId, withAgent: false }
    if (!departure) {
      const replies = await Promise.all([f.call(a, 'POST', '/rooms/rematch', body), f.call(b, 'POST', '/rooms/rematch', body)])
      assert.equal(replies.filter(r => r.waiting).length, 1)
      assert.equal((await f.call(a, 'GET', '/state')).matchId, (await f.call(b, 'GET', '/state')).matchId)
      assert.notEqual((await f.call(a, 'GET', '/state')).matchId, old.matchId)
      await f.call(a, 'POST', '/surrender')
      await assert.rejects(f.call(a, 'POST', '/rooms/rematch', body), { status: 409 })
      assert.equal((await f.call(a, 'GET', '/room')).ready.length, 0)
    } else {
      if (departure === 'room') await f.call(b, 'POST', '/rooms', prefs)
      else await f.call(b, 'POST', '/play', { ...prefs, vs: departure === 'house' ? 'normal' : 'player' })
      const before = await f.call(b, 'GET', '/lobby')
      await assert.rejects(f.call(a, 'POST', '/rooms/rematch', body), { status: 409 })
      assert.equal((await f.call(a, 'GET', '/lobby')).room, null)
      assert.deepEqual(await f.call(b, 'GET', '/lobby'), before)
    }
  }
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

test('rejected room join leaves membership, readiness, timestamps and guest preferences unchanged', async () => {
  const f = fixture(), host = await f.session('host'), guest = await f.session('guest'), replacement = await f.session('replacement')
  const room = await f.call(host, 'POST', '/rooms', { minutes: 3, planets: 16, planning: 10 })
  // Retain saved preferences from an earlier room so a partial overwrite is observable.
  await f.call(guest, 'POST', '/rooms', { withAgent: false, opening: [{ if: 'always', then: 'hold' }] })
  await f.call(guest, 'POST', '/rooms/leave')
  const sessions = () => [...f.store.data.entries()].filter(([key]) => key.startsWith('session:')).map(([, r]) => JSON.parse(r.value))
  const beforeGuest = sessions().find(s => s.name === 'guest')
  const idx = JSON.parse(await f.store.get('index'))
  // A host may already be ready while a finished room awaits a replacement.
  idx.rooms[room.code].ready = [idx.rooms[room.code].host]
  await f.store.commit([{ key: 'index', raw: await f.store.get('index'), value: JSON.stringify(idx), ttl: 0 }])
  const beforeRoom = structuredClone(idx.rooms[room.code])
  f.advance(1000)
  await assert.rejects(f.call(guest, 'POST', '/rooms/join', { code: room.code, opening: [{ if: 'always', then: 'hold', p: 100001 }] }), { status: 400 })
  const afterRoom = JSON.parse(await f.store.get('index')).rooms[room.code]
  assert.deepEqual(afterRoom, beforeRoom)
  const afterGuest = sessions().find(s => s.id === beforeGuest.id)
  assert.equal(afterGuest.room, beforeGuest.room)
  assert.deepEqual(afterGuest.roomPrefs, beforeGuest.roomPrefs)
  assert.equal((await f.call(host, 'GET', '/room')).players.length, 1)
  assert.equal((await f.call(guest, 'GET', '/lobby')).room, null)
  const joined = await f.call(replacement, 'POST', '/rooms/join', { code: room.code })
  assert.equal(joined.players.length, 2)
  assert.deepEqual(joined.players.map(p => p.name), ['host', 'replacement'])
  assert.deepEqual(joined.ready, [])
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

test('surrender finishes either room side once, notifies both agents and permits rematch or leave', async () => {
  for (const side of [0, 1]) {
    const f = fixture(), a = await f.session('a', 'A'), b = await f.session('b', 'B')
    await assert.rejects(f.call(a, 'POST', '/surrender'), { status: 409 })
    const room = await f.call(a, 'POST', '/rooms', { minutes: 3, planets: 16, planning: 10 })
    await f.call(b, 'POST', '/rooms/join', { code: room.code })
    await f.call(a, 'POST', '/rooms/start')
    for (const player of [a, b]) await f.call(player, 'GET', '/next', {}, 'agent')
    if (side) f.advance(12_000)
    const loser = [a, b][side], winner = [a, b][1 - side]
    const before = await f.call(loser, 'GET', '/state')
    await assert.rejects(f.call(loser, 'POST', '/surrender', {}, 'agent'), { status: 401 })
    await assert.rejects(f.call(loser, 'POST', '/input', { surrender: true }, 'agent'), { status: 400 })
    assert.deepEqual(await f.call(loser, 'POST', '/surrender'), { ok: true })
    const lost = await f.call(loser, 'GET', '/state'), won = await f.call(winner, 'GET', '/state')
    assert.deepEqual(lost.view.ended, { reason: 'surrender', result: 'lost' })
    assert.deepEqual(won.view.ended, { reason: 'surrender', result: 'won' })
    assert.equal(lost.view.tick, before.view.tick)
    assert.equal(lost.report.actual.result, 'lost'); assert.equal(won.report.actual.result, 'won')
    for (const [player, result] of [[loser, 'lost'], [winner, 'won']]) {
      const events = await f.call(player, 'GET', '/events', {}, 'agent')
      assert.equal(events.events.filter(e => e.text.includes(`match over: you ${result} (surrender)`)).length, 1)
    }
    const m = JSON.parse(await f.store.get(`match:${lost.matchId}`))
    const log = (await Promise.all(Array.from({ length: Math.ceil(m.logCount / 64) }, (_, i) => f.store.get(`log:${m.id}:${i}`).then(JSON.parse)))).flat()
    assert.deepEqual(replay(m.s.seed, log, m.s.opts), m.s)
    await assert.rejects(f.call(winner, 'POST', '/surrender'), { status: 409 })
    await assert.rejects(f.call(loser, 'POST', '/input', { toggle: 0 }), { status: 409 })
    f.advance(20_000)
    assert.deepEqual((await f.call(loser, 'GET', '/state')).view, lost.view)
    for (const player of [a, b]) {
      const lobby = await f.call(player, 'GET', '/lobby')
      assert.equal(lobby.live, false); assert.equal(lobby.history.length, 1)
      assert.equal(lobby.history[0].reason, 'surrender')
      assert.ok(lobby.leaderboard.every(p => p.games === 1))
    }
    await f.call(loser, 'POST', '/rooms/rematch')
    await f.call(winner, 'POST', '/rooms/rematch')
    assert.notEqual((await f.call(loser, 'GET', '/state')).matchId, lost.matchId)
    await f.call(loser, 'POST', '/surrender')
    await f.call(loser, 'POST', '/rooms/leave')
    assert.equal((await f.call(loser, 'GET', '/lobby')).room, null)
  }
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
