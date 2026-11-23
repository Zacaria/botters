// Named rule sets and scripted controllers for the offline arena.
import { DOCTRINES } from '../../sim.js'
const r = (cond, then, p) => ({ if: cond, then, ...(p !== undefined && { p }) })

export const SETS = {
  ...DOCTRINES,
  // hand-written variants that isolate one DOCTRINE.md claim each
  rush: [r('weaker_enemy_near', 'go', 10), r('enemy_planet', 'go'), r('always', 'hold')], // attack everything, ignore free planets
  greedy: [r('free_planet', 'go'), r('planet_attacked', 'go'), r('weaker_enemy_near', 'go', 3), r('enemy_planet', 'go'), r('always', 'hold')], // expand first
  turtle: [r('planet_attacked', 'go', 800), r('free_planet', 'go', 400), r('always', 'hold')], // defend, small radius
  blobflank: [r('planet_attacked', 'go'), r('weaker_enemy_near', 'go', 3), r('bigger_enemy_near', 'flank', 1), r('free_planet', 'go'), r('enemy_planet', 'go'), r('always', 'hold')],
  blobmerge: [r('planet_attacked', 'go'), r('weaker_enemy_near', 'go', 3), r('small', 'go', 200), r('free_planet', 'go'), r('enemy_planet', 'go'), r('always', 'hold')],
}

// Scripted controllers: (view, memo, arg) → new gambits or null. Called once per second with the fogged agent view,
// i.e. they know only what a real agent knows. They stand for the best an editing agent could do with that trigger.
const elapsed = v => v.tick / 20
export const SCRIPTS = {
  // open with one set, switch to another at a fixed time
  phase: (v, m, a) => { if (!m.done && elapsed(v) >= a.at) { m.done = true; return SETS[a.then] } return null },
  // when the planet count says we lead / trail, switch set; switch back when even
  lead: (v, m, a) => {
    const d = v.totals.planets.you - v.totals.planets.enemy, want = d >= a.margin ? a.ahead : d <= -a.margin ? a.behind : a.base
    if (want === m.cur || (m.cur === undefined && want === a.base)) { m.cur = want; return null }
    m.cur = want; return SETS[want]
  },
  // last `last` seconds: if we lead on planets, defend; if we trail, attack enemy planets
  endgame: (v, m, a) => {
    if (m.done || v.secondsLeft > a.last) return null
    m.done = true; const d = v.totals.planets.you - v.totals.planets.enemy
    return d > 0 ? SETS[a.ahead] : d < 0 ? SETS[a.behind] : null
  },
}
export { r }
