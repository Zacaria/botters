// node scripts/agent-value/rounds3-report.mjs <run dir> [<run dir> ...]
// RESULTS.md §6 tables from rounds-bench logs (seed-N.log.json): match wins, then rounds won split by
// (a) whether the agent's main role is the predator / prey / same as the house's main role, and
// (b) how many race-aware rules (who or vs) the agent's locked bot used.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BREEDS } from '../../sim.js'
import { PREDATOR } from './rounds.mjs'

const main = army => { const best = Math.max(...BREEDS.map(b => army[b] ?? 0)), top = BREEDS.filter(b => (army[b] ?? 0) === best); return top.length === 1 ? top[0] : null }
for (const dir of process.argv.slice(2)) {
  const logs = readdirSync(dir).filter(f => /^seed-\d+\.log\.json$/.test(f)).map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')))
  const tally = {}, add = (k, won) => { const t = tally[k] ??= [0, 0]; t[0] += won; t[1]++ }
  let wins = 0
  for (const m of logs) {
    if (m.winner === 0) wins++
    for (const p of m.pauses) {
      if (!p.result || !p.locked) continue
      const won = p.result.winner === 0 ? 1 : p.result.winner === null ? 0.5 : 0
      const a = main(p.locked.army), h = main(p.houseBot.army)
      add(`army: ${!a || !h ? 'no single main role' : a === PREDATOR[h] ? 'agent main role = predator of house main role' : h === PREDATOR[a] ? 'agent main role = prey of house main role' : 'same main role'}`, won)
      const aware = p.locked.gambits.filter(r => r.who || r.vs).length
      add(`rules: ${aware === 0 ? '0 race-aware rules' : aware <= 2 ? '1-2 race-aware rules' : '3+ race-aware rules'}`, won)
    }
  }
  console.log(`${dir}: ${wins}/${logs.length} match wins`)
  for (const [k, [w, n]] of Object.entries(tally).sort()) console.log(`  ${k}: ${w}/${n} rounds won`)
}
