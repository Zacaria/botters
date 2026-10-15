import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { MemoryStore } from '../online/store.js'
import { OnlineGame } from '../online/game.js'
const identity = (name, setup) => createHash('sha256').update(JSON.stringify([name, setup])).digest('hex')

test('per-identity Elo exceeds 1MiB in aggregate without any oversized record; board stays bounded and exact', async () => {
  const store = new MemoryStore(), now = Date.now()
  for (let i = 0; i < 10000; i++) {
    const name = `player-${i}`.padEnd(24, 'x'), setup = 'setup'.padEnd(40, 'x')
    const value = JSON.stringify({ name, setup, rating: 1000 + i, games: 2 })
    store.data.set(`elo:${identity(name, setup)}`, { value, expires: 0 })
  }
  assert.ok([...store.data.values()].reduce((n, r) => n + Buffer.byteLength(r.value), 0) > 1024 * 1024)
  const game = new OnlineGame(store, { now: () => now })
  const board = await game.request('GET', '/leaderboard')
  assert.equal(board.leaderboard.length, 10)
  assert.deepEqual(board.leaderboard.map(p => p.rating), Array.from({ length: 10 }, (_, i) => 10999 - i))
  const session = await game.request('POST', '/session', undefined, { name: 'new-player' }), q = new URLSearchParams({ token: session.humanToken })
  await game.request('POST', '/play', q, { vs: 'easy', minutes: 3, planets: 16, planning: 10, withAgent: false })
  const cold = new OnlineGame(store, { now: () => now + 200000 })
  const lobby = await cold.request('GET', '/lobby', q)
  assert.equal(lobby.history.length, 1)
  assert.equal(lobby.leaderboard.length, 10)
  const rated = JSON.parse(await store.get(`elo:${identity('new-player', 'no agent')}`))
  assert.equal(rated.games, 1)
  assert.ok([...store.data.values()].every(r => Buffer.byteLength(r.value) < 1024 * 1024))
  assert.equal(await store.get('elo'), null, 'No aggregate Elo document')
})
