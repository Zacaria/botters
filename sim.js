// Particle war spike: every particle is a unit. Deterministic (state = f(seed, inputs by tick)): only + - * / sqrt, no trig, no Math.random.
// Two sides fight over planets. Owned planets breed units, which join the nearest battalion. Battalions follow their side's doctrine
// (IF condition → action, first match wins) unless the player ordered them by hand; units decide for themselves from their role:
// tanks lead and block, grunts follow, runners hold back with the battalion, then circle round the enemy they meet.
export const W = 1200, H = 700, TPS = 20
export const ROLES = [ // speed px/tick, hp, damage per tick in melee, separation weight (heavy units shove light ones)
  { name: 'runner', speed: 1.7, hp: 0.6, dmg: 0.05, push: 0.6 },
  { name: 'grunt', speed: 1.1, hp: 1, dmg: 0.05, push: 1 },
  { name: 'tank', speed: 0.7, hp: 2.6, dmg: 0.03, push: 2.2 },
]
const SIGHT = 26, REACH = 5, SEP = 5, CELL = 26, GW = Math.ceil(W / CELL), GH = Math.ceil(H / CELL)
export const MAXPER = 4000, MAXBATS = 14 // units and live battalions per side
export const THINK = 10 // battalions, planets and doctrine update every THINK ticks
const PROD = 0.06 // units bred per think per unit of planet radius
const NEAR = 40 // a planet counts the units within its radius + NEAR

// ---------- doctrine ----------
export const CONDITIONS = {
  bigger_enemy_near: { p: 1.3, doc: 'an enemy battalion at least p× our size within 180 → that enemy' },
  planet_attacked: { p: 350, doc: 'one of our planets within p has enemies on it → that planet' },
  ally_fighting: { p: 450, doc: 'we are not fighting and a friendly battalion within p is → the enemy it fights' },
  weaker_enemy_near: { p: 0.8, doc: 'an enemy battalion at most p× our size within 260 → that enemy' },
  small: { p: 120, doc: 'this battalion has fewer than p units → the nearest friendly battalion' },
  big: { p: 900, doc: 'this battalion has more than p units → itself' },
  free_planet: { p: 2000, doc: 'an unowned planet within p → that planet' },
  enemy_planet: { p: 2000, doc: 'an enemy planet within p → that planet' },
  always: { p: 0, doc: 'always true → itself' },
}
export const ACTIONS = {
  go: 'move to what the condition found: attack the enemy, take or defend the planet, merge into the friend',
  flank: 'swing wide round the enemy the condition found and hit it from the side',
  retreat: 'fall back to the nearest friendly battalion at least half our size, else our nearest planet',
  split: 'split in two; the new half heads for the second-nearest planet we do not own',
  hold: 'stop where it is',
}
const rule = (cond, then, p) => ({ if: cond, then, on: true, ...(p !== undefined && { p }) })
export const DOCTRINES = { // 16 maps × both sides (docs/agent-value/RESULTS.md): pincer beats blob 0.63, flanker 0.72; blob beats flanker 0.69; everything beats cautious
  pincer: [rule('planet_attacked', 'go'), rule('weaker_enemy_near', 'go', 3), rule('bigger_enemy_near', 'flank', 1), rule('free_planet', 'go'), rule('enemy_planet', 'go'), rule('always', 'hold')], // blob that flanks an equal or bigger enemy
  flanker: [rule('planet_attacked', 'go'), rule('weaker_enemy_near', 'go', 3), rule('ally_fighting', 'flank'), rule('free_planet', 'go'), rule('enemy_planet', 'go'), rule('always', 'hold')],
  wary: [rule('planet_attacked', 'go'), rule('bigger_enemy_near', 'retreat', 1.5), rule('weaker_enemy_near', 'go', 3), rule('ally_fighting', 'flank'), rule('free_planet', 'go'), rule('enemy_planet', 'go'), rule('always', 'hold')], // flanker that falls back from a battalion 1.5× its size
  blob: [rule('planet_attacked', 'go'), rule('weaker_enemy_near', 'go', 3), rule('free_planet', 'go'), rule('enemy_planet', 'go'), rule('always', 'hold')], // never retreats, never splits
  cautious: [rule('bigger_enemy_near', 'retreat'), rule('planet_attacked', 'go'), rule('ally_fighting', 'flank'), rule('weaker_enemy_near', 'go'), rule('small', 'go'), rule('big', 'split'), rule('free_planet', 'go'), rule('enemy_planet', 'go')],
}

