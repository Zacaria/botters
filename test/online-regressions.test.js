import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OnlineGame } from '../online/game.js'
import { MemoryStore } from '../online/store.js'
import { replay, snapshot } from '../sim.js'
function fixture() {
  let now = 1_800_000_000_000
  const store = new MemoryStore(() => now), game = new OnlineGame(store, { now: () => now, seed: () => 12345, stateCache: new Map() })
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

test('lobby skips history entries saved before the particle war', async () => {
  const f = fixture(), a = await f.session('a')
  const [key, record] = [...f.store.data].find(([k]) => k.startsWith('session:'))
  record.value = JSON.stringify({ ...JSON.parse(record.value), history: [{ matchId: 'm-old', actual: 'won', humanInputs: 3, vs: 'house', reason: 'time' }] })
  assert.ok(key)
  await f.call(a, 'POST', '/play', { vs: 'easy', withAgent: false })
  await f.advance(6000)
  await f.call(a, 'POST', '/surrender')
  const lobby = await f.call(a, 'GET', '/lobby')
  assert.equal(lobby.history.length, 1)
  assert.equal(lobby.history[0].result, 'lost')
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
  assert.equal(m.logCount, 72); assert.equal(m.log, undefined) // house opening gambits and breed plus 70 toggles
  assert.equal(JSON.parse(await f.store.get(`log:${m.id}:0`)).length, 64)
  assert.equal(JSON.parse(await f.store.get(`log:${m.id}:1`)).length, 8)
  const original = f.store.get.bind(f.store)
  f.store.get = async key => { assert.ok(!key.startsWith('log:')); return original(key) }
  await f.call(a, 'GET', '/state')
  f.store.get = original
  await f.call(a, 'POST', '/surrender')
  const ended = await f.call(a, 'GET', '/state')
  assert.ok(ended.report && ended.view.ended)
})

test('commands are refused while a cold match is catching up', async () => {
  const f = fixture(), a = await f.session('catchup')
  await f.call(a, 'POST', '/play', { vs: 'normal', minutes: 3, planning: 10, withAgent: false })
  f.advance(200000)
  await assert.rejects(f.call(a, 'POST', '/input', { toggle: 0 }), { status: 503 })
  await assert.rejects(f.call(a, 'POST', '/surrender'), { status: 503 })
})

test('order and detach journal canonical inputs and replay the checkpoint', async () => {
  const f = fixture(), a = await f.session('orders')
  await f.call(a, 'POST', '/play', { vs: 'normal', withAgent: false, planning: 10 })
  f.advance(10000)
  const frame = await f.call(a, 'GET', '/state'), bat = frame.view.battalions[0].id
  await f.call(a, 'POST', '/input', { order: { bat, x: 150, y: 150, padding: 'x'.repeat(15000) } })
  const detached = await f.call(a, 'POST', '/input', { detach: { bat, role: 'runner', padding: 'x'.repeat(15000) } })
  assert.ok(Number.isInteger(detached.bat))
  await f.call(a, 'POST', '/surrender')
  const log = JSON.parse(await f.store.get(`log:${frame.matchId}:0`))
  assert.deepEqual(log.at(-3).input, { order: { bat, x: 150, y: 150 } })
  assert.deepEqual(log.at(-2).input, { detach: { bat, role: 'runner' } })
  const saved = JSON.parse(await f.store.get(`state:${frame.matchId}`))
  assert.deepEqual(snapshot(replay(saved.seed, log, { ...saved.opts, tick: saved.tick })), saved)
})
