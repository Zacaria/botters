// Isolated harness, not the production HTTP entry point. No external mail or network.
import http from 'node:http'
import pg from 'pg'
import { createPostgresAuth } from '../../../online/postgres-auth.js'
import { PostgresStore } from '../../../online/postgres-store.js'
import { PostgresLiveDurable } from '../../../online/postgres-live-durable.js'
import { createHandler } from '../../../online/http.js'
import { createLiveServer } from '../../../online/live-server.js'

const { JOURNEY_DATABASE: database, JOURNEY_SCHEMA: schema, JOURNEY_MODE: mode, JOURNEY_SITE: origin } = process.env
if (!/^botters_journey_[a-f0-9]+$/.test(schema)) throw new Error('invalid isolated schema')
const target = new URL(database)
if (!['postgres:', 'postgresql:'].includes(target.protocol) || target.hostname !== '127.0.0.1' || target.search) throw new Error('loopback database required')
const pool = new pg.Pool({ connectionString: database, options: `-c search_path=${schema}`, connectionTimeoutMillis: 1000 })
pool.on('error', () => console.error('PostgreSQL idle connection lost'))
const store = new PostgresStore(pool, 'journey')
let close
if (mode === 'control') {
  const { auth } = await createPostgresAuth({ pool, env: { SITE_URL: origin, BETTER_AUTH_SECRET: 'isolated-journey-test-secret-123456789012345' }, sendEmail: async message => process.send({ type: 'mail', text: message.text, to: message.to }) })
  const handler = createHandler(store, { origin, origins: [origin], requireAccount: true, liveExchange: true, controlOnly: true, env: { BOTTERS_AUTH_ORIGIN: origin }, resolveAccount: async req => {
    const s = await auth.api.getSession({ headers: new Headers(req.headers), query: { disableCookieCache: true, disableRefresh: true } })
    return s?.user?.emailVerified ? { id: s.user.id, name: s.user.name, emailVerified: true, authSessionId: s.session.id, authExpires: +new Date(s.session.expiresAt) } : null
  } })
  const server = http.createServer(async (req, res) => {
    if (!req.url.startsWith('/api/auth/')) return handler(req, res)
    try {
      const chunks = []; for await (const c of req) chunks.push(c)
      const r = await auth.handler(new Request(new URL(req.url, origin), { method: req.method, headers: req.headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined }))
      for (const [name, value] of r.headers) if (name !== 'set-cookie') res.setHeader(name, value)
      res.setHeader('Set-Cookie', r.headers.getSetCookie()); res.writeHead(r.status); res.end(await r.text())
    } catch { res.writeHead(503); res.end() }
  })
  await new Promise(resolve => server.listen(Number(new URL(origin).port), '127.0.0.1', resolve))
  close = () => new Promise(resolve => server.close(resolve))
} else if (mode === 'live') {
  const remote = new PostgresLiveDurable(store)
  const service = await createLiveServer({ remote, authority: remote.authority.bind(remote), origin, origins: [origin], requireAccount: true, loopbackTest: true })
  await service.listen(Number(process.env.JOURNEY_LIVE_PORT))
  close = () => service.close()
} else throw new Error('invalid mode')
process.send({ type: 'ready', mode })
process.once('SIGTERM', async () => { await close(); await pool.end(); process.exit(0) })
