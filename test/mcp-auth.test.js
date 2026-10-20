import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { z } from 'zod'
import { OnlineGame } from '../online/game.js'
import { MemoryStore } from '../online/store.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

test('two actual MCP processes explicitly reapprove revoked agents and resume the same match', { timeout: 125000 }, async t => {
  const origin = 'http://127.0.0.1:8790'
  const liveOrigin = 'http://127.0.0.1:8791'
  const fixture = spawn(process.execPath, ['scripts/auth-dev.js'], { env: { ...process.env, PORT: '8790' }, stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(() => fixture.kill())
  await Promise.race([once(fixture.stdout, 'data'), once(fixture, 'exit').then(() => { throw new Error('Isolated auth fixture exited early') })])
  const post = (path, data, cookie) => fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(data) })
  const livePost = (path, data, cookie) => fetch(liveOrigin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(data) })
  const clients = await Promise.all(['one', 'two'].map(async name => {
    const transport = new StdioClientTransport({ command: process.execPath, args: ['client.js'], env: { ...process.env, BOTTERS_SERVER: origin, BOTTERS_OPEN: '0', BOTTERS_SETUP: `mcp-test-${name}`, BOTTERS_AGENT_TOKEN: '' }, stderr: 'pipe' })
    const client = new Client({ name: `auth-test-${name}`, version: '1.0.0' }); await client.connect(transport)
    t.after(() => client.close())
    return client
  }))
  const waiting = await Promise.all(clients.map(c => c.callTool({ name: 'join_match', arguments: {} }, undefined, { timeout: 30000 })))
  const humans = []
  for (const [i, result] of waiting.entries()) {
    const returned = JSON.parse(result.content[0].text)
    assert.equal(returned.waiting, true)
    assert.ok(!JSON.stringify(returned).includes('humanToken'))
    const pairURL = new URL(returned.tell_the_human.match(/http:\/\/\S+/)[0])
    const email = `mcp-${i}@example.test`
    assert.equal((await post('/api/auth/sign-up/email', { email, password: 'isolated-mcp-password-327!', name: `MCP Human ${i}`, callbackURL: '/' })).status, 200)
    const mail = await fetch(`${origin}/test/mail?email=${email}`).then(r => r.json())
    const verified = await fetch(mail.at(-1).text.match(/http:\/\/\S+/)[0], { redirect: 'manual' })
    const cookie = verified.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
    const session = await post('/session', {}, cookie).then(r => r.json())
    const exchanged = await livePost('/exchange', { ticket: session.liveTicket })
    assert.equal(exchanged.status, 200)
    const liveCookie = exchanged.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
    assert.equal(session.agentToken, undefined)
    assert.equal((await post(`/agent/approve?token=${session.humanToken}`, { id: pairURL.searchParams.get('pair') }, cookie)).status, 200)
    humans.push({ ...session, cookie: liveCookie, authCookie: cookie })
  }
  const options = { minutes: 8, planning: 10, planets: 16, withAgent: true }
  const room = await livePost(`/rooms?token=${humans[0].humanToken}`, options, humans[0].cookie).then(r => r.json())
  assert.equal((await livePost(`/rooms/join?token=${humans[1].humanToken}`, { ...options, code: room.code }, humans[1].cookie)).status, 200)
  assert.equal((await livePost(`/rooms/start?token=${humans[0].humanToken}`, options, humans[0].cookie)).status, 200)
  const joined = await Promise.all(clients.map(c => c.callTool({ name: 'join_match', arguments: {} }, undefined, { timeout: 30000 })))
  for (const result of joined) { const data = JSON.parse(result.content[0].text); assert.ok(data.rules); assert.ok(data.state); assert.ok(!JSON.stringify(data).includes('humanToken')) }
  for (const client of clients) {
    const result = await client.callTool({ name: 'set_gambits', arguments: { gambits: [{ if: 'free_planet', then: 'go' }, { if: 'always', then: 'hold' }], why: 'isolated actual MCP regression' } })
    assert.equal(result.isError, undefined)
    assert.equal(JSON.parse(result.content[0].text).ok, true)
  }
  const before = await fetch(`${liveOrigin}/state?token=${humans[0].humanToken}`, { headers: { cookie: humans[0].cookie } }).then(r => r.json())
  assert.ok(before.matchId)
  for (const human of humans) assert.equal((await post(`/agent/revoke?token=${human.humanToken}`, {}, human.authCookie)).status, 200)
  for (const [i, client] of clients.entries()) {
    const denied = await client.callTool({ name: i ? 'call_human' : 'wait_for_event', arguments: i ? { message: 'revoked agent' } : { timeout_s: 1 } })
    assert.match(denied.content[0].text, /join_match/, 'capability refusal must guide explicit reconnection')
    for (const [name, args] of gameplay) assert.match((await client.callTool({ name, arguments: args })).content[0].text, /join_match/)
  }
  const reapproval = await Promise.all(clients.map(c => c.callTool({ name: 'join_match', arguments: {} }, undefined, { timeout: 30000 })))
  for (const [i, result] of reapproval.entries()) {
    const pending = JSON.parse(result.content[0].text)
    assert.equal(pending.waiting, true)
    for (const [name, args] of gameplay) assert.match((await clients[i].callTool({ name, arguments: args })).content[0].text, /join_match/, 'pending approval cannot retain match access')
    const pairURL = new URL(pending.tell_the_human.match(/http:\/\/\S+/)[0])
    assert.equal((await post(`/agent/approve?token=${humans[i].humanToken}`, { id: pairURL.searchParams.get('pair') }, humans[i].authCookie)).status, 200)
  }
  for (const [i, client] of clients.entries()) {
    const resumed = JSON.parse((await client.callTool({ name: 'join_match', arguments: {} }, undefined, { timeout: 30000 })).content[0].text)
    assert.ok(resumed.rules && resumed.state && !resumed.state.ended)
    const initial = JSON.parse(joined[i].content[0].text)
    assert.deepEqual(resumed.rules, initial.rules)
    assert.equal(resumed.doctrine, initial.doctrine)
    const acted = await client.callTool({ name: 'set_gambits', arguments: { gambits: [{ if: 'always', then: 'hold' }], why: 'explicitly reapproved' } })
    assert.equal(JSON.parse(acted.content[0].text).ok, true)
  }
  const after = await fetch(`${liveOrigin}/state?token=${humans[0].humanToken}`, { headers: { cookie: humans[0].cookie } }).then(r => r.json())
  assert.equal(after.matchId, before.matchId, 'reapproval must not create another match')
  let frame
  for (let i = 0; i < 250; i++) {
    frame = await fetch(`${liveOrigin}/state?token=${humans[0].humanToken}`, { headers: { cookie: humans[0].cookie } }).then(r => r.json())
    if (frame.report) break
    await new Promise(r => setTimeout(r, 200))
  }
  assert.ok(frame.report, 'real accelerated match produced a replay report')
  for (const h of humans) { const lobby = await fetch(`${liveOrigin}/lobby?token=${h.humanToken}`, { headers: { cookie: h.cookie } }).then(r => r.json()); assert.equal(lobby.history.length, 1); assert.equal(lobby.leaderboard.length, 2) }
})

