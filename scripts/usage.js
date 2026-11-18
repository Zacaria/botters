import { ConvexStore } from '../online/store.js'

if (!process.env.CONVEX_URL || !process.env.CONVEX_DEPLOY_KEY) {
  console.error('CONVEX_URL and CONVEX_DEPLOY_KEY are required.')
  process.exitCode = 1
} else {
  try {
    const store = new ConvexStore(), prefix = `botters:${process.env.BOTTERS_NAMESPACE || 'production'}:`
    const result = await store.call('query', 'usage:weekly', { prefix })
    const columns = ['Week', 'Signups', 'Online', 'Agent (MCP)', 'House', 'Returning']
    const rows = result.weeks.map(w => [new Date(w.start).toISOString().slice(0, 10), w.signups, w.online, w.agent, w.house, w.returning].map(String))
    const widths = columns.map((c, i) => Math.max(c.length, ...rows.map(row => row[i].length)))
    const line = row => row.map((cell, i) => i ? cell.padStart(widths[i]) : cell.padEnd(widths[i])).join(' | ')
    console.log(line(columns))
    for (const row of rows) console.log(line(row))
    console.log(result.matchesSince === null ? 'No match recorded yet' : `Match counts start ${new Date(result.matchesSince).toISOString().slice(0, 10)}`)
  } catch {
    console.error('Unable to retrieve usage counts.')
    process.exitCode = 1
  }
}
