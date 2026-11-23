// What the agent bench would give with no agent edits: side 0 keeps a fixed set, side 1 is the house, same seeds as the bench.
// A name may carry a breed (`flanker+grunt`), `seeded` (breed from the seed, like the bench house), or a script (`pincer+counter`, starts grunt).
// node scripts/agent-value/control.mjs <house> <seedFrom> <seedTo> <name,name,...> [out.json]
import { writeFileSync } from 'node:fs'
import { run } from './arena.mjs'
import { SETS, SCRIPTS } from './strategies.mjs'
const side = name => { const [set, extra] = name.split('+'); return !extra ? { gambits: SETS[set] } : SCRIPTS[extra] ? { gambits: SETS[set], breed: 'grunt', script: extra } : { gambits: SETS[set], breed: extra } }
const [house, from, to, list, out] = process.argv.slice(2), names = list.split(','), seeds = []
for (let s = +from; s <= +to; s++) seeds.push(s)
const jobs = names.flatMap(n => seeds.map(seed => ({ seed, minutes: 5, planets: 17, sides: [side(n), side(house)] })))
const res = await run(jobs), rows = names.map((n, k) => { const r = res.slice(k * seeds.length, (k + 1) * seeds.length); return { set: n, vs: house, wins: r.filter(x => x.winner === 0).length, games: r.length, perSeed: r.map(x => +(x.winner === 0)).join('') } })
for (const r of rows) console.log(JSON.stringify(r))
if (out) writeFileSync(out, JSON.stringify(rows, null, 1))
