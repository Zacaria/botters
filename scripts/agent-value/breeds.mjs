// Breed vs breed with the same gambits on both sides: is the counter triangle a real triangle?
// node scripts/agent-value/breeds.mjs <seeds> <set> '<tune json>' [breeds]
import { run } from './arena.mjs'
import { SETS } from './strategies.mjs'
const seeds = Array.from({ length: +process.argv[2] || 8 }, (_, i) => 1000 + i), set = process.argv[3] || 'pincer'
const tune = process.argv[4] ? JSON.parse(process.argv[4]) : undefined, names = (process.argv[5] || 'runner,grunt,tank,mix').split(',')
const jobs = [], meta = []
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) for (const seed of seeds) for (const flip of [0, 1]) {
  const a = { gambits: SETS[set], breed: names[i] }, b = { gambits: SETS[set], breed: names[j] }
  jobs.push({ seed, tune, sides: flip ? [b, a] : [a, b] }); meta.push({ i, j, flip })
}
const res = await run(jobs), M = names.map(() => names.map(() => [0, 0]))
res.forEach((r, k) => { const { i, j, flip } = meta[k], pt = r.winner === null ? 0.5 : r.winner === (flip ? 1 : 0) ? 1 : 0; M[i][j][0] += pt; M[i][j][1]++; M[j][i][0] += 1 - pt; M[j][i][1]++ })
console.log(JSON.stringify(tune), set, `${seeds.length}×2`)
for (let i = 0; i < names.length; i++) console.log(names[i].padStart(7), M[i].map((x, j) => (i === j ? '-' : (x[0] / x[1]).toFixed(2)).padStart(6)).join(''))
