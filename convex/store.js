import { internalQueryGeneric, internalMutationGeneric } from 'convex/server'
import { v } from 'convex/values'

const record = (ctx, key) => ctx.db.query('records').withIndex('by_key', q => q.eq('key', key)).unique()
const unexpired = (r, now) => r && (!r.expiresAt || r.expiresAt > now) ? r.value : null

// Internal only: deployment-admin authorization, never callable by browser users.
export const get = internalQueryGeneric({
  args: { key: v.string(), now: v.number() },
  handler: async (ctx, { key }) => unexpired(await record(ctx, key), Date.now()),
})

export const commit = internalMutationGeneric({
  args: { entries: v.array(v.object({ key: v.string(), raw: v.union(v.string(), v.null()), value: v.string(), ttl: v.number() })) },
  handler: async (ctx, { entries }) => {
    if (new Set(entries.map(e => e.key)).size !== entries.length) throw new Error('Duplicate transaction keys')
    const now = Date.now(), rows = await Promise.all(entries.map(e => record(ctx, e.key)))
    // Compare every guard before any writes. Convex retries serialization conflicts.
    for (let i = 0; i < entries.length; i++) if (unexpired(rows[i], now) !== entries[i].raw) return 0
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      if (e.value === '') continue // read-only guard; do not refresh its TTL
      if (!Number.isFinite(e.ttl) || e.ttl < 0) throw new Error('Invalid TTL')
      const value = { key: e.key, value: e.value, expiresAt: e.ttl ? now + e.ttl * 1000 : 0 }
      if (rows[i]) await ctx.db.replace(rows[i]._id, value)
      else await ctx.db.insert('records', value)
    }
    return 1
  },
})

export const expire = internalMutationGeneric({
  args: {},
  handler: async ctx => {
    const rows = await ctx.db.query('records').withIndex('by_expiry', q => q.gt('expiresAt', 0).lte('expiresAt', Date.now())).take(128)
    for (const r of rows) await ctx.db.delete(r._id)
    return rows.length
  },
})
