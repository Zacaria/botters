import { ROUNDS, BREEDS, nextSlots, playRound, checkBot } from '../../sim.js'
import { SETS } from './strategies.mjs'
import { START, PREDATOR, house, fit } from '../../rounds.js'
export { START, CORE, PREDATOR, fit, house, refusal } from '../../rounds.js'

// `pincer+tank` → { gambits, breed }; a bare set name plays grunts
export const bot = name => { const [set, breed = 'grunt'] = name.split('+'); if (!SETS[set] || !BREEDS.includes(breed)) throw new Error(`unknown bot ${name}`); return { gambits: SETS[set], breed } }
const sized = (b, slots) => ({ gambits: fit(b.gambits, slots), breed: b.breed })

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
