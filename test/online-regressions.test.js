import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OnlineGame } from '../online/game.js'
import { MemoryStore } from '../online/store.js'
import { createMatch, applyInput, replay } from '../sim.js'
function fixture() {
  let now = 1_800_000_000_000
  const store = new MemoryStore(() => now), game = new OnlineGame(store, { now: () => now })
  return { store, advance: ms => { now += ms },
    session: (name, setup) => game.request('POST', '/session', undefined, { name, setup }),
    call: (s, method, path, body = {}, role = 'human') => game.request(method, path, new URLSearchParams({ token: s[`${role}Token`] }), body) }
}

test('room settings do not disclose private openings; next delivery can be retried', async () => {
  const f = fixture(), a = await f.session('a', 'codex'), b = await f.session('b', 'claude')
  const opening = [{ if: 'always', then: 'hold' }]
  const room = await f.call(a, 'POST', '/rooms', { opening })
  const joined = await f.call(b, 'POST', '/rooms/join', { code: room.code, withAgent: false })
  assert.equal(joined.settings.opening, undefined)
  await f.call(a, 'POST', '/rooms/start')
  const first = await f.call(a, 'GET', '/next', {}, 'agent')
  const retry = await f.call(a, 'GET', '/next', {}, 'agent')
  assert.ok(first.match?.id)
  assert.deepEqual(first, retry)
  await assert.rejects(f.call(b, 'POST', '/input', { toggle: 0 }, 'agent'), { status: 403 })
  assert.equal((await f.call(a, 'GET', '/next', {}, 'agent')).lobby, undefined)
})

test('logs canonical inputs only, rejects no-op padding and applies invalid mixed inputs atomically', async () => {
  const f = fixture(), a = await f.session('a')
  await f.call(a, 'POST', '/play', { vs: 'normal', withAgent: false })
  const frame = await f.call(a, 'GET', '/state')
  const padded = { gambits: [{ if: 'always', then: 'hold', padding: 'x'.repeat(14000) }] }
  await f.call(a, 'POST', '/input', padded)
  const m = JSON.parse(await f.store.get(`match:${frame.matchId}`))
  const log = JSON.parse(await f.store.get(`log:${m.id}:0`))
  assert.ok(JSON.stringify(log).length < 1000)
  assert.equal(m.log, undefined)
  assert.deepEqual(log.at(-1).input, { gambits: [{ if: 'always', then: 'hold', on: true }] })
  await assert.rejects(f.call(a, 'POST', '/input', { padding: 'x'.repeat(14000) }), { status: 400 })
  await assert.rejects(f.call(a, 'POST', '/input', { gambits: [{ if: 'always', then: 'go' }], split: -1 }), { status: 400 })
  assert.deepEqual((await f.call(a, 'GET', '/state')).view.gambits, [{ if: 'always', then: 'hold', on: true }])
})

test('active bearer/session expiry slides; idle capabilities expire', async () => {
  const f = fixture(), a = await f.session('expiry')
  await f.call(a, 'GET', '/lobby')
  f.advance(6 * 86400000); await f.call(a, 'GET', '/lobby')
  f.advance(2 * 86400000); assert.equal((await f.call(a, 'GET', '/lobby')).name, 'expiry')
  f.advance(8 * 86400000); await assert.rejects(f.call(a, 'GET', '/lobby'), { status: 401 })
})

test('input log rolls into bounded chunks and stays out of hot state transactions', async () => {
  const f = fixture(), a = await f.session('chunks')
  await f.call(a, 'POST', '/play', { vs: 'normal', minutes: 3 })
  for (let i = 0; i < 70; i++) { await f.call(a, 'POST', '/input', { toggle: 0 }); f.advance(200) }
  const frame = await f.call(a, 'GET', '/state'), m = JSON.parse(await f.store.get(`match:${frame.matchId}`))
  assert.equal(m.logCount, 71); assert.equal(m.log, undefined)
  assert.equal(JSON.parse(await f.store.get(`log:${m.id}:0`)).length, 64)
  assert.equal(JSON.parse(await f.store.get(`log:${m.id}:1`)).length, 7)
  const original = f.store.get.bind(f.store)
  f.store.get = async key => { assert.ok(!key.startsWith('log:')); return original(key) }
  await f.call(a, 'GET', '/state')
  f.store.get = original
  f.advance(200000)
  const ended = await f.call(a, 'GET', '/state')
  assert.ok(ended.report && ended.view.ended)
})

