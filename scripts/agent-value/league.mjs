// House difficulty calibration: replay the gambit timelines a real agent played in the live league
// (docs/agent-value/league-2026-11-26/timelines.json) against candidate house sets, 3-minute matches, each map from both sides.
// node scripts/agent-value/league.mjs <timelines.json> <set,set,...> [maps=16] [candidates.json: { name: gambits } tried as house sets]
// Prints, per house set, the agent timelines' score (wins + ½ draws) — lower means a harder house.
import { readFileSync } from 'node:fs'
import { run } from './arena.mjs'
import { SETS } from './strategies.mjs'
const [file, list, maps = 16, extra] = process.argv.slice(2)
if (extra) Object.assign(SETS, JSON.parse(readFileSync(extra, 'utf8')))
const timelines = Object.entries(JSON.parse(readFileSync(file, 'utf8'))).filter(([, m]) => m.calls.length)
const seeds = Array.from({ length: +maps }, (_, i) => i + 1)
for (const house of list.split(',')) {
  if (!SETS[house]) throw new Error(`unknown set ${house}`)
  const jobs = []
  for (const [, m] of timelines) {
    const [first, ...rest] = m.calls, agent = { gambits: first.gambits, script: 'timeline', arg: rest }
    for (const seed of seeds) { jobs.push({ seed, minutes: 3, planets: 17, sides: [agent, { gambits: SETS[house] }] }); jobs.push({ seed, minutes: 3, planets: 17, sides: [{ gambits: SETS[house] }, agent] }) }
  }
  const res = await run(jobs)
  let score = 0; res.forEach((r, i) => { const a = i % 2; score += r.winner === null ? 0.5 : r.winner === a ? 1 : 0 })
  console.log(JSON.stringify({ house, agentScore: +(score / res.length).toFixed(3), matches: res.length, timelines: timelines.length }))
}
