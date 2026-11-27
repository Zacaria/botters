import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runtime, client } from './helpers/cloudflare.js'

test('a sign-in session keeps no network address or browser details', { timeout: 60000 }, async t => {
  const { mf, db, mail } = await runtime(); t.after(() => mf.dispose())
  const alice = client(mf), signed = await alice.signUp('Alice')
  const verify = new URL(mail[0].text.match(/http:\/\/[^\s]+/)[0])
  assert.equal((await alice.call('GET', verify.pathname + verify.search)).status, 302)
  assert.equal((await alice.call('POST', '/api/auth/sign-in/email', { email: signed.email, password: signed.password })).status, 200)
  const sessions = (await db.prepare('SELECT ipAddress, userAgent FROM session').all()).results
  assert.ok(sessions.length >= 1)
  assert.deepEqual(sessions.filter(s => s.ipAddress || s.userAgent), [])
  assert.equal((await alice.call('GET', '/api/auth/get-session')).body.user.email, signed.email)
})
