import { test } from 'node:test'
import assert from 'node:assert/strict'
import { betterAuth } from 'better-auth/minimal'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { authOptions } from '../online/auth-options.js'
import { proxyAuth, resolveAccount } from '../online/auth.js'

const origin = 'https://botters.example.test'
const password = 'isolated-test-password-981!'
function harness() {
  const database = { user: [], session: [], account: [], verification: [], rateLimit: [] }, mail = []
  const auth = betterAuth({ ...authOptions({ SITE_URL: origin, BETTER_AUTH_SECRET: 'test-only-not-a-live-secret-123456789012345', AUTH_GOOGLE_ID: 'test-google-id', AUTH_GOOGLE_SECRET: 'test-google-secret' }, async message => { mail.push(message) }), database: memoryAdapter(database) })
  const request = (path, body, cookie = '', extra = {}) => auth.handler(new Request(path.startsWith('https:') ? path : `${origin}/api/auth${path}`, { method: body ? 'POST' : 'GET', headers: { origin, 'content-type': 'application/json', 'x-botters-client-ip': '192.0.2.1', ...(cookie ? { cookie } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined }))
  const signup = () => request('/sign-up/email', { email: 'alice@example.test', password, name: 'Alice', callbackURL: '/' })
  const verify = () => request(mail.at(-1).text.match(/https:\/\/\S+/)[0])
  return { auth, database, mail, request, signup, verify }
}
const cookieOf = r => r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')

test('real Better Auth signup hashes password, requires verification, rejects wrong password and signs out', async () => {
  const h = harness()
  const signup = await h.signup()
  assert.equal(signup.status, 200)
  assert.equal(h.mail.length, 1)
  assert.ok(!JSON.stringify(h.database).includes(password))
  assert.equal((await h.request('/sign-in/email', { email: 'alice@example.test', password })).status, 403)
  const verify = await h.verify(), cookie = cookieOf(verify)
  assert.equal(verify.status, 302)
  assert.match(verify.headers.get('set-cookie'), /HttpOnly/i)
  assert.match(verify.headers.get('set-cookie'), /Secure/i)
  assert.match(verify.headers.get('set-cookie'), /SameSite=Lax/i)
  assert.equal((await h.request('/sign-in/email', { email: 'alice@example.test', password: 'wrong-password-here' })).status, 401)
  assert.equal((await h.request('/get-session', null, cookie).then(r => r.json())).user.emailVerified, true)
  assert.equal((await h.request('/sign-out', {}, cookie)).status, 200)
  assert.equal(await h.request('/get-session', null, cookie).then(r => r.json()), null)
})

test('real reset invalidates old password/session; reset token is single-use and expired tokens fail', async () => {
  const h = harness(); await h.signup(); const cookie = cookieOf(await h.verify())
  await h.request('/request-password-reset', { email: 'alice@example.test', redirectTo: '/' })
  const link = h.mail.at(-1).text.match(/https:\/\/\S+/)[0]
  const redirect = await h.request(link), token = new URL(redirect.headers.get('location')).searchParams.get('token')
  assert.ok(token)
  const nextPassword = 'new-isolated-password-326!'
  assert.equal((await h.request('/reset-password', { token, newPassword: nextPassword })).status, 200)
  assert.equal((await h.request('/reset-password', { token, newPassword: password })).status, 400)
  assert.equal(await h.request('/get-session', null, cookie).then(r => r.json()), null)
  assert.equal((await h.request('/sign-in/email', { email: 'alice@example.test', password })).status, 401)
  assert.equal((await h.request('/sign-in/email', { email: 'alice@example.test', password: nextPassword })).status, 200)
  await h.request('/request-password-reset', { email: 'alice@example.test', redirectTo: '/' })
  for (const v of h.database.verification || []) v.expiresAt = new Date(0)
  const expired = await h.request(h.mail.at(-1).text.match(/https:\/\/\S+/)[0])
  assert.ok(expired.headers.get('location').includes('INVALID_TOKEN'))
})

test('real library Google authorization uses exact owned callback, state and rejects forged callbacks/origins', async () => {
  const h = harness()
  const r = await h.request('/sign-in/social', { provider: 'google', callbackURL: '/' })
  assert.equal(r.status, 200)
  const url = new URL((await r.json()).url)
  assert.equal(url.origin, 'https://accounts.google.com')
  assert.equal(url.searchParams.get('redirect_uri'), `${origin}/api/auth/callback/google`)
  assert.ok(url.searchParams.get('state'))
  assert.equal((await h.request('/sign-up/email', { email: 'evil@example.test', password, name: 'evil' }, '', { origin: 'https://evil.example' })).status, 403)
  const bad = await h.request('/callback/google?code=forged&state=forged')
  assert.equal(bad.status, 302)
  assert.ok(bad.headers.get('location').includes('error='))
})

const env = { BOTTERS_AUTH_SITE_URL: 'https://test-deployment.convex.site', BOTTERS_AUTH_ORIGIN: origin, BOTTERS_AUTH_PROXY_SECRET: 'test-only-proxy-secret-123456789012345' }
const req = (url, method = 'POST', extra = {}) => ({ url, method, headers: { host: 'botters.example.test', origin, ...extra }, socket: { remoteAddress: '192.0.2.2' } })
function response() { return { headers: {}, setHeader(k, v) { this.headers[k] = v }, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers) }, end(body) { this.body = body } } }

