// Botters simulation: space swarms conquer and eat planets. Pure and deterministic: state = f(seed, inputs by tick).
// A swarm is a cohort (centre + particle count); individual particles only exist in the browser.
// A match has 2 to 6 sides grouped in teams (1v1, 2v2, free-for-all). Every swarm follows its side's gambits
// (IF condition → action) unless a human grabbed it.
//
// Combat: only the contact front fights (width = the smaller swarm's diameter); a swarm much bigger than its enemy wraps it and
// bites from all sides. Half of what a swarm kills joins it, but is digested slowly (belly), which also slows it.
// Swarms that touch no planet and kill nothing for a while starve; overlapping friendly swarms merge.

export const W = 1200, H = 700, TPS = 20
export const MAX_SWARMS = 40, MAX_GAMBITS = 10
export const T = { C: 0.2, E: 3, G: 0.5, DIG: 0.004, SLOW: 2, GRACE: 400, STARVE: 0.0008 }
export const MODES = { '1v1': [0, 1], '2v2': [0, 0, 1, 1], ffa4: [0, 1, 2, 3], ffa6: [0, 1, 2, 3, 4, 5] } // team of each side
const THINK = 10 // gambits are re-evaluated every 0.5 s
const SWARM_VISION = 150, PLANET_VISION = 80, START_N = 3000
const HOMES = { // one home planet per side; every layout is mirror-symmetric on both axes, so no side gets a better map
  2: [[90, 350], [1110, 350]],
  4: [[130, 170], [130, 530], [1070, 170], [1070, 530]], // 2v2: sides 0,1 left, 2,3 right
  6: [[100, 350], [350, 116], [850, 116], [1100, 350], [850, 584], [350, 584]],
}

export const rad = n => 4 + Math.sqrt(n) * 0.32
const speed = c => (1.5 - Math.min(1, c.n / 15000) * 0.9) 
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const nearest = (c, list, max = Infinity) => { let b = null, bd = max; for (const o of list) { const d = dist(c, o); if (d < bd) { bd = d; b = o } } return b }
const friendly = (s, a, b) => s.teams[a] === s.teams[b] // sides on the same team
const hunger = (s, c) => Math.min(1, (s.tick - c.meal) / T.GRACE) // 0 just ate, 1 starving

