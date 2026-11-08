// Isolated browser test harness: real control/live processes; never deploy.
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { fork } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, unlink, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import pg from 'pg'
import { createPostgresAuth } from '../online/postgres-auth.js'
import { PostgresStore } from '../online/postgres-store.js'

const target = new URL(process.env.BOTTERS_TEST_POSTGRES_URL || 'invalid:')
if (!['postgres:', 'postgresql:'].includes(target.protocol) || target.hostname !== '127.0.0.1' || target.search) throw new Error('Dedicated loopback PostgreSQL URL required')
const origin = 'https://127.0.0.1:8789', liveOrigin = 'https://127.0.0.1:8790'
const schema = `botters_browser_${randomUUID().replaceAll('-', '')}`, mails = [], children = []
const admin = new pg.Pool({ connectionString: target.toString() })
let pool, server, liveProxy, tlsDir, createdSchema = false, buildId = false
const faults = new Map()
async function databaseProxy(name) {
  const sockets = new Set()
  const state = { down: false, sockets }
  const proxy = net.createServer(client => {
    if (state.down) return client.destroy()
    const upstream = net.connect(Number(target.port || 5432), '127.0.0.1')
    for (const socket of [client, upstream]) {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => { client.destroy(); upstream.destroy() })
    }
    client.pipe(upstream).pipe(client)
  }).listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  state.proxy = proxy; faults.set(name, state)
  const url = new URL(target); url.port = String(proxy.address().port)
  return url.toString()
}
async function stop() {
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)) }
  if (liveProxy) { liveProxy.closeAllConnections(); await new Promise(r => liveProxy.close(r)) }
  for (const child of children) if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit }
  for (const state of faults.values()) { for (const socket of state.sockets) socket.destroy(); await new Promise(resolve => state.proxy.close(resolve)) }
  if (pool) await pool.end()
  if (createdSchema) await admin.query(`DROP SCHEMA "${schema}" CASCADE`)
  await admin.end()
  if (buildId) await unlink('build-id.json')
  if (tlsDir) await rm(tlsDir, { recursive: true, force: true })
}
try {
  tlsDir = await mkdtemp(join(tmpdir(), 'botters-browser-tls-'))
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(tlsDir, 'key.pem'), '-out', join(tlsDir, 'cert.pem'), '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' })
  const tls = { key: await readFile(join(tlsDir, 'key.pem')), cert: await readFile(join(tlsDir, 'cert.pem')) }
  await admin.query(`CREATE SCHEMA "${schema}"`); createdSchema = true
  pool = new pg.Pool({ connectionString: target.toString(), options: `-c search_path=${schema}` })
  const secret = 'isolated-browser-only-secret-123456789012345'
  await (await createPostgresAuth({ pool, env: { SITE_URL: origin, BETTER_AUTH_SECRET: secret }, sendEmail: async () => {} })).migrate()
  await new PostgresStore(pool, 'browser').init()
  target.searchParams.set('options', `-c search_path=${schema}`)
  try { await writeFile('build-id.json', JSON.stringify({ commit: 'synthetic-browser' }), { flag: 'wx' }); buildId = true } catch (e) { if (e.code !== 'EEXIST') throw e }
  const common = { ...process.env, DATABASE_URL: target.toString(), BOTTERS_STORE_NAMESPACE: 'browser', HOST: '127.0.0.1' }
  function launch(file, env, capture) {
    const p = fork(file, [], { env: { ...common, ...env }, execArgv: capture ? ['--import', new URL('../test/fixtures/botters-real-journey/capture-mail.js', import.meta.url).pathname] : [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    children.push(p); p.on('message', m => { if (m.type === 'mail') mails.push(m) })
    p.stdout.pipe(process.stdout); p.stderr.pipe(process.stderr)
    return Promise.race([new Promise(resolve => p.stdout.on('data', b => { if (b.toString().includes('"service":')) resolve() })), once(p, 'exit').then(() => { throw new Error(`${file} exited during startup`) })])
  }
  const controlDatabase = await databaseProxy('control'), liveDatabase = await databaseProxy('live')
  await launch('scripts/postgres-http-server.js', { DATABASE_URL: controlDatabase, PORT: '8791', SITE_URL: origin, BOTTERS_AUTH_ORIGIN: origin, BETTER_AUTH_SECRET: secret, RESEND_API_KEY: 'synthetic', AUTH_EMAIL_FROM: 'botters@example.test' }, true)
  await launch('scripts/live-server.js', { DATABASE_URL: liveDatabase, PORT: '8792', BOTTERS_LIVE_BACKEND: 'postgres', BOTTERS_REQUIRE_ACCOUNT: '1', PLAYER_ORIGINS: origin }, false)
  liveProxy = https.createServer(tls, (req, res) => {
    const upstream = http.request({ host: '127.0.0.1', port: 8792, path: req.url, method: req.method, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res) })
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() }); req.pipe(upstream)
  })
  liveProxy.on('upgrade', (req, socket, head) => {
    const upstream = net.connect(8792, '127.0.0.1', () => { upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`); for (let i = 0; i < req.rawHeaders.length; i += 2) upstream.write(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`); upstream.write('\r\n'); upstream.write(head); socket.pipe(upstream).pipe(socket) })
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy())
  })
  liveProxy.listen(8790, '127.0.0.1'); await once(liveProxy, 'listening')
  const bundle = (await build({ entryPoints: ['browser-live.js'], bundle: true, format: 'esm', write: false })).outputFiles[0].text
  const assets = { '/': ['index.html', 'text/html'], '/sim.js': ['sim.js', 'text/javascript'], '/sim/pkg/botters_sim.js': ['sim/pkg/botters_sim.js', 'text/javascript'], '/sim/pkg/botters_sim_bg.wasm': ['sim/pkg/botters_sim_bg.wasm', 'application/wasm'], '/guide': ['guide.html', 'text/html'], '/privacy': ['privacy.html', 'text/html'], '/terms': ['terms.html', 'text/html'] }
  server = https.createServer(tls, async (req, res) => {
    try {
      const url = new URL(req.url, origin)
      if (url.pathname === '/live-config.json') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ url: liveOrigin, accountRequired: true })) }
      if (url.pathname === '/live-client.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(bundle) }
      if (url.pathname === '/test/fault' && req.method === 'POST') {
        const state = faults.get(url.searchParams.get('target')), mode = url.searchParams.get('mode')
        if (!state || !['down', 'up'].includes(mode)) { res.writeHead(400); return res.end() }
        state.down = mode === 'down'; if (state.down) for (const socket of state.sockets) socket.destroy()
        res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ down: state.down }))
      }
      if (url.pathname === '/test/mail') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(mails.filter(m => m.to === url.searchParams.get('email')))) }
      if (url.pathname === '/test/storage') { const users = await pool.query('SELECT count(*)::int AS n FROM "user"'), records = await pool.query('SELECT count(*)::int AS n FROM botters_records'); res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ backend: 'postgres', users: users.rows[0].n, records: records.rows[0].n })) }
      const asset = assets[url.pathname] || (/^\/r\/[A-Z2-9]{6}$/.test(url.pathname) ? assets['/'] : null)
      if (asset) { res.setHeader('Content-Type', asset[1]); return res.end(await readFile(new URL(`../${asset[0]}`, import.meta.url))) }
      const upstream = http.request({ host: '127.0.0.1', port: 8791, path: req.url, method: req.method, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res) })
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() }); req.pipe(upstream)
    } catch { if (!res.headersSent) res.writeHead(500); res.end() }
  }).listen(8789, '127.0.0.1')
  await once(server, 'listening')
  console.log('Synthetic browser fixture ready; control and live are separate PostgreSQL processes')
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await stop(); process.exit(0) })
} catch (error) { await stop(); throw error }
