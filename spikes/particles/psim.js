// Particle spike: every particle is a unit. Deterministic (state = f(seed, inputs by tick)): only + - * / sqrt, no trig, no Math.random.
// Worst case designed for: 3000 units per side. Battalions (groups of units) take orders and detach; units decide for themselves
// from their role: tanks lead and block, grunts follow, runners hold back with the battalion, then circle round the enemy's flank.
export const W = 1200, H = 700, TPS = 20
export const ROLES = [ // speed px/tick, hp, damage per tick in melee, separation weight (heavy units shove light ones)
  { name: 'runner', speed: 1.7, hp: 0.6, dmg: 0.05, push: 0.6 },
  { name: 'grunt', speed: 1.1, hp: 1, dmg: 0.05, push: 1 },
  { name: 'tank', speed: 0.7, hp: 2.6, dmg: 0.03, push: 2.2 },
]
const SIGHT = 26, REACH = 5, SEP = 5, CELL = 26, GW = Math.ceil(W / CELL), GH = Math.ceil(H / CELL)

export function createParticles(seed = 1, perSide = 3000, battalions = 6, flank = true) {
  let a = seed >>> 0; const rnd = () => (a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296
  const N = 2 * perSide, s = {
    seed, N, tick: 0, flank, perSide,
    x: new Float32Array(N), y: new Float32Array(N), vx: new Float32Array(N), vy: new Float32Array(N), hp: new Float32Array(N),
    side: new Uint8Array(N), role: new Uint8Array(N), bat: new Uint16Array(N), alive: new Uint8Array(N).fill(1),
    dmg: new Float32Array(N), head: new Int32Array(GW * GH), next: new Int32Array(N),
    bats: [], // { id, side, tx, ty, order: bool, cx, cy, n }
  }
  for (let side = 0; side < 2; side++) for (let b = 0; b < battalions; b++) s.bats.push({ id: s.bats.length, side, tx: side ? 250 : 950, ty: 350, order: false, cx: 0, cy: 0, n: 0 })
  for (let i = 0; i < N; i++) {
    const side = i < perSide ? 0 : 1, k = i % perSide, b = side * battalions + (k % battalions), r = rnd()
    s.side[i] = side; s.bat[i] = b; s.role[i] = r < 0.25 ? 0 : r < 0.75 ? 1 : 2; s.hp[i] = ROLES[s.role[i]].hp
    const lane = (k % battalions) - (battalions - 1) / 2 // battalions stand in a column, each a dense block
    s.x[i] = (side ? 1000 : 200) + (side ? 1 : -1) * rnd() * 70
    s.y[i] = 350 + lane * 90 + (rnd() - 0.5) * 80
  }
  return s
}

export function order(s, b, tx, ty) { const o = s.bats[b]; if (!o) return false; o.tx = tx; o.ty = ty; o.order = true; return true }
// Split a battalion: the given role (or everyone) of the nearest half toward its target leaves as a new battalion.
export function detach(s, b, roleName) {
  const o = s.bats[b]; if (!o || o.n < 2) return -1
  const nb = { id: s.bats.length, side: o.side, tx: o.tx, ty: o.ty, order: o.order, cx: o.cx, cy: o.cy, n: 0 }; s.bats.push(nb)
  const r = roleName ? ROLES.findIndex(q => q.name === roleName) : -1; let moved = 0
  for (let i = 0; i < s.N; i++) if (s.alive[i] && s.bat[i] === b && (r >= 0 ? s.role[i] === r : (i & 1))) { s.bat[i] = nb.id; moved++ }
  return moved ? nb.id : -1
}

function think(s) { // battalion level: centroids and a plain attack-move for battalions nobody ordered
  for (const o of s.bats) { o.cx = 0; o.cy = 0; o.n = 0 }
  for (let i = 0; i < s.N; i++) if (s.alive[i]) { const o = s.bats[s.bat[i]]; o.cx += s.x[i]; o.cy += s.y[i]; o.n++ }
  for (const o of s.bats) if (o.n) { o.cx /= o.n; o.cy /= o.n }
  for (const o of s.bats) if (o.n && !o.order) {
    let best = null, bd = Infinity
    for (const q of s.bats) if (q.n && q.side !== o.side) { const d = (q.cx - o.cx) ** 2 + (q.cy - o.cy) ** 2; if (d < bd) { bd = d; best = q } }
    if (best) { o.tx = best.cx; o.ty = best.cy }
  }
}

export function step(s) {
  s.tick++
  if (s.tick % 10 === 1) think(s)
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
        const dx = x[i] - x[j], dy = y[i] - y[j], d2 = dx * dx + dy * dy
        if (d2 < SEP * SEP && d2 > 0.01) { const k = ROLES[role[j]].push / d2 / R.push; sx += dx * k; sy += dy * k }
        if (side[j] !== side[i] && d2 < fd) { fd = d2; foe = j }
      }
    const o = s.bats[bat[i]]
    let tx, ty, v = R.speed
    if (foe >= 0) {
      tx = x[foe]; ty = y[foe]
      if (s.flank && R.name === 'runner' && fd > REACH * REACH * 4) { // runners swing round: aim at the far side of the foe, on the side set by their number
        const dx = tx - x[i], dy = ty - y[i], d = Math.sqrt(dx * dx + dy * dy) || 1, sgn = i & 2 ? 1 : -1
        tx += (-dy / d * sgn + dx / d) * 18; ty += (dx / d * sgn + dy / d) * 18
      }
      if (fd < REACH * REACH) dmg[foe] += R.dmg * (side[foe] ? 1 : 1)
    } else {
      const ddx = o.tx - x[i], ddy = o.ty - y[i], dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1, off = Math.sqrt((o.cx - x[i]) ** 2 + (o.cy - y[i]) ** 2)
      tx = x[i] + ddx / dd * 50 + (o.cx - x[i]) * (off > 60 ? 0.4 : 0.02); ty = y[i] + ddy / dd * 50 + (o.cy - y[i]) * (off > 60 ? 0.4 : 0.02)
      if (R.name === 'runner' && off < 90) v = ROLES[1].speed * 0.9 // runners keep to the battalion's pace until they see the enemy
      if (dd < 8) v = 0
    }
    const dx = tx - x[i], dy = ty - y[i], d = Math.sqrt(dx * dx + dy * dy) || 1
    vx[i] = dx / d * v * (foe >= 0 && fd < REACH * REACH ? 0.2 : 1) + sx * 6; vy[i] = dy / d * v * (foe >= 0 && fd < REACH * REACH ? 0.2 : 1) + sy * 6
  }
  for (let i = 0; i < N; i++) if (alive[i]) {
    hp[i] -= dmg[i]
    if (hp[i] <= 0) { alive[i] = 0; continue }
    x[i] = Math.min(W - 1, Math.max(0, x[i] + vx[i])); y[i] = Math.min(H - 1, Math.max(0, y[i] + vy[i]))
  }
}

export const count = s => { const n = [0, 0]; for (let i = 0; i < s.N; i++) if (s.alive[i]) n[s.side[i]]++; return n }
export const hash = s => { let h = 2166136261 >>> 0; for (let i = 0; i < s.N; i++) { h = Math.imul(h ^ (s.alive[i] ? (s.x[i] * 16) | 0 : -1), 16777619) >>> 0; h = Math.imul(h ^ ((s.y[i] * 16) | 0), 16777619) >>> 0 } return h }
