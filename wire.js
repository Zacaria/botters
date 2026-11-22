// Fog transport: what one side may see, as corrections to the predicted position. Layout: DESIGN.md "Fog transport".
// The server keeps one mirror per connection and decodes its own frames into it, so both ends always agree.
import { MAXPER, live, fighting } from './sim.js'

const N = 2 * MAXPER, Q = 4 // positions travel in quarter pixels
const SIGHT_BAT = 150 ** 2, SIGHT_PLANET = 80 ** 2 // same rule as sim.visible

export function createMirror() {
  return { reset: true, side: 0, tick: 0, n: 0, has: new Uint8Array(N), x: new Int32Array(N), y: new Int32Array(N), px: new Int32Array(N), py: new Int32Array(N), role: new Uint8Array(N), bat: new Uint16Array(N) }
}
const own = (side, i) => (i < MAXPER ? 0 : 1) === side

// sim.visible for every unit of one frame, with the battalion and planet list read once.
export function sight(s, side) {
  const bats = live(s, side).map(b => [b.cx, b.cy]), planets = s.planets.filter(p => p.owner === side).map(p => [p.x, p.y])
  return (x, y) => bats.some(([bx, by]) => (bx - x) ** 2 + (by - y) ** 2 <= SIGHT_BAT) || planets.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 <= SIGHT_PLANET)
}

function writer() {
  let b = new Uint8Array(4096), n = 0
  const room = k => { if (n + k > b.length) { const c = new Uint8Array(Math.max(b.length * 2, n + k)); c.set(b); b = c } }
  return {
    u8(v) { room(1); b[n++] = v & 255 },
    u16(v) { room(2); b[n++] = v & 255; b[n++] = (v >> 8) & 255 },
    varint(v) { room(5); while (v > 127) { b[n++] = (v & 127) | 128; v >>>= 7 } b[n++] = v },
    gaps(list, each) { this.varint(list.length); let last = -1; for (const i of list) { this.varint(i - last - 1); last = i; each?.(i) } },
    done: () => b.slice(0, n),
  }
}

// Encode the state for `side` against the mirror (which must be this connection's), then decode it into the mirror.
export function encodeFrame(s, side, m) {
  const reset = m.reset, seen = sight(s, side), w = writer(), removals = [], moves = [], births = [], rebats = []
  const has = i => !reset && m.has[i]
  for (let i = 0; i < N; i++) {
    const mine = own(side, i), vis = s.alive[i] && (mine || seen(s.x[i], s.y[i]))
    if (!vis) { if (has(i)) removals.push(i); continue }
    if (!has(i)) { births.push(i); continue }
    const qx = Math.round(s.x[i] * Q), qy = Math.round(s.y[i] * Q), dx = qx - (2 * m.x[i] - m.px[i]), dy = qy - (2 * m.y[i] - m.py[i])
    if (dx < -127 || dx > 127 || dy < -127 || dy > 127 || m.role[i] !== s.role[i]) { removals.push(i); births.push(i); continue }
    moves.push(dx, dy)
    if (mine && m.bat[i] !== s.bat[i]) rebats.push(i)
  }
  w.u8((reset ? 1 : 0) | side << 1); w.varint(s.tick)
  w.gaps(removals)
  for (const d of moves) w.u8(d)
  w.gaps(births, i => { w.varint(own(side, i) ? s.bat[i] * 4 + s.role[i] : s.role[i]); w.u16(Math.round(s.x[i] * Q)); w.u16(Math.round(s.y[i] * Q)) })
  w.gaps(rebats, i => w.varint(s.bat[i]))
  w.varint((reset ? 0 : m.n) - removals.length + births.length)
  const bytes = w.done()
  decodeFrame(bytes, m)
  return bytes
}

// Apply one frame to a mirror. Throws on a malformed frame or a count mismatch: the caller then asks for a resync.
export function decodeFrame(bytes, m) {
  let p = 0
  const u8 = () => { if (p >= bytes.length) throw new Error('short frame'); return bytes[p++] }
  const varint = () => { let v = 0, k = 0, b; do { b = u8(); v += (b & 127) * 2 ** k; k += 7 } while (b & 128 && k < 35); return v }
  const index = (last) => { const i = last + 1 + varint(); if (i >= N) throw new Error('bad unit index'); return i }
  const flags = u8()
  if (flags & 1) { m.has.fill(0); m.n = 0 }
  m.reset = false; m.side = flags >> 1 & 1; m.tick = varint()
  for (let k = varint(), i = -1; k > 0; k--) { i = index(i); if (!m.has[i]) throw new Error('removing a unit not in the mirror'); m.has[i] = 0; m.n-- }
  for (let i = 0; i < N; i++) if (m.has[i]) {
    const dx = u8() << 24 >> 24, dy = u8() << 24 >> 24, gx = 2 * m.x[i] - m.px[i], gy = 2 * m.y[i] - m.py[i]
    m.px[i] = m.x[i]; m.py[i] = m.y[i]; m.x[i] = gx + dx; m.y[i] = gy + dy
  }
  for (let k = varint(), i = -1; k > 0; k--) {
    i = index(i); if (m.has[i]) throw new Error('birth of a unit already in the mirror')
    const kind = varint()
    m.has[i] = 1; m.n++; m.role[i] = kind & 3; m.bat[i] = own(m.side, i) ? kind >>> 2 : 0
    m.x[i] = m.px[i] = u8() | u8() << 8; m.y[i] = m.py[i] = u8() | u8() << 8
  }
  for (let k = varint(), i = -1; k > 0; k--) { i = index(i); if (!m.has[i] || !own(m.side, i)) throw new Error('bad battalion change'); m.bat[i] = varint() }
  if (varint() !== m.n || p !== bytes.length) throw new Error('frame does not match the mirror')
  return m
}

// What the browser knows about battalions and planets, sent on the meta channel (positions come from frames).
export function board(s, side) {
  const n = [0, 0]; for (let i = 0; i < s.N; i++) if (s.alive[i]) n[s.side[i]]++
  const pl = [0, 1].map(k => s.planets.filter(p => p.owner === k).length)
  return {
    endTick: s.endTick, ended: s.ended ? { reason: s.ended.reason, result: s.ended.winner === null ? 'draw' : s.ended.winner === side ? 'won' : 'lost' } : null,
    totals: { you: n[side], enemy: n[1 - side], planets: { you: pl[side], enemy: pl[1 - side] } },
    bats: live(s, side).map(b => ({ id: b.id, manual: b.manual, rule: b.rule, tx: b.tx, ty: b.ty, via: b.via, fighting: fighting(s, b) })),
    planets: s.planets.map(p => ({ id: p.id, x: p.x, y: p.y, r: p.r, owner: p.owner, prog: p.prog, by: p.by })),
  }
}
// Battalions appearing, disappearing or changing control: meta goes out at once rather than within a second.
export const boardKey = b => b.bats.map(o => `${o.id}${o.manual ? 'h' : ''}`).join()
