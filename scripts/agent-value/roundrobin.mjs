// node scripts/agent-value/roundrobin.mjs <seeds> <name,name,...> [minutes|round] [planets] [out.json]
// Every pair, both sides, each seed, all in one parallel batch. Prints the score matrix (row's score vs column) and each set's mean.
// `round` plays one rounds-mode round per game (sim.js ROUNDS); names can carry an army, `pincer+6-3-3` (rounds.mjs `bot`).
import { writeFileSync } from 'node:fs'
import { run } from './arena.mjs'
import { SETS } from './strategies.mjs'
import { bot } from './rounds.mjs'
const seeds = Array.from({ length: +process.argv[2] || 8 }, (_, i) => 1000 + i)
const names = (process.argv[3] || Object.keys(SETS).join(',')).split(',')
const round = process.argv[4] === 'round', minutes = round ? 5 : +process.argv[4] || 5, planets = +process.argv[5] || 17, out = process.argv[6]
const side = name => round ? bot(name) : { gambits: SETS[name] }
const rounds = JSON.parse(process.env.ROUNDS_TUNE || '{}')
const jobs = [], meta = []
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) for (const seed of seeds) for (const flip of [0, 1]) {
  const a = side(names[i]), b = side(names[j])
  jobs.push({ seed, minutes, planets, round, rounds, sides: flip ? [b, a] : [a, b] }); meta.push({ i, j, flip })
}
const t0 = Date.now(), res = await run(jobs)
const M = names.map(() => names.map(() => [0, 0])) // [points, games]
res.forEach((r, k) => { const { i, j, flip } = meta[k], iSide = flip ? 1 : 0, pt = r.winner === null ? 0.5 : r.winner === iSide ? 1 : 0; M[i][j][0] += pt; M[i][j][1]++; M[j][i][0] += 1 - pt; M[j][i][1]++ })
const pad = s => String(s).padStart(round ? 14 : 9)
console.log(`${seeds.length} seeds × 2 sides, ${round ? 'one rounds-mode round each' : `${minutes} min`}, ${planets} planets, ${res.length} games in ${Math.round((Date.now() - t0) / 1000)} s`)
console.log(pad('') + names.map(pad).join('') + pad('mean') + pad('worst'))
const rows = names.map((n, i) => { const s = M[i].filter((_, j) => j !== i), mean = s.reduce((a, x) => a + x[0], 0) / s.reduce((a, x) => a + x[1], 0); return { n, mean, worst: Math.min(...s.map(x => x[0] / x[1])), cells: M[i].map((x, j) => j === i ? '-' : (x[0] / x[1]).toFixed(2)) } })
for (const r of rows.sort((a, b) => b.mean - a.mean)) console.log(pad(r.n) + r.cells.map(pad).join('') + pad(r.mean.toFixed(2)) + pad(r.worst.toFixed(2)))
const wipes = res.filter(r => r.reason === 'wipe').length, times = res.map(r => r.t).sort((a, b) => a - b)
console.log(`wipes ${wipes}/${res.length}, median end ${times[times.length >> 1]} s, lead changes median ${res.map(r => r.leadChanges).sort((a, b) => a - b)[res.length >> 1]}`)
if (out) writeFileSync(out, JSON.stringify({ seeds, minutes, planets, round, names, matrix: M, results: res.map((r, k) => ({ ...meta[k], ...r })) }))
