// D1 batch is the atomic boundary, including read-only comparisons.
import { boardNamespace, ratingKey, rankPairs } from '../online/ratings.js'
export class D1Store {
  constructor(db) { this.db = db.withSession ? db.withSession('first-primary') : db; this.reads = 0; this.writes = 0 }
  async get(key) {
    this.reads++
    const namespace = boardNamespace(key)
    if (namespace !== null) {
      const { results } = await this.db.prepare("SELECT key, value FROM game_records WHERE key LIKE ? AND (expires=0 OR expires>?)").bind(`${namespace}elo:%`, Date.now()).all()
      return JSON.stringify(rankPairs(results.filter(r => ratingKey(r.key)?.[1] === namespace).map(r => [ratingKey(r.key)[2], JSON.parse(r.value)])).slice(0, 12))
    }
    return (await this.db.prepare('SELECT value FROM game_records WHERE key=? AND (expires=0 OR expires>?)').bind(key, Date.now()).first())?.value ?? null
  }
  async commit(entries) {
    // Virtual leaderboard reads are not mutable records.
    entries = entries.filter(e => boardNamespace(e.key) === null)
    if (!entries.length) return 1
    const now = Date.now(), id = crypto.randomUUID()
    const guards = entries.map(({ key, raw }) => ({ key, raw }))
    const comparison = `CASE WHEN NOT EXISTS (
      SELECT 1 FROM json_each(?) e LEFT JOIN game_records r ON r.key=json_extract(e.value,'$.key')
      WHERE (CASE WHEN r.expires=0 OR r.expires>? THEN r.value ELSE NULL END) IS NOT json_extract(e.value,'$.raw')
    ) THEN 1 ELSE 0 END`
    if (entries.every(e => e.value === '')) {
      this.reads++
      return await this.db.prepare(`SELECT ${comparison} AS valid`).bind(JSON.stringify(guards), now).first('valid')
    }
    const statements = [this.db.prepare(`INSERT INTO cas_guard(id, valid) SELECT ?, ${comparison}`).bind(id, JSON.stringify(guards), now)]
    const owners = [...new Set(entries.filter(e => e.key.startsWith('session:') && e.value).map(e => JSON.parse(e.value)?.accountId).filter(v => typeof v === 'string'))]
    if (owners.length) statements.push(this.db.prepare(`INSERT INTO cas_guard(id,valid) SELECT ?, CASE WHEN (SELECT count(*) FROM "user" WHERE id IN (SELECT value FROM json_each(?)) AND "emailVerified"=1)=? THEN 1 ELSE 0 END`).bind(id+':owners',JSON.stringify(owners),owners.length))
    for (const e of entries) if (e.value !== '') statements.push(this.db.prepare('INSERT INTO game_records(key,value,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires=excluded.expires').bind(e.key, e.value, e.ttl ? now + e.ttl * 1000 : 0))
    statements.push(this.db.prepare('DELETE FROM cas_guard WHERE id IN (?,?)').bind(id,id+':owners'))
    try { await this.db.batch(statements); this.writes += statements.length; return 1 }
    catch (e) { if (String(e.message).includes('CHECK constraint failed: valid = 1')) return 0; throw e }
  }
}
