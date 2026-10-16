import { createServer, request } from 'node:http'
import { once } from 'node:events'
import { test, expect, vi } from 'vitest'
import { convexTest } from 'convex-test'
import betterAuthTest from '@convex-dev/better-auth/test'
import schema from '../convex/schema.js'
import { createHandler } from '../online/http.js'
import { MemoryStore } from '../online/store.js'

const modules = import.meta.glob('../convex/**/*.js')
const origin = 'https://botters.example.test', secret = 'isolated-polling-proxy-123456789012345'
const env = { BOTTERS_AUTH_ORIGIN: origin, BOTTERS_AUTH_SITE_URL: 'https://polling.convex.site', BOTTERS_AUTH_PROXY_SECRET: secret }
const password = 'isolated-polling-password-471!'
const cookieOf = r => r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
// node:http permits the canonical Host header while connecting only to loopback.
const localHTTP = (url, { body, ...options }) => new Promise((resolve, reject) => {
  const req = request(url, options, res => {
    const chunks = [], headers = new Headers()
    for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1])
    res.on('data', chunk => chunks.push(chunk))
    res.on('error', reject)
    res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers })))
  })
  req.on('error', reject); req.end(body)
})

test('production HTTP keeps shared-IP lobby polling live past 100 validations without weakening ownership or auth limits', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-16T00:00:00Z'))
  vi.stubEnv('SITE_URL', origin); vi.stubEnv('BETTER_AUTH_SECRET', 'isolated-polling-auth-secret-123456789012345')
  vi.stubEnv('BOTTERS_AUTH_PROXY_SECRET', secret); vi.stubEnv('RESEND_API_KEY', 'test-only'); vi.stubEnv('AUTH_EMAIL_FROM', 'no-reply@example.test')
  const t = convexTest(schema, modules); betterAuthTest.register(t)
  const mail = []
  // The production handler and resolveAccount use HTTP, not auth.api.getSession.
  // Route only the Convex transport locally; capture external email, deny all other egress.
  vi.stubGlobal('fetch', async (url, options) => {
    const parsed = new URL(url)
    if (parsed.origin === env.BOTTERS_AUTH_SITE_URL) return t.fetch(parsed.pathname + parsed.search, options)
    if (url === 'https://api.resend.com/emails') {
      mail.push(JSON.parse(options.body)); return Response.json({ id: 'captured-test-email' })
    }
    throw new Error('Unexpected external network in isolated polling regression')
  })
  const server = createServer(createHandler(new MemoryStore(), { origin, env, requireAccount: true }))
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const base = `http://127.0.0.1:${server.address().port}`
    const call = (path, { cookie = '', body, token } = {}) => localHTTP(`${base}/api?${new URLSearchParams({ route: path, ...(token ? { token } : {}) })}`, {
      method: body === undefined ? 'GET' : 'POST',
      // Both accounts share the real loopback client IP; no injected identity resolver.
      headers: { host: 'botters.example.test', origin, cookie, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const accounts = []
    for (const name of ['Alice', 'Bob']) {
      const email = `${name.toLowerCase()}@example.test`
      const signup = await call('/auth/sign-up/email', { body: { name, email, password, callbackURL: '/' } })
      expect(signup.status, await signup.clone().text()).toBe(200)
      const link = new URL(mail.at(-1).text.match(/https:\/\/\S+/)[0])
      const verification = await localHTTP(`${base}/api?route=/auth/verify-email&${link.searchParams}`, { headers: { host: 'botters.example.test', origin } })
      expect(verification.status).toBe(302)
      const cookie = cookieOf(verification)
      const session = await call('/session', { cookie, body: {} })
      expect(session.status).toBe(200)
      accounts.push({ name, email, cookie, token: (await session.json()).humanToken })
    }
    const [alice, bob] = accounts
    // Each account independently crosses the old ceiling; their combined shared-IP
    // traffic crosses it first. All requests stay inside the same 600-second window.
    for (let i = 0; i < 120; i++) for (const account of accounts) {
      const lobby = await call('/lobby', account)
      expect(lobby.status, `${account.name} lobby poll ${i + 1}`).toBe(200)
    }
    const identity = await call('/account', alice)
    expect((await identity.json()).user).toMatchObject({ name: 'Alice', emailVerified: true })
    expect((await call('/lobby', { ...bob, token: alice.token })).status).toBe(401)
    expect((await call('/lobby', { token: alice.token })).status).toBe(401)
    expect((await call('/auth/get-session', alice)).status).toBe(404)
    for (const headers of [{}, { 'x-botters-auth-proxy': 'forged' }]) {
      expect((await t.fetch('/api/auth/get-session', { headers: { cookie: alice.cookie, ...headers } })).status).toBe(404)
    }
    expect((await call('/auth/sign-out', { cookie: alice.cookie, body: {} })).status).toBe(200)
    expect((await call('/lobby', alice)).status).toBe(401)
    expect((await call('/lobby', bob)).status).toBe(200)

    // Polling neither consumes nor clears the atomic credential/email buckets.
    const attempts = await Promise.all(Array.from({ length: 12 }, () => call('/auth/sign-in/email', { body: { email: bob.email, password: 'wrong-isolated-password' } })))
    expect(attempts.filter(r => r.status === 429)).toHaveLength(7)
    expect(attempts.filter(r => r.status === 401)).toHaveLength(5)
    for (const path of ['/request-password-reset', '/send-verification-email']) {
      for (let i = 0; i < 3; i++) expect((await call('/auth' + path, { body: { email: bob.email, redirectTo: '/', callbackURL: '/' } })).status).toBe(200)
      expect((await call('/lobby', bob)).status).toBe(200)
      expect((await call('/auth' + path, { body: { email: bob.email, redirectTo: '/', callbackURL: '/' } })).status).toBe(429)
    }
    expect((await call('/auth/sign-in/email', { body: { email: bob.email, password } })).status).toBe(429)
    vi.setSystemTime(Date.now() + 604801000)
    expect((await call('/lobby', bob)).status).toBe(401)
    expect((await (await call('/account', bob)).json()).user).toBeNull()
    console.log('240 shared-IP lobby polls passed; revoked/expired/missing/cross-account cookies denied; proxy gate and atomic auth limits retained')
  } finally {
    await new Promise(resolve => server.close(resolve))
    vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs()
  }
})
