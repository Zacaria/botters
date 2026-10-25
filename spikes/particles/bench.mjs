import { createParticles, step, count, hash, TPS } from './psim.js'
const play = (seed, flank, secs = 90) => { const s = createParticles(seed, 3000, 6, flank); const t0 = performance.now(); let t = 0
  for (; t < secs * TPS; t++) { step(s); const [a, b] = count(s); if (!a || !b) break }
  return { s, ms: (performance.now() - t0) / (t + 1), secs: t / TPS, left: count(s) } }
const a = play(1, true), b = play(1, true)
console.log('worst case 3000 v 3000:', a.ms.toFixed(1), 'ms/tick avg; fight', a.secs, 's; left', a.left, '| same seed same hash:', hash(a.s) === hash(b.s))
for (const [name, flank] of [['mirror, flanking runners', true]]) { let w = [0, 0, 0]; for (let seed = 1; seed <= 8; seed++) { const r = play(seed, flank); w[r.left[0] > r.left[1] ? 0 : r.left[1] > r.left[0] ? 1 : 2]++ } console.log(name, 'side0/side1/draw over 8 seeds', w.join('/')) }
// does behaviour matter? side 1 without runners' flank can't be set per side, so compare whole-match flank on/off for side 0 advantage
let on = 0, off = 0; for (let seed = 1; seed <= 8; seed++) { const r1 = play(seed, true), r2 = play(seed, false); on += r1.left[0] - r1.left[1]; off += r2.left[0] - r2.left[1] }
console.log('mean (side0 - side1) left, flank on', on / 8 | 0, 'off', off / 8 | 0)
