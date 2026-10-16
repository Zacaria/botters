// Actual cloud subscription fault check; touches only a newly created fixture.
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { ConvexStore } from '../online/store.js'
import { createHandler } from '../online/http.js'
const store = new ConvexStore({ ...process.env, BOTTERS_NAMESPACE: `watch-fault-${Date.now()}` })
let opened = 0, closed = 0, origin
const watch = store.watchToken
store.watchToken = async function (...args) {
  await watch.apply(this, args); opened++
  const close = this.closeWatch
  this.closeWatch = async () => { await close(); closed++ }
}
const server = http.createServer((req, res) => createHandler(store, { origin })(req, res))
await new Promise(r => server.listen(0, '127.0.0.1', r))
origin = `http://127.0.0.1:${server.address().port}`
const post = async (path, body) => {
  const response = await fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal(response.status, 200); return response.json()
}
try {
  const session = await post('/session', { name: 'watch-fault', setup: 'scripted' })
  await post(`/play?token=${session.humanToken}`, { withAgent: false, planning: 10 })
  const response = await fetch(`${origin}/stream?token=${session.humanToken}`, { signal: AbortSignal.timeout(12000) })
  assert.equal(response.status, 200)
  const reader = response.body.getReader()
  let buffer = new TextDecoder().decode((await reader.read()).value), frames = 0
  const key = `token:${createHash('sha256').update(session.humanToken).digest('hex')}`, raw = await store.get(key)
  const start = performance.now()
  // Expire this script's own capability, never delete/reset existing player data.
  assert.equal(await store.commit([{ key, raw, value: raw, ttl: .05 }]), 1)
  while (true) {
    const next = await reader.read()
    if (next.done) break
    buffer += new TextDecoder().decode(next.value)
  }
  for (const message of buffer.split('\n\n')) if (message.startsWith('data: ')) {
    const frame = JSON.parse(message.slice(6)); assert.ok(frame.view && !frame.s && !frame.log); frames++
  }
  assert.ok(buffer.includes('event: unavailable'))
  assert.ok(performance.now() - start < 8000, `Expiry closure took ${performance.now() - start} ms`)
  const end = Date.now() + 2000
  while (closed < opened && Date.now() < end) await new Promise(r => setTimeout(r, 20))
  assert.equal(opened, 1); assert.equal(closed, 1)
  console.log(JSON.stringify({ actualConvex: true, opened, closed, fogFilteredFrames: frames, expiredCapabilityClosedStreamMs: performance.now() - start, result: 'PASS' }, null, 2))
} finally {
  server.closeAllConnections(); await new Promise(r => server.close(r))
}
