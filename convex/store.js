import { internalQueryGeneric, internalMutationGeneric } from 'convex/server'
import { v } from 'convex/values'
import { boardNamespace, ratingKey } from '../online/ratings.js'

const record = (ctx, key) => ctx.db.query('records').withIndex('by_key', q => q.eq('key', key)).unique()
const unexpired = (r, now) => r && (!r.expiresAt || r.expiresAt > now) ? r.value : null
async function read(ctx, key, now) {
  const namespace = boardNamespace(key)
  if (namespace === null) return unexpired(await record(ctx, key), now)
  const rows = await ctx.db.query('records').withIndex('by_rating', q => q.eq('ratingNamespace', namespace)).take(12)
  return JSON.stringify(rows.map(r => [r.ratingIdentity, JSON.parse(r.value)]))
}

// Internal only: deployment-admin authorization, never callable by browser users.
export const get = internalQueryGeneric({
  args: { keys: v.array(v.string()), now: v.number() },
  handler: async (ctx, { keys }) => Promise.all(keys.map(key => read(ctx, key, Date.now()))),
})

export const commit = internalMutationGeneric({
  args: { entries: v.array(v.object({ key: v.string(), raw: v.union(v.string(), v.null()), value: v.string(), ttl: v.number() })) },
  handler: async (ctx, { entries }) => {
    if (new Set(entries.map(e => e.key)).size !== entries.length) throw new Error('Duplicate transaction keys')
    const now = Date.now(), rows = await Promise.all(entries.map(e => record(ctx, e.key)))
    // Compare every guard before any writes. Convex retries serialization conflicts.
    for (let i = 0; i < entries.length; i++) {
      const actual = boardNamespace(entries[i].key) === null ? unexpired(rows[i], now) : await read(ctx, entries[i].key, now)
      if (actual !== entries[i].raw) return 0
    }
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      if (e.value === '') continue // read-only guard; do not refresh its TTL
      if (boardNamespace(e.key) !== null) throw new Error('Leaderboard is read-only')
      if (!Number.isFinite(e.ttl) || e.ttl < 0) throw new Error('Invalid TTL')
      const value = { key: e.key, value: e.value, expiresAt: e.ttl ? now + e.ttl * 1000 : 0 }
      const rating = ratingKey(e.key)
      if (rating && e.ttl === 0) {
        value.ratingNamespace = rating[1]; value.ratingRank = -JSON.parse(e.value).rating; value.ratingIdentity = rating[2]
      }
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
