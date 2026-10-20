import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, lstatSync, readFileSync, realpathSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { mcpAuthRouter, createOAuthMetadata } from '@modelcontextprotocol/sdk/server/auth/router.js'
import { InvalidClientMetadataError, InvalidGrantError, InvalidTokenError, InvalidTargetError, InvalidScopeError, InvalidRequestError, ServerError } from '@modelcontextprotocol/sdk/server/auth/errors.js'

const scope = 'botters:play'
const secret = () => randomBytes(32).toString('base64url')
const hash = value => createHash('sha256').update(value).digest('hex')
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const inside = (base, target) => { const p = relative(base, target); return !p || (!p.startsWith('..') && !isAbsolute(p)) }
const validOrigin = value => {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('Expected HTTPS origin (HTTP only for loopback)')
  return url.origin
}

export function createMcpOAuth({ origin, server, stateFile, now = Date.now }) {
  origin = validOrigin(origin); server = validOrigin(server)
  const issuer = new URL(origin), resource = new URL('/mcp', issuer)
  if (!stateFile || !isAbsolute(stateFile)) throw new Error('An absolute private stateFile outside the checkout is required')
  const checkout = dirname(fileURLToPath(import.meta.url))
  if (inside(checkout, resolve(stateFile))) throw new Error('OAuth state must be outside the checkout')
  mkdirSync(dirname(stateFile), { recursive: true, mode: 0o700 })
  const parent = realpathSync(dirname(stateFile)), directory = lstatSync(parent)
  if (inside(checkout, parent) || directory.mode & 0o077 || directory.uid !== process.getuid()) throw new Error('OAuth state parent must be private and owned by this user')
  stateFile = resolve(parent, stateFile.split('/').at(-1))
  let state = { version: 1, origin, server, clients: {}, grants: {}, codes: {}, tokens: {} }, closed = false
  try {
    const stat = lstatSync(stateFile)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.mode & 0o077 || stat.uid !== process.getuid() || stat.size > 8 * 1024 * 1024) throw new Error('OAuth state file must be private, regular and bounded')
    state = JSON.parse(readFileSync(stateFile, 'utf8'))
    if (state.version !== 1 || state.origin !== origin || state.server !== server || Object.entries({ clients: 256, grants: 512, codes: 256, tokens: 8192 }).some(([key, limit]) => !state[key] || Array.isArray(state[key]) || typeof state[key] !== 'object' || Object.keys(state[key]).length > limit)) throw new Error('OAuth state issuer/upstream mismatch or invalid state')
  } catch (e) { if (e.code !== 'ENOENT') throw e }
  function persist() {
    if (closed) throw new ServerError('Authorization service closed')
    const tmp = stateFile + '.' + secret() + '.tmp'
    let fd
    try {
      fd = openSync(tmp, 'wx', 0o600)
      const data = JSON.stringify(state)
      if (Buffer.byteLength(data) > 8 * 1024 * 1024) throw new ServerError('Authorization state capacity reached')
      writeFileSync(fd, data); fsyncSync(fd); closeSync(fd); fd = undefined
      renameSync(tmp, stateFile)
      const directoryFd = openSync(parent, 'r'); try { fsyncSync(directoryFd) } finally { closeSync(directoryFd) }
    } catch { closed = true; throw Object.assign(new ServerError('Authorization state unavailable'), { status: 503 }) } finally { if (fd !== undefined) closeSync(fd); try { unlinkSync(tmp) } catch {} }
  }
  const pending = new Map()
  const active = id => !closed && Object.hasOwn(state.grants, id) && !state.grants[id].revoked && state.grants[id].expires > now()
  function cleanup() {
    for (const [id, p] of pending) if (p.expires <= now()) pending.delete(id)
    for (const [id, code] of Object.entries(state.codes)) if (code.expires <= now()) delete state.codes[id]
    for (const [id, grant] of Object.entries(state.grants)) if (grant.expires <= now()) delete state.grants[id]
    for (const [id, token] of Object.entries(state.tokens)) if (!state.grants[token.grantId] || (token.kind === 'access' && token.expires <= now())) delete state.tokens[id]
  }
  function target(url) { if (url?.href !== resource.href) throw new InvalidTargetError('The exact MCP resource is required') }
  function scopes(values) { if (values?.length !== 1 || values[0] !== scope) throw new InvalidScopeError('Only botters:play is allowed') }
  async function upstream(path, agentToken, body) {
    let response
    try {
      const url = new URL(path, server)
      if (agentToken) url.searchParams.set('token', agentToken)
      response = await fetch(url, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(5000) })
    } catch { throw Object.assign(new ServerError('Botters authorization unavailable'), { status: 503 }) }
    if (response.status === 401 || response.status === 410) throw Object.assign(new InvalidTokenError('Botters approval revoked or expired'), { status: 401 })
    if (!response.ok) throw Object.assign(new ServerError('Botters authorization unavailable'), { status: 503 })
    try { return await response.json() } catch { throw Object.assign(new ServerError('Invalid Botters authorization response'), { status: 503 }) }
  }
  async function checkGrant(id) {
    if (!active(id)) throw Object.assign(new InvalidTokenError('Invalid or expired grant'), { status: 401 })
    const grant = state.grants[id]
    try {
      if ((await upstream('/agent/poll', grant.agentToken)).approved !== true) throw Object.assign(new InvalidTokenError('Botters approval required'), { status: 401 })
    } catch (e) {
      if (e.status === 401) { grant.revoked = true; persist() }
      throw e
    }
    if (!active(id)) throw Object.assign(new InvalidTokenError('Invalid or expired grant'), { status: 401 })
    return grant
  }
  function issueTokens(grantId) {
    cleanup()
    if (Object.keys(state.tokens).length > 8190) throw new ServerError('Token history capacity reached')
    const access_token = secret(), refresh_token = secret(), expires = Math.min(now() + 600000, state.grants[grantId].expires)
    state.tokens[hash(access_token)] = { kind: 'access', grantId, expires }
    state.tokens[hash(refresh_token)] = { kind: 'refresh', grantId, expires: state.grants[grantId].expires, spent: false }
    return { access_token, refresh_token, token_type: 'Bearer', expires_in: Math.max(0, Math.floor((expires - now()) / 1000)), scope }
  }
  function codeRecord(client, code) {
    const entry = typeof code === 'string' && state.codes[hash(code)]
    if (!entry || entry.clientId !== client.client_id || entry.expires <= now() || !active(entry.grantId)) throw new InvalidGrantError('Invalid authorization code')
    return entry
  }
  const provider = {
    clientsStore: {
      getClient: async id => Object.hasOwn(state.clients, id) ? state.clients[id] : undefined,
      registerClient: async client => {
        if (Object.keys(state.clients).length >= 256) throw new ServerError('Client capacity reached')
        if (Buffer.byteLength(JSON.stringify(client)) > 16384 || client.token_endpoint_auth_method !== 'none' || client.grant_types?.some(type => !['authorization_code', 'refresh_token'].includes(type)) || client.response_types?.some(type => type !== 'code') || (client.scope !== undefined && client.scope !== scope) || !client.redirect_uris.length || client.redirect_uris.length > 8 || (client.client_name?.length || 0) > 200 || client.redirect_uris.some(value => {
          const u = new URL(value)
          return u.username || u.password || u.hash || value.length > 2048 || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))
        })) throw new InvalidClientMetadataError('Only public PKCE clients with HTTPS or loopback callbacks are supported')
        const stored = { ...client }; delete stored.client_secret; delete stored.client_secret_expires_at
        state.clients[client.client_id] = stored; persist(); return stored
      }
    },
    async authorize(client, params, res) {
      target(params.resource); scopes(params.scopes); cleanup()
      if (!client.redirect_uris.includes(params.redirectUri) || !/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge) || (params.state?.length || 0) > 2048) throw new InvalidRequestError('Invalid callback, PKCE challenge or state')
      if (pending.size >= 128) throw new ServerError('Pending approval capacity reached')
      // Reserve before the network await so concurrent requests cannot bypass the ceiling.
      const id = secret(), browser = secret()
      pending.set(id, { expires: now() + 600000 })
      try {
        const pair = await upstream('/agent/pair', undefined, { setup: 'MCP OAuth' })
        const url = new URL(pair.approvalUrl)
        if (!/^[\w-]{32}$/.test(pair.id) || !/^[\w-]{32}$/.test(pair.agentToken) || pair.expiresIn !== 600 || url.origin !== server || url.username || url.password || url.pathname !== '/' || url.hash || url.search !== `?pair=${pair.id}`) throw new ServerError('Invalid Botters approval link')
        if (closed) throw new ServerError('Authorization service closed')
        pending.set(id, { clientId: client.client_id, name: client.client_name || 'Unnamed application', ...params, resource: resource.href, browserHash: hash(browser), agentToken: pair.agentToken, approvalUrl: url.href, expires: now() + 600000 })
        res.setHeader('Set-Cookie', `botters_oauth_${id}=${browser}; Path=/consent; HttpOnly; SameSite=Lax; Max-Age=600${issuer.protocol === 'https:' ? '; Secure' : ''}`)
        res.redirect(302, '/consent?transaction=' + id)
      } catch (e) { pending.delete(id); throw e }
    },
    async challengeForAuthorizationCode(client, code) { return codeRecord(client, code).codeChallenge },
    async exchangeAuthorizationCode(client, code, _verifier, redirectUri, url) {
      target(url)
      const record = codeRecord(client, code)
      if (record.redirectUri !== redirectUri) throw new InvalidGrantError('Callback mismatch')
      await checkGrant(record.grantId)
      if (codeRecord(client, code) !== record) throw new InvalidGrantError('Authorization code already used')
      const tokens = issueTokens(record.grantId)
      delete state.codes[hash(code)]; persist(); return tokens
    },
    async exchangeRefreshToken(client, refreshToken, requestedScopes, url) {
      target(url)
      if (requestedScopes !== undefined) scopes(requestedScopes)
      const entry = state.tokens[hash(refreshToken)]
      if (!entry || entry.kind !== 'refresh' || state.grants[entry.grantId]?.clientId !== client.client_id || !active(entry.grantId) || entry.expires <= now()) throw new InvalidGrantError('Invalid refresh token')
      if (entry.spent) { state.grants[entry.grantId].revoked = true; persist(); throw new InvalidGrantError('Refresh token reuse') }
      await checkGrant(entry.grantId)
      if (entry.spent) { state.grants[entry.grantId].revoked = true; persist(); throw new InvalidGrantError('Refresh token reuse') }
      const tokens = issueTokens(entry.grantId)
      entry.spent = true; persist(); return tokens
    },
    async revokeToken(client, { token }) {
      const entry = state.tokens[hash(token)]
      const grant = entry && state.grants[entry.grantId]
      if (grant?.clientId === client.client_id) { grant.revoked = true; persist() }
    }
  }
  const app = createMcpExpressApp({ allowedHosts: [issuer.hostname] })
  const options = { provider, issuerUrl: issuer, resourceServerUrl: resource, resourceName: 'Botters', scopesSupported: [scope] }
  // The SDK unconditionally advertises confidential clients; this provider supports public PKCE clients only.
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    // SDK OAuth handlers flatten ServerError.status to 500. Failures are unavailable, not invalid grants.
    const status = res.status
    res.status = function (code) { return status.call(this, code === 500 ? 503 : code) }
    next()
  })
  app.get('/.well-known/oauth-authorization-server', (_req, res) => res.set('Access-Control-Allow-Origin', '*').json({ ...createOAuthMetadata(options), token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'] }))
  // createMcpExpressApp already installs the JSON parser; consent POSTs deliberately use JSON.
  app.use('/consent', async (req, res) => {
    const nonce = secret()
    res.set({ 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' })
    try {
      let body = req.body
      if (req.method === 'POST' && req.is('application/x-www-form-urlencoded')) {
        let text = ''
        for await (const chunk of req) { text += chunk; if (text.length > 4096) { res.status(413).end(); return } }
        body = Object.fromEntries(new URLSearchParams(text))
      }
      const id = req.method === 'GET' ? req.query.transaction : body?.transaction
      const p = typeof id === 'string' && pending.get(id)
      const cookie = req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith(`botters_oauth_${id}=`))?.split('=')[1]
      if (!p || !cookie || hash(cookie) !== p.browserHash) { res.status(403).json({ error: 'Invalid browser transaction' }); return }
      if (p.expires <= now()) { pending.delete(id); res.status(410).json({ error: 'Approval expired' }); return }
      if (req.method === 'GET' && req.path === '/') {
        // Chromium also checks a form's redirect target; permit only this registered callback origin.
        res.set('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; style-src 'unsafe-inline'; form-action 'self' ${new URL(p.redirectUri).origin}; base-uri 'none'; frame-ancestors 'none'`)
        // no-referrer makes Chromium send Origin:null on native form POSTs; keep strict Origin checks.
        res.set('Referrer-Policy', 'same-origin')
        res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
          <title>Approve Botters access</title><main style="max-width:42rem;margin:3rem auto;padding:0 1rem;font:1rem/1.5 system-ui">
          <h1>Connect an AI agent to Botters</h1>
          <p>Application name (supplied by the application, not verified): <strong>${escape(p.name)}</strong></p>
          <p>Registered callback origin: <strong>${escape(new URL(p.redirectUri).origin)}</strong></p>
          <p>This agent can read your match and doctrine, submit gambits and use agent controls. It cannot manage your account or start a match for you. Approval replaces your previous agent.</p>
          <p>Access lasts up to seven days, including while signed out. Use Disconnect agent in the Botters lobby to revoke it.</p>
          <p><a href="${escape(p.approvalUrl)}" target="_blank" rel="noopener noreferrer">Sign in to Botters and approve (opens a new tab)</a></p>
          <p id="status" role="status">Waiting for your approval in Botters. Keep this tab open.</p>
          <form method="post" action="/consent/cancel"><input type="hidden" name="transaction" value="${id}"><button>Cancel</button></form>
          <script nonce="${nonce}">
          const transaction = ${JSON.stringify(id)};
          async function poll() {
            try {
              const r = await fetch('/consent/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction }) });
              const d = await r.json();
              if (d.redirect) { location.assign(d.redirect); return; }
              if (!r.ok) {
                document.getElementById('status').textContent = r.status >= 500 ? 'Botters is unavailable. Retrying…' : d.error || 'Approval unavailable. Start the connection again in your assistant.';
                if (r.status < 500 && r.status !== 429) return;
              }
            } catch { document.getElementById('status').textContent = 'Connection lost. Retrying…'; }
            setTimeout(poll, 2000);
          }
          setTimeout(poll, 2000);
          </script></main></html>`)
        return
      }
      if (req.method !== 'POST' || req.headers.origin !== origin) { res.status(403).json({ error: 'Same-origin POST required' }); return }
      if (req.path === '/cancel') {
        pending.delete(id)
        const callback = new URL(p.redirectUri); callback.searchParams.set('error', 'access_denied'); if (p.state !== undefined) callback.searchParams.set('state', p.state)
        res.redirect(303, callback.href); return
      }
      if (req.path !== '/complete') { res.status(404).end(); return }
      const result = await upstream('/agent/poll', p.agentToken)
      if (pending.get(id) !== p || p.expires <= now() || closed) { res.status(410).json({ error: 'Approval expired' }); return }
      if (result.approved === false) { res.json({ approved: false }); return }
      if (result.approved !== true) throw new ServerError('Invalid Botters approval response')
      cleanup()
      if (Object.keys(state.grants).length >= 512 || Object.keys(state.codes).length >= 256) throw new ServerError('Grant capacity reached')
      const grantId = secret(), code = secret()
      state.grants[grantId] = { clientId: p.clientId, agentToken: p.agentToken, expires: now() + 7 * 86400000, revoked: false }
      state.codes[hash(code)] = { clientId: p.clientId, grantId, codeChallenge: p.codeChallenge, redirectUri: p.redirectUri, expires: now() + 120000 }
      pending.delete(id); persist()
      const callback = new URL(p.redirectUri); callback.searchParams.set('code', code); if (p.state !== undefined) callback.searchParams.set('state', p.state)
      res.json({ redirect: callback.href })
    } catch (e) { res.status(e.status || 503).json({ error: e.status === 401 ? 'Approval expired or revoked' : 'Authorization unavailable' }) }
  })
  app.use(mcpAuthRouter(options))
  app.use((error, _req, res, _next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' })
    res.status(error.status === 413 ? 413 : 400).json({ error: 'invalid_request' })
  })
  const routes = new Set(['/authorize', '/token', '/register', '/revoke', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource/mcp', '/consent', '/consent/complete', '/consent/cancel'])
  return {
    isRoute: path => routes.has(path), handle: (req, res) => app(req, res), isActive: active,
    async authenticate(req) {
      const value = req.headers.authorization
      const token = typeof value === 'string' && /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(value)?.[1]
      const entry = token && state.tokens[hash(token)]
      if (!entry || entry.kind !== 'access' || entry.expires <= now()) throw Object.assign(new InvalidTokenError('Invalid or expired access token'), { status: 401 })
      const grant = await checkGrant(entry.grantId)
      if (entry.expires <= now()) throw Object.assign(new InvalidTokenError('Access token expired'), { status: 401 })
      return { grantId: entry.grantId, clientId: grant.clientId, agentToken: grant.agentToken, expiresAt: entry.expires }
    },
    close() { closed = true; pending.clear() }
  }
}
