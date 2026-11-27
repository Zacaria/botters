import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runtime, client } from './helpers/cloudflare.js'

test('a waiting request keeps counting against the sender allowance', { timeout: 60000 }, async t => {
  const { mf } = await runtime({ burst: { limit: 4, period: 10 } }); t.after(() => mf.dispose())
  const c = client(mf), from = { 'cf-connecting-ip': '198.51.100.9' }
  const pair = (await c.call('POST', '/agent/pair', {}, from)).body
  const started = Date.now(), waiting = await c.call('GET', `/agent/poll?token=${pair.agentToken}&timeout=20`, undefined, from)
  assert.equal(waiting.status, 200); assert.equal(waiting.body.approved, false)
  assert.ok(Date.now() - started < 10000, `waited ${Date.now() - started} ms on an allowance of 4 requests`)
  assert.equal((await c.call('GET', `/agent/poll?token=${pair.agentToken}`, undefined, from)).status, 429)
})
