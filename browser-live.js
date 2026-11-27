import { createMirror, decodeFrame, encodeFrame, board } from './wire.js'
import { MAXPER, TPS, DEFAULT_GAMBITS, HOUSE, createMatch, applyInput, step, view, roundMatch, owned, count, W, H } from './sim.js'

export function createPractice({ seed, minutes = 5, planets = 17, vs = 'normal', opening = DEFAULT_GAMBITS, name = 'you' }) {
  const s = createMatch(seed, { minutes, planets }), mirror = createMirror()
  applyInput(s, 0, { gambits: opening }); applyInput(s, 1, { gambits: HOUSE[vs] })
  let timer = null, report = null, startedAt = 0, closed = false
  return {
    start(onMessage) {
      if (timer || closed) return
      startedAt = Date.now()
      timer = setInterval(() => {
        const target = Math.floor((Date.now() - startedAt) * TPS / 1000), end = Math.min(target, s.tick + 20)
        while (s.tick < end && !s.ended) step(s)
        if (s.ended && !report) { const v = view(s, 0); report = { ...v.ended, you: v.totals.you, enemy: v.totals.enemy, planets: v.totals.planets } }
        onMessage({ t: 'f', bytes: encodeFrame(s, 0, mirror) })
        onMessage({ t: 'meta', matchId: `practice-${seed}`, roomCode: null, report, calls: [], feed: [], edits: [], startsIn: 0, waitingForAgent: false,
          me: { name, setup: 'no agent', withAgent: false, agentJoined: false }, opponent: { name: `House bot (${vs[0].toUpperCase() + vs.slice(1)})`, setup: 'fixed gambits', human: false, connected: true },
          options: s.opts, side: 0, gambits: s.gambits[0], result: report ? view(s, 0).ended : null, board: board(s, 0) })
        if (s.ended) { clearInterval(timer); timer = null; closed = true }
      }, 100)
    },
    input(body) { return closed ? { ok: false, error: 'match ended' } : applyInput(s, 0, body) },
    close() { closed = true; clearInterval(timer); timer = null },
  }
}

export function createLiveView() {
  const mirror = createMirror(), N = 2 * MAXPER
  let arrivedAt = 0, ready = false, broken = false, battalions = []
  return {
    get side() { return mirror.side },
    get tick() { return mirror.tick },
    get ready() { return ready && !broken },
    get battalions() { return battalions },
    receive(bytes, now) {
      if (broken && !(bytes[0] & 1)) return false
      try { decodeFrame(bytes, mirror); broken = false; ready = true; arrivedAt = now; return true }
      catch { broken = true; return false }
    },
    scene(now) {
      const alpha = Math.max(0, Math.min(1, (now - arrivedAt) / 100)), x = new Float32Array(N), y = new Float32Array(N), vx = new Float32Array(N), vy = new Float32Array(N), side = new Uint8Array(N), bats = new Map()
      for (let i = 0; i < N; i++) if (mirror.has[i]) {
        x[i] = (mirror.px[i] + (mirror.x[i] - mirror.px[i]) * alpha) / 4
        y[i] = (mirror.py[i] + (mirror.y[i] - mirror.py[i]) * alpha) / 4
        vx[i] = (mirror.x[i] - mirror.px[i]) / 8; vy[i] = (mirror.y[i] - mirror.py[i]) / 8; side[i] = i < MAXPER ? 0 : 1
        if (side[i] === mirror.side) {
          const id = mirror.bat[i], b = bats.get(id) || { id, cx: 0, cy: 0, n: 0, roles: [0, 0, 0] }
          b.cx += x[i]; b.cy += y[i]; b.n++; b.roles[mirror.role[i]]++; bats.set(id, b)
        }
      }
      battalions = [...bats.values()].sort((a, b) => a.id - b.id)
      for (const b of battalions) { b.cx /= b.n; b.cy /= b.n }
      return { N, alive: mirror.has, x, y, vx, vy, side, role: mirror.role, bat: mirror.bat }
    },
  }
}

export function connectLive(origin, token, onFrame, onDisconnect) {
  let closed = false, socket, retry
  const connect = () => {
    if (closed) return
    const url = new URL('/socket', origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('token', token)
    const next = new WebSocket(url)
    next.binaryType = 'arraybuffer'
    socket = next
    next.onmessage = event => { if (!closed && socket === next) { try { onFrame(typeof event.data === 'string' ? JSON.parse(event.data) : { t: 'f', bytes: new Uint8Array(event.data) }) } catch { onDisconnect() } } }
    next.onclose = () => { if (!closed && socket === next) { onDisconnect(); retry = setTimeout(connect, 1000) } }
    next.onerror = () => { if (!closed && socket === next) onDisconnect() }
  }
  connect()
  return {
    resync() { if (!closed && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: 'resync' })) },
    close() { closed = true; clearTimeout(retry); socket?.close() },
  }
}

// The replay owns its simulation; the caller controls the tick budget per frame.
export function createRoundReplay({ seed, bots, seconds, counter, planets }) {
  const state = roundMatch(seed, bots, { seconds, counter, planets })
  return { state, W, H, advance(ticks = 1) { for (let i = 0; i < ticks && !state.ended; i++) step(state); return state },
    get result() { return state.ended ? { ...state.ended, planets: owned(state), units: count(state) } : null },
    get totals() { return { planets: owned(state), units: count(state) } } }
}
