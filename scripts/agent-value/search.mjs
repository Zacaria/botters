// Search for the strongest fixed bot: (1+λ) hill climbing on head-to-head score against the current champion,
// fresh seeds every generation, confirmation on more seeds before a candidate replaces the champion.
// node scripts/agent-value/search.mjs <generations> <out.jsonl> [start] [threads] [round]
// `round`: one rounds-mode round per game, start carries a breed (`pincer+grunt`), mutations may change the breed, and the
// gatekeeper is the same gambits with each of the other two breeds (a bot that beats its own predator is a dominant one).
import { appendFileSync } from 'node:fs'
import { duel, run } from './arena.mjs'
import { SETS } from './strategies.mjs'
import { BREEDS } from '../../sim.js'
import { bot } from './rounds.mjs'
import { mutator, text, side } from './evolve.mjs'

const gens = +process.argv[2] || 30, out = process.argv[3] || 'search.jsonl', threads = +process.argv[5] || 7, round = process.argv[6] === 'round'
const name = process.argv[4] || (round ? 'blob+grunt' : 'blob')
const strip = g => ({ ...g, gambits: g.gambits.map(({ on, ...r }) => r) })
let champ = strip(round ? structuredClone(bot(name)) : { gambits: structuredClone(SETS[name]) })
const mutate = mutator(12345)
let seedBase = 100000
const seeds = n => Array.from({ length: n }, () => seedBase++)
const log = o => { appendFileSync(out, JSON.stringify(o) + '\n'); console.log(JSON.stringify(o)) }
log({ start: text(champ), gambits: champ.gambits, round })
for (let g = 0; g < gens; g++) {
  const cands = Array.from({ length: 6 }, () => mutate(champ)), sd = seeds(8)
  const jobs = cands.flatMap(c => sd.flatMap(seed => [{ seed, round, sides: [side(c, round), side(champ, round)] }, { seed, round, sides: [side(champ, round), side(c, round)] }]))
  const res = await run(jobs, threads), per = jobs.length / cands.length
  const scores = cands.map((_, k) => res.slice(k * per, (k + 1) * per).reduce((a, x, i) => a + (x.winner === null ? 0.5 : x.winner === i % 2 ? 1 : 0), 0) / per)
  const best = scores.indexOf(Math.max(...scores))
  let accepted = false, confirm = null, vsBlob = null
  if (scores[best] >= 0.625) {
    const d = await duel(side(cands[best], round), side(champ, round), seeds(12), { threads, round }); confirm = d.score
    if (d.score >= 0.58) {
      // gatekeeper: blob (full matches); in rounds, the candidate's own gambits with the other breeds (worst score kept)
      const keepers = round ? BREEDS.filter(b => b !== cands[best].breed).map(b => ({ gambits: cands[best].gambits, breed: b })) : [{ gambits: SETS.blob }]
      vsBlob = Math.min(...await Promise.all(keepers.map(async k => (await duel(side(cands[best], round), k, seeds(8), { threads, round })).score)))
      if (vsBlob >= 0.55) { champ = cands[best]; accepted = true }
    }
  }
  log({ g, scores, best: text(cands[best]), confirm, vsBlob, accepted, champ: text(champ), gambits: champ.gambits, ...(round && { breed: champ.breed }) })
}
