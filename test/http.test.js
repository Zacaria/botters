import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHandler } from '../online/http.js'
import { MemoryStore, ConvexStore } from '../online/store.js'

async function serve(t, store = new MemoryStore(), options = {}) {
  const server = http.createServer((req, res) => handler(req, res))
  let handler
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const origin = `http://127.0.0.1:${server.address().port}`
  handler = createHandler(store, { origin, ...options })
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)) })
  return { origin, fetch: (path, options) => fetch(origin + path, options), post: (path, body, headers = {}) => fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }) }
}

test('HTTP rejects cross-origin, invalid JSON/body, missing token and agent streams; no-store headers', async t => {
  const s = await serve(t)
  assert.equal((await s.post('/session', {}, { Origin: 'https://evil.example' })).status, 403)
  assert.equal((await s.post('/session', [])).status, 400)
  assert.equal((await s.fetch('/session', { method: 'POST', body: '{' })).status, 400)
  assert.equal((await s.post('/session', { padding: 'x'.repeat(18000) })).status, 413)
  assert.equal((await s.fetch('/state?token=bad')).status, 401)
  const r = await s.post('/session', { name: 'http' }), session = await r.json()
  assert.equal(r.headers.get('cache-control'), 'no-store')
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer')
  assert.equal((await s.fetch(`/stream?token=${session.agentToken}`)).status, 401)
  const next = await s.fetch(`/next?token=${session.agentToken}&timeout=0`).then(r => r.json())
  assert.deepEqual(next, { match: null })
})

test('unconfigured Convex fails closed without leaking credentials or an in-memory fallback', async t => {
  const s = await serve(t, new ConvexStore({}))
  const res = await s.post('/session', {})
  assert.equal(res.status, 503)
  assert.deepEqual(await res.json(), { error: 'Online storage is not configured.' })
})

test('entry deadline aborts slow Convex calls before the function limit', async t => {
  const slow = http.createServer((req, res) => { setTimeout(() => { res.setHeader('Content-Type', 'application/json'); res.end('{"result":null}') }, 2000).unref() })
  await new Promise(r => slow.listen(0, '127.0.0.1', r))
  t.after(async () => { slow.closeAllConnections(); await new Promise(r => slow.close(r)) })
  const store = new ConvexStore({ CONVEX_URL: `http://127.0.0.1:${slow.address().port}`, CONVEX_DEPLOY_KEY: 'never-return-this-test-secret' })
  const s = await serve(t, store, { requestMs: 80 })
  const start = performance.now(), r = await s.fetch('/lobby?token=' + 'a'.repeat(32))
  assert.equal(r.status, 503)
  assert.ok(performance.now() - start < 750)
  assert.ok(!(await r.text()).includes('never-return-this-test-secret'))
})

test('SSE emits side-filtered frames at >=10Hz and ends on its bounded budget', async t => {
  const s = await serve(t, new MemoryStore(), { streamMs: 1100 })
  const session = await s.post('/session', { name: 'stream' }).then(r => r.json())
  await s.post(`/play?token=${session.humanToken}`, { vs: 'easy', withAgent: false })
  const r = await s.fetch(`/stream?token=${session.humanToken}`), times = []
  let buf = ''
  for await (const chunk of r.body) {
    buf += new TextDecoder().decode(chunk)
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const event = buf.slice(0, i); buf = buf.slice(i + 2)
      if (!event.startsWith('data: ')) continue
      const frame = JSON.parse(event.slice(6)); assert.ok(frame.view); assert.equal(frame.s, undefined); assert.equal(frame.log, undefined)
      assert.equal(frame.view.enemies.length, 0); times.push(performance.now())
    }
  }
  assert.ok(times.length >= 11, `Only ${times.length} frames`)
  assert.ok((times.length - 1) * 1000 / (times.at(-1) - times[0]) >= 10)
})
