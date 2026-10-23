// Botters simulation: space swarms conquer and eat planets. Pure and deterministic: state = f(seed, inputs by tick).
// A swarm is a cohort (centre + particle count) with a type; individual particles only exist in the browser.
// A match has 2 to 6 sides grouped in teams (1v1, 2v2, free-for-all). Every swarm follows its side's gambits
// (IF condition → action) unless a human grabbed it.
//
// Combat: only the contact front fights (width = the smaller swarm's diameter); a swarm much bigger than its enemy wraps it and
// bites from all sides. Half of what a swarm kills joins it, but is digested slowly (belly), which also slows it.
// Swarms that touch no planet and kill nothing for a while starve. Types: locust beats spore, spore beats carapace, carapace beats locust.
//
// Swarms never merge. They travel in groups, StarCraft-style: a group is any set of your swarms (one type or mixed) that share
// a target and keep formation (locusts on the flanks). Gambits and orders act on groups. Planets
// make particles of a chosen type (or, by default, the type the side has least of) and feed the nearest group.

export const W = 1200, H = 700, TPS = 20
const SUPPLY = 300 // how far from a planet its particles reach a swarm
export const MAX_SWARMS = 40, MAX_GAMBITS = 12
export const T = { C: 0.2, E: 3, G: 0.5, DIG: 0.004, SLOW: 2, GRACE: 400, STARVE: 0.0008, EDGE: 1.6, WEAK: 0.6, MELEE: 0.5, RANGE: 45, COCOON: 60, MORPH_CD: 300 }
export const MODES = { '1v1': [0, 1], '2v2': [0, 0, 1, 1], ffa4: [0, 1, 2, 3], ffa6: [0, 1, 2, 3, 4, 5] } // team of each side
export const TYPES = ['locust', 'carapace', 'spore']
const BEATS = { locust: 'spore', spore: 'carapace', carapace: 'locust' }
const TRAIT = { locust: { speed: 1.5, eat: 1.5, grace: 0.75 }, carapace: { speed: 0.7, eat: 1, grace: 3 }, spore: { speed: 1, eat: 1, grace: 1 } }
const TYPE_DOC = {
  locust: 'fast, captures planets 1.5× faster, starves in three quarters of the time; beats spore',
  carapace: 'slow, starves three times later; beats locust',
  spore: 'hits from 45 beyond contact without being hit back (only a spore can), weak in melee; beats carapace',
}
const THINK = 10 // gambits are re-evaluated every 0.5 s
const SWARM_VISION = 150, PLANET_VISION = 80, START_N = 3000
T.MORPH_COST = 0.1 // a swarm that changes type loses 10% of its particles
const HOMES = { // one home planet per side; every layout is mirror-symmetric on both axes, so no side gets a better map
  2: [[90, 350], [1110, 350]],
  4: [[130, 170], [130, 530], [1070, 170], [1070, 530]], // 2v2: sides 0,1 left, 2,3 right
  6: [[100, 350], [350, 116], [850, 116], [1100, 350], [850, 584], [350, 584]],
}
const BEATER = Object.fromEntries(Object.entries(BEATS).map(([a, b]) => [b, a]))

