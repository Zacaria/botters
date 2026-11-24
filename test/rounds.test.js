import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextSlots, playRound } from '../sim.js'
import { CORE, fit } from '../scripts/agent-value/rounds.mjs'
import { SETS } from '../scripts/agent-value/strategies.mjs'

test('slots grow for both, with an extra for the loser, capped', () => {
  assert.deepEqual(nextSlots([3, 3], 0), [4, 5])
  assert.deepEqual(nextSlots([3, 3], null), [4, 4])
  assert.deepEqual(nextSlots([10, 9], 0), [10, 10])
})
test('rounds are deterministic and report timeline and rule use', () => {
  const a = playRound(1, [CORE, CORE], { seconds: 10, every: 5 })
  assert.deepEqual(a, playRound(1, [CORE, CORE], { seconds: 10, every: 5 }))
  assert.deepEqual(a.timeline.map(e => e.t), [5, 10])
  assert.equal(a.ruleUse.length, 2)
  assert.equal(a.ruleUse[0].length, CORE.length)
  assert.ok(a.ruleUse[0].some(n => n > 0))
})
test('fit prioritizes core rules but preserves order', () => {
  assert.deepEqual(fit(SETS.blobflank, 3), CORE)
  assert.deepEqual(fit(SETS.blobflank, 6), SETS.blobflank)
})
