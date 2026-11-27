import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextSlots, playRound, checkBot, checkGambits, createMatch, step, setDoctrine, live, describe, changes, ROUNDS } from '../sim.js'
import { CORE, START, fit, house, POLICIES, counterArmy, refusal, bot, armyText, RICH } from '../scripts/agent-value/rounds.mjs'
import { SETS } from '../scripts/agent-value/strategies.mjs'

const balanced = { runner: 4, grunt: 4, tank: 4 }
test('slots grow and cap', () => { assert.deepEqual(nextSlots([3, 3], 0), [4, 5]); assert.deepEqual(nextSlots([3, 3], null), [4, 4]); assert.deepEqual(nextSlots([10, 9], 0), [10, 10]) })
test('mixed army starts in single-role battalions', () => {
  const s = createMatch(1, { army: [balanced, { runner: 6, grunt: 6 }], counter: 2 })
  assert.deepEqual(live(s, 0).map(b => [b.n, b.role]), [[400, 0], [400, 1], [400, 2]])
  assert.deepEqual(live(s, 1).map(b => [b.n, b.role]), [[300, 0], [300, 0], [300, 1], [300, 1]])
})
test('army and rule validation', () => {
  assert.equal(checkBot(START), null)
  for (const army of [{ runner: 10 }, { runner: 12, dragon: 0 }, { runner: -1, grunt: 13 }, { runner: 11.5, tank: 0.5 }]) assert.ok(checkBot({ army, gambits: CORE }))
  assert.match(checkBot({ army: { runner: 10 }, gambits: CORE }), /10 squads.*12/)
  assert.match(checkGambits([{ if: 'free_planet', then: 'go', vs: 'prey' }]), /vs only works/)
})
test('who selects only that role', () => {
  const s = createMatch(1, { army: [balanced, balanced] })
  setDoctrine(s, 0, [{ if: 'always', then: 'hold', who: 'tank' }, { if: 'free_planet', then: 'go' }])
  for (let i = 0; i < 10; i++) step(s)
  assert.deepEqual(live(s, 0).map(b => b.rule), [1, 1, 0])
})
test('prey targets the matching enemy rather than a closer predator', () => {
  const s = createMatch(2, { army: [{ runner: 12 }, { tank: 6, grunt: 6 }] })
  for (let i = 0; i < s.N; i++) if (s.alive[i]) { if (s.side[i] === 0) { s.x[i] = 500; s.y[i] = 350 } else { s.x[i] = s.role[i] === 1 ? 520 : 550; s.y[i] = 350 } }
  setDoctrine(s, 0, [{ if: 'enemy_near', p: 400, vs: 'prey', then: 'go' }])
  s.tick = 9; step(s)
  assert.ok(s.bats.slice(0, 3).every(b => b.tx > 540))
})
test('descriptions and changes include filters', () => {
  assert.equal(describe({ if: 'free_planet', then: 'go' }), 'IF free_planet → go')
  assert.equal(describe({ if: 'enemy_near', p: 400, who: 'tank', vs: 'prey', then: 'go' }), 'tank: IF enemy_near(400) vs prey → go')
  assert.notEqual(changes([{ if: 'enemy_near', then: 'go' }], [{ if: 'enemy_near', then: 'go', vs: 'prey' }]), 'no change')
})
test('rounds deterministic and report armies and rule use', () => {
  const bots = [START, bot('pincer+tank')], a = playRound(1, bots, { seconds: 2, every: 1 })
  assert.deepEqual(a, playRound(1, bots, { seconds: 2, every: 1 }))
  assert.deepEqual(a.timeline.map(e => e.t), [1, 2]); assert.equal(a.ruleUse[0].length, CORE.length)
  assert.ok(a.roles.start[1].tank >= ROUNDS.budget * ROUNDS.squad.tank)
})
test('house tilts, keeps winners, counters losses and reader predicts', () => {
  const opening = house(1, 3, [], 4); assert.deepEqual(opening.army, { runner: 3, grunt: 6, tank: 3 }); assert.deepEqual(opening.gambits, fit(SETS.blobflank, 3))
  for (const winner of [0, 1, null]) {
    const history = [{ bots: [bot('rich7+6-3-3'), opening], result: { winner } }], next = house(2, 5, history, 4)
    assert.deepEqual(next.army, winner === 0 ? counterArmy(history[0].bots[0].army) : opening.army)
    assert.deepEqual(POLICIES.reader(2, 5, history, 4).army, counterArmy(next.army))
  }
  assert.equal(armyText(bot('pincer+6-3-3').army), '6-3-3'); assert.equal(RICH(10).length, 7)
})
test('refusal lists army and rule problems', () => {
  const msg = refusal([{ if: 'planet_attacked(350)', then: 'run', who: 'bad', vs: 'bad' }, ...CORE], { runner: 10 }, 3)
  for (const text of ['10 squads', 'you sent 4 rules', 'write the number in p', 'unknown action', 'invalid who', 'invalid vs', 'call set_bot again now']) assert.ok(msg.includes(text), text)
  assert.equal(refusal(CORE, balanced, 3), null)
})
test('fit prioritizes core rules while preserving order', () => { assert.deepEqual(fit(SETS.blobflank, 3), CORE); assert.deepEqual(fit(SETS.blobflank, 6), SETS.blobflank); assert.deepEqual(fit(RICH(5), 3), [RICH(5)[1], RICH(5)[2], RICH(5)[3]]) })
