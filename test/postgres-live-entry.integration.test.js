import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { once } from 'node:events'
import { writeFile, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createPostgresAuth } from '../online/postgres-auth.js'
import { PostgresStore } from '../online/postgres-store.js'

const database = process.env.BOTTERS_TEST_POSTGRES_URL

test('real live entry point starts with the PostgreSQL backend and stops cleanly', { skip: !database, timeout: 15000 }, async t => {
  const url = new URL(database)
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname === '127.0.0.1' && !url.search, 'use a dedicated loopback PostgreSQL database')
  const schema = `botters_entry_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Pool({ connectionString: database })
  let schemaCreated = false
  t.after(async () => {
    try { if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`) } finally { await admin.end() }
  })
  await admin.query(`CREATE SCHEMA "${schema}"`)
  schemaCreated = true
  const pool = new pg.Pool({ connectionString: database, options: `-c search_path=${schema}` })
  try {
    const auth = await createPostgresAuth({ pool, env: { SITE_URL: 'http://127.0.0.1:12345', BETTER_AUTH_SECRET: 'isolated-entry-test-secret-123456789012345' }, sendEmail: async () => {} })
    await auth.migrate()
    await new PostgresStore(pool, 'entry-test').init()
  } finally { await pool.end() }
  url.searchParams.set('options', `-c search_path=${schema}`)
  const socket = net.createServer().listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  let createdBuildId = false
  try { await writeFile('build-id.json', JSON.stringify({ commit: 'isolated-test' }), { flag: 'wx' }); createdBuildId = true } catch (error) { if (error.code !== 'EEXIST') throw error }
  const child = spawn(process.execPath, ['scripts/live-server.js'], { env: { ...process.env, BOTTERS_LIVE_BACKEND: 'postgres', DATABASE_URL: url.toString(), BOTTERS_STORE_NAMESPACE: 'entry-test', BOTTERS_REQUIRE_ACCOUNT: '1', PLAYER_ORIGINS: 'https://example.invalid', HOST: '127.0.0.1', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { output += data })
  try {
    let response
    const deadline = Date.now() + 8000
    while (Date.now() < deadline && child.exitCode === null) {
      try { response = await fetch(`http://127.0.0.1:${port}/health`); break } catch { await new Promise(resolve => setTimeout(resolve, 50)) }
    }
    assert.ok(response, `live server did not start: ${output}`)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).transport, 'colyseus')
  } finally {
    if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit') }
    if (createdBuildId) await unlink('build-id.json')
  }
  assert.equal(child.exitCode, 0, output)
})
