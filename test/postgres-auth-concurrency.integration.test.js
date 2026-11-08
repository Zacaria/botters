import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import net from 'node:net'
import http from 'node:http'
import pg from 'pg'
import { createPostgresAuth } from '../online/postgres-auth.js'
import { PostgresStore } from '../online/postgres-store.js'

const database = process.env.BOTTERS_TEST_POSTGRES_URL
const port = async () => {
  const server = net.createServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const n = server.address().port
  await new Promise(resolve => server.close(resolve))
  return n
}

test('actual PostgreSQL controls share an atomic auth limit across processes and ignore forged proxy IPs', { skip: !database, timeout: 30000 }, async t => {
  const url = new URL(database)
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname === '127.0.0.1' && !url.search, 'use a dedicated loopback PostgreSQL database')
  const schema = `botters_limit_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Pool({ connectionString: database })
  let created = false
  const children = []
  t.after(async () => {
    for (const child of children) if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit') }
    try { if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`) } finally { await admin.end() }
  })
  await admin.query(`CREATE SCHEMA "${schema}"`); created = true
  const pool = new pg.Pool({ connectionString: database, options: `-c search_path=${schema}` })
  const first = await port(), second = await port(), origin = `http://127.0.0.1:${first}`
  const env = { SITE_URL: origin, BOTTERS_AUTH_ORIGIN: origin, BETTER_AUTH_SECRET: 'synthetic-concurrency-secret-123456789012345', BOTTERS_STORE_NAMESPACE: 'rate-test' }
  try {
    await (await createPostgresAuth({ pool, env, sendEmail: async () => {} })).migrate()
    await new PostgresStore(pool, 'rate-test').init()
  } finally { await pool.end() }
  url.searchParams.set('options', `-c search_path=${schema}`)
  for (const p of [first, second]) {
    const child = spawn(process.execPath, ['scripts/postgres-http-server.js'], { env: { ...process.env, ...env, DATABASE_URL: url.toString(), HOST: '127.0.0.1', PORT: String(p) }, stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(child)
    let output = ''
    child.stdout.on('data', d => { output += d }); child.stderr.on('data', d => { output += d })
    const deadline = Date.now() + 8000
    let ready = false
    while (Date.now() < deadline && child.exitCode === null) {
      try { await fetch(`http://127.0.0.1:${p}/account`, { headers: { host: `127.0.0.1:${first}` } }); ready = true; break } catch { await new Promise(r => setTimeout(r, 40)) }
    }
    assert.ok(ready, `control did not start: ${output}`)
  }
  // Keep the burst away from the fixed-window transition.
  const remaining = 60000 - Date.now() % 60000
  if (remaining < 6000) await new Promise(r => setTimeout(r, remaining + 100))
  // Node fetch overwrites Host with the destination port; raw HTTP preserves the common origin.
  const attempts = await Promise.all(Array.from({ length: 20 }, (_, i) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: i % 2 ? second : first, path: '/api/auth/sign-in/email',
      method: 'POST', headers: { host: `127.0.0.1:${first}`, origin, 'content-type': 'application/json', 'x-vercel-forwarded-for': `192.0.2.${i + 1}`, 'x-botters-client-ip': `198.51.100.${i + 1}` } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk }); res.on('end', () => resolve({ status: res.statusCode, body }))
      res.on('error', reject)
    })
    req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('request timeout')))
    req.end(JSON.stringify({ email: 'nobody@example.test', password: 'synthetic-password-12345' }))
  })))
  const outcomes = attempts
  const statuses = outcomes.map(r => r.status)
  t.diagnostic(`Synthetic sign-in outcomes: ${JSON.stringify(outcomes)}`)
  assert.equal(statuses.filter(s => s === 401).length, 5, JSON.stringify(outcomes))
  assert.equal(statuses.filter(s => s === 429).length, 15, JSON.stringify(outcomes))
  assert.ok(outcomes.filter(o => o.status === 401).every(o => JSON.parse(o.body).code === 'INVALID_EMAIL_OR_PASSWORD'))
  assert.ok(outcomes.filter(o => o.status === 429).every(o => JSON.parse(o.body).error === 'Too many sign-in attempts. Retry later.'))
  const rows = await admin.query(`SELECT value FROM "${schema}".botters_records WHERE namespace = 'rate-test' AND key LIKE 'auth-limit:%'`)
  assert.equal(rows.rowCount, 1)
  assert.equal(JSON.parse(rows.rows[0].value).n, 5)
  // Reset only this synthetic schema's counter to exercise the distinct host guard.
  await admin.query(`DELETE FROM "${schema}".botters_records WHERE namespace = 'rate-test' AND key LIKE 'auth-limit:%'`)
  const wrongHost = await fetch(`http://127.0.0.1:${second}/api/auth/sign-in/email`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nobody@example.test', password: 'synthetic-password-12345' }),
  })
  assert.equal(wrongHost.status, 400)
  assert.deepEqual(await wrongHost.json(), { error: `Sign in at ${origin}.` })
})
