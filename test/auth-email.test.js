import test from 'node:test'
import assert from 'node:assert/strict'
import { deliverAuthEmail } from '../online/auth-options.js'

const env = { AUTH_EMAIL_FROM: 'no-reply@example.test', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_EMAIL_API_TOKEN: 'test-token' }
const message = { to: 'p@example.test', subject: 's', text: 't https://x.test' }
const ok = result => ({ success: true, errors: [], result: { delivered: [], queued: [], permanent_bounces: [], suppressed_recipients: [], ...result } })

async function withFetch(impl, fn) {
  const real = globalThis.fetch
  globalThis.fetch = impl
  try { return await fn() } finally { globalThis.fetch = real }
}

test('sends one Cloudflare request with from/to/subject/text and bearer token', async () => {
  let seen
  await withFetch(async (url, o) => { seen = { url, o }; return Response.json(ok({ queued: [message.to] })) }, async () => {
    assert.deepEqual(await deliverAuthEmail(env, message), { status: 'queued' })
  })
  assert.equal(seen.url, `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/email/sending/send`)
  assert.equal(seen.o.headers.authorization, 'Bearer test-token')
  assert.deepEqual(JSON.parse(seen.o.body), { from: env.AUTH_EMAIL_FROM, ...message })
})

test('refuses missing configuration without any request', async () => {
  await withFetch(async () => { throw new Error('network') }, async () => {
    for (const bad of [{ ...env, CLOUDFLARE_EMAIL_API_TOKEN: '' }, { ...env, AUTH_EMAIL_FROM: '' }, { ...env, CLOUDFLARE_ACCOUNT_ID: 'nope' }]) {
      await assert.rejects(deliverAuthEmail(bad, message), /not configured/)
    }
  })
})

test('fails with a generic error on HTTP error, bounce, suppression or wrong recipient', async () => {
  const cases = [new Response('boom', { status: 500 }), Response.json({ success: false, errors: [{ code: 1 }], result: null }),
    Response.json(ok({ permanent_bounces: [message.to] })), Response.json(ok({ suppressed_recipients: [message.to] })),
    Response.json(ok({ delivered: ['other@example.test'] })), Response.json(ok({}))]
  for (const res of cases) {
    await withFetch(async () => res, async () => {
      await assert.rejects(deliverAuthEmail(env, message), e => e.message === 'Email delivery is unavailable.')
    })
  }
})
