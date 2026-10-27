import init, { initSync, initial_geometry, RustMatch } from './sim/pkg/botters_sim.js'
if (typeof process !== 'undefined' && process.versions?.node) {
  const { readFileSync } = await import('node:fs')
  initSync({ module: readFileSync(new URL('./sim/pkg/botters_sim_bg.wasm', import.meta.url)) })
} else await init()

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

export const rad = n => 4 + Math.sqrt(n) * 0.32

// ---------- gambits ----------
// A condition returns what it found (an enemy, a planet, a friend) or nothing. `p` tunes it.
export const CONDITIONS = {
  bigger_enemy_near: { p: 1.2, doc: 'a visible enemy swarm at least p× our size within 170 → that enemy' },
  weaker_enemy_near: { p: 0.9, doc: 'a visible enemy swarm at most p× our size within 230 → that enemy' },
  enemy_near: { p: 200, doc: 'any visible enemy swarm within p → that enemy' },
  planet_attacked: { p: 500, doc: 'one of our planets within p has a visible enemy next to it → that planet' },
  small: { p: 400, doc: 'this swarm has fewer than p particles → the nearest friendly swarm' },
  big: { p: 4000, doc: 'this swarm has more than p particles → itself' },
  hungry: { p: 0.6, doc: 'this swarm has gone p (0 to 1) of its starvation time without touching a planet or killing → the nearest planet with mass left' },
  full: { p: 0.1, doc: 'this swarm is still digesting more than p× its size in eaten particles → itself (digesting swarms are slow: hold or retreat)' },
  free_planet: { p: 2000, doc: 'an unowned planet with mass left within p → that planet' },
  enemy_planet: { p: 2000, doc: 'an enemy planet with mass left within p → that planet' },
  always: { p: 0, doc: 'always true → nothing' },
}
export const ACTIONS = {
  go: { doc: 'move to what the condition found: attack the enemy, capture or defend the planet, merge into the friend' },
  retreat: { doc: 'move to the nearest friendly swarm at least half our size, else home' },
  split: { doc: 'split in two; the new half heads for the second-nearest planet we do not own' },
  hold: { doc: 'stop where it is' },
}
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

// Snapshot encoding is used only at creation, load and explicit reads.
const conditionNames = Object.keys(CONDITIONS), actionNames = Object.keys(ACTIONS)
const swarmRow = c => [c.id, c.side, c.x, c.y, c.n, c.tx, c.ty, +c.manual, c.rule, c.noMerge, +c.eng, c.belly, c.meal, c.roll === undefined ? NaN : +c.roll]
const planetRow = p => [p.x, p.y, p.r, p.owner, p.cap, p.id, p.m0, p.mass, p.stock, p.prog, p.claim, p.by]
const rows = (values, size, make) => { const out = []; for (let i = 0; i < values.length; i += size) out.push(make(values.subarray(i, i + size))); return out }
const encodeRules = list => Float64Array.from(list.flatMap(r => [conditionNames.indexOf(r.if), actionNames.indexOf(r.then), r.p ?? CONDITIONS[r.if].p, +(r.on !== false), +(r.p !== undefined)]))
const reasons = [null, 'wipe', 'time', 'surrender']
const matchHandles = new WeakMap()

