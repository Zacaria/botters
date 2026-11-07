import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createPostgresAuth } from '../online/postgres-auth.js'
import { PostgresStore } from '../online/postgres-store.js'

const url = process.env.BOTTERS_TEST_POSTGRES_URL

test('PostgreSQL exchanges one ticket only for the verified owning session', { skip: !url }, async () => {
  const target = new URL(url)
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) && !target.search)
  const schema = `botters_exchange_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Pool({ connectionString: url }); let pool
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`)
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    const origin = 'http://127.0.0.1:9876', mail = []
    const service = await createPostgresAuth({ pool, env: { SITE_URL: origin, BETTER_AUTH_SECRET: 'isolated-postgres-test-secret-123456789012345' }, sendEmail: async message => mail.push(message) })
    await service.migrate()
    const request = (path, body, cookie) => service.auth.handler(new Request(path.startsWith('http:') ? path : `${origin}/api/auth${path}`, { method: body ? 'POST' : 'GET', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }))
    async function account(name) {
      const email = `${name}@example.test`, password = 'synthetic-password-12345!'
      assert.equal((await request('/sign-up/email', { email, password, name, callbackURL: '/' })).status, 200)
      assert.equal((await request(mail.at(-1).text.match(/http:\/\/\S+/)[0])).status, 302)
      const response = await request('/sign-in/email', { email, password }); assert.equal(response.status, 200)
      const cookie = response.headers.getSetCookie().map(v => v.split(';')[0]).join('; ')
      return { ...(await (await request('/get-session', null, cookie)).json()), cookie }
    }
    const alice = await account('alice'), bob = await account('bob')
    const store = new PostgresStore(pool, 'exchange'); await store.init()
    const hash = c => c.repeat(64), tokenKey = `token:${hash('a')}`, ticketKey = `live-ticket:${hash('b')}`
    const grant = { id: 'game-alice', role: 'human', accountId: alice.user.id, authSessionId: alice.session.id, expires: Date.now() + 60000 }
    const write = async (key, value) => assert.equal(await store.commit([{ key, raw: await store.get(key), value: JSON.stringify(value), ttl: 60 }]), 1)
    await write(tokenKey, grant); await write('session:game-alice', { id: 'game-alice', accountId: bob.user.id }); await write(ticketKey, { tokenKey })
    await assert.rejects(store.exchange(hash('b'), hash('c')))
    assert.ok(await store.get(ticketKey), 'wrong account must not consume ticket')
    await write('session:game-alice', { id: 'game-alice', accountId: alice.user.id })
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => store.exchange(hash('b'), hash('c'))))
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
    assert.equal(await store.get(ticketKey), null)
    assert.equal(JSON.parse(await store.get(tokenKey)).liveCookieHash, hash('c'))
    await write(ticketKey, { tokenKey }); await assert.rejects(store.exchange(hash('b'), hash('d')))
    await write(tokenKey, grant); await request('/sign-out', {}, alice.cookie)
    await assert.rejects(store.exchange(hash('b'), hash('d')), 'revoked Better Auth session must fail')
    assert.ok(await store.get(ticketKey))
    await assert.rejects(store.exchange('invalid', hash('d')))
  } finally {
    if (pool) await pool.end()
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end()
  }
})
