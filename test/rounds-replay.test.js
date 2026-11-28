import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoundReplay } from '../browser-live.js'
import { playRound } from '../sim.js'

test('round replay reaches the same outcome as the server simulation', () => {
  const bots = [{ breed: 'tank', gambits: [{ if: 'always', then: 'hold', on: true }] }, { breed: 'grunt', gambits: [{ if: 'always', then: 'hold', on: true }] }]
  const options = { seconds: 3, planets: 17, counter: 2 }
  const expected = playRound(12345, bots, options)
  const replay = createRoundReplay({ seed: 12345, bots, ...options })
  while (!replay.result) replay.advance(7)
  assert.equal(replay.result.winner, expected.winner)
  assert.deepEqual(replay.result.planets, expected.planets)
  assert.deepEqual(replay.result.units, expected.units)
})
