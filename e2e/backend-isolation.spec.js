import { test, expect } from './fixtures.js'

// These checks deliberately consume a local quota; never run them on a host.
test.beforeEach(() => test.skip(!!process.env.BOTTERS_SERVER, 'Local backend isolation only'))

test('each backend still enforces the normal new-lobby quota', async ({ request }) => {
  let denied = false
  // Up to 41 requests also covers a wall-clock bucket changing during the test.
  for (let i = 0; i < 41; i++) {
    const response = await request.post('/session', { data: { name: 'Quota fixture' } })
    if (response.status() === 429) {
      expect(await response.json()).toEqual({ error: 'Too many new lobbies. Retry in ten minutes.' })
      denied = true
      break
    }
    expect(response.status()).toBe(200)
  }
  expect(denied).toBe(true)
})

test('the next test starts with a fresh lobby budget', async ({ request }) => {
  const response = await request.post('/session', { data: { name: 'Fresh fixture' } })
  expect(response.status()).toBe(200)
})
