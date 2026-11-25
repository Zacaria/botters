import { ROUNDS, BREEDS, CONDITIONS, ACTIONS, nextSlots, playRound, checkBot } from '../../sim.js'
import { r, SETS } from './strategies.mjs'

export const CORE = [r('weaker_enemy_near', 'go', 3), r('free_planet', 'go'), r('enemy_planet', 'go')]
export const START = { gambits: CORE, breed: 'grunt' } // the bot that plays when nothing valid was sent
export const PREDATOR = { runner: 'grunt', grunt: 'tank', tank: 'runner' } // the breed that beats this one (sim.js counter triangle)
export function fit(list, k) {
  const priority = r => ['weaker_enemy_near', 'free_planet', 'enemy_planet'].includes(r.if) ? 0 : r.if === 'always' ? 2 : 1
  const picked = list.map((rule, i) => ({ i, priority: priority(rule) })).sort((a, b) => a.priority - b.priority || a.i - b.i).slice(0, k)
  const indices = new Set(picked.map(x => x.i))
  return list.filter((_, i) => indices.has(i))
}
// `pincer+tank` → { gambits, breed }; a bare set name plays grunts
export const bot = name => { const [set, breed = 'grunt'] = name.split('+'); if (!SETS[set] || !BREEDS.includes(breed)) throw new Error(`unknown bot ${name}`); return { gambits: SETS[set], breed } }
const sized = (b, slots) => ({ gambits: fit(b.gambits, slots), breed: b.breed })

// The house changes between rounds like a plain human player: it opens with pincer and a breed drawn from the seed,
// keeps a bot that won or drew, and after a lost round switches to the breed that beats the one that just beat it.
// It never sees the agent's next bot. Policy signature: (round, slots, history, seed) → bot; history rows are
// { round, bots: [side0, side1], result }, i.e. what both debriefs show (each side's breed and the result).
export function house(_round, slots, history, seed) {
  const last = history.at(-1)
  if (!last) return sized(bot(`blobflank+${BREEDS[seed % 3]}`), slots)
  return sized({ gambits: SETS.blobflank, breed: last.result.winner === 0 ? PREDATOR[last.bots[0].breed] : last.bots[1].breed }, slots)
}

// Side-0 controls. Each sees only the debriefs (house breed and result), never the house's next bot.
export const POLICIES = {
  noEdit: () => START, // the starting bot every round
  mirror: (_round, slots, history) => history.length ? sized(history.at(-1).bots[1], slots) : START, // copy the house's last bot
  switcher: (_round, slots, history) => { // pincer; after each lost round, the next breed in the triangle
    const losses = history.filter(h => h.result.winner === 1).length
    return sized({ gambits: SETS.blobflank, breed: BREEDS[(1 + losses) % 3] }, slots)
  },
  counterLast: (_round, slots, history) => history.length ? sized({ gambits: SETS.blobflank, breed: PREDATOR[history.at(-1).bots[1].breed] }, slots) : START,
  // knows how this house changes (keeps a winning breed; after a loss, the predator of what beat it) and plays the predator of that
  reader: (_round, slots, history) => {
    const last = history.at(-1); if (!last) return START
    const next = last.result.winner === 0 ? PREDATOR[last.bots[0].breed] : last.bots[1].breed
    return sized({ gambits: SETS.blobflank, breed: PREDATOR[next] }, slots)
  },
}
export function playRoundsMatch({ seed, policy, opponent = house, count = ROUNDS.count, seconds = ROUNDS.seconds }) {
  if (typeof policy !== 'function' || typeof opponent !== 'function') throw new Error('unknown policy or house')
  let slots = [ROUNDS.slots, ROUNDS.slots]; const history = [], rounds = [], score = [0, 0]
  for (let round = 1; round <= count; round++) {
    const bots = [policy(round, slots[0], history, seed), opponent(round, slots[1], history, seed)]
    bots.forEach((b, side) => { const error = checkBot(b) || (b.gambits.length > slots[side] ? 'too many rules' : null); if (error) throw new Error(`side ${side}: ${error}`) })
    const result = playRound(seed, bots, { seconds, every: 0 })
    history.push({ round, bots, result })
    rounds.push({ round, slots: slots.slice(), bots, winner: result.winner, reason: result.reason, planets: result.planets, units: result.units })
    if (result.winner !== null) score[result.winner]++
    slots = nextSlots(slots, result.winner)
  }
  return { seed, rounds, score, winner: score[0] === score[1] ? null : score[0] > score[1] ? 0 : 1 }
}
// Every problem in one readable sentence, so the agent can fix the bot and resend within the same pause.
export function refusal(gambits, breed, max) {
  const problems = []
  if (!BREEDS.includes(breed)) problems.push(`breed "${breed}" is not one of ${BREEDS.join(', ')}`)
  if (!gambits.length) problems.push('send at least one rule')
  if (gambits.length > max) problems.push(`you sent ${gambits.length} rules but you have ${max} slots this round: keep your ${max} most important rules`)
  gambits.forEach((r, i) => {
    if (!Object.hasOwn(CONDITIONS, r.if)) problems.push(`rule ${i + 1}: unknown condition "${r.if}" (use one of ${Object.keys(CONDITIONS).join(', ')})`)
    if (!Object.hasOwn(ACTIONS, r.then)) problems.push(`rule ${i + 1}: unknown action "${r.then}" (use one of ${Object.keys(ACTIONS).join(', ')})`)
    if (r.p !== undefined && !(Number.isFinite(r.p) && r.p > 0 && r.p <= 100000)) problems.push(`rule ${i + 1}: p must be a number above 0 and at most 100000`)
  })
  return problems.length ? `Refused, your previous bot still plays: ${problems.join('; ')}. Fix it and call set_bot again now` : null
}
