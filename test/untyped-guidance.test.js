import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { OnlineGame } from '../online/game.js'
import { MemoryStore } from '../online/store.js'

const removed = /locust|carapace|spore|morph|cocoon|swarm types?|each type/i
const modes = ['1v1', '2v2', 'ffa4', 'ffa6']
const opening = [{ if: 'always', then: 'hold' }]
const tools = ['join_match', 'wait_for_event', 'set_gambits', 'order_swarm', 'split_swarm', 'release_swarm', 'call_human'].sort()
function startup(events, humanOpening, mode) {
  const event = events.find(text => text.includes('match starts in'))
  assert.ok(event, 'startup event reaches the agent')
  assert.doesNotMatch(event, removed)
  assert.match(event, /three swarms of 3,000 particles/)
  assert.match(event, humanOpening ? /opening gambits/ : /[Ww]rite.*gambits.*doctrine/)
  if (humanOpening) assert.match(event, /[Kk]eep/)
  if (mode !== '1v1') assert.ok(event.includes(`Mode ${mode}:`))
  if (mode === '2v2') assert.match(event, /house ally/)
}

test('local startup guidance reaches real stdio MCP agents without swarm types', { timeout: 60000 }, async t => {
  const probe = http.createServer()
  await new Promise(r => probe.listen(0, '127.0.0.1', r))
  const port = probe.address().port
  await new Promise(r => probe.close(r))
  const origin = `http://localhost:${port}`
  const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), BOTTERS_ORIGIN: origin, BOTTERS_START_DELAY: '60000' }, stdio: 'ignore' })
  t.after(async () => { child.kill(); await new Promise(r => child.exitCode !== null ? r() : child.once('exit', r)) })
  let up = false
  for (let i = 0; i < 100 && !up; i++) { up = await fetch(origin + '/rules').then(r => r.ok, () => false); if (!up) await new Promise(r => setTimeout(r, 25)) }
  assert.ok(up, 'isolated local server starts')
  const post = (path, body) => fetch(origin + path, { method: 'POST', body: JSON.stringify(body) }).then(r => r.json())
  for (const mode of modes) for (const humanOpening of [false, true]) await t.test(`${mode}, ${humanOpening ? 'human' : 'agent'} opening`, async t => {
    const session = await post('/session', { name: 'untyped-guidance', setup: 'test' })
    assert.deepEqual(await post(`/play?token=${session.humanToken}`, { vs: 'easy', mode, planning: 10, withAgent: true, ...(humanOpening ? { opening } : {}) }), { ok: true })
    const transport = new StdioClientTransport({ command: process.execPath, args: ['client.js'], env: { ...process.env, BOTTERS_SERVER: origin, BOTTERS_AGENT_TOKEN: session.agentToken, BOTTERS_OPEN: '0' }, stderr: 'pipe' })
    const client = new Client({ name: 'untyped-guidance', version: '1.0.0' })
    t.after(() => client.close())
    await client.connect(transport)
    const listed = await client.listTools()
    assert.deepEqual(listed.tools.map(tool => tool.name).sort(), tools)
    assert.doesNotMatch(JSON.stringify(listed), removed)
    const call = async (name, args = {}) => {
      const response = await client.callTool({ name, arguments: args })
      assert.ok(!response.isError)
      return JSON.parse(response.content[0].text)
    }
    const joined = await call('join_match')
    assert.equal(joined.state.yourSwarms.length, 3)
    for (const swarm of joined.state.yourSwarms) assert.match(swarm, /n3000\b/)
    assert.doesNotMatch(JSON.stringify(joined), removed)
    assert.match(joined.opening, humanOpening ? /human wrote/ : /Write.*doctrine/)
    const first = await call('wait_for_event', { timeout_s: 1 })
    assert.equal(first.state.yourSwarms.length, 3)
    startup(first.events, humanOpening, mode)
  })
})

test('OnlineGame startup events describe three untyped swarms in every mode', async t => {
  for (const mode of modes) for (const humanOpening of [false, true]) await t.test(`${mode}, ${humanOpening ? 'human' : 'agent'} opening`, async () => {
    const now = 1_800_000_000_000
    const game = new OnlineGame(new MemoryStore(() => now), { now: () => now })
    const session = await game.request('POST', '/session', undefined, { name: 'untyped-guidance', setup: 'test' })
    const call = (method, path, body = {}, role = 'agent') => game.request(method, path, new URLSearchParams({ token: session[`${role}Token`] }), body)
    assert.deepEqual(await call('POST', '/play', { vs: 'easy', mode, planning: 10, withAgent: true, ...(humanOpening ? { opening } : {}) }, 'human'), { ok: true })
    const joined = await call('GET', '/next')
    assert.equal(joined.match.state.swarms.length, 3)
    for (const swarm of joined.match.state.swarms) {
      assert.equal(swarm.n, 3000)
      for (const key of ['type', 'morphAt', 'cocoon']) assert.ok(!Object.hasOwn(swarm, key))
    }
    const first = await call('GET', '/events')
    assert.equal(first.state.swarms.length, 3)
    startup(first.events.map(event => event.text), humanOpening, mode)
  })
})

test('online feed attributes an accepted split, not an ignored removed action', async () => {
  let now = 1_800_000_000_000
  const game = new OnlineGame(new MemoryStore(() => now), { now: () => now })
  const session = await game.request('POST', '/session', undefined, { setup: 'test' })
  const call = (method, path, body = {}) => game.request(method, path, new URLSearchParams({ token: session.humanToken }), body)
  await call('POST', '/play', { vs: 'easy', planning: 10, opening })
  now += 10050
  const before = await call('GET', '/state'), swarm = before.view.swarms[0].id
  assert.deepEqual(await call('POST', '/input', { split: swarm, morph: { swarm, type: 'locust' } }), { ok: true })
  const after = await call('GET', '/state')
  assert.equal(after.view.swarms.length, before.view.swarms.length + 1)
  assert.equal(after.feed.at(-1).text, 'split a swarm')
})