test('online route journal strips nested padding', async () => {
  const f = fixture(), a = await f.session('route')
  await f.call(a, 'POST', '/play', { vs: 'normal', withAgent: false, planning: 10 }); f.advance(10000)
  const frame = await f.call(a, 'GET', '/state'), swarm = frame.view.swarms[0].id
  const points = [{ x: 150, y: 150 }, { x: 200, y: 150 }]
  await f.call(a, 'POST', '/input', { route: { swarm, points: points.map(p => ({ ...p, padding: 'x'.repeat(15000) })), padding: 'x'.repeat(15000) } })
  const log = JSON.parse(await f.store.get(`log:${frame.matchId}:0`))
  assert.deepEqual(log.at(-1).input, { route: { swarm, points } })
})

test('journaled online route replays to the same final simulation', async () => {
  const f = fixture(), a = await f.session('replay')
  await f.call(a, 'POST', '/play', { vs: 'normal', withAgent: false, planning: 10, minutes: 3 })
  const { matchId } = await f.call(a, 'GET', '/state')
  const key = `match:${matchId}`, record = f.store.data.get(key), match = JSON.parse(record.value)
  const initialLog = JSON.parse(await f.store.get(`log:${matchId}:0`))
  const initial = createMatch(12345, match.s.opts)
  for (const entry of initialLog) assert.equal(applyInput(initial, entry.side, entry.input).ok, true)
  match.s = initial.toJSON(); initial.free()
  record.value = JSON.stringify(match)

  f.advance(10000)
  const frame = await f.call(a, 'GET', '/state'), swarm = frame.view.swarms[0].id
  const points = [{ x: 150, y: 150 }, { x: 200, y: 150 }]
  assert.deepEqual(await f.call(a, 'POST', '/input', { route: { swarm, points } }), { ok: true })
  const log = JSON.parse(await f.store.get(`log:${matchId}:0`))
  assert.deepEqual(log.at(-1), { tick: 0, side: 0, role: 'human', input: { route: { swarm, points } } })
  f.advance(180000)
  assert.ok((await f.call(a, 'GET', '/state')).view.ended)
  const final = JSON.parse(await f.store.get(key)).s
  const played = replay(final.seed, log, final.opts), withoutRoute = replay(final.seed, initialLog, final.opts)
  try {
    assert.deepEqual(played.toJSON(), final)
    assert.notDeepEqual(withoutRoute.toJSON(), final)
  } finally { played.free(); withoutRoute.free() }
})

test('online human route clears matching calls and feed describes route', async () => {
  const f = fixture(), a = await f.session('route')
  await f.call(a, 'POST', '/play', { vs: 'normal', withAgent: true, planning: 10 })
  await f.call(a, 'GET', '/next', {}, 'agent'); f.advance(10000)
  const frame = await f.call(a, 'GET', '/state'), [swarm, other] = frame.view.swarms.map(s => s.id)
  await f.call(a, 'POST', '/call', { swarm, message: 'take this' }, 'agent')
  await f.call(a, 'POST', '/call', { swarm: other, message: 'keep this' }, 'agent')
  await f.call(a, 'POST', '/input', { route: { swarm, points: [{ x: 150, y: 150 }, { x: 200, y: 150 }] } })
  const after = await f.call(a, 'GET', '/state')
  assert.deepEqual(after.calls.map(c => c.swarm), [other])
  assert.match(after.feed.at(-1).text, /routed swarm/)
})


test('accepted identical human routes and orders clear only their calls without simulation or journal changes', async () => {
  for (const kind of ['route', 'order']) {
    const f = fixture(), a = await f.session(kind)
    await f.call(a, 'POST', '/play', { vs: 'normal', withAgent: true, planning: 10 })
    await f.call(a, 'GET', '/next', {}, 'agent'); f.advance(10000)
    const frame = await f.call(a, 'GET', '/state'), [swarm, other] = frame.view.swarms.map(s => s.id)
    const input = kind === 'route' ? { route: { swarm, points: [{ x: 150, y: 150 }, { x: 200, y: 150 }] } } : { order: { swarm, x: 150, y: 150 } }
    await f.call(a, 'POST', '/input', input)
    await f.call(a, 'POST', '/call', { swarm, message: 'take this' }, 'agent')
    await f.call(a, 'POST', '/call', { swarm: other, message: 'keep this' }, 'agent')
    const before = await f.call(a, 'GET', '/state')
    const logBefore = await f.store.get(`log:${frame.matchId}:0`)
    assert.deepEqual(await f.call(a, 'POST', '/input', input, 'agent'), { ok: true })
    await assert.rejects(f.call(a, 'POST', '/input', { ...input, toggle: 999 }), { status: 400 })
    assert.deepEqual((await f.call(a, 'GET', '/state')).calls, before.calls)
    assert.deepEqual(await f.call(a, 'POST', '/input', input), { ok: true })
    const after = await f.call(a, 'GET', '/state')
    assert.deepEqual(after.calls.map(c => c.swarm), [other])
    assert.deepEqual(after.view, before.view)
    assert.deepEqual(after.feed, before.feed)
    assert.equal(await f.store.get(`log:${frame.matchId}:0`), logBefore)
  }
})
