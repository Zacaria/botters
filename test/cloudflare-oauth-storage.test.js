import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { runtime, client, ORIGIN } from './helpers/cloudflare.js'

const DAY = 86400000
const registration = (extra = {}) => ({ client_name: 'Storage proof', redirect_uris: ['http://localhost:4000/callback'], token_endpoint_auth_method: 'none', ...extra })
const expires = async (db, id) => (await db.prepare('SELECT expires FROM game_records WHERE key=?').bind(`oauth:client:${id}`).first()).expires

test('client registrations are small, short-lived until a person approves one, and rate limited', { timeout: 120000 }, async t => {
  const { mf, mail, db } = await runtime(); t.after(() => mf.dispose())
  const human = client(mf), browser = client(mf)
  for (const bad of [{ redirect_uris: Array(5).fill('http://localhost:4000/callback') }, { redirect_uris: ['https://app.example.invalid/' + 'a'.repeat(500)] }, { client_name: 'n'.repeat(81) }]) {
    assert.equal((await browser.call('POST', '/register', registration(bad))).status, 400)
  }
  const registered = await browser.call('POST', '/register', registration())
  assert.equal(registered.status, 201)
  const id = registered.body.client_id, unused = await expires(db, id) - Date.now()
  assert.ok(unused > DAY - 60000 && unused <= DAY, `unused registration kept ${unused} ms`)

  await human.signUp('StorageOwner')
  const verify = new URL(mail[0].text.match(/http:\/\/[^\s]+/)[0]); await human.call('GET', verify.pathname + verify.search)
  const session = (await human.call('POST', '/session', {})).body
  await human.call('POST', '/exchange', { ticket: session.liveTicket })
  const challenge = createHash('sha256').update('a'.repeat(64)).digest('base64url')
  const authorize = await browser.call('GET', '/authorize?' + new URLSearchParams({ client_id: id, redirect_uri: 'http://localhost:4000/callback', response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', resource: ORIGIN + '/mcp', scope: 'botters:play', state: 's' }))
  const consent = authorize.headers.get('location'), transaction = new URL(consent, ORIGIN).searchParams.get('transaction')
  const pairId = (await browser.call('GET', consent)).body.match(/\?pair=([\w-]{32})/)[1]
  const stillUnused = await expires(db, id) - Date.now()
  assert.ok(stillUnused <= DAY, 'asking for consent does not extend a registration')
  await human.call('POST', `/agent/approve?token=${session.humanToken}`, { id: pairId })
  assert.equal((await browser.call('POST', '/consent/complete', { transaction })).body.approved, true)
  const used = await expires(db, id) - Date.now()
  assert.ok(used > 29 * DAY && used <= 30 * DAY, `approved registration kept ${used} ms`)

  const codes = []
  for (let i = 0; i < 32; i++) codes.push((await browser.call('POST', '/register', registration(), { 'cf-connecting-ip': '203.0.113.50' })).status)
  assert.deepEqual([codes.filter(c => c === 201).length, codes.filter(c => c === 429).length], [30, 2])
})

test('scheduled cleanup removes every expired record, not only the first 500', { timeout: 120000 }, async t => {
  const { mf, db } = await runtime(); t.after(() => mf.dispose())
  const past = Date.now() - 1000
  for (let batch = 0; batch < 7; batch++) await db.batch(Array.from({ length: 100 }, (_, i) => db.prepare('INSERT INTO game_records (key, value, expires) VALUES (?, ?, ?)').bind(`expired:${batch}:${i}`, '{}', past)))
  await db.prepare('INSERT INTO game_records (key, value, expires) VALUES (?, ?, ?), (?, ?, ?)').bind('kept:forever', '{}', 0, 'kept:later', '{}', Date.now() + DAY).run()
  await (await mf.getWorker()).scheduled({ cron: '*/10 * * * *' })
  assert.deepEqual((await db.prepare('SELECT key FROM game_records ORDER BY key').all()).results.map(r => r.key), ['kept:forever', 'kept:later'])
})
