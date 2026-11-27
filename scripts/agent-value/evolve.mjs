// Shared mutation for search.mjs and counter.mjs. A genome is { gambits } (full matches) or { gambits, army } (rounds mode).
import { CONDITIONS, ACTIONS, BREEDS, describe } from '../../sim.js'

const COND = Object.keys(CONDITIONS), ACT = Object.keys(ACTIONS)
const P = { bigger_enemy_near: [1, 1.3, 2, 3], planet_attacked: [150, 250, 350, 500, 800], ally_fighting: [200, 300, 450, 700, 1200], enemy_near: [150, 250, 400, 700, 1200], weaker_enemy_near: [0.5, 0.8, 1, 1.5, 3, 10], small: [40, 80, 120, 200, 400], big: [200, 400, 600, 900, 1500], free_planet: [200, 400, 700, 2000], enemy_planet: [200, 400, 700, 2000], always: [undefined] }
export const text = g => `${g.army ? `${BREEDS.map(b => g.army[b] ?? 0).join('-')}: ` : ''}${g.gambits.map(describe).join(' · ')}`
export const side = (g, round) => round ? { gambits: g.gambits, army: g.army } : { gambits: g.gambits }
export function mutator(seed) {
  let rng = seed
  const rand = () => (rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 4294967296
  const pick = a => a[Math.floor(rand() * a.length)]
  const enemy = c => ['bigger_enemy_near', 'weaker_enemy_near', 'enemy_near', 'ally_fighting'].includes(c)
  const targets = [...BREEDS, 'prey', 'predator']
  const randRule = () => { const c = pick(COND), p = pick(P[c]); return { if: c, then: pick(ACT), ...(p !== undefined && { p }), ...(rand() < 0.25 && { who: pick(BREEDS) }), ...(enemy(c) && rand() < 0.4 && { vs: pick(targets) }) } }
  return function mutate(genome) {
    const g = structuredClone(genome)
    if (g.army && rand() < 0.3) { const from = pick(BREEDS.filter(b => g.army[b] > 0)), to = pick(BREEDS.filter(b => b !== from)), n = Math.min(g.army[from], 1 + Math.floor(rand() * 3)); g.army[from] -= n; g.army[to] = (g.army[to] || 0) + n; return g }
    const l = g.gambits, n = 1 + (rand() < 0.4)
    for (let k = 0; k < n; k++) {
      const i = Math.floor(rand() * l.length), m = rand()
      if (m < 0.3 && l[i].if !== 'always') { const p = pick(P[l[i].if]); if (p !== undefined) l[i].p = p }
      else if (m < 0.45) l[i].then = pick(ACT)
      else if (m < 0.6) { const c = pick(COND), p = pick(P[c]); l[i].if = c; if (p === undefined) delete l[i].p; else l[i].p = p; if (!enemy(c)) delete l[i].vs }
      else if (m < 0.68) { const v = pick([...BREEDS, null]); if (v) l[i].who = v; else delete l[i].who }
      else if (m < 0.76 && enemy(l[i].if)) { const v = pick([...targets, null]); if (v) l[i].vs = v; else delete l[i].vs }
      else if (m < 0.84 && l.length < 10) l.splice(Math.floor(rand() * (l.length + 1)), 0, randRule())
      else if (m < 0.93 && l.length > 2) l.splice(i, 1)
      else if (l.length > 1) { const j = Math.min(l.length - 1, i + 1), t = l[i]; l[i] = l[j]; l[j] = t }
    }
    return g
  }
}