const rnd = s => (s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0) / 4294967296
const d2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2

export function createMatch(seed = 1, options = {}) {
  const opts = matchOptions(options), perSide = 1200, minutes = opts.minutes
  const N = 2 * MAXPER, s = {
    seed, N, tick: 0, rng: seed >>> 0 || 1, endTick: minutes * 60 * TPS, ended: null,
    x: new Float32Array(N), y: new Float32Array(N), vx: new Float32Array(N), vy: new Float32Array(N), hp: new Float32Array(N),
    side: new Uint8Array(N), role: new Uint8Array(N), bat: new Uint16Array(N), alive: new Uint8Array(N),
    dmg: new Float32Array(N), head: new Int32Array(GW * GH), next: new Int32Array(N),
    bats: [], planets: [], opts, gambits: [structuredClone(DEFAULT_GAMBITS), structuredClone(DEFAULT_GAMBITS)],
  }
  for (let i = 0; i < N; i++) s.side[i] = i < MAXPER ? 0 : 1
  // planets: two homes, a big centre prize, 7 random pairs mirrored through the centre so the map is fair
  const add = (x, y, r, owner) => s.planets.push({ id: s.planets.length, x, y, r, owner, prog: owner >= 0 ? 100 : 0, by: -1, acc: 0, pres: [0, 0] })
  add(110, H / 2, 24, 0); add(W - 110, H / 2, 24, 1); add(W / 2, H / 2, 28, -1)
  for (let k = 0, tries = 0; k < (opts.planets - 3) / 2 && tries < 5000; tries++) {
    const x = 170 + rnd(s) * 380, y = 40 + rnd(s) * (H - 80), r = 10 + rnd(s) * 16
    if (s.planets.some(p => d2(p.x, p.y, x, y) < 120 * 120) || d2(W - x, H - y, x, y) < 120 * 120) continue
    add(x, y, r, -1); add(W - x, H - y, r, -1); k++
  }
  for (let side = 0; side < 2; side++) {
    const home = s.planets[side]
    for (let b = 0; b < 3; b++) {
      const o = newBat(s, side); o.tx = o.cx = home.x + (side ? -60 : 60); o.ty = o.cy = home.y + (b - 1) * 110
      for (let k = 0; k < perSide / 3; k++) spawn(s, side, o.cx + (rnd(s) - 0.5) * 70, o.cy + (rnd(s) - 0.5) * 80, o.id)
    }
  }
  think(s)
  return s
}

function newBat(s, side) {
  const o = { id: s.bats.length, side, tx: 0, ty: 0, manual: false, via: [], cx: 0, cy: 0, n: 0, hit: -1e9, rule: -1, key: '', busy: 0 }
  s.bats.push(o); return o
}
function spawn(s, side, x, y, bat) {
  for (let i = side * MAXPER; i < (side + 1) * MAXPER; i++) if (!s.alive[i]) {
    const r = rnd(s); s.alive[i] = 1; s.bat[i] = bat; s.role[i] = r < 0.25 ? 0 : r < 0.75 ? 1 : 2; s.hp[i] = ROLES[s.role[i]].hp
    s.x[i] = Math.min(W - 1, Math.max(0, x)); s.y[i] = Math.min(H - 1, Math.max(0, y)); s.vx[i] = s.vy[i] = 0; s.bats[bat].n++
    return true
  }
  return false
}
export const live = (s, side) => s.bats.filter(o => o.n && o.side === side)
export const fighting = (s, o) => s.tick - o.hit < THINK * 2

