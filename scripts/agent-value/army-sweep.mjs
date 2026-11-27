// node scripts/agent-value/army-sweep.mjs <seeds> <rules> <armies,...> '<[ROUNDS tune, ...]>' [out.json]
// One rounds-mode round per game, every pair of armies with the same rules, both sides, every tune in one parallel batch.
// Prints per tune each army's mean and worst score: an army whose worst is above 0.5 dominates (no composition answers it).
import { writeFileSync } from 'node:fs'
import { run } from './arena.mjs'
import { bot } from './rounds.mjs'

const seeds = Array.from({ length: +process.argv[2] || 2 }, (_, i) => 1000 + i), rules = process.argv[3] || 'rich3'
const armies = (process.argv[4] || 'runner,grunt,tank,6-3-3,3-6-3,3-3-6,4-4-4').split(','), tunes = JSON.parse(process.argv[5] || '[{}]'), out = process.argv[6]
const jobs = [], meta = []
tunes.forEach((rounds, t) => {
  for (let i = 0; i < armies.length; i++) for (let j = i + 1; j < armies.length; j++) for (const seed of seeds) for (const flip of [0, 1]) {
    const a = bot(`${rules}+${armies[i]}`), b = bot(`${rules}+${armies[j]}`)
    jobs.push({ seed, round: true, rounds, sides: flip ? [b, a] : [a, b] }); meta.push({ t, i, j, flip })
  }
})
const t0 = Date.now(), res = await run(jobs), report = []
tunes.forEach((tune, t) => {
  const M = armies.map(() => armies.map(() => [0, 0]))
  res.forEach((r, k) => {
    const { t: tt, i, j, flip } = meta[k]; if (tt !== t) return
    const pi = r.winner === null ? 0.5 : r.winner === flip ? 1 : 0
    M[i][j][0] += pi; M[i][j][1]++; M[j][i][0] += 1 - pi; M[j][i][1]++
  })
  const rows = armies.map((a, i) => { const s = M[i].flatMap(([p, n], j) => j === i ? [] : [p / n]); return { army: a, mean: s.reduce((x, y) => x + y, 0) / s.length, worst: Math.min(...s), vs: Object.fromEntries(armies.map((b, j) => [b, j === i ? null : M[i][j][0] / M[i][j][1]])) } })
  report.push({ tune, rows })
  console.log(`tune ${JSON.stringify(tune)}`)
  for (const r of rows.sort((a, b) => b.mean - a.mean)) console.log(`  ${r.army.padStart(7)}  mean ${r.mean.toFixed(2)}  worst ${r.worst.toFixed(2)}${r.worst > 0.5 ? '  DOMINATES' : ''}`)
})
console.log(`${jobs.length} games in ${Math.round((Date.now() - t0) / 1000)} s, rules ${rules}, seeds ${seeds.length}`)
if (out) writeFileSync(out, JSON.stringify({ seeds, rules, armies, report }, null, 1))
