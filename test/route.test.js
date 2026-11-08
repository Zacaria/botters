import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMatch, applyInput, step, view, fromJSON } from '../sim.js'

test('a manual route visits points in order, survives snapshots and can be replaced', () => {
  const s = createMatch(9), c = s.swarms[0], points = [{ x: c.x, y: c.y + 35 }, { x: c.x + 35, y: c.y + 35 }]
  assert.deepEqual(applyInput(s, 0, { route: { swarm: c.id, points } }), { ok: true })
  assert.deepEqual(view(s, 0).swarms.find(x => x.id === c.id).route, points)
  const copy = fromJSON(s.toJSON())
  assert.deepEqual(view(copy, 0).swarms.find(x => x.id === c.id).route, points)
  let visited = false
  for (let i = 0; i < 300 && !s.ended; i++) {
    step(s); const a = s.swarms.find(x => x.id === c.id); if (!a) break
    if (Math.hypot(a.x - points[0].x, a.y - points[0].y) < 3) visited = true
    if (a.tx === points[1].x && a.ty === points[1].y) { assert.ok(visited); break }
  }
  assert.ok(visited)
  assert.deepEqual([s.swarms.find(x => x.id === c.id).tx, s.swarms.find(x => x.id === c.id).ty], [points[1].x, points[1].y])
  applyInput(s, 0, { order: { swarm: c.id, x: 200, y: 200 } })
  assert.equal(view(s, 0).swarms.find(x => x.id === c.id).route, undefined)
})

test('routes reject foreign swarms and invalid points', () => {
  const s = createMatch(9), id = s.swarms[0].id
  for (const route of [{ swarm: s.swarms[3].id, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, { swarm: id, points: [{ x: -1, y: 0 }, { x: 1, y: 1 }] }, { swarm: id, points: [] }]) assert.equal(applyInput(s, 0, { route }).ok, false)
})

test('rejected mixed input leaves the entire simulation unchanged', () => {
  const s = createMatch(9), c = s.swarms[0], before = s.toJSON()
  assert.deepEqual(applyInput(s, 0, { route: { swarm: c.id, points: [{ x: 100, y: 100 }, { x: 200, y: 200 }] }, toggle: 999 }), { ok: false, error: 'no such gambit' })
  assert.deepEqual(s.toJSON(), before)
})

test('terminal tick does not advance route and subsequent steps do not mutate it', () => {
  const initial = createMatch(9).toJSON(); initial.endTick = 1
  const s = fromJSON(initial), c = s.swarms[0], points = [{ x: c.x, y: c.y }, { x: c.x + 30, y: c.y }]
  applyInput(s, 0, { route: { swarm: c.id, points } }); step(s)
  assert.ok(s.ended)
  assert.deepEqual(view(s, 0).swarms.find(x => x.id === c.id).route, points)
  const before = s.toJSON(); step(s); assert.deepEqual(s.toJSON(), before)
})
