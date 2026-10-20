import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, readFileSync, statSync, rmSync, chmodSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { OnlineGame } from '../online/game.js'
import { MemoryStore } from '../online/store.js'
import { createMcpOAuth } from '../mcp-oauth.js'
import { chromium } from '@playwright/test'

const alice = { id: 'oauth-test-alice', name: 'Alice', emailVerified: true }
const verifier = 'v'.repeat(64)
const challenge = createHash('sha256').update(verifier).digest('base64url')
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)))
const stop = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
async function fixture(t) {
  let time = Date.now(), oauth, outage = false
  const store = new MemoryStore(() => time), dir = mkdtempSync(join(tmpdir(), 'botters-oauth-'))
  const stateFile = join(dir, 'oauth.json')
  const game = (identity, method, path, token = '', body = {}) => new OnlineGame(store, { now: () => time, origin: upstream, requireAccount: true, identity }).request(method, path, new URLSearchParams({ token }), body)
  const upstreamServer = http.createServer(async (req, res) => {
    try {
      if (outage) { res.writeHead(503).end(); return }
      const url = new URL(req.url, upstream); let body = ''
      for await (const chunk of req) body += chunk
      const result = await game(null, req.method, url.pathname, url.searchParams.get('token'), body ? JSON.parse(body) : {})
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(result))
    } catch (e) { res.writeHead(e.status || 500).end(JSON.stringify({ error: e.message })) }
  })
  const upstream = await listen(upstreamServer)
  const gateway = http.createServer((req, res) => oauth.handle(req, res))
  const origin = await listen(gateway)
  const start = () => { oauth = createMcpOAuth({ origin, server: upstream, stateFile, now: () => time }); return oauth }
  start()
  t.after(async () => { oauth.close(); await stop(gateway); await stop(upstreamServer); rmSync(dir, { recursive: true, force: true }) })
  const request = (path, options = {}) => fetch(origin + path, { redirect: 'manual', ...options })
  const form = (path, body, headers = {}) => request(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body) })
  const register = async (extra = {}) => {
    const res = await request('/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: '<script>evil</script>', redirect_uris: ['https://client.example/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], ...extra }) })
    assert.equal(res.status, 201); return res.json()
  }
  return { request, form, register, origin, upstream, stateFile, dir, game, start, get oauth() { return oauth }, advance(ms) { time += ms }, outage(value) { outage = value } }
}

async function begin(f, client, extra = {}) {
  const response = await f.request('/authorize?' + new URLSearchParams({ client_id: client.client_id, redirect_uri: client.redirect_uris[0], response_type: 'code', scope: 'botters:play', resource: f.origin + '/mcp', state: 'client-state', code_challenge: challenge, code_challenge_method: 'S256', ...extra }))
  assert.equal(response.status, 302)
  const location = response.headers.get('location')
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  const tx = new URL(location, f.origin).searchParams.get('transaction')
  return { response, location, cookie, tx }
}
async function approve(f, pending) {
  const page = await (await f.request(pending.location, { headers: { cookie: pending.cookie } })).text()
  const approvalUrl = page.match(/href="(http[^" ]+)"/)[1].replaceAll('&amp;', '&')
  const id = new URL(approvalUrl).searchParams.get('pair')
  const human = await f.game(alice, 'POST', '/session')
  await f.game(alice, 'POST', '/agent/approve', human.humanToken, { id })
  const complete = await f.form('/consent/complete', { transaction: pending.tx }, { cookie: pending.cookie, origin: f.origin })
  assert.equal(complete.status, 200)
  const { redirect } = await complete.json()
  const callback = new URL(redirect)
  assert.equal(callback.origin, 'https://client.example')
  assert.equal(callback.searchParams.get('state'), 'client-state')
  return { code: callback.searchParams.get('code'), human }
}
async function issue(f) {
  const client = await f.register(), pending = await begin(f, client), { code, human } = await approve(f, pending)
  const body = { client_id: client.client_id, grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: client.redirect_uris[0], resource: f.origin + '/mcp' }
  const response = await f.form('/token', body)
  assert.equal(response.status, 200, await response.clone().text())
  return { client, pending, code, human, body, tokens: await response.json() }
}

