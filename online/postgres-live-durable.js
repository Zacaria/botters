// PostgreSQL snapshots are polled; a slow or failed database cannot extend a lease.
export class PostgresLiveDurable {
  constructor(store, { intervalMs = 500, leaseMs = 2000 } = {}) {
    if (!store || intervalMs <= 0 || leaseMs <= intervalMs) throw new Error('Invalid authority configuration')
    this.store = store; this.intervalMs = intervalMs; this.leaseMs = leaseMs
  }
  get(key) { return this.store.get(key) }
  read(keys) { return this.store.read(keys) }
  commit(entries) { return this.store.commit(entries) }
  exchange(ticketHash, cookieHash) { return this.store.exchange(ticketHash, cookieHash) }
  async authority(key, adopt) {
    let closed = false, timer
    const entry = {
      checkedAt: 0, expiresAt: 0, error: null,
      connected: () => !closed && !entry.error && Date.now() < entry.expiresAt,
      close: async () => { closed = true; clearInterval(timer) },
    }
    entry.refresh = () => entry.refreshing ||= (async () => {
      const started = Date.now()
      try {
        const data = await this.store.authorize(key)
        if (closed) return
        const expiresAt = Math.min(data.expiresAt, started + this.leaseMs)
        if (!Number.isFinite(expiresAt) || data.token && Date.now() >= expiresAt) throw new Error('Authority snapshot expired')
        await adopt({ ...data, expiresAt })
        if (closed) return
        entry.invalid = !data.token || !data.session
        entry.checkedAt = started; entry.expiresAt = expiresAt
      } catch (error) { if (!closed) entry.error = error; throw error }
    })().finally(() => { entry.refreshing = null })
    try {
      await entry.refresh()
      timer = setInterval(() => { void entry.refresh().catch(() => {}) }, this.intervalMs)
      timer.unref()
      return entry
    } catch (error) { await entry.close(); throw error }
  }
}