// ---------- gambits ----------
// A condition returns what it found (an enemy, a planet, a friend) or nothing. `p` tunes it.
export const CONDITIONS = {
  bigger_enemy_near: { p: 1.2, doc: 'a visible enemy swarm at least p× our size within 170 → that enemy', fn: (s, c, p) => nearest(c, seen(s, c.side).filter(o => o.n >= c.n * p), 170) },
  weaker_enemy_near: { p: 0.9, doc: 'a visible enemy swarm at most p× our size within 230 → that enemy', fn: (s, c, p) => nearest(c, seen(s, c.side).filter(o => o.n <= c.n * p), 230) },
  enemy_near: { p: 200, doc: 'any visible enemy swarm within p → that enemy', fn: (s, c, p) => nearest(c, seen(s, c.side), p) },
  planet_attacked: { p: 500, doc: 'one of our planets within p has a visible enemy next to it → that planet', fn: (s, c, p) => nearest(c, s.planets.filter(o => o.owner === c.side && o.mass > 0 && nearest(o, seen(s, c.side), o.r + 70)), p) },
  small: { p: 400, doc: 'this swarm has fewer than p particles → the nearest friendly swarm', fn: (s, c, p) => c.n < p && nearest(c, s.swarms.filter(o => o.side === c.side && o !== c)) },
  big: { p: 4000, doc: 'this swarm has more than p particles → itself', fn: (s, c, p) => c.n > p && c },
  hungry: { p: 0.6, doc: 'this swarm has gone p (0 to 1) of its starvation time without touching a planet or killing → the nearest planet with mass left', fn: (s, c, p) => hunger(s, c) >= p && nearest(c, s.planets.filter(o => o.mass > 0)) },
  full: { p: 0.1, doc: 'this swarm is still digesting more than p× its size in eaten particles → itself (digesting swarms are slow: hold or retreat)', fn: (s, c, p) => (c.belly || 0) > c.n * p && c },
  free_planet: { p: 2000, doc: 'an unowned planet with mass left within p → that planet', fn: (s, c, p) => nearest(c, s.planets.filter(o => o.owner === -1 && o.mass > 0), p) },
  enemy_planet: { p: 2000, doc: 'an enemy planet with mass left within p → that planet', fn: (s, c, p) => nearest(c, s.planets.filter(o => o.owner >= 0 && !friendly(s, o.owner, c.side) && o.mass > 0), p) },
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
  rule('bigger_enemy_near', 'retreat'), rule('planet_attacked', 'go'), rule('hungry', 'go'), rule('weaker_enemy_near', 'go'), rule('small', 'go'),
  rule('big', 'split'), rule('free_planet', 'go'), rule('enemy_planet', 'go'),
]
export const HOUSE = { // fixed opponents. Measured vs DEFAULT_GAMBITS over 24 seeds (3 min, 28 planets): the default wins 20 vs easy, 14 vs normal, 7 vs hard
  easy: [rule('free_planet', 'go'), rule('small', 'go'), rule('always', 'hold')], // never fights on purpose
  normal: [rule('planet_attacked', 'go'), rule('weaker_enemy_near', 'go'), rule('hungry', 'go'), rule('free_planet', 'go'), rule('small', 'go'), rule('enemy_planet', 'go'), rule('always', 'hold')], // defends its planets, then a greedy blob: never retreats, never splits
  hard: [rule('bigger_enemy_near', 'retreat'), rule('weaker_enemy_near', 'go'), rule('planet_attacked', 'go'), rule('hungry', 'go'), rule('small', 'go'), rule('free_planet', 'go'), rule('enemy_planet', 'go'), rule('always', 'hold')],
}
export const OPTIONS = { minutes: [3, 5, 8], planets: [16, 28, 40], mode: Object.keys(MODES) } // allowed match settings; the first mode is the default
const DEFAULT_OPTS = { minutes: 5, planets: 28, mode: '1v1' }
export const matchOptions = o => ({ minutes: OPTIONS.minutes.includes(o?.minutes) ? o.minutes : DEFAULT_OPTS.minutes, planets: OPTIONS.planets.includes(o?.planets) ? o.planets : DEFAULT_OPTS.planets, mode: Object.hasOwn(MODES, o?.mode) ? o.mode : DEFAULT_OPTS.mode })

export function checkGambits(list) {
  if (!Array.isArray(list) || !list.length || list.length > MAX_GAMBITS) return `send 1 to ${MAX_GAMBITS} gambits`
  for (const r of list) {
    if (typeof r?.if !== 'string' || !Object.hasOwn(CONDITIONS, r.if)) return `unknown condition "${r?.if}". Known: ${Object.keys(CONDITIONS).join(', ')}`
    if (typeof r.then !== 'string' || !Object.hasOwn(ACTIONS, r.then)) return `unknown action "${r.then}". Known: ${Object.keys(ACTIONS).join(', ')}`
    if (r.p !== undefined && !(Number.isFinite(r.p) && r.p > 0 && r.p <= 100000)) return 'p must be a number in (0, 100000]'
  }
  return null
}

// ---------- fog ----------
let VIS = null // computed once per thinking tick, so gambits don't recompute vision per swarm
export function seen(s, side) { // enemy swarms this side's team can see right now (teammates share vision)
  if (VIS) return VIS[side]
  const mine = i => friendly(s, i, side)
  const eyes = [...s.swarms.filter(o => mine(o.side)).map(o => ({ x: o.x, y: o.y, r: SWARM_VISION + rad(o.n) })),
    ...s.planets.filter(p => p.owner >= 0 && mine(p.owner)).map(p => ({ x: p.x, y: p.y, r: p.r + PLANET_VISION }))]
  return s.swarms.filter(o => !mine(o.side) && eyes.some(e => dist(e, o) < e.r + rad(o.n)))
}

