import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMatch, applyInput, view, visible } from '../sim.js'

// One enemy battalion left, moved to `gap` px east of the first own battalion.
function duel(gap) {
  const s = createMatch(7, {}), own = s.bats.find(b => b.side === 0 && b.n), foe = s.bats.find(b => b.side === 1 && b.n)
  const dx = own.cx + gap - foe.cx, dy = own.cy - foe.cy
  for (let i = 0; i < s.N; i++) if (s.alive[i] && s.side[i] === 1) { if (s.bat[i] === foe.id) { s.x[i] += dx; s.y[i] += dy } else s.alive[i] = 0 }
  for (const o of s.bats) if (o.side === 1 && o.id !== foe.id) o.n = 0
  foe.cx += dx; foe.cy += dy
  s.planets.forEach(p => { p.owner = -1 })
  return { s, own, foe }
}

test('a hand flank order needs an enemy battalion in sight', () => {
  const { s, own, foe } = duel(400)
  assert.equal(visible(s, 0, foe.cx, foe.cy), false)
  const before = view(s, 0).battalions.find(b => b.id === own.id)
  assert.deepEqual(applyInput(s, 0, { flank: own.id }), { ok: false, error: 'no enemy battalion in sight' })
  assert.deepEqual(view(s, 0).battalions.find(b => b.id === own.id), before)
})

test('a hand flank order swings round an enemy battalion in sight', () => {
  const { s, own, foe } = duel(120)
  assert.equal(visible(s, 0, foe.cx, foe.cy), true)
  assert.deepEqual(applyInput(s, 0, { flank: own.id }), { ok: true })
  const b = view(s, 0).battalions.find(x => x.id === own.id)
  assert.ok(Math.hypot(b.tx - foe.cx, b.ty - foe.cy) < 60 && b.manual)
})
