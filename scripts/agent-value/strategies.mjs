// Named rule sets and scripted controllers for the offline arena.
import { DOCTRINES } from '../../sim.js'
const r = (cond, then, p) => ({ if: cond, then, ...(p !== undefined && { p }) })

export function RICH(k) {
  const prey = { ...r('enemy_near', 'go', 400), vs: 'prey' }, predator = { ...r('enemy_near', 'retreat', 150), vs: 'predator' }
  return [...(k >= 4 ? [r('planet_attacked', 'go')] : []), prey, ...(k >= 5 ? [predator] : []), ...(k >= 6 ? [r('weaker_enemy_near', 'go', 3)] : []), r('free_planet', 'go'), r('enemy_planet', 'go'), ...(k >= 7 ? [r('always', 'hold')] : [])]
}

export const SETS = {
  ...Object.fromEntries([3, 4, 5, 6, 7].map(k => [`rich${k}`, RICH(k)])), // race-targeting rules sized for k slots (rounds mode)
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
const PREY = { runner: 'tank', tank: 'grunt', grunt: 'runner' } // each breed beats its prey (sim.js counter triangle)
export const SCRIPTS = {
  // open with one set, switch to another at a fixed time
  phase: (v, m, a) => { if (!m.done && elapsed(v) >= a.at) { m.done = true; return SETS[a.then] } return null },
  // when the planet count says we lead / trail, switch set; switch back when even
  lead: (v, m, a) => {
    const d = v.totals.planets.you - v.totals.planets.enemy, want = d >= a.margin ? a.ahead : d <= -a.margin ? a.behind : a.base
    if (want === m.cur || (m.cur === undefined && want === a.base)) { m.cur = want; return null }
    m.cur = want; return SETS[want]
  },
  // breed the counter of what we see: score(b) = share of visible enemy units b beats − share that beats b.
  // Switches at most every a.gap seconds, only once a.min enemy units are in sight. This is what an agent can do by reading get_state.
  counter: (v, m, a = {}) => {
    const roles = { runner: 0, grunt: 0, tank: 0 }; for (const e of v.enemies) for (const k in roles) roles[k] += e.roles[k]
    const total = roles.runner + roles.grunt + roles.tank, t = elapsed(v)
    if (total < (a.min ?? 30) || t - (m.at ?? -1e9) < (a.gap ?? 5)) return null
    const score = b => roles[PREY[b]] - roles[PREY[PREY[b]]], best = ['runner', 'grunt', 'tank'].reduce((x, y) => score(y) > score(x) ? y : x)
    if (best === v.breed || score(best) <= score(v.breed)) return null
    m.at = t; return { breed: best }
  },
  // one step ahead of a re-countering house: guess the breed it picks against our own army, breed what beats that guess
  outguess: (v, m, a = {}) => {
    const mine = { runner: 0, grunt: 0, tank: 0 }; for (const b of v.battalions) for (const k in mine) mine[k] += b.roles[k]
    const seen = v.enemies.reduce((n, e) => n + e.n, 0), t = elapsed(v)
    if (seen < (a.min ?? 30) || t - (m.at ?? -1e9) < (a.gap ?? 5)) return null
    const score = b => mine[PREY[b]] - mine[PREY[PREY[b]]], guess = ['runner', 'grunt', 'tank'].reduce((x, y) => score(y) > score(x) ? y : x)
    const best = PREY[PREY[guess]] // the breed whose prey is `guess`
    if (best === v.breed) return null
    m.at = t; return { breed: best }
  },
  // blind control: rotate the breed every a.every seconds without looking
  cycle: (v, m, a = {}) => { const k = Math.floor(elapsed(v) / (a.every ?? 20)) % 3, b = ['grunt', 'tank', 'runner'][k]; return b === v.breed ? null : { breed: b } },
  // last `last` seconds: if we lead on planets, defend; if we trail, attack enemy planets
  endgame: (v, m, a) => {
    if (m.done || v.secondsLeft > a.last) return null
    m.done = true; const d = v.totals.planets.you - v.totals.planets.enemy
    return d > 0 ? SETS[a.ahead] : d < 0 ? SETS[a.behind] : null
  },
}
export { r }
