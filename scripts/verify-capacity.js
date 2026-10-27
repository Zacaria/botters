// Live preview-only capacity fixture; never mutate a public player's match.
import assert from 'node:assert/strict'
import { ConvexStore } from '../online/store.js'
import { createMatch, addSwarm, applyInput } from '../sim.js'
const base = process.env.BOTTERS_SERVER, store = new ConvexStore()
assert.ok(base && new URL(base).hostname.startsWith('botters-') && new URL(base).hostname.endsWith('.vercel.app'), 'Use a unique Vercel preview, never production')
assert.equal(store.prefix, 'botters:preview:')
const headers = { 'Content-Type': 'application/json', 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
const request = async (path, body) => {
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(55000) })
  const data = await r.json(); assert.equal(r.status, 200, data.error); return data
}
const run = Date.now().toString(36)
const sessions = await Promise.all([0, 1].map(side => request('/session', { name: `capacity-${run}-${side}` })))
await Promise.all(sessions.map(s => request(`/play?token=${s.humanToken}`, { vs: 'player', minutes: 8, planets: 40, withAgent: false })))
const first = await request(`/state?token=${sessions[0].humanToken}`), key = `match:${first.matchId}`
const original = JSON.parse(await store.get(key))
const m = structuredClone(original)
m.s = createMatch(631, { minutes: 8, planets: 40 }); { const data = m.s.toJSON(); data.swarms = []; m.s.load(data) }
for (const side of [0, 1]) {
  applyInput(m.s, side, { gambits: [{ if: 'always', then: 'hold' }] })
  for (let i = 0; i < 40; i++) {
    addSwarm(m.s, side, 40 + side * 650 + i % 5 * 95, 35 + Math.floor(i / 5) * 85, 500)
  }
}
// Synthetic late checkpoint: capacity, not an eight-minute wall-clock gameplay claim.
{ const data = m.s.toJSON(); data.tick = 9400; for (const c of data.swarms) c.noMerge = data.endTick + 1; m.s.load(data) }
for (const p of m.players) p.prev = null
const reset = async () => {
  m.startsAt = Date.now() - 9402 * 50
  const raw = await store.get(key)
  assert.equal(await store.commit([{ key, raw, value: JSON.stringify(m), ttl: 600 }]), 1)
}
const samples = []
for (let i = 0; i < 50; i++) {
  await reset()
  const start = performance.now(), frame = await request(`/state?token=${sessions[i % 2].humanToken}`)
  assert.ok(frame.view.tick >= 9402 && !frame.view.ended)
  samples.push(performance.now() - start)
}
await reset()
const stream = async s => {
  const controller = new AbortController(), times = [], ticks = []
  const r = await fetch(`${base}/stream?token=${s.humanToken}`, { headers, signal: controller.signal })
  assert.equal(r.status, 200)
  let buffer = ''
  try {
    for await (const chunk of r.body) {
      buffer += new TextDecoder().decode(chunk)
      let i
      while ((i = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, i); buffer = buffer.slice(i + 2)
        if (!event.startsWith('data: ')) continue
        const f = JSON.parse(event.slice(6)); assert.ok(f.view && !f.s && !f.log)
        times.push(performance.now()); ticks.push(f.view.tick)
        if (times.length >= 40) break
      }
      if (times.length >= 40) break
    }
  } finally { controller.abort() }
  return { frames: times.length, fps: (times.length - 1) * 1000 / (times.at(-1) - times[0]), firstTick: ticks[0], lastTick: ticks.at(-1) }
}
const streams = await Promise.all(sessions.map(stream))
const sorted = [...samples].sort((a, b) => a - b)
console.log(JSON.stringify({ server: base, fixture: 'actual Vercel iad1 + free Convex US East; 8-minute/40-planet settings, 40 stationary swarms per side; synthetic 470-second checkpoint reset before each HTTP sample, then two simultaneous 40-frame streams; not a wall-clock 8-minute match', samples: samples.length, requestP95Ms: sorted[Math.ceil(sorted.length * .95) - 1], streams, passes10Fps: streams.every(s => s.frames === 40 && s.fps >= 10), requestMs: samples }, null, 2))
assert.ok(streams.every(s => s.frames === 40 && s.fps >= 10), 'Both delivered streams must sustain >=10fps for 40 frames')
