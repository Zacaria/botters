import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const url = process.env.BOTTERS_TEST_POSTGRES_URL

test('a cut checked-out PostgreSQL client does not crash and is replaced', { skip: !url, timeout: 15000 }, async t => {
  const target = new URL(url)
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol) && target.hostname === '127.0.0.1' && !target.search)
  const source = `
    import pg from 'pg'
    import { guardPostgresPool } from './online/postgres-pool.js'
    import net from 'node:net'
    import { once } from 'node:events'
    let upstream, downstream
    const target = new URL(process.env.BOTTERS_TEST_POSTGRES_URL)
    const databasePort = Number(target.port || 5432)
    const proxy = net.createServer(socket => {
      downstream = socket
      upstream = net.connect(databasePort, '127.0.0.1')
      socket.on('error', () => {}); upstream.on('error', () => {})
      socket.pipe(upstream).pipe(socket)
    }).listen(0, '127.0.0.1')
    await once(proxy, 'listening')
    target.port = String(proxy.address().port)
    const pool = guardPostgresPool(new pg.Pool({ connectionString: target.toString() }))
    const client = await pool.connect()
    await client.query('SELECT 1')
    upstream.destroy(); downstream.destroy()
    await new Promise(resolve => client.once('end', resolve))
    client.release()
    const result = await pool.query('SELECT 2 AS value')
    if (result.rows[0].value !== 2) throw new Error('replacement query failed')
    await pool.end()
    await new Promise(resolve => proxy.close(resolve))
    console.log('replacement query succeeded')
  `
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') })
  let out = '', err = ''
  child.stdout.on('data', chunk => { out += chunk })
  child.stderr.on('data', chunk => { err += chunk })
  const [code] = await once(child, 'exit')
  assert.equal(code, 0, `checked-out connection cut terminated process: ${err}`)
  assert.match(out, /replacement query succeeded/)
})
