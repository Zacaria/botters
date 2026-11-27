import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runtime, client, ORIGIN } from './helpers/cloudflare.js'

test('authentication requests count against the sender allowance before database work', { timeout: 60000 }, async t => {
  const rt = await runtime({ burst: { limit: 5, period: 10 } }); t.after(() => rt.mf.dispose())
  const statuses = []
  for (let i = 0; i < 12; i++) statuses.push((await rt.mf.dispatchFetch(`${ORIGIN}/api/auth/x${i}`, { headers: { 'cf-connecting-ip': '198.51.100.7' } })).status)
  assert.ok(statuses.includes(429), `no request was refused: ${statuses}`)
  const rows = await rt.db.prepare('SELECT count(*) n FROM rateLimit').first('n')
  assert.ok(rows <= 5, `${rows} counters written for 12 requests from one sender`)
  assert.equal((await rt.mf.dispatchFetch(`${ORIGIN}/api/auth/ok`, { headers: { 'cf-connecting-ip': '198.51.100.8' } })).status, 200, 'another sender is not affected')
})

test('an oversized authentication request is refused and stores nothing', { timeout: 60000 }, async t => {
  const rt = await runtime(); t.after(() => rt.mf.dispose())
  const c = client(rt.mf), big = await c.call('POST', '/api/auth/sign-up/email', { name: 'n'.repeat(20000), email: 'big@example.invalid', password: 'Local-proof-password-1234' })
  assert.equal(big.status, 413)
  assert.equal(await rt.db.prepare('SELECT count(*) n FROM user').first('n'), 0)
  assert.equal((await c.signUp('Alice')).status, 200)
})
