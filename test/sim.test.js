import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMatch, applyInput, step, view, addSwarm, W, H, TPS, MATCH_TICKS, MAX_SWARMS, DEFAULT_GAMBITS, replay } from '../sim.js'

const run = (s, ticks) => { for (let i = 0; i < ticks && !s.ended; i++) step(s) }
const empty = seed => { // planets kept, no starting swarms, both homes kept alive
  const s = createMatch(seed); s.swarms = []; return s
}
const only = (s, side, gambits) => applyInput(s, side, { gambits })

test('same seed and inputs give the same match; maps are mirrored and differ by seed', () => {
  const play = () => {
    const s = createMatch(7)
    for (let t = 0; t < 1200; t++) {
      if (t === 40) applyInput(s, 0, { order: { swarm: s.swarms[0].id, x: 600, y: 350 } })
      step(s)
    }
    return JSON.stringify(s)
  }
  assert.equal(play(), play())
  const s = createMatch(1)
  for (const p of s.planets) assert.ok(s.planets.some(o => Math.abs(o.x - (W - p.x)) < 1e-9 && o.y === p.y && o.r === p.r))
  assert.notDeepEqual(createMatch(1).planets, createMatch(2).planets)
})

test('square law: the bigger swarm wins and loses far fewer than the smaller one', () => {
  const s = empty(3)
  only(s, 0, [{ if: 'always', then: 'hold' }]); only(s, 1, [{ if: 'always', then: 'hold' }])
  const a = addSwarm(s, 0, 600, 350, 2000), b = addSwarm(s, 1, 610, 350, 1000)
  run(s, 60 * TPS)
  assert.ok(!s.swarms.includes(b))
  assert.ok(a.n > 1500, `bigger kept ${a.n}`) // Lanchester: sqrt(2000² − 1000²) ≈ 1732
})

test('gambits: first enabled matching rule decides, disabled rules are skipped', () => {
  const s = empty(4)
  only(s, 1, [{ if: 'always', then: 'hold' }])
  const c = addSwarm(s, 0, 300, 350, 1000)
  addSwarm(s, 1, 380, 350, 5000) // visible, much bigger
  only(s, 0, [{ if: 'bigger_enemy_near', then: 'retreat' }, { if: 'always', then: 'hold' }])
  run(s, 20)
  assert.equal(c.rule, 0)
  assert.ok(c.tx < 300, 'retreats away from the threat, towards home')
  applyInput(s, 0, { toggle: 0 })
  run(s, 20)
  assert.equal(c.rule, 1)
})

test('gambit parameters change what a condition matches', () => {
  const s = empty(5)
  only(s, 1, [{ if: 'always', then: 'hold' }])
  const c = addSwarm(s, 0, 300, 350, 1000)
  addSwarm(s, 1, 380, 350, 1500)
  only(s, 0, [{ if: 'bigger_enemy_near', p: 2, then: 'retreat' }, { if: 'always', then: 'hold' }])
  run(s, 20)
  assert.equal(c.rule, 1) // 1500 is not 2× bigger
})

test('invalid gambit lists are rejected and the old list stays', () => {
  const s = createMatch(6), before = s.gambits[0]
  assert.equal(only(s, 0, [{ if: 'teleport', then: 'go' }]).ok, false)
  assert.equal(only(s, 0, [{ if: 'always', then: 'explode' }]).ok, false)
  assert.equal(only(s, 0, Array(11).fill({ if: 'always', then: 'hold' })).ok, false)
  assert.equal(only(s, 0, [{ if: 'small', p: -5, then: 'go' }]).ok, false)
  assert.equal(s.gambits[0], before)
  assert.ok(DEFAULT_GAMBITS.length <= 10)
})

test('fog: enemy swarms out of vision are hidden from the view and from gambits', () => {
  const s = empty(7)
  only(s, 1, [{ if: 'always', then: 'hold' }])
  const c = addSwarm(s, 0, 300, 120, 1000)
  const far = addSwarm(s, 1, 900, 600, 9000)
  assert.equal(view(s, 0).enemies.some(e => e.id === far.id), false)
  only(s, 0, [{ if: 'bigger_enemy_near', p: 1.2, then: 'retreat' }, { if: 'always', then: 'hold' }])
  run(s, 20)
  assert.equal(c.rule, 1)
  far.x = 330; far.y = 120
  assert.equal(view(s, 0).enemies.some(e => e.id === far.id), true)
})

