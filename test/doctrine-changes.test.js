import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as sim from '../sim.js'

const a = { if: 'always', then: 'hold' }, b = { if: 'ally_fighting', then: 'flank' }
test('doctrine changes describe toggles, replacements, reordering and no change', () => {
  assert.equal(typeof sim.changes, 'function')
  assert.equal(sim.changes([a, b], [a, { ...b, on: false }]), 'rule 2 off: IF ally_fighting → flank')
  assert.equal(sim.changes([a], [b]), '- IF always → hold; + IF ally_fighting → flank')
  assert.equal(sim.changes([a, b], [b, a]), 'reordered')
  assert.equal(sim.changes([a], [{ ...a }]), 'no change')
})
test('view includes active rule text and per-rule counts excluding manual battalions', () => {
  const s = sim.createMatch(1); s.bats[0].rule = 0; s.bats[1].rule = 0; s.bats[1].manual = true
  const v = sim.view(s, 0)
  assert.equal(v.battalions[0].ruleText, sim.describe(s.gambits[0][0]))
  assert.equal(v.battalions[1].ruleText, null)
  assert.equal(v.perRule[0], 1)
})
