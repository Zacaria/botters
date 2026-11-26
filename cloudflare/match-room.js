import { DurableObject } from 'cloudflare:workers'
import { createMirror, encodeFrame, boardKey } from '../wire.js'
import { admission, gameHTTP, runGame, failure, json } from './http.js'
import { authorize, hash } from './authority.js'

const bounded = (work, ms = 750) => {
  let timer
  return Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Authority unavailable')), ms) })]).finally(() => clearTimeout(timer))
}
export class MatchRoom extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.sockets = new Map(); this.stateCache = new Map(); this.tail = Promise.resolve(); this.timer = null; this.matchId = null }
  serial(fn) { const work = this.tail.then(fn, fn); this.tail = work.catch(() => {}); return work }
  async wake(id) {
    if (!this.ctx.id.equals(this.env.MATCHES.idFromName(id))) throw new Error('Wrong match owner')
    this.matchId = id
    await this.ctx.storage.put('matchId', id)
    if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(Date.now() + 1000)
  }
  async fetch(request) {
    try {
      if (request.headers.get('upgrade') !== 'websocket') return await this.serial(() => gameHTTP(this.env, request, this.stateCache))
      const admitted = await bounded(admission(this.env, request))
      if (!admitted.session.match || !this.ctx.id.equals(this.env.MATCHES.idFromName(admitted.session.match))) return json({ error: 'Match changed. Reconnect.' }, 409)
      await this.wake(admitted.session.match)
      if (admitted.token.role !== 'human') return json({ error: 'Human connection required.' }, 403)
      // Counted per side: one player's tabs never take the other player's place.
      if ([...this.sockets.values()].filter(e => e.side === admitted.session.side).length >= 4) return json({ error: 'Too many connections. Close another game tab.' }, 429)
      const pair = new WebSocketPair(), server = pair[1]
      server.accept()
      const entry = { key: `token:${hash(new URL(request.url).searchParams.get('token') || '')}`, cookieHash: admitted.token.liveCookieHash, side: admitted.session.side, until: Math.min(Date.now() + 1000, admitted.expires), checked: Date.now(), matchId: admitted.session.match, mirror: createMirror() }
      this.sockets.set(server, entry)
      const drop = () => { this.sockets.delete(server); if (!this.sockets.size) { clearTimeout(this.timer); this.timer = null } }
      server.addEventListener('close', drop); server.addEventListener('error', drop)
      // Independent watchdog still fires when D1 or the game queue is stalled.
      entry.watchdog = setInterval(() => { if (!this.sockets.has(server)) return clearInterval(entry.watchdog); if (Date.now() >= entry.until) { server.close(4401, 'Access ended'); drop(); clearInterval(entry.watchdog) } }, 100)
      server.addEventListener('message', event => { try { if (JSON.parse(event.data).t === 'resync') void this.serial(() => { entry.mirror.reset = true; return this.sendFrame(server, entry) }) } catch {} })
      await this.serial(() => this.sendFrame(server, entry))
      this.schedule()
      return new Response(null, { status: 101, webSocket: pair[0] })
    } catch (e) { return failure(e) }
  }
  async sendFrame(socket, entry) {
    const data = await runGame(this.env, 'INTERNAL', '/tick', new URLSearchParams(), { id: entry.matchId }, null, undefined, this.stateCache)
    if (!data || !this.sockets.has(socket)) return
    socket.send(encodeFrame(data.state, entry.side, entry.mirror))
    const meta = { t: 'meta', ...data.frames[entry.side] }
    socket.send(JSON.stringify(meta)); entry.meta = JSON.stringify(meta); entry.metaAt = Date.now(); entry.board = boardKey(meta.board)
  }
  schedule() {
    if (this.timer || !this.sockets.size) return
    const delay = Math.max(0, (this.nextFrameAt || Date.now() + 100) - Date.now())
    this.timer = setTimeout(() => {
      this.timer = null
      this.nextFrameAt = Date.now() + 100
      void this.serial(() => this.frame()).finally(() => this.schedule()).catch(() => {})
    }, delay)
  }
  async frame() {
    // Admission is refreshed separately for each socket; a failure closes only its connection.
    await Promise.all([...this.sockets].map(async ([socket, entry]) => {
      if (Date.now() - entry.checked < 500) return
      const started = Date.now()
      try {
        const a = await bounded(authorize(this.env, entry.key, entry.cookieHash))
        if (a.session.match !== entry.matchId || a.session.side !== entry.side) throw new Error('Match changed')
        entry.until = Math.min(started + 1000, a.expires); entry.checked = started
      } catch { socket.close(4401, 'Access ended'); this.sockets.delete(socket); clearInterval(entry.watchdog) }
    }))
    if (!this.sockets.size) return
    try {
      const live = [...new Set([...this.sockets.values()].map(entry => entry.side))]
      const data = await runGame(this.env, 'INTERNAL', '/tick', new URLSearchParams(), { id: this.matchId, live }, null, undefined, this.stateCache)
      for (const [socket, entry] of this.sockets) {
        if (Date.now() >= entry.until) { socket.close(4401, 'Access ended'); this.sockets.delete(socket); continue }
        if (!data) continue
        socket.send(encodeFrame(data.state, entry.side, entry.mirror))
        const meta = JSON.stringify({ t: 'meta', ...data.frames[entry.side] })
        const key = boardKey(data.frames[entry.side].board)
        if (key !== entry.board || data.frames[entry.side].result || (meta !== entry.meta && Date.now() - entry.metaAt >= 1000)) {
          socket.send(meta); entry.meta = meta; entry.metaAt = Date.now(); entry.board = key
        }
      }
    } catch {
      for (const [socket, entry] of this.sockets) { clearInterval(entry.watchdog); socket.close(4503, 'Service unavailable') }
      this.sockets.clear()
    }
  }
  async alarm() {
    this.matchId ||= await this.ctx.storage.get('matchId')
    if (!this.matchId) return
    try {
      const frames = await this.serial(() => runGame(this.env, 'INTERNAL', '/tick', new URLSearchParams(), { id: this.matchId }, null, undefined, this.stateCache))
      if (frames?.frames.some(f => !f.result)) await this.ctx.storage.setAlarm(Date.now() + 1000)
    } catch { await this.ctx.storage.setAlarm(Date.now() + 1000) }
  }
}
