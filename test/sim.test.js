import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMatch, applyInput, step, view, spawn, POINTS, TPS, MATCH_TICKS, WIN_SCORE } from '../sim.js'

const empty = seed => { const s = createMatch(seed); s.units = []; return s }
const run = (s, ticks) => { for (let i = 0; i < ticks && !s.ended; i++) step(s) }
const duel = (a, b, gap = 1) => {
  const s = empty(1)
  const u = spawn(s, 'blue', a, 10, 12), e = spawn(s, 'red', b, 10 + gap, 12)
  spawn(s, 'blue', 'miner', 2, 2); spawn(s, 'red', 'miner', 38, 22) // keep both sides alive
  applyInput(s, 'blue', { orders: { [u.id]: { target: e.id } } })
  applyInput(s, 'red', { orders: { [e.id]: { target: u.id } } })
  run(s, 30 * TPS)
  return { blue: s.units.some(x => x.id === u.id), red: s.units.some(x => x.id === e.id) }
}

test('same seed and inputs give the same match', () => {
  const play = () => {
    const s = createMatch(7)
    for (let t = 0; t < 600; t++) {
      if (t === 5) applyInput(s, 'blue', { orders: Object.fromEntries(s.units.filter(u => u.side === 'blue').map(u => [u.id, { x: 20, y: 12 }])) })
      if (t === 9) applyInput(s, 'red', { orders: Object.fromEntries(s.units.filter(u => u.side === 'red').map(u => [u.id, { x: 20, y: 12 }])) })
      step(s)
    }
    return JSON.stringify(s)
  }
  assert.equal(play(), play())
  assert.notDeepEqual(createMatch(1).bush, createMatch(2).bush)
})

test('counter triangle decides duels', () => {
  assert.deepEqual(duel('tank', 'fast'), { blue: true, red: false })
  assert.deepEqual(duel('fast', 'ranged'), { blue: true, red: false })
  assert.deepEqual(duel('ranged', 'tank', 6), { blue: true, red: false })
})

test('bushes hide units until an enemy is close', () => {
  const s = empty(3)
  const b = s.bush.findIndex((v, i) => v && i % 40 > 8 && i % 40 < 30)
  const bx = b % 40 + 0.5, by = Math.floor(b / 40) + 0.5
  const hidden = spawn(s, 'red', 'fast', bx, by)
  const watcher = spawn(s, 'blue', 'ranged', bx + 3, by)
  const sees = () => view(s, 'blue').enemies.some(e => e.id === hidden.id)
  if (s.bush[Math.floor(by) * 40 + Math.floor(bx + 3)]) watcher.x = bx - 3
  assert.equal(sees(), false)
  watcher.x = bx + 1
  assert.equal(sees(), true)
})

test('holding a point captures it and scores', () => {
  const s = empty(4)
  spawn(s, 'blue', 'tank', POINTS.B.x, POINTS.B.y)
  spawn(s, 'red', 'miner', 38, 22)
  run(s, 3 * TPS)
  assert.equal(s.points.B.owner, 'blue')
  const before = s.score.blue
  run(s, 10 * TPS)
  assert.ok(s.score.blue > before)
})

test('match ends by score, wipe or time', () => {
  let s = empty(5); spawn(s, 'blue', 'tank', 5, 5); spawn(s, 'red', 'tank', 30, 5)
  s.score.blue = WIN_SCORE; step(s)
  assert.deepEqual(s.ended, { winner: 'blue', reason: 'score' })

  s = empty(5); spawn(s, 'blue', 'tank', 5, 5); step(s)
  assert.deepEqual(s.ended, { winner: 'blue', reason: 'wipe' })

  s = empty(5); spawn(s, 'blue', 'tank', 5, 5); spawn(s, 'red', 'tank', 30, 5)
  s.score.red = 3; s.tick = MATCH_TICKS - 1; step(s)
  assert.deepEqual(s.ended, { winner: 'red', reason: 'time' })
})

test('strike is telegraphed, hits enemies only, then cools down', () => {
  const s = empty(6)
  const mine = spawn(s, 'blue', 'tank', 20, 12), foe = spawn(s, 'red', 'tank', 21, 12)
  spawn(s, 'red', 'miner', 38, 22)
  assert.equal(applyInput(s, 'blue', { ability: 'strike', x: 20.5, y: 12 }).ok, true)
  assert.equal(view(s, 'red').strikes.length, 1)
  const hp = foe.hp
  step(s); assert.equal(foe.hp, hp)
  run(s, TPS)
  assert.ok(foe.hp < hp - 50)
  assert.equal(mine.hp > 140, true)
  assert.equal(applyInput(s, 'blue', { ability: 'strike', x: 5, y: 5 }).ok, false)
})

test('a side cannot order enemy units', () => {
  const s = createMatch(8)
  const red = s.units.find(u => u.side === 'red')
  assert.equal(applyInput(s, 'blue', { orders: { [red.id]: { x: 0, y: 0 } } }).ok, false)
})

test('economy is capped so it cannot snowball forever', () => {
  const s = createMatch(9)
  s.res.blue = 10000
  let miners = 0
  for (let i = 0; i < 30; i++) if (applyInput(s, 'blue', { buy: 'miner' }).ok) miners++
  assert.equal(miners, 3) // starts with 3, miner cap 6
  for (let i = 0; i < 30; i++) applyInput(s, 'blue', { buy: 'tank' })
  assert.equal(s.units.filter(u => u.side === 'blue').length, 20)
})
