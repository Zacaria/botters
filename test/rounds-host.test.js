import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoundsMatch } from '../scripts/agent-value/rounds-host.mjs'
import { counterRate, bestRule } from '../scripts/agent-value/rounds-analyze.mjs'
import { START } from '../scripts/agent-value/rounds.mjs'
import { nextSlots } from '../sim.js'

const settings = { count: 2, seconds: 5, pause: 0.5 }
const parse = x => JSON.parse(x.text)
test('two agents lock privately and see mirrored debriefs', async () => {
  const m = createRoundsMatch({ seed: 1, sides: ['agent', 'agent'], settings, startGrace: 0.1 })
  const [a, b] = await Promise.all([m.wait(0), m.wait(1)])
  assert.ok(!a.text.includes('runner') && !b.text.includes('tank'))
  const x = m.set(0, { round: 1, breed: 'tank', gambits: START.gambits, why: '' }), y = m.set(1, { round: 1, breed: 'runner', gambits: START.gambits, why: '' })
  assert.ok(!x.text.includes('runner') && !y.text.includes('tank'))
  const [c, d] = (await Promise.all([m.wait(0), m.wait(1)])).map(parse)
  assert.equal(c.lastRound.opponentArmy.breed, 'runner'); assert.equal(d.lastRound.opponentArmy.breed, 'tank')
  assert.equal(c.lastRound.result, d.lastRound.result === 'won' ? 'lost' : d.lastRound.result === 'lost' ? 'won' : 'draw')
  assert.deepEqual([c.yourSlots, d.yourSlots], nextSlots([3, 3], m.state.pauses[0].result.winner))
  assert.deepEqual(m.state.pauses[0].locked.map(b => b.breed), ['tank', 'runner'])
  const late = m.set(0, { round: 1, breed: 'grunt', gambits: START.gambits, why: '' })
  assert.equal(late.isError, true); assert.equal(m.state.pauses[0].sides[0].late.length, 1)
  await Promise.all([m.wait(0), m.wait(1)])
})
test('noEdit policy plays START', async () => {
  const m = createRoundsMatch({ seed: 2, sides: ['agent', 'noEdit'], settings, startGrace: 0.1 })
  await m.wait(0); await m.wait(0); assert.deepEqual(m.state.pauses[0].locked[1], START); await m.wait(0)
})
test('analysis counts counters and finds a relative rule', () => {
  assert.equal(counterRate([{ own: 'tank', opponent: 'grunt' }, { own: 'grunt', opponent: 'grunt' }]), 0.5)
  const data = [{ ownLast: 'grunt', opponentLast: 'runner', wonOrDrawn: true, target: 'grunt' }, { ownLast: 'runner', opponentLast: 'tank', wonOrDrawn: false, target: 'runner' }]
  assert.equal(bestRule(data).rate, 1)
})
