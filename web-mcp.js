#!/usr/bin/env node
// Loopback-only remote bridge; OAuth reuses Botters' verified player approval.
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { InitializeRequestSchema, ListToolsRequestSchema, ListToolsResultSchema, CallToolRequestSchema, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { createMcpOAuth } from './mcp-oauth.js'

function safeOrigin(value) {
  const url = new URL(value)
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
    !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Explicit HTTPS origin required (HTTP allowed only on loopback).')
  return url
}

export function createWebMcp({ server: upstream, origin, oauth = {}, maxSessions = 8, maxRequestBytes = 65536, idleMs = 600000 } = {}) {
  const game = safeOrigin(upstream), publicURL = safeOrigin(origin)
  for (const value of [maxSessions, maxRequestBytes, idleMs]) if (!Number.isSafeInteger(value) || value <= 0 || value > 2147483647) throw new Error('Limits must be finite positive integers within timer range.')
  if (oauth !== false && (!oauth || typeof oauth !== 'object' || Array.isArray(oauth))) throw new Error('Explicit OAuth configuration required.')
  const authorization = oauth === false ? null : createMcpOAuth({ ...oauth, origin: publicURL.origin, server: game.origin })
  const sessions = new Map(), entries = new Set()
  let stopping = false, shutdown
  const send = (res, status, error) => {
    if (!res.headersSent && !res.destroyed) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error })) }
  }
  const unauthenticated = (res, status = 401, supplied = false) => {
    if (status === 401) res.setHeader('www-authenticate', `Bearer resource_metadata="${publicURL.origin}/.well-known/oauth-protected-resource/mcp", scope="botters:play"${supplied ? ', error="invalid_token"' : ''}`)
    return send(res, status, status === 401 ? 'Authentication required' : 'Authorization unavailable')
  }
  function dispose(entry) {
    if (entry.closing) return entry.closing
    entry.closing = (async () => {
      sessions.delete(entry.id)
      await entry.ready?.catch(() => {})
      await Promise.allSettled([entry.client.close(), entry.mcp.close()])
      entries.delete(entry)
    })()
    return entry.closing
  }
  async function startSession(principal) {
    const id = randomUUID()
    const stdio = new StdioClientTransport({
      command: process.execPath,
      // client.js normally reads .env. Disable that loader before importing it:
      // this gateway must never gain credentials from the checkout or parent.
      args: ['--input-type=module', '--eval', `process.loadEnvFile = () => {}; await import(${JSON.stringify(new URL('./client.js', import.meta.url).href)})`],
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      env: { BOTTERS_SERVER: game.origin, BOTTERS_OPEN: '0', BOTTERS_SETUP: 'web-mcp', ...(principal ? { BOTTERS_AGENT_TOKEN: principal.agentToken, BOTTERS_REQUIRE_AGENT_TOKEN: '1' } : {}) },
      stderr: 'ignore',
    })
    const client = new Client({ name: 'botters-web-bridge', version: '0.1.0' })
    const mcp = new Server({ name: 'botters', version: '0.2.0' }, { capabilities: { tools: {} } })
    const entry = { id, client, mcp, lastUsed: Date.now(), initialized: false, usedTools: false, busy: 0, grantId: principal?.grantId, clientId: principal?.clientId }
    entries.add(entry) // Reserve capacity before any async child startup.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => id, enableJsonResponse: true,
      onsessioninitialized: () => sessions.set(id, entry),
      onsessionclosed: () => dispose(entry),
    })
    entry.transport = transport
    async function forward(request, schema, extra) {
      if (authorization && !authorization.isActive(entry.grantId)) throw new Error('Agent authorization ended')
      entry.busy++
      if (request.method === 'tools/call') entry.usedTools = true
      try { return await client.request(request, schema, { signal: extra.signal, timeout: 60000 }) }
      finally { entry.busy--; entry.lastUsed = Date.now() }
    }
    mcp.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
      const result = await forward(request, ListToolsResultSchema, extra)
      return { ...result, tools: result.tools.map(tool => ({ ...tool, annotations: {
        ...tool.annotations,
        readOnlyHint: tool.name === 'wait_for_event',
        // All other tools may create access requests, mutate a live match or notify a human.
        ...(tool.name !== 'wait_for_event' ? { destructiveHint: tool.name !== 'call_human', idempotentHint: false } : {}),
        openWorldHint: true,
      } })) }
    })
    mcp.setRequestHandler(CallToolRequestSchema, (request, extra) => forward(request, CallToolResultSchema, extra))
    entry.ready = (async () => {
      await client.connect(stdio, { timeout: 10000 })
      await mcp.connect(transport)
      client.onclose = () => { void dispose(entry) }
      mcp.onclose = () => { void dispose(entry) }
    })()
    try { await entry.ready; return entry }
    catch { await dispose(entry); throw new Error('Session startup failed') }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store')
    res.setHeader('referrer-policy', 'no-referrer')
    let created
    try {
      // Never trust forwarded headers; the HTTPS tunnel must preserve this exact Host.
      if (req.headers.host !== publicURL.host) return send(res, 403, 'Forbidden host or origin')
      if (stopping) return send(res, 503, 'Gateway stopping')
      if (authorization?.isRoute(new URL(req.url, publicURL).pathname)) return authorization.handle(req, res)
      if (req.headers.origin !== undefined && req.headers.origin !== publicURL.origin) return send(res, 403, 'Forbidden host or origin')
      if (req.url === '/health') {
        if (req.method !== 'GET') return send(res, 405, 'Method not allowed')
        const toolSessions = [...entries].filter(entry => entry.usedTools).length
        res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ sessions: entries.size, toolSessions, discoverySessions: entries.size - toolSessions }))
      }
      if (req.url !== '/mcp') return send(res, 404, 'Not found')
      if (!['POST', 'GET', 'DELETE'].includes(req.method)) return send(res, 405, 'Method not allowed')
      let principal
      if (authorization) {
        try { principal = await authorization.authenticate(req) }
        catch (error) { return unauthenticated(res, error.status === 401 ? 401 : 503, !!req.headers.authorization) }
      }
      const id = req.headers['mcp-session-id']
      if (id !== undefined && (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))) return send(res, 400, 'Invalid session ID')
      let entry = id && sessions.get(id)
      if (id && !entry) return send(res, 404, 'Unknown session')
      if (entry && principal && (entry.grantId !== principal.grantId || entry.clientId !== principal.clientId)) return send(res, 404, 'Unknown session')
      let body
      if (req.method === 'POST') {
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return send(res, 415, 'JSON required')
        let size = 0; const chunks = []
        if (Number(req.headers['content-length']) > maxRequestBytes) return send(res, 413, 'Request too large')
        for await (const chunk of req) {
          size += chunk.length
          if (size > maxRequestBytes) { send(res, 413, 'Request too large'); return }
          chunks.push(chunk)
        }
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return send(res, 400, 'Invalid JSON') }
      }
      if (!entry) {
        if (req.method !== 'POST' || !InitializeRequestSchema.safeParse(body).success) return send(res, 400, 'Initialize a session first')
        if (entries.size >= maxSessions) {
          // Discovery has no game capability; a tool session may own approval or a live match.
          const discovery = [...entries].filter(e => e.initialized && !e.usedTools && !e.busy && !e.closing).sort((a, b) => a.lastUsed - b.lastUsed)[0]
          if (discovery) await dispose(discovery)
          // Cleanup yielded: another initializer may already have reserved the released slot.
          if (entries.size >= maxSessions) { res.setHeader('retry-after', '1'); return send(res, 429, 'Session limit reached') }
        }
        entry = created = await startSession(principal)
        if (stopping || res.destroyed) { await dispose(entry); return send(res, 503, 'Gateway stopping') }
      }
      // Body reads/child startup yielded; another request may have revoked this grant.
      if (principal && (!authorization.isActive(principal.grantId) || principal.expiresAt <= Date.now())) {
        if (entry) await dispose(entry)
        return unauthenticated(res, 401, true)
      }
      entry.lastUsed = Date.now()
      await entry.transport.handleRequest(req, res, body)
      entry.lastUsed = Date.now()
      if (created) {
        if (sessions.has(entry.id)) entry.initialized = true
        else await dispose(entry)
      }
    } catch {
      if (created) await dispose(created)
      send(res, 500, 'MCP request failed') // Never log arguments, results or child errors.
    }
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  const timer = setInterval(() => {
    for (const entry of entries) if (authorization && !authorization.isActive(entry.grantId) || !entry.busy && Date.now() - entry.lastUsed >= idleMs) void dispose(entry)
  }, Math.min(idleMs, 1000))
  timer.unref()
  function close() {
    return shutdown ||= (async () => {
      stopping = true; clearInterval(timer)
      const closed = new Promise(resolve => server.close(resolve))
      await Promise.all([...entries].map(dispose))
      await authorization?.close()
      server.closeAllConnections()
      await closed
    })()
  }
  server.on('close', () => { void close() })
  return { server, close }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const app = createWebMcp({ server: process.env.BOTTERS_SERVER, origin: process.env.BOTTERS_MCP_ORIGIN,
      oauth: process.env.BOTTERS_MCP_ALLOW_NO_AUTH === '1' ? false : { stateFile: process.env.BOTTERS_MCP_OAUTH_STATE } })
    if (process.env.BOTTERS_MCP_ALLOW_NO_AUTH === '1') console.error('Transport authentication explicitly disabled for the temporary pilot.')
    const port = Number(process.env.PORT || 8798)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port')
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close() })
    app.server.on('error', () => { console.error('Gateway listener failed'); void app.close(); process.exitCode = 1 })
    app.server.listen(port, '127.0.0.1', () => console.error(`Botters MCP listening on loopback port ${port}`))
  } catch { console.error('Invalid gateway configuration'); process.exitCode = 1 }
}