const gameplay = [
  ['wait_for_event', { timeout_s: 1 }],
  ['set_gambits', { gambits: [{ if: 'always', then: 'hold' }], why: 'fixture' }],
  ['order_swarm', { swarm: 1, x: 100, y: 100, why: 'fixture' }],
  ['split_swarm', { swarm: 1, why: 'fixture' }],
  ['morph_swarm', { swarm: 1, type: 'spore', why: 'fixture' }],
  ['release_swarm', { swarm: 1 }],
  ['call_human', { message: 'fixture' }],
]

// Execute the real callbacks without stdio/startup. Only HTTP faults and timing
// are injected; OnlineGame/MemoryStore retain real authorization and gameplay.
async function callbackFixture({ supplied = false, bound = false } = {}) {
  const origin = 'http://127.0.0.1:8790', identity = { id: 'fixture-owner', name: 'Fixture', emailVerified: true }
  let now = 1800000000000, fault = null
  const store = new MemoryStore(() => now), requests = [], tools = new Map()
  const request = (owner, method, path, token = '', body = {}) => new OnlineGame(store, { now: () => now, origin, requireAccount: true, identity: owner }).request(method, path, new URLSearchParams({ token }), body)
  const human = await request(identity, 'POST', '/session')
  const initial = supplied ? await request(null, 'POST', '/agent/pair') : null
  if (initial) await request(identity, 'POST', '/agent/approve', human.humanToken, { id: initial.id })
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const context = vm.createContext({
    SERVER: origin, serverURL: new URL(origin), env: { ...(initial ? { BOTTERS_AGENT_TOKEN: initial.agentToken } : {}), ...(bound ? { BOTTERS_REQUIRE_AGENT_TOKEN: '1' } : {}) }, URL, AbortSignal, z,
    openUrl: () => {}, log: () => {},
    McpServer: class { registerTool(name, _schema, callback) { tools.set(name, callback) } },
    fetch: async (target, options = {}) => {
      const url = new URL(target), path = url.pathname, method = options.method || 'GET', token = url.searchParams.get('token') || ''
      requests.push({ path, token })
      if (fault) { const response = await fault(path); if (response) return response }
      try { const data = await request(null, method, path, token, options.body ? JSON.parse(options.body) : {}); return { ok: true, status: 200, json: async () => data } }
      catch (error) { return { ok: false, status: error.status || 500, json: async () => ({ error: error.message }) } }
    },
  })
  const { S } = await new vm.Script(`(async () => { ${source.slice(source.indexOf('let liveServer ='), source.indexOf('if (!process.stdin.isTTY)'))}; return { S } })()`).runInContext(context)
  const call = async (name, args = {}) => (await tools.get(name)(args)).content[0].text
  const approve = () => request(identity, 'POST', '/agent/approve', human.humanToken, { id: S.session.id })
  const join = async () => {
    if (!supplied) {
      assert.equal(JSON.parse(await call('join_match')).waiting, true)
      await approve()
    }
    await request(identity, 'POST', '/play', human.humanToken, { vs: 'easy', minutes: 8, withAgent: true })
    assert.ok(JSON.parse(await call('join_match')).state)
    await request(identity, 'POST', '/say', human.humanToken, { text: 'fixture event cursor' })
    await call('wait_for_event', { timeout_s: 1 })
    assert.ok(S.since > 0)
  }
  return { S, call, join, approve, requests,
    read: path => request(null, 'GET', path, S.session.agentToken),
    revoke: () => request(identity, 'POST', '/agent/revoke', human.humanToken),
    advance: ms => { now += ms }, fault: fn => { fault = fn },
  }
}

