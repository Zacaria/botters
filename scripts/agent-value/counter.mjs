// Best response: hill-climb a gambit list against ONE known fixed opponent (what an agent can do once it knows the house rules).
// node scripts/agent-value/counter.mjs <generations> <out.jsonl> <startSet> <opponentSet> [threads]
import { appendFileSync } from 'node:fs'
import { run } from './arena.mjs'
import { SETS } from './strategies.mjs'
import { CONDITIONS, ACTIONS, describe } from '../../sim.js'

const [gens, out, start, opp, threads = 6] = process.argv.slice(2)
let champ = structuredClone(SETS[start]).map(({ on, ...r }) => r)
let rng = 777
const rand = () => (rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 4294967296
const pick = a => a[Math.floor(rand() * a.length)]
const COND = Object.keys(CONDITIONS), ACT = Object.keys(ACTIONS)
const P = { bigger_enemy_near: [1, 1.3, 2, 3], planet_attacked: [150, 250, 350, 500, 800], ally_fighting: [200, 300, 450, 700, 1200], weaker_enemy_near: [0.5, 0.8, 1, 1.5, 3, 10], small: [40, 80, 120, 200, 400], big: [200, 400, 600, 900, 1500], free_planet: [200, 400, 700, 2000], enemy_planet: [200, 400, 700, 2000], always: [undefined] }
const randRule = () => { const c = pick(COND), p = pick(P[c]); return { if: c, then: pick(ACT), ...(p !== undefined && { p }) } }
function mutate(list) {
  const l = structuredClone(list), n = 1 + (rand() < 0.4)
  for (let k = 0; k < n; k++) {
    const i = Math.floor(rand() * l.length), m = rand()
    if (m < 0.3 && l[i].if !== 'always') { const p = pick(P[l[i].if]); if (p !== undefined) l[i].p = p }
    else if (m < 0.45) l[i].then = pick(ACT)
    else if (m < 0.6) { const c = pick(COND), p = pick(P[c]); l[i] = { if: c, then: l[i].then, ...(p !== undefined && { p }) } }
    else if (m < 0.78 && l.length < 10) l.splice(Math.floor(rand() * (l.length + 1)), 0, randRule())
    else if (m < 0.9 && l.length > 2) l.splice(i, 1)
    else if (l.length > 1) { const j = Math.min(l.length - 1, i + 1), t = l[i]; l[i] = l[j]; l[j] = t }
  }
  return l
}
const text = l => l.map(describe).join(' · ')
let seedBase = 50000
const seeds = n => Array.from({ length: n }, () => seedBase++)
const vsOpp = async (lists, sd) => { // score of each list vs the opponent, both sides, same seeds
  const jobs = lists.flatMap(c => sd.flatMap(seed => [{ seed, sides: [{ gambits: c }, { gambits: SETS[opp] }] }, { seed, sides: [{ gambits: SETS[opp] }, { gambits: c }] }]))
  const res = await run(jobs, +threads), per = jobs.length / lists.length
  return lists.map((_, k) => res.slice(k * per, (k + 1) * per).reduce((a, x, i) => a + (x.winner === null ? 0.5 : x.winner === i % 2 ? 1 : 0), 0) / per)
}
const log = o => { appendFileSync(out, JSON.stringify(o) + '\n'); console.log(JSON.stringify(o)) }
log({ start: text(champ), opp })
for (let g = 0; g < +gens; g++) {
  const cands = Array.from({ length: 6 }, () => mutate(champ)), sd = seeds(4)
  const [c0, ...scores] = await vsOpp([champ, ...cands], sd)
  const best = scores.indexOf(Math.max(...scores)); let accepted = false, confirm = null
  if (scores[best] > c0) { confirm = await vsOpp([champ, cands[best]], seeds(8)); if (confirm[1] > confirm[0]) { champ = cands[best]; accepted = true } }
  log({ g, champScore: c0, scores, confirm, accepted, champ: text(champ), gambits: champ })
}
