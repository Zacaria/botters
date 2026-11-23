// Offline arena: plays sim.js matches headless, in parallel worker threads.
// A side is { gambits } (fixed rules) or { gambits, script } where script(view, state) may return new gambits once per second,
// seeing exactly what an agent sees (sim.view, fogged). Scripts are looked up by name in strategies.mjs so workers can load them.
import { Worker, isMainThread, parentPort } from 'node:worker_threads'
import { availableParallelism } from 'node:os'
import { createMatch, applyInput, step, view, count, owned, TPS, checkGambits } from '../../sim.js'
import { SCRIPTS } from './strategies.mjs'

export function playMatch({ seed, minutes = 5, planets = 17, sides }) {
  const s = createMatch(seed, { minutes, planets }), edits = [0, 0], memo = [{}, {}]
  sides.forEach((side, k) => { const r = applyInput(s, k, { gambits: side.gambits }); if (!r.ok) throw new Error(`side ${k}: ${r.error}`) })
  const scripts = sides.map(side => side.script ? SCRIPTS[side.script] : null)
  let lead = null, leadChanges = 0
  while (!s.ended) {
    step(s)
    if (s.tick % TPS) continue
    for (let k = 0; k < 2; k++) if (scripts[k]) {
      const next = scripts[k](view(s, k), memo[k], sides[k].arg)
      if (next) { const e = checkGambits(next); if (e) throw new Error(`${sides[k].script}: ${e}`); applyInput(s, k, { gambits: next }); edits[k]++ }
    }
    const pl = owned(s), now = pl[0] > pl[1] ? 0 : pl[1] > pl[0] ? 1 : lead
    if (now !== lead && lead !== null) leadChanges++
    lead = now
  }
  return { seed, winner: s.ended.winner, reason: s.ended.reason, t: s.tick / TPS, units: count(s), planets: owned(s), edits, leadChanges }
}

// run(jobs) → results in job order. job = { seed, minutes, planets, sides }
export async function run(jobs, threads = Math.max(1, availableParallelism() - 1)) {
  const out = new Array(jobs.length); let next = 0
  await Promise.all(Array.from({ length: Math.min(threads, jobs.length) }, () => new Promise((ok, ko) => {
    const w = new Worker(new URL(import.meta.url))
    const feed = () => { if (next >= jobs.length) { w.terminate(); return ok() } const i = next++; w.postMessage({ i, job: jobs[i] }) }
    w.on('message', ({ i, result, error }) => { if (error) { w.terminate(); return ko(new Error(error)) } out[i] = result; feed() })
    w.on('error', ko); feed()
  })))
  return out
}

if (!isMainThread) parentPort.on('message', ({ i, job }) => {
  try { parentPort.postMessage({ i, result: playMatch(job) }) } catch (e) { parentPort.postMessage({ i, error: String(e.stack || e) }) }
})

// Score of side A against side B over seeds, each seed played from both sides (the map is mirrored, so this cancels any side bias).
export async function duel(a, b, seeds, opts = {}) {
  const jobs = []
  for (const seed of seeds) { jobs.push({ seed, ...opts, sides: [a, b] }); jobs.push({ seed, ...opts, sides: [b, a] }) }
  const res = await run(jobs, opts.threads)
  let win = 0, loss = 0, draw = 0
  res.forEach((r, i) => { const aSide = i % 2 ? 1 : 0; if (r.winner === null) draw++; else if (r.winner === aSide) win++; else loss++ })
  return { win, loss, draw, n: res.length, score: (win + draw / 2) / res.length, res }
}