// ---------- orders: the player's hand. An ordered battalion ignores doctrine until released ----------
export function order(s, b, tx, ty) { const o = s.bats[b]; if (!o?.n) return false; o.tx = tx; o.ty = ty; o.via = []; o.manual = true; return true }
export function release(s, b) { const o = s.bats[b]; if (!o?.n) return false; o.manual = false; o.key = ''; o.rule = -1; return true }
export function flank(s, b) { // hand-ordered flank on the nearest enemy battalion in sight, fighting ones count as 2× nearer
  const o = s.bats[b]; if (!o?.n) return false
  const foes = live(s, 1 - o.side).filter(q => visible(s, o.side, q.cx, q.cy)); if (!foes.length) return false
  const score = q => d2(q.cx, q.cy, o.cx, o.cy) * (fighting(s, q) ? 0.25 : 1)
  flankAt(s, o, foes.reduce((m, q) => (score(q) < score(m) ? q : m))); o.manual = true
  return true
}
export function detach(s, b, roleName) {
  const o = s.bats[b]; if (!o || o.n < 2 || live(s, o.side).length >= MAXBATS) return -1
  const nb = newBat(s, o.side); Object.assign(nb, { tx: o.tx, ty: o.ty, manual: o.manual, via: o.via.slice(), cx: o.cx, cy: o.cy })
  const r = roleName ? ROLES.findIndex(q => q.name === roleName) : -1; let k = 0
  for (let i = 0; i < s.N; i++) if (s.alive[i] && s.bat[i] === b && (r >= 0 ? s.role[i] === r : (k++ & 1))) { s.bat[i] = nb.id; nb.n++; o.n-- }
  return nb.n ? nb.id : -1
}
export function setDoctrine(s, side, rules) { s.gambits[side] = structuredClone(rules); for (const o of s.bats) if (o.side === side) o.key = '' }

// Swing round enemy q: first to a point 170 px beside it (on our side of the fight axis), then into its flank.
function flankAt(s, o, q) {
  let ax = q.cx - o.cx, ay = q.cy - o.cy
  const ally = live(s, o.side).find(f => f !== o && fighting(s, f) && d2(f.cx, f.cy, q.cx, q.cy) < 120 * 120)
  if (ally) { ax = q.cx - ally.cx; ay = q.cy - ally.cy } // the fight axis
  const d = Math.sqrt(ax * ax + ay * ay) || 1, ux = ax / d, uy = ay / d
  const sgn = (o.cx - q.cx) * -uy + (o.cy - q.cy) * ux >= 0 ? 1 : -1, clampX = v => Math.min(W - 20, Math.max(20, v)), clampY = v => Math.min(H - 20, Math.max(20, v))
  o.via = [{ x: clampX(q.cx - uy * sgn * 170), y: clampY(q.cy + ux * sgn * 170) }]
  o.tx = clampX(q.cx + ux * 30); o.ty = clampY(q.cy + uy * 30)
}
function merge(s, from, into) {
  for (let i = 0; i < s.N; i++) if (s.alive[i] && s.bat[i] === from.id) s.bat[i] = into.id
  into.n += from.n; from.n = 0
}

