import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as sim from '../sim.js'
import { OnlineGame } from '../online/game.js'
import { MemoryStore } from '../online/store.js'
import { fixture } from './local.test.js'

test('breed validation, production and snapshot round trip', () => {
  for (const breed of sim.BREEDS) {
    const s = sim.createMatch(42)
    assert.equal(sim.applyInput(s, 0, { breed: 'unknown' }).ok, false)
    assert.deepEqual(sim.applyInput(s, 0, { breed }), { ok: true })
    assert.equal(sim.restore(sim.snapshot(s)).breed[0], breed)
    const before = s.alive.slice()
    sim.advanceTo(s, 20)
    const born = []
    for (let i = 0; i < sim.MAXPER; i++) if (!before[i] && s.alive[i]) born.push(sim.ROLES[s.role[i]].name)
    assert.ok(born.length > 0)
    assert.ok(born.every(role => role === breed))
  }
})

test('local agent and human may change breed while planning', async t => {
  const { origin, post } = await fixture(t, '60000')
  const s = (await post('/session', { setup: 'test' })).body
  await post(`/play?token=${s.humanToken}`, { withAgent: true })
  await fetch(`${origin}/next?token=${s.agentToken}&timeout=1`)
  assert.equal((await post(`/input?token=${s.agentToken}`, { breed: 'tank', why: 'counter grunts' })).status, 200)
  let frame = await fetch(`${origin}/state?token=${s.humanToken}`).then(r => r.json())
  assert.equal(frame.view.breed, 'tank')
  assert.deepEqual(frame.edits.at(-1), { t: 0, who: 'agent', why: 'counter grunts', change: 'breed grunt → tank' })
  assert.equal((await post(`/input?token=${s.humanToken}`, { breed: 'runner' })).status, 200)
  const events = await fetch(`${origin}/events?token=${s.agentToken}&since=0&timeout=0`).then(r => r.json())
  assert.ok(events.events.some(e => e.text === 'HUMAN switched breed to runner'))
})

test('online house seed, breed edits and replay survive cold load', async () => {
  let now = 100000
  const store = new MemoryStore(() => now), game = new OnlineGame(store, { now: () => now, seed: () => 44 })
  const s = await game.request('POST', '/session', new URLSearchParams(), { setup: 'test' })
  const h = new URLSearchParams({ token: s.humanToken }), a = new URLSearchParams({ token: s.agentToken })
  await game.request('POST', '/play', h, { withAgent: true })
  const id = (await game.request('GET', '/state', h)).matchId
  await game.request('GET', '/next', a)
  assert.deepEqual(await game.request('POST', '/input', a, { breed: 'tank', why: 'counter' }), { ok: true })
  await game.request('POST', '/input', h, { breed: 'runner' })
  const cold = new OnlineGame(store, { now: () => now })
  const state = await cold.request('GET', '/state', h)
  assert.equal(state.view.breed, 'runner')
  assert.deepEqual(state.edits.at(-2), { t: 0, who: 'agent', why: 'counter', change: 'breed grunt → tank' })
  const log = JSON.parse(await store.get(`log:${id}:0`))
  assert.ok(log.some(e => e.side === 1 && e.role === 'house' && e.tick === 0 && e.input.breed === sim.BREEDS[44 % 3]))
  assert.ok(log.some(e => e.side === 0 && e.role === 'agent' && e.input.breed === 'tank'))
  const events = await cold.request('GET', '/events', a)
  assert.ok(events.events.some(e => e.text === 'HUMAN switched breed to runner'))
})
