// Durable account/boundary CAS and single-process live memory transactions.
import { boardNamespace, ratingKey, rankPairs } from './ratings.js'
export function checkDeadline(deadline = Infinity) {
  if (performance.now() >= deadline) throw Object.assign(new Error('Request timed out. Retry shortly.'), { status: 503, code: 'DEADLINE' })
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
    const beforeCommit = []
    const onRetry = []
    const afterCommit = []
    const tx = {
      async get(key, fallback = null, ttl = 86400) {
        if (!records.has(key)) {
          const raw = await store.get(key, { deadline })
          checkDeadline(deadline)
          records.set(key, { key, raw, object: raw ? JSON.parse(raw) : structuredClone(fallback), ttl })
        }
        return records.get(key).object
      },
      async set(key, value, ttl = 86400) { await this.get(key, null, ttl); records.get(key).object = value; records.get(key).ttl = ttl },
      // For append-only logs guarded by the checkpoint's logCount CAS.
      async read(key) { const raw = await store.get(key, { deadline, fresh: true }); checkDeadline(deadline); return raw ? JSON.parse(raw) : null },
      beforeCommit(fn) { beforeCommit.push(fn) },
      onRetry(fn) { onRetry.push(fn) },
      afterCommit(fn) { afterCommit.push(fn) },
    }
    let result, failure
    try { result = await fn(tx) } catch (e) { if (!e.status || e.code === 'DEADLINE') throw e; failure = e }
    checkDeadline(deadline)
    for (const fn of beforeCommit) await fn()

    const entries = [...records.values()].map(r => {
      const value = JSON.stringify(r.object)
      return { key: r.key, raw: r.raw, value: value === r.raw || (!r.raw && r.object === null) ? '' : value, ttl: r.ttl }
    })
    if (await store.commit(entries, { deadline })) { for (const fn of afterCommit) fn(); if (failure) throw failure; return result }
    for (const fn of onRetry) fn()
    await new Promise(r => setTimeout(r, Math.min(30, attempt * 2)))
  }
  throw Object.assign(new Error('Match is busy. Retry shortly.'), { status: 503 })
}
