import { ROUNDS, BREEDS, CONDITIONS, ACTIONS, nextSlots, playRound, checkBot, checkArmy } from '../../sim.js'
import { r, SETS, RICH } from './strategies.mjs'

export const CORE = [r('weaker_enemy_near', 'go', 3), r('free_planet', 'go'), r('enemy_planet', 'go')]
export const START = { army: { runner: 4, grunt: 4, tank: 4 }, gambits: CORE } // the bot that plays when nothing valid was sent
export const PREDATOR = { runner: 'grunt', grunt: 'tank', tank: 'runner' } // the breed that beats this one (sim.js counter triangle)
export function fit(list, k) {
  const priority = r => (r.who || r.vs || ['weaker_enemy_near', 'free_planet', 'enemy_planet'].includes(r.if)) ? 0 : r.if === 'always' ? 2 : 1
  const picked = list.map((rule, i) => ({ i, priority: priority(rule) })).sort((a, b) => a.priority - b.priority || a.i - b.i).slice(0, k)
  const indices = new Set(picked.map(x => x.i))
  return list.filter((_, i) => indices.has(i))
}
export { RICH }
export const counterArmy = army => Object.fromEntries(BREEDS.map(b => [PREDATOR[b], army[b] ?? 0]))
export const armyText = army => BREEDS.map(b => army[b] ?? 0).join('-')
export const bot = name => {
  const [set, spec = '4-4-4', ...extra] = name.split('+'), values = BREEDS.includes(spec) ? BREEDS.map(b => b === spec ? ROUNDS.budget : 0) : /^\d+-\d+-\d+$/.test(spec) ? spec.split('-').map(Number) : []
  const army = Object.fromEntries(BREEDS.map((b, i) => [b, values[i]]))
  if (extra.length || !SETS[set] || values.length !== 3 || checkArmy(army)) throw new Error(`unknown bot ${name}`)
  return { army, gambits: SETS[set] }
}
const sized = (b, slots) => ({ gambits: fit(b.gambits, slots), army: { ...b.army } })
const tilt = role => Object.fromEntries(BREEDS.map(b => [b, b === role ? 6 : 3]))
export function house(_round, slots, history, seed) {
  const last = history.at(-1)
  if (!last) return sized({ gambits: SETS.blobflank, army: tilt(BREEDS[seed % 3]) }, slots)
  return last.result.winner === 0 ? sized({ gambits: SETS.blobflank, army: counterArmy(last.bots[0].army) }, slots) : sized(last.bots[1], slots)
}
export const POLICIES = {
  noEdit: () => START,
  mirror: (_round, slots, history) => history.length ? sized(history.at(-1).bots[1], slots) : START,
  switcher: (_round, slots, history) => sized({ gambits: SETS.blobflank, army: tilt(BREEDS[history.filter(h => h.result.winner === 1).length % 3]) }, slots),
  counterLast: (_round, slots, history) => history.length ? sized({ gambits: SETS.blobflank, army: counterArmy(history.at(-1).bots[1].army) }, slots) : START,
  reader: (round, slots, history, seed) => sized({ gambits: SETS.blobflank, army: counterArmy(house(round, slots, history, seed).army) }, slots),
  hunter: (_round, slots) => ({ army: { ...START.army }, gambits: RICH(slots) }),
  readerHunter: (round, slots, history, seed) => ({ army: POLICIES.reader(round, slots, history, seed).army, gambits: RICH(slots) }),
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
export function refusal(gambits, army, max) {
  const problems = []
  const armyError = checkArmy(army); if (armyError) problems.push(armyError)
  if (!Array.isArray(gambits)) return `Refused, your previous bot still plays: ${[...problems, "send rules as an array"].join("; ")}. Fix it and call set_bot again now`
  if (!gambits.length) problems.push('send at least one rule')
  if (gambits.length > max) problems.push(`you sent ${gambits.length} rules but you have ${max} slots this round: keep your ${max} most important rules`)
  gambits.forEach((r, i) => {
    r = r || {}
    const inline = /^(\w+)\(([\d.]+)\)$/.exec(r.if) // `planet_attacked(350)`: the debrief's notation, not the input format
    if (inline && Object.hasOwn(CONDITIONS, inline[1])) problems.push(`rule ${i + 1}: write the number in p, as {"if":"${inline[1]}","then":"${r.then}","p":${inline[2]}}`)
    else if (!Object.hasOwn(CONDITIONS, r.if)) problems.push(`rule ${i + 1}: unknown condition "${r.if}" (use one of ${Object.keys(CONDITIONS).join(', ')})`)
    if (!Object.hasOwn(ACTIONS, r.then)) problems.push(`rule ${i + 1}: unknown action "${r.then}" (use one of ${Object.keys(ACTIONS).join(', ')})`)
    if (r.who !== undefined && !BREEDS.includes(r.who)) problems.push(`rule ${i + 1}: invalid who`)
    if (r.vs !== undefined && ![...BREEDS, 'prey', 'predator'].includes(r.vs)) problems.push(`rule ${i + 1}: invalid vs`)
    if (r.vs !== undefined && !['bigger_enemy_near', 'weaker_enemy_near', 'enemy_near', 'ally_fighting'].includes(r.if)) problems.push(`rule ${i + 1}: vs only works with bigger_enemy_near, weaker_enemy_near, enemy_near, ally_fighting`)
    if (r.p !== undefined && !(Number.isFinite(r.p) && r.p > 0 && r.p <= 100000)) problems.push(`rule ${i + 1}: p must be a number above 0 and at most 100000`)
  })
  return problems.length ? `Refused, your previous bot still plays: ${problems.join('; ')}. Fix it and call set_bot again now` : null
}
