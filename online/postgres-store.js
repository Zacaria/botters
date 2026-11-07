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
