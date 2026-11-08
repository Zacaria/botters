import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import pg from 'pg'
import { createPostgresAuth } from '../online/postgres-auth.js'
import { PostgresStore } from '../online/postgres-store.js'
import { PostgresLiveDurable } from '../online/postgres-live-durable.js'

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
    const authorized = await store.authorize(tokenKey)
    assert.equal(JSON.parse(authorized.session).accountId, alice.user.id)
    assert.equal(JSON.parse(authorized.token).liveCookieHash, hash('c'))
    assert.ok(authorized.expiresAt > Date.now() && authorized.expiresAt <= grant.expires)
    await write('session:game-alice', { id: 'game-alice', accountId: bob.user.id })
    assert.equal((await store.authorize(tokenKey)).token, null, 'cross-account owner must fail closed')
    await write('session:game-alice', { id: 'game-alice', accountId: alice.user.id })
    await write(tokenKey, grant)
    assert.equal((await store.authorize(tokenKey)).token, null, 'unbound cookie must fail closed')
    await write(tokenKey, { ...grant, liveCookieHash: hash('c'), authSessionId: bob.session.id })
    assert.equal((await store.authorize(tokenKey)).token, null, 'another account session must fail closed')
    await write(tokenKey, { ...grant, liveCookieHash: hash('c') })
    await pool.query('UPDATE "user" SET "emailVerified" = false WHERE id = $1', [alice.user.id])
    assert.equal((await store.authorize(tokenKey)).token, null, 'unverified account must fail closed')
    await pool.query('UPDATE "user" SET "emailVerified" = true WHERE id = $1', [alice.user.id])
    await pool.query("UPDATE botters_records SET expires_at = clock_timestamp() - interval '1 second' WHERE namespace = $1 AND key = $2", ['exchange', 'session:game-alice'])
    assert.equal((await store.authorize(tokenKey)).token, null, 'expired owner must fail closed')
    await write('session:game-alice', { id: 'game-alice', accountId: alice.user.id })
    assert.equal((await store.authorize(`token:${hash('f')}`)).token, null, 'missing capability must fail closed')
    await assert.rejects(store.authorize('invalid'))
    await write(ticketKey, { tokenKey }); await assert.rejects(store.exchange(hash('b'), hash('d')))
    // The auth row can be locked by another process after the ticket is read.
    // A ticket that expires during that wait must not be exchanged.
    await write(tokenKey, grant)
    await pool.query("UPDATE botters_records SET expires_at = clock_timestamp() + interval '2 seconds' WHERE namespace = $1 AND key = $2", ['exchange', ticketKey])
    const blocker = await pool.connect()
    try {
      await blocker.query('BEGIN')
      await blocker.query('SELECT id FROM session WHERE id = $1 FOR UPDATE', [alice.session.id])
      const exchanging = store.exchange(hash('b'), hash('d'))
      const deadline = Date.now() + 1500
      let waiting = false
      while (Date.now() < deadline) {
        const result = await admin.query("SELECT 1 FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE OF s, u%'")
        if (result.rowCount) { waiting = true; break }
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      assert.ok(waiting, 'exchange must wait on the real session row')
      await new Promise(resolve => setTimeout(resolve, 2200))
      await blocker.query('COMMIT')
      await assert.rejects(exchanging, /Expired live/)
      assert.equal(JSON.parse(await store.get(tokenKey)).liveCookieHash, undefined)
    } finally { await blocker.query('ROLLBACK').catch(() => {}); blocker.release() }
    await write(ticketKey, { tokenKey })
    const agentKey = `token:${hash('e')}`
    const agent = { id: 'game-alice', role: 'agent', version: 1, expires: Date.now() + 30000 }
    await write('session:game-alice', { id: 'game-alice', accountId: alice.user.id, agentVersion: 1 })
    await write(agentKey, agent)
    let agentAuthority = await store.authorize(agentKey)
    assert.equal(JSON.parse(agentAuthority.token).role, 'agent')
    assert.ok(agentAuthority.expiresAt <= agent.expires)
    await write('session:game-alice', { id: 'game-alice', accountId: alice.user.id, agentVersion: 2 })
    assert.equal((await store.authorize(agentKey)).token, null, 'revoked agent must fail closed')
    await write(agentKey, { ...agent, version: undefined })
    await write('session:game-alice', { id: 'game-alice', accountId: alice.user.id })
    assert.equal((await store.authorize(agentKey)).token, null, 'missing versions must not match')
    await write(agentKey, agent)
    await write('session:game-alice', { id: 'game-alice', accountId: alice.user.id, agentVersion: 1 })
    await write(tokenKey, { ...grant, liveCookieHash: hash('c') })
    const secondPool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    let observed
    const durable = new PostgresLiveDurable(new PostgresStore(secondPool, 'exchange'), { intervalMs: 25, leaseMs: 500 })
    const entry = await durable.authority(tokenKey, async value => { observed = value })
    try {
      assert.ok(observed.token)
      await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
        import pg from 'pg';
        const pool = new pg.Pool({ connectionString: process.env.TEST_URL, options: '-c search_path=' + process.env.TEST_SCHEMA });
        const result = await pool.query('DELETE FROM session WHERE id = $1', [process.env.TEST_SESSION]);
        await pool.end();
        if (result.rowCount !== 1) process.exit(1);
      `], { env: { ...process.env, TEST_URL: url, TEST_SCHEMA: schema, TEST_SESSION: alice.session.id } })
      const deadline = Date.now() + 3000
      while (observed.token && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
      assert.equal(observed.token, null, 'revocation by another process is observed')
      assert.equal(entry.connected(), false)
    } finally { await entry.close(); await secondPool.end() }
    agentAuthority = await store.authorize(agentKey)
    assert.equal(JSON.parse(agentAuthority.token).role, 'agent', 'human sign-out must not revoke agent')
    await write(tokenKey, { ...grant, liveCookieHash: hash('c') })
    assert.equal((await store.authorize(tokenKey)).token, null, 'revoked auth session must fail closed')
    await write(tokenKey, grant)
    await assert.rejects(store.exchange(hash('b'), hash('d')), 'revoked Better Auth session must fail')
    assert.ok(await store.get(ticketKey))
    await assert.rejects(store.exchange('invalid', hash('d')))
  } finally {
    if (pool) await pool.end()
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end()
  }
})