function disconnected(S) {
  assert.ok(S.session === null, 'definitive refusal forgets the capability without logging it')
  assert.equal(S.opened, false)
  assert.equal(S.inMatch, false)
  assert.equal(S.matchId, null)
  assert.equal(S.since, 0)
}

for (const [tool, args] of [...gameplay, ['join_match', {}]]) test(`${tool} invalidates real revoked capability and blocks all siblings until explicit reapproval`, async () => {
  const f = await callbackFixture(); await f.join()
  const old = f.S.session, matchId = f.S.matchId
  await f.revoke()
  assert.match(await f.call(tool, args), /join_match/)
  disconnected(f.S)
  const sent = f.requests.length
  for (const [name, input] of gameplay) assert.match(await f.call(name, input), /join_match/)
  assert.equal(f.requests.length, sent, 'no request may reuse a refused capability')
  assert.equal(JSON.parse(await f.call('join_match')).waiting, true)
  assert.ok(f.S.session !== old && f.S.session.agentToken !== old.agentToken, 'new pairing capability')
  assert.equal(f.S.inMatch, false)
  for (const [name, input] of gameplay) assert.match(await f.call(name, input), /join_match/)
  await f.approve()
  assert.ok(JSON.parse(await f.call('join_match')).state)
  assert.equal(f.S.matchId, matchId)
  assert.equal(JSON.parse(await f.call('set_gambits', gameplay[1][1])).ok, true)
})

test('real capability expiry and pending-pair expiry reset all local match fields without automatic retry', async () => {
  const f = await callbackFixture(); await f.join(); f.advance(8 * 86400000)
  assert.match(await f.call('wait_for_event', { timeout_s: 1 }), /join_match/)
  disconnected(f.S)
  assert.equal(JSON.parse(await f.call('join_match')).waiting, true)
  f.advance(600001)
  assert.match(await f.call('join_match'), /join_match/)
  disconnected(f.S)
  assert.equal(f.requests.filter(r => r.path === '/agent/pair').length, 2, 'no silent pairing after either expiry')
})

