import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runtime, client, ORIGIN } from './helpers/cloudflare.js'
import { createAuth } from '../cloudflare/auth.js'

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

test('a request that needs no account data sends no database statement', async () => {
  const statements = [], refuse = name => (...args) => { statements.push(`${name} ${String(args[0]).slice(0, 80)}`); throw new Error('no database in this test') }
  const env = { DB: { prepare: refuse('prepare'), batch: refuse('batch'), exec: refuse('exec') }, SITE_URL: ORIGIN, BETTER_AUTH_SECRET: 'local-workerd-test-only-secret-1234567890' }
  const r = await createAuth(env).handler(new Request(`${ORIGIN}/api/auth/get-session`))
  assert.equal(r.status, 200); assert.equal(await r.json(), null)
  assert.deepEqual(statements, [])
})

test('sign-in counters are dropped once their window has passed', { timeout: 60000 }, async t => {
  const { mf, db } = await runtime(); t.after(() => mf.dispose())
  const insert = (key, at) => db.prepare('INSERT INTO rateLimit (id, key, count, lastRequest) VALUES (?, ?, 1, ?)').bind(key, key, at).run()
  await insert('old', Date.now() - 601000); await insert('current', Date.now() - 1000)
  await (await mf.getWorker()).scheduled({ cron: '*/10 * * * *' })
  assert.deepEqual((await db.prepare('SELECT key FROM rateLimit ORDER BY key').all()).results.map(r => r.key), ['current'])
})
