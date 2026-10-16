import { ConvexClient } from 'convex/browser'
import { ConvexStore } from './store.js'

// Administrative credentials never reach either client. Subscription scope is
// capability + account session only; match inputs/frames never invalidate it.
export class LiveDurable {
  constructor(env = process.env) { this.store = new ConvexStore(env); this.calls = { query: 0, mutation: 0, subscription: 0, updates: 0 }; this.env = env }
  get(key) { this.calls.query++; return this.store.get(key) }
  read(keys) { this.calls.query++; return this.store.call('query', 'store:get', { keys: keys.map(k => this.store.prefix + k), now: Date.now() }) }
  commit(entries) { this.calls.mutation++; return this.store.commit(entries) }
  async authority(key, adopt) {
    const client = new ConvexClient(this.store.url, { unsavedChangesWarning: false, logger: false })
    client.setAdminAuth(this.store.token)
    const entry = { checkedAt: 0, expiresAt: 0, error: null, connected: () => client.connectionState().isWebSocketConnected, close: () => client.close() }
    const accept = async data => { await adopt(data); entry.checkedAt = Date.now(); entry.expiresAt = data.expiresAt }
    entry.refresh = () => entry.refreshing ||= (async () => {
      this.calls.query++
      try { await accept(await this.store.call('query', 'store:authorize', { key: this.store.prefix + key })) }
      catch (e) { entry.error = e; throw e }
    })().finally(() => { entry.refreshing = null })
    this.calls.subscription++
    let timer
    try {
      await Promise.race([new Promise((resolve, reject) => {
        client.onUpdate('store:authorize', { key: this.store.prefix + key }, data => { this.calls.updates++; void accept(data).then(resolve, reject) }, e => { entry.error = e; reject(e) })
      }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Authorization unavailable')), 8000) })])
      return entry
    } catch (e) { await client.close(); throw e } finally { clearTimeout(timer) }
  }
}
