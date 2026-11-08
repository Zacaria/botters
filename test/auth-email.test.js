import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authOptions, deliverAuthEmail } from '../online/auth-options.js'

const account = 'a'.repeat(32)
const env = { AUTH_EMAIL_PROVIDER: 'cloudflare', CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_EMAIL_API_TOKEN: 'synthetic-cloudflare-token', AUTH_EMAIL_FROM: 'no-reply@example.test' }
const message = { to: 'player@example.test', subject: 'Verify your Botters email', text: 'Synthetic verification link: https://botters.example.test/verify?token=not-a-real-token' }
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/email/sending/send`
const result = overrides => ({ success: true, errors: [], messages: [], result: { delivered: [message.to], permanent_bounces: [], queued: [], ...overrides } })

for (const status of ['delivered', 'queued']) test(`Cloudflare ${status}: exact endpoint, credentials, content and bounded request`, async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++
    assert.equal(url, endpoint)
    assert.equal(options.method, 'POST')
    assert.equal(options.headers.authorization, `Bearer ${env.CLOUDFLARE_EMAIL_API_TOKEN}`)
    assert.equal(options.headers['content-type'], 'application/json')
    assert.equal(options.redirect, 'error')
    assert.deepEqual(JSON.parse(options.body), { from: env.AUTH_EMAIL_FROM, ...message })
    assert.ok(options.signal instanceof AbortSignal)
    assert.equal(options.signal.aborted, false)
    return Response.json(result({ delivered: status === 'delivered' ? [message.to] : [], queued: status === 'queued' ? [message.to] : [], message_id: '<synthetic@example.test>', suppressed_recipients: [] }))
  })
  const timeouts = []
  t.mock.method(AbortSignal, 'timeout', milliseconds => { timeouts.push(milliseconds); return new AbortController().signal })
  assert.deepEqual(await deliverAuthEmail(env, { ...message, from: 'override@example.test', bcc: 'extra@example.test' }), { provider: 'cloudflare', status, messageId: '<synthetic@example.test>' })
  assert.equal(calls, 1)
  assert.deepEqual(timeouts, [8000])
})

test('Cloudflare guide response without message ID is accepted without inventing one', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(result()))
  assert.deepEqual(await deliverAuthEmail(env, message), { provider: 'cloudflare', status: 'delivered' })
})

for (const [label, override] of [
  ['unknown provider', { AUTH_EMAIL_PROVIDER: 'cloudflrae', RESEND_API_KEY: 'synthetic' }],
  ['empty provider', { AUTH_EMAIL_PROVIDER: '' }],
  ['missing sender', { AUTH_EMAIL_FROM: '' }],
  ['missing token', { CLOUDFLARE_EMAIL_API_TOKEN: '' }],
  ['missing account', { CLOUDFLARE_ACCOUNT_ID: '' }],
  ['path injection account', { CLOUDFLARE_ACCOUNT_ID: '../other-account' }],
  ['short account', { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(31) }],
  ['nonhex account', { CLOUDFLARE_ACCOUNT_ID: 'g'.repeat(32) }],
  ['missing Resend token', { AUTH_EMAIL_PROVIDER: 'resend' }],
]) test(`configuration refuses ${label} before network`, async t => {
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network must not run') })
  await assert.rejects(deliverAuthEmail({ ...env, ...override }, message), { message: 'Email delivery is not configured.' })
  assert.equal(network.mock.callCount(), 0)
})

for (const status of [301, 400, 401, 403, 404, 429, 500, 503]) test(`Cloudflare HTTP ${status} fails without fallback, retry or provider-body disclosure`, async t => {
  const network = t.mock.method(globalThis, 'fetch', async () => new Response('synthetic-private-provider-details', { status }))
  await assert.rejects(deliverAuthEmail({ ...env, RESEND_API_KEY: 'must-not-fallback' }, message), { message: 'Email delivery is unavailable.' })
  assert.equal(network.mock.callCount(), 1)
})

for (const [label, body] of [
  ['API failure in HTTP 200', { ...result(), success: false }],
  ['API errors in HTTP 200', { ...result(), errors: [{ code: 10102, message: 'synthetic-private-details' }] }],
  ['missing API success', { result: result().result }],
  ['missing errors', { success: true, result: result().result }],
  ['null body', null],
  ['missing result', { success: true, errors: [] }],
  ['empty result', { success: true, errors: [], result: {} }],
  ['permanent bounce', result({ delivered: [], permanent_bounces: [message.to] })],
  ['contradictory bounce', result({ permanent_bounces: [message.to] })],
  ['suppression', result({ delivered: [], suppressed_recipients: [message.to] })],
  ['contradictory suppression', result({ suppressed_recipients: [message.to] })],
  ['malformed suppression', result({ suppressed_recipients: null })],
  ['no recipient outcome', result({ delivered: [] })],
  ['another recipient', result({ delivered: ['other@example.test'] })],
  ['extra recipient', result({ delivered: [message.to, 'other@example.test'] })],
  ['contradictory statuses', result({ queued: [message.to] })],
  ['nonarray delivered', result({ delivered: message.to })],
  ['nonarray queued', result({ queued: null })],
  ['nonarray bounces', result({ permanent_bounces: null })],
]) test(`Cloudflare refuses ${label}`, async t => {
  const network = t.mock.method(globalThis, 'fetch', async () => Response.json(body))
  await assert.rejects(deliverAuthEmail(env, message), { message: 'Email delivery is unavailable.' })
  assert.equal(network.mock.callCount(), 1)
})

test('invalid provider JSON is not a successful send', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('not JSON'))
  await assert.rejects(deliverAuthEmail(env, message), { message: 'Email delivery is unavailable.' })
})

for (const name of ['Error', 'TimeoutError', 'AbortError']) test(`transport ${name} is redacted and not retried`, async t => {
  const error = new Error('synthetic-private-token-and-url'); error.name = name
  const network = t.mock.method(globalThis, 'fetch', async () => { throw error })
  await assert.rejects(deliverAuthEmail(env, message), { message: 'Email delivery is unavailable.' })
  assert.equal(network.mock.callCount(), 1)
})

test('response-body failure is redacted and not retried', async t => {
  const network = t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => { throw new Error('synthetic-private-response') } }))
  await assert.rejects(deliverAuthEmail(env, message), { message: 'Email delivery is unavailable.' })
  assert.equal(network.mock.callCount(), 1)
})

for (const provider of [undefined, 'resend']) test(`Resend ${provider || 'default'} preserves rollback and needs no Cloudflare credentials`, async t => {
  const network = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails')
    assert.equal(options.headers.authorization, 'Bearer synthetic-resend-token')
    assert.equal(options.redirect, 'error')
    assert.deepEqual(JSON.parse(options.body), { from: 'Botters <no-reply@example.test>', ...message })
    return Response.json({ id: 'synthetic-resend-id' })
  })
  const configured = { AUTH_EMAIL_FROM: 'Botters <no-reply@example.test>', RESEND_API_KEY: 'synthetic-resend-token', ...(provider ? { AUTH_EMAIL_PROVIDER: provider } : {}) }
  assert.deepEqual(await deliverAuthEmail(configured, message), { provider: 'resend', status: 'accepted' })
  assert.equal(network.mock.callCount(), 1)
})

test('real auth callbacks use the selected adapter without changing links or templates', async t => {
  const sent = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, endpoint)
    const body = JSON.parse(options.body); sent.push(body)
    return Response.json(result())
  })
  const options = authOptions({ ...env, SITE_URL: 'https://botters.example.test', BETTER_AUTH_SECRET: 'synthetic-auth-secret-1234567890123456' }, mail => deliverAuthEmail(env, mail))
  const user = { email: message.to }, url = 'https://botters.example.test/api/auth/test?token=synthetic-only'
  await options.emailVerification.sendVerificationEmail({ user, url })
  await options.emailAndPassword.sendResetPassword({ user, url })
  assert.equal(sent.length, 2)
  assert.deepEqual(sent.map(mail => mail.subject), ['Verify your Botters email', 'Reset your Botters password'])
  for (const mail of sent) { assert.equal(mail.to, user.email); assert.ok(mail.text.includes(url)); assert.ok(mail.text.includes('one hour')) }
})