export const rad = n => 4 + Math.sqrt(n) * 0.32
const speed = c => (1.5 - Math.min(1, c.n / 15000) * 0.9) * TRAIT[c.type].speed
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const members = (s, g) => s.swarms.filter(o => o.g === g)
function groupOf(s, g) { // a group seen by gambits as one swarm: total size, centre of mass, biggest type
  const m = members(s, g); if (!m.length) return null
  const n = m.reduce((a, o) => a + o.n, 0), lead = m.reduce((a, o) => o.n > a.n ? o : a)
  return { id: g, side: lead.side, members: m, n, type: lead.type, x: m.reduce((a, o) => a + o.x * o.n, 0) / n, y: m.reduce((a, o) => a + o.y * o.n, 0) / n,
    tx: lead.tx, ty: lead.ty, belly: m.reduce((a, o) => a + o.belly, 0) }
}
let GR = [] // every group of the match, refreshed before each group thinks
const foes = (s, side) => { // what a side sees of the enemy, as groups: swarms that march together count as one force
  const by = new Map()
  for (const o of seen(s, side)) (by.get(o.g) ?? by.set(o.g, []).get(o.g)).push(o)
  return [...by].map(([g, m]) => { const n = m.reduce((a, o) => a + o.n, 0), lead = m.reduce((a, o) => o.n > a.n ? o : a)
    return { id: g, side: lead.side, type: lead.type, n, x: m.reduce((a, o) => a + o.x * o.n, 0) / n, y: m.reduce((a, o) => a + o.y * o.n, 0) / n, belly: 0, members: m } })
}
const weakestType = (s, side) => TYPES.reduce((a, t) => tot(s, side, t) < tot(s, side, a) ? t : a)
const tot = (s, side, type) => s.swarms.reduce((a, o) => a + (o.side === side && o.type === type ? o.n : 0), 0)
const nearest = (c, list, max = Infinity) => { let b = null, bd = max; for (const o of list) { const d = dist(c, o); if (d < bd) { bd = d; b = o } } return b }
const friendly = (s, a, b) => s.teams[a] === s.teams[b] // sides on the same team
const hunger = (s, c) => c.members ? Math.max(...c.members.map(m => hunger(s, m))) : Math.min(1, (s.tick - c.meal) / (T.GRACE * TRAIT[c.type].grace)) // 0 just ate, 1 starving (a group: its hungriest swarm)

