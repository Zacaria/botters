import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMatch, applyInput, step, visible, HOUSE } from '../sim.js'
import { createMirror, encodeFrame, decodeFrame, board } from '../wire.js'

const house = (seed, minutes = 3) => { const s = createMatch(seed, { minutes, planets: 17 }); applyInput(s, 0, { gambits: HOUSE.hard }); applyInput(s, 1, { gambits: HOUSE.normal }); return s }

// The client sees exactly its own units and the enemies sim.visible allows, each within 0.5 px.
function check(s, side, client) {
  for (let i = 0; i < s.N; i++) {
    const mine = s.side[i] === side, should = s.alive[i] && (mine || visible(s, side, s.x[i], s.y[i]))
    if (client.has[i] && !mine) assert.ok(s.alive[i] && visible(s, side, s.x[i], s.y[i]), `tick ${s.tick}: enemy ${i} sent outside visible()`)
    assert.equal(!!client.has[i], !!should, `tick ${s.tick}: unit ${i} ${should ? 'missing' : 'sent'}`)
    if (!should) continue
    assert.ok(Math.abs(client.x[i] / 4 - s.x[i]) <= 0.5 && Math.abs(client.y[i] / 4 - s.y[i]) <= 0.5, `tick ${s.tick}: unit ${i} off by more than 0.5 px`)
    assert.equal(client.role[i], s.role[i])
    if (mine) assert.equal(client.bat[i], s.bat[i])
  }
}

test('a full match decodes within 0.5 px and never sends an enemy outside visible()', { timeout: 120000 }, () => {
  const s = house(7), server = [createMirror(), createMirror()], client = [createMirror(), createMirror()]
  let frames = 0, enemiesSent = 0
  while (!s.ended) {
    for (const side of [0, 1]) {
      decodeFrame(encodeFrame(s, side, server[side]), client[side])
      check(s, side, client[side])
      for (let i = 0; i < s.N; i++) if (client[side].has[i] && s.side[i] !== side) enemiesSent++
    }
    frames++; step(s); step(s)
  }
  assert.ok(frames > 1700, `${frames} frames`)
  assert.ok(enemiesSent > 0, 'the sides met: some enemies were visible and sent')
})

test('reset yields a full snapshot that a fresh client decodes; a corrupt frame throws', () => {
  const s = house(3), server = createMirror(), client = createMirror()
  for (let k = 0; k < 400; k++) { decodeFrame(encodeFrame(s, 0, server), client); step(s); step(s) }
  const late = createMirror(); server.reset = true
  const full = encodeFrame(s, 0, server)
  assert.equal(full[0] & 1, 1)
  decodeFrame(full, late); check(s, 0, late)
  step(s); step(s)
  const next = encodeFrame(s, 0, server)
  decodeFrame(next, late); check(s, 0, late)
  assert.throws(() => decodeFrame(next.slice(0, -1), createMirror()))
  assert.throws(() => decodeFrame(next, client), 'a client that missed the reset is detected')
})

test('board carries own battalions and planets, not enemy battalions', () => {
  const s = house(5)
  for (let k = 0; k < 200; k++) step(s)
  const b = board(s, 1)
  assert.ok(b.bats.length && b.bats.every(o => s.bats[o.id].side === 1))
  assert.equal(b.planets.length, s.planets.length)
  assert.deepEqual(Object.keys(b.bats[0]).sort(), ['fighting', 'id', 'manual', 'rule', 'tx', 'ty', 'via'])
})