const response = status => ({ ok: false, status, json: async () => ({ error: 'isolated transport refusal' }) })
for (const status of [403, 409, 410, 429, 500, 503]) test(`HTTP ${status} on events/input/call/next preserves the current capability and match`, async () => {
  const f = await callbackFixture(); await f.join()
  const before = { ...f.S }, pairs = f.requests.filter(r => r.path === '/agent/pair').length
  f.fault(path => ['/events', '/input', '/call', '/next'].includes(path) ? response(status) : null)
  for (const [name, args] of [...gameplay, ['join_match', {}]]) {
    await f.call(name, args)
    assert.ok(f.S.session === before.session, 'non-definitive status must not clear capability')
    for (const key of ['opened', 'inMatch', 'matchId', 'since']) assert.equal(f.S[key], before[key])
  }
  assert.equal(f.requests.filter(r => r.path === '/agent/pair').length, pairs)
  f.fault(null)
  assert.equal(JSON.parse(await f.call('set_gambits', gameplay[1][1])).ok, true)
})

for (const refusal of [401, 410]) test(`poll ${refusal} resets stale match state but initial session 401 and transient poll errors do not`, async () => {
  const f = await callbackFixture()
  assert.equal(JSON.parse(await f.call('join_match')).waiting, true, 'initial session 401 must initiate normal pairing')
  const pair = f.S.session
  for (const status of [403, 409, 429, 500]) {
    f.fault(path => path === '/agent/poll' ? response(status) : null)
    await f.call('join_match')
    assert.ok(f.S.session === pair)
    assert.equal(f.S.inMatch, false)
  }
  // Join denial repairs residual in-match fields, not just the capability.
  Object.assign(f.S, { inMatch: true, matchId: 'previous-match', since: 27 })
  f.fault(path => path === '/agent/poll' ? response(refusal) : null)
  assert.match(await f.call('join_match'), /join_match/)
  disconnected(f.S)
  assert.equal(f.requests.filter(r => r.path === '/agent/pair').length, 1)
})

test('an externally supplied agent capability is forgotten after real revocation, not restored from the environment', async () => {
  const f = await callbackFixture({ supplied: true }); await f.join()
  await f.revoke()
  assert.match(await f.call('join_match'), /join_match/)
  disconnected(f.S)
  assert.equal(JSON.parse(await f.call('join_match')).waiting, true)
  assert.equal(f.S.inMatch, false)
  assert.equal(f.requests.filter(r => r.path === '/agent/pair').length, 1)
})

test('OAuth-bound clients never fall back to anonymous pairing after their approved capability is revoked', async () => {
  const f = await callbackFixture({ supplied: true, bound: true }); await f.join()
  await f.revoke()
  assert.match(await f.call('morph_swarm', { swarm: 1, type: 'spore', why: 'revoked OAuth grant' }), /Reconnect Botters in your assistant/)
  disconnected(f.S)
  const sent = f.requests.length
  for (const [name, args] of gameplay) assert.match(await f.call(name, args), /join_match/)
  await assert.rejects(f.call('join_match'), /Reconnect Botters in your assistant/)
  assert.equal(f.requests.length, sent, 'no account or pairing requests may escape the OAuth grant')
  assert.equal(f.requests.filter(r => r.path === '/agent/pair').length, 0)
})

test('transport failure does not revoke a still-valid agent connection', async () => {
  const f = await callbackFixture(); await f.join(); const session = f.S.session
  f.fault(path => { if (path === '/events') throw new TypeError('isolated network failure') })
  await assert.rejects(f.call('wait_for_event', { timeout_s: 1 }), /network failure/)
  assert.ok(f.S.session === session && f.S.inMatch)
  f.fault(null)
  assert.equal(JSON.parse(await f.call('set_gambits', gameplay[1][1])).ok, true)
})

