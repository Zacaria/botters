import { DurableObject } from 'cloudflare:workers'
import { admission, gameHTTP, runGame, failure, json } from './http.js'
import { authorize, hash } from './authority.js'

const bounded = (work, ms = 750) => {
  let timer
  return Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Authority unavailable')), ms) })]).finally(() => clearTimeout(timer))
}
export class MatchRoom extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.sockets = new Map(); this.handles = new Map(); this.tail = Promise.resolve(); this.timer = null; this.matchId = null }
  serial(fn) { const work = this.tail.then(fn, fn); this.tail = work.catch(() => {}); return work }
  async wake(id) {
    if (!this.ctx.id.equals(this.env.MATCHES.idFromName(id))) throw new Error('Wrong match owner')
    this.matchId = id
    await this.ctx.storage.put('matchId', id)
    if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(Date.now() + 1000)
  }
  async fetch(request) {
    try {
      if (request.headers.get('upgrade') !== 'websocket') return await this.serial(() => gameHTTP(this.env, request, this.handles))
      const admitted = await bounded(admission(this.env, request))
      if (!admitted.session.match || !this.ctx.id.equals(this.env.MATCHES.idFromName(admitted.session.match))) return json({ error: 'Match changed. Reconnect.' }, 409)
      await this.wake(admitted.session.match)
      if (admitted.token.role !== 'human') return json({ error: 'Human connection required.' }, 403)
      if (this.sockets.size >= 8) return json({ error: 'Too many connections. Close another game tab.' }, 429)
      const pair = new WebSocketPair(), server = pair[1]
      server.accept()
      const entry = { key: `token:${hash(new URL(request.url).searchParams.get('token') || '')}`, cookieHash: admitted.token.liveCookieHash, side: admitted.session.side, until: Math.min(Date.now() + 1000, admitted.expires), checked: Date.now(), matchId: admitted.session.match }
      this.sockets.set(server, entry)
      const drop = () => { this.sockets.delete(server); if (!this.sockets.size) { clearTimeout(this.timer); this.timer = null } }
      server.addEventListener('close', drop); server.addEventListener('error', drop)
      // Independent watchdog still fires when D1 or the game queue is stalled.
      entry.watchdog = setInterval(() => { if (!this.sockets.has(server)) return clearInterval(entry.watchdog); if (Date.now() >= entry.until) { server.close(4401, 'Access ended'); drop(); clearInterval(entry.watchdog) } }, 100)
      this.schedule()
      return new Response(null, { status: 101, webSocket: pair[0] })
    } catch (e) { return failure(e) }
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
      const frames = await runGame(this.env, 'INTERNAL', '/tick', new URLSearchParams(), { id: this.matchId, live }, null, undefined, this.handles)
      for (const [socket, entry] of this.sockets) {
        if (Date.now() >= entry.until) { socket.close(4401, 'Access ended'); this.sockets.delete(socket); continue }
        const frame = frames?.[entry.side]
        if (frame) socket.send(JSON.stringify(frame))
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
      const frames = await this.serial(() => runGame(this.env, 'INTERNAL', '/tick', new URLSearchParams(), { id: this.matchId }, null, undefined, this.handles))
      if (frames?.some(f => !f.view.ended)) await this.ctx.storage.setAlarm(Date.now() + 1000)
    } catch { await this.ctx.storage.setAlarm(Date.now() + 1000) }
  }
}
