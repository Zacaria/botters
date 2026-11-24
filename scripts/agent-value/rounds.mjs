import { ROUNDS, nextSlots, playRound, checkGambits } from '../../sim.js'
import { r, SETS } from './strategies.mjs'

export const CORE = [r('weaker_enemy_near', 'go', 3), r('free_planet', 'go'), r('enemy_planet', 'go')]
export function fit(list, k) {
  const priority = r => ['weaker_enemy_near', 'free_planet', 'enemy_planet'].includes(r.if) ? 0 : r.if === 'always' ? 2 : 1
  const picked = list.map((rule, i) => ({ i, priority: priority(rule) })).sort((a, b) => a.priority - b.priority || a.i - b.i).slice(0, k)
  const indices = new Set(picked.map(x => x.i))
  return list.filter((_, i) => indices.has(i))
}
export const POLICIES = {
  noEdit: () => CORE,
  mirror: (_round, slots) => fit(SETS.blobflank, slots),
  switcher: (_round, slots, history) => {
    const candidates = ['blobflank', 'blob', 'flanker', 'rush', 'greedy']
    const losses = history.filter(h => h.result.winner === 1).length
    return fit(SETS[candidates[losses % candidates.length]], slots)
  },
}
export function playRoundsMatch({ seed, policies, house = 'blobflank', count = ROUNDS.count, seconds = ROUNDS.seconds }) {
  if (typeof policies !== 'function' || !SETS[house]) throw new Error('unknown policy or house')
  let slots = [ROUNDS.slots, ROUNDS.slots]; const history = [], rounds = [], score = [0, 0]
  for (let round = 1; round <= count; round++) {
    const gambits = [policies(round, slots[0], history), fit(SETS[house], slots[1])]
    const error = checkGambits(gambits[0]); if (error || gambits[0].length > slots[0]) throw new Error(error || 'too many rules')
    const result = playRound(seed, gambits, { seconds })
    history.push({ round, gambits, result })
    rounds.push({ round, slots: slots.slice(), gambits, winner: result.winner, reason: result.reason, planets: result.planets, units: result.units })
    if (result.winner !== null) score[result.winner]++
    slots = nextSlots(slots, result.winner)
  }
  return { seed, rounds, score, winner: score[0] === score[1] ? null : score[0] > score[1] ? 0 : 1 }
}