test('SDK discovery and public DCR persist private issuer-bound state', async t => {
  const f = await fixture(t)
  const metadata = await (await f.request('/.well-known/oauth-authorization-server')).json()
  assert.equal(metadata.issuer, f.origin + '/')
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ['none'])
  assert.deepEqual(metadata.revocation_endpoint_auth_methods_supported, ['none'])
  assert.deepEqual(metadata.code_challenge_methods_supported, ['S256'])
  const resource = await (await f.request('/.well-known/oauth-protected-resource/mcp')).json()
  assert.equal(resource.resource, f.origin + '/mcp')
  assert.deepEqual(resource.scopes_supported, ['botters:play'])
  const client = await f.register()
  assert.ok(client.client_id); assert.equal(client.client_secret, undefined)
  assert.equal(statSync(f.stateFile).mode & 0o777, 0o600)
  assert.equal(statSync(f.dir).mode & 0o777, 0o700)
  f.oauth.close(); f.start()
  const res = await f.request('/authorize?' + new URLSearchParams({ client_id: client.client_id, redirect_uri: 'https://attacker.example/' }))
  assert.equal(res.status, 400)
  assert.match(readFileSync(f.stateFile, 'utf8'), /client.example/)
})

test('real account approval gates browser-bound consent and SDK PKCE opaque token issuance', async t => {
  const f = await fixture(t), client = await f.register(), pending = await begin(f, client)
  assert.ok(pending.cookie)
  assert.equal((await f.request(pending.location)).status, 403)
  const page = await (await f.request(pending.location, { headers: { cookie: pending.cookie } })).text()
  assert.match(page, /&lt;script&gt;evil&lt;\/script&gt;/)
  assert.match(page, /https:\/\/client.example/)
  assert.ok(!page.includes('<script>evil</script>'))
  assert.equal((await f.form('/consent/complete', { transaction: pending.tx }, { cookie: pending.cookie, origin: 'https://attacker.example' })).status, 403)
  const waiting = await f.form('/consent/complete', { transaction: pending.tx }, { cookie: pending.cookie, origin: f.origin })
  assert.deepEqual(await waiting.json(), { approved: false })
  const { code } = await approve(f, pending)
  const body = { client_id: client.client_id, grant_type: 'authorization_code', code, redirect_uri: client.redirect_uris[0], resource: f.origin + '/mcp' }
  assert.equal((await f.form('/token', { ...body, code_verifier: 'wrong' })).status, 400)
  const response = await f.form('/token', { ...body, code_verifier: verifier })
  assert.equal(response.status, 200)
  const tokens = await response.json()
  assert.equal(tokens.scope, 'botters:play'); assert.equal(tokens.token_type, 'Bearer')
  assert.ok(tokens.refresh_token); assert.ok(tokens.access_token)
  const auth = await f.oauth.authenticate({ headers: { authorization: `Bearer ${tokens.access_token}` } })
  assert.ok(auth.grantId); assert.equal(auth.clientId, client.client_id); assert.equal(auth.agentToken.length, 32)
  assert.equal(f.oauth.isActive(auth.grantId), true)
  assert.ok(!JSON.stringify(tokens).includes(auth.agentToken))
  const persisted = readFileSync(f.stateFile, 'utf8')
  for (const value of [tokens.access_token, tokens.refresh_token, code]) assert.ok(!persisted.includes(value))
  assert.equal((await f.form('/token', { ...body, code_verifier: verifier })).status, 400)
})

test('OAuth errors never echo malformed bodies or framework stack traces', async t => {
  const f = await fixture(t)
  const response = await f.request('/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"private-test-marker"' })
  assert.equal(response.status, 400)
  assert.match(response.headers.get('content-type'), /application\/json/)
  const body = await response.text()
  assert.ok(!body.includes('private-test-marker'))
  assert.ok(!body.includes('SyntaxError'))
  assert.equal((await f.request('/.well-known/oauth-authorization-server', { headers: { origin: 'https://client.example' } })).headers.get('access-control-allow-origin'), '*')
})

