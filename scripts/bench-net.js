// Bytes per second each browser receives over one 5-minute house match: unit frames at 10 Hz plus the board meta once a second.
// Usage: node scripts/bench-net.js [seed] [house level side 0] [side 1]. Default hard vs hard, seed 1: lasts the full 5 minutes. "deflated" = each message compressed alone (what permessage-deflate does at worst).
import { deflateRawSync } from 'node:zlib'
import { createMatch, applyInput, step, HOUSE } from '../sim.js'
import { createMirror, encodeFrame, board } from '../wire.js'

const [seed, a, b] = [Number(process.argv[2] || 1), process.argv[3] || 'hard', process.argv[4] || 'hard'], s = createMatch(seed, { minutes: 5, planets: 17 })
applyInput(s, 0, { gambits: HOUSE[a] }); applyInput(s, 1, { gambits: HOUSE[b] })
const mirrors = [createMirror(), createMirror()], raw = [0, 0], zipped = [0, 0], peak = [0, 0], units = [0, 0]
let frames = 0
while (!s.ended) {
  for (const side of [0, 1]) {
    const f = encodeFrame(s, side, mirrors[side]); let bytes = f.length, z = deflateRawSync(f).length
    if (frames % 10 === 0) { const meta = Buffer.from(JSON.stringify({ t: 'meta', board: board(s, side) })); bytes += meta.length; z += deflateRawSync(meta).length }
    raw[side] += bytes; zipped[side] += z; peak[side] = Math.max(peak[side], frames ? f.length : 0); units[side] += mirrors[side].n
  }
  frames++; step(s); step(s)
}
const kbs = b => (b / frames * 10 / 1024).toFixed(1)
console.log(`${a} vs ${b}, seed ${seed}: ${frames} frames, ${(s.tick / 20) | 0} s, ended ${s.ended.reason}`)
for (const side of [0, 1]) console.log(`side ${side}: ${units[side] / frames | 0} units sent on average; ${kbs(raw[side])} KB/s raw, ${kbs(zipped[side])} KB/s deflated, largest frame after join ${(peak[side] / 1024).toFixed(1)} KB`)
