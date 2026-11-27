import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OnlineGame } from '../online/game.js'
import { MemoryStore } from '../online/store.js'

test('an agent cannot start a house match while its human waits for a player', async () => {
  let now = 1_800_000_000_000; const game = new OnlineGame(new MemoryStore(() => now), { now: () => now, seed: () => 12345, stateCache: new Map() })
  const a = await game.request('POST', '/session', undefined, { name: 'a' })
  const call = (role, method, path, body = {}) => game.request(method, path, new URLSearchParams({ token: a[`${role}Token`] }), body)
  assert.deepEqual(await call('human', 'POST', '/play', { vs: 'player', withAgent: false, planning: 10 }), { ok: true, queued: true })
  await assert.rejects(call('agent', 'POST', '/play', { vs: 'easy' }), { status: 409, message: 'Your human is waiting for a player.' })
  const lobby = await call('human', 'GET', '/lobby')
  assert.equal(lobby.queued, true); assert.equal(lobby.inMatch, false)
  now += 91000 // the human left: the wait lapses without the lobby open
  assert.deepEqual(await call('agent', 'POST', '/play', { vs: 'easy' }), { ok: true })
})
