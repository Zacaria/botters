import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMatch, step, MAXPER } from '../sim.js'
import { createMirror, encodeFrame } from '../wire.js'
import { createLiveView } from '../browser-live.js'

test('live view interpolates, summarizes own units and recovers only on reset', () => {
  const state = createMatch(42), encoder = createMirror(), v = createLiveView()
  assert.equal(v.ready, false)
  assert.equal(v.receive(encodeFrame(state, 0, encoder), 100), true)
  assert.ok(v.ready); const before = v.scene(100), i = before.alive.findIndex(Boolean)
  for (let n = 0; n < 2; n++) step(state)
  assert.equal(v.receive(encodeFrame(state, 0, encoder), 200), true)
  const start = v.scene(200), middle = v.scene(250), end = v.scene(300)
  assert.ok(Math.abs(middle.x[i] - (start.x[i] + end.x[i]) / 2) < .001)
  assert.equal(end.side[i], i < MAXPER ? 0 : 1)
  assert.ok(v.battalions.length); assert.ok(v.battalions.every(b => b.n === b.roles.reduce((a, n) => a + n, 0)))
  assert.equal(v.receive(new Uint8Array([0]), 300), false); assert.equal(v.ready, false)
  assert.equal(v.receive(encodeFrame(state, 0, encoder), 400), false)
  encoder.reset = true; assert.equal(v.receive(encodeFrame(state, 0, encoder), 500), true); assert.equal(v.ready, true)
})
