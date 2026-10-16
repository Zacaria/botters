import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

test('two actual MCP processes pair to verified accounts and play without receiving human credentials', { timeout: 65000 }, async t => {
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
    humans.push({ ...session, cookie: liveCookie })
  }
  const options = { minutes: 3, planning: 10, planets: 16, withAgent: true }
  const room = await livePost(`/rooms?token=${humans[0].humanToken}`, options, humans[0].cookie).then(r => r.json())
  assert.equal((await livePost(`/rooms/join?token=${humans[1].humanToken}`, { ...options, code: room.code }, humans[1].cookie)).status, 200)
  assert.equal((await livePost(`/rooms/start?token=${humans[0].humanToken}`, options, humans[0].cookie)).status, 200)
  const joined = await Promise.all(clients.map(c => c.callTool({ name: 'join_match', arguments: {} }, undefined, { timeout: 30000 })))
  for (const result of joined) { const data = JSON.parse(result.content[0].text); assert.ok(data.rules); assert.ok(data.state); assert.ok(!JSON.stringify(data).includes('humanToken')) }
  for (const client of clients) {
    const result = await client.callTool({ name: 'set_gambits', arguments: { gambits: [{ if: 'free_planet', then: 'go' }, { if: 'always', then: 'hunt' }], why: 'isolated actual MCP regression' } })
    assert.equal(result.isError, undefined)
  }
  let frame
  for (let i = 0; i < 125; i++) {
    frame = await fetch(`${liveOrigin}/state?token=${humans[0].humanToken}`, { headers: { cookie: humans[0].cookie } }).then(r => r.json())
    if (frame.report) break
    await new Promise(r => setTimeout(r, 200))
  }
  assert.ok(frame.report, 'real accelerated match produced a replay report')
  for (const h of humans) { const lobby = await fetch(`${liveOrigin}/lobby?token=${h.humanToken}`, { headers: { cookie: h.cookie } }).then(r => r.json()); assert.equal(lobby.history.length, 1); assert.equal(lobby.leaderboard.length, 2) }
})
