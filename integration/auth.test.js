import { test, expect, vi } from 'vitest'
import { convexTest } from 'convex-test'
import betterAuthTest from '@convex-dev/better-auth/test'
import schema from '../convex/schema.js'
import { proxyAuth, resolveAccount } from '../online/auth.js'
const modules = import.meta.glob('../convex/**/*.js')
const origin = 'https://botters.example.test', secret = 'isolated-component-proxy-123456789012345'
const env = { BOTTERS_AUTH_ORIGIN: origin, BOTTERS_AUTH_SITE_URL: 'https://isolated.convex.site', BOTTERS_AUTH_PROXY_SECRET: secret }
const password = 'isolated-convex-password-471!'
function response() { return { headers: {}, setHeader(k, v) { this.headers[k] = v }, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers) }, end(body) { this.body = body } } }
const cookiesOf = r => (r.headers['Set-Cookie'] || []).map(c => c.split(';')[0]).join('; ')

test('actual Convex component executes password verification/reset/session revocation through the production proxy', async () => {
  vi.stubEnv('SITE_URL', origin); vi.stubEnv('BETTER_AUTH_SECRET', 'isolated-component-auth-secret-123456789012345')
  vi.stubEnv('BOTTERS_AUTH_PROXY_SECRET', secret); vi.stubEnv('RESEND_API_KEY', 'test-only-no-real-provider-key'); vi.stubEnv('AUTH_EMAIL_FROM', 'Botters Test <no-reply@example.test>')
  const mail = []
  // External delivery is captured, not sent. Every auth/database response is the real component.
  vi.stubGlobal('fetch', async (url, options) => {
    if (url !== 'https://api.resend.com/emails') throw new Error('Unexpected external network in isolated fixture')
    mail.push(JSON.parse(options.body)); return Response.json({ id: 'captured-test-email' })
  })
  try {
    const t = convexTest(schema, modules); betterAuthTest.register(t)
    const transport = (url, options) => { const parsed = new URL(url); return t.fetch(parsed.pathname + parsed.search, options) }
    const call = async (path, body, cookie = '', method = 'POST') => {
      const res = response()
      await proxyAuth({ url: '/api?route=/auth' + path, method, headers: { host: 'botters.example.test', origin, cookie }, socket: { remoteAddress: '192.0.2.3' } }, res, path, body, env, transport)
      return res
    }
    expect((await t.fetch('/api/auth/get-session')).status).toBe(404)
    const signup = await call('/sign-up/email', { name: 'Convex Alice', email: 'convex-alice@example.test', password, callbackURL: '/' })
    expect(signup.status).toBe(200); expect(mail).toHaveLength(1)
    expect((await call('/sign-in/email', { email: 'convex-alice@example.test', password })).status).toBe(403)
    const link = new URL(mail.at(-1).text.match(/https:\/\/\S+/)[0])
    const verified = await t.fetch(link.pathname + link.search, { headers: { 'x-botters-auth-proxy': secret, origin } })
    expect(verified.status).toBe(302)
    const cookie = verified.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
    const req = { headers: { host: 'botters.example.test', cookie } }
    expect((await resolveAccount(req, env, transport)).name).toBe('Convex Alice')
    expect((await call('/sign-in/email', { email: 'convex-alice@example.test', password: 'wrong-convex-password' })).status).toBe(401)
    await call('/request-password-reset', { email: 'convex-alice@example.test', redirectTo: '/' })
    const resetURL = new URL(mail.at(-1).text.match(/https:\/\/\S+/)[0])
    const reset = await t.fetch(resetURL.pathname + resetURL.search, { headers: { 'x-botters-auth-proxy': secret, origin } })
    const token = new URL(reset.headers.get('location')).searchParams.get('token')
    expect((await call('/reset-password', { token, newPassword: 'new-convex-password-789!' })).status).toBe(200)
    expect((await call('/reset-password', { token, newPassword: password })).status).toBe(400)
    expect(await resolveAccount(req, env, transport)).toBeNull()
    const login = await call('/sign-in/email', { email: 'convex-alice@example.test', password: 'new-convex-password-789!' })
    expect(login.status).toBe(200)
    const newCookie = cookiesOf(login)
    expect((await resolveAccount({ headers: { host: 'botters.example.test', cookie: newCookie } }, env, transport)).emailVerified).toBe(true)
    expect((await call('/sign-out', {}, newCookie)).status).toBe(200)
    expect(await resolveAccount({ headers: { host: 'botters.example.test', cookie: newCookie } }, env, transport)).toBeNull()
  } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs() }
})
