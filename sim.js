// Botters simulation: space swarms conquer and eat planets. Pure and deterministic: state = f(seed, inputs by tick).
// A swarm is a cohort (centre + particle count); individual particles only exist in the browser.
// Sides are 0 and 1. Every swarm follows its side's gambits (IF condition → action) unless a human grabbed it.

export const W = 1200, H = 700, TPS = 20, MATCH_TICKS = 300 * TPS
export const MAX_SWARMS = 40, MAX_GAMBITS = 10
const K = 0.0035 // square law: each tick a swarm loses K × the enemy count it touches
const THINK = 10 // gambits are re-evaluated every 0.5 s
const SWARM_VISION = 150, PLANET_VISION = 80, START_N = 3000

export const rad = n => 4 + Math.sqrt(n) * 0.32
const speed = n => 1.5 - Math.min(1, n / 15000) * 0.9 // big swarms are slow
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const nearest = (c, list, max = Infinity) => { let b = null, bd = max; for (const o of list) { const d = dist(c, o); if (d < bd) { bd = d; b = o } } return b }

// ---------- gambits ----------
// A condition returns what it found (an enemy, a planet, a friend) or nothing. `p` tunes it.
export const CONDITIONS = {
  bigger_enemy_near: { p: 1.2, doc: 'a visible enemy swarm at least p× our size within 170 → that enemy', fn: (s, c, p) => nearest(c, seen(s, c.side).filter(o => o.n >= c.n * p), 170) },
  weaker_enemy_near: { p: 0.9, doc: 'a visible enemy swarm at most p× our size within 230 → that enemy', fn: (s, c, p) => nearest(c, seen(s, c.side).filter(o => o.n <= c.n * p), 230) },
  enemy_near: { p: 200, doc: 'any visible enemy swarm within p → that enemy', fn: (s, c, p) => nearest(c, seen(s, c.side), p) },
  planet_attacked: { p: 500, doc: 'one of our planets within p has a visible enemy next to it → that planet', fn: (s, c, p) => nearest(c, s.planets.filter(o => o.owner === c.side && o.mass > 0 && nearest(o, seen(s, c.side), o.r + 70)), p) },
  small: { p: 400, doc: 'this swarm has fewer than p particles → the nearest friendly swarm', fn: (s, c, p) => c.n < p && nearest(c, s.swarms.filter(o => o.side === c.side && o !== c)) },
  big: { p: 4000, doc: 'this swarm has more than p particles → itself', fn: (s, c, p) => c.n > p && c },
  free_planet: { p: 2000, doc: 'an unowned planet with mass left within p → that planet', fn: (s, c, p) => nearest(c, s.planets.filter(o => o.owner === -1 && o.mass > 0), p) },
  enemy_planet: { p: 2000, doc: 'an enemy planet with mass left within p → that planet', fn: (s, c, p) => nearest(c, s.planets.filter(o => o.owner === 1 - c.side && o.mass > 0), p) },
  always: { p: 0, doc: 'always true → nothing', fn: () => true },
}
export const ACTIONS = {
  go: { doc: 'move to what the condition found: attack the enemy, capture or defend the planet, merge into the friend', fn: (s, c, it) => moveTo(c, it) },
  retreat: { doc: 'move to the nearest friendly swarm at least half our size, else home', fn: (s, c) => moveTo(c, nearest(c, s.swarms.filter(o => o.side === c.side && o !== c && o.n >= c.n / 2)) || s.planets[c.side]) },
  split: { doc: 'split in two; the new half heads for the second-nearest planet we do not own', fn: (s, c) => !!split(s, c, false) },
  hold: { doc: 'stop where it is', fn: (s, c) => moveTo(c, c) },
}
const moveTo = (c, t) => { if (!t || t.x === undefined) return false; c.tx = t.x; c.ty = t.y; return true }
const rule = (cond, then) => ({ if: cond, then, on: true })
export const DEFAULT_GAMBITS = [
  rule('bigger_enemy_near', 'retreat'), rule('planet_attacked', 'go'), rule('weaker_enemy_near', 'go'), rule('small', 'go'),
  rule('big', 'split'), rule('free_planet', 'go'), rule('enemy_planet', 'go'),
]
export const HOUSE_GAMBITS = [ // greedy blob: never retreats, never splits
  rule('weaker_enemy_near', 'go'), rule('free_planet', 'go'), rule('small', 'go'), rule('enemy_planet', 'go'), rule('always', 'hold'),
]

