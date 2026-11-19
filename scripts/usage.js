import { execFileSync } from 'node:child_process'

// Only counts are printed; identifiers returned by D1 stay in this process.
const sql = `SELECT 'user' AS kind, id, createdAt AS created, NULL AS updated, emailVerified AS verified, NULL AS value FROM "user"
UNION ALL SELECT 'session', userId, createdAt, updatedAt, NULL, NULL FROM "session"
UNION ALL SELECT 'match', NULL, NULL, NULL, NULL, value FROM game_records WHERE key LIKE 'usage:%'`
try {
  const result = JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'botters-play', '--remote', '--json', '--command', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  const rows = result.flatMap(r => r.results || [])
  const date = new Date(), day = 86400000, weekMs = 7 * day
  const monday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - (date.getUTCDay() + 6) % 7)
  const weeks = Array.from({length: 8}, (_, i) => ({start: monday - (7 - i) * weekMs, signups: 0, online: 0, agent: 0, house: 0, returning: 0}))
  const active = weeks.map(() => new Set()), users = new Map(), index = at => Math.floor((at - weeks[0].start) / weekMs)
  const timestamp = v => typeof v === 'number' ? (v < 1e11 ? v * 1000 : v) : Date.parse(v)
  for (const row of rows) if (row.kind === 'user') {
    const created = timestamp(row.created); users.set(row.id, created)
    const i = index(created); if (weeks[i] && row.verified) weeks[i].signups++
  }
  let matchesSince = null
  for (const row of rows) {
    if (row.kind === 'session') for (const at of [timestamp(row.created), timestamp(row.updated)]) { const i = index(at); if (active[i]) active[i].add(row.id) }
    if (row.kind === 'match') {
      const match = JSON.parse(row.value), i = index(match.at)
      matchesSince = matchesSince === null ? match.at : Math.min(matchesSince, match.at)
      if (!weeks[i]) continue
      weeks[i][match.online ? 'online' : 'house']++
      if (match.agent) weeks[i].agent++
    }
  }
  weeks.forEach((week, i) => { for (const id of active[i]) if (users.has(id) && users.get(id) < week.start) week.returning++ })
  const columns = ['Week', 'Signups', 'Online', 'Agent (MCP)', 'House', 'Returning']
  const table = weeks.map(w => [new Date(w.start).toISOString().slice(0, 10), w.signups, w.online, w.agent, w.house, w.returning].map(String))
  const widths = columns.map((c, i) => Math.max(c.length, ...table.map(row => row[i].length)))
  const line = row => row.map((cell, i) => i ? cell.padStart(widths[i]) : cell.padEnd(widths[i])).join(' | ')
  console.log(line(columns)); for (const row of table) console.log(line(row))
  console.log(matchesSince === null ? 'No match recorded yet' : `Match counts start ${new Date(matchesSince).toISOString().slice(0, 10)}`)
} catch { console.error('Unable to retrieve usage counts.'); process.exitCode = 1 }
