import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runtime, client } from './helpers/cloudflare.js'
import { deliverLimited } from '../cloudflare/auth.js'
import { MemoryStore } from '../online/store.js'

test('one address receives a bounded number of authentication emails of each kind', async () => {
  let now = 1_800_000_000_000
  const calls = [], store = new MemoryStore(() => now)
  const env = { BETTER_AUTH_SECRET: 'local-workerd-test-only-secret-1234567890', AUTH_EMAIL_FROM: 'botters@mail.havesomecode.io', EMAIL: { send: async m => { calls.push({ to: m.to, subject: m.subject, at: now }); return { messageId: 'local' } } } }
  const send = (to, subject = 'Verify') => deliverLimited(env, { to, subject, text: 'link' }, store, now)
  const owner = subject => calls.filter(c => c.subject === subject && /^\s*owner@example/i.test(c.to))
  // A look-alike address is another account: using up its allowance leaves the owner's untouched.
  for (const to of ['owner+a@example.invalid', 'owner+a@example.invalid', 'owner+a@example.invalid', 'owner+a@example.invalid', 'o.wner@gmail.com', 'o.wner@gmail.com', 'o.wner@gmail.com', 'o.wner@gmail.com']) await send(to)
  assert.equal(calls.length, 6)
  for (const to of ['Owner@Example.invalid', 'owner@example.invalid', ' owner@example.invalid ', 'OWNER@EXAMPLE.INVALID']) await send(to)
  assert.equal(owner('Verify').length, 3)
  for (let i = 0; i < 4; i++) await send('owner@gmail.com')
  assert.equal(calls.length, 12)
  // Someone else exhausting one kind leaves the other kind deliverable.
  assert.equal((await send('owner@example.invalid', 'Reset')).messageId, 'local')
  for (let i = 0; i < 36; i++) {
    now += 300000
    const refused = (await send('owner@example.invalid')).skipped
    // Whenever a request is refused, an earlier email of that kind is less than an hour old.
    if (refused) assert.equal(owner('Verify').some(c => now - c.at < 3600000), true)
  }
  const sent = owner('Verify')
  assert.equal(sent.length > 6, true)
  for (const c of sent) {
    assert.equal(sent.filter(o => o.at <= c.at && c.at - o.at < 3600000).length <= 6, true)
    assert.equal(sent.filter(o => o.at <= c.at && c.at - o.at < 600000).length <= 3, true)
  }
  assert.equal([...store.data.keys()].some(k => /owner|example/.test(k)), false)
})

test('repeated sign-ins cannot flood an unverified address', async () => {
  const { mf, mail } = await runtime()
  try {
    const signup = await client(mf).signUp('Flood')
    assert.equal(signup.status, 200)
    for (let i = 0; i < 5; i++) {
      const r = await client(mf).call('POST', '/api/auth/sign-in/email', { email: signup.email, password: signup.password }, { 'cf-connecting-ip': `203.0.113.${i + 1}` })
      assert.equal(r.status, 403)
    }
    await mf.captureMail()
    assert.equal(mail.length, 3)
  } finally { await mf.dispose() }
})