function checkGambits(list) {
  if (!Array.isArray(list) || !list.length || list.length > MAX_GAMBITS) return `send 1 to ${MAX_GAMBITS} gambits`
  for (const r of list) {
    if (!CONDITIONS[r?.if]) return `unknown condition "${r?.if}". Known: ${Object.keys(CONDITIONS).join(', ')}`
    if (!ACTIONS[r.then]) return `unknown action "${r.then}". Known: ${Object.keys(ACTIONS).join(', ')}`
    if (r.p !== undefined && !(Number.isFinite(r.p) && r.p > 0 && r.p <= 100000)) return 'p must be a number in (0, 100000]'
  }
  return null
}

// ---------- fog ----------
let VIS = null // computed once per thinking tick, so gambits don't recompute vision per swarm
export function seen(s, side) { // enemy swarms this side can see right now
  if (VIS) return VIS[side]
  const eyes = [...s.swarms.filter(o => o.side === side).map(o => ({ x: o.x, y: o.y, r: SWARM_VISION + rad(o.n) })),
    ...s.planets.filter(p => p.owner === side).map(p => ({ x: p.x, y: p.y, r: p.r + PLANET_VISION }))]
  return s.swarms.filter(o => o.side !== side && eyes.some(e => dist(e, o) < e.r + rad(o.n)))
}

