import { createLiveServer } from '../online/live-server.js'
import { LiveDurable } from '../online/live-durable.js'
import { readFile } from 'node:fs/promises'

const backend = process.env.BOTTERS_LIVE_BACKEND || 'convex'
let remote, pool
if (backend === 'postgres') {
  if (!process.env.DATABASE_URL || !process.env.BOTTERS_STORE_NAMESPACE || process.env.BOTTERS_REQUIRE_ACCOUNT !== '1') throw new Error('PostgreSQL live requires DATABASE_URL, BOTTERS_STORE_NAMESPACE and BOTTERS_REQUIRE_ACCOUNT=1')
  const [{ default: pg }, { PostgresStore }, { PostgresLiveDurable }] = await Promise.all([
    import('pg'), import('../online/postgres-store.js'), import('../online/postgres-live-durable.js'),
  ])
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 })
  pool.on('error', () => console.error('PostgreSQL idle connection lost'))
  try {
    await pool.query('SELECT namespace, key, value, expires_at FROM botters_records LIMIT 0')
    await pool.query('SELECT s.id, s."userId", s."expiresAt", u.id, u."emailVerified" FROM session s JOIN "user" u ON u.id = s."userId" LIMIT 0')
  } catch (error) { await pool.end(); throw error }
  remote = new PostgresLiveDurable(new PostgresStore(pool, process.env.BOTTERS_STORE_NAMESPACE))
} else if (backend === 'convex') {
  remote = new LiveDurable()
  if (!remote.store.url || !remote.store.token) throw new Error('Configure the existing Convex deployment before starting')
} else throw new Error('Unsupported live backend')

try {
  const origins = process.env.PLAYER_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean)
  const build = JSON.parse(await readFile(new URL('../build-id.json', import.meta.url), 'utf8'))
  const service = await createLiveServer({ remote, authority: remote.authority.bind(remote), origins, origin: 'https://botters.havesomecode.io', requireAccount: process.env.BOTTERS_REQUIRE_ACCOUNT === '1', buildId: build.commit })
  await service.listen(Number(process.env.PORT || 2567), process.env.HOST || '0.0.0.0')
  console.log(JSON.stringify({ service: 'botters-live', build: build.commit, backend, transport: 'colyseus' }))
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await service.close(); await pool?.end(); process.exit(0) })
} catch (error) { await pool?.end(); throw error }
