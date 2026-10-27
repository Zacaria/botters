import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createMatch, applyInput, step, DEFAULT_GAMBITS, HOUSE, MODES } from '../sim.js'

const hash = state => createHash('sha256').update(JSON.stringify(state)).digest('hex')

export function trace(seed, mode) {
  const s = createMatch(seed, { mode, minutes: 3, planets: 16 })
  const house = ['easy', 'normal', 'hard'][(seed - 1) % 3]
  const log = [
    { tick: 0, side: 0, input: { gambits: DEFAULT_GAMBITS } },
    { tick: 0, side: 1, input: { gambits: HOUSE[house] } },
    { tick: 10, side: 0, input: { toggle: 0 } },
    { tick: 20, side: 0, input: { order: { swarm: 1, x: 600, y: 350 } } },
    { tick: 30, side: 0, input: { split: 1 } },
    { tick: 40, side: 0, input: { release: 1 } },
    { tick: 600, side: 0, input: { surrender: true } },
  ]
  const checksums = []
  let i = 0
  while (!s.ended) {
    while (i < log.length && log[i].tick === s.tick) {
      assert.deepEqual(applyInput(s, log[i].side, log[i].input), { ok: true })
      i++
    }
    if (s.ended) break
    step(s)
    if (s.tick % 100 === 0) checksums.push(hash(s))
  }
  return { seed, mode, house, log, checksums, final: s }
}

test('original JS golden traces: 24 seeds per mode, all house levels and scripted inputs', () => {
  const expected = JSON.parse(readFileSync(new URL('./fixtures/sim-golden.json', import.meta.url)))
  for (const mode of Object.keys(MODES)) for (let seed = 1; seed <= 24; seed++) {
    const key = `${mode}:${seed}`
    assert.deepEqual(trace(seed, mode), expected[key], key)
  }
})


export function naturalTrace(seed, mode, minutes, planets) {
  const s = createMatch(seed, { mode, minutes, planets })
  for (let side = 0; side < s.teams.length; side++) {
    assert.deepEqual(applyInput(s, side, { gambits: HOUSE.easy }), { ok: true })
  }
  const checksums = []
  while (!s.ended) {
    step(s)
    if (s.tick % 100 === 0) checksums.push(hash(s))
  }
  return { seed, mode, minutes, planets, tick: s.tick, checksums, final: hash(s) }
}

test('natural full-length matches match the original JS checksums', () => {
  const expected = JSON.parse(readFileSync(new URL('./fixtures/sim-natural.json', import.meta.url)))
  assert.equal(expected.length, 8)
  for (const e of expected) assert.deepEqual(naturalTrace(e.seed, e.mode, e.minutes, e.planets), e)
})