// A condition returns what it found (a battalion, a planet, or the battalion itself) or null.
function test(s, o, r) {
  const p = r.p ?? CONDITIONS[r.if].p, foes = live(s, 1 - o.side), friends = live(s, o.side).filter(f => f !== o)
  const nearest = (list, ok, max) => { let best = null, bd = max * max; for (const q of list) { const d = d2(q.cx ?? q.x, q.cy ?? q.y, o.cx, o.cy); if (d < bd && ok(q)) { bd = d; best = q } } return best }
  switch (r.if) {
    case 'bigger_enemy_near': return nearest(foes, q => q.n >= p * o.n, 180)
    case 'planet_attacked': return nearest(s.planets, q => q.owner === o.side && q.pres[1 - o.side] > 0, p)
    case 'ally_fighting': {
      if (fighting(s, o)) return null
      const f = nearest(friends, q => fighting(s, q), p); if (!f) return null
      let best = null, bd = Infinity; for (const q of foes) { const d = d2(q.cx, q.cy, f.cx, f.cy); if (d < bd) { bd = d; best = q } } return best
    }
    case 'weaker_enemy_near': return nearest(foes, q => q.n <= p * o.n, 260)
    case 'small': return o.n < p ? nearest(friends, () => true, 5000) : null
    case 'big': return o.n > p ? o : null
    case 'free_planet': return nearest(s.planets, q => q.owner < 0, p)
    case 'enemy_planet': return nearest(s.planets, q => q.owner === 1 - o.side, p)
    case 'always': return o
  }
  return null
}
function act(s, o, then, t, key) {
  const fresh = key !== o.key, isBat = t.n !== undefined; o.key = key
  const tx = isBat ? t.cx : t.x, ty = isBat ? t.cy : t.y
  if (then === 'go') {
    o.via = []; o.tx = tx; o.ty = ty
    if (isBat && t !== o && t.side === o.side && d2(tx, ty, o.cx, o.cy) < 45 * 45) merge(s, o, t)
  } else if (then === 'flank') { if (fresh && isBat && t.side !== o.side) flankAt(s, o, t) }
  else if (then === 'hold') { if (fresh) { o.via = []; o.tx = o.cx; o.ty = o.cy } }
  else if (then === 'retreat') {
    const f = live(s, o.side).filter(q => q !== o && q.n >= o.n / 2).reduce((m, q) => (!m || d2(q.cx, q.cy, o.cx, o.cy) < d2(m.cx, m.cy, o.cx, o.cy) ? q : m), null)
    const home = s.planets.filter(p => p.owner === o.side).reduce((m, p) => (!m || d2(p.x, p.y, o.cx, o.cy) < d2(m.x, m.y, o.cx, o.cy) ? p : m), null) ?? s.planets[o.side]
    o.via = []; o.tx = f ? f.cx : home.x; o.ty = f ? f.cy : home.y
  } else if (then === 'split') {
    const nb = detach(s, o.id); if (nb < 0) return
    const targets = s.planets.filter(p => p.owner !== o.side).sort((a, b) => d2(a.x, a.y, o.cx, o.cy) - d2(b.x, b.y, o.cx, o.cy) || a.id - b.id)
    const t2 = targets[1] ?? targets[0], q = s.bats[nb]
    if (t2) { q.tx = t2.x; q.ty = t2.y; q.via = [] }
    q.busy = s.tick + 300; o.key = '' // the new half commits to its planet for 15 s
  }
}

function think(s) {
  for (const o of s.bats) { o.cx = 0; o.cy = 0; o.n = 0 }
  for (const p of s.planets) p.pres = [0, 0]
  const R2 = s.planets.map(p => (p.r + NEAR) ** 2)
  for (let i = 0; i < s.N; i++) if (s.alive[i]) {
    const o = s.bats[s.bat[i]]; o.cx += s.x[i]; o.cy += s.y[i]; o.n++
    for (let k = 0; k < s.planets.length; k++) { const p = s.planets[k]; if (d2(p.x, p.y, s.x[i], s.y[i]) < R2[k]) p.pres[s.side[i]]++ }
  }
  for (const o of s.bats) if (o.n) { o.cx /= o.n; o.cy /= o.n }
  for (const o of s.bats) if (o.via.length && o.n && d2(o.cx, o.cy, o.via[0].x, o.via[0].y) < 70 * 70) o.via.shift() // waypoint reached

  // planets: an uncontested crowd drains then takes a planet; owned, unthreatened planets breed into the nearest battalion
  for (const p of s.planets) {
    const [a, b] = p.pres, side = a >= 8 && !b ? 0 : b >= 8 && !a ? 1 : -1
    if (side >= 0) {
      const rate = Math.min(12, 2 + p.pres[side] / 40)
      if (p.owner === side) p.prog = Math.min(100, p.prog + rate)
      else if (p.owner >= 0) { p.prog -= rate; if (p.prog <= 0) { p.owner = -1; p.prog = 0; p.by = side } }
      else { if (p.by !== side) { p.by = side; p.prog = 0 } p.prog += rate; if (p.prog >= 100) { p.owner = side; p.prog = 100; p.acc = 0 } }
    }
    if (p.owner >= 0 && !p.pres[1 - p.owner]) {
      p.acc += p.r * PROD
      let o = live(s, p.owner).filter(q => !q.manual && d2(q.cx, q.cy, p.x, p.y) < 140 * 140).sort((u, v) => d2(u.cx, u.cy, p.x, p.y) - d2(v.cx, v.cy, p.x, p.y) || u.id - v.id)[0]
      for (; p.acc >= 1; p.acc--) {
        if (!o) { if (live(s, p.owner).length >= MAXBATS) break; o = newBat(s, p.owner); o.cx = o.tx = p.x; o.cy = o.ty = p.y }
        let x, y; do { x = (rnd(s) - 0.5) * 2; y = (rnd(s) - 0.5) * 2 } while (x * x + y * y > 1)
        if (!spawn(s, p.owner, p.x + x * p.r, p.y + y * p.r, o.id)) { p.acc = 0; break }
      }
    }
  }

  // doctrine: the first rule whose condition finds something decides; hand-ordered battalions are left alone
  for (const o of s.bats) if (o.n && !o.manual && s.tick >= o.busy) {
    const rules = s.gambits[o.side]
    for (let k = 0; k < rules.length; k++) {
      if (rules[k].on === false) continue
      const t = test(s, o, rules[k]); if (!t) continue
      o.rule = k; act(s, o, rules[k].then, t, `${k}:${t.n !== undefined ? 'b' : 'p'}${t.id}`); break
    }
  }

  // end: a side with no units and no planets loses; at time, more planets wins, then more units
  if (!s.ended) {
    const n = count(s), pl = owned(s), out = [0, 1].map(side => !n[side] && !pl[side])
    if (out[0] || out[1]) s.ended = { winner: out[0] && out[1] ? null : out[0] ? 1 : 0, reason: 'wipe' }
    else if (s.tick >= s.endTick) s.ended = { winner: pl[0] !== pl[1] ? (pl[0] > pl[1] ? 0 : 1) : n[0] !== n[1] ? (n[0] > n[1] ? 0 : 1) : null, reason: 'time' }
  }
}

