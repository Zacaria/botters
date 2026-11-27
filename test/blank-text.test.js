import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OnlineGame } from '../online/game.js'
import { MemoryStore } from '../online/store.js'

test('a name or chat message with nothing to read counts as empty', async () => {
  const now = 1_800_000_000_000, game = new OnlineGame(new MemoryStore(() => now), { now: () => now, seed: () => 12345, stateCache: new Map() })
  const session = name => game.request('POST', '/session', undefined, { name })
  const call = (s, method, path, body = {}) => game.request(method, path, new URLSearchParams({ token: s.humanToken }), body)
  const a = await session('alice'), b = await session('bob'), blank = '\u200b\u200d\u200e\u200f\u2060\u3164\u2800'
  await call(a, 'POST', '/profile', { name: blank })
  assert.equal((await call(a, 'GET', '/lobby')).name, 'alice')
  await call(a, 'POST', '/profile', { name: 'سلام\u200cدنیا 👨\u200d👩\u200d👧' })
  assert.equal((await call(a, 'GET', '/lobby')).name, 'سلام\u200cدنیا 👨\u200d👩\u200d👧')
  await call(a, 'POST', '/play', { vs: 'player', withAgent: false, planning: 10 })
  await call(b, 'POST', '/play', { vs: 'player', withAgent: false, planning: 10 })
  await assert.rejects(call(b, 'POST', '/chat', { text: blank }), { status: 400 })
  assert.deepEqual(await call(b, 'POST', '/chat', { text: 'gl hf' }), { ok: true })
})