test('refresh rotation preserves grant across restart; replay invalidates the whole grant durably', async t => {
  const f = await fixture(t), { client, tokens } = await issue(f)
  const authenticate = token => f.oauth.authenticate({ headers: { authorization: 'Bearer ' + token } })
  const first = await authenticate(tokens.access_token)
  f.oauth.close(); f.start()
  assert.equal((await authenticate(tokens.access_token)).grantId, first.grantId)
  const refresh = { client_id: client.client_id, grant_type: 'refresh_token', refresh_token: tokens.refresh_token, resource: f.origin + '/mcp', scope: 'botters:play' }
  const response = await f.form('/token', refresh)
  assert.equal(response.status, 200, await response.clone().text())
  const rotated = await response.json()
  assert.notEqual(rotated.refresh_token, tokens.refresh_token)
  assert.equal((await authenticate(rotated.access_token)).grantId, first.grantId)
  f.oauth.close(); f.start()
  assert.equal((await f.form('/token', refresh)).status, 400)
  for (const token of [tokens.access_token, rotated.access_token]) await assert.rejects(authenticate(token), e => e.status === 401)
  assert.equal(f.oauth.isActive(first.grantId), false)
  f.oauth.close(); f.start()
  await assert.rejects(authenticate(rotated.access_token), e => e.status === 401)
})

test('SDK revocation invalidates access and refresh for that client only', async t => {
  const f = await fixture(t), { client, tokens } = await issue(f), other = await f.register()
  const authenticate = () => f.oauth.authenticate({ headers: { authorization: 'Bearer ' + tokens.access_token } })
  assert.equal((await f.form('/revoke', { client_id: other.client_id, token: tokens.refresh_token })).status, 200)
  await authenticate()
  assert.equal((await f.form('/revoke', { client_id: client.client_id, token: tokens.refresh_token })).status, 200)
  await assert.rejects(authenticate(), e => e.status === 401)
  assert.equal((await f.form('/token', { client_id: client.client_id, grant_type: 'refresh_token', refresh_token: tokens.refresh_token, resource: f.origin + '/mcp' })).status, 400)
})

test('client, callback, scope and exact resource binding reject substitution without consuming valid code', async t => {
  const f = await fixture(t), { client, code, body } = await issue(f), other = await f.register()
  // A fresh code, since issue() has already consumed its first code.
  const next = await approve(f, await begin(f, client))
  const tokenBody = { ...body, code: next.code }
  for (const extra of [{ client_id: other.client_id }, { redirect_uri: 'https://client.example/other' }, { resource: f.upstream + '/mcp' }, { resource: f.origin + '/mcp/' }, { resource: '' }]) {
    assert.equal((await f.form('/token', { ...tokenBody, ...extra })).status, 400)
  }
  assert.equal((await f.form('/token', tokenBody)).status, 200)
  assert.equal((await f.form('/token', { ...tokenBody, code })).status, 400)
  for (const extra of [{ scope: 'profile' }, { scope: 'botters:play profile' }, { scope: '' }, { resource: f.upstream + '/mcp' }, { resource: f.origin + '/mcp?x=1' }, { resource: '' }, { code_challenge_method: 'plain' }, { redirect_uri: 'https://attacker.example/' }]) {
    const res = await f.request('/authorize?' + new URLSearchParams({ client_id: client.client_id, redirect_uri: client.redirect_uris[0], response_type: 'code', scope: 'botters:play', resource: f.origin + '/mcp', code_challenge: challenge, code_challenge_method: 'S256', ...extra }))
    assert.ok(res.status === 400 || new URL(res.headers.get('location')).searchParams.has('error'))
    assert.ok(!res.headers.get('set-cookie'))
  }
})

test('same-origin cancellation, missing browser binding, expired consent and code never grant access', async t => {
  const f = await fixture(t), client = await f.register(), p = await begin(f, client)
  assert.equal((await f.form('/consent/cancel', { transaction: p.tx }, { cookie: p.cookie })).status, 403)
  assert.equal((await f.form('/consent/complete', { transaction: p.tx }, { origin: f.origin })).status, 403)
  const cancelled = await f.form('/consent/cancel', { transaction: p.tx }, { origin: f.origin, cookie: p.cookie })
  assert.equal(cancelled.status, 303)
  assert.equal(new URL(cancelled.headers.get('location')).searchParams.get('error'), 'access_denied')
  assert.equal((await f.form('/consent/complete', { transaction: p.tx }, { origin: f.origin, cookie: p.cookie })).status, 403)
  const expired = await begin(f, client)
  f.advance(600001)
  assert.equal((await f.form('/consent/complete', { transaction: expired.tx }, { origin: f.origin, cookie: expired.cookie })).status, 410)
  const { code } = await approve(f, await begin(f, client))
  f.advance(120001)
  assert.equal((await f.form('/token', { client_id: client.client_id, code, grant_type: 'authorization_code', redirect_uri: client.redirect_uris[0], code_verifier: verifier, resource: f.origin + '/mcp' })).status, 400)
})

