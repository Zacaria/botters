import http from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { Room, Server, ServerError, matchMaker } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { createHandler } from './http.js'
import { LiveStore } from './live-store.js'
import { LiveRuntime } from './live-runtime.js'

export async function createLiveServer({ remote = null, authority, origins, origin, now = Date.now, requireAccount = false, staticHandler, buildId = 'development' } = {}) {
  // The account rollout is separately gated. Do not silently turn its
  // cookie-bound human tokens into cross-origin bearer-only credentials.
  if (requireAccount) throw new Error('Account activation requires a reviewed live-session exchange; this release keeps anonymous production mode.')
  if (!origins?.length || origins.some(s => new URL(s).origin !== s)) throw new Error('Set exact PLAYER_ORIGINS')
  const permitted = value => !value || origins.includes(value)
  const store = new LiveStore(remote, { now }), runtime = new LiveRuntime(store, { now, origin, requireAccount, authority })
  const handler = createHandler(store, { origin, origins, now, runtime })
  const roomSecret = randomBytes(24).toString('hex'), admission = new Map(), reservations = new Map()
  let draining = false
  const readBody = async req => {
    if (req.body !== undefined) {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
      if (!body || Array.isArray(body) || typeof body !== 'object') throw Object.assign(new Error('Send a JSON object.'), { status: 400 })
      return body
    }
    let raw = ''
    for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 16384) throw Object.assign(new Error('Request is too large.'), { status: 413 }) }
    const body = raw ? JSON.parse(raw) : {}
    if (!body || Array.isArray(body) || typeof body !== 'object') throw Object.assign(new Error('Send a JSON object.'), { status: 400 })
    return body
  }
  class MatchRoom extends Room {
    maxClients = 4 // At most two connections per participant (reload overlap).
    maxMessagesPerSecond = 5
    autoDispose = false
    onCreate({ matchId, secret } = {}) {
      if (secret !== roomSecret || !store.raw(`match:${matchId}`)) throw new ServerError(403, 'internal-room')
      this.matchId = matchId; this.busy = false; this.frames = null; this.seatReservationTimeout = 10
      this.onMessage('*', client => client.leave(4004)) // Inputs go through the validated HTTP/MCP path.
      this.setSimulationInterval(async () => {
        if (this.busy) return
        this.busy = true
        try {
          const sides = []
          await Promise.all(this.clients.map(async c => {
            c.auth.valid = false
            try {
              const { auth, session } = await runtime.authorize(c.auth.token)
              if (auth.role !== 'human' || session.match !== matchId || session.side !== c.auth.side) return c.leave(4003)
              c.auth.valid = true; sides.push(session.side)
            } catch { c.leave(4003) }
          }))
          this.frames = await runtime.frames(matchId, sides)
          if (!this.frames) return void this.disconnect()
          if (this.frames.every(f => f.report)) {
            this.endedAt ||= Date.now()
            if (Date.now() - this.endedAt > 60000) void this.disconnect()
          }
        } catch { this.frames = null; for (const c of this.clients) c.send('unavailable', {}) }
        finally { this.busy = false }
      }, 50)
      this.patchRate = null
      this.clock.setInterval(() => {
        if (!this.frames) return
        for (const c of this.clients) if (c.auth.valid && runtime.canFrame(c.auth.token, this.matchId, c.auth.side)) c.send('frame', this.frames[c.auth.side])
      }, 80)
    }
    async onAuth(_client, options, context) {
      if (!permitted(context.headers.get('origin'))) throw new ServerError(403, 'origin')
      const { auth, session } = await runtime.authorize(options?.token)
      if (auth.role !== 'human' || session.match !== this.matchId) throw new ServerError(403, 'match')
      return { side: session.side, token: options.token, valid: true }
    }
    onJoin(client) { reservations.delete(client.auth.token) }
    onDispose() { runtime.rooms.delete(this.matchId); this.frames = null }
  }
  matchMaker.controller.getCorsHeaders = headers => {
    const requested = headers.get('origin')
    return requested && origins.includes(requested) ? { 'Access-Control-Allow-Origin': requested, Vary: 'Origin' } : { Vary: 'Origin' }
  }
  const httpServer = http.createServer()
  const server = new Server({ greet: false, gracefullyShutdown: false,
    transport: new WebSocketTransport({ server: httpServer, maxPayload: 1024, perMessageDeflate: false, verifyClient: info => permitted(info.origin) }),
    express: app => {
      app.disable('x-powered-by')
      app.use(async (req, res) => {
        req.url = req.url.replace(/^\/_live\/matchmake/, '/matchmake')
        res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer'); res.set('X-Content-Type-Options', 'nosniff')
        const requested = req.headers.origin
        if (!permitted(requested)) return res.status(403).json({ error: 'Use the game from its own site.' })
        if (requested) { res.set('Access-Control-Allow-Origin', requested); res.set('Vary', 'Origin') }
        if (req.method === 'OPTIONS') { res.set('Access-Control-Allow-Headers', 'Content-Type'); res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); return res.sendStatus(204) }
        if (new URL(req.url, origin).searchParams.has('route')) return res.status(400).json({ error: 'Use the live endpoint path directly.' })
        if (req.path.startsWith('/auth/') || req.path.startsWith('/api/auth/')) return res.status(404).json({ error: 'Sign in on the website.' })
        if (req.path === '/health') return res.json({ status: draining ? 'draining' : 'ok', build: buildId, transport: 'colyseus', activeMatches: runtime.rooms.size, convex: remote?.calls || null, memory: process.memoryUsage().rss })
        if (draining) return res.status(503).json({ error: 'Server is restarting. Retry shortly.' })
        if (staticHandler && await staticHandler(req, res)) return
        if (!['GET', 'POST'].includes(req.method)) return res.sendStatus(405)
        // Caddy supplies the real address; container port is not public. Bound
        // expensive new authorization and reservations independently of ticks.
        const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',').at(-1).trim(), minute = Math.floor(Date.now() / 60000)
        const key = `${ip}:${minute}`, used = admission.get(key) || 0
        for (const k of admission.keys()) if (!k.endsWith(`:${minute}`)) admission.delete(k)
        if (used >= 2400 || admission.size >= 4096) return res.status(429).json({ error: 'Too many requests. Retry shortly.' })
        admission.set(key, used + 1)
        req.headers['x-vercel-forwarded-for'] = ip // Never trust a caller-supplied Vercel-only header on Lightsail.
        for (const [token, until] of reservations) if (until <= Date.now()) reservations.delete(token)
        const admitToken = bearer => {
          if (!/^[\w-]{32}$/.test(bearer || '') || store.raw(`token:${createHash('sha256').update(bearer).digest('hex')}`)) return true
          const unknown = `${ip}:auth:${minute}`, attempts = admission.get(unknown) || 0
          if (attempts >= 40) return false
          admission.set(unknown, attempts + 1); return true
        }
        if (req.path === '/socket' || req.path.startsWith('/matchmake')) {
          try {
            const match = /^\/matchmake\/joinById\/([\w-]+)$/.exec(req.path)
            if (req.path !== '/socket' && (!match || req.method !== 'POST')) return res.status(403).json({ error: 'Use your own match connection.' })
            const body = match ? await readBody(req) : null
            const bearer = body?.token || new URL(req.url, origin).searchParams.get('token')
            if (!admitToken(bearer)) return res.status(429).json({ error: 'Too many new connections. Retry shortly.' })
            const { auth, session } = await runtime.authorize(bearer)
            if (auth.role !== 'human') return res.status(401).json({ error: 'Human token required.' })
            const roomId = runtime.rooms.get(session.match)
            if (!roomId || match && match[1] !== roomId) return res.status(409).json({ error: 'Match connection is unavailable. Return to the lobby.' })
            if (!match) return res.json({ roomId })
            const room = matchMaker.getLocalRoomById(roomId)
            if ((reservations.get(bearer) || 0) > Date.now() || room.clients.filter(c => c.auth.side === session.side).length >= 2) return res.status(429).json({ error: 'A connection is already opening. Retry shortly.' })
            reservations.set(bearer, Date.now() + 10000)
            return res.json(await matchMaker.joinById(roomId, { token: bearer }, { headers: new Headers(req.headers) }))
          } catch (e) { return res.status(e.status || (e instanceof SyntaxError ? 400 : 503)).json({ error: e.status ? e.message : 'Live connection unavailable.' }) }
        }
        if (!admitToken(new URL(req.url, origin).searchParams.get('token'))) return res.status(429).json({ error: 'Too many new connections. Retry shortly.' })
        return handler(req, res)
      })
    },
  })
  server.define('match', MatchRoom)
  await server.serverless()
  // Colyseus mounts its built-in router before Express. Disable its public
  // methods and route the SDK's URL through our pre-reservation auth guard.
  matchMaker.controller.exposedMethods = []
  const listeners = httpServer.listeners('request')
  httpServer.removeAllListeners('request')
  httpServer.on('request', (req, res) => {
    if (Number(req.headers['content-length']) > 16384) { res.writeHead(413); return res.end() }
    if (req.url.startsWith('/matchmake/')) req.url = '/_live' + req.url
    for (const listener of listeners) listener.call(httpServer, req, res)
  })
  runtime.createRoom = async id => (await matchMaker.createRoom('match', { matchId: id, secret: roomSecret })).roomId
  return { server, httpServer, runtime, store,
    listen: (port = 0, host = '127.0.0.1') => new Promise(resolve => httpServer.listen(port, host, () => resolve(httpServer.address()))),
    async close() { draining = true; await server.gracefullyShutdown(false); await runtime.close() },
  }
}
