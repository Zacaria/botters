import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runtime, client } from './helpers/cloudflare.js'

const verify = async (c, mail) => {
  const link = new URL((mail.at(-1).text || JSON.stringify(mail.at(-1))).match(/http\S+verify-email[^\s"\\]+/)[0])
  assert.equal((await c.call('GET', link.pathname + link.search)).status, 302)
  return (await c.call('GET', '/api/auth/get-session')).body
}

test('only the mailbox owner ends up with a working password when two people sign up with one address', async () => {
  const { mf, mail } = await runtime()
  try {
    const first = client(mf), owner = client(mf), email = 'contested@example.invalid'
    assert.equal((await first.call('POST', '/api/auth/sign-up/email', { name: 'First', email, password: 'First-password-12345' })).status, 200)
    assert.equal((await owner.call('POST', '/api/auth/sign-up/email', { name: 'Owner', email, password: 'Owner-password-12345' }, { 'cf-connecting-ip': '203.0.113.9' })).status, 200)
    assert.equal((await owner.call('POST', '/api/auth/send-verification-email', { email, callbackURL: '/' }, { 'cf-connecting-ip': '203.0.113.9' })).status, 200)
    assert.equal((await verify(owner, mail)).user.emailVerified, true)
    assert.equal((await first.call('POST', '/api/auth/sign-in/email', { email, password: 'First-password-12345' })).status, 401)
    assert.equal((await first.call('GET', '/api/auth/get-session')).body, null)
    assert.equal((await owner.call('POST', '/api/auth/request-password-reset', { email, redirectTo: 'http://localhost:8787' }, { 'cf-connecting-ip': '203.0.113.9' })).status, 200)
    const token = new URL(mail.find(m => m.subject === 'Reset your Botters password').text.match(/http:\/\/[^\s]+/)[0]).pathname.split('/').at(-1)
    assert.equal((await owner.call('POST', '/api/auth/reset-password', { token, newPassword: 'Owner-chosen-password-1' })).status, 200)
    assert.equal((await client(mf).call('POST', '/api/auth/sign-in/email', { email, password: 'Owner-chosen-password-1' }, { 'cf-connecting-ip': '203.0.113.10' })).status, 200)
    assert.equal((await first.call('POST', '/api/auth/sign-in/email', { email, password: 'First-password-12345' })).status, 401)
  } finally { await mf.dispose() }
})

test('retrying sign-up with the same password keeps it', async () => {
  const { mf, mail } = await runtime()
  try {
    const c = client(mf), email = 'retry@example.invalid', password = 'Retry-password-123456'
    for (let i = 0; i < 2; i++) assert.equal((await c.call('POST', '/api/auth/sign-up/email', { name: 'Retry', email, password })).status, 200)
    assert.equal((await verify(c, mail)).user.emailVerified, true)
    assert.equal((await client(mf).call('POST', '/api/auth/sign-in/email', { email, password }, { 'cf-connecting-ip': '203.0.113.9' })).status, 200)
  } finally { await mf.dispose() }
})
