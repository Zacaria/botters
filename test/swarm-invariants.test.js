import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMatch, applyInput, addSwarm, step, replay, MODES, OPTIONS, T, W, H } from '../sim.js'

const hold = [{ if: 'always', then: 'hold' }]
const arena = () => {
  const s = createMatch(7)
  s.swarms = []; s.planets = []; s.gambits = s.teams.map(() => hold)
  return s
}
const morph = (s, c, type) => applyInput(s, c.side, { morph: { swarm: c.id, type } }).ok
const order = (s, c) => applyInput(s, c.side, { order: { swarm: c.id, x: 800, y: 350 } })
const runTo = (s, tick) => { while (s.tick < tick && !s.ended) step(s) }

for (const mode of Object.keys(MODES)) for (const planets of OPTIONS.planets) {
  test(`map ${mode}/${planets}: exact total and mirrored resources across seeds`, () => {
    for (const seed of [7, ...Array.from({ length: 100 }, (_, i) => i)]) {
      const s = createMatch(seed, { mode, planets })
      assert.equal(s.planets.length, planets, `seed ${seed}`)
      assert.equal(s.opts.planets, planets)
      for (const p of s.planets) {
        const same = (x, y) => s.planets.some(q => Math.abs(q.x - x) < 1e-9 && Math.abs(q.y - y) < 1e-9 && q.r === p.r && q.mass === p.mass)
        assert.ok(same(W - p.x, p.y), `x symmetry seed ${seed}`)
        if (mode !== '1v1') assert.ok(same(p.x, H - p.y), `y symmetry seed ${seed}`)
      }
    }
  })
}

test('split inherits cocoon and cooldown: child cannot move or remorph early', () => {
  const s = arena(), parent = addSwarm(s, 0, 600, 350, 1000)
  addSwarm(s, 1, 1100, 650, 1000)
  assert.ok(morph(s, parent, 'carapace'))
  assert.ok(applyInput(s, 0, { split: parent.id }).ok)
  const child = s.swarms.at(-1), start = [child.x, child.y]
  assert.equal(morph(s, child, 'spore'), false)
  order(s, child)
  runTo(s, T.COCOON - 1)
  assert.deepEqual([child.x, child.y], start)
  step(s)
  assert.ok(child.x > start[0], 'movement resumes at cocoon end')
  runTo(s, T.MORPH_CD - 1)
  assert.equal(morph(s, child, 'spore'), false)
  step(s)
  assert.equal(morph(s, child, 'spore'), true)
})

for (const victims of [1, 3, 100]) {
  test(`simultaneous attackers digest only actual kills (${victims} particles)`, () => {
    const play = () => {
      const s = arena(), attackers = []
      for (let i = 0; i < 10; i++) {
        const a = addSwarm(s, 0, 600 + i / 100, 350, 1000, 'spore')
        attackers.push(a)
      }
      const target = addSwarm(s, 1, 630, 350, victims, 'locust')
      step(s)
      const killed = victims - Math.max(0, target.n)
      const fed = s.swarms.filter(c => c.side === 0).reduce((n, c) => n + c.n + c.belly, 0) - 10000
      assert.ok(fed > 0 && fed <= killed * T.G + 1e-9, `credited ${fed} for ${killed} kills`)
      assert.ok(s.swarms.every(c => Number.isFinite(c.n) && c.n >= 0 && Number.isFinite(c.belly) && c.belly >= 0))
      assert.ok(target.n >= 0, 'dead target is not overdrawn')
      const credits = attackers.map(c => c.n + c.belly - 1000)
      assert.ok(Math.max(...credits) - Math.min(...credits) < 1e-9, 'equal capped hits get equal shares')
      return s
    }
    assert.deepEqual(play(), play(), 'same fixture gives identical attribution and state')
  })
}

test('mutually killed swarms never digest into negative bellies', () => {
  const s = arena(), all = []
  for (const side of [0, 1]) for (let i = 0; i < 10; i++) {
    const c = addSwarm(s, side, 600, 350, 1, 'spore'); c.belly = 0.5; all.push(c)
  }
  step(s)
  assert.ok(all.every(c => c.n >= 0 && c.belly >= 0))
  assert.equal(s.swarms.length, 0)
})

for (const mode of Object.keys(MODES)) {
  test(`morph/split/order/cooldown full replay: ${mode}`, () => {
    const s = createMatch(7, { mode, minutes: 3, planets: 16 }), log = []
    const send = (side, input) => {
      log.push({ tick: s.tick, side, input })
      return applyInput(s, side, input).ok
    }
    for (let side = 0; side < s.teams.length; side++) assert.ok(send(side, { gambits: hold }))
    const parent = s.swarms[0]
    assert.ok(send(0, { morph: { swarm: parent.id, type: 'carapace' } }))
    assert.ok(send(0, { split: parent.id }))
    const child = s.swarms.at(-1)
    assert.equal(send(0, { morph: { swarm: child.id, type: 'spore' } }), false)
    runTo(s, 81)
    assert.ok(s.swarms.includes(child), 'split halves never merge back')
    assert.ok(send(0, { order: { swarm: parent.id, x: 600, y: 350 } }))
    runTo(s, T.MORPH_CD - 1)
    assert.equal(send(0, { morph: { swarm: parent.id, type: 'spore' } }), false)
    step(s)
    assert.ok(send(0, { morph: { swarm: parent.id, type: 'spore' } }))
    while (!s.ended) step(s)
    assert.deepEqual(replay(s.seed, log, s.opts), s)
  })
}
