import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { runtime, client, ORIGIN } from './helpers/cloudflare.js'

const DAY = 86400000

test('token endpoint: a used registration stays alive, a busy answer keeps the refresh token, a lost registration says so', { timeout: 120000 }, async t => {
  const { mf, mail, db } = await runtime(); t.after(() => mf.dispose())
  const human = client(mf), browser = client(mf)
  await human.signUp('RecoveryOwner')
  const verify = new URL(mail[0].text.match(/http:\/\/[^\s]+/)[0]); await human.call('GET', verify.pathname + verify.search)
  const session = (await human.call('POST', '/session', {})).body
  await human.call('POST', '/exchange', { ticket: session.liveTicket })
  const id = (await browser.call('POST', '/register', { client_name: 'Recovery proof', redirect_uris: ['http://localhost:4000/callback'], token_endpoint_auth_method: 'none' })).body.client_id
  const verifier = 'a'.repeat(64), challenge = createHash('sha256').update(verifier).digest('base64url')
  const authorize = await browser.call('GET', '/authorize?' + new URLSearchParams({ client_id: id, redirect_uri: 'http://localhost:4000/callback', response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', resource: ORIGIN + '/mcp', scope: 'botters:play', state: 's' }))
  const consent = authorize.headers.get('location'), transaction = new URL(consent, ORIGIN).searchParams.get('transaction')
  const pairId = (await browser.call('GET', consent)).body.match(/\?pair=([\w-]{32})/)[1]
  await human.call('POST', `/agent/approve?token=${session.humanToken}`, { id: pairId })
  const code = new URL((await browser.call('POST', '/consent/complete', { transaction })).body.url).searchParams.get('code')
  const first = await browser.call('POST', '/token', { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: id, redirect_uri: 'http://localhost:4000/callback', resource: ORIGIN + '/mcp' })
  assert.equal(first.status, 200, JSON.stringify(first.body))
  const refresh = (token, extra) => browser.call('POST', '/token', { grant_type: 'refresh_token', refresh_token: token, client_id: id, resource: ORIGIN + '/mcp' }, extra)
  const key = `oauth:client:${id}`

  // Twenty-eight days after its last use, a registration that refreshes is kept another thirty days.
  const row = await db.prepare('SELECT value FROM game_records WHERE key=?').bind(key).first()
  await db.prepare('UPDATE game_records SET value=?, expires=? WHERE key=?').bind(JSON.stringify({ ...JSON.parse(row.value), used: Date.now() - 28 * DAY }), Date.now() + 2 * DAY, key).run()
  const second = await refresh(first.body.refresh_token)
  assert.equal(second.status, 200, JSON.stringify(second.body))
  const kept = (await db.prepare('SELECT expires FROM game_records WHERE key=?').bind(key).first()).expires - Date.now()
  assert.ok(kept > 29 * DAY, `registration kept ${kept} ms after a refresh`)

  // An address over its allowance is told to wait; its refresh token is not reported as invalid.
  const ip = '203.0.113.77'
  await db.prepare('INSERT INTO game_records (key, value, expires) VALUES (?, ?, ?)').bind(`oauth:limit:${createHash('sha256').update(ip).digest('hex')}:${Math.floor(Date.now() / 600000)}`, JSON.stringify({ n: 200 }), Date.now() + 600000).run()
  const busy = await refresh(second.body.refresh_token, { 'cf-connecting-ip': ip })
  assert.equal(busy.status, 429)
  assert.equal(busy.body.error, 'temporarily_unavailable')
  assert.ok(Number(busy.headers.get('retry-after')) > 0)
  const third = await refresh(second.body.refresh_token)
  assert.equal(third.status, 200, JSON.stringify(third.body))

  // A registration that no longer exists is reported as such, so the client registers again.
  await db.prepare('DELETE FROM game_records WHERE key=?').bind(key).run()
  const lost = await refresh(third.body.refresh_token)
  assert.equal(lost.status, 401)
  assert.equal(lost.body.error, 'invalid_client')
})
