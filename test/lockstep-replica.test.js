import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createReplica } from '../browser-live.js'

const sim = {
  restore: state => structuredClone(state),
  applyInput: (s, side, input) => { s.value += side + input.add },
  step: s => { s.tick++; s.value *= 2 },
  hash: s => s.value,
}

test('replica restores and applies ordered inputs before their tick', () => {
  const r = createReplica(sim, () => assert.fail('unexpected resync'))
  r.receive({ t: 'snap', side: 1, log: 4, state: { tick: 2, value: 1 } })
  r.receive({ t: 'step', tick: 4, inputs: [{ i: 4, tick: 2, side: 0, input: { add: 2 } }, { i: 5, tick: 2, side: 1, input: { add: 1 } }] })
  r.advance(100)
  assert.equal(r.state.tick, 4)
  assert.equal(r.state.value, 20)
  assert.equal(r.side, 1)
})

test('gaps and old inputs trigger one resync until a new snapshot', () => {
  let requests = 0
  const r = createReplica(sim, () => { requests++ })
  const snap = { t: 'snap', side: 0, log: 3, state: { tick: 10, value: 1 } }
  r.receive(snap)
  r.receive({ t: 'step', tick: 11, inputs: [{ i: 4, tick: 10, side: 0, input: { add: 1 } }] })
  r.receive({ t: 'step', tick: 11, inputs: [] })
  assert.equal(requests, 1)
  r.receive(snap)
  r.receive({ t: 'step', tick: 11, inputs: [{ i: 3, tick: 9, side: 0, input: { add: 1 } }] })
  assert.equal(requests, 2)
})

test('compares a delayed server hash with a previously reached tick', () => {
  let requests = 0
  const r = createReplica(sim, () => { requests++ })
  r.receive({ t: 'snap', side: 0, log: 0, state: { tick: 19, value: 1 } })
  r.receive({ t: 'step', tick: 20, inputs: [] })
  r.advance(50)
  r.receive({ t: 'step', tick: 20, inputs: [], hash: [20, 3] })
  assert.equal(requests, 1)
})
