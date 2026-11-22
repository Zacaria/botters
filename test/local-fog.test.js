import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './local.test.js'
import { createMirror, decodeFrame } from '../wire.js'

test('real SSE fog frames decode across a mid-match join', { timeout: 45000 }, async t => {
  const { origin, post } = await fixture(t), token = (await post('/session', {})).body.humanToken
  assert.equal((await post(`/play?token=${token}`, { vs: 'normal', minutes: 3, planets: 9, withAgent: false })).status, 200)
  const controllers = [], tasks = []
  t.after(async () => { controllers.forEach(c => c.abort()); await Promise.all(tasks) })
  const connect = async () => {
    const controller = new AbortController(); controllers.push(controller)
    const res = await fetch(`${origin}/stream?token=${token}`, { signal: controller.signal }); assert.equal(res.status, 200)
    const client = { mirror: createMirror(), bytes: 0, frames: 0, reset: false, error: null }, reader = res.body.getReader(), decoder = new TextDecoder()
    tasks.push((async () => { let buf = ''; try { while (true) {
      const { value, done } = await reader.read(); if (done) break
      client.bytes += value.length; buf += decoder.decode(value, { stream: true }); let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const part = buf.slice(0, i); buf = buf.slice(i + 2)
        if (!part.startsWith('event: f\n')) continue
        const bytes = Buffer.from(part.split('\n').find(x => x.startsWith('data: ')).slice(6), 'base64')
        if (!client.frames) client.reset = !!(bytes[0] & 1)
        decodeFrame(bytes, client.mirror); client.frames++
      }
    } } catch (e) { if (e.name !== 'AbortError') client.error = e } })())
    return client
  }
  const first = await connect(); await new Promise(r => setTimeout(r, 1800))
  assert.equal((await post(`/input?token=${token}`, { order: { bat: 0, x: 400, y: 300 } })).status, 200)
  const second = await connect(); await new Promise(r => setTimeout(r, 1500))
  for (const c of [first, second]) { assert.ifError(c.error); assert.ok(c.reset); assert.ok(c.mirror.tick > 0); assert.ok(c.mirror.n > 0); assert.ok(c.frames > 5) }
  console.log(JSON.stringify({ proof: 'sse-fog', bytesPerSecond: [first.bytes / 3.3, second.bytes / 1.5], ticks: [first.mirror.tick, second.mirror.tick] }))
})
