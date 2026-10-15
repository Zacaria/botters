// Atomic optimistic transactions. No application state is retained in a Vercel instance.
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
  // Include time in the query arguments so a cached query cannot outlive its TTL.
  get(key, options) { return this.call('query', 'store:get', { key: this.prefix + key, now: Date.now() }, options) }
  commit(entries, options) {
    return this.call('mutation', 'store:commit', { entries: entries.map(e => ({ ...e, key: this.prefix + e.key })) }, options)
  }
}

// Test/development adapter only. Production always constructs ConvexStore.
export class MemoryStore {
  constructor(now = Date.now) { this.data = new Map(); this.now = now }
  async get(key) {
    const r = this.data.get(key)
    return r && (!r.expires || r.expires > this.now()) ? r.value : null
  }
  async commit(entries) {
    // No awaits between the compare and write phases: same atomic boundary as Lua.
    for (const e of entries) {
      const r = this.data.get(e.key), current = r && (!r.expires || r.expires > this.now()) ? r.value : null
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
      async read(key) { const raw = await store.get(key, { deadline }); checkDeadline(deadline); return raw ? JSON.parse(raw) : null },
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
