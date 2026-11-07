// Isolated PostgreSQL CAS pilot. Not yet wired to the production server.
import { boardNamespace, ratingKey, rankPairs } from './ratings.js'
import { checkDeadline } from './store.js'

export class PostgresStore {
  constructor(pool, namespace) {
    if (!pool || typeof namespace !== 'string' || !namespace) throw new Error('PostgreSQL pool and namespace required')
    this.pool = pool
    this.namespace = namespace
  }
  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS botters_records (
      namespace text NOT NULL, key text NOT NULL, value text NOT NULL,
      expires_at timestamptz, PRIMARY KEY (namespace, key))`)
  }
  async expire(limit = 128) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 128) throw new Error('Invalid expiry batch size')
    const result = await this.pool.query(`DELETE FROM botters_records WHERE ctid IN (
      SELECT ctid FROM botters_records WHERE namespace = $1 AND expires_at IS NOT NULL
        AND expires_at <= clock_timestamp() ORDER BY expires_at LIMIT $2 FOR UPDATE SKIP LOCKED
    )`, [this.namespace, limit])
    return result.rowCount
  }
  async exchange(ticketHash, cookieHash) {
    if (!/^[a-f0-9]{64}$/.test(ticketHash) || !/^[a-f0-9]{64}$/.test(cookieHash)) throw new Error('Invalid live ticket')
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query("SET LOCAL statement_timeout = '8s'")
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', ['botters-record-store', this.namespace])
      const row = async key => (await client.query('SELECT value, expires_at FROM botters_records WHERE namespace = $1 AND key = $2 AND expires_at > clock_timestamp()', [this.namespace, key])).rows[0]
      const ticketKey = `live-ticket:${ticketHash}`, ticket = await row(ticketKey)
      if (!ticket) throw new Error('Expired live ticket')
      const { tokenKey } = JSON.parse(ticket.value)
      if (!/^token:[a-f0-9]{64}$/.test(tokenKey || '')) throw new Error('Invalid live ticket')
      const token = await row(tokenKey), auth = token && JSON.parse(token.value)
      if (!auth || auth.role !== 'human' || !auth.accountId || !auth.authSessionId || auth.liveCookieHash) throw new Error('Expired live ticket')
      const owner = await row(`session:${auth.id}`), session = owner && JSON.parse(owner.value)
      if (!session || session.accountId !== auth.accountId) throw new Error('Expired live session')
      const verified = await client.query('SELECT s."expiresAt" FROM session s JOIN "user" u ON u.id = s."userId" WHERE s.id = $1 AND u.id = $2 AND u."emailVerified" = true AND s."expiresAt" > clock_timestamp() FOR UPDATE OF s, u', [auth.authSessionId, auth.accountId])
      // A session-row lock can outlive any record's TTL. Recheck against the
      // database clock after acquiring it, not only before the lock wait.
      const valid = await client.query(`SELECT extract(epoch FROM clock_timestamp()) * 1000 AS now
        WHERE EXISTS (SELECT 1 FROM botters_records WHERE namespace = $1 AND key = $2 AND expires_at > clock_timestamp())
          AND EXISTS (SELECT 1 FROM botters_records WHERE namespace = $1 AND key = $3 AND expires_at > clock_timestamp())
          AND EXISTS (SELECT 1 FROM botters_records WHERE namespace = $1 AND key = $4 AND expires_at > clock_timestamp())
          AND EXISTS (SELECT 1 FROM session s JOIN "user" u ON u.id = s."userId" WHERE s.id = $5 AND u.id = $6 AND u."emailVerified" = true AND s."expiresAt" > clock_timestamp())`,
      [this.namespace, ticketKey, tokenKey, `session:${auth.id}`, auth.authSessionId, auth.accountId])
      const now = Number(valid.rows[0]?.now), expiresAt = Math.min(auth.expires, +new Date(token.expires_at), +new Date(verified.rows[0]?.expiresAt))
      if (!Number.isFinite(now) || !Number.isFinite(expiresAt) || expiresAt <= now) throw new Error('Expired live session')
      await client.query('UPDATE botters_records SET value = $3, expires_at = $4 WHERE namespace = $1 AND key = $2', [this.namespace, tokenKey, JSON.stringify({ ...auth, liveCookieHash: cookieHash }), new Date(expiresAt)])
      await client.query('DELETE FROM botters_records WHERE namespace = $1 AND key = $2', [this.namespace, ticketKey])
      await client.query('COMMIT')
      return { expiresAt }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally { client.release() }
  }
  scoped() { return this }
  async get(key, { deadline = Infinity } = {}) {
    checkDeadline(deadline)
    const value = await this.readKey(this.pool, key)
    checkDeadline(deadline)
    return value
  }
  async read(keys) { return Promise.all(keys.map(key => this.get(key))) }
  async readKey(client, key) {
    const board = boardNamespace(key)
    if (board !== null) {
      const result = await client.query('SELECT key, value FROM botters_records WHERE namespace = $1 AND expires_at IS NULL', [this.namespace])
      const pairs = []
      for (const row of result.rows) {
        const match = ratingKey(row.key)
        if (match && match[1] === board) pairs.push([match[2], JSON.parse(row.value)])
      }
      return JSON.stringify(rankPairs(pairs).slice(0, 12))
    }
    const result = await client.query('SELECT value FROM botters_records WHERE namespace = $1 AND key = $2 AND (expires_at IS NULL OR expires_at > clock_timestamp())', [this.namespace, key])
    return result.rows[0]?.value ?? null
  }
  async commit(entries, { deadline = Infinity } = {}) {
    checkDeadline(deadline)
    if (new Set(entries.map(e => e.key)).size !== entries.length) throw new Error('Duplicate transaction keys')
    for (const e of entries) {
      if (!Number.isFinite(e.ttl) || e.ttl < 0) throw new Error('Invalid TTL')
      if (e.value !== '' && boardNamespace(e.key) !== null) throw new Error('Leaderboard is read-only')
    }
    const client = await this.pool.connect()
    try {
      checkDeadline(deadline)
      await client.query('BEGIN')
      const remaining = Math.max(1, Math.min(8000, Math.floor(deadline - performance.now())))
      await client.query("SELECT set_config('statement_timeout', $1, true)", [String(remaining)])
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', ['botters-record-store', this.namespace])
      for (const e of entries) {
        if (await this.readKey(client, e.key) !== e.raw) { await client.query('ROLLBACK'); return 0 }
      }
      checkDeadline(deadline)
      for (const e of entries) {
        if (e.value === '') continue
        await client.query(`INSERT INTO botters_records (namespace, key, value, expires_at)
          VALUES ($1, $2, $3, CASE WHEN $4::double precision = 0 THEN NULL ELSE clock_timestamp() + $4 * interval '1 second' END)
          ON CONFLICT (namespace, key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`, [this.namespace, e.key, e.value, e.ttl])
      }
      checkDeadline(deadline)
      await client.query('COMMIT')
      return 1
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally { client.release() }
  }
}
