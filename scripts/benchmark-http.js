// Capacity fixture through the real HTTP adapter, using explicitly ephemeral local storage.
import http from 'node:http'
import { createHandler } from '../online/http.js'
import { MemoryStore } from '../online/store.js'
import { OnlineGame } from '../online/game.js'
import { createMatch, addSwarm, applyInput } from '../sim.js'
const now = Date.now(), store = new MemoryStore(() => now), game = new OnlineGame(store, { now: () => now })
const session = await game.request('POST', '/session', undefined, { name: 'capacity-fixture' })
const q = new URLSearchParams({ token: session.humanToken })
await game.request('POST', '/play', q, { vs: 'easy', minutes: 8, planets: 40, withAgent: false })
const first = await game.request('GET', '/state', q)
const m = JSON.parse(await store.get(`match:${first.matchId}`))
m.s = createMatch(631, { minutes: 8, planets: 40 }); m.s.swarms = []
for (const side of [0, 1]) {
  applyInput(m.s, side, { gambits: [{ if: 'always', then: 'hold' }] })
  for (let i = 0; i < 40; i++) {
    const c = addSwarm(m.s, side, 40 + side * 650 + i % 5 * 95, 35 + Math.floor(i / 5) * 85, 500)
    c.noMerge = m.s.endTick + 1
  }
}
// Every sample starts at the same 479.5-second checkpoint and computes two real simulation ticks.
m.s.tick = 9590; m.startsAt = now - 9592 * 50
const checkpoint = JSON.stringify(m), samples = []
let handler
const server = http.createServer((req, res) => handler(req, res))
await new Promise(r => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`
handler = createHandler(store, { origin, now: () => now })
try {
  for (let i = 0; i < 100; i++) {
    store.data.set(`match:${m.id}`, { value: checkpoint, expires: 0 })
    const start = performance.now(), res = await fetch(`${origin}/state?${q}`), body = await res.json()
    if (res.status !== 200 || body.view.tick !== 9592) throw new Error('Capacity fixture failed to advance')
    samples.push(performance.now() - start)
  }
  const sorted = [...samples].sort((a, b) => a - b)
  console.log(JSON.stringify({ fixture: '8-minute/40-planet capacity fixture, 40 stationary swarms per side, merge deferred; synthetic checkpoint at 479.5s advanced by two ticks for each request', storage: 'MemoryStore, localhost HTTP, no Redis network; not Vercel latency', samples: samples.length, p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], requestMs: samples }, null, 2))
} finally { server.closeAllConnections(); await new Promise(r => server.close(r)) }
