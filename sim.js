// Deterministic match simulation. Pure: same seed + same inputs at the same ticks => same match.
// No Math.random / Date here, so a match can be replayed from its input log.

export const W = 40, H = 24, TPS = 10, MATCH_TICKS = 300 * TPS, WIN_SCORE = 200
export const VISION = 6, BUSH_REVEAL = 1.5, CAPTURE_R = 1.5, MINE_R = 1.2
export const POINTS = { A: { x: 20, y: 4 }, B: { x: 20, y: 12 }, C: { x: 20, y: 20 } }
export const NODES = [{ x: 5, y: 6 }, { x: 5, y: 18 }, { x: 14, y: 12 }, { x: 26, y: 12 }, { x: 35, y: 6 }, { x: 35, y: 18 }]
export const BASE = { blue: { x: 2, y: 12 }, red: { x: 38, y: 12 } }
export const UNITS = {
  fast: { hp: 80, speed: 0.18, range: 1, dmg: 6, cd: 5, beats: 'ranged', cost: 20 },
  tank: { hp: 160, speed: 0.08, range: 1, dmg: 7, cd: 8, beats: 'fast', cost: 30 },
  ranged: { hp: 60, speed: 0.11, range: 4, dmg: 8, cd: 7, beats: 'tank', cost: 25 },
  miner: { hp: 50, speed: 0.1, range: 0, dmg: 0, cd: 1, beats: null, cost: 15 },
}
export const COUNTER = 1.75, MINE_RATE = 0.05, MAX_UNITS = 20, MAX_MINERS = 6
export const ABILITIES = { strike: 45 * TPS, overdrive: 60 * TPS, recall: 60 * TPS, reveal: 45 * TPS }
const STRIKE = { delay: 10, r: 2, dmg: 90 }
const START = ['miner', 'miner', 'miner', 'fast', 'fast', 'fast', 'tank', 'tank', 'tank', 'ranged', 'ranged', 'ranged']
const SIDES = ['blue', 'red'], other = side => (side === 'blue' ? 'red' : 'blue')
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

