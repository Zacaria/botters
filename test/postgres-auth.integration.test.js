import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const url = process.env.BOTTERS_TEST_POSTGRES_URL

test('PostgreSQL preserves verified credentials and sessions across auth restarts', { skip: !url }, async () => {
  const target = new URL(url)
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname), 'test database must be loopback')
  const { createPostgresAuth } = await import('../online/postgres-auth.js')
  const schema = `botters_test_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Pool({ connectionString: url })
  let pool
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`)
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    const mail = [], origin = 'http://127.0.0.1:9876'
    const env = { SITE_URL: origin, BETTER_AUTH_SECRET: 'isolated-postgres-test-secret-123456789012345' }
    let service = await createPostgresAuth({ pool, env, sendEmail: async message => mail.push(message) })
    await service.migrate()
    const request = (path, body, cookie) => service.auth.handler(new Request(path.startsWith('http:') ? path : `${origin}/api/auth${path}`, { method: body ? 'POST' : 'GET', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }))
    const email = 'pilot@example.test', password = 'synthetic-password-12345!'
    assert.equal((await request('/sign-up/email', { email, password, name: 'Pilot', callbackURL: '/' })).status, 200)
    assert.equal((await request('/sign-in/email', { email, password })).status, 403)
    assert.equal(mail.length, 2)
    assert.equal((await request(mail.at(-1).text.match(/http:\/\/\S+/)[0])).status, 302)
    const login = await request('/sign-in/email', { email, password })
    assert.equal(login.status, 200)
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    assert.ok(cookie)
    service = await createPostgresAuth({ pool, env, sendEmail: async message => mail.push(message) })
    assert.equal((await (await request('/get-session', null, cookie)).json()).user.emailVerified, true)
    const rows = await pool.query('SELECT password FROM account WHERE password IS NOT NULL')
    assert.equal(rows.rowCount, 1)
    assert.notEqual(rows.rows[0].password, password)
    assert.equal((await request('/sign-out', {}, cookie)).status, 200)
    assert.equal(await (await request('/get-session', null, cookie)).json(), null)
  } finally {
    if (pool) await pool.end()
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await admin.end()
  }
})
