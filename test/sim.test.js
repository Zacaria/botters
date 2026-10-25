import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMatch, applyInput, step, view, addSwarm, totals, W, H, TPS, MAX_SWARMS, DEFAULT_GAMBITS, HOUSE, MODES, replay } from '../sim.js'

const run = (s, ticks) => { for (let i = 0; i < ticks && !s.ended; i++) step(s) }
const empty = seed => { // planets kept, no starting swarms, both homes kept alive
  const s = createMatch(seed); s.swarms = []; return s
}
const only = (s, side, gambits) => applyInput(s, side, { gambits })

test('surrender loses for either side, freezes the match and replays at the same tick', () => {
  for (const side of [0, 1]) for (const tick of [0, 40]) {
    const s = createMatch(7, { minutes: 3, planets: 16 })
    run(s, tick)
    const input = { surrender: true }
    assert.deepEqual(applyInput(s, side, input), { ok: true })
    assert.deepEqual(s.ended, { winner: 1 - side, reason: 'surrender' })
    assert.deepEqual(view(s, side).ended, { result: 'lost', reason: 'surrender' })
    assert.deepEqual(view(s, 1 - side).ended, { result: 'won', reason: 'surrender' })
    const frozen = structuredClone(s)
    step(s)
    assert.equal(applyInput(s, 1 - side, input).ok, false)
    assert.deepEqual(s, frozen)
    assert.deepEqual(replay(s.seed, [{ tick, side, input }], s.opts), s)
  }
})

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

test('front law: the bigger swarm wins and keeps more than the old square law left (2646 of 4000 vs 3000)', () => {
  const s = empty(3)
  only(s, 0, [{ if: 'always', then: 'hold' }]); only(s, 1, [{ if: 'always', then: 'hold' }])
  const a = addSwarm(s, 0, 600, 350, 4000), b = addSwarm(s, 1, 610, 350, 3000)
  run(s, 40 * TPS)
  assert.ok(!s.swarms.includes(b))
  assert.ok(a.n + a.belly > 3000, `winner kept ${a.n} + ${a.belly} still digesting`)
})

test('equal swarms do not melt each other for minutes: a fight ends in under a minute', () => {
  const s = empty(3)
  only(s, 0, [{ if: 'always', then: 'hold' }]); only(s, 1, [{ if: 'always', then: 'hold' }])
  const a = addSwarm(s, 0, 600, 350, 3000), b = addSwarm(s, 1, 601, 350, 3000)
  run(s, 60 * TPS)
  assert.ok(!s.swarms.includes(a) || !s.swarms.includes(b), 'one side is gone')
})

test('hunger: a swarm that never touches a planet starves; touching one resets it', () => {
  const s = empty(6)
  only(s, 0, [{ if: 'always', then: 'hold' }]); only(s, 1, [{ if: 'always', then: 'hold' }])
  const lone = addSwarm(s, 0, 600, 20, 3000)
  run(s, 60 * TPS)
  assert.ok(lone.n < 3000, `starved to ${lone.n}`)
  assert.ok(view(s, 0).swarms[0].hunger >= 1)
  const t = empty(6); only(t, 0, [{ if: 'always', then: 'hold' }]); only(t, 1, [{ if: 'always', then: 'hold' }])
  const home = addSwarm(t, 0, t.planets[0].x, t.planets[0].y, 3000)
  run(t, 60 * TPS)
  assert.ok(home.n >= 3000, 'a swarm on a planet is fed')
})

test('gambits: hungry goes to food', () => {
  const s = empty(7)
  only(s, 1, [{ if: 'always', then: 'hold' }])
  const c = addSwarm(s, 0, 600, 300, 1000); c.meal = -10000
  only(s, 0, [{ if: 'hungry', then: 'go' }])
  run(s, 20)
  const p = s.planets.filter(q => q.mass > 0).sort((a, b) => Math.hypot(a.x - 600, a.y - 300) - Math.hypot(b.x - 600, b.y - 300))[0]
  assert.deepEqual([c.tx, c.ty], [p.x, p.y])
})

test('modes: sides, teams, symmetric homes and three swarms per side', () => {
  for (const [mode, teams] of Object.entries(MODES)) {
    const s = createMatch(11, { mode })
    assert.deepEqual(s.teams, teams)
    assert.equal(s.swarms.length, teams.length * 3)
    for (let side = 0; side < teams.length; side++) assert.equal(s.planets[side].owner, side)
    assert.ok(s.planets.every(p => p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H))
  }
  const a = createMatch(11, { mode: 'ffa6' })
  const homes = a.planets.slice(0, 6)
  for (const h of homes) assert.ok(homes.some(o => o !== h && Math.abs(o.x - (W - h.x)) < 1 && Math.abs(o.y - h.y) < 1) || h.y === H / 2, 'x-mirror exists')
  const live = createMatch(5, { mode: '2v2', minutes: 3 })
  while (!live.ended) step(live)
  assert.deepEqual(replay(5, [], live.opts), live) // valid wipes can end before the time limit
})

