import { internalMutationGeneric } from 'convex/server'
import { v } from 'convex/values'
import { components } from './_generated/api.js'

// Read through the real component so its session/user changes invalidate the
// authorization subscription. Never return Better Auth credentials to callers.
export async function liveAuthExpiry(ctx, auth, now) {
  if (auth?.role !== 'human' || !auth.accountId || !auth.authSessionId) return 0
  const session = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: 'session', where: [{ field: '_id', value: auth.authSessionId }] })
  if (!session || session.userId !== auth.accountId || session.expiresAt <= now) return 0
  const user = await ctx.runQuery(components.betterAuth.adapter.findOne, { model: 'user', where: [{ field: '_id', value: auth.accountId }] })
  return user?.emailVerified === true ? session.expiresAt : 0
}

export const exchange = internalMutationGeneric({
  args: { ticketKey: v.string(), cookieHash: v.string() },
  handler: async (ctx, { ticketKey, cookieHash }) => {
    const namespace = /^(.*)live-ticket:[a-f0-9]{64}$/.exec(ticketKey)?.[1]
    if (!namespace || !/^[a-f0-9]{64}$/.test(cookieHash)) throw new Error('Invalid live ticket')
    const now = Date.now(), get = key => ctx.db.query('records').withIndex('by_key', q => q.eq('key', key)).unique()
    const ticket = await get(ticketKey)
    if (!ticket || ticket.expiresAt <= now) throw new Error('Expired live ticket')
    const { tokenKey } = JSON.parse(ticket.value)
    if (!/^token:[a-f0-9]{64}$/.test(tokenKey)) throw new Error('Invalid live ticket')
    const row = await get(namespace + tokenKey), auth = row && JSON.parse(row.value)
    if (!auth || !row.expiresAt || row.expiresAt <= now || auth.expires <= now || auth.liveCookieHash) throw new Error('Expired live ticket')
    const expiresAt = Math.min(auth.expires, row.expiresAt, await liveAuthExpiry(ctx, auth, now))
    const owner = await get(`${namespace}session:${auth.id}`), session = owner && JSON.parse(owner.value)
    if (expiresAt <= now || !session || session.accountId !== auth.accountId) throw new Error('Expired live session')
    await ctx.db.patch(row._id, { value: JSON.stringify({ ...auth, liveCookieHash: cookieHash }), expiresAt })
    await ctx.db.delete(ticket._id)
    return { expiresAt }
  },
})
