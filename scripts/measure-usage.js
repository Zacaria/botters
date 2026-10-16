// Real five-minute game on an isolated preview namespace, using the actual Convex
// adapter, two Brave contexts and two stdio MCP clients. No inference is billed.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import http from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
const source = resolve(process.env.BOTTERS_MEASURE_SOURCE || '.')
const sourceHashes = Object.fromEntries(await Promise.all(['online/game.js', 'online/http.js', 'online/store.js', 'sim.js', 'index.html', 'client.js'].map(async file => [file, createHash('sha256').update(await readFile(resolve(source, file))).digest('hex')])))
const { ConvexStore } = await import(pathToFileURL(resolve(source, 'online/store.js')))
const { createHandler } = await import(pathToFileURL(resolve(source, 'online/http.js')))
const namespace = `usage-${Date.now().toString(36)}`
const store = new ConvexStore({ ...process.env, BOTTERS_NAMESPACE: namespace })
assert.ok(store.url && store.token, 'Real Convex credentials required')
const metrics = { calls: 0, queries: 0, mutations: 0, readValueBytes: 0, writtenValueBytes: 0 }
const bytes = value => value == null ? 0 : Buffer.byteLength(value)
const original = store.call
store.call = async function (kind, path, args, options) {
  const result = await original.call(this, kind, path, args, options)
  metrics.calls++; metrics[kind === 'query' ? 'queries' : 'mutations']++
  if (path === 'store:get') for (const value of args.followToken ? result.values : result) metrics.readValueBytes += bytes(value)
  if (path === 'store:commit') {
    // CAS reads every guard, including read-only guards. Values are the exact stored
    // JSON payloads; these counters exclude Convex document/index metadata and are
    // not a claim about provider-billed database bytes. No tokens/values are saved.
    metrics.readValueBytes += args.entries.reduce((n, e) => n + bytes(e.raw), 0)
    if (result) metrics.writtenValueBytes += args.entries.reduce((n, e) => n + bytes(e.value), 0)
  }
  return result
}
let origin
const handler = (req, res) => createHandler(store, { origin })(req, res)
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, origin).pathname
  const file = { '/': 'index.html', '/sim.js': 'sim.js', '/guide': 'guide.html', '/privacy': 'privacy.html', '/terms': 'terms.html' }[path]
  if (!file) return handler(req, res)
  res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/html' })
  res.end(await readFile(resolve(source, file)))
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ executablePath: process.env.BOTTERS_BROWSER || '/usr/bin/brave-browser', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const clients = [], tokens = [], pages = [], contexts = [], errors = []
const parse = r => { assert.ok(!r.isError, r.content?.[0]?.text); return JSON.parse(r.content.find(c => c.type === 'text').text) }
const tool = async (c, name, args = {}) => parse(await c.callTool({ name, arguments: args }, undefined, { timeout: 60000 }))
const started = Date.now()
try {
  for (let side = 0; side < 2; side++) {
    const transport = new StdioClientTransport({ command: process.execPath, args: [resolve(source, 'client.js')], env: { ...process.env, BOTTERS_SERVER: origin, BOTTERS_NAME: `usage-${side}`, BOTTERS_SETUP: 'usage-scripted-MCP', BOTTERS_OPEN: '0' }, stderr: 'pipe' })
    let log = ''
    transport.stderr.on('data', data => { log += data; const found = /lobby (https?:\/\/\S+)/.exec(log); if (found) { tokens[side] = new URL(found[1]).searchParams.get('s'); log = '' } })
    const client = new Client({ name: 'usage-meter', version: '1' }); await client.connect(transport); clients.push(client)
  }
  await Promise.all(clients.map(c => tool(c, 'join_match', { vs: 'player', minutes: 5, planets: 28, planning: 10 })))
  await Promise.all(clients.map(c => tool(c, 'set_gambits', { gambits: [{ if: 'always', then: 'hold' }], why: 'five-minute storage measurement' })))
  assert.equal(tokens.filter(Boolean).length, 2)
  for (const token of tokens) {
    const context = await browser.newContext(); contexts.push(context)
    await context.addInitScript(() => {
      window.usage = { frames: 0, first: null, last: null, unsafe: 0, reports: 0 }
      const Native = window.EventSource
      window.EventSource = class extends Native {
        constructor(...args) { super(...args); this.addEventListener('message', e => {
          const frame = JSON.parse(e.data), u = window.usage
          u.frames++; u.first ??= performance.now(); u.last = performance.now()
          if (frame.s || frame.log || !frame.view) u.unsafe++
          if (frame.report) u.reports++
        }) }
      }
    })
    const page = await context.newPage(); pages.push(page); page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${origin}/?s=${token}`)
  }
  const states = await Promise.all(clients.map(async c => {
    let result
    do {
      result = await tool(c, 'wait_for_event', { timeout_s: 10 })
      assert.ok(Date.now() - started < 370000, 'Match exceeded five-minute budget plus planning/reconnect margin')
    } while (!result.state?.ended)
    return result
  }))
  assert.ok(states.every(s => s.state.ended))
  const final = await Promise.all(tokens.map(async token => {
    const r = await fetch(`${origin}/state?token=${token}`); assert.equal(r.status, 200); return r.json()
  }))
  assert.ok(final.every(f => f.report?.actual && f.report.agentInputs >= 1))
  const streams = await Promise.all(pages.map(page => page.evaluate(() => ({ ...window.usage, fps: (window.usage.frames - 1) * 1000 / (window.usage.last - window.usage.first) }))))
  assert.ok(streams.every(s => s.frames > 1000 && !s.unsafe), JSON.stringify(streams))
  assert.deepEqual(errors, [])
  const result = { source, sourceHashes, namespace, durationMs: Date.now() - started, fixture: 'Real 5-minute/28-planet match; two isolated Brave browsers plus two real stdio MCP agents on local HTTP preview backed by actual free-plan Convex; no clock acceleration; both agents hold throughout (storage benchmark, not combat capacity)', byteDefinition: 'Exact UTF-8 stored JSON value payloads returned by queries and supplied as CAS guards/writes; excludes document/index metadata, auth component and billing overhead; not provider-billed bytes', ...metrics, streams, reports: final.map(f => f.report.actual) }
  await writeFile(process.env.BOTTERS_MEASURE_OUTPUT || '.cache/usage.json', JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
  if (process.env.BOTTERS_MEASURE_BASELINE !== '1') assert.ok(streams.every(s => s.fps >= 10), 'Optimized streams must sustain >=10 FPS; measurements saved even on failure')
} finally {
  await Promise.allSettled(clients.map(c => c.close())); await browser.close()
  server.closeAllConnections(); await new Promise(r => server.close(r))
}
