import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OnlineGame } from '../online/game.js'
import { MemoryStore } from '../online/store.js'

test('a match stays playable when a recorded order no longer applies', async () => {
  let now = 1_800_000_000_000
  const store = new MemoryStore(() => now), game = new OnlineGame(store, { now: () => now, seed: () => 42 })
  const session = await game.request('POST', '/session', new URLSearchParams(), { name: 'A' })
  const q = new URLSearchParams({ token: session.humanToken })
  await game.request('POST', '/play', q, { vs: 'hard', withAgent: false, planning: 10 })
  now += 11000
  const bat = (await game.request('GET', '/state', q)).view.battalions[0].id
  assert.deepEqual(await game.request('POST', '/input', q, { order: { bat, x: 300, y: 350 } }), { ok: true })
  // The record of an order the rules now refuse (as after a release that tightens them).
  const [key, record] = [...store.data].find(([k]) => k.startsWith('log:')), log = JSON.parse(record.value)
  log[log.length - 1].input = { order: { bat: 9999, x: 300, y: 350 } }
  store.data.set(key, { ...record, value: JSON.stringify(log) })
  const cold = new OnlineGame(store, { now: () => now, seed: () => 42 })
  const state = await cold.request('GET', '/state', q)
  assert.equal(state.view.battalions.find(b => b.id === bat).manual, false)
  assert.deepEqual(await cold.request('POST', '/input', q, { order: { bat, x: 320, y: 350 } }), { ok: true })
})
