import { createHash, randomBytes } from 'node:crypto'
import { OnlineGame } from './game.js'
const hash = s => createHash('sha256').update(s).digest('hex')
const unavailable = () => Object.assign(new Error('Online service is unavailable. Retry shortly.'), { status: 503 })

export class LiveRuntime {
  constructor(store, options = {}) {
    this.store = store; this.options = options; this.tail = Promise.resolve(); this.rooms = new Map(); this.authorities = new Map(); this.pending = new Map()
    this.now = options.now || Date.now
    this.sweeper = setInterval(() => this.sweep(), 30000); this.sweeper.unref()
  }
  serialize(work) { const result = this.tail.then(work); this.tail = result.catch(() => {}); return result }
  async authorize(bearer) {
    if (!/^[\w-]{32}$/.test(bearer || '')) throw Object.assign(new Error('Unknown session. Open a new lobby.'), { status: 401 })
    const key = `token:${hash(bearer)}`
    if (this.options.authority) {
      if (!this.authorities.has(key)) {
        if (this.authorities.size + this.pending.size >= 256) throw unavailable()
        if (!this.pending.has(key)) this.pending.set(key, this.options.authority(key, data => this.adopt(key, data)).then(entry => {
          this.authorities.set(key, entry); return entry
        }).finally(() => this.pending.delete(key)))
        await this.pending.get(key)
      }
      const entry = this.authorities.get(key)
      entry.usedAt = Date.now()
      if (!entry.connected() || entry.error) throw unavailable()
      if (Date.now() - entry.checkedAt >= 90000) await entry.refresh()
      if (!entry.connected() || entry.error) throw unavailable()
    }
    const auth = JSON.parse(this.store.raw(key) || 'null'), session = auth && JSON.parse(this.store.raw(`session:${auth.id}`) || 'null')
    if (session?.accountId && !this.options.requireAccount) throw Object.assign(new Error('Account online play is not active.'), { status: 401 })
    if (!session || auth.expires !== undefined && auth.expires <= this.now() || auth.role === 'agent' && auth.version !== undefined && auth.version !== session.agentVersion || this.options.requireAccount && (!session.accountId || !auth.expires || auth.role === 'human' && auth.accountId !== session.accountId)) {
      const entry = this.authorities.get(key); this.authorities.delete(key); await entry?.close()
      throw Object.assign(new Error('Access expired or revoked. Open a new lobby.'), { status: 401 })
    }
    const entry = this.authorities.get(key)
    if (entry && Date.now() >= entry.expiresAt) throw Object.assign(new Error('Access expired. Open a new lobby.'), { status: 401 })
    return { auth, session }
  }
  adopt(key, { token, session, expiresAt }) {
    return this.serialize(() => {
      // Never retain a capability whose durable owner disappeared.
      this.store.put(key, token && session ? token : null, Math.max(1, (expiresAt - Date.now()) / 1000))
      if (!session) return
      const remote = JSON.parse(session), local = JSON.parse(this.store.raw(`session:${remote.id}`) || 'null')
      const own = local ? { match: local.match, side: local.side, room: local.room, queued: local.queued, history: local.history, agentSeen: local.agentSeen, name: local.name, doctrine: local.doctrine } : { match: null, room: null, queued: null }
      this.store.put(`session:${remote.id}`, JSON.stringify({ ...remote, ...own }), 0)
    })
  }
  async request(method, path, q = new URLSearchParams(), body = {}) {
    let identity = null
    const publicPath = path === '/rules' || path === '/session'
    if (!publicPath) {
      const { session } = await this.authorize(q.get('token'))
      identity = session.accountId ? { id: session.accountId, emailVerified: true } : null
    }
    if (this.options.requireAccount && (path === '/session' || path.startsWith('/agent/'))) throw Object.assign(new Error('Use the website to sign in or approve your agent.'), { status: 401 })
    const startId = randomBytes(24).toString('base64url')
    return this.serialize(async () => {
      if (['/play', '/rooms/start', '/rooms/ready'].includes(path) && this.rooms.size >= 24) throw Object.assign(new Error('All matches are occupied. Retry shortly.'), { status: 503 })
      const result = await new OnlineGame(this.store, { ...this.options, identity, startId }).request(method, path, q, body)
      if (this.createRoom) for (const [key, record] of this.store.data) if (key.startsWith('match:')) {
        const m = JSON.parse(record.value)
        if (!m.report && !this.rooms.has(m.id)) this.rooms.set(m.id, await this.createRoom(m.id))
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
      return new OnlineGame(this.store, this.options).request('INTERNAL', '/tick', undefined, { id })
    })
  }
  sweep() {
    for (const [key, entry] of this.authorities) if (Date.now() - (entry.usedAt || entry.checkedAt) > 120000 || Date.now() >= entry.expiresAt) { this.authorities.delete(key); void entry.close() }
    void this.serialize(() => {
      for (const [key, record] of this.store.data) {
        if (record.expires && record.expires <= this.now()) { this.store.data.delete(key); continue }
        if (!key.startsWith('match:')) continue
        const m = JSON.parse(record.value)
        if (!m.report || this.now() - m.finishedAt < 900000) continue
        this.store.data.delete(key)
        for (const log of [...this.store.data.keys()]) if (log.startsWith(`log:${m.id}:`)) this.store.data.delete(log)
        for (const p of m.players) {
          const sessionKey = `session:${p.session}`, raw = this.store.raw(sessionKey), s = raw && JSON.parse(raw)
          if (s?.match === m.id) { s.match = null; this.store.put(sessionKey, JSON.stringify(s)) }
        }
      }
    })
  }
  async close() { clearInterval(this.sweeper); await Promise.all([...this.authorities.values()].map(entry => entry.close())); this.authorities.clear() }
}