// ---------- match ----------
function rng(seed) { // mulberry32
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

export function createMatch(seed) {
  const r = rng(seed), planets = [{ x: 90, y: H / 2, r: 26, owner: 0, cap: 1 }, { x: W - 90, y: H / 2, r: 26, owner: 1, cap: -1 }]
  for (let tries = 0; planets.length < 28 && tries < 5000; tries++) { // mirror-symmetric so neither side gets a better map
    const x = 180 + r() * (W / 2 - 210), y = 40 + r() * (H - 80), pr = Math.round(6 + r() * 16)
    if (planets.some(p => Math.hypot(p.x - x, p.y - y) < p.r + pr + 50)) continue
    for (const mx of [x, W - x]) planets.push({ x: mx, y, r: pr, owner: -1, cap: 0 })
  }
  planets.forEach((p, i) => { p.id = i; p.mass = p.m0 = p.r === 26 ? 15000 : p.r * p.r * 25; p.stock = 0 })
  const s = { seed, tick: 0, nextId: 1, planets, swarms: [], gambits: [DEFAULT_GAMBITS, DEFAULT_GAMBITS], ended: null }
  for (const side of [0, 1]) for (const dy of [-70, 0, 70]) addSwarm(s, side, planets[side].x + (side ? -45 : 45), H / 2 + dy, START_N)
  return s
}

export function addSwarm(s, side, x, y, n) {
  if (s.swarms.filter(o => o.side === side).length >= MAX_SWARMS) return null
  const c = { id: s.nextId++, side, x, y, n, tx: x, ty: y, manual: false, rule: -1, noMerge: 0, eng: false }
  s.swarms.push(c)
  return c
}

function split(s, c, manual) {
  if (c.n < 200) return null
  const b = addSwarm(s, c.side, c.x + 4, c.y + 4, c.n / 2)
  if (!b) return null
  c.n /= 2
  b.manual = c.manual = manual; c.noMerge = b.noMerge = s.tick + 80
  const t = s.planets.filter(p => p.mass > 0 && p.owner !== c.side).sort((p, o) => dist(c, p) - dist(c, o) || p.id - o.id)
  moveTo(b, t[1] || { x: c.x, y: Math.min(H - 10, c.y + 80) })
  return b
}

function think(s, c) {
  const list = s.gambits[c.side]
  for (let i = 0; i < list.length; i++) {
    const r = list[i]
    if (!r.on) continue
    const it = CONDITIONS[r.if].fn(s, c, r.p ?? CONDITIONS[r.if].p)
    if (it && ACTIONS[r.then].fn(s, c, it) !== false) { c.rule = i; return }
  }
  c.rule = -1
}

// One input from one side, applied before the next tick. Returns { ok } or { ok: false, error }.
// gambits / toggle: the side's rule list. order / split / release: hand control of one swarm.
export function applyInput(s, side, input) {
  if (s.ended) return { ok: false, error: 'match ended' }
  const own = id => s.swarms.find(o => o.id === id && o.side === side)
  if (input.gambits !== undefined) {
    const err = checkGambits(input.gambits); if (err) return { ok: false, error: err }
    s.gambits[side] = input.gambits.map(r => ({ if: r.if, ...(r.p !== undefined && { p: r.p }), then: r.then, on: r.on !== false }))
  }
  if (input.toggle !== undefined) {
    if (!s.gambits[side][input.toggle]) return { ok: false, error: 'no such gambit' }
    s.gambits[side] = s.gambits[side].map((o, i) => i === input.toggle ? { ...o, on: !o.on } : o)
  }
  if (input.order) {
    const c = own(input.order.swarm), { x, y } = input.order
    if (!c) return { ok: false, error: `no swarm ${input.order.swarm} of yours (it may have merged or died)` }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: 'x and y required' }
    c.manual = true; moveTo(c, { x: Math.max(0, Math.min(W, x)), y: Math.max(0, Math.min(H, y)) })
  }
  if (input.split !== undefined) {
    const c = own(input.split); if (!c) return { ok: false, error: `no swarm ${input.split} of yours` }
    if (!split(s, c, c.manual)) return { ok: false, error: 'cannot split (under 200 particles, or 40 swarms already)' }
  }
  if (input.release !== undefined) {
    const c = own(input.release); if (!c) return { ok: false, error: `no swarm ${input.release} of yours` }
    c.manual = false
  }
  return { ok: true }
}