// ---------- match ----------
function rng(seed) { // mulberry32
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

export function createMatch(seed, options) {
  const opts = matchOptions(options), r = rng(seed), teams = MODES[opts.mode], n = teams.length
  const planets = HOMES[n].map(([x, y], side) => ({ x, y, r: 26, owner: side, cap: 1 }))
  for (let tries = 0; planets.length < opts.planets && tries < 5000; tries++) { // six homes need a centreline pair before the mirrored quartets
    const pair = n > 2 && (opts.planets - planets.length) % 4 === 2
    const pr = Math.round(6 + r() * 16), x = 180 + r() * (W / 2 - 210), y = pair ? H / 2 : n === 2 ? 40 + r() * (H - 80) : 40 + r() * (H / 2 - 90 - pr)
    const copies = n === 2 || pair ? [[x, y], [W - x, y]] : [[x, y], [W - x, y], [x, H - y], [W - x, H - y]]
    if (planets.some(p => Math.hypot(p.x - x, p.y - y) < p.r + pr + 50)) continue
    for (const [cx, cy] of copies) planets.push({ x: cx, y: cy, r: pr, owner: -1, cap: 0 })
  }
  planets.forEach((p, i) => { p.id = i; p.mass = p.m0 = p.r === 26 ? 15000 : p.r * p.r * 25; p.stock = 0; p.prog = 0; p.claim = -1; p.by = -1 })
  const s = { seed, opts, teams, endTick: opts.minutes * 60 * TPS, tick: 0, nextId: 1, planets, swarms: [], gambits: teams.map(() => DEFAULT_GAMBITS), ended: null }
  for (let side = 0; side < n; side++) { // three swarms, fanned out in front of home towards the centre
    const h = planets[side], len = Math.hypot(W / 2 - h.x, H / 2 - h.y), ux = (W / 2 - h.x) / len, uy = (H / 2 - h.y) / len
    for (let i = 0; i < 3; i++) addSwarm(s, side, h.x + ux * 45 - uy * (i - 1) * 70, h.y + uy * 45 + ux * (i - 1) * 70, START_N)
  }
  return s
}

export function addSwarm(s, side, x, y, n) {
  if (s.swarms.filter(o => o.side === side).length >= MAX_SWARMS) return null
  const c = { id: s.nextId++, side, x, y, n, tx: x, ty: y, manual: false, rule: -1, noMerge: 0, eng: false, belly: 0, meal: s.tick }
  s.swarms.push(c)
  return c
}

function split(s, c, manual) {
  if (c.n < 200) return null
  const b = addSwarm(s, c.side, c.x + 4, c.y + 4, c.n / 2)
  if (!b) return null
  c.n /= 2; b.belly = c.belly /= 2; b.meal = c.meal
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
// gambits / toggle: the side's rule list. order / split / release: hand control of, or reshape, one swarm.
export function applyInput(s, side, input) {
  if (s.ended) return { ok: false, error: 'match ended' }
  if (input.surrender === true) { // ends the match for everyone; with several opponents the best-placed other team wins
    const totals = new Map()
    for (const c of s.swarms) if (!friendly(s, c.side, side)) totals.set(s.teams[c.side], (totals.get(s.teams[c.side]) || 0) + c.n)
    const best = [...totals].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
    s.ended = { winner: best ? best[0] : [...new Set(s.teams)].find(t => t !== s.teams[side]), reason: 'surrender' }
    return { ok: true }
  }
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

// Damage x deals to y in one tick: the contact front (L) decides, and a swarm much bigger than its enemy (wrap, 0 to 1) bites from all sides.
const hit = (y, L, wrap) => Math.min(y.n, T.C * L * (1 + T.E * wrap))

export function step(s) {
  if (s.ended) return
  s.tick++
  if (s.tick % THINK === 0) {
    VIS = s.teams.map((_, side) => seen(s, side))
    for (const c of [...s.swarms]) if (!c.manual) think(s, c)
    VIS = null
  }
  for (const c of s.swarms) {
    const d = dist(c, { x: c.tx, y: c.ty }), v = Math.min(d, speed(c) * (c.eng && !c.roll ? 0.25 : 1) / (1 + T.SLOW * c.belly / c.n))
    if (d > 1) { c.x += (c.tx - c.x) / d * v; c.y += (c.ty - c.y) / d * v }
  }
  const loss = new Map(), gain = new Map(), hits = []
  for (const c of s.swarms) { c.eng = false; c.roll = false }
  for (let i = 0; i < s.swarms.length; i++) for (let j = i + 1; j < s.swarms.length; j++) {
    const a = s.swarms[i], b = s.swarms[j]
    if (friendly(s, a.side, b.side)) continue
    const ra = rad(a.n), rb = rad(b.n), d = dist(a, b), contact = d < ra + rb
    if (!contact) continue
    // front law: only the contact front fights (width bounded by the smaller swarm); a much bigger swarm wraps the smaller one and bites from all sides
    const L = 2 * Math.min(ra, rb), ka = hit(b, L, Math.min(1, Math.max(0, ra / rb - 1))), kb = hit(a, L, Math.min(1, Math.max(0, rb / ra - 1)))
    loss.set(b, (loss.get(b) || 0) + ka); loss.set(a, (loss.get(a) || 0) + kb)
    if (ka > 0) hits.push([a, b, ka])
    if (kb > 0) hits.push([b, a, kb])
    if (contact) { a.eng = b.eng = true; if (ka > kb) a.roll = true; if (kb > ka) b.roll = true }
  }
  // Share each target's actual losses proportionally among simultaneous attackers, before changing any population.
  for (const [attacker, target, damage] of hits) gain.set(attacker, (gain.get(attacker) || 0) + T.G * damage * Math.min(1, target.n / loss.get(target)))
  for (const [c, l] of loss) c.n = Math.max(0, c.n - l)
  for (const [c, g] of gain) if (c.n > 0 && g > 0) { c.belly += g; c.meal = s.tick } // kills feed, but the meal is digested slowly
  for (const c of s.swarms) if (c.n > 0 && c.belly > 0) { const d = Math.min(c.belly, c.n * T.DIG); c.belly -= d; c.n += d }
  for (let i = 0; i < s.swarms.length; i++) for (let j = i + 1; j < s.swarms.length; j++) { // overlapping friends merge
    const a = s.swarms[i], b = s.swarms[j]
    if (a.side === b.side && a.n > 0 && b.n > 0 && a.noMerge < s.tick && b.noMerge < s.tick && dist(a, b) < 0.5 * (rad(a.n) + rad(b.n))) {
      a.x = (a.x * a.n + b.x * b.n) / (a.n + b.n); a.y = (a.y * a.n + b.y * b.n) / (a.n + b.n)
      a.belly += b.belly; a.meal = Math.max(a.meal, b.meal); a.n += b.n; b.n = 0
      a.manual = a.manual || b.manual
    }
  }
  for (const c of s.swarms) if (s.tick - c.meal > T.GRACE) c.n *= 1 - T.STARVE // no planet or kill for too long: starving
  s.swarms = s.swarms.filter(c => c.n >= 1)
  for (const p of s.planets) {
    if (p.mass <= 0) continue
    const pres = s.teams.map(() => 0)
    for (const c of s.swarms) if (dist(c, p) < p.r + rad(c.n)) { pres[c.side] += c.n; c.meal = s.tick }
    const here = pres.map((n, side) => side).filter(side => pres[side] > 0)
    if (here.length && here.every(side => friendly(s, side, here[0]))) { // contested planets freeze; one team alone captures
      const q = here.reduce((a, side) => pres[side] > pres[a] ? side : a), rate = Math.sqrt(pres[q]) / (p.r * 300)
      p.by = q
      if (p.owner >= 0 && friendly(s, p.owner, q)) p.cap = Math.min(1, p.cap + rate)
      else if (p.owner >= 0) { p.cap -= rate; if (p.cap <= 0) { p.owner = -1; p.cap = 0; p.prog = 0 } }
      else {
        if (p.claim !== q) { p.claim = q; p.prog = 0 }
        p.prog += rate
        if (p.prog >= 1) { p.owner = q; p.cap = 1; p.prog = 0 }
      }
    }
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
  const left = [...new Set(s.teams.filter((team, side) => alive(side)))]
  if (left.length <= 1) s.ended = { winner: left.length ? left[0] : null, reason: 'wipe' }
  else if (s.tick >= s.endTick) {
    const t = teamTotals(s), best = Math.max(...t)
    s.ended = { winner: t.filter(n => n === best).length > 1 ? null : t.indexOf(best), reason: 'time' }
  }
}

// Rebuild a match from its seed and input log ({ tick, side, input }, in arrival order). Drop entries to ask "what if".
export function replay(seed, log, opts) {
  const s = createMatch(seed, opts)
  let i = 0
  while (!s.ended) {
    for (; i < log.length && log[i].tick === s.tick; i++) applyInput(s, log[i].side, log[i].input)
    step(s)
  }
  return s
}

export const totals = s => s.teams.map((_, side) => Math.round(s.swarms.reduce((a, c) => a + (c.side === side ? c.n : 0), 0))) // per side
const teamTotals = s => { const t = []; for (const c of s.swarms) t[s.teams[c.side]] = (t[s.teams[c.side]] || 0) + c.n; return [...Array(Math.max(...s.teams) + 1)].map((_, i) => t[i] || 0) } // per team, indexed by team id

// What one side may know: its swarms, its allies, visible enemy swarms, public planets and particle totals.
// `k` numbers the enemy teams from this side's point of view (0, 1, ...), so a client can give each its own colour.
export function view(s, side) {
  const r = Math.round, team = s.teams[side], tt = teamTotals(s)
  const foeTeams = [...new Set(s.teams)].filter(x => x !== team), k = i => Math.max(0, foeTeams.indexOf(s.teams[i]))
  const who = i => i === side ? 'you' : friendly(s, i, side) ? 'ally' : 'enemy'
  return {
    tick: s.tick, secondsLeft: Math.max(0, Math.ceil((s.endTick - s.tick) / TPS)), mode: s.opts.mode,
    ended: s.ended && { reason: s.ended.reason, result: s.ended.winner === team ? 'won' : s.ended.winner === null ? 'draw' : 'lost' },
    totals: { you: r(tt[team]), enemy: r(Math.max(0, ...foeTeams.map(x => tt[x]))), foes: foeTeams.map((x, i) => ({ k: i, n: r(tt[x]) })) },
    swarms: s.swarms.filter(c => c.side === side).map(c => ({ id: c.id, x: r(c.x), y: r(c.y), n: r(c.n), tx: r(c.tx), ty: r(c.ty), manual: c.manual, rule: c.rule, fighting: c.eng,
      belly: r(c.belly), hunger: Math.round(hunger(s, c) * 100) / 100 })),
    allies: s.swarms.filter(c => c.side !== side && friendly(s, c.side, side)).map(c => ({ id: c.id, x: r(c.x), y: r(c.y), n: r(c.n), fighting: c.eng })),
    enemies: seen(s, side).map(c => ({ id: c.id, k: k(c.side), x: r(c.x), y: r(c.y), n: r(c.n), fighting: c.eng })),
    planets: s.planets.map(p => ({ id: p.id, x: r(p.x), y: r(p.y), r: p.r, owner: p.owner < 0 ? null : who(p.owner), k: p.owner >= 0 ? k(p.owner) : p.prog > 0 ? k(p.claim) : 0, massLeft: r(p.mass), mass: p.m0,
      capture: Math.round((p.owner >= 0 ? (friendly(s, p.owner, side) ? p.cap : -p.cap) : p.prog > 0 ? (friendly(s, p.claim, side) ? p.prog : -p.prog) : 0) * 100) / 100, ck: k(Math.max(0, p.by)) })),
    gambits: s.gambits[side],
  }
}

export const rules = () => ({
  conditions: Object.fromEntries(Object.entries(CONDITIONS).map(([k, c]) => [k, { doc: c.doc, p: c.p }])),
  actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, { doc: a.doc }])),
  modes: Object.keys(MODES),
})
export const describe = r => `${r.on === false ? '(off) ' : ''}IF ${r.if}${r.p !== undefined ? `(${r.p})` : ''} → ${r.then}`
