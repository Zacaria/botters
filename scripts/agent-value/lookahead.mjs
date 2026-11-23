// Upper bound for an agent that edits gambits mid-match: an oracle that, every `every` seconds, forks the match
// (snapshot/restore, exact), plays each candidate set to the end against the fixed opponent, and keeps the best.
// It knows the opponent's rules and the future, which no agent does. If even this cannot beat the fixed set, live editing has no value.
// node scripts/agent-value/lookahead.mjs <seeds> <opponentSet> <candidates,comma> <every_s> <until_s> <threads> <out.json>
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { writeFileSync } from 'node:fs'
import { createMatch, applyInput, step, snapshot, restore, advanceTo, count, owned, TPS } from '../../sim.js'
import { SETS } from './strategies.mjs'

function value(s, me) { // win > draw > loss, then planets, then units
  const w = s.ended?.winner, pl = owned(s), n = count(s)
  return (w === me ? 2 : w === null || w === undefined ? 1 : 0) * 1e6 + (pl[me] - pl[1 - me]) * 1e4 + (n[me] - n[1 - me])
}
function oracle({ seed, me, opp, cands, every, until }) {
  const s = createMatch(seed)
  applyInput(s, 1 - me, { gambits: SETS[opp] })
  const plan = []
  for (let t = 0; t <= until && !s.ended; t += every) {
    advanceTo(s, t * TPS); if (s.ended) break
    const snap = snapshot(s); let best = null
    for (const c of cands) {
      const f = restore(snap); applyInput(f, me, { gambits: SETS[c] }); advanceTo(f, f.endTick + 1)
      const v = value(f, me); if (!best || v > best.v) best = { c, v }
    }
    applyInput(s, me, { gambits: SETS[best.c] }); plan.push({ t, set: best.c })
  }
  advanceTo(s, s.endTick + 1)
  const fixed = cands.map(c => { const f = createMatch(seed); applyInput(f, 1 - me, { gambits: SETS[opp] }); applyInput(f, me, { gambits: SETS[c] }); advanceTo(f, f.endTick + 1); return { c, won: f.ended.winner === me ? 1 : f.ended.winner === null ? 0.5 : 0 } })
  return { seed, me, won: s.ended.winner === me ? 1 : s.ended.winner === null ? 0.5 : 0, reason: s.ended.reason, t: s.tick / TPS, switches: plan.filter((p, i) => i && p.set !== plan[i - 1].set).length, plan, fixed }
}

if (!isMainThread) { parentPort.postMessage(oracle(workerData)) }
else {
  const [n, opp, candArg, every, until, threads, out] = process.argv.slice(2)
  const cands = candArg.split(','), jobs = []
  for (let k = 0; k < +n; k++) for (const me of [0, 1]) jobs.push({ seed: 3000 + k, me, opp, cands, every: +every, until: +until })
  const res = []; let next = 0
  await Promise.all(Array.from({ length: +threads }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++]
      const r = await new Promise((ok, ko) => { const w = new Worker(new URL(import.meta.url), { workerData: job }); w.once('message', ok); w.once('error', ko) })
      res.push(r); console.log(JSON.stringify({ seed: r.seed, me: r.me, won: r.won, switches: r.switches, plan: r.plan.map(p => `${p.t}:${p.set}`).join(' '), fixed: r.fixed.map(f => `${f.c}=${f.won}`).join(' ') }))
    }
  }))
  const score = res.reduce((a, r) => a + r.won, 0) / res.length
  const bestFixed = cands.map(c => ({ c, score: res.reduce((a, r) => a + r.fixed.find(f => f.c === c).won, 0) / res.length }))
  console.log(JSON.stringify({ opp, oracleScore: score, bestFixed }))
  if (out) writeFileSync(out, JSON.stringify({ opp, cands, every: +every, until: +until, oracleScore: score, bestFixed, res }, null, 1))
}