export function step(s) {
  if (s.ended) return
  s.tick++
  if (s.tick % THINK === 0) {
    VIS = [seen(s, 0), seen(s, 1)]
    for (const c of [...s.swarms]) if (!c.manual) think(s, c)
    VIS = null
  }
  for (const c of s.swarms) {
    const d = dist(c, { x: c.tx, y: c.ty }), v = Math.min(d, speed(c.n) * (c.eng ? 0.25 : 1))
    if (d > 1) { c.x += (c.tx - c.x) / d * v; c.y += (c.ty - c.y) / d * v }
  }
  const loss = new Map()
  for (const c of s.swarms) c.eng = false
  for (let i = 0; i < s.swarms.length; i++) for (let j = i + 1; j < s.swarms.length; j++) {
    const a = s.swarms[i], b = s.swarms[j]
    if (a.side !== b.side && dist(a, b) < rad(a.n) + rad(b.n)) {
      loss.set(a, (loss.get(a) || 0) + K * b.n); loss.set(b, (loss.get(b) || 0) + K * a.n); a.eng = b.eng = true
    }
  }
  for (const [c, l] of loss) c.n -= l
  for (let i = 0; i < s.swarms.length; i++) for (let j = i + 1; j < s.swarms.length; j++) { // overlapping friends merge
    const a = s.swarms[i], b = s.swarms[j]
    if (a.side === b.side && a.n > 0 && b.n > 0 && a.noMerge < s.tick && b.noMerge < s.tick && dist(a, b) < 0.5 * (rad(a.n) + rad(b.n))) {
      a.x = (a.x * a.n + b.x * b.n) / (a.n + b.n); a.y = (a.y * a.n + b.y * b.n) / (a.n + b.n); a.n += b.n; b.n = 0
      a.manual = a.manual || b.manual
    }
  }
  s.swarms = s.swarms.filter(c => c.n >= 1)
  for (const p of s.planets) {
    if (p.mass <= 0) continue
    const pres = [0, 0]
    for (const c of s.swarms) if (dist(c, p) < p.r + rad(c.n)) pres[c.side] += c.n
    const rate = n => Math.sqrt(n) / (p.r * 300)
    if (pres[0] && !pres[1]) p.cap = Math.min(1, p.cap + rate(pres[0]))
    if (pres[1] && !pres[0]) p.cap = Math.max(-1, p.cap - rate(pres[1]))
    if (p.cap >= 1) p.owner = 0; else if (p.cap <= -1) p.owner = 1
    else if ((p.owner === 0 && p.cap <= 0) || (p.owner === 1 && p.cap >= 0)) p.owner = -1
    if (p.owner < 0) continue
    const made = Math.min(p.mass, p.r * 0.12); p.mass -= made; p.stock += made // owned planets are eaten into particles
    if (p.stock >= 60 || p.mass <= 0) {
      const near = s.swarms.find(c => c.side === p.owner && dist(c, p) < p.r + rad(c.n) + 10)
      const to = near || addSwarm(s, p.owner, p.x, p.y, 0) || nearest(p, s.swarms.filter(c => c.side === p.owner))
      if (to) to.n += p.stock
      p.stock = 0
    }
  }
  const alive = side => s.swarms.some(c => c.side === side) || s.planets.some(p => p.owner === side && p.mass > 0)
  const [a, b] = totals(s)
  if (!alive(0) || !alive(1)) s.ended = { winner: alive(0) ? 0 : alive(1) ? 1 : null, reason: 'wipe' }
  else if (s.tick >= MATCH_TICKS) s.ended = { winner: a > b ? 0 : b > a ? 1 : null, reason: 'time' }
}

export const totals = s => [0, 1].map(side => Math.round(s.swarms.reduce((a, c) => a + (c.side === side ? c.n : 0), 0)))

// What one side may know: its swarms, visible enemy swarms, public planets and particle totals.
export function view(s, side) {
  const r = n => Math.round(n), t = totals(s)
  return {
    tick: s.tick, secondsLeft: Math.max(0, Math.ceil((MATCH_TICKS - s.tick) / TPS)),
    ended: s.ended && { reason: s.ended.reason, result: s.ended.winner === side ? 'won' : s.ended.winner === null ? 'draw' : 'lost' },
    totals: { you: t[side], enemy: t[1 - side] },
    swarms: s.swarms.filter(c => c.side === side).map(c => ({ id: c.id, x: r(c.x), y: r(c.y), n: r(c.n), tx: r(c.tx), ty: r(c.ty), manual: c.manual, rule: c.rule, fighting: c.eng })),
    enemies: seen(s, side).map(c => ({ id: c.id, x: r(c.x), y: r(c.y), n: r(c.n), fighting: c.eng })),
    planets: s.planets.map(p => ({ id: p.id, x: r(p.x), y: r(p.y), r: p.r, owner: p.owner < 0 ? null : p.owner === side ? 'you' : 'enemy', massLeft: r(p.mass), mass: p.m0, capture: Math.round((side ? -p.cap : p.cap) * 100) / 100 })),
    gambits: s.gambits[side],
  }
}

export const rules = () => ({
  conditions: Object.fromEntries(Object.entries(CONDITIONS).map(([k, c]) => [k, `${c.doc}${c.p ? ` (default p ${c.p})` : ''}`])),
  actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, a.doc])),
})