for (const [tool, args] of [['wait_for_event', { timeout_s: 1 }], ['join_match', {}]]) test(`late old ${tool} refusal cannot erase a newer explicitly approved session`, async () => {
  const f = await callbackFixture(); await f.join()
  let release, entered
  const started = new Promise(resolve => { entered = resolve })
  f.fault(path => {
    if (path === (tool === 'join_match' ? '/next' : '/events')) {
      f.fault(null); entered()
      return new Promise(resolve => { release = () => resolve(response(401)) })
    }
  })
  const late = f.call(tool, args); await started
  await f.revoke()
  assert.match(await f.call('call_human', { message: 'discover revocation' }), /join_match/)
  assert.equal(JSON.parse(await f.call('join_match')).waiting, true)
  const newer = f.S.session
  await f.approve(); assert.ok(JSON.parse(await f.call('join_match')).state)
  release(); assert.match(await late, /join_match/)
  assert.ok(f.S.session === newer && f.S.inMatch, 'old refusal must not erase a new connection')
  assert.equal(JSON.parse(await f.call('set_gambits', gameplay[1][1])).ok, true)
})

for (const route of ['/next', '/rules', '/events']) for (const pending of [false, true]) test(`a delayed old ${route} success cannot restore gameplay while ${pending ? 'new approval is pending' : 'disconnected'}`, async () => {
  const f = await callbackFixture(); await f.join()
  const oldResult = await f.read(route)
  let release, entered
  const started = new Promise(resolve => { entered = resolve })
  f.fault(path => {
    if (path === route) {
      f.fault(null); entered()
      return new Promise(resolve => { release = () => resolve({ ok: true, status: 200, json: async () => oldResult }) })
    }
  })
  const late = f.call(route === '/events' ? 'wait_for_event' : 'join_match', { timeout_s: 1 }); await started
  await f.revoke(); await f.call('call_human', { message: 'discover revocation' })
  if (pending) assert.equal(JSON.parse(await f.call('join_match')).waiting, true)
  const current = f.S.session, sent = f.requests.length
  release(); assert.match(await late, /join_match/)
  assert.ok(f.S.session === current)
  assert.equal(f.S.inMatch, false)
  assert.equal(f.S.matchId, null)
  assert.equal(f.S.since, 0)
  for (const [name, args] of gameplay) assert.match(await f.call(name, args), /join_match/)
  assert.equal(f.requests.length, sent, 'stale success and blocked tools initiate no requests')
})

test('a delayed old poll approval cannot send next with an already refused capability', async () => {
  const f = await callbackFixture()
  assert.equal(JSON.parse(await f.call('join_match')).waiting, true)
  await f.approve()
  const approved = await f.read('/agent/poll')
  let release, entered
  const started = new Promise(resolve => { entered = resolve })
  f.fault(path => {
    if (path === '/agent/poll') {
      f.fault(null); entered()
      return new Promise(resolve => { release = () => resolve({ ok: true, status: 200, json: async () => approved }) })
    }
  })
  const late = f.call('join_match'); await started
  await f.revoke(); assert.match(await f.call('join_match'), /join_match/)
  disconnected(f.S)
  const sent = f.requests.length
  release(); assert.match(await late, /join_match/)
  disconnected(f.S)
  assert.equal(f.requests.length, sent, 'late approved response must not initiate an old-token next request')
})

for (const path of ['/events', '/input', '/call', '/next', '/agent/poll']) test(`a definitive ${path} refusal resets state even with an unreadable JSON body`, async () => {
  const f = await callbackFixture()
  if (path === '/agent/poll') {
    await f.call('join_match')
    Object.assign(f.S, { inMatch: true, matchId: 'previous-match', since: 27 })
  } else await f.join()
  f.fault(route => route === path ? { ok: false, status: path === '/agent/poll' ? 410 : 401, json: async () => { throw new SyntaxError('isolated empty or malformed JSON') } } : null)
  const [name, args] = path === '/input' ? gameplay.find(([tool]) => tool === 'set_gambits') : path === '/call' ? gameplay.find(([tool]) => tool === 'call_human') : path === '/events' ? gameplay.find(([tool]) => tool === 'wait_for_event') : ['join_match', {}]
  assert.match(await f.call(name, args), /join_match/)
  disconnected(f.S)
  const sent = f.requests.length
  for (const [tool, input] of gameplay) assert.match(await f.call(tool, input), /join_match/)
  assert.equal(f.requests.length, sent)
})