// ---------- gambits ----------
// A condition returns what it found (an enemy, a planet, a friend) or nothing. `p` tunes it.
export const CONDITIONS = {
  bigger_enemy_near: { p: 1.2, doc: 'a visible enemy group (swarms travelling together) at least p× the size of our group within 170 → that enemy', fn: (s, c, p) => nearest(c, foes(s, c.side).filter(o => o.n >= c.n * p), 170) },
  weaker_enemy_near: { p: 0.9, doc: 'a visible enemy group at most p× the size of our group within 230 → that enemy', fn: (s, c, p) => nearest(c, foes(s, c.side).filter(o => o.n <= c.n * p), 230) },
  enemy_near: { p: 200, doc: 'any visible enemy swarm within p → that enemy', fn: (s, c, p) => nearest(c, seen(s, c.side), p) },
  counter_near: { p: 170, doc: 'a visible enemy swarm within p whose type beats one of our swarms → that enemy (pair with the counter action)', fn: (s, c, p) => nearest(c, seen(s, c.side).filter(o => c.members.some(m => BEATS[o.type] === m.type)), p) },
  prey_near: { p: 230, doc: 'a visible enemy swarm within p whose type one of our swarms beats → that enemy', fn: (s, c, p) => nearest(c, seen(s, c.side).filter(o => c.members.some(m => BEATS[m.type] === o.type)), p) },
  enemy_locusts: { p: 400, doc: 'most visible enemy particles within p are locusts → the nearest enemy locust swarm', fn: (s, c, p) => mostly(s, c, p, 'locust') },
  enemy_carapaces: { p: 400, doc: 'most visible enemy particles within p are carapaces → the nearest enemy carapace swarm', fn: (s, c, p) => mostly(s, c, p, 'carapace') },
  enemy_spores: { p: 400, doc: 'most visible enemy particles within p are spores → the nearest enemy spore swarm', fn: (s, c, p) => mostly(s, c, p, 'spore') },
  planet_attacked: { p: 500, doc: 'one of our planets within p has a visible enemy next to it → that planet', fn: (s, c, p) => nearest(c, s.planets.filter(o => o.owner === c.side && o.mass > 0 && nearest(o, seen(s, c.side), o.r + 70)), p) },
  small: { p: 400, doc: 'this group has fewer than p particles in all → the nearest other group of ours', fn: (s, c, p) => c.n < p && nearest(c, GR.filter(o => o.side === c.side && o !== c)) },
  big: { p: 4000, doc: 'one swarm of this group has more than p particles → the group itself (pair with split)', fn: (s, c, p) => c.members.some(m => m.n > p) && c },
  hungry: { p: 0.6, doc: 'a swarm of this group has gone p (0 to 1) of its starvation time without touching a planet or killing → the nearest planet with mass left', fn: (s, c, p) => hunger(s, c) >= p && nearest(c, s.planets.filter(o => o.mass > 0)) },
  full: { p: 0.1, doc: 'this group is still digesting more than p× its size in eaten particles → itself (digesting swarms are slow: hold or retreat)', fn: (s, c, p) => (c.belly || 0) > c.n * p && c },
  free_planet: { p: 2000, doc: 'an unowned planet with mass left within p → that planet', fn: (s, c, p) => nearest(c, s.planets.filter(o => o.owner === -1 && o.mass > 0), p) },
  enemy_planet: { p: 2000, doc: 'an enemy planet with mass left within p → that planet', fn: (s, c, p) => nearest(c, s.planets.filter(o => o.owner >= 0 && !friendly(s, o.owner, c.side) && o.mass > 0), p) },
  always: { p: 0, doc: 'always true → nothing', fn: () => true },
}
const mostly = (s, c, p, type) => {
  const near = seen(s, c.side).filter(o => dist(c, o) < p), all = near.reduce((a, o) => a + o.n, 0), of = near.filter(o => o.type === type)
  return all > 0 && of.reduce((a, o) => a + o.n, 0) > all / 2 && nearest(c, of)
}
export const ACTIONS = {
  go: { doc: 'move the group to what the condition found: attack the enemy, capture or defend the planet', fn: (s, c, it) => moveTo(c, it) },
  retreat: { doc: 'move the group to the nearest other group of ours at least half its size, else home', fn: (s, c) => moveTo(c, nearest(c, GR.filter(o => o.side === c.side && o !== c && o.n >= c.n / 2)) || s.planets[c.side]) },
  join: { doc: 'move to the group the condition found (pair with small); on arrival the swarms join it. Swarms never merge: they stay separate and keep formation', fn: (s, c, it) => !!it?.members && it !== c && (dist(c, it) < rad(c.n) + rad(it.n) ? c.members.forEach(m => regroup(s, m, it.id)) || true : moveTo(c, it)) },
  split: { doc: 'halve the biggest swarm of the group; the new half becomes its own group and heads for the second-nearest planet we do not own', fn: (s, c) => { const m = c.members.reduce((a, o) => o.n > a.n ? o : a); return !!split(s, m, false) } },
  detach: { doc: 'a mixed group breaks into one group per type (does nothing, so the next rule runs, if the group is a single type)', fn: (s, c) => { const t = [...new Set(c.members.map(m => m.type))].filter(x => x !== c.type); for (const x of t) { const g = s.nextG++; for (const m of c.members) if (m.type === x) m.g = g } return t.length > 0 } },
  hold: { doc: 'every swarm of the group stops where it is', fn: (s, c) => { for (const m of c.members) { m.tx = m.x; m.ty = m.y } return true } },
  counter: { doc: `change each swarm the found enemy's type beats into the type that beats the enemy, then keep the next rule alive (10% of those particles lost, 3 s cocoon, 15 s cooldown). Does nothing, so the next rule runs, if no swarm can change`, fn: (s, c, it) => !!BEATER[it?.type] && c.members.filter(m => BEATS[it.type] === m.type).map(m => morph(s, m, BEATER[it.type])).some(Boolean) },
  produce_locust: { doc: 'all our planets now make locusts, then keep the next rule alive', fn: (s, c) => produce(s, c.side, 'locust') },
  produce_carapace: { doc: 'all our planets now make carapaces, then keep the next rule alive', fn: (s, c) => produce(s, c.side, 'carapace') },
  produce_spore: { doc: 'all our planets now make spores, then keep the next rule alive', fn: (s, c) => produce(s, c.side, 'spore') },
  produce_auto: { doc: 'all our planets make whichever type we have least of, then keep the next rule alive', fn: (s, c) => produce(s, c.side, null) },
}
const produce = (s, side, type) => { for (const p of s.planets) if (p.owner === side) p.make = type; return false } // false: the group still acts on the next rule
const moveTo = (c, t) => { // a group moves as one: every member gets the target, then takes its slot
  if (!t || t.x === undefined) return false
  c.tx = t.x; c.ty = t.y
  if (c.members) { for (const m of c.members) { m.tx = t.x; m.ty = t.y } arrange(c) }
  return true
}
function arrange(G) { // slots around the group's target: locusts spread to the flanks, other same-type swarms fan out sideways
  const dx = G.tx - G.x, dy = G.ty - G.y, d = Math.hypot(dx, dy), lead = G.members[0]
  const ux = d > 100 ? dx / d : lead.fx ?? 1, uy = d > 100 ? dy / d : lead.fy ?? 0, seen = {} // the heading only turns while far from the target, so a group at rest keeps its shape
  for (const m of G.members) {
    const k = seen[m.type] = (seen[m.type] ?? -1) + 1, side = k % 2 ? 1 : -1
    const across = G.members.length < 2 ? 0 : m.type === 'locust' ? side * (60 + 50 * (k >> 1)) : k ? side * 50 * ((k + 1) >> 1) : 0
    m.fx = ux; m.fy = uy; m.ox = 0 - uy * across; m.oy = 0 + ux * across // (0 - x, never -x: a negative zero would not survive the JSON snapshot)
  }
}
function regroup(s, m, g) { // move one swarm into another group (g undefined: out into its own)
  const sib = g === undefined ? null : s.swarms.find(o => o.g === g && o !== m)
  m.g = g === undefined ? s.nextG++ : g
  if (sib) { m.tx = sib.tx; m.ty = sib.ty; m.manual = sib.manual }
  const G = groupOf(s, m.g); if (G) arrange(G)
}
const rule = (cond, then, p) => ({ if: cond, then, ...(p !== undefined && { p }), on: true })
// The group's composition follows the enemy's: the planets make whatever beats what the enemy fields most (produce_* costs nothing and
// hands over to the next rule), and with no enemy in sight they make what we have least of.
const ADAPT = [rule('always', 'produce_auto'), rule('enemy_locusts', 'produce_carapace'), rule('enemy_carapaces', 'produce_spore'), rule('enemy_spores', 'produce_locust')]
export const DEFAULT_GAMBITS = [
  ...ADAPT, rule('bigger_enemy_near', 'retreat'), rule('planet_attacked', 'go'), rule('hungry', 'go'), rule('weaker_enemy_near', 'go'), rule('small', 'join'),
  rule('free_planet', 'go'), rule('enemy_planet', 'go'),
]
export const HOUSE = { // fixed opponents. Measured vs DEFAULT_GAMBITS over 24 seeds (3 min, 28 planets): the default wins about 13 of 24 vs easy and 11 to 12 vs normal and hard: the levels differ by less than the seed-to-seed noise, so they are styles of play, not a strict ladder
  easy: [rule('free_planet', 'go'), rule('small', 'join'), rule('always', 'hold')], // never fights on purpose
  normal: [...ADAPT, rule('planet_attacked', 'go'), rule('weaker_enemy_near', 'go'), rule('hungry', 'go'), rule('free_planet', 'go'), rule('small', 'join'), rule('enemy_planet', 'go'), rule('always', 'hold')], // adapts its production, defends its planets, otherwise a greedy blob
  hard: [rule('weaker_enemy_near', 'go'), rule('hungry', 'go'), rule('free_planet', 'go'), rule('small', 'join'), rule('enemy_planet', 'go'), rule('always', 'hold')], // greedy blob: attacks everything it can beat, never retreats, never adapts; measured the hardest for the default list to beat
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
  planets.forEach((p, i) => { p.id = i; p.make = null; p.mass = p.m0 = p.r === 26 ? 15000 : p.r * p.r * 25; p.stock = 0; p.prog = 0; p.claim = -1; p.by = -1 })
  const s = { seed, opts, teams, endTick: opts.minutes * 60 * TPS, tick: 0, nextId: 1, nextG: 1, planets, swarms: [], gambits: teams.map(() => DEFAULT_GAMBITS), ended: null }
  for (let side = 0; side < n; side++) { // one swarm of each type, fanned out in front of home towards the centre
    const h = planets[side], len = Math.hypot(W / 2 - h.x, H / 2 - h.y), ux = (W / 2 - h.x) / len, uy = (H / 2 - h.y) / len
    const g = s.nextG++ // the starting force: one mixed group
    TYPES.forEach((type, i) => addSwarm(s, side, h.x + ux * 45 - uy * (i - 1) * 70, h.y + uy * 45 + ux * (i - 1) * 70, START_N, type, g))
  }
  return s
}

