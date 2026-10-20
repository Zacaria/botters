import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { MemoryStore } from '../online/store.js'
import { createHandler } from '../online/http.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

// Node fetch controls Host; use node:http to emulate a tunnel preserving public Host.
const tunnelFetch = (url, init = {}) => new Promise((resolve, reject) => {
  const req = http.request(url, { method: init.method || 'GET', headers: Object.fromEntries(new Headers(init.headers)), signal: init.signal }, res => {
    const headers = new Headers(); for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1])
    resolve(new Response([204, 205, 304].includes(res.statusCode) ? null : Readable.toWeb(res), { status: res.statusCode, headers }))
  })
  req.on('error', reject); req.end(init.body)
})
const root = new URL('../', import.meta.url).pathname
const sleep = ms => new Promise(r => setTimeout(r, ms))
const children = async (pid = process.pid) => process.platform === 'linux' ? (await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8')).trim().split(/\s+/).filter(Boolean).map(Number) : []
async function exited(pids) {
  for (let i = 0; i < 100; i++) {
    const alive = pids.filter(pid => { try { process.kill(pid, 0); return true } catch { return false } })
    if (!alive.length) return
    await sleep(25)
  }
  assert.fail('Gateway child survived cleanup')
}
const childArgs = ['--input-type=module', '--eval', `process.loadEnvFile = () => {}; await import(${JSON.stringify(new URL('../client.js', import.meta.url).href)})`]
async function listen(server) {
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${server.address().port}`
}
async function stop(server) {
  server.closeAllConnections()
  await new Promise(r => server.close(r))
}
async function fixture(t) {
  const probe = http.createServer(), origin = await listen(probe)
  await stop(probe)
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { PATH: process.env.PATH, PORT: new URL(origin).port, BOTTERS_ORIGIN: origin, BOTTERS_START_DELAY: '1' }, stdio: 'ignore' })
  t.after(async () => { child.kill(); if (child.exitCode === null) await new Promise(r => child.once('exit', r)) })
  let ready = false
  for (let i = 0; i < 100 && !ready; i++) { ready = await fetch(origin + '/rules').then(r => r.ok, () => false); if (!ready) await sleep(25) }
  assert.ok(ready, 'real offline game started')
  // Shorten only the real game's long poll; every result still comes from server.js.
  const relay = http.createServer(async (req, res) => {
    const url = new URL(req.url, origin)
    if (url.pathname === '/next') url.searchParams.set('timeout', '0')
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const response = await fetch(url, { method: req.method, headers: { 'content-type': 'application/json' }, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) })
    res.writeHead(response.status, { 'content-type': 'application/json' }); res.end(await response.text())
  })
  const upstream = await listen(relay)
  t.after(() => stop(relay))
  return { upstream, origin }
}
async function gateway(t, options = {}) {
  const { createWebMcp } = await import('../web-mcp.js')
  const app = createWebMcp({ server: 'http://127.0.0.1:1', origin: 'https://pilot.example', oauth: false, ...options })
  const local = await listen(app.server)
  t.after(() => app.close())
  const headers = { host: 'pilot.example', origin: 'https://pilot.example' }
  const request = (path, init = {}) => tunnelFetch(local + path, { ...init, headers: { ...headers, ...init.headers } })
  const connect = async accessToken => {
    const responses = []
    const connectHeaders = { ...headers, ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) }
    const transport = new StreamableHTTPClientTransport(new URL(local + '/mcp'), { requestInit: { headers: connectHeaders }, fetch: async (url, init) => {
      const response = await tunnelFetch(url, init)
      responses.push({ method: init?.method || 'GET', status: response.status, type: response.headers.get('content-type') })
      return response
    } })
    const client = new Client({ name: 'web-pilot-test', version: '1.0.0' })
    t.after(() => client.close())
    await client.connect(transport)
    return { client, transport, responses }
  }
  return { app, request, connect }
}
const data = result => JSON.parse(result.content[0].text)
const toolNames = ['join_match', 'wait_for_event', 'set_gambits', 'order_swarm', 'split_swarm', 'morph_swarm', 'release_swarm', 'call_human'].sort()
const assertTools = tools => assert.deepEqual(tools.map(t => t.name).sort(), toolNames)

test('OAuth protects every MCP request before allocating a child and advertises its canonical resource', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'botters-oauth-gateway-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const g = await gateway(t, { oauth: { stateFile: join(dir, 'state', 'oauth.json') } })
  for (const method of ['GET', 'POST', 'DELETE']) {
    const r = await g.request('/mcp', { method })
    assert.equal(r.status, 401, `${method} must require a token before parsing or starting a child`)
    assert.match(r.headers.get('www-authenticate'), /resource_metadata="https:\/\/pilot\.example\/\.well-known\/oauth-protected-resource\/mcp"/)
    assert.match(r.headers.get('www-authenticate'), /scope="botters:play"/)
  }
  assert.equal((await g.request('/mcp', { headers: { authorization: 'Bearer arbitrary-unissued-token' } })).status, 401)
  assert.equal((await g.request('/health').then(r => r.json())).sessions, 0)
  const metadata = await g.request('/.well-known/oauth-protected-resource/mcp')
  assert.equal(metadata.status, 200)
  assert.deepEqual(await metadata.json(), {
    resource: 'https://pilot.example/mcp', authorization_servers: ['https://pilot.example/'],
    scopes_supported: ['botters:play'], resource_name: 'Botters',
  })
})

test('approved OAuth grants own their real SDK sessions and children through refresh and revocation', { timeout: 20000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'botters-oauth-isolation-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const accounts = Object.fromEntries(['alice', 'bob'].map(id => [id, { id: `oauth-isolation-${id}`, name: id, emailVerified: true }]))
  let handler, pairRequests = 0
  const upstreamServer = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost')
    if (u.pathname === '/next') { u.searchParams.set('timeout', '0'); req.url = u.pathname + u.search }
    if (u.pathname === '/agent/pair') pairRequests++
    handler(req, res)
  })
  const upstream = await listen(upstreamServer)
  handler = createHandler(new MemoryStore(), { origin: upstream, env: { BOTTERS_AUTH_ORIGIN: upstream }, requireAccount: true, resolveAccount: async req => accounts[req.headers.cookie] || null })
  t.after(() => stop(upstreamServer))
  const g = await gateway(t, { server: upstream, oauth: { stateFile: join(dir, 'oauth.json') } })
  const form = (path, body, headers = {}) => g.request(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body).toString() })
  const login = async name => {
    const registration = await g.request('/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: name, redirect_uris: ['https://assistant.example/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] }) })
    assert.equal(registration.status, 201)
    const client = await registration.json(), verifier = 'v'.repeat(64)
    const begin = await g.request('/authorize?' + new URLSearchParams({ client_id: client.client_id, redirect_uri: client.redirect_uris[0], response_type: 'code', scope: 'botters:play', resource: 'https://pilot.example/mcp', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }))
    assert.equal(begin.status, 302)
    const cookie = begin.headers.get('set-cookie').split(';')[0], location = begin.headers.get('location')
    const html = await g.request(location, { headers: { cookie } }).then(r => r.text())
    const approval = new URL(html.match(/href="(http[^" ]+)"/)[1].replaceAll('&amp;', '&'))
    const humanPost = async (path, body) => {
      const r = await fetch(upstream + path, { method: 'POST', headers: { cookie: name, origin: upstream, 'content-type': 'application/json' }, body: JSON.stringify(body) })
      assert.equal(r.status, 200); return r.json()
    }
    const human = await humanPost('/session', {})
    await humanPost('/agent/approve?token=' + human.humanToken, { id: approval.searchParams.get('pair') })
    const completed = await form('/consent/complete', { transaction: new URL(location, 'https://pilot.example').searchParams.get('transaction') }, { cookie })
    assert.equal(completed.status, 200)
    const { redirect } = await completed.json()
    const issued = await form('/token', { client_id: client.client_id, grant_type: 'authorization_code', code: new URL(redirect).searchParams.get('code'), code_verifier: verifier, redirect_uri: client.redirect_uris[0], resource: 'https://pilot.example/mcp' })
    assert.equal(issued.status, 200)
    return { client, tokens: await issued.json() }
  }
  const alice = await login('alice'), bob = await login('bob')
  const a = await g.connect(alice.tokens.access_token), b = await g.connect(bob.tokens.access_token)
  assertTools((await a.client.listTools()).tools)
  assert.equal(data(await a.client.callTool({ name: 'join_match', arguments: {} })).waiting, true)
  const ownSession = { 'mcp-session-id': a.transport.sessionId }
  for (const method of ['GET', 'POST', 'DELETE']) {
    assert.equal((await g.request('/mcp', { method, headers: ownSession })).status, 401)
    assert.equal((await g.request('/mcp', { method, headers: { ...ownSession, authorization: 'Bearer ' + bob.tokens.access_token } })).status, 404)
  }
  const rotated = await form('/token', { client_id: alice.client.client_id, grant_type: 'refresh_token', refresh_token: alice.tokens.refresh_token, resource: 'https://pilot.example/mcp' }).then(r => r.json())
  assert.ok(rotated.access_token)
  const tools = await g.request('/mcp', { method: 'POST', headers: { ...ownSession, authorization: 'Bearer ' + rotated.access_token, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 9999, method: 'tools/list' }) })
  assert.equal(tools.status, 200)
  assertTools((await tools.json()).result.tools)
  assert.equal((await form('/revoke', { client_id: alice.client.client_id, token: rotated.refresh_token })).status, 200)
  assert.equal((await g.request('/mcp', { headers: { ...ownSession, authorization: 'Bearer ' + rotated.access_token } })).status, 401)
  assertTools((await b.client.listTools()).tools)
  assert.equal(data(await b.client.callTool({ name: 'join_match', arguments: {} })).waiting, true)
  assert.equal(pairRequests, 2, 'stdio children must reuse their approved grants, never create another pairing')
})

test('boundary checks reject wrong host/origin, oversized bodies and missing/invalid/unknown sessions', async t => {
  const g = await gateway(t, { maxRequestBytes: 1024 })
  for (const headers of [{ host: 'evil.example' }, { origin: 'https://evil.example' }, { origin: 'null' }, { host: 'pilot.example:443' }]) {
    assert.equal((await g.request('/health', { headers })).status, 403)
  }
  assert.equal((await g.request('/health', { headers: { origin: '' } })).status, 403)
  assert.equal((await g.request('/')).status, 404)
  assert.equal((await g.request('/mcp?extra=1')).status, 404)
  assert.equal((await g.request('/health', { method: 'POST' })).status, 405)
  for (const [id, status] of [['bad', 400], ['00000000-0000-4000-8000-000000000000', 404]]) {
    assert.equal((await g.request('/mcp', { headers: { 'mcp-session-id': id } })).status, status)
  }
  assert.equal((await g.request('/mcp')).status, 400)
  assert.equal((await g.request('/mcp', { method: 'DELETE' })).status, 400)
  const post = body => g.request('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body })
  assert.equal((await post('{')).status, 400)
  assert.equal((await post(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))).status, 400)
  assert.equal((await post('x'.repeat(1025))).status, 413)
  assert.equal((await g.request('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' }, body: 'x'.repeat(1025) })).status, 413)
  assert.equal((await g.request('/health').then(r => r.json())).sessions, 0)
})

test('bounded admission, idle expiry and process cleanup use real MCP children', { timeout: 15000 }, async t => {
  const f = await fixture(t), g = await gateway(t, { server: f.upstream, maxSessions: 1, idleMs: 1000 })
  const before = await children()
  const admissions = await Promise.allSettled([g.connect(), g.connect()])
  assert.equal(admissions.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(admissions.find(r => r.status === 'rejected').reason.code, 429)
  const first = admissions.find(r => r.status === 'fulfilled').value
  const owned = (await children()).filter(pid => !before.includes(pid))
  assert.equal(data(await first.client.callTool({ name: 'join_match', arguments: {} })).waiting, true)
  await assert.rejects(g.connect(), { code: 429 })
  const id = first.transport.sessionId
  assert.equal((await g.request('/health').then(r => r.json())).sessions, 1)
  for (let i = 0; i < 35 && (await g.request('/health').then(r => r.json())).sessions; i++) await sleep(100)
  assert.equal((await g.request('/health').then(r => r.json())).sessions, 0)
  assert.equal((await g.request('/mcp', { headers: { 'mcp-session-id': id } })).status, 404)
  await exited(owned)
  const next = await g.connect()
  assert.notEqual(next.transport.sessionId, id)
  await g.app.close()
  await assert.rejects(next.client.listTools())
})

test('repeated discovery cannot exhaust slots or evict a pending game approval', { timeout: 20000 }, async t => {
  const f = await fixture(t), g = await gateway(t, { server: f.upstream, maxSessions: 2 })
  const player = await g.connect()
  const pending = data(await player.client.callTool({ name: 'join_match', arguments: {} }))
  assert.equal(pending.waiting, true)
  const discovery = await g.connect()
  assertTools((await discovery.client.listTools()).tools)
  let latest
  for (let i = 0; i < 9; i++) {
    // Real SDK clients inspect tools without sending DELETE, as separate discovery consumers can.
    latest = await g.connect()
    assertTools((await latest.client.listTools()).tools)
    assertTools((await player.client.listTools()).tools)
  }
  assert.equal((await g.request('/mcp', { headers: { 'mcp-session-id': discovery.transport.sessionId } })).status, 404)
  assert.equal(data(await player.client.callTool({ name: 'join_match', arguments: {} })).tell_the_human, pending.tell_the_human)
  assert.deepEqual(await g.request('/health').then(r => r.json()), { sessions: 2, toolSessions: 1, discoverySessions: 1 })
  assert.equal(data(await latest.client.callTool({ name: 'join_match', arguments: {} })).waiting, true)
  await assert.rejects(g.connect(), { code: 429 })
  assert.deepEqual(await g.request('/health').then(r => r.json()), { sessions: 2, toolSessions: 2, discoverySessions: 0 })
})

test('tool errors and a dead child cannot poison another HTTP session', { timeout: 15000 }, async t => {
  const f = await fixture(t), g = await gateway(t, { server: f.upstream })
  const before = await children(), one = await g.connect()
  const owned = (await children()).filter(pid => !before.includes(pid))
  const two = await g.connect()
  const refused = await one.client.callTool({ name: 'not_a_tool', arguments: {} })
  assert.equal(refused.isError, true)
  assertTools((await two.client.listTools()).tools)
  if (process.platform === 'linux') {
    assert.equal(owned.length, 1)
    process.kill(owned[0], 'SIGKILL')
    await exited(owned)
    for (let i = 0; i < 30 && (await g.request('/health').then(r => r.json())).sessions !== 1; i++) await sleep(25)
    assert.equal((await g.request('/health').then(r => r.json())).sessions, 1)
    assertTools((await two.client.listTools()).tools)
    await assert.rejects(one.client.listTools())
  }
})

test('CLI consumes explicit configuration, binds loopback, and SIGTERM reaps its real client', { timeout: 15000 }, async t => {
  const f = await fixture(t), probe = http.createServer(), local = await listen(probe)
  await stop(probe)
  const child = spawn(process.execPath, ['web-mcp.js'], { cwd: root, stdio: 'ignore', env: { PATH: process.env.PATH, BOTTERS_SERVER: f.upstream, BOTTERS_MCP_ORIGIN: 'https://pilot.example', BOTTERS_MCP_ALLOW_NO_AUTH: '1', PORT: new URL(local).port } })
  t.after(async () => { child.kill(); if (child.exitCode === null) await new Promise(r => child.once('exit', r)) })
  let ready = false
  for (let i = 0; i < 100 && !ready; i++) { ready = await tunnelFetch(local + '/health', { headers: { host: 'pilot.example' } }).then(r => r.status === 200, () => false); if (!ready) await sleep(25) }
  assert.ok(ready)
  const transport = new StreamableHTTPClientTransport(new URL(local + '/mcp'), { requestInit: { headers: { host: 'pilot.example' } }, fetch: tunnelFetch })
  const client = new Client({ name: 'cli-test', version: '1' }); t.after(() => client.close()); await client.connect(transport)
  assertTools((await client.listTools()).tools)
  const owned = await children(child.pid)
  if (process.platform === 'linux') assert.equal(owned.length, 1)
  const finished = new Promise(r => child.once('exit', r)); child.kill('SIGTERM'); await finished
  await exited(owned)
})

test('configuration requires explicit safe origins and finite resource bounds', async () => {
  const { createWebMcp } = await import('../web-mcp.js')
  for (const options of [
    {}, { server: 'http://example.com', origin: 'https://pilot.example' },
    { server: 'https://user:password@example.com', origin: 'https://pilot.example' },
    { server: 'https://example.com/path', origin: 'https://pilot.example' },
    { server: 'https://example.com', origin: 'http://pilot.example' },
    { server: 'https://example.com', origin: 'https://pilot.example/path' },
    ...['maxSessions', 'maxRequestBytes', 'idleMs'].flatMap(key => [0, Infinity, -1, 1.5].map(value => ({ server: 'https://example.com', origin: 'https://pilot.example', [key]: value }))),
  ]) assert.throws(() => createWebMcp(options))
})

test('real HTTP/stdio gateway discovers and executes eight tools with isolated lobby identities', { timeout: 30000 }, async t => {
  const f = await fixture(t), g = await gateway(t, { server: f.upstream })
  const directTransport = new StdioClientTransport({ command: process.execPath, args: childArgs, cwd: root, env: { BOTTERS_SERVER: f.upstream, BOTTERS_OPEN: '0' }, stderr: 'ignore' })
  const direct = new Client({ name: 'schema-reference', version: '1' }); t.after(() => direct.close()); await direct.connect(directTransport)
  const before = await children()
  const one = await g.connect(), two = await g.connect()
  const owned = (await children()).filter(pid => !before.includes(pid))
  if (process.platform === 'linux') assert.equal(owned.length, 2, 'one actual stdio child per session')
  assert.notEqual(one.transport.sessionId, two.transport.sessionId)
  assert.match(one.transport.sessionId, /^[0-9a-f-]{36}$/)
  const listed = await one.client.listTools(), reference = await direct.listTools()
  const streamAbort = new AbortController()
  const stream = await g.request('/mcp', { headers: { accept: 'text/event-stream', 'mcp-session-id': one.transport.sessionId }, signal: streamAbort.signal })
  assert.equal(stream.status, 409, 'SDK client already owns the single standard GET stream')
  assert.ok(one.responses.some(r => r.method === 'GET' && r.status === 200 && r.type.includes('text/event-stream')))
  assert.ok(one.responses.some(r => r.method === 'POST' && r.status === 200 && r.type.includes('application/json')))
  streamAbort.abort()
  assertTools(listed.tools)
  assert.deepEqual(listed.tools.map(({ annotations, ...tool }) => tool), reference.tools)
  for (const tool of listed.tools) {
    assert.equal(tool.annotations.openWorldHint, true)
    assert.equal(tool.annotations.readOnlyHint, tool.name === 'wait_for_event')
  }
  const waiting = await Promise.all([one, two].map(c => c.client.callTool({ name: 'join_match', arguments: {} }).then(data)))
  assert.ok(waiting.every(r => r.waiting))
  const lobbies = waiting.map(r => new URL(r.tell_the_human.match(/http:\/\/\S+/)[0]))
  assert.notEqual(lobbies[0].searchParams.get('s'), lobbies[1].searchParams.get('s'))
  const token = lobbies[0].searchParams.get('s')
  const post = (path, body) => fetch(f.origin + path, { method: 'POST', body: JSON.stringify(body) }).then(r => r.json())
  assert.deepEqual(await post(`/play?token=${token}`, { vs: 'easy', minutes: 3, planets: 16, withAgent: true }), { ok: true })
  const joined = data(await one.client.callTool({ name: 'join_match', arguments: {} }))
  assert.ok(joined.state && joined.rules)
  const swarm = Number(joined.state.yourSwarms[0].match(/^#(\d+)/)[1])
  for (const [name, args] of [
    ['set_gambits', { gambits: [{ if: 'always', then: 'hold' }], why: 'offline fixture' }],
    ['order_swarm', { swarm, x: 100, y: 100, why: 'offline fixture' }],
    ['split_swarm', { swarm, why: 'offline fixture' }],
    ['morph_swarm', { swarm, type: 'spore', why: 'offline fixture' }],
    ['release_swarm', { swarm }],
    ['call_human', { message: 'offline fixture' }],
  ]) {
    await sleep(230) // Real game input rate limit remains enabled.
    assert.equal(data(await one.client.callTool({ name, arguments: args })).ok, true, name)
  }
  assert.ok(data(await one.client.callTool({ name: 'wait_for_event', arguments: { timeout_s: 1 } })).state)
  assert.match((await two.client.callTool({ name: 'call_human', arguments: { message: 'not joined' } })).content[0].text, /Not in a match/)
  const frame = await fetch(`${f.origin}/state?token=${token}`).then(r => r.json())
  assert.ok(frame.calls.some(c => c.message === 'offline fixture'))
  assert.deepEqual(frame.view.gambits, [{ if: 'always', then: 'hold', on: true }])
  assert.equal(frame.view.swarms.find(s => s.id === swarm).type, 'spore')
  assert.equal((await g.request('/health').then(r => r.json())).sessions, 2)
  await one.transport.terminateSession()
  assert.equal((await g.request('/health').then(r => r.json())).sessions, 1)
  await g.app.close()
  await exited(owned)
  await assert.rejects(two.client.listTools())
})
