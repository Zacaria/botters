// Search for the strongest fixed bot: (1+λ) hill climbing on head-to-head score against the current champion,
// fresh seeds every generation, confirmation on more seeds before a candidate replaces the champion.
// node scripts/agent-value/search.mjs <generations> <out.jsonl> [start] [threads] [round]
// `round`: one rounds-mode round per game with mixed armies, and no gatekeeper.
import { appendFileSync } from 'node:fs'
import { duel, run } from './arena.mjs'
import { SETS } from './strategies.mjs'
import { bot } from './rounds.mjs'
import { mutator, text, side } from './evolve.mjs'

const gens = +process.argv[2] || 30, out = process.argv[3] || 'search.jsonl', threads = +process.argv[5] || 7, round = process.argv[6] === 'round'
const name = process.argv[4] || (round ? 'blobflank+4-4-4' : 'blob')
const rounds = JSON.parse(process.env.ROUNDS_TUNE || '{}')
const strip = g => ({ ...g, gambits: g.gambits.map(({ on, ...r }) => r) })
let champ = strip(round ? structuredClone(bot(name)) : { gambits: structuredClone(SETS[name]) })
const mutate = mutator(12345)
let seedBase = 100000
const seeds = n => Array.from({ length: n }, () => seedBase++)
const log = o => { appendFileSync(out, JSON.stringify(o) + '\n'); console.log(JSON.stringify(o)) }
log({ start: text(champ), gambits: champ.gambits, round })
for (let g = 0; g < gens; g++) {
  const cands = Array.from({ length: 6 }, () => mutate(champ)), sd = seeds(8)
  const jobs = cands.flatMap(c => sd.flatMap(seed => [{ seed, round, rounds, sides: [side(c, round), side(champ, round)] }, { seed, round, rounds, sides: [side(champ, round), side(c, round)] }]))
  const res = await run(jobs, threads), per = jobs.length / cands.length
  const scores = cands.map((_, k) => res.slice(k * per, (k + 1) * per).reduce((a, x, i) => a + (x.winner === null ? 0.5 : x.winner === i % 2 ? 1 : 0), 0) / per)
  const best = scores.indexOf(Math.max(...scores))
  let accepted = false, confirm = null, vsBlob = null
  if (scores[best] >= 0.625) {
    const d = await duel(side(cands[best], round), side(champ, round), seeds(12), { threads, round, rounds }); confirm = d.score
    if (d.score >= 0.58) {
      // gatekeeper: blob in full matches only
      const keepers = [{ gambits: SETS.blob }]
      vsBlob = round ? null : Math.min(...await Promise.all(keepers.map(async k => (await duel(side(cands[best], round), k, seeds(8), { threads, round, rounds })).score)))
      if (round || vsBlob >= 0.55) { champ = cands[best]; accepted = true }
    }
  }
  log({ g, scores, best: text(cands[best]), confirm, vsBlob, accepted, champ: text(champ), gambits: champ.gambits, ...(round && { army: champ.army }) })
}