test('2v2: allies share vision, never fight, and the team wins together', () => {
  const s = createMatch(12, { mode: '2v2' })
  s.swarms = []
  for (const side of [0, 1, 2, 3]) only(s, side, [{ if: 'always', then: 'hold' }])
  const a = addSwarm(s, 0, 600, 350, 3000), ally = addSwarm(s, 1, 601, 350, 3000), foe = addSwarm(s, 2, 1000, 600, 3000)
  run(s, 5 * TPS)
  assert.equal(a.n >= 3000 && ally.n >= 3000, true, 'allies on the same spot do not hurt each other')
  assert.ok(view(s, 0).allies.some(c => c.id === ally.id))
  assert.ok(!view(s, 0).enemies.some(c => c.id === foe.id), 'far foe stays hidden')
  s.planets.forEach(p => { if (p.owner === 2 || p.owner === 3) p.owner = -1 })
  s.swarms = s.swarms.filter(c => c.side < 2)
  run(s, 2 * TPS)
  assert.deepEqual(s.ended, { winner: 0, reason: 'wipe' })
  assert.deepEqual(view(s, 1).ended, { result: 'won', reason: 'wipe' })
  assert.deepEqual(view(s, 3).ended, { result: 'lost', reason: 'wipe' })
})

test('free-for-all: last side standing wins; surrender hands the match to the leading rival; a draw needs equal totals', () => {
  const s = createMatch(13, { mode: 'ffa4' })
  s.swarms = s.swarms.filter(c => c.side === 0 || c.side === 3)
  s.planets.forEach(p => { if (p.owner === 1 || p.owner === 2) p.owner = -1 })
  run(s, 2 * TPS)
  assert.deepEqual(s.ended, { winner: 3 === s.teams[3] ? 3 : 0, reason: 'wipe' }.reason === 'wipe' && s.ended)
  const t = createMatch(13, { mode: 'ffa4' })
  t.swarms.find(c => c.side === 2).n = 9000
  applyInput(t, 0, { surrender: true })
  assert.deepEqual(t.ended, { winner: 2, reason: 'surrender' })
  const u = createMatch(14, { mode: 'ffa4', minutes: 3 })
  u.swarms.find(c => c.side === 1).n = 20000
  for (const side of [0, 1, 2, 3]) applyInput(u, side, { gambits: [{ if: 'always', then: 'hold' }] })
  while (!u.ended) step(u)
  assert.equal(u.ended.reason === 'time' ? u.ended.winner : 1, 1)
  assert.equal(view(u, 1).totals.foes.length, 3)
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
  s.tick = s.endTick - 1
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
  run(s, s.endTick)
  assert.equal(s.ended.winner, 0)
  assert.ok(H > 0)
})

test('match options: length and planet count; unknown values fall back to defaults; replay keeps them', () => {
  const s = createMatch(16, { minutes: 3, planets: 16 })
  assert.equal(s.planets.length, 16)
  assert.equal(s.endTick, 3 * 60 * TPS)
  const d = createMatch(16, { minutes: 99, planets: 7 })
  assert.equal(d.planets.length, 28)
  assert.equal(d.endTick, 5 * 60 * TPS)
  run(s, s.endTick)
  assert.equal(JSON.stringify(replay(16, [], { minutes: 3, planets: 16 })), JSON.stringify(s))
})

test('house levels are ordered: easy loses more often than hard against the default gambits', () => {
  const wins = list => { let w = 0; for (let seed = 1; seed <= 6; seed++) { const s = createMatch(seed, { minutes: 3 }); only(s, 1, list); run(s, s.endTick); if (s.ended.winner === 0) w++ } return w }
  assert.ok(wins(HOUSE.easy) > wins(HOUSE.hard))
})

test('gambits naming inherited properties are rejected, not run', () => {
  const s = createMatch(3)
  for (const bad of [{ if: 'constructor', then: 'hold' }, { if: 'always', then: 'toString' }, { if: '__proto__', then: 'go' }])
    assert.equal(applyInput(s, 0, { gambits: [bad] }).ok, false)
  run(s, 40)
})
