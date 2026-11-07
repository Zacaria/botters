import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const url = process.env.BOTTERS_TEST_POSTGRES_URL

test('PostgreSQL store serializes CAS, expires records and projects rankings', { skip: !url }, async () => {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname), 'test database must be loopback')
  const { PostgresStore } = await import('../online/postgres-store.js')
  const schema = `botters_test_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Pool({ connectionString: url })
  let pool
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`)
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` })
    const store = new PostgresStore(pool, 'test'), other = new PostgresStore(pool, 'other')
    await store.init()
    const entry = (key, raw, value, ttl = 0) => ({ key, raw, value, ttl })
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => store.commit([entry('key', null, JSON.stringify(i))])))
    assert.equal(results.reduce((a, b) => a + b), 1)
    const original = await store.get('key')
    assert.equal(await other.get('key'), null)
    assert.equal(await store.commit([entry('key', 'wrong', 'new'), entry('second', null, 'value')]), 0)
    assert.equal(await store.get('second'), null)
    assert.equal(await store.commit([entry('key', original, '')]), 1)
    assert.equal(await store.get('key'), original)
    await assert.rejects(store.commit([entry('key', original, 'x'), entry('key', original, 'y')]))
    await assert.rejects(store.commit([entry('bad', null, 'x', -1)]))
    assert.equal(await store.commit([entry('expiring', null, 'old', 0.01)]), 1)
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(await store.get('expiring'), null)
    assert.equal(await store.commit([entry('expiring', null, 'new')]), 1)
    const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64)
    assert.equal(await store.commit([entry(`elo:${b}`, null, '{"rating":10}'), entry(`elo:${a}`, null, '{"rating":10}'), entry(`elo:${c}`, null, '{"rating":20}')]), 1)
    const board = await store.get('leaderboard')
    assert.deepEqual(JSON.parse(board).map(pair => pair[0]), [c, a, b])
    await assert.rejects(store.commit([entry('leaderboard', board, '[]')]))
    assert.equal(await store.commit([entry('leaderboard', board, ''), entry(`elo:${c}`, '{"rating":20}', '{"rating":5}')]), 1)
    assert.equal(await store.commit([entry('leaderboard', board, ''), entry('second', null, 'stale')]), 0)
  } finally {
    if (pool) await pool.end()
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await admin.end()
  }
})
