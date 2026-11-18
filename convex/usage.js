import { internalQueryGeneric } from 'convex/server'
import { v } from 'convex/values'
import { components } from './_generated/api.js'

const weekMs = 7 * 86400000
async function all(ctx, model) {
  const rows = []; let cursor = null, done = false
  while (!done) {
    const page = await ctx.runQuery(components.betterAuth.adapter.findMany, { model, paginationOpts: { cursor, numItems: 100 } })
    rows.push(...page.page); cursor = page.continueCursor; done = page.isDone
  }
  return rows
}

export const weekly = internalQueryGeneric({
  args: { prefix: v.string(), weeks: v.optional(v.number()), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now(), date = new Date(now)
    const monday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - (date.getUTCDay() + 6) % 7)
    const count = Math.max(1, Math.min(26, Math.floor(args.weeks ?? 8)))
    if (!Number.isFinite(count)) throw new Error('Invalid weeks')
    const weeks = Array.from({ length: count }, (_, i) => ({ start: monday - (count - i - 1) * weekMs, signups: 0, online: 0, agent: 0, house: 0, returning: 0 }))
    const active = weeks.map(() => new Set()), index = at => Math.floor((at - weeks[0].start) / weekMs)
    const [users, sessions, records] = await Promise.all([
      all(ctx, 'user'), all(ctx, 'session'),
      ctx.db.query('records').withIndex('by_key', q => q.gte('key', `${args.prefix}usage:`).lt('key', `${args.prefix}usage;`)).collect(),
    ])
    const created = new Map(users.map(u => [u._id, u.createdAt]))
    for (const user of users) { const i = index(user.createdAt); if (weeks[i] && user.emailVerified === true) weeks[i].signups++ }
    for (const session of sessions) for (const at of [session.createdAt, session.updatedAt]) { const i = index(at); if (weeks[i]) active[i].add(session.userId) }
    let matchesSince = null
    for (const row of records) {
      const match = JSON.parse(row.value), i = index(match.at)
      matchesSince = matchesSince === null ? match.at : Math.min(matchesSince, match.at)
      if (!weeks[i]) continue
      weeks[i][match.online ? 'online' : 'house']++
      if (match.agent) weeks[i].agent++
      for (const id of match.accounts) active[i].add(id)
    }
    weeks.forEach((week, i) => { for (const id of active[i]) if (created.has(id) && created.get(id) < week.start) week.returning++ })
    return { weeks, matchesSince }
  },
})
