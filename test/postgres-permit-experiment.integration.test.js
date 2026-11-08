import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const url = process.env.BOTTERS_TEST_POSTGRES_URL

test('committed permit prevents direct session deletion after holder disconnects', { skip: !url }, async () => {
  const target = new URL(url)
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) && !target.search)
  const schema = `botters_permit_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Pool({ connectionString: url })
  let pool
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`)
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    await pool.query('CREATE TABLE session (id text PRIMARY KEY)')
    await pool.query('CREATE TABLE permit (id text PRIMARY KEY, session_id text NOT NULL REFERENCES session(id) ON DELETE RESTRICT)')
    await pool.query("INSERT INTO session VALUES ('alice'), ('bob')")
    const holder = new pg.Client({ connectionString: url, options: `-c search_path=${schema}` })
    await holder.connect()
    const disconnected = new Promise(resolve => holder.once('error', resolve))
    const pid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    await holder.query('BEGIN')
    await holder.query("SELECT id FROM session WHERE id = 'alice' FOR UPDATE")
    await holder.query("INSERT INTO permit VALUES ('active', 'alice')")
    await holder.query('COMMIT')
    assert.equal((await admin.query('SELECT pg_terminate_backend($1) AS terminated', [pid])).rows[0].terminated, true)
    await disconnected
    await holder.end()
    await assert.rejects(pool.query("DELETE FROM session WHERE id = 'alice'"), { code: '23503' })
    assert.equal((await pool.query("SELECT id FROM session WHERE id = 'alice'")).rowCount, 1)
    assert.equal((await pool.query("DELETE FROM session WHERE id = 'bob'")).rowCount, 1)
    await pool.query("DELETE FROM permit WHERE id = 'active'")
    assert.equal((await pool.query("DELETE FROM session WHERE id = 'alice'")).rowCount, 1)
  } finally {
    await pool?.end()
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await admin.end()
  }
})
