// Reproducible capacity fixture, not a claim about live deployment latency.
import { performance } from 'node:perf_hooks'
import { createMatch, fromJSON, step, applyInput, addSwarm, TPS } from '../sim.js'
const samples = Number(process.env.SAMPLES || 8)
const fixture = () => {
  const s = createMatch(631, { minutes: 8, planets: 40 })
  const initial = s.toJSON(); initial.swarms = []; s.load(initial)
  for (const side of [0, 1]) {
    applyInput(s, side, { gambits: [{ if: 'always', then: 'hold' }] })
    for (let i = 0; i < 40; i++) {
      addSwarm(s, side, 40 + side * 650 + (i % 5) * 95, 35 + Math.floor(i / 5) * 85, 500)
    }
  }
  const data = s.toJSON(); for (const c of data.swarms) c.noMerge = s.endTick + 1; s.load(data)
  return s
}
const replay = [], checkpoint = [], serialized = []
for (let i = 0; i < samples; i++) {
  const s = fixture(), start = performance.now()
  while (!s.ended) step(s)
  replay.push(performance.now() - start)
  const bytes = JSON.stringify(s); serialized.push(Buffer.byteLength(bytes))
  // Resume immediately before the final frame, retaining the 80-swarm fixture.
  const nearEnd = fixture(), data = nearEnd.toJSON(); data.tick = data.endTick - 2; nearEnd.load(data)
  const snapshot = JSON.stringify(nearEnd), t = performance.now()
  const resumed = fromJSON(snapshot); step(resumed); step(resumed); JSON.stringify(resumed)
  checkpoint.push(performance.now() - t)
}
const p95 = a => [...a].sort((a, b) => a - b)[Math.ceil(a.length * .95) - 1]
const fullMs = p95(replay), incrementalMs = p95(checkpoint)
const cpuRate = .128, memRate = .0106, seconds = 480, fps = 10
const out = {
  fixture: '8 minutes, 40 planets, 40 stationary swarms per side, merge deferred to retain worst-case count',
  node: process.version, samples, replayMs: replay, checkpointMs: checkpoint,
  replayP95Ms: fullMs, checkpointP95Ms: incrementalMs, snapshotBytes: Math.max(...serialized),
  estimatesUSD: {
    // 2 browser requests/frame, assuming linear replay growth; excludes network/store/report CPU.
    replayCPU: (2 * fps * seconds * fullMs / 2 / 1000 / 3600) * cpuRate,
    checkpointCPU: (fps * seconds * incrementalMs / 1000 / 3600) * cpuRate,
    fluidMemory2GBOneInstance: (2 * seconds / 3600) * memRate,
    fluidMemory2GBTwoInstances: (4 * seconds / 3600) * memRate,
    source: 'https://vercel.com/docs/functions/usage-and-pricing (iad1: CPU $0.128/h, memory $0.0106/GB-h)',
  },
  note: 'Local CPU-only measurements. Live HTTP p95 and SSE throughput must be measured on preview; no network latency is included here.',
}
console.log(JSON.stringify(out, null, 2))
