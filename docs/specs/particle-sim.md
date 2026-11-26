# sim.js — particle war core (2026-11-21)

`sim.js` is the only simulation. It is plain JavaScript, imported unchanged by Node (`server.js`, `online/game.js`, the Worker bundle) and by the browser only for the lobby background demo and rule constants; matches run on the server alone. The rules are `spikes/particles/psim.js` (validated by Zacaria); the spike folder is deleted once `sim.js` carries them. Decision: `DESIGN.md`, "Particle war replaces the cohort model"; what browsers receive: "Fog transport".

## State

`createMatch(seed, options)` returns a plain object with psim's fields, unchanged names:
`seed, N, tick, rng, endTick, ended ({winner: 0|1|null, reason: 'wipe'|'time'|'surrender'} or null), x, y, vx, vy, hp (Float32Array), side, role, alive (Uint8Array), bat (Uint16Array), dmg, head, next (scratch), bats[], planets[]`,
plus `opts` (normalised options) and `gambits` (two rule lists; psim's `doctrine`, renamed).
`bats[k] = {id, side, tx, ty, manual, via, cx, cy, n, hit, rule, key, busy}`; `planets[k] = {id, x, y, r, owner (-1|0|1), prog, by, acc, pres}`.
Unit `i` belongs to side `i < MAXPER ? 0 : 1`. Determinism uses only `+ - * / Math.sqrt Math.min Math.max Math.imul` and the seeded `rnd`.

## Exports

| Export | Contract |
|---|---|
| `W, H, TPS, ROLES, MAXPER, MAXBATS, THINK, MAX_GAMBITS (10)` | constants |
| `CONDITIONS, ACTIONS, checkGambits(list)` | rule catalogue (`{doc, p}`), returns an error string or null |
| `DOCTRINES = {pincer, flanker, blob, cautious}`, `DEFAULT_GAMBITS = DOCTRINES.flanker` | |
| `HOUSE = {easy: cautious, normal: flanker, hard: pincer}`, `HOUSE_DOCTRINE = {easy: 'cautious', normal: 'flanker', hard: 'pincer'}` | house bots |
| `OPTIONS = {minutes: [3, 5, 8], planets: [9, 17, 25]}`, `matchOptions(o)` | defaults 5 min, 17 planets |
| `createMatch(seed, options)` | both sides start with `DEFAULT_GAMBITS`, 3 battalions of 400 |
| `applyInput(s, side, input) → {ok, error?, bat?}` | exactly one key: `gambits`, `toggle` (rule index), `order {bat, x, y}`, `flank` (bat), `detach {bat, role?}` (returns new `bat`), `release` (bat), `surrender: true`. Rejects foreign/dead battalions with an error listing the side's live battalions. |
| `step(s)`, `advanceTo(s, tick)` | |
| `replay(seed, log, opts)` | log entries `{tick, side, input}`, applied at `s.tick === tick` before stepping |
| `hash(s)` | FNV over alive, x, y (psim) plus tick and planet owners |
| `snapshot(s) → json`, `restore(json) → s` | JSON-safe; typed arrays of alive units as base64; `restore(snapshot(s))` steps identically to `s` |
| `count(s)`, `owned(s)` | `[n0, n1]` units / planets |
| `visible(s, side, x, y)` | fog: within 150 of an own battalion centre or 80 of an own planet |
| `view(s, side)` | agent view, fogged: `{tick, secondsLeft, ended: {reason, result: 'won'|'draw'|'lost'} \| null, totals: {you, enemy, planets: {you, enemy}}, battalions: [{id, x, y, n, roles: {runner, grunt, tank}, tx, ty, manual, rule, ruleText, fighting}], enemies: [{id, x, y, n, fighting}], planets: [{id, x, y, r, owner: 'you'|'enemy'|null, capture}], gambits, perRule}`. `ruleText` is the active rule (null when held by hand or no rule matches); `perRule[k]` counts the battalions following gambit k |
| `rules()`, `describe(rule)` | catalogue for agents, one-line rule text |
| `changes(before, after)` | one line naming what a gambit edit changed (`rule 3 off: …`, `IF … → go: p 350 → 130`, `- IF …; + IF …`, `reordered`, `no change`; an explicit default `p` is no change); servers store it in each player's `edits` |

## Match results

The result screen explains surrender, wipe or time in plain language. Share only the result and unit totals, never a room link or private match data. Room rematches keep the two players together.