export function addSwarm(s, side, x, y, n, type = 'locust', g) {
  if (s.swarms.filter(o => o.side === side).length >= MAX_SWARMS) return null
  const sib = g === undefined ? null : s.swarms.find(o => o.g === g)
  const c = { id: s.nextId++, g: g ?? s.nextG++, side, type, x, y, n, tx: sib ? sib.tx : x, ty: sib ? sib.ty : y, ox: 0, oy: 0, fx: 1, fy: 0, manual: !!sib?.manual, rule: -1, eng: false, belly: 0, meal: s.tick, cocoon: 0, morphAt: -1e9 }
  s.swarms.push(c)
  if (sib) arrange(groupOf(s, c.g))
  return c
}

function split(s, c, manual) {
  if (c.n < 200) return null
  const b = addSwarm(s, c.side, c.x + 4, c.y + 4, c.n / 2, c.type) // its own group
  if (!b) return null
  c.n /= 2; b.belly = c.belly /= 2; b.meal = c.meal
  b.morphAt = c.morphAt; b.cocoon = c.cocoon
  b.manual = c.manual = manual
  const t = s.planets.filter(p => p.mass > 0 && p.owner !== c.side).sort((p, o) => dist(c, p) - dist(c, o) || p.id - o.id)
  moveTo(b, t[1] || { x: c.x, y: Math.min(H - 10, c.y + 80) })
  return b
}

