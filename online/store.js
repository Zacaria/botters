// Atomic optimistic transactions. No application state is retained in a Vercel instance.
const LUA = `
for i, key in ipairs(KEYS) do
  local expected = ARGV[(i-1)*3+1]
  local actual = redis.call('GET', key)
  if (actual or '') ~= expected then return 0 end
end
for i, key in ipairs(KEYS) do
  local value = ARGV[(i-1)*3+2]
  local ttl = tonumber(ARGV[(i-1)*3+3])
  if value ~= '' then
    if ttl > 0 then redis.call('SET', key, value, 'EX', ttl)
    else redis.call('SET', key, value) end
  end
end
return 1`

export function checkDeadline(deadline = Infinity) {
  if (performance.now() >= deadline) throw Object.assign(new Error('Request timed out. Retry shortly.'), { status: 503, code: 'DEADLINE' })
}

export class RedisStore {
  constructor(env = process.env) {
    this.url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL
    this.token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN
    // Preview must never affect production, including preview Elo.
    this.prefix = `botters:${env.BOTTERS_NAMESPACE || (env.VERCEL_ENV === 'production' ? 'production' : 'preview')}:`
  }
  async command(command, { deadline = Infinity } = {}) {
    checkDeadline(deadline)
    if (!this.url || !this.token) throw Object.assign(new Error('Online storage is not configured.'), { status: 503 })
    const res = await fetch(this.url, { method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(Math.max(1, Math.min(8000, Math.floor(deadline - performance.now())))) })
    if (!res.ok) throw Object.assign(new Error('Online storage is unavailable. Retry shortly.'), { status: 503 })
    const body = await res.json()
    if (body.error) throw Object.assign(new Error('Online storage is unavailable. Retry shortly.'), { status: 503 })
    return body.result
  }
  get(key, options) { return this.command(['GET', this.prefix + key], options) }
  commit(entries, options) {
    return this.command(['EVAL', LUA, entries.length, ...entries.map(e => this.prefix + e.key), ...entries.flatMap(e => [e.raw || '', e.value, String(e.ttl)])], options)
  }
}

// Test/development adapter only. Production always constructs RedisStore.
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