test('upstream outages fail closed without destroying grant; upstream revocation is durable', async t => {
  const f = await fixture(t), { client, tokens, human } = await issue(f)
  const auth = () => f.oauth.authenticate({ headers: { authorization: 'Bearer ' + tokens.access_token } })
  const first = await auth()
  f.outage(true)
  await assert.rejects(auth(), e => e.status === 503)
  assert.equal(f.oauth.isActive(first.grantId), true)
  const refresh = { client_id: client.client_id, grant_type: 'refresh_token', refresh_token: tokens.refresh_token, resource: f.origin + '/mcp' }
  assert.equal((await f.form('/token', refresh)).status, 503)
  f.outage(false)
  assert.equal((await auth()).grantId, first.grantId)
  await f.game(alice, 'POST', '/agent/revoke', human.humanToken)
  await assert.rejects(auth(), e => e.status === 401)
  assert.equal(f.oauth.isActive(first.grantId), false)
  f.oauth.close(); f.start()
  await assert.rejects(auth(), e => e.status === 401)
})

test('access expiry, refresh scope/client/resource boundaries and capabilities cannot be bypassed', async t => {
  const f = await fixture(t), { tokens, client } = await issue(f), other = await f.register()
  const first = await f.oauth.authenticate({ headers: { authorization: 'Bearer ' + tokens.access_token } })
  for (const authorization of [undefined, '', 'Bearer no', 'Basic ' + tokens.access_token, 'Bearer ' + tokens.refresh_token, 'Bearer ' + first.agentToken]) await assert.rejects(f.oauth.authenticate({ headers: { authorization } }), e => e.status === 401)
  const body = { client_id: client.client_id, grant_type: 'refresh_token', refresh_token: tokens.refresh_token, resource: f.origin + '/mcp' }
  for (const extra of [{ client_id: other.client_id }, { resource: f.upstream + '/mcp' }, { scope: 'botters:play profile' }]) assert.equal((await f.form('/token', { ...body, ...extra })).status, 400)
  f.advance(600001)
  await assert.rejects(f.oauth.authenticate({ headers: { authorization: 'Bearer ' + tokens.access_token } }), e => e.status === 401)
  assert.equal(f.oauth.isActive(first.grantId), true)
  assert.equal((await f.form('/token', body)).status, 200)
  f.advance(7 * 86400000)
  assert.equal(f.oauth.isActive(first.grantId), false)
  assert.equal((await f.form('/token', body)).status, 400)
})

test('state rejects checkout, issuer/upstream mismatch, permissive files and symlinks', async t => {
  const f = await fixture(t); await f.register()
  for (const options of [{ stateFile: new URL('../oauth-secret.json', import.meta.url).pathname }, { origin: 'https://other.example' }, { server: 'https://other.example' }]) assert.throws(() => createMcpOAuth({ origin: f.origin, server: f.upstream, stateFile: f.stateFile, ...options }))
  chmodSync(f.stateFile, 0o644)
  assert.throws(() => createMcpOAuth({ origin: f.origin, server: f.upstream, stateFile: f.stateFile }))
  chmodSync(f.stateFile, 0o600)
  const link = join(f.dir, 'link.json'); symlinkSync(f.stateFile, link)
  assert.throws(() => createMcpOAuth({ origin: f.origin, server: f.upstream, stateFile: link }))
})

