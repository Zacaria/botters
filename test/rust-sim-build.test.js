import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { sourceHash } from '../scripts/build-sim.js'
import { initSync, hypot, random_next, initial_geometry } from '../sim/pkg/botters_sim.js'
import { MODES, createMatch, totals } from '../sim.js'

initSync({ module: readFileSync(new URL('../sim/pkg/botters_sim_bg.wasm', import.meta.url)) })

test('Rust simulator artifact is current', () => {
  assert.equal(readFileSync(new URL('../sim/pkg/source.sha256', import.meta.url), 'utf8').trim(), sourceHash())
})

test('Rust numeric primitives follow JavaScript', () => {
  let state = 1
  for (let i = 0; i < 1000; i++) {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    assert.equal(random_next(state), (t ^ (t >>> 14)) >>> 0)
    const a = (state % 120000) / 100, b = ((t >>> 0) % 70000) / 100
    assert.equal(hypot(a, b), Math.hypot(a, b))
  }
})

test('Rust initial geometry matches JavaScript', () => {
  const hash = createHash('sha256')
  for (const mode of Object.keys(MODES)) for (const planets of [16, 28, 40]) for (let seed = 1; seed <= 24; seed++) {
    hash.update(JSON.stringify(JSON.parse(initial_geometry(seed, MODES[mode].length, planets))))
  }
  assert.equal(hash.digest('hex'), '47711ebed4f91cfdc37d5c3048b784ab7a55d867c9c43a0354307ffbde0d78d6')
})

test('Rust totals preserve summation order and rounding', () => {
  const swarms = [{ side: 0, n: 1e16 }, { side: 0, n: 1 }, { side: 0, n: 1 }, { side: 1, n: 0.49999999999999994 }]
  const expected = [0, 1].map(side => Math.round(swarms.reduce((n, c) => n + (c.side === side ? c.n : 0), 0)))
  const s = createMatch(1), data = s.toJSON(), template = data.swarms[0]
  data.swarms = swarms.map((c, id) => ({ ...template, ...c, id })); s.load(data)
  assert.deepEqual(totals(s), expected)
})