export function step(s) {
  if (s.ended) return
  s.tick++
  if (s.tick % THINK === 0) think(s)
  const { x, y, vx, vy, hp, side, role, bat, alive, dmg, head, next, N } = s
  head.fill(-1)
  for (let i = 0; i < N; i++) if (alive[i]) { const c = ((y[i] / CELL) | 0) * GW + ((x[i] / CELL) | 0); next[i] = head[c]; head[c] = i }
  dmg.fill(0)
  for (let i = 0; i < N; i++) {
    if (!alive[i]) continue
    const R = ROLES[role[i]], cx = Math.min(GW - 1, Math.max(0, (x[i] / CELL) | 0)), cy = Math.min(GH - 1, Math.max(0, (y[i] / CELL) | 0))
    let sx = 0, sy = 0, foe = -1, fd = SIGHT * SIGHT
    for (let gy = Math.max(0, cy - 1); gy <= Math.min(GH - 1, cy + 1); gy++) for (let gx = Math.max(0, cx - 1); gx <= Math.min(GW - 1, cx + 1); gx++)
      for (let j = head[gy * GW + gx]; j >= 0; j = next[j]) {
        if (j === i) continue
        const dx = x[i] - x[j], dy = y[i] - y[j], dd = dx * dx + dy * dy
        if (dd < SEP * SEP) { const d = Math.sqrt(dd) || 0.01, k = (SEP - d) / SEP / d * ROLES[role[j]].push / R.push; sx += (dd ? dx : (i & 1) - 0.5) * k; sy += (dd ? dy : (j & 1) - 0.5) * k }
        if (side[j] !== side[i] && dd < fd) { fd = dd; foe = j }
      }
    const o = s.bats[bat[i]]
    let tx, ty, v = R.speed
    if (foe >= 0) {
      tx = x[foe]; ty = y[foe]
      if (R.name === 'runner' && fd > REACH * REACH * 4) { // runners swing round: aim at the far side of the foe, on the side set by their number
        const dx = tx - x[i], dy = ty - y[i], d = Math.sqrt(dx * dx + dy * dy) || 1, sgn = i & 2 ? 1 : -1
        tx += (-dy / d * sgn + dx / d) * 18; ty += (dx / d * sgn + dy / d) * 18
      }
      if (fd < REACH * REACH) { dmg[foe] += R.dmg; o.hit = s.tick }
    } else {
      const wp = o.via[0], gx = wp ? wp.x : o.tx, gy = wp ? wp.y : o.ty, ddx = gx - x[i], ddy = gy - y[i], dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1, off = Math.sqrt((o.cx - x[i]) ** 2 + (o.cy - y[i]) ** 2)
      tx = x[i] + ddx / dd * 50 + (o.cx - x[i]) * (off > 60 ? 0.4 : 0.02); ty = y[i] + ddy / dd * 50 + (o.cy - y[i]) * (off > 60 ? 0.4 : 0.02)
      if (R.name === 'runner' && off < 90) v = ROLES[1].speed * 0.9 // runners keep to the battalion's pace until they see the enemy
      if (dd < 8) v = 0
    }
    const dx = tx - x[i], dy = ty - y[i], d = Math.sqrt(dx * dx + dy * dy) || 1
    const m = foe >= 0 && fd < REACH * REACH ? 0.2 : 1
    vx[i] = dx / d * v * m + sx; vy[i] = dy / d * v * m + sy
    const sp = vx[i] * vx[i] + vy[i] * vy[i], cap = 2 * R.speed; if (sp > cap * cap) { const k = cap / Math.sqrt(sp); vx[i] *= k; vy[i] *= k } // nobody ever outruns twice its own speed
  }
  for (let i = 0; i < N; i++) if (alive[i]) {
    hp[i] -= dmg[i]
    if (hp[i] <= 0) { alive[i] = 0; s.bats[bat[i]].n--; continue }
    x[i] = Math.min(W - 1, Math.max(0, x[i] + vx[i])); y[i] = Math.min(H - 1, Math.max(0, y[i] + vy[i]))
  }
}

