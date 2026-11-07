// Isolated two-origin browser fixture. Never imported by production.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

import { build } from 'esbuild'
import { betterAuth } from 'better-auth/minimal'
import { memoryAdapter } from 'better-auth/adapters/memory'
import pg from 'pg'
import { authOptions } from '../online/auth-options.js'
import { createPostgresAuth } from '../online/postgres-auth.js'
import { PostgresStore } from '../online/postgres-store.js'
import { MemoryStore, transaction } from '../online/store.js'
import { createHandler } from '../online/http.js'
import { createLiveServer } from '../online/live-server.js'
const port = Number(process.env.PORT || 8789), origin = `http://127.0.0.1:${port}`, liveOrigin = `http://127.0.0.1:${port + 1}`
const database = { user: [], account: [], session: [], verification: [], rateLimit: [] }, mail = []
const env = { SITE_URL: origin, BETTER_AUTH_SECRET: 'isolated-browser-only-secret-123456789012345' }
const sendEmail = async message => mail.push(message)
let auth, pool, admin, schema, store
if (process.env.BOTTERS_TEST_POSTGRES_URL) {
  const url = new URL(process.env.BOTTERS_TEST_POSTGRES_URL)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.search) throw new Error('Test database must be loopback PostgreSQL without URL parameters')
  schema = `botters_browser_${randomUUID().replaceAll('-', '')}`
  admin = new pg.Pool({ connectionString: url.toString() })
  await admin.query(`CREATE SCHEMA "${schema}"`)
  pool = new pg.Pool({ connectionString: url.toString(), options: `-c search_path=${schema}` })
  const service = await createPostgresAuth({ pool, env, sendEmail })
  await service.migrate(); auth = service.auth
  store = new PostgresStore(pool, 'browser'); await store.init()
} else {
  auth = betterAuth({ ...authOptions(env, sendEmail), database: memoryAdapter(database) })
  store = new MemoryStore()
}
const start = Date.now(), now = () => start + (Date.now() - start) * 10
const watchers = new Set()
const commit = store.commit.bind(store)
const notify = () => { for (const update of watchers) setImmediate(() => void update()) }
store.commit = async (entries, options) => { const ok = await commit(entries, options); if (ok) notify(); return ok }

const authExpiry = async grant => {
  if (pool) {
    const result = await pool.query('SELECT s."expiresAt" FROM session s JOIN "user" u ON u.id = s."userId" WHERE s.id = $1 AND u.id = $2 AND u."emailVerified" = true AND s."expiresAt" > now()', [grant.authSessionId, grant.accountId])
    return result.rows[0] ? +new Date(result.rows[0].expiresAt) : 0
  }
  const session = database.session.find(s => s.id === grant.authSessionId && s.userId === grant.accountId)
  const user = database.user.find(u => u.id === grant.accountId)
  return user?.emailVerified && session && +new Date(session.expiresAt) > Date.now() ? +new Date(session.expiresAt) : 0
}
const authority = async (key, adopt) => {
  const entry = { connected: () => true, checkedAt: Date.now(), expiresAt: 0, close: async () => watchers.delete(update) }
  const update = async () => {
    let token = await store.get(key), grant = token && JSON.parse(token), session = grant && await store.get('session:' + grant.id)
    let expiresAt = grant?.expires || Date.now()
    if (grant?.role === 'human') { expiresAt = Math.min(expiresAt, await authExpiry(grant)); if (!grant.liveCookieHash || expiresAt <= Date.now()) { token = null; session = null } }
    await adopt({ token, session, expiresAt }); entry.checkedAt = Date.now(); entry.expiresAt = expiresAt
  }
  entry.refresh = update; await update(); watchers.add(update); return entry
}
const remote = {
  get: key => store.get(key), read: keys => Promise.all(keys.map(key => store.get(key))), commit: entries => store.commit(entries),
  exchange: (ticketHash, cookieHash) => transaction(store, async tx => {
    const ticket = await tx.get('live-ticket:' + ticketHash, null, 60)
    if (!ticket?.tokenKey || ticket.used) throw new Error('Expired ticket')
    const grant = await tx.get(ticket.tokenKey, null, 604800), expiresAt = grant && Math.min(grant.expires, await authExpiry(grant))
    if (!grant || grant.liveCookieHash || expiresAt <= Date.now()) throw new Error('Expired session')
    grant.liveCookieHash = cookieHash; ticket.used = true
    return { expiresAt }
  }),
}
const live = await createLiveServer({ remote, authority, origin, origins: [origin], now, requireAccount: true, loopbackTest: true })
await live.listen(port + 1)
const game = createHandler(store, { origin, now, requireAccount: true, liveExchange: true, controlOnly: true, env: { BOTTERS_AUTH_ORIGIN: origin }, resolveAccount: async req => {
  const session = await auth.api.getSession({ headers: new Headers(req.headers), query: { disableCookieCache: true, disableRefresh: true } })
  return session?.user?.emailVerified ? { id: session.user.id, name: session.user.name, emailVerified: true, authSessionId: session.session.id, authExpires: +new Date(session.session.expiresAt) } : null
} })
const bundle = (await build({ entryPoints: ['browser-live.js'], bundle: true, format: 'esm', write: false })).outputFiles[0].text
const assets = { '/': ['index.html', 'text/html'], '/sim.js': ['sim.js', 'text/javascript'], '/sim/pkg/botters_sim.js': ['sim/pkg/botters_sim.js', 'text/javascript'], '/sim/pkg/botters_sim_bg.wasm': ['sim/pkg/botters_sim_bg.wasm', 'application/wasm'], '/guide': ['guide.html', 'text/html'], '/privacy': ['privacy.html', 'text/html'], '/terms': ['terms.html', 'text/html'] }
const website = http.createServer(async (req, res) => {
  const url = new URL(req.url, origin)
  if (url.pathname === '/live-config.json') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ url: liveOrigin, accountRequired: true })) }
  if (url.pathname === '/live-client.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(bundle) }
  if (url.pathname === '/test/mail') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(mail.filter(m => m.to === url.searchParams.get('email')).map(m => ({ text: m.text, subject: m.subject })))) }
  if (url.pathname === '/test/storage' && pool) {
    const users = await pool.query('SELECT count(*)::int AS n FROM "user"'), records = await pool.query('SELECT count(*)::int AS n FROM botters_records')
    res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ backend: 'postgres', users: users.rows[0].n, records: records.rows[0].n }))
  }
  const asset = assets[url.pathname] || (/^\/r\/[A-Z2-9]{6}$/.test(url.pathname) ? assets['/'] : null)
  if (asset) { res.setHeader('Content-Type', asset[1]); return res.end(await readFile(new URL(`../${asset[0]}`, import.meta.url))) }
  if (url.pathname.startsWith('/api/auth/')) {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const response = await auth.handler(new Request(url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined }))
    for (const [name, value] of response.headers) if (name !== 'set-cookie') res.setHeader(name, value)
    res.setHeader('Set-Cookie', response.headers.getSetCookie()); res.writeHead(response.status); res.end(await response.text()); notify(); return
  }
  return game(req, res)
}).listen(port, '127.0.0.1', () => console.log(`Isolated auth + Colyseus fixture: ${origin} / ${liveOrigin}; captured mail only, simulation clock ×10`))
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { website.close(); await live.close(); if (pool) { await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end() } process.exit(0) })
