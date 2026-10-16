import { test } from 'node:test'
import assert from 'node:assert/strict'
import { consumeAuthLimit } from '../online/auth.js'
import { MemoryStore } from '../online/store.js'
const req = { headers: {}, socket: { remoteAddress: '192.0.2.1' } }

test('auth boundary admits exactly five concurrent password attempts and preserves ten-minute email limits', async () => {
  let now = 1800000000000
  const store = new MemoryStore(() => now)
  const attempts = await Promise.allSettled(Array.from({ length: 20 }, () => consumeAuthLimit(store, req, '/sign-in/email', { now })))
  assert.equal(attempts.filter(a => a.status === 'fulfilled').length, 5)
  assert.ok(attempts.filter(a => a.status === 'rejected').every(a => a.reason.status === 429))
  for (let i = 0; i < 3; i++) await consumeAuthLimit(store, req, '/request-password-reset', { now })
  now += 61001
  await consumeAuthLimit(store, req, '/sign-out', { now })
  await assert.rejects(consumeAuthLimit(store, req, '/request-password-reset', { now }), e => e.status === 429)
  now += 600000
  await consumeAuthLimit(store, req, '/request-password-reset', { now })
  assert.ok(!JSON.stringify([...store.data.keys()]).includes('192.0.2.1'))
})
