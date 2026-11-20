// node bench.mjs [seeds] — cost per tick, determinism, and whether doctrine changes who wins (each pairing plays both sides).
import { createMatch, step, count, owned, hash } from './psim.js'
const seeds = +process.argv[2] || 6
const play = (seed, doctrines) => {
  const s = createMatch(seed, { doctrines }), t0 = performance.now(); let worst = 0
  while (!s.ended) { const t = performance.now(); step(s); worst = Math.max(worst, performance.now() - t) }
  return { s, ms: (performance.now() - t0) / s.tick, worst }
}
const a = play(1, ['flanker', 'blob']), b = play(1, ['flanker', 'blob'])
console.log(`5 min match: ${a.ms.toFixed(1)} ms/tick avg, ${a.worst.toFixed(1)} worst · units at end ${count(a.s)} · planets ${owned(a.s)} · ${a.s.ended.reason} · same seed same hash: ${hash(a.s) === hash(b.s)}`)
for (const [x, y] of [['flanker', 'blob'], ['cautious', 'blob'], ['flanker', 'cautious']]) {
  const w = { [x]: 0, [y]: 0, draw: 0 }
  for (let seed = 1; seed <= seeds; seed++) for (const flip of [false, true]) {
    const d = flip ? [y, x] : [x, y], e = play(seed, d).s.ended
    w[e.winner === null ? 'draw' : d[e.winner]]++
  }
  console.log(`${x} vs ${y}:`, JSON.stringify(w))
}
