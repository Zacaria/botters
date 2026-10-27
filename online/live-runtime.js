import { createHash, randomBytes } from 'node:crypto'
import { OnlineGame } from './game.js'
const hash = s => createHash('sha256').update(s).digest('hex')
const unavailable = () => Object.assign(new Error('Online service is unavailable. Retry shortly.'), { status: 503 })

// Measured on the production instance: 36 stationary 80-swarm matches kept >=12 FPS, 40 fell to ~10 (docs/colyseus.md).
export const MAX_ROOMS = 32
export class LiveRuntime {
  constructor(store, options = {}) {
    this.store = store; this.handles = new Map(); this.options = { ...options, handles: this.handles }; this.tail = Promise.resolve(); this.rooms = new Map(); this.authorities = new Map(); this.pending = new Map(); this.generations = new Map()
    this.now = options.now || Date.now
    this.sweeper = setInterval(() => this.sweep(), 30000); this.sweeper.unref()
  }
  serialize(work) { const result = this.tail.then(work); this.tail = result.catch(() => {}); return result }
  clearHandles() { for (const state of this.handles.values()) state.free(); this.handles.clear() }
  ready(bearer) {
    if (!/^[\w-]{32}$/.test(bearer || '')) return false
    const key = `token:${hash(bearer)}`
    if (!this.store.raw(key)) return false
    if (!this.options.authority) return true
    const e = this.authorities.get(key)
    return !!e && !e.error && e.connected() && Date.now() < e.expiresAt && Date.now() - e.checkedAt < 90000
  }
  canFrame(bearer, matchId, side, proof) {
    if (!this.ready(bearer)) return false
    try { const { auth, session } = this.check(bearer, proof); return auth.role === 'human' && session.match === matchId && session.side === side } catch { return false }
  }
  async authorize(bearer, proof) {
    if (!/^[\w-]{32}$/.test(bearer || '')) throw Object.assign(new Error('Unknown session. Open a new lobby.'), { status: 401 })
    const key = `token:${hash(bearer)}`
    if (this.options.authority) {
      if (!this.authorities.has(key)) {
        if (this.authorities.size + this.pending.size >= 256) throw unavailable()
        if (!this.pending.has(key)) {
          const generation = Symbol(); this.generations.set(key, generation)
          this.pending.set(key, this.options.authority(key, data => this.adopt(key, data, generation)).then(async entry => {
            if (this.generations.get(key) !== generation) { await entry.close(); throw unavailable() }
            this.authorities.set(key, entry); return entry
          }).catch(e => { if (this.generations.get(key) === generation) this.generations.delete(key); throw e }).finally(() => this.pending.delete(key)))
        }
        await this.pending.get(key)
      }
      const entry = this.authorities.get(key)
      if (!entry) throw unavailable()
      if (entry.error) {
        if (this.authorities.get(key) === entry) { this.authorities.delete(key); this.generations.delete(key) }
        await entry.close(); throw unavailable() // Next retry acquires fresh authority, never a permanently poisoned cache.
      }
      if (!entry.connected()) throw unavailable()
      entry.usedAt = Date.now()
      if (Date.now() - entry.checkedAt >= 90000) await entry.refresh()
      if (!entry.connected() || entry.error) throw unavailable()
    }
    try { return this.check(bearer, proof) }
    catch (e) {
      if (e.status === 401 && e.code !== 'cookie') { const entry = this.authorities.get(key); this.authorities.delete(key); this.generations.delete(key); await entry?.close() }
      throw e
    }
  }
  check(bearer, proof) {
    const key = `token:${hash(bearer || '')}`
    const auth = JSON.parse(this.store.raw(key) || 'null'), session = auth && JSON.parse(this.store.raw(`session:${auth.id}`) || 'null')
    if (session?.accountId && !this.options.requireAccount) throw Object.assign(new Error('Account online play is not active.'), { status: 401 })
    if (!session || auth.expires !== undefined && auth.expires <= this.now() || auth.role === 'agent' && auth.version !== undefined && auth.version !== session.agentVersion || this.options.requireAccount && (!session.accountId || !auth.expires || auth.role === 'human' && auth.accountId !== session.accountId)) {
      throw Object.assign(new Error('Access expired or revoked. Open a new lobby.'), { status: 401 })
    }
    if (session.accountId && auth.role === 'human' && (!proof || auth.liveCookieHash !== proof || !auth.authSessionId)) throw Object.assign(new Error('Sign in again to connect to live play.'), { status: 401, code: 'cookie' })
    const entry = this.authorities.get(key)
    if (entry && Date.now() >= entry.expiresAt) throw Object.assign(new Error('Access expired. Open a new lobby.'), { status: 401 })
    return { auth, session }
  }
  adopt(key, { token, session, expiresAt }, generation) {
    return this.serialize(() => {
      if (generation && this.generations.get(key) !== generation) return
      // Never retain a capability whose durable owner disappeared.
      this.store.put(key, token && session ? token : null, Math.max(1, (expiresAt - Date.now()) / 1000))
      if (!session) return
      const remote = JSON.parse(session), local = JSON.parse(this.store.raw(`session:${remote.id}`) || 'null')
      const own = local ? { match: local.match, side: local.side, room: local.room, roomPrefs: local.roomPrefs, queued: local.queued, history: local.history, name: local.name, doctrine: local.doctrine } : { match: null, room: null, queued: null }
      if (local && local.agentVersion === remote.agentVersion) own.agentSeen = local.agentSeen
      // Game state is shared by independent leases; only the token uses expiresAt.
      this.store.put(`session:${remote.id}`, JSON.stringify({ ...remote, ...own }))
    })
  }
  async request(method, path, q = new URLSearchParams(), body = {}, proof) {
    if (path.startsWith('/agent/')) throw Object.assign(new Error('Agent approvals belong on the website.'), { status: 404 })
    let identity = null
    const publicPath = path === '/rules' || path === '/session' || !this.options.requireAccount && method === 'GET' && path === '/leaderboard'
    if (!publicPath) {
      const { session } = await this.authorize(q.get('token'), proof)
      identity = session.accountId ? { id: session.accountId, emailVerified: true } : null
    }
    if (this.options.requireAccount && (path === '/session' || path.startsWith('/agent/'))) throw Object.assign(new Error('Use the website to sign in or approve your agent.'), { status: 401 })
    const startId = randomBytes(24).toString('base64url')
    return this.serialize(async () => {
      if (!publicPath && this.options.authority && !this.ready(q.get('token'))) throw unavailable()
      if (!publicPath) this.check(q.get('token'), proof)
      if (['/play', '/rooms/start', '/rooms/rematch'].includes(path) && this.rooms.size >= MAX_ROOMS) throw Object.assign(new Error('All matches are occupied. Retry shortly.'), { status: 503 })
      let result
      try { result = await new OnlineGame(this.store, { ...this.options, identity, startId }).request(method, path, q, body) }
      catch (error) { this.clearHandles(); throw error }
      if (this.createRoom) for (const [key, record] of this.store.data) if (key.startsWith('match:')) {
        const m = JSON.parse(record.value)
        if (!m.cancelled && !m.report && !this.rooms.has(m.id)) this.rooms.set(m.id, await this.createRoom(m.id))
      }
      return result
    })
  }
  frames(id, sides = []) {
    return this.serialize(async () => {
      const key = `match:${id}`, raw = this.store.raw(key)
      if (!raw) return null
      const m = JSON.parse(raw)
      for (const side of sides) if (m.players[side]) m.players[side].seen = this.now()
      this.store.put(key, JSON.stringify(m))
      try { return await new OnlineGame(this.store, this.options).request('INTERNAL', '/tick', undefined, { id }) }
      catch (error) { this.clearHandles(); throw error }
    })
  }
  sweep() {
    for (const [key, entry] of this.authorities) if (Date.now() - (entry.usedAt || entry.checkedAt) > 120000 || Date.now() >= entry.expiresAt) { this.authorities.delete(key); this.generations.delete(key); void entry.close() }
    void this.serialize(() => {
      for (const [key, record] of this.store.data) {
        if (record.expires && record.expires <= this.now()) { if (key.startsWith('match:')) { const id = key.slice(6); this.handles.get(id)?.free(); this.handles.delete(id) }; this.store.data.delete(key); continue }
        if (!key.startsWith('match:')) continue
        const m = JSON.parse(record.value)
        if (!m.cancelled && (!m.report || this.now() - m.finishedAt < 900000)) continue
        this.handles.get(m.id)?.free(); this.handles.delete(m.id)
        this.store.data.delete(key)
        this.store.data.delete(`state:${m.id}`)
        for (const log of [...this.store.data.keys()]) if (log.startsWith(`log:${m.id}:`)) this.store.data.delete(log)
        for (const p of m.players) {
          const sessionKey = `session:${p.session}`, raw = this.store.raw(sessionKey), s = raw && JSON.parse(raw)
          if (s?.match === m.id) { s.match = null; this.store.put(sessionKey, JSON.stringify(s)) }
        }
      }
    })
  }
  async close() { clearInterval(this.sweeper); this.generations.clear(); await Promise.all([...this.authorities.values()].map(entry => entry.close())); this.authorities.clear(); this.clearHandles() }
}
