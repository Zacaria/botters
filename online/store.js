// Durable account/boundary CAS and single-process live memory transactions.
import { boardNamespace, ratingKey, rankPairs } from './ratings.js'
export function checkDeadline(deadline = Infinity) {
  if (performance.now() >= deadline) throw Object.assign(new Error('Request timed out. Retry shortly.'), { status: 503, code: 'DEADLINE' })
}

export class ConvexStore {
  constructor(env = process.env) {
    this.url = env.CONVEX_URL
    this.token = env.CONVEX_DEPLOY_KEY
    // Preview must never affect production, including preview Elo.
    this.prefix = `botters:${env.BOTTERS_NAMESPACE || (env.VERCEL_ENV === 'production' ? 'production' : 'preview')}:`
  }
  async call(kind, path, args, { deadline = Infinity } = {}) {
    checkDeadline(deadline)
    if (!this.url || !this.token) throw Object.assign(new Error('Online storage is not configured.'), { status: 503 })
    try {

      const res = await fetch(`${this.url}/api/${kind}`, { method: 'POST', headers: { Authorization: `Convex ${this.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ path, args, format: 'json' }), signal: AbortSignal.timeout(Math.max(1, Math.min(8000, Math.floor(deadline - performance.now())))) })
      if (!res.ok) throw new Error('Unavailable')
      const body = await res.json()
      if (body.status !== 'success') throw new Error('Unavailable')
      checkDeadline(deadline)
      return body.value
    } catch {
      checkDeadline(deadline)
      throw Object.assign(new Error('Online storage is unavailable. Retry shortly.'), { status: 503 })
    }
  }
  // Invocation-local account cache; every transaction still passes CAS.
  scoped() { const store = Object.create(this); store.cache = new Map(); return store }
  // One database snapshot, not invocation-cache entries from separate queries.
  async readToken(key, extraKeys = [], options = {}) {
    const { keys, values } = await this.call('query', 'store:get', { keys: [key, ...extraKeys].map(k => this.prefix + k), now: Date.now(), followToken: true }, options)
    return new Map(keys.map((k, i) => [k.slice(this.prefix.length), values[i]]))
  }
  async get(key, options = {}) {
    if (!options.fresh && this.cache?.has(key)) return this.cache.get(key)
    const [value] = await this.call('query', 'store:get', { keys: [this.prefix + key], now: Date.now() }, options)
    if (!options.fresh) this.cache?.set(key, value)
    return value
  }
  async commit(entries, options) {
    const ok = await this.call('mutation', 'store:commit', { entries: entries.map(e => ({ ...e, key: this.prefix + e.key })) }, options)
    if (this.cache) {
      if (ok) for (const e of entries) this.cache.set(e.key, e.value === '' ? e.raw : e.value)
      else {
        const values = await this.call('query', 'store:get', { keys: entries.map(e => this.prefix + e.key), now: Date.now() }, options)
        entries.forEach((e, i) => this.cache.set(e.key, values[i]))

      }
    }
    return ok
  }
}

// Live rooms retain authoritative process-local state here.
export class MemoryStore {
  constructor(now = Date.now) { this.data = new Map(); this.now = now }
  raw(key) {
    const namespace = boardNamespace(key)
    if (namespace !== null) {
      const pairs = []
      for (const [k, r] of this.data) {
        const rating = ratingKey(k)
        if (rating?.[1] === namespace && (!r.expires || r.expires > this.now())) pairs.push([rating[2], JSON.parse(r.value)])
      }
      return JSON.stringify(rankPairs(pairs).slice(0, 12))
    }
    const r = this.data.get(key)
    return r && (!r.expires || r.expires > this.now()) ? r.value : null
  }
  async get(key) { return this.raw(key) }
  async readToken(key, extraKeys = []) {
    // No await: mirror the database query's consistent read boundary.
    const values = new Map([key, ...extraKeys].map(k => [k, this.raw(k)]))
    const auth = values.get(key) && JSON.parse(values.get(key))
    if (auth) values.set(`session:${auth.id}`, this.raw(`session:${auth.id}`))
    return values
  }
  async commit(entries) {
    // No awaits between the compare and write phases: same atomic boundary as Lua.
    for (const e of entries) {
      const current = this.raw(e.key)
      if (current !== e.raw) return 0
    }
    for (const e of entries) if (e.value !== '') this.data.set(e.key, { value: e.value, expires: e.ttl ? this.now() + e.ttl * 1000 : 0 })
    return 1
  }
}

export async function transaction(store, fn, { deadline = Infinity } = {}) {
  for (let attempt = 0; attempt < 20; attempt++) {
    checkDeadline(deadline)
    const records = new Map()
    const tx = {
      async get(key, fallback = null, ttl = 86400) {
        if (!records.has(key)) {
          const raw = await store.get(key, { deadline })
          checkDeadline(deadline)
          records.set(key, { key, raw, object: raw ? JSON.parse(raw) : structuredClone(fallback), ttl })
        }
        return records.get(key).object
      },
      async set(key, value, ttl = 86400) { await this.get(key, null, ttl); records.get(key).object = value },
      // For append-only logs guarded by the checkpoint's logCount CAS.
      async read(key) { const raw = await store.get(key, { deadline, fresh: true }); checkDeadline(deadline); return raw ? JSON.parse(raw) : null },
    }
    let result, failure
    try { result = await fn(tx) } catch (e) { if (!e.status || e.code === 'DEADLINE') throw e; failure = e }
    checkDeadline(deadline)

    const entries = [...records.values()].map(r => {
      const value = JSON.stringify(r.object)
      return { key: r.key, raw: r.raw, value: value === r.raw || (!r.raw && r.object === null) ? '' : value, ttl: r.ttl }
    })
    if (await store.commit(entries, { deadline })) { if (failure) throw failure; return result }
    await new Promise(r => setTimeout(r, Math.min(30, attempt * 2)))
  }
  throw Object.assign(new Error('Match is busy. Retry shortly.'), { status: 503 })
}
