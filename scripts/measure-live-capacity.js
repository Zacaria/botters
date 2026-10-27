// Explicit 80-swarm CPU/transport fixture, not live player traffic or a full match.
import assert from 'node:assert/strict'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { Client } from '@colyseus/sdk'
import { createLiveServer } from '../online/live-server.js'
import { createMatch, applyInput, addSwarm } from '../sim.js'
const count = Number(process.env.MATCHES || 8), seconds = Number(process.env.SECONDS || 30)
const service = await createLiveServer({ origin: 'http://127.0.0.1', origins: ['http://127.0.0.1'] })
// Exercise capacity above the production admission limit without changing it.
Object.defineProperty(service.runtime.rooms, 'size', { get: () => 0 })
const { port } = await service.listen(), base = `http://127.0.0.1:${port}`, clients = [], views = [], tokens = []
const query = token => new URLSearchParams({ token })
const percentile = values => values.toSorted((a, b) => a - b)[Math.ceil(values.length * .95) - 1]
try {
  for (let i = 0; i < count; i++) {
    const pair = []
    for (let side = 0; side < 2; side++) pair.push(await service.runtime.request('POST', '/session', undefined, { name: `capacity-${i}-${side}`, setup: 'fixture' }))
    for (const p of pair) await service.runtime.request('POST', '/play', query(p.humanToken), { vs: 'player', minutes: 8, planning: 10, planets: 40 })
    for (const p of pair) { await service.runtime.request('GET', '/next', query(p.agentToken)); tokens.push(p.agentToken) }
    const frame = await service.runtime.request('GET', '/state', query(pair[0].humanToken))
    await service.runtime.serialize(() => {
      const key = `match:${frame.matchId}`, m = JSON.parse(service.store.raw(key)), s = createMatch(631 + i, { minutes: 8, planets: 40 })
      s.swarms = []
      for (const side of [0, 1]) {
        applyInput(s, side, { gambits: [{ if: 'always', then: 'hold' }] })
        for (let n = 0; n < 40; n++) {
          const swarm = addSwarm(s, side, 40 + side * 650 + n % 5 * 95, 35 + Math.floor(n / 5) * 85, 500)
          swarm.noMerge = s.endTick + 1
        }
      }
      m.s = s; m.startsAt = Date.now(); service.store.put(key, JSON.stringify(m))
    })
    for (const p of pair) {
      const stats = { first: 0, last: 0, frames: 0, intervals: [] }, room = await new Client(base).joinById(service.runtime.rooms.get(frame.matchId), { token: p.humanToken })
      clients.push(room); views.push(stats)
      room.onMessage('frame', f => {
        assert.equal(f.s, undefined); assert.equal(f.log, undefined)
        const now = performance.now()
        if (stats.last) stats.intervals.push(now - stats.last)
        stats.first ||= now; stats.last = now; stats.frames++
      })
    }
  }
  // Exclude setup so every view has the same measured window.
  for (const s of views) { s.first = 0; s.last = 0; s.frames = 0; s.intervals = [] }
  const loop = monitorEventLoopDelay({ resolution: 20 }); loop.enable()
  const cpu = process.cpuUsage(), started = performance.now(); let inputs = 0, peakRss = 0
  while (performance.now() - started < seconds * 1000) {
    const at = performance.now()
    for (const token of tokens) {
      const response = await fetch(`${base}/input?token=${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gambits: [{ if: 'always', then: 'hold' }] }) })
      assert.equal(response.status, 200); inputs++
    }
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
    await new Promise(r => setTimeout(r, Math.max(0, 1000 - (performance.now() - at))))
  }
  loop.disable(); const used = process.cpuUsage(cpu), elapsedMs = performance.now() - started
  const streams = views.map(s => ({ fps: (s.frames - 1) * 1000 / (s.last - s.first), frameP95Ms: percentile(s.intervals) }))
  console.log(JSON.stringify({ node: process.version, matches: count, swarmsPerMatch: 80, planets: 40, views: views.length, elapsedMs, inputs, peakRss, cpuPercentOneCore: (used.user + used.system) / elapsedMs / 10, eventLoopP95Ms: loop.percentile(95) / 1e6, minimumFps: Math.min(...streams.map(s => s.fps)), maximumFrameP95Ms: Math.max(...streams.map(s => s.frameP95Ms)), passed: streams.every(s => s.fps >= 10), note: 'Synthetic stationary 80-swarm matches, two real loopback WebSocket views each and one HTTP input per second per agent. Same Lightsail instance and image/cgroup limits; no Caddy/WAN/Convex and not full-length concurrent matches. The production eight-minute test covers those paths separately.' }, null, 2))
  assert.ok(streams.every(s => s.fps >= 10))
} finally { await Promise.allSettled(clients.filter(c => c.connection?.isOpen).map(c => c.leave())); await service.close() }