function rng(seed) { // mulberry32
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

function makeBushes(seed) { // mirror-symmetric so neither side gets a better map
  const r = rng(seed), bush = new Array(W * H).fill(0)
  const blocked = (x, y) => x < 4 || [...Object.values(POINTS), ...NODES].some(p => Math.hypot(p.x - x, p.y - y) < 2.5)
  for (let c = 0; c < 9; c++) {
    let x = 4 + Math.floor(r() * 16), y = Math.floor(r() * H)
    for (let i = 0, n = 4 + Math.floor(r() * 6); i < n; i++) {
      if (x >= 0 && x < W / 2 && y >= 0 && y < H && !blocked(x + 0.5, y + 0.5)) bush[y * W + x] = bush[y * W + (W - 1 - x)] = 1
      if (r() < 0.5) x += r() < 0.5 ? 1 : -1; else y += r() < 0.5 ? 1 : -1
    }
  }
  return bush
}

export const inBush = (s, u) => s.bush[Math.floor(u.y) * W + Math.floor(u.x)] === 1

export function spawn(s, side, type, x, y) {
  const u = { id: side[0] + ++s.ids[side], side, type, x, y, hp: UNITS[type].hp, cd: UNITS[type].cd, order: null, revealUntil: 0 }
  s.units.push(u)
  return u
}

export function createMatch(seed) {
  const s = {
    seed, tick: 0, bush: makeBushes(seed), units: [], ids: { blue: 0, red: 0 }, ended: null,
    score: { blue: 0, red: 0 }, res: { blue: 0, red: 0 },
    points: Object.fromEntries(Object.keys(POINTS).map(k => [k, { owner: null, c: 0 }])),
    ready: { blue: {}, red: {} }, boost: { blue: 0, red: 0 }, reveal: { blue: 0, red: 0 }, strikes: [],
  }
  for (const side of SIDES) START.forEach((type, i) => {
    const x = side === 'blue' ? 2 + (i % 2) : W - 2 - (i % 2)
    spawn(s, side, type, x, 6.5 + i)
  })
  return s
}

export function visibleEnemies(s, side) {
  const mine = s.units.filter(u => u.side === side)
  return s.units.filter(e => e.side !== side && (s.reveal[side] > s.tick || mine.some(f => {
    const d = dist(f, e)
    return d <= VISION && (d <= BUSH_REVEAL || !inBush(s, e) || e.revealUntil > s.tick)
  })))
}

// One player input, applied before the next tick. Returns {ok} or {ok:false, error}.
export function applyInput(s, side, input) {
  if (s.ended) return { ok: false, error: 'match ended' }
  const skipped = []
  if (input.orders) {
    // Orders are planned on a slightly old view: dead units and vanished targets are skipped, not errors.
    const seen = new Set(visibleEnemies(s, side).map(e => e.id))
    for (const [id, o] of Object.entries(input.orders)) {
      if (!id.startsWith(side[0])) return { ok: false, error: `not your unit: ${id}` }
      if (o.target === undefined && !(o.hold || (Number.isFinite(o.x) && Number.isFinite(o.y)))) return { ok: false, error: `bad order for ${id}` }
    }
    for (const [id, o] of Object.entries(input.orders)) {
      const u = s.units.find(x => x.id === id)
      if (!u || (o.target !== undefined && !seen.has(o.target))) { skipped.push(id); continue }
      if (o.target !== undefined) { const t = s.units.find(x => x.id === o.target); u.order = { target: t.id, x: t.x, y: t.y } }
      else u.order = o.hold ? null : { x: Math.min(W - 0.5, Math.max(0.5, o.x)), y: Math.min(H - 0.5, Math.max(0.5, o.y)) }
    }
  }
  if (input.buy) {
    const type = UNITS[input.buy]
    if (!type) return { ok: false, error: `unknown unit: ${input.buy}` }
    const own = s.units.filter(u => u.side === side)
    if (own.length >= MAX_UNITS) return { ok: false, error: `unit cap ${MAX_UNITS}` }
    if (input.buy === 'miner' && own.filter(u => u.type === 'miner').length >= MAX_MINERS) return { ok: false, error: `miner cap ${MAX_MINERS}` }
    if (s.res[side] < type.cost) return { ok: false, error: `need ${type.cost} resources` }
    s.res[side] -= type.cost
    spawn(s, side, input.buy, BASE[side].x, BASE[side].y)
  }
  if (input.ability) {
    const a = input.ability
    if (!(a in ABILITIES)) return { ok: false, error: `unknown ability: ${a}` }
    if ((s.ready[side][a] || 0) > s.tick) return { ok: false, error: `${a} ready in ${Math.ceil((s.ready[side][a] - s.tick) / TPS)}s` }
    if (a === 'strike' && !(Number.isFinite(input.x) && Number.isFinite(input.y))) return { ok: false, error: 'strike needs x, y' }
    s.ready[side][a] = s.tick + ABILITIES[a]
    if (a === 'strike') s.strikes.push({ side, x: input.x, y: input.y, at: s.tick + STRIKE.delay })
    if (a === 'overdrive') s.boost[side] = s.tick + 5 * TPS
    if (a === 'reveal') s.reveal[side] = s.tick + 3 * TPS
    if (a === 'recall') s.units.filter(u => u.side === side && u.type === 'miner').forEach(u => { u.x = BASE[side].x; u.y = BASE[side].y; u.order = null })
  }
  return { ok: true, skipped }
}

function moveToward(u, goal, speed) {
  const d = dist(u, goal)
  if (d < 0.01) return
  const k = Math.min(speed, d) / d
  u.x += (goal.x - u.x) * k; u.y += (goal.y - u.y) * k
}

export function step(s) {
  if (s.ended) return
  const seen = Object.fromEntries(SIDES.map(side => [side, new Set(visibleEnemies(s, side).map(e => e.id))]))
  const byId = new Map(s.units.map(u => [u.id, u]))

  for (const u of s.units) { // move
    const T = UNITS[u.type], speed = T.speed * (s.boost[u.side] > s.tick ? 1.5 : 1)
    if (!u.order) continue
    const t = u.order.target !== undefined && byId.get(u.order.target)
    if (t && seen[u.side].has(t.id)) { u.order.x = t.x; u.order.y = t.y } // track while visible; else go to last seen spot
    if (t && dist(u, t) <= T.range && seen[u.side].has(t.id)) continue
    moveToward(u, u.order, speed)
    if (!t && dist(u, u.order) < 0.05) u.order = u.order.target !== undefined ? null : u.order
  }

  for (const u of s.units) { // attack
    const T = UNITS[u.type]
    if (u.cd > 0) u.cd--
    if (!T.dmg || u.cd > 0) continue
    const ordered = u.order?.target !== undefined && byId.get(u.order.target)
    const inRange = e => e.hp > 0 && seen[u.side].has(e.id) && dist(u, e) <= T.range
    const target = ordered && inRange(ordered) ? ordered
      : s.units.filter(e => e.side !== u.side && inRange(e)).sort((a, b) => dist(u, a) - dist(u, b))[0]
    if (!target) continue
    target.hp -= T.dmg * (T.beats === target.type ? COUNTER : 1)
    u.cd = T.cd
    if (inBush(s, u)) u.revealUntil = s.tick + TPS
  }

  for (const k of s.strikes.filter(k => k.at <= s.tick)) // strikes land after a visible delay
    for (const e of s.units) if (e.side !== k.side && dist(e, k) <= STRIKE.r) e.hp -= STRIKE.dmg
  s.strikes = s.strikes.filter(k => k.at > s.tick)

  for (const u of s.units) // mine
    if (u.type === 'miner' && u.hp > 0 && NODES.some(n => dist(u, n) <= MINE_R)) s.res[u.side] += MINE_RATE

  s.units = s.units.filter(u => u.hp > 0)

  for (const [k, p] of Object.entries(s.points)) { // capture and score
    const near = side => s.units.some(u => u.side === side && dist(u, POINTS[k]) <= CAPTURE_R)
    const b = near('blue'), r = near('red')
    if (b && !r) p.c = Math.min(1, p.c + 0.05)
    if (r && !b) p.c = Math.max(-1, p.c - 0.05)
    if (p.c >= 1) p.owner = 'blue'
    else if (p.c <= -1) p.owner = 'red'
    else if ((p.owner === 'blue' && p.c <= 0) || (p.owner === 'red' && p.c >= 0)) p.owner = null
    if (p.owner) s.score[p.owner] += 1 / TPS
  }

  s.tick++
  const alive = side => s.units.some(u => u.side === side)
  const lead = s.score.blue === s.score.red ? null : s.score.blue > s.score.red ? 'blue' : 'red'
  const top = SIDES.find(side => s.score[side] >= WIN_SCORE)
  if (top) s.ended = { winner: lead, reason: 'score' }
  else if (!alive('blue') || !alive('red')) s.ended = { winner: alive('blue') ? 'blue' : alive('red') ? 'red' : null, reason: 'wipe' }
  else if (s.tick >= MATCH_TICKS) s.ended = { winner: lead, reason: 'time' }
}

// What one side is allowed to know. Never leaks hidden enemies.
export function view(s, side) {
  const r1 = n => Math.round(n * 10) / 10
  return {
    tick: s.tick, side, secondsLeft: Math.ceil((MATCH_TICKS - s.tick) / TPS), ended: s.ended,
    score: { you: Math.floor(s.score[side]), enemy: Math.floor(s.score[other(side)]), win: WIN_SCORE },
    resources: Math.floor(s.res[side]),
    points: Object.fromEntries(Object.entries(s.points).map(([k, p]) => [k, { ...POINTS[k], owner: p.owner === side ? 'you' : p.owner ? 'enemy' : null }])),
    units: s.units.filter(u => u.side === side).map(u => ({ id: u.id, type: u.type, x: r1(u.x), y: r1(u.y), hp: Math.ceil(u.hp), maxHp: UNITS[u.type].hp, inBush: inBush(s, u), order: u.order && (u.order.target !== undefined ? { target: u.order.target } : { x: r1(u.order.x), y: r1(u.order.y) }) })),
    enemies: visibleEnemies(s, side).map(u => ({ id: u.id, type: u.type, x: r1(u.x), y: r1(u.y), hp: Math.ceil(u.hp), maxHp: UNITS[u.type].hp })),
    strikes: s.strikes.map(k => ({ x: k.x, y: k.y, inSeconds: (k.at - s.tick) / TPS, by: k.side === side ? 'you' : 'enemy' })),
    abilities: Object.fromEntries(Object.keys(ABILITIES).map(a => [a, Math.max(0, Math.ceil(((s.ready[side][a] || 0) - s.tick) / TPS))])),
    boosted: s.boost[side] > s.tick, revealed: s.reveal[side] > s.tick,
  }
}

export const mapInfo = s => ({ W, H, bush: s.bush, points: POINTS, nodes: NODES, base: BASE, units: UNITS, abilities: ABILITIES, counter: COUNTER, maxUnits: MAX_UNITS, maxMiners: MAX_MINERS })