export const count = s => { const n = [0, 0]; for (let i = 0; i < s.N; i++) if (s.alive[i]) n[s.side[i]]++; return n }
export const owned = s => [0, 1].map(side => s.planets.filter(p => p.owner === side).length)
export const hash = s => { let h = 2166136261 >>> 0; for (let i = 0; i < s.N; i++) { h = Math.imul(h ^ (s.alive[i] ? (s.x[i] * 16) | 0 : -1), 16777619) >>> 0; h = Math.imul(h ^ (s.alive[i] ? (s.y[i] * 16) | 0 : 0), 16777619) >>> 0 } h = Math.imul(h ^ s.tick, 16777619) >>> 0; for (const p of s.planets) h = Math.imul(h ^ p.owner, 16777619) >>> 0; return h }

export const MAX_GAMBITS = 10
export const DEFAULT_GAMBITS = DOCTRINES.flanker
// live league (docs/agent-value/league-2026-11-26.md): Claude won 2/9 against blob and 1/5 against flanker as normal
export const HOUSE_DOCTRINE = { easy: 'cautious', normal: 'wary', hard: 'pincer' }
export const HOUSE = Object.fromEntries(Object.entries(HOUSE_DOCTRINE).map(([k, v]) => [k, DOCTRINES[v]]))
export const OPTIONS = { minutes: [3, 5, 8], planets: [9, 17, 25] }
export const matchOptions = o => ({ minutes: OPTIONS.minutes.includes(o?.minutes) ? o.minutes : 5, planets: OPTIONS.planets.includes(o?.planets) ? o.planets : 17 })
export function checkGambits(list) {
  if (!Array.isArray(list) || !list.length || list.length > MAX_GAMBITS) return `send 1 to ${MAX_GAMBITS} gambits`
  for (const r of list) {
    if (!r || typeof r !== 'object' || typeof r.if !== 'string' || !Object.hasOwn(CONDITIONS, r.if)) return 'unknown condition'
    if (typeof r.then !== 'string' || !Object.hasOwn(ACTIONS, r.then)) return 'unknown action'
    if (r.p !== undefined && !(Number.isFinite(r.p) && r.p > 0 && r.p <= 100000)) return 'invalid p'
    if (r.on !== undefined && typeof r.on !== 'boolean') return 'invalid on'
  }
  return null
}
export function applyInput(s, side, input) {
  const fail = error => ({ ok: false, error })
  if (s.ended) return fail('match ended')
  if ((side !== 0 && side !== 1) || !input || typeof input !== 'object' || Array.isArray(input)) return fail('invalid input or side')
  const keys = Object.keys(input)
  if (keys.length !== 1 || !['gambits', 'toggle', 'order', 'flank', 'detach', 'release', 'surrender'].includes(keys[0])) return fail('send exactly one input')
  const key = keys[0], arg = input[key]
  if (key === 'surrender') { if (arg !== true) return fail('invalid surrender'); s.ended = { winner: 1 - side, reason: 'surrender' }; return { ok: true } }
  if (key === 'gambits') { const error = checkGambits(arg); if (error) return fail(error); setDoctrine(s, side, arg); return { ok: true } }
  if (key === 'toggle') { if (!Number.isInteger(arg) || !s.gambits[side][arg]) return fail('no such gambit'); const r = s.gambits[side][arg]; r.on = r.on === false; for (const b of live(s, side)) b.key = ''; return { ok: true } }
  const id = key === 'order' || key === 'detach' ? arg?.bat : arg
  if (!Number.isInteger(id) || !s.bats[id]?.n || s.bats[id].side !== side) return fail(`no battalion ${id} of yours. Your live battalions: ${live(s, side).map(b => b.id).join(', ') || 'none'}`)
  if (key === 'order') {
    if (!Number.isFinite(arg.x) || !Number.isFinite(arg.y) || arg.x < 0 || arg.x > W || arg.y < 0 || arg.y > H) return fail('x and y must be inside the map')
    order(s, id, arg.x, arg.y)
  } else if (key === 'release') release(s, id)
  else if (key === 'flank') { if (!flank(s, id)) return fail('no enemy battalion in sight') }
  else {
    if (arg.role !== undefined && !ROLES.some(r => r.name === arg.role)) return fail('unknown role')
    if (arg.role && !s.role.some((r, i) => s.alive[i] && s.bat[i] === id && ROLES[r].name === arg.role)) return fail('no units of that role')
    const bat = detach(s, id, arg.role); if (bat < 0) return fail('cannot detach'); return { ok: true, bat }
  }
  return { ok: true }
}
export function advanceTo(s, tick) { while (s.tick < tick && !s.ended) step(s) }
export function replay(seed, log, opts) {
  const s = createMatch(seed, opts)
  for (const e of log) { if (e.tick < s.tick) throw new Error('input log out of order'); advanceTo(s, e.tick); if (s.ended) break; const result = applyInput(s, e.side, e.input); if (!result.ok) throw new Error(result.error) }
  advanceTo(s, opts?.tick ?? s.endTick); return s
}
// A packed record contains index, the raw float32 fields, role and battalion.
export function snapshot(s) {
  const length = count(s).reduce((a, b) => a + b, 0), bytes = new Uint8Array(length * 27), d = new DataView(bytes.buffer)
  let n = 0
  for (let i = 0; i < s.N; i++) if (s.alive[i]) {
    const p = n++ * 27; d.setUint32(p, i, true)
    for (let k = 0; k < 5; k++) d.setUint32(p + 4 + 4 * k, new Uint32Array(s[['x','y','vx','vy','hp'][k]].buffer)[i], true)
    d.setUint8(p + 24, s.role[i]); d.setUint16(p + 25, s.bat[i], true)
  }
  let binary = ''; for (const b of bytes) binary += String.fromCharCode(b)
  return { seed: s.seed, opts: structuredClone(s.opts), tick: s.tick, rng: s.rng, endTick: s.endTick, ended: structuredClone(s.ended), bats: structuredClone(s.bats), planets: structuredClone(s.planets), gambits: structuredClone(s.gambits), units: btoa(binary) }
}
export function restore(data) {
  if (typeof data === 'string') data = JSON.parse(data)
  const s = createMatch(data.seed, data.opts), binary = atob(data.units), bytes = Uint8Array.from(binary, c => c.charCodeAt(0)), d = new DataView(bytes.buffer)
  if (bytes.length % 27) throw new Error('invalid snapshot')
  for (const name of ['x','y','vx','vy','hp','role','bat','alive']) s[name].fill(0)
  for (let p = 0; p < bytes.length; p += 27) {
    const i = d.getUint32(p, true); if (i >= s.N) throw new Error('invalid unit index')
    s.alive[i] = 1
    for (let k = 0; k < 5; k++) new Uint32Array(s[['x','y','vx','vy','hp'][k]].buffer)[i] = d.getUint32(p + 4 + 4 * k, true)
    s.role[i] = d.getUint8(p + 24); s.bat[i] = d.getUint16(p + 25, true)
  }
  for (const k of ['tick','rng','endTick','ended','bats','planets','gambits','opts']) s[k] = structuredClone(data[k])
  return s
}
export const visible = (s, side, x, y) => live(s, side).some(b => d2(b.cx, b.cy, x, y) <= 150 ** 2) || s.planets.some(p => p.owner === side && d2(p.x, p.y, x, y) <= 80 ** 2)
// Who holds a planet is public; how far a capture has gone is known only to a side that sees the planet or stands on it.
export const progress = (s, side, p) => p.pres[side] || visible(s, side, p.x, p.y) ? { prog: p.prog, by: p.by } : { prog: p.owner < 0 ? 0 : 100, by: -1 }
export function view(s, side) {
  const units = count(s), planets = owned(s), battalions = live(s, side).map(b => {
    const roles = { runner: 0, grunt: 0, tank: 0 }
    for (let i = 0; i < s.N; i++) if (s.alive[i] && s.bat[i] === b.id) roles[ROLES[s.role[i]].name]++
    return { id: b.id, x: b.cx, y: b.cy, n: b.n, roles, tx: b.tx, ty: b.ty, manual: b.manual, rule: b.rule, ruleText: !b.manual && b.rule >= 0 && s.gambits[side][b.rule] ? describe(s.gambits[side][b.rule]) : null, fighting: fighting(s, b) }
  })
  return { tick: s.tick, secondsLeft: Math.max(0, (s.endTick - s.tick) / TPS), ended: s.ended ? { reason: s.ended.reason, result: s.ended.winner === null ? 'draw' : s.ended.winner === side ? 'won' : 'lost' } : null,
    totals: { you: units[side], enemy: units[1-side], planets: { you: planets[side], enemy: planets[1-side] } }, battalions,
    enemies: live(s, 1-side).filter(b => visible(s, side, b.cx, b.cy)).map(b => ({ id: b.id, x: b.cx, y: b.cy, n: b.n, fighting: fighting(s, b) })),
    planets: s.planets.map(p => ({ id: p.id, x: p.x, y: p.y, r: p.r, owner: p.owner < 0 ? null : p.owner === side ? 'you' : 'enemy', capture: progress(s, side, p).prog })), gambits: structuredClone(s.gambits[side]), perRule: s.gambits[side].map((_, i) => battalions.filter(b => !b.manual && b.rule === i).length) }
}
export const rules = () => ({ conditions: structuredClone(CONDITIONS), actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, doc]) => [k, { doc }])) })
export const describe = r => `${r.on === false ? '(off) ' : ''}IF ${r.if}${r.p !== undefined ? `(${r.p})` : ''} → ${r.then}`

export function changes(before, after) {
  const plain = r => describe({ ...r, on: true })
  const p = r => r.p ?? CONDITIONS[r.if]?.p, same = (a, b) => a.if === b.if && a.then === b.then && p(a) === p(b) // an explicit default p is no change
  if (before.length === after.length && before.every((r, i) => same(r, after[i]))) {
    const toggles = before.flatMap((r, i) => (r.on !== false) === (after[i].on !== false) ? [] : [`rule ${i + 1} ${after[i].on === false ? 'off' : 'on'}: ${plain(r)}`])
    return toggles.join('; ') || 'no change'
  }
  const added = after.slice(), removed = []
  for (const r of before) { const i = added.findIndex(a => same(a, r)); if (i < 0) removed.push(r); else added.splice(i, 1) }
  const out = []
  for (const r of removed) { // same rule, new p: one line
    const i = added.findIndex(a => a.if === r.if && a.then === r.then)
    if (i < 0) { out.push(`- ${plain(r)}`); continue }
    out.push(`IF ${r.if} → ${r.then}: p ${p(r)} → ${p(added[i])}`); added.splice(i, 1)
  }
  return [...out, ...added.map(r => `+ ${plain(r)}`)].join('; ') || 'reordered'
}
