import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LiveStore } from '../online/live-store.js'
import { LiveRuntime } from '../online/live-runtime.js'
import { MemoryStore } from '../online/store.js'
const q = token => new URLSearchParams({ token })

test('live ticks, inputs and frames never touch durable storage; results persist once', async t => {
  let now = Date.now(), calls = 0
  const durable = new MemoryStore(() => now)
  const remote = {
    async get(key) { calls++; return durable.get(key) },
    async read(keys) { calls++; return keys.map(key => durable.raw(key)) },
    async commit(entries) { calls++; return durable.commit(entries) },
  }
  const store = new LiveStore(remote, { now: () => now })
  const runtime = new LiveRuntime(store, { now: () => now })
  t.after(() => runtime.close())
  const a = await runtime.request('POST', '/session', undefined, { name: 'A', setup: 'agent' })
  const b = await runtime.request('POST', '/session', undefined, { name: 'B', setup: 'agent' })
  await runtime.request('POST', '/play', q(a.humanToken), { vs: 'player', minutes: 8, planets: 40, planning: 10 })
  await runtime.request('POST', '/play', q(b.humanToken), { vs: 'player', minutes: 8, planets: 40, planning: 10 })
  await runtime.request('GET', '/next', q(a.agentToken))
  await runtime.request('GET', '/next', q(b.agentToken))
  const before = calls
  for (let i = 0; i < 100; i++) {
    now += 50
    const frame = await runtime.request('GET', '/state', q(a.humanToken))
    assert.equal(frame.s, undefined)
    assert.equal(frame.log, undefined)
    await runtime.request('GET', '/events', q(b.agentToken))
  }
  assert.equal(calls, before)
  now += 5000
  for (let i = 0; i < 5; i++) await runtime.request('POST', '/input', q(a.agentToken), { gambits: [{ if: 'always', then: 'hold' }] })
  await assert.rejects(runtime.request('POST', '/input', q(a.agentToken), { gambits: [{ if: 'always', then: 'hold' }] }), e => e.status === 429)
  assert.equal(calls, before)
  now += 480000
  const frame = await runtime.request('GET', '/state', q(a.humanToken))
  assert.ok(frame.report.actual)
  const once = calls
  await runtime.request('GET', '/state', q(a.humanToken))
  assert.equal(calls, once)
  const result = JSON.parse(durable.raw(`result:${frame.matchId}`))
  assert.equal(result.id, frame.matchId)
  assert.equal(result.players.length, 2)
  assert.ok(calls <= 50, `actual adapter calls: ${calls}`)
  const session = JSON.parse(durable.raw(`session:${result.players[0].session}`))
  assert.equal(session.history.filter(h => h.matchId === frame.matchId).length, 1)
})

test('a failed durable boundary leaves no local result or rating to double-apply', async t => {
  let now = Date.now(), fail = false
  const durable = new MemoryStore(() => now)
  const store = new LiveStore({
    get: key => durable.get(key), read: keys => Promise.resolve(keys.map(key => durable.raw(key))),
    commit: entries => { if (fail) throw new Error('offline'); return durable.commit(entries) },
  }, { now: () => now })
  const runtime = new LiveRuntime(store, { now: () => now }); t.after(() => runtime.close())
  const a = await runtime.request('POST', '/session', undefined, { name: 'A' })
  await runtime.request('POST', '/play', q(a.humanToken), { minutes: 3, planning: 10 })
  now += 200000; fail = true
  await assert.rejects(runtime.request('GET', '/state', q(a.humanToken)), /offline/)
  fail = false
  const frame = await runtime.request('GET', '/state', q(a.humanToken))
  const result = JSON.parse(durable.raw(`result:${frame.matchId}`))
  assert.ok(result.report[0].actual)
  const session = JSON.parse(durable.raw(`session:${result.players[0].session}`))
  assert.equal(session.history.length, 1)
})