test('a swarm parked on a free planet captures it and eats it into particles', () => {
  const s = empty(8)
  only(s, 0, [{ if: 'always', then: 'hold' }]); only(s, 1, [{ if: 'always', then: 'hold' }])
  const p = s.planets.find(p => p.owner === -1)
  const c = addSwarm(s, 0, p.x, p.y, 1000)
  run(s, 60 * TPS)
  assert.equal(p.owner, 0)
  assert.ok(p.mass < p.m0)
  const mine = s.swarms.filter(o => o.side === 0).reduce((a, o) => a + o.n, 0)
  assert.ok(mine > 1000, `side grew to ${mine}`)
  assert.ok(c)
})

test('hand control: orders override gambits until released; split halves a swarm; caps hold', () => {
  const s = empty(9)
  only(s, 1, [{ if: 'always', then: 'hold' }])
  only(s, 0, [{ if: 'always', then: 'hold' }])
  const c = addSwarm(s, 0, 300, 350, 2000)
  assert.equal(applyInput(s, 0, { order: { swarm: c.id, x: 500, y: 350 } }).ok, true)
  run(s, 40)
  assert.ok(c.x > 330 && c.manual)
  const before = s.swarms.filter(o => o.side === 0).length // the home planet spawns its own swarm too
  assert.equal(applyInput(s, 0, { split: c.id }).ok, true)
  assert.equal(s.swarms.filter(o => o.side === 0).length, before + 1)
  assert.equal(c.n, 1000)
  applyInput(s, 0, { release: c.id })
  run(s, 20)
  assert.equal(c.manual, false)
  for (let i = 0; i < 60; i++) addSwarm(s, 0, 100 + i * 15, 100, 300)
  assert.ok(s.swarms.filter(o => o.side === 0).length <= MAX_SWARMS)
})

test('a side cannot command enemy swarms', () => {
  const s = createMatch(10)
  const red = s.swarms.find(o => o.side === 1)
  assert.equal(applyInput(s, 0, { order: { swarm: red.id, x: 0, y: 0 } }).ok, false)
  assert.equal(applyInput(s, 0, { split: red.id }).ok, false)
})

test('match ends by wipe, or at 5:00 by particle count', () => {
  let s = empty(11)
  for (const p of s.planets) if (p.owner === 1) p.mass = 0
  addSwarm(s, 0, 100, 100, 500)
  step(s)
  assert.deepEqual(s.ended, { winner: 0, reason: 'wipe' })
  s = createMatch(12)
  s.swarms.find(o => o.side === 1).n += 500
  s.tick = MATCH_TICKS - 1
  step(s)
  assert.equal(s.ended.winner, 1)
  assert.equal(s.ended.reason, 'time')
})

test('replay: the input log reproduces the match; dropping inputs gives the "what if" match', () => {
  const s = createMatch(15), log = []
  const send = (side, role, input) => { if (applyInput(s, side, input).ok) log.push({ tick: s.tick, side, role, input }) }
  send(1, 'house', { gambits: [{ if: 'always', then: 'hold' }] })
  while (!s.ended) {
    if (s.tick === 100) send(0, 'agent', { gambits: [{ if: 'free_planet', then: 'go' }] })
    if (s.tick === 400) send(0, 'human', { order: { swarm: s.swarms.find(c => c.side === 0).id, x: 1100, y: 350 } })
    step(s)
  }
  assert.deepEqual(replay(15, log).ended, s.ended)
  assert.equal(JSON.stringify(replay(15, log)), JSON.stringify(s))
  const noHuman = replay(15, log.filter(l => l.role !== 'human'))
  assert.notEqual(JSON.stringify(noHuman), JSON.stringify(s))
})

test('default gambits beat doing nothing', () => {
  const s = createMatch(13)
  only(s, 1, [{ if: 'always', then: 'hold' }])
  run(s, MATCH_TICKS)
  assert.equal(s.ended.winner, 0)
  assert.ok(H > 0)
})