test('proxy blocks alternate hosts/origins/providers/unsafe returns and forwards only explicit headers/routes', async () => {
  let seen
  const fetcher = async (url, options) => { seen = { url, options }; return Response.json({ ok: true }, { headers: { 'set-cookie': '__Secure-better-auth.session_token=opaque; Secure; HttpOnly; SameSite=Lax' } }) }
  for (const [request, path, body, expected] of [
    [req('/api?route=/auth/sign-in/email', 'POST', { host: 'botters.vercel.app' }), '/sign-in/email', {}, 400],
    [req('/', 'POST', { origin: undefined }), '/sign-in/email', {}, 403],
    [req('/'), '/link-social', {}, 404],
    [req('/'), '/sign-in/social', { provider: 'github' }, 400],
    [req('/'), '/sign-in/email', { callbackURL: '//evil.example' }, 400],
    [req('/'), '/sign-in/email', { callbackURL: '/\\evil.example' }, 400],
  ]) { const res = response(); await proxyAuth(request, res, path, body, env, fetcher); assert.equal(res.status, expected) }
  assert.equal(seen, undefined)
  const res = response()
  await proxyAuth(req('/api?route=/auth/sign-in/email', 'POST', { authorization: 'forged', cookie: 'owner-cookie', 'x-botters-auth-proxy': 'forged', 'x-forwarded-for': 'forged' }), res, '/sign-in/email', { callbackURL: '/' }, env, fetcher)
  assert.equal(res.status, 200)
  assert.equal(seen.url, `${env.BOTTERS_AUTH_SITE_URL}/api/auth/sign-in/email`)
  assert.equal(seen.options.headers.get('x-botters-auth-proxy'), env.BOTTERS_AUTH_PROXY_SECRET)
  assert.equal(seen.options.headers.get('authorization'), null)
  assert.equal(seen.options.headers.get('x-botters-client-ip'), '192.0.2.2')
  assert.equal(seen.options.redirect, 'manual')
  assert.ok(res.headers['Set-Cookie'])
})

test('server identity ignores request JSON/headers and accepts only a live verified backend session', async () => {
  const request = req('/', 'GET', { cookie: 'opaque', 'x-account-id': 'forged' })
  const fetcher = data => async () => Response.json(data)
  assert.equal(await resolveAccount(request, env, fetcher(null)), null)
  assert.equal(await resolveAccount(request, env, fetcher({ user: { id: 'a', emailVerified: false }, session: { expiresAt: '2099-01-01' } })), null)
  assert.equal(await resolveAccount(request, env, fetcher({ user: { id: 'a', emailVerified: true }, session: { expiresAt: '2000-01-01' } })), null)
  assert.deepEqual(await resolveAccount(request, env, fetcher({ user: { id: 'a', name: 'Alice', emailVerified: true }, session: { id: 'real-session', expiresAt: '2099-01-01' } })), { id: 'a', name: 'Alice', emailVerified: true, authSessionId: 'real-session', authExpires: Date.parse('2099-01-01') })
})
