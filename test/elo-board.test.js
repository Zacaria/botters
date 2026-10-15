import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { MemoryStore } from '../online/store.js'
import { OnlineGame } from '../online/game.js'
const id = name => createHash('sha256').update(JSON.stringify([name, 'no agent'])).digest('hex')

test('finish overlays rating drops before returning an exact top ten', async () => {
  const store = new MemoryStore(), game = new OnlineGame(store)
  for (let i = 0; i < 14; i++) store.data.set(`elo:${id(`p${i}`)}`, { value: JSON.stringify({ name: `p${i}`, setup: 'no agent', rating: 1000 + i, games: 1 }), expires: 0 })
  const sessions = await Promise.all(['p13', 'p0'].map(name => game.request('POST', '/session', undefined, { name })))
  const q = sessions.map(s => new URLSearchParams({ token: s.humanToken }))
  await Promise.all(q.map(params => game.request('POST', '/play', params, { vs: 'player', minutes: 3, withAgent: false })))
  const frame = await game.request('GET', '/state', q[0]), key = `match:${frame.matchId}`
  const m = JSON.parse(await store.get(key)); m.s.tick = m.s.endTick
  const losingSide = m.players.findIndex(p => p.name === 'p13')
  m.s.ended = { winner: 1 - losingSide, reason: 'time' }
  store.data.set(key, { value: JSON.stringify(m), expires: 0 })
  const lobby = await game.request('GET', '/lobby', q[0])
  assert.equal(lobby.leaderboard.length, 10)
  assert.ok(lobby.leaderboard.every(p => p.name !== 'p13'))
  const all = [...store.data].filter(([k]) => k.startsWith('elo:')).map(([, r]) => JSON.parse(r.value)).sort((a, b) => b.rating - a.rating).slice(0, 10)
  assert.deepEqual(lobby.leaderboard.map(p => p.name), all.map(p => p.name))
})