class Match {
  constructor(data) {
    const descriptors = Object.getOwnPropertyDescriptors(Match.prototype)
    for (const name of ['seed', 'opts', 'teams', 'endTick', 'tick', 'nextId', 'planets', 'swarms', 'gambits', 'ended']) {
      Object.defineProperty(this, name, { ...descriptors[name], enumerable: true })
    }
    for (const name of ['load', 'free', 'toJSON']) Object.defineProperty(this, name, descriptors[name])
    Object.setPrototypeOf(this, Object.prototype)
    this.load(data)
  }
  load(data) {
    if (typeof data === 'string') data = JSON.parse(data)
    const h = new RustMatch(data.seed, JSON.stringify(data.opts), Uint32Array.from(data.teams), data.tick, data.endTick, data.nextId,
      Float64Array.from(data.swarms.flatMap(swarmRow)), Float64Array.from(data.planets.flatMap(planetRow)))
    for (let side = 0; side < data.teams.length; side++) h.set_rules(side, encodeRules(data.gambits[side]))
    if (data.ended) h.set_outcome(data.ended.winner === null ? -1 : data.ended.winner, reasons.indexOf(data.ended.reason))
    matchHandles.get(this)?.free(); matchHandles.set(this, h)
    return this
  }
  free() { matchHandles.get(this)?.free(); matchHandles.delete(this) }
  get seed() { return matchHandles.get(this).seed() }
  get opts() { return JSON.parse(matchHandles.get(this).options()) }
  get teams() { return Array.from(matchHandles.get(this).teams()) }
  get endTick() { return matchHandles.get(this).end_tick() }
  get tick() { return matchHandles.get(this).tick() }
  get nextId() { return matchHandles.get(this).next_id() }
  get ended() { const [winner, reason] = matchHandles.get(this).outcome(); return reason ? { winner: winner < 0 ? null : winner, reason: reasons[reason] } : null }
  get swarms() { return rows(matchHandles.get(this).swarm_snapshot(), 14, c => ({ id: c[0], side: c[1], x: c[2], y: c[3], n: c[4], tx: c[5], ty: c[6], manual: !!c[7], rule: c[8], noMerge: c[9], eng: !!c[10], belly: c[11], meal: c[12], ...(!Number.isNaN(c[13]) && { roll: !!c[13] }) })) }
  get planets() { return rows(matchHandles.get(this).planet_snapshot(), 12, p => ({ x: p[0], y: p[1], r: p[2], owner: p[3], cap: p[4], id: p[5], m0: p[6], mass: p[7], stock: p[8], prog: p[9], claim: p[10], by: p[11] })) }
  get gambits() { return this.teams.map((_, side) => rows(matchHandles.get(this).rule_snapshot(side), 5, r => ({ if: conditionNames[r[0]], ...(r[4] && { p: r[2] }), then: actionNames[r[1]], on: !!r[3] }))) }
  toJSON() { return { seed: this.seed, opts: this.opts, teams: this.teams, endTick: this.endTick, tick: this.tick, nextId: this.nextId, planets: this.planets, swarms: this.swarms, gambits: this.gambits, ended: this.ended } }
}
export function createMatch(seed, options) {
  const opts = matchOptions(options), teams = MODES[opts.mode]
  const { planets, swarms } = JSON.parse(initial_geometry(seed >>> 0, teams.length, opts.planets))
  return new Match({ seed, opts, teams, endTick: opts.minutes * 60 * TPS, tick: 0, nextId: swarms.length + 1, planets, swarms, gambits: teams.map(() => DEFAULT_GAMBITS), ended: null })
}
export const fromJSON = json => new Match(json)
export const load = (s, json) => s.load(json)
export function addSwarm(s, side, x, y, n) { const id = matchHandles.get(s).add_swarm(side, x, y, n); return id < 0 ? null : s.swarms.find(c => c.id === id) }
export function seen(s, side) { const swarms = s.swarms; return Array.from(matchHandles.get(s).visible_indices(side), i => swarms[i]) }
export function applyInput(s, side, input) {
  if (s.ended) return { ok: false, error: 'match ended' }
  if (input.surrender === true) { matchHandles.get(s).surrender(side); return { ok: true } }
  const own = id => s.swarms.find(c => c.id === id && c.side === side)
  if (input.gambits !== undefined) { const err = checkGambits(input.gambits); if (err) return { ok: false, error: err }; matchHandles.get(s).set_rules(side, encodeRules(input.gambits)) }
  if (input.toggle !== undefined) {
    if (!s.gambits[side][input.toggle]) return { ok: false, error: 'no such gambit' }
    if (typeof input.toggle === 'number') matchHandles.get(s).toggle_rule(side, input.toggle)
  }
  if (input.order) {
    const c = own(input.order.swarm), { x, y } = input.order
    if (!c) return { ok: false, error: `no swarm ${input.order.swarm} of yours (it may have merged or died)` }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: 'x and y required' }
    matchHandles.get(s).set_order(side, c.id, x, y)
  }
  if (input.split !== undefined) {
    const c = own(input.split); if (!c) return { ok: false, error: `no swarm ${input.split} of yours` }
    if (matchHandles.get(s).split_id(side, c.id) !== 1) return { ok: false, error: 'cannot split (under 200 particles, or 40 swarms already)' }
  }
  if (input.release !== undefined) {
    const c = own(input.release); if (!c) return { ok: false, error: `no swarm ${input.release} of yours` }
    matchHandles.get(s).release(side, c.id)
  }
  return { ok: true }
}
export function step(s) { matchHandles.get(s).advance() }
export function advanceTo(s, tick) { matchHandles.get(s).advance_to(tick) }
export function replay(seed, log, opts) {
  const s = createMatch(seed, opts); let i = 0
  while (i < log.length && !s.ended && log[i].tick >= s.tick) {
    matchHandles.get(s).advance_to(log[i].tick)
    if (s.ended) break
    for (; i < log.length && log[i].tick === s.tick; i++) applyInput(s, log[i].side, log[i].input)
  }
  matchHandles.get(s).finish(); return s
}
export const totals = s => Array.from(matchHandles.get(s).populations())
export function view(s, side) {
  const h = matchHandles.get(s), summary = h.view_totals(side), header = h.view_header(side)
  const own = rows(matchHandles.get(s).view_swarms(side, 0), 11, c => ({ id: c[0], x: c[1], y: c[2], n: c[3], tx: c[4], ty: c[5], manual: !!c[6], rule: c[7], fighting: !!c[8], belly: c[9], hunger: c[10] }))
  const allies = rows(matchHandles.get(s).view_swarms(side, 1), 5, c => ({ id: c[0], x: c[1], y: c[2], n: c[3], fighting: !!c[4] }))
  const enemies = rows(matchHandles.get(s).view_swarms(side, 2), 6, c => ({ id: c[0], k: c[1], x: c[2], y: c[3], n: c[4], fighting: !!c[5] }))
  const planets = rows(matchHandles.get(s).view_planets(side), 10, p => ({ id: p[0], x: p[1], y: p[2], r: p[3], owner: p[4] < 0 ? null : ['you', 'ally', 'enemy'][p[4]], k: p[5], massLeft: p[6], mass: p[7], capture: p[8], ck: p[9] }))
  return { tick: s.tick, secondsLeft: header[0], mode: s.opts.mode,
    ended: header[1] < 0 ? null : { reason: s.ended.reason, result: ['won', 'draw', 'lost'][header[1]] },
    totals: { you: summary[0], enemy: summary[1], foes: Array.from(summary.subarray(2), (n, k) => ({ k, n })) },
    swarms: own, allies, enemies, planets, gambits: s.gambits[side] }
}

export const rules = () => ({
  conditions: Object.fromEntries(Object.entries(CONDITIONS).map(([k, c]) => [k, { doc: c.doc, p: c.p }])),
  actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, { doc: a.doc }])),
  modes: Object.keys(MODES),
})
export const describe = r => `${r.on === false ? '(off) ' : ''}IF ${r.if}${r.p !== undefined ? `(${r.p})` : ''} → ${r.then}`
