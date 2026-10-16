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
  args: { keys: v.array(v.string()), now: v.number(), followToken: v.optional(v.boolean()) },
  handler: async (ctx, { keys, followToken }) => {
    const now = Date.now(), values = await Promise.all(keys.map(key => read(ctx, key, now)))
    if (!followToken) return values
    const namespace = /^(.*)token:[a-f0-9]{64}$/.exec(keys[0])?.[1], auth = values[0] && JSON.parse(values[0])
    if (namespace && auth) {
      keys.push(`${namespace}session:${auth.id}`); values.push(await read(ctx, keys.at(-1), now))
      const session = values.at(-1) && JSON.parse(values.at(-1))
      if (session?.match) { keys.push(`${namespace}match:${session.match}`); values.push(await read(ctx, keys.at(-1), now)) }
    }
    return { keys, values }
  },
})

// Internal server subscription: expiry is explicit so cached reads never extend
// a capability past a document's TTL, even without a database invalidation.
export const watch = internalQueryGeneric({
  args: { key: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, { key }) => {
    const keys = [], values = [], expiries = [], now = Date.now()
    const add = async key => {
      const row = await record(ctx, key)
      keys.push(key); values.push(unexpired(row, now))
      if (row?.expiresAt > now) expiries.push(row.expiresAt)
    }
    await add(key)
    const namespace = /^(.*)token:[a-f0-9]{64}$/.exec(key)?.[1], auth = values[0] && JSON.parse(values[0])
    if (namespace && auth) {
      await add(`${namespace}session:${auth.id}`)
      const session = values.at(-1) && JSON.parse(values.at(-1))
      if (session?.match) await add(`${namespace}match:${session.match}`)
    }
    return { keys, values, expiresAt: expiries.length ? Math.min(...expiries) : now + 50000 }
  },
})

// Read-only release gate: never returns player data or replays/writes a match.
export const legacyActivity = internalQueryGeneric({
  args: { prefix: v.string() },
  handler: async (ctx, { prefix }) => {
    const rows = await ctx.db.query('records').withIndex('by_key', q => q.gte('key', `${prefix}match:`).lt('key', `${prefix}match;`)).take(257)
    const now = Date.now(); let activeMatches = 0, latestActiveEndAt = 0, complete = rows.length < 257
    for (const row of rows) {
      if (row.expiresAt && row.expiresAt <= now) continue
      let m
      try { m = JSON.parse(row.value) } catch { complete = false; continue }
      if (!m || !Number.isFinite(m.startsAt) || !Number.isFinite(m.s?.endTick)) { complete = false; continue }
      const endAt = m.startsAt + m.s.endTick / 20 * 1000
      if (!m.s.ended && endAt > now) { activeMatches++; latestActiveEndAt = Math.max(latestActiveEndAt, endAt) }
    }
    return { activeMatches, latestActiveEndAt, complete, scanned: rows.length }
  },
})

// Capability-only subscription for the long-lived service. Never follows a match.
export const authorize = internalQueryGeneric({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const now = Date.now(), row = await record(ctx, key), token = unexpired(row, now)
    const auth = token && JSON.parse(token), namespace = /^(.*)token:[a-f0-9]{64}$/.exec(key)?.[1]
    const owner = auth && namespace ? await record(ctx, `${namespace}session:${auth.id}`) : null
    const session = unexpired(owner, now)
    const expiries = [row?.expiresAt, owner?.expiresAt, auth?.expires].filter(e => e > 0)
    return { token, session, expiresAt: expiries.length ? Math.min(...expiries) : now + 60000 }
  },
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
