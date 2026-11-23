// Do scripted mid-match edits beat a fixed set? Each controller plays the fixed set on the same seeds, both sides,
// next to the control (the controller's opening set left unchanged).
// node scripts/agent-value/oracle.mjs <seeds> <opponentSet> <threads> <out.json> '<json array of {name, gambits?: set, script?, arg?}>'
import { writeFileSync } from 'node:fs'
import { duel } from './arena.mjs'
import { SETS } from './strategies.mjs'
const seeds = Array.from({ length: +process.argv[2] || 8 }, (_, i) => 2000 + i), opp = process.argv[3], threads = +process.argv[4] || 2, out = process.argv[5]
const ctrls = JSON.parse(process.argv[6])
const rows = []
for (const c of ctrls) {
  const side = { gambits: SETS[c.gambits], ...(c.script && { script: c.script, arg: c.arg }) }
  const d = await duel(side, { gambits: SETS[opp] }, seeds, { threads })
  const edits = d.res.map((r, i) => r.edits[i % 2]), row = { name: c.name, vs: opp, win: d.win, loss: d.loss, draw: d.draw, score: +d.score.toFixed(2), editsMean: +(edits.reduce((a, b) => a + b, 0) / edits.length).toFixed(1), perMatch: d.res.map((r, i) => ({ seed: r.seed, side: i % 2, won: r.winner === null ? 0.5 : +(r.winner === i % 2), t: r.t, reason: r.reason })) }
  rows.push(row); console.log(JSON.stringify({ ...row, perMatch: undefined }))
}
if (out) writeFileSync(out, JSON.stringify(rows, null, 1))
