import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createPostgresAuth } from '../online/postgres-auth.js'
import { PostgresStore } from '../online/postgres-store.js'

const url = process.env.BOTTERS_TEST_POSTGRES_URL

test('empty PostgreSQL schema migrates twice and preserves two synthetic identities and relations', { skip: !url }, async () => {
  const target = new URL(url)
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) && !target.search, 'use an isolated loopback database')
  const schema = `botters_schema_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Pool({ connectionString: url })
  let pool
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`)
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    const mail = [], origin = 'http://127.0.0.1:9876'
    const service = await createPostgresAuth({ pool, env: { SITE_URL: origin, BETTER_AUTH_SECRET: 'isolated-postgres-test-secret-123456789012345' }, sendEmail: async message => mail.push(message) })
    const store = new PostgresStore(pool, 'schema-test')
    await service.migrate()
    await store.init()
    const schemaShape = async () => (await pool.query(`SELECT c.relname, con.contype, pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 ORDER BY 1, 2, 3`, [schema])).rows
    const before = await schemaShape()
    await service.migrate()
    await store.init()
    assert.deepEqual(await schemaShape(), before, 'second migration must preserve constraints')
    for (const table of ['user', 'account', 'session', 'verification', 'botters_records']) {
      assert.ok(before.some(row => row.relname === table && row.contype === 'p'), `${table} requires a primary key`)
    }
    for (const table of ['account', 'session']) {
      assert.ok(before.some(row => row.relname === table && row.contype === 'f' && row.definition.includes('REFERENCES "user"(id)')), `${table} must reference its user`)
    }
    assert.ok(before.some(row => row.relname === 'user' && row.contype === 'u' && row.definition === 'UNIQUE (email)'))
    const request = (path, body, cookie) => service.auth.handler(new Request(path.startsWith('http:') ? path : `${origin}/api/auth${path}`, { method: body ? 'POST' : 'GET', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }))
    async function account(name) {
      const email = `${name}@example.test`, password = 'synthetic-password-12345!'
      assert.equal((await request('/sign-up/email', { email, password, name, callbackURL: '/' })).status, 200)
      assert.equal((await request(mail.at(-1).text.match(/http:\/\/\S+/)[0])).status, 302)
      const login = await request('/sign-in/email', { email, password })
      assert.equal(login.status, 200)
      const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
      return (await (await request('/get-session', null, cookie)).json())
    }
    const alice = await account('alice'), bob = await account('bob')
    assert.notEqual(alice.user.id, bob.user.id)
    assert.notEqual(alice.session.id, bob.session.id)
    const links = await pool.query('SELECT u.id, a."userId" AS account_user, s."userId" AS session_user FROM "user" u JOIN account a ON a."userId" = u.id JOIN session s ON s."userId" = u.id WHERE s.id = ANY($1::text[]) ORDER BY u.id', [[alice.session.id, bob.session.id]])
    assert.equal(links.rowCount, 2)
    for (const row of links.rows) assert.equal(row.id, row.account_user), assert.equal(row.id, row.session_user)
    await assert.rejects(pool.query('UPDATE account SET "userId" = $1 WHERE "userId" = $2', ['nonexistent-synthetic-user', alice.user.id]), { code: '23503' })
    await assert.rejects(pool.query('UPDATE "user" SET email = $1 WHERE id = $2', [alice.user.email, bob.user.id]), { code: '23505' })
    await pool.query('INSERT INTO botters_records (namespace, key, value) VALUES ($1, $2, $3)', ['schema-test', 'same', 'value'])
    await assert.rejects(pool.query('INSERT INTO botters_records (namespace, key, value) VALUES ($1, $2, $3)', ['schema-test', 'same', 'other']), { code: '23505' })
    await service.migrate()
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM "user"')).rows[0].count, 2)
  } finally {
    if (pool) await pool.end()
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await admin.end()
  }
})
