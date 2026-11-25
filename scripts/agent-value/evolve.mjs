// Shared mutation for search.mjs and counter.mjs. A genome is { gambits } (full matches) or { gambits, breed } (rounds mode).
// Without a breed the random sequence is the one the pre-rounds raw logs were produced with.
import { CONDITIONS, ACTIONS, BREEDS, describe } from '../../sim.js'

const COND = Object.keys(CONDITIONS), ACT = Object.keys(ACTIONS)
const P = { bigger_enemy_near: [1, 1.3, 2, 3], planet_attacked: [150, 250, 350, 500, 800], ally_fighting: [200, 300, 450, 700, 1200], weaker_enemy_near: [0.5, 0.8, 1, 1.5, 3, 10], small: [40, 80, 120, 200, 400], big: [200, 400, 600, 900, 1500], free_planet: [200, 400, 700, 2000], enemy_planet: [200, 400, 700, 2000], always: [undefined] }
export const text = g => `${g.breed ? `${g.breed}: ` : ''}${g.gambits.map(describe).join(' · ')}`
export const side = (g, round) => round ? { gambits: g.gambits, breed: g.breed } : { gambits: g.gambits }
export function mutator(seed) {
  let rng = seed
  const rand = () => (rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 4294967296
  const pick = a => a[Math.floor(rand() * a.length)]
  const randRule = () => { const c = pick(COND), p = pick(P[c]); return { if: c, then: pick(ACT), ...(p !== undefined && { p }) } }
  return function mutate(genome) {
    const g = structuredClone(genome)
    if (g.breed && rand() < 0.3) { g.breed = pick(BREEDS.filter(b => b !== g.breed)); return g } // rounds: a third of mutations change the army
    const l = g.gambits, n = 1 + (rand() < 0.4)
    for (let k = 0; k < n; k++) {
      const i = Math.floor(rand() * l.length), m = rand()
      if (m < 0.3 && l[i].if !== 'always') { const p = pick(P[l[i].if]); if (p !== undefined) l[i].p = p }
      else if (m < 0.45) l[i].then = pick(ACT)
      else if (m < 0.6) { const c = pick(COND), p = pick(P[c]); l[i] = { if: c, then: l[i].then, ...(p !== undefined && { p }) } }
      else if (m < 0.78 && l.length < 10) l.splice(Math.floor(rand() * (l.length + 1)), 0, randRule())
      else if (m < 0.9 && l.length > 2) l.splice(i, 1)
      else if (l.length > 1) { const j = Math.min(l.length - 1, i + 1), t = l[i]; l[i] = l[j]; l[j] = t }
    }
    return g
  }
}