function morph(s, c, type) {
  if (!TYPES.includes(type) || c.type === type || s.tick < c.morphAt + T.MORPH_CD) return false
  c.type = type; c.n *= 1 - T.MORPH_COST; c.morphAt = s.tick; c.cocoon = s.tick + T.COCOON
  return true
}

function think(s, g) { // one group: its side's first matching gambit decides for all its swarms
  GR = [...new Set(s.swarms.map(o => o.g))].map(x => groupOf(s, x))
  const c = GR.find(o => o.id === g); if (!c || c.members.some(m => m.manual)) return
  const list = s.gambits[c.side]
  for (let i = 0; i < list.length; i++) {
    const r = list[i]
    if (!r.on) continue
    const it = CONDITIONS[r.if].fn(s, c, r.p ?? CONDITIONS[r.if].p)
    if (it && ACTIONS[r.then].fn(s, c, it) !== false) { for (const m of c.members) m.rule = i; return }
  }
  for (const m of c.members) m.rule = -1
}

// One input from one side, applied before the next tick. Returns { ok } or { ok: false, error }.
// gambits / toggle: the side's rule list. order / split / release / morph: hand control of, or reshape, a group (order / release act on the swarm's whole group) or one swarm.
// regroup: move a swarm into another group (or out into its own). produce: choose what a planet makes.
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
    if (!c) return { ok: false, error: `no swarm ${input.order.swarm} of yours (it may have died)` }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: 'x and y required' }
    const G = groupOf(s, c.g); for (const m of G.members) m.manual = true
    const px = Math.max(0, Math.min(W, x)), py = Math.max(0, Math.min(H, y))
    moveTo(G, nearest({ x: px, y: py }, s.planets.filter(q => q.mass > 0 && Math.hypot(q.x - px, q.y - py) < q.r + 30)) || { x: px, y: py })
  }
  if (input.split !== undefined) {
    const c = own(input.split); if (!c) return { ok: false, error: `no swarm ${input.split} of yours` }
    if (!split(s, c, c.manual)) return { ok: false, error: 'cannot split (under 200 particles, or 40 swarms already)' }
  }
  if (input.release !== undefined) {
    const c = own(input.release); if (!c) return { ok: false, error: `no swarm ${input.release} of yours` }
    for (const m of members(s, c.g)) m.manual = false
  }
  if (input.morph) {
    const c = own(input.morph.swarm); if (!c) return { ok: false, error: `no swarm ${input.morph.swarm} of yours` }
    if (!TYPES.includes(input.morph.type)) return { ok: false, error: `type must be one of ${TYPES.join(', ')}` }
    if (!morph(s, c, input.morph.type)) return { ok: false, error: 'cannot change type (already that type, or changed less than 15 s ago)' }
  }
  if (input.regroup) {
    const c = own(input.regroup.swarm); if (!c) return { ok: false, error: `no swarm ${input.regroup.swarm} of yours` }
    const w = input.regroup.with === undefined ? null : own(input.regroup.with)
    if (input.regroup.with !== undefined && !w) return { ok: false, error: `no swarm ${input.regroup.with} of yours to join` }
    if (w && w.g === c.g) return { ok: false, error: 'already in that group' }
    if (!w && members(s, c.g).length < 2) return { ok: false, error: 'already alone in its group' }
    regroup(s, c, w?.g)
  }
  if (input.produce) {
    const p = s.planets[input.produce.planet]
    if (!p || p.owner !== side) return { ok: false, error: `planet ${input.produce.planet} is not yours` }
    if (input.produce.type !== null && !TYPES.includes(input.produce.type)) return { ok: false, error: `type must be one of ${TYPES.join(', ')}, or null for auto` }
    p.make = input.produce.type
  }
  return { ok: true }
}

