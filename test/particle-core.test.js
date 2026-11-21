import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMatch, applyInput, step, snapshot, restore, hash, replay, view } from '../sim.js'

test('particle checkpoints resume bit-identically and replay the input log', () => {
  const s = createMatch(12, { planets: 9 }), log = []
  assert.equal(s.planets.length, 9)
  for (let i = 0; i < 600; i++) {
    if (i === 5 || i === 350) {
      const input = { order: { bat: 0, x: 500 + i, y: 200 } }
      assert.equal(applyInput(s, 0, input).ok, true)
      log.push({ tick: s.tick, side: 0, input })
    }
    if (i === 300) globalThis.checkpoint = JSON.parse(JSON.stringify(snapshot(s)))
    step(s)
  }
  const r = restore(globalThis.checkpoint)
  for (let i = 300; i < 600; i++) {
    if (i === 350) applyInput(r, 0, log[1].input)
    step(r)
  }
  assert.equal(hash(r), hash(s))
  assert.equal(hash(replay(12, log, { planets: 9, tick: 600 })), hash(s))
  assert.ok(Array.isArray(view(s, 0).battalions))
})

test('maps have mirrored pairs and house doctrines are distinct', async () => {
  const { HOUSE, HOUSE_DOCTRINE, DOCTRINES } = await import('../sim.js')
  for (const size of [9, 17, 25]) {
    const s = createMatch(55, { planets: size })
    assert.equal(s.planets.length, size)
    for (let i = 3; i < size; i += 2) {
      assert.equal(s.planets[i].x + s.planets[i + 1].x, 1200)
      assert.equal(s.planets[i].y + s.planets[i + 1].y, 700)
    }
  }
  for (const [level, doctrine] of Object.entries(HOUSE_DOCTRINE)) assert.deepEqual(HOUSE[level], DOCTRINES[doctrine])
})

test('rejects foreign battalions and multiple commands, and surrender ends the duel', () => {
  const s = createMatch(8)
  assert.equal(applyInput(s, 1, { release: 0 }).ok, false)
  assert.equal(applyInput(s, 0, { release: 0, surrender: true }).ok, false)
  assert.deepEqual(applyInput(s, 0, { surrender: true }), { ok: true })
  assert.deepEqual(s.ended, { winner: 1, reason: 'surrender' })
  assert.deepEqual(view(s, 0).ended, { reason: 'surrender', result: 'lost' })
})
