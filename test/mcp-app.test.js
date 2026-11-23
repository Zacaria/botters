import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import vm from 'node:vm'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

test('show_match renders the live map as an MCP App and follows the match', { timeout: 60000 }, async t => {
  const probe = http.createServer()
  await new Promise(r => probe.listen(0, '127.0.0.1', r))
  const port = probe.address().port
  await new Promise(r => probe.close(r))
  const origin = `http://localhost:${port}`
  const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), BOTTERS_ORIGIN: origin }, stdio: 'ignore' })
  t.after(async () => { child.kill(); await new Promise(r => child.exitCode !== null ? r() : child.once('exit', r)) })
  let up = false
  for (let i = 0; i < 100 && !up; i++) { up = await fetch(origin + '/rules').then(r => r.ok, () => false); if (!up) await new Promise(r => setTimeout(r, 25)) }
  assert.ok(up, 'isolated local server starts')
  const post = (path, body) => fetch(origin + path, { method: 'POST', body: JSON.stringify(body) }).then(r => r.json())
  const session = await post('/session', { name: 'mcp-app', setup: 'test' })
  const transport = new StdioClientTransport({ command: process.execPath, args: ['client.js'], env: { ...process.env, BOTTERS_SERVER: origin, BOTTERS_AGENT_TOKEN: session.agentToken, BOTTERS_OPEN: '0' }, stderr: 'pipe' })
  const client = new Client({ name: 'mcp-app', version: '1.0.0' })
  t.after(() => client.close())
  await client.connect(transport)

  const tool = (await client.listTools()).tools.find(x => x.name === 'show_match')
  assert.equal(tool._meta.ui.resourceUri, 'ui://botters/match')
  assert.equal(tool.annotations.readOnlyHint, true)
  const [content] = (await client.readResource({ uri: 'ui://botters/match' })).contents
  assert.equal(content.mimeType, 'text/html;profile=mcp-app')
  assert.deepEqual(content._meta.ui.csp, { connectDomains: [], resourceDomains: [] }, 'the view needs no network: it refreshes through the host bridge')
  const script = content.text.match(/<script>([\s\S]*)<\/script>/)[1]
  assert.doesNotThrow(() => new vm.Script(script), 'inline view script parses')
  assert.match(script, /ui\/initialize/)

  const idle = await client.callTool({ name: 'show_match', arguments: {} })
  assert.ok(idle.structuredContent.message, 'before a match the view shows a waiting message')
  assert.deepEqual(await post(`/play?token=${session.humanToken}`, { vs: 'easy', planning: 10, withAgent: true }), { ok: true })
  const joined = JSON.parse((await client.callTool({ name: 'join_match', arguments: {} })).content[0].text)
  assert.match(joined.next, /show_match/)
  const shown = await client.callTool({ name: 'show_match', arguments: {} })
  const frame = shown.structuredContent
  assert.equal(frame.matchId, joined.matchId)
  assert.equal(frame.view.battalions.length, 3)
  assert.ok(frame.view.planets.length > 5 && frame.view.planets.every(p => [null, 'you', 'enemy'].includes(p.owner)))
  assert.ok(frame.view.enemies.every(e => !('roles' in e)), 'only fogged enemy summaries reach the view')
  assert.match(shown.content[0].text, /Live map shown/)
})
