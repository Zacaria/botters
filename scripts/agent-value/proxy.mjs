// Breed mechanic, offline proxy: does a fog-only scripted policy beat the best fixed (gambits + breed) choice?
// 1. head to head: the `counter` script (pincer gambits, starts grunt) against every fixed set × breed;
// 2. against the house (pincer + a breed drawn from the seed): every fixed set × breed, the counter script, the blind `cycle` control.
// node scripts/agent-value/proxy.mjs <seeds> <out.json> [sets] [threads] ['<tune json>'] [only: vsHouse]
import { writeFileSync } from 'node:fs'
import { duel } from './arena.mjs'
import { SETS } from './strategies.mjs'
const seeds = Array.from({ length: +process.argv[2] || 16 }, (_, i) => 1000 + i), out = process.argv[3]
const sets = (process.argv[4] || 'pincer,blob,flanker').split(','), threads = +process.argv[5] || undefined
const tune = process.argv[6] ? JSON.parse(process.argv[6]) : undefined, only = process.argv[7]
const BREEDS = ['runner', 'grunt', 'tank'], opts = { threads, tune }
const fixed = sets.flatMap(set => BREEDS.map(breed => ({ name: `${set}+${breed}`, side: { gambits: SETS[set], breed } })))
const adaptive = { name: 'pincer+counter', side: { gambits: SETS.pincer, breed: 'grunt', script: 'counter' } }
const cycle = { name: 'pincer+cycle20', side: { gambits: SETS.pincer, breed: 'grunt', script: 'cycle' } }
const house = { gambits: SETS.pincer, breed: 'seeded' }
const row = (a, b, d) => ({ a, b, win: d.win, loss: d.loss, draw: d.draw, score: +d.score.toFixed(3) })
const rows = { headToHead: [], vsHouse: [] }
if (only !== 'vsHouse') for (const f of fixed) { const r = row(adaptive.name, f.name, await duel(adaptive.side, f.side, seeds, opts)); rows.headToHead.push(r); console.log(JSON.stringify(r)) }
for (const c of [...fixed, adaptive, cycle]) { const r = row(c.name, 'house pincer+seeded', await duel(c.side, house, seeds, opts)); rows.vsHouse.push(r); console.log(JSON.stringify(r)) }
const bestFixed = rows.vsHouse.filter(r => !/counter|cycle/.test(r.a)).sort((x, y) => y.score - x.score)[0]
console.log(JSON.stringify({ worstHeadToHead: rows.headToHead.slice().sort((x, y) => x.score - y.score)[0], bestFixedVsHouse: bestFixed, adaptiveVsHouse: rows.vsHouse.find(r => r.a === adaptive.name) }))
if (out) writeFileSync(out, JSON.stringify({ seeds, sets, tune: tune ?? 'default', ...rows }, null, 1))
