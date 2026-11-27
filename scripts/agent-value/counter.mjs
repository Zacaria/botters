// Best response: hill-climb a bot against ONE known fixed opponent (what an agent can do once it knows the house rules).
// node scripts/agent-value/counter.mjs <generations> <out.jsonl> <start> <opponent> [threads] [round [finalSeeds]]
// `round`: one rounds-mode round per game, start/opponent carry an army (`pincer+6-3-3`), mutations may change it,
// and the final champion is scored against the opponent on the roundrobin maps (seeds 1000…, both sides).
import { appendFileSync } from 'node:fs'
import { run, duel } from './arena.mjs'
import { SETS } from './strategies.mjs'
import { bot } from './rounds.mjs'
import { mutator, text, side } from './evolve.mjs'

const [gens, out, start, opp, threads = 6, mode, finalSeeds = 16] = process.argv.slice(2), round = mode === 'round'
const rounds = JSON.parse(process.env.ROUNDS_TUNE || '{}')
// start/opponent may also be a JSON genome ({"army":…,"gambits":[…]}), e.g. the champion of the previous ladder rung.
// COUNTER_FREEZE_ARMY=1 keeps the start army (rules-only search); COUNTER_MAX_RULES=k caps the rule count.
const genome = name => name.startsWith('{') ? JSON.parse(name) : round ? structuredClone(bot(name)) : { gambits: structuredClone(SETS[name]) }
const freeze = process.env.COUNTER_FREEZE_ARMY === '1', maxRules = +(process.env.COUNTER_MAX_RULES || 10)
const strip = g => ({ ...g, gambits: g.gambits.map(({ on, ...r }) => r) })
let champ = strip(genome(start)); const foe = side(genome(opp), round)
const mutate = mutator(777)
let seedBase = 50000
const seeds = n => Array.from({ length: n }, () => seedBase++)
const vsOpp = async (list, sd) => { // score of each genome vs the opponent, both sides, same seeds
  const jobs = list.flatMap(c => sd.flatMap(seed => [{ seed, round, rounds, sides: [side(c, round), foe] }, { seed, round, rounds, sides: [foe, side(c, round)] }]))
  const res = await run(jobs, +threads), per = jobs.length / list.length
  return list.map((_, k) => res.slice(k * per, (k + 1) * per).reduce((a, x, i) => a + (x.winner === null ? 0.5 : x.winner === i % 2 ? 1 : 0), 0) / per)
}
const log = o => { appendFileSync(out, JSON.stringify(o) + '\n'); console.log(JSON.stringify(o)) }
log({ start: text(champ), opp, round })
for (let g = 0; g < +gens; g++) {
  const allowed = c => c.gambits.length <= maxRules && (!freeze || JSON.stringify(c.army) === JSON.stringify(champ.army))
  const cands = Array.from({ length: 6 }, () => { let c; do c = mutate(champ); while (!allowed(c)); return c }), sd = seeds(4)
  const [c0, ...scores] = await vsOpp([champ, ...cands], sd)
  const best = scores.indexOf(Math.max(...scores)); let accepted = false, confirm = null
  if (scores[best] > c0) { confirm = await vsOpp([champ, cands[best]], seeds(8)); if (confirm[1] > confirm[0]) { champ = cands[best]; accepted = true } }
  log({ g, champScore: c0, scores, confirm, accepted, champ: text(champ), gambits: champ.gambits, ...(round && { army: champ.army }) })
}
if (round) {
  const maps = Array.from({ length: +finalSeeds }, (_, i) => 1000 + i), d = await duel(side(champ, true), foe, maps, { threads: +threads, round: true, rounds })
  log({ final: text(champ), opp, maps: maps.length, win: d.win, loss: d.loss, draw: d.draw, score: d.score })
}