// Damage x deals to y in one tick. Melee needs contact; a spore also reaches T.RANGE past it (a spore in contact is weak).
function hit(x, y, contact, L, wrap) {
  if (!contact && x.type !== 'spore') return 0
  const edge = BEATS[x.type] === y.type ? T.EDGE : BEATS[y.type] === x.type ? T.WEAK : 1
  return Math.min(y.n, T.C * L * (1 + T.E * wrap) * edge * (contact && x.type === 'spore' ? T.MELEE : 1))
}

export function step(s) {
  if (s.ended) return
  s.tick++
  if (s.tick % THINK === 0) {
    VIS = s.teams.map((_, side) => seen(s, side))
    const ids = [...new Set(s.swarms.map(c => c.g))].sort((a, b) => a - b)
    for (const g of ids) think(s, g)
    for (const g of new Set(s.swarms.map(c => c.g))) arrange(groupOf(s, g)) // slots follow any regrouping
    VIS = null
  }
  const gv = new Map(), gc = new Map() // a group travels at its slowest swarm's pace, unless a swarm has fallen far behind the rest
  for (const c of s.swarms) { gv.set(c.g, Math.min(gv.get(c.g) ?? Infinity, speed(c))); const a = gc.get(c.g) ?? { x: 0, y: 0, n: 0 }; a.x += c.x * c.n; a.y += c.y * c.n; a.n += c.n; gc.set(c.g, a) }
  for (const c of s.swarms) {
    if (c.cocoon > s.tick) continue
    const k = Math.min(1, Math.max(0, (Math.hypot(c.tx - c.x, c.ty - c.y) - 60) / 220)) // the slot offset fades out inside 60 px of the target, so a group fights as one body
    const gx = c.tx + c.ox * k, gy = c.ty + c.oy * k, // each swarm heads for its own slot around the target (carapace beyond it, spore short of it, locust to the side); the slot closes onto the target itself on arrival
    d = Math.hypot(gx - c.x, gy - c.y), behind = Math.hypot(c.tx - c.x, c.ty - c.y) - Math.hypot(c.tx - gc.get(c.g).x / gc.get(c.g).n, c.ty - gc.get(c.g).y / gc.get(c.g).n) > 150, base = behind ? speed(c) : gv.get(c.g)
    const v = Math.min(d, base * (c.eng && !c.roll ? 0.25 : 1) / (1 + T.SLOW * c.belly / c.n))
    if (d > 1) { c.x += (gx - c.x) / d * v; c.y += (gy - c.y) / d * v }
  }
  const gn = new Map() // wrapping compares whole groups, so fighting side by side is not a disadvantage
  for (const c of s.swarms) gn.set(c.g, (gn.get(c.g) ?? 0) + c.n)
  const loss = new Map(), gain = new Map(), hits = []
  for (const c of s.swarms) { c.eng = false; c.roll = false; c.fire = null }
  for (let i = 0; i < s.swarms.length; i++) for (let j = i + 1; j < s.swarms.length; j++) {
    const a = s.swarms[i], b = s.swarms[j]
    if (friendly(s, a.side, b.side)) continue
    const ra = rad(a.n), rb = rad(b.n), d = dist(a, b), contact = d < ra + rb
    if (!contact && !((a.type === 'spore' || b.type === 'spore') && d < ra + rb + T.RANGE)) continue
    // front law: only the contact front fights (width bounded by the smaller swarm); a much bigger swarm wraps the smaller one and bites from all sides
    const L = 2 * Math.min(ra, rb), Ga = rad(gn.get(a.g)), Gb = rad(gn.get(b.g)), ka = hit(a, b, contact, L, Math.min(1, Math.max(0, Ga / Gb - 1))), kb = hit(b, a, contact, L, Math.min(1, Math.max(0, Gb / Ga - 1)))
    loss.set(b, (loss.get(b) || 0) + ka); loss.set(a, (loss.get(a) || 0) + kb)
    if (ka > 0) hits.push([a, b, ka])
    if (kb > 0) hits.push([b, a, kb])
    if (contact) { a.eng = b.eng = true; if (ka > kb) a.roll = true; if (kb > ka) b.roll = true }
    if (ka > 0 && !contact) a.fire = [b.x, b.y]
    if (kb > 0 && !contact) b.fire = [a.x, a.y]
  }
  // Share each target's actual losses proportionally among simultaneous attackers, before changing any population.
  for (const [attacker, target, damage] of hits) gain.set(attacker, (gain.get(attacker) || 0) + T.G * damage * Math.min(1, target.n / loss.get(target)))
  for (const [c, l] of loss) c.n = Math.max(0, c.n - l)
  for (const [c, g] of gain) if (c.n > 0 && g > 0) { c.belly += g; c.meal = s.tick } // kills feed, but the meal is digested slowly
  for (const c of s.swarms) if (c.n > 0 && c.belly > 0) { const d = Math.min(c.belly, c.n * T.DIG); c.belly -= d; c.n += d }
  const fed = new Map() // a group eats as one: while any swarm of it is on a planet or killing, none of them starve
  for (const c of s.swarms) fed.set(c.g, Math.max(fed.get(c.g) ?? -Infinity, c.meal))
  for (const c of s.swarms) c.meal = fed.get(c.g)
  for (const c of s.swarms) if (s.tick - c.meal > T.GRACE * TRAIT[c.type].grace) c.n *= 1 - T.STARVE // no planet or kill for too long: starving
  s.swarms = s.swarms.filter(c => c.n >= 1)
  for (const p of s.planets) {
    if (p.mass <= 0) continue
    const pres = s.teams.map(() => 0), eat = s.teams.map(() => 0)
    for (const c of s.swarms) if (dist(c, p) < p.r + rad(c.n)) { pres[c.side] += c.n; eat[c.side] += c.n * TRAIT[c.type].eat; c.meal = s.tick }
    const here = pres.map((n, side) => side).filter(side => pres[side] > 0)
    if (here.length && here.every(side => friendly(s, side, here[0]))) { // contested planets freeze; one team alone captures
      const q = here.reduce((a, side) => pres[side] > pres[a] ? side : a), rate = Math.sqrt(pres[q]) * (eat[q] / pres[q]) / (p.r * 300)
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
    const type = p.make ?? weakestType(s, p.owner), mine = s.swarms.filter(c => c.side === p.owner)
    const near = nearest(p, mine.filter(c => c.type === type), SUPPLY) // supply flows to our nearest swarm of the chosen type within reach
    if (near && p.stock >= 60) { near.n += p.stock; p.stock = 0 }
    else if (!near && (p.stock >= 600 || (p.mass <= 0 && p.stock > 0))) { // none in reach: save up for a real swarm, which joins the nearest group
      const to = addSwarm(s, p.owner, p.x, p.y, 0, type, nearest(p, mine, 450)?.g) || nearest(p, mine)
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
  const fire = c => c.fire ? { fire: [r(c.fire[0]), r(c.fire[1])] } : {}
  return {
    tick: s.tick, secondsLeft: Math.max(0, Math.ceil((s.endTick - s.tick) / TPS)), mode: s.opts.mode,
    ended: s.ended && { reason: s.ended.reason, result: s.ended.winner === team ? 'won' : s.ended.winner === null ? 'draw' : 'lost' },
    totals: { you: r(tt[team]), enemy: r(Math.max(0, ...foeTeams.map(x => tt[x]))), foes: foeTeams.map((x, i) => ({ k: i, n: r(tt[x]) })) },
    swarms: s.swarms.filter(c => c.side === side).map(c => ({ id: c.id, group: c.g, type: c.type, x: r(c.x), y: r(c.y), n: r(c.n), tx: r(c.tx), ty: r(c.ty), manual: c.manual, rule: c.rule, fighting: c.eng,
      belly: r(c.belly), hunger: Math.round(hunger(s, c) * 100) / 100, cocoon: c.cocoon > s.tick, ...fire(c) })),
    allies: s.swarms.filter(c => c.side !== side && friendly(s, c.side, side)).map(c => ({ id: c.id, type: c.type, x: r(c.x), y: r(c.y), n: r(c.n), fighting: c.eng, ...fire(c) })),
    enemies: seen(s, side).map(c => ({ id: c.id, type: c.type, k: k(c.side), x: r(c.x), y: r(c.y), n: r(c.n), fighting: c.eng, ...fire(c) })),
    planets: s.planets.map(p => ({ id: p.id, x: r(p.x), y: r(p.y), r: p.r, owner: p.owner < 0 ? null : who(p.owner), k: p.owner >= 0 ? k(p.owner) : p.prog > 0 ? k(p.claim) : 0, massLeft: r(p.mass), mass: p.m0, ...(p.owner === side && { make: p.make, producing: p.make ?? weakestType(s, side) }),
      capture: Math.round((p.owner >= 0 ? (friendly(s, p.owner, side) ? p.cap : -p.cap) : p.prog > 0 ? (friendly(s, p.claim, side) ? p.prog : -p.prog) : 0) * 100) / 100, ck: k(Math.max(0, p.by)) })),
    gambits: s.gambits[side],
  }
}

export const rules = () => ({
  conditions: Object.fromEntries(Object.entries(CONDITIONS).map(([k, c]) => [k, { doc: c.doc, p: c.p }])),
  actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, { doc: a.doc }])),
  types: TYPE_DOC, modes: Object.keys(MODES),
})
export const describe = r => `${r.on === false ? '(off) ' : ''}IF ${r.if}${r.p !== undefined ? `(${r.p})` : ''} → ${r.then}`