test('concurrent code redemption issues once; concurrent refresh replay revokes its grant', async t => {
  const f = await fixture(t), client = await f.register(), { code } = await approve(f, await begin(f, client))
  const body = { client_id: client.client_id, code, grant_type: 'authorization_code', code_verifier: verifier, redirect_uri: client.redirect_uris[0], resource: f.origin + '/mcp' }
  const responses = await Promise.all([f.form('/token', body), f.form('/token', body)])
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 400])
  const tokens = await responses.find(r => r.status === 200).json()
  const refresh = { client_id: client.client_id, refresh_token: tokens.refresh_token, grant_type: 'refresh_token', resource: f.origin + '/mcp' }
  const refreshed = await Promise.all([f.form('/token', refresh), f.form('/token', refresh)])
  assert.deepEqual(refreshed.map(r => r.status).sort(), [200, 400])
  await assert.rejects(f.oauth.authenticate({ headers: { authorization: 'Bearer ' + tokens.access_token } }), e => e.status === 401)
})

test('real browser consent polls with its protected cookie, returns the code and cancels to the registered client', { timeout: 20000 }, async t => {
  const f = await fixture(t), callbacks = []
  const callbackServer = http.createServer((req, res) => { const url = new URL(req.url, 'http://localhost'); if (url.pathname === '/callback') callbacks.push(url); res.setHeader('content-type', 'text/html'); res.end('<title>OAuth test callback</title>OAuth test callback received') })
  const callbackOrigin = await listen(callbackServer)
  t.after(() => stop(callbackServer))
  const browser = await chromium.launch({ executablePath: process.env.BOTTERS_BROWSER || '/usr/bin/brave-browser', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage()
  const client = await f.register({ redirect_uris: [callbackOrigin + '/callback'] })
  const authorize = f.origin + '/authorize?' + new URLSearchParams({ client_id: client.client_id, redirect_uri: client.redirect_uris[0], response_type: 'code', scope: 'botters:play', resource: f.origin + '/mcp', state: 'browser-state', code_challenge: challenge, code_challenge_method: 'S256' })
  await page.goto(authorize)
  assert.equal(await page.locator('h1').textContent(), 'Connect an AI agent to Botters')
  assert.ok((await page.locator('body').innerText()).includes('not verified'))
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  const scriptNonce = await page.locator('script').evaluate(element => element.nonce)
  assert.ok(scriptNonce && scriptNonce !== 'consent')
  const approval = new URL(await page.getByRole('link', { name: 'Sign in to Botters and approve (opens a new tab)' }).getAttribute('href'))
  const human = await f.game(alice, 'POST', '/session')
  await f.game(alice, 'POST', '/agent/approve', human.humanToken, { id: approval.searchParams.get('pair') })
  await page.waitForURL(callbackOrigin + '/callback?**', { timeout: 7000 })
  assert.equal(callbacks[0].searchParams.get('state'), 'browser-state')
  assert.ok(callbacks[0].searchParams.get('code'))
  const issued = await f.form('/token', { client_id: client.client_id, grant_type: 'authorization_code', code: callbacks[0].searchParams.get('code'), code_verifier: verifier, redirect_uri: client.redirect_uris[0], resource: f.origin + '/mcp' })
  assert.equal(issued.status, 200)
  await page.goto(authorize)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.waitForURL(callbackOrigin + '/callback?**', { timeout: 7000 }).catch(async () => assert.fail(JSON.stringify({ path: new URL(page.url()).pathname, body: (await page.locator('body').innerText()).slice(0, 300) })))
  assert.equal(callbacks[1].searchParams.get('error'), 'access_denied')
  assert.equal(callbacks[1].searchParams.has('code'), false)
})

test('DCR bounds metadata and rejects unsupported client methods, grants and callback grammars', async t => {
  const f = await fixture(t)
  for (const extra of [{ client_uri: 'https://client.example/' + 'x'.repeat(18000) }, { grant_types: ['client_credentials'] }, { response_types: ['token'] }, { token_endpoint_auth_method: 'client_secret_post' }, { redirect_uris: ['https://user:password@client.example/'] }, { redirect_uris: ['https://client.example/#fragment'] }, { redirect_uris: ['http://client.example/callback'] }, { scope: 'profile' }]) {
    const response = await f.request('/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://client.example/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], ...extra }) })
    assert.equal(response.status, 400, JSON.stringify(extra).slice(0, 100))
  }
})
