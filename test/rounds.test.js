import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextSlots, playRound, checkBot, ROUNDS } from '../sim.js'
import { CORE, START, fit, house, POLICIES, PREDATOR, refusal } from '../scripts/agent-value/rounds.mjs'
import { SETS } from '../scripts/agent-value/strategies.mjs'

test('slots grow for both, with an extra for the loser, capped', () => {
  assert.deepEqual(nextSlots([3, 3], 0), [4, 5])
  assert.deepEqual(nextSlots([3, 3], null), [4, 4])
  assert.deepEqual(nextSlots([10, 9], 0), [10, 10])
})
test('rounds are deterministic and report timeline, rule use and armies', () => {
  const a = playRound(1, [START, { gambits: CORE, breed: 'tank' }], { seconds: 10, every: 5 })
  assert.deepEqual(a, playRound(1, [START, { gambits: CORE, breed: 'tank' }], { seconds: 10, every: 5 }))
  assert.deepEqual(a.timeline.map(e => e.t), [5, 10])
  assert.equal(a.ruleUse[0].length, CORE.length)
  assert.ok(a.ruleUse[0].some(n => n > 0))
})
test('a breed is the whole starting army', () => {
  const { roles } = playRound(1, [{ gambits: CORE, breed: 'runner' }, { gambits: CORE, breed: 'tank' }], { seconds: 1 })
  assert.ok(roles.start[0].runner >= ROUNDS.army.runner && !roles.start[0].grunt && !roles.start[0].tank) // + what the home planet bred
  assert.ok(roles.start[1].tank >= ROUNDS.army.tank && !roles.start[1].grunt && !roles.start[1].runner)
})
test('a bot needs a known breed and valid rules', () => {
  assert.equal(checkBot(START), null)
  assert.match(checkBot({ gambits: CORE, breed: 'dragon' }), /breed/)
  assert.match(checkBot({ gambits: [{ if: 'nope', then: 'go' }], breed: 'tank' }), /condition/)
})
test('a refusal names every problem and asks for a resend', () => {
  const msg = refusal([...CORE, { if: 'bigger_enemy_near', then: 'run' }], 'grunt', 3)
  assert.match(msg, /you sent 4 rules but you have 3 slots/)
  assert.match(msg, /rule 4: unknown action "run"/)
  assert.match(msg, /call set_bot again now/)
  assert.equal(refusal(CORE, 'grunt', 3), null)
  assert.match(refusal([{ if: 'planet_attacked(350)', then: 'go' }], 'tank', 3), /write the number in p, as \{"if":"planet_attacked","then":"go","p":350\}/)
})
test('the house keeps a bot that won and counters the breed that beat it', () => {
  const opening = house(1, 3, [], 4)
  assert.equal(opening.breed, 'grunt') // BREEDS[4 % 3]
  assert.deepEqual(opening.gambits, fit(SETS.blobflank, 3))
  const lost = [{ bots: [{ gambits: CORE, breed: 'tank' }, opening], result: { winner: 0 } }]
  assert.equal(house(2, 5, lost, 4).breed, PREDATOR.tank)
  const won = [{ bots: [{ gambits: CORE, breed: 'runner' }, opening], result: { winner: 1 } }]
  assert.equal(house(2, 4, won, 4).breed, 'grunt')
  assert.equal(POLICIES.reader(2, 4, won).breed, PREDATOR.grunt)
  assert.equal(POLICIES.reader(2, 4, lost).breed, PREDATOR[PREDATOR.tank])
})
test('fit prioritizes core rules but preserves order', () => {
  assert.deepEqual(fit(SETS.blobflank, 3), CORE)
  assert.deepEqual(fit(SETS.blobflank, 6), SETS.blobflank)
})
