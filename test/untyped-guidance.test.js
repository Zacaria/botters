import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { OnlineGame } from '../online/game.js'
import { MemoryStore } from '../online/store.js'

const removed = /locust|carapace|spore|morph|cocoon|swarm|2v2|ffa4|ffa6/i
const modes = ['1v1']
const opening = [{ if: 'always', then: 'hold' }]
const tools = ['join_match', 'wait_for_event', 'get_state', 'set_gambits', 'toggle_gambit', 'call_human'].sort()
function startup(events, humanOpening, mode) {
  const event = events.find(text => text.includes('three battalions of 400 units'))
  assert.ok(event, 'startup event reaches the agent')
  assert.doesNotMatch(event, removed)
  assert.match(event, /three battalions of 400 units/)
  assert.match(event, humanOpening ? /opening gambits/ : /[Ww]rite.*gambits.*doctrine/)
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
    assert.equal(joined.state.battalions.length, 3)
    for (const bat of joined.state.battalions) assert.ok(bat.n >= 400 && bat.n <= 402)
    assert.doesNotMatch(JSON.stringify(joined), removed)
    assert.match(joined.opening, humanOpening ? /human wrote/ : /Write.*doctrine/)
    const first = await call('wait_for_event', { timeout_s: 1 })
    assert.equal(first.state.battalions.length, 3)
    startup(first.events, humanOpening, mode)
  })
})
