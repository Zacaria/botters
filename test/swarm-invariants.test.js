import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMatch, applyInput, addSwarm, step, replay, MODES, OPTIONS, T, W, H } from '../sim.js'

const hold = [{ if: 'always', then: 'hold' }]
const arena = () => {
  const s = createMatch(7)
  s.swarms = []; s.planets = []; s.gambits = s.teams.map(() => hold)
  return s
}
const order = (s, c) => applyInput(s, c.side, { order: { swarm: c.id, x: 800, y: 350 } })
const runTo = (s, tick) => { while (s.tick < tick && !s.ended) step(s) }

for (const mode of Object.keys(MODES)) {
  test(`split/merge/order full replay: ${mode}`, () => {
    const s = createMatch(7, { mode, minutes: 3, planets: 16 }), log = []
    const send = (side, input) => {
      log.push({ tick: s.tick, side, input })
      return applyInput(s, side, input).ok
    }
    for (let side = 0; side < s.teams.length; side++) assert.ok(send(side, { gambits: hold }))
    const parent = s.swarms[0]
    assert.ok(send(0, { split: parent.id }))
    runTo(s, 81)
    assert.ok(send(0, { order: { swarm: parent.id, x: 600, y: 350 } }))
    while (!s.ended) step(s)
    assert.deepEqual(replay(s.seed, log, s.opts), s)
  })
}
