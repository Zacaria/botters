import { test, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { convexTest } from 'convex-test'
import betterAuthTest from '@convex-dev/better-auth/test'
import schema from '../convex/schema.js'
import { internal, components } from '../convex/_generated/api.js'
import { resolveAccount } from '../online/auth.js'
import { OnlineGame } from '../online/game.js'
const modules = import.meta.glob('../convex/**/*.js')
const hash = s => createHash('sha256').update(s).digest('hex')

test.each(['logout', 'reset'])('real component %s revokes human authority, not agents; tickets are atomic and expire', async action => {
  const origin = 'https://botters.example.test', secret = 'isolated-live-proxy-secret-123456789012345'
  vi.stubEnv('SITE_URL', origin); vi.stubEnv('BETTER_AUTH_SECRET', 'isolated-live-auth-secret-123456789012345')
  vi.stubEnv('BOTTERS_AUTH_PROXY_SECRET', secret); vi.stubEnv('RESEND_API_KEY', 'captured-only'); vi.stubEnv('AUTH_EMAIL_FROM', 'Test <test@example.test>')
  const mail = []
  vi.stubGlobal('fetch', async (_url, options) => { mail.push(JSON.parse(options.body)); return Response.json({ id: 'captured' }) })
  try {
    const t = convexTest(schema, modules); betterAuthTest.register(t)
    const call = (path, body, cookie = '') => t.fetch('/api/auth' + path, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-botters-auth-proxy': secret, cookie }, body: JSON.stringify(body) })
    expect((await call('/sign-up/email', { email: 'live@example.test', name: 'Live', password: 'isolated-live-password-123!', callbackURL: '/' })).status).toBe(200)
    const link = new URL(mail.at(-1).text.match(/https:\/\/\S+/)[0])
    const verified = await t.fetch(link.pathname + link.search, { headers: { origin, 'x-botters-auth-proxy': secret } })
    const cookie = verified.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
    const identity = await resolveAccount({ headers: { host: new URL(origin).host, cookie } }, { BOTTERS_AUTH_ORIGIN: origin, BOTTERS_AUTH_SITE_URL: 'https://isolated.convex.site', BOTTERS_AUTH_PROXY_SECRET: secret }, (url, options) => { const u = new URL(url); return t.fetch(u.pathname + u.search, options) })
    expect(identity.authSessionId).toBeTruthy()
    const prefix = 'live-test:', store = {
      get: async key => (await t.query(internal.store.get, { keys: [prefix + key], now: Date.now() }))[0],
      commit: entries => t.mutation(internal.store.commit, { entries: entries.map(e => ({ ...e, key: prefix + e.key })) }),
    }
    const game = new OnlineGame(store, { requireAccount: true, liveExchange: true, identity })
    const issued = await game.request('POST', '/session')
    expect(issued.liveTicket).toMatch(/^[\w-]{32}$/)
    expect(issued.authSessionId).toBeUndefined()
    const key = prefix + 'token:' + hash(issued.humanToken), ticketKey = prefix + 'live-ticket:' + hash(issued.liveTicket)
    expect((await t.query(internal.store.authorize, { key })).token).toBeNull()
    const proof = hash('a'.repeat(32))
    const races = await Promise.allSettled([t.mutation(internal.liveAuth.exchange, { ticketKey, cookieHash: proof }), t.mutation(internal.liveAuth.exchange, { ticketKey, cookieHash: hash('b'.repeat(32)) })])
    expect(races.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    let granted = await t.query(internal.store.authorize, { key })
    expect(JSON.parse(granted.token).liveCookieHash).toBe(races[0].status === 'fulfilled' ? proof : hash('b'.repeat(32)))
    expect(granted.expiresAt).toBeLessThanOrEqual(identity.authExpires)
    const changeSession = update => t.mutation(components.betterAuth.adapter.updateOne, { input: { model: 'session', where: [{ field: '_id', value: identity.authSessionId }], update } })
    await changeSession({ expiresAt: Date.now() - 1 })
    expect((await t.query(internal.store.authorize, { key })).token).toBeNull()
    await changeSession({ expiresAt: identity.authExpires })
    const changeUser = update => t.mutation(components.betterAuth.adapter.updateOne, { input: { model: 'user', where: [{ field: '_id', value: identity.id }], update } })
    await changeUser({ emailVerified: false })
    expect((await t.query(internal.store.authorize, { key })).token).toBeNull()
    await changeUser({ emailVerified: true })
    expect((await t.query(internal.store.authorize, { key })).token).toBeTruthy()
    const expired = await game.request('POST', '/session')
    await t.run(async ctx => { const row = await ctx.db.query('records').withIndex('by_key', q => q.eq('key', prefix + 'live-ticket:' + hash(expired.liveTicket))).unique(); await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 }) })
    await expect(t.mutation(internal.liveAuth.exchange, { ticketKey: prefix + 'live-ticket:' + hash(expired.liveTicket), cookieHash: proof })).rejects.toThrow()
    const unconsumed = await game.request('POST', '/session')
    // A separately approved agent does not inherit the browser's auth-session lifetime.
    const agentKey = prefix + 'token:' + hash('c'.repeat(32))
    await t.mutation(internal.store.commit, { entries: [{ key: agentKey, raw: null, value: JSON.stringify({ id: issued.sessionId, role: 'agent', version: 0, expires: Date.now() + 600000 }), ttl: 600 }] })
    if (action === 'logout') expect((await call('/sign-out', {}, cookie)).status).toBe(200)
    else {
      expect((await call('/request-password-reset', { email: 'live@example.test', redirectTo: '/' })).status).toBe(200)
      const resetURL = new URL(mail.at(-1).text.match(/https:\/\/\S+/)[0])
      const reset = await t.fetch(resetURL.pathname + resetURL.search, { headers: { origin, 'x-botters-auth-proxy': secret } })
      const token = new URL(reset.headers.get('location')).searchParams.get('token')
      expect((await call('/reset-password', { token, newPassword: 'new-isolated-live-password-456!' })).status).toBe(200)
    }
    granted = await t.query(internal.store.authorize, { key })
    expect(granted.token).toBeNull(); expect(granted.session).toBeNull()
    await expect(t.mutation(internal.liveAuth.exchange, { ticketKey: prefix + 'live-ticket:' + hash(unconsumed.liveTicket), cookieHash: proof })).rejects.toThrow()
    expect(JSON.parse((await t.query(internal.store.authorize, { key: agentKey })).token).role).toBe('agent')

  } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs() }
})
