// One process owns live state. Only capability and start/result boundaries persist.
import { MemoryStore } from './store.js'
import { ratingKey, boardNamespace } from './ratings.js'
export class LiveStore extends MemoryStore {
  constructor(remote = null, { now = Date.now } = {}) { super(now); this.remote = remote; this.boundaryCalls = 0 }
  raw(key) {
    const row = this.data.get(key)
    if (row?.expires && row.expires <= this.now()) this.data.delete(key)
    if (boardNamespace(key) !== null && this.data.has(key)) return this.data.get(key).value
    return super.raw(key)
  }
  put(key, raw, ttl = 86400) { if (raw === null) this.data.delete(key); else this.data.set(key, { value: raw, expires: ttl ? this.now() + ttl * 1000 : 0 }) }
  async get(key) {
    this.raw(key) // remove expired records before considering the cache
    if (this.remote && (ratingKey(key) || boardNamespace(key) !== null) && !this.data.has(key)) this.put(key, await this.remote.get(key), boardNamespace(key) !== null ? 30 : 0)
    return this.raw(key)
  }
  async commit(entries) {
    if (entries.some(e => this.raw(e.key) !== e.raw)) return 0
    // Durable account sessions are non-expiring, but process-owned state is not.
    const commitLocal = () => super.commit(entries.map(e => e.key.startsWith('session:') && e.ttl === 0 ? { ...e, ttl: 86400 } : e))
    if (!this.remote) return commitLocal()
    const boundaries = entries.filter(e => e.key.startsWith('match:') && e.value).map(e => {
      const m = JSON.parse(e.value), old = e.raw && JSON.parse(e.raw)
      return { e, m, start: !old, finish: m.report && !old?.report }
    }).filter(b => b.start || b.finish)
    const sessionChanged = e => e.key.startsWith('session:') && (!e.raw || ['name', 'setup', 'doctrine', 'agentVersion', 'agentGranted', 'preparation'].some(k => JSON.stringify(JSON.parse(e.raw)[k]) !== JSON.stringify(JSON.parse(e.value)[k])))
    const selected = new Map(entries.filter(e => e.value && (e.key.startsWith('token:') && !e.raw || sessionChanged(e) || /^(pair|pending|account):/.test(e.key))).map(e => [e.key, e]))
    if (boundaries.length) for (const e of entries) if (e.value && (e.key.startsWith('session:') || ratingKey(e.key))) selected.set(e.key, e)
    if (!boundaries.length && !selected.size) return commitLocal()
    const markers = boundaries.map(b => `${b.finish ? 'result' : 'live'}:${b.m.id}`)
    const keys = [...selected.keys(), ...markers], values = await this.remote.read(keys); this.boundaryCalls++
    const raws = new Map(keys.map((k, i) => [k, values[i]]))
    const finishes = boundaries.filter(b => b.finish), recovered = finishes.filter(b => raws.get(`result:${b.m.id}`))
    if (recovered.length && recovered.length !== finishes.length) throw new Error('Incomplete result boundary')
    if (recovered.length) {
      // The atomic mutation succeeded but its response was lost. Adopt saved
      // reports/history/Elo instead of applying the outcome a second time.
      for (const b of recovered) {
        const saved = JSON.parse(raws.get(`result:${b.m.id}`)); b.m.report = saved.report; b.e.value = JSON.stringify(b.m)
      }
      for (const e of entries) {
        if (ratingKey(e.key)) e.value = raws.get(e.key) || ''
        if (e.key.startsWith('session:') && e.value && raws.get(e.key)) {
          const local = JSON.parse(e.value), saved = JSON.parse(raws.get(e.key))
          local.history = [...(saved.history || []), ...local.history].filter((h, i, a) => a.findIndex(o => o.matchId === h.matchId) === i).slice(0, 10)
          e.value = JSON.stringify(local)
        }
      }
      return commitLocal()
    }
    for (const e of selected.values()) if (ratingKey(e.key) && raws.get(e.key) !== e.raw) { this.put(e.key, raws.get(e.key), 0); return 0 }
    for (const e of selected.values()) if (e.key.startsWith('session:') && e.raw && raws.get(e.key)) {
      const base = JSON.parse(e.raw), local = JSON.parse(e.value), current = JSON.parse(raws.get(e.key))
      const preparedStart = boundaries.some(b => b.start && b.m.players.some(p => p.session === local.id && p.openingBy === 'prepared'))
      if (local.preparation && (preparedStart || JSON.stringify(local.preparation) !== JSON.stringify(base.preparation)) &&
        (current.agentVersion !== local.agentVersion || current.agentGranted === false || current.doctrine !== local.doctrine || JSON.stringify(current.preparation) !== JSON.stringify(base.preparation))) {
        this.put(e.key, JSON.stringify({ ...base, agentVersion: current.agentVersion, agentGranted: current.agentGranted, setup: current.setup, doctrine: current.doctrine, preparation: current.preparation }))
        throw Object.assign(new Error('Preparation changed. Ask your human to prepare again.'), { status: 409 })
      }
    }
    const writes = [...selected.values()].map(e => {
      let value = e.value
      if (e.key.startsWith('session:') && raws.get(e.key)) {
        const current = JSON.parse(raws.get(e.key)), local = JSON.parse(value)
        if (local.preparation && (current.agentVersion !== local.agentVersion || current.agentGranted === false)) throw Object.assign(new Error('Agent approval changed. Prepare again.'), { status: 409 })
        value = JSON.stringify({ ...current, name: local.name, doctrine: local.doctrine, preparation: local.preparation, match: local.match, side: local.side,
          history: [...local.history, ...(current.history || [])].filter((h, i, a) => a.findIndex(o => o.matchId === h.matchId) === i).slice(0, 10) })
      } else if (e.key.startsWith('session:') && e.raw && JSON.parse(e.raw).accountId) throw Object.assign(new Error('Account session is no longer valid.'), { status: 401 })
      return { ...e, raw: raws.get(e.key), value }
    })
    boundaries.forEach((b, i) => writes.push({ key: markers[i], raw: raws.get(markers[i]), value: JSON.stringify({ id: b.m.id, startsAt: b.m.startsAt, finishedAt: b.m.finishedAt || null,
      players: b.m.players.map(({ session, side, name, setup, accountId }) => ({ session, side, name, setup, accountId })), report: b.m.report || null, options: b.m.s.opts }), ttl: 86400 }))
    this.boundaryCalls++
    if (!await this.remote.commit(writes)) return 0
    // All callers and subscription adoption serialize around this local commit.
    const ok = await commitLocal()
    if (ok && finishes.length) for (const key of [...this.data.keys()]) if (boardNamespace(key) !== null) this.data.delete(key)
    return ok
  }
}
