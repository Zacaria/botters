import { randomBytes, randomInt, createHash } from 'node:crypto'
import { createMatch, applyInput, step, view, rules, replay, totals, describe, matchOptions, OPTIONS, HOUSE, TPS, W, H, MAX_GAMBITS, checkGambits } from '../sim.js'
import { transaction, checkDeadline } from './store.js'
import { rankPairs } from './ratings.js'

const token = () => randomBytes(24).toString('base64url')
const hash = s => createHash('sha256').update(s).digest('hex')
const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const text = (s, max, fallback = '') => typeof s === 'string' ? s.trim().slice(0, max) || fallback : fallback
const connected = (s, now) => !!s.agentSeen && now - s.agentSeen < 90000
const active = m => !!m && !m.s.ended
const PLANNING = [10, 20, 30], SESSION_TTL = 7 * 86400
const DEFAULT_DOCTRINE = 'Grab free planets fast, fight only when bigger, protect what we own.'
const canonicalRules = list => {
  const error = checkGambits(list); if (error) fail(400, error)
  return list.map(r => ({ if: r.if, ...(r.p !== undefined ? { p: r.p } : {}), then: r.then, on: r.on !== false }))
}
const cleanInput = b => {
  const input = {}
  if (b.gambits !== undefined) input.gambits = canonicalRules(b.gambits)
  for (const k of ['toggle', 'split', 'release']) if (b[k] !== undefined) {
    if (!Number.isSafeInteger(b[k]) || b[k] < 0 || (k === 'toggle' && b[k] >= MAX_GAMBITS)) fail(400, `Invalid ${k}.`)
    input[k] = b[k]
  }
  if (b.order !== undefined) {
    if (!Number.isSafeInteger(b.order?.swarm) || !Number.isFinite(b.order?.x) || !Number.isFinite(b.order?.y)) fail(400, 'Send a swarm ID and finite x/y coordinates.')
    input.order = { swarm: b.order.swarm, x: Math.max(0, Math.min(W, b.order.x)), y: Math.max(0, Math.min(H, b.order.y)) }
  }
  if (!Object.keys(input).length) fail(400, 'Send a gambit change or swarm action.')
  return input
}
const parsePlay = b => {
  if (b.opening != null && checkGambits(b.opening)) fail(400, checkGambits(b.opening))
  return { ...matchOptions(b), vs: [...Object.keys(HOUSE), 'player'].includes(b.vs) ? b.vs : 'normal', planning: PLANNING.includes(b.planning) ? b.planning : 20,
    withAgent: b.withAgent !== false, opening: b.opening ? canonicalRules(b.opening) : null,
    anyMinutes: b.minutes === 'any', anyPlanets: b.planets === 'any' }
}
const sharedSettings = req => ({ ...matchOptions(req), planning: req.planning, vs: 'player' })
const opponent = (m, side) => m.players.find(p => p.side !== side)
const emit = (m, p, message) => { p.events.push({ seq: ++p.seq, t: Math.floor(m.s.tick / TPS), text: message }); p.events = p.events.slice(-200) }
const feed = (m, p, who, message) => { p.feed.push({ t: Math.floor(m.s.tick / TPS), who, text: message }); p.feed = p.feed.slice(-12) }

function diffEvents(m, p) {
  const v = view(m.s, p.side), was = p.prev
  p.prev = v
  if (v.ended) return emit(m, p, `match over: you ${v.ended.result} (${v.ended.reason}). Particles ${v.totals.you} vs ${v.totals.enemy}.`)
  if (!was) return
  for (const e of v.enemies) if (e.n >= 1500 && !was.enemies.some(o => o.id === e.id)) emit(m, p, `enemy swarm ${e.id} (${e.n}) spotted at (${e.x},${e.y})`)
  for (const pl of v.planets) if (pl.owner !== was.planets[pl.id].owner && pl.massLeft > 0) emit(m, p, `${pl.owner || 'neutral'} captured planet ${pl.id} (${pl.x},${pl.y})`)
  for (const c of was.swarms) if (c.n >= 500 && c.fighting && !v.swarms.some(o => o.id === c.id)) emit(m, p, `your swarm ${c.id} was destroyed near (${c.x},${c.y})`)
  if ((v.totals.you < v.totals.enemy) !== (was.totals.you < was.totals.enemy)) emit(m, p, `lead changed: ${v.totals.you} vs ${v.totals.enemy} particles`)
  if (v.secondsLeft === 60) emit(m, p, '1 minute left.')
}

function whatIf(m, p, log, deadline) {
  const result = s => { const t = totals(s), enemy = opponent(m, p.side).side; return { result: s.ended.winner === p.side ? 'won' : s.ended.winner === null ? 'draw' : 'lost', you: t[p.side], enemy: t[enemy] } }
  const count = role => log.filter(l => l.side === p.side && l.role === role).length
  const boundedReplay = entries => {
    if (!Number.isFinite(deadline)) return replay(m.s.seed, entries, m.s.opts)
    const s = createMatch(m.s.seed, m.s.opts); let i = 0
    while (!s.ended) {
      if (s.tick % 100 === 0) checkDeadline(deadline)
      for (; i < entries.length && entries[i].tick === s.tick; i++) applyInput(s, entries[i].side, entries[i].input)
      step(s)
    }
    return s
  }
  const without = role => count(role) ? result(boundedReplay(log.filter(l => l.side !== p.side || l.role !== role))) : result(m.s)
  return { actual: result(m.s), humanInputs: count('human'), agentInputs: count('agent'), withoutHuman: without('human'), withoutAgent: p.withAgent ? without('agent') : null }
}

export class OnlineGame {
  constructor(store, { now = Date.now, origin = 'https://botters.vercel.app', deadline = Infinity } = {}) { this.store = store; this.now = now; this.origin = origin; this.deadline = deadline }
  async request(method, path, q = new URLSearchParams(), body = {}) {
    if (!body || Array.isArray(body) || typeof body !== 'object') fail(400, 'Send a JSON object.')
    if (method === 'GET' && path === '/rules') return { online: true, map: { W, H }, maxGambits: MAX_GAMBITS, ...rules() }
    const frameRead = method === 'GET' && path === '/state'
    if (frameRead && /^[\w-]{32}$/.test(q.get('token') || '')) await this.store.snapshot?.(`token:${hash(q.get('token'))}`, { deadline: this.deadline })
    return transaction(this.store, async tx => {
      let persist = false
      const now = this.now()
      const loadSession = id => tx.get(`session:${id}`, null, SESSION_TTL)
      const appendLog = async (m, entry) => {
        const chunk = await tx.get(`log:${m.id}:${Math.floor(m.logCount / 64)}`, [])
        chunk.push(entry); m.logCount++
      }
      const index = async () => {
        const idx = await tx.get('index', { queue: [], rooms: {} }, 0)
        idx.queue = idx.queue.filter(e => now - e.seen < 90000)
        for (const [code, r] of Object.entries(idx.rooms)) if (now - r.updated > 86400000) delete idx.rooms[code]
        return idx
      }
      const updatedRatings = new Map()
      const board = async () => {
        const pairs = new Map([...(await tx.get('leaderboard', [], 0)), ...updatedRatings])
        return rankPairs([...pairs]).slice(0, 10).map(([, entry]) => entry)
      }
      const finish = async m => {
        if (!m.s.ended || m.report) return
        persist = true
        const chunks = []
        for (let i = 0; i < Math.ceil(m.logCount / 64); i++) {
          const chunk = await tx.read(`log:${m.id}:${i}`)
          if (!chunk) fail(503, 'Match log is unavailable. Retry shortly.')
          chunks.push(chunk)
        }
        const log = chunks.flat().slice(0, m.logCount)
        m.report = m.players.map(p => p.session ? whatIf(m, p, log, this.deadline) : null)
        const ratings = await Promise.all(m.players.map(async p => {
          const key = hash(JSON.stringify([p.name, p.setup]))
          return { key, entry: await tx.get(`elo:${key}`, { name: p.name, setup: p.setup, rating: 1000, games: 0 }, 0) }
        }))
        const expected = 1 / (1 + 10 ** ((ratings[1].entry.rating - ratings[0].entry.rating) / 400))
        const got = m.s.ended.winner === 0 ? 1 : m.s.ended.winner === null ? .5 : 0
        const delta = Math.round(32 * (got - expected))
        // Same display identity cannot collect two Elo changes from one match.
        if (ratings[0].key !== ratings[1].key) for (const [side, { key, entry }] of ratings.entries()) {
          const value = { ...entry, rating: entry.rating + (side ? -delta : delta), games: entry.games + 1 }
          await tx.set(`elo:${key}`, value, 0); updatedRatings.set(key, value)
        }
        for (const p of m.players) if (p.session) {
          const s = await loadSession(p.session)
          if (s) s.history = [{ matchId: m.id, ...m.report[p.side], vs: opponent(m, p.side).name, reason: m.s.ended.reason }, ...s.history].slice(0, 10)
        }
        m.finishedAt = now
      }
      const loadMatch = async id => {
        if (!id) return null
        const m = await tx.get(`match:${id}`)
        if (!m) return null
        const target = Math.min(m.s.endTick, Math.max(0, Math.floor((now - m.startsAt) * TPS / 1000)))
        if (target - m.s.tick >= TPS) persist = true
        while (m.s.tick < target && !m.s.ended) {
          if (m.s.tick % 100 === 0) checkDeadline(this.deadline)
          step(m.s)
          if (m.s.tick % TPS === 0 || m.s.ended) for (const p of m.players) diffEvents(m, p)
        }
        await finish(m)
        return m
      }
      const frame = (m, side) => {
        const p = m.players[side], foe = opponent(m, side)
        return { matchId: m.id, roomCode: m.roomCode, view: view(m.s, side), report: m.report?.[side], calls: p.calls, feed: p.feed, gambitsBy: p.gambitsBy,
          startsIn: Math.max(0, Math.ceil((m.startsAt - now) / 1000)), me: { name: p.name, setup: p.setup, withAgent: p.withAgent, agentJoined: p.agentJoined },
          opponent: { name: foe.name, setup: foe.setup, connected: !foe.session || now - foe.seen < 15000 }, options: m.s.opts }
      }
      const start = async (entries, req, roomCode = null) => {
        const m = { id: token(), s: createMatch(randomInt(2 ** 31), req), players: [], logCount: 0, roomCode, startsAt: now + req.planning * 1000 }
        for (const [side, e] of entries.entries()) {
          const p = { side, session: e?.s.id || null, name: e?.s.name || `house (${req.vs})`, setup: e ? (e.req.withAgent ? e.s.setup : 'no agent') : 'fixed gambits', withAgent: !!e?.req.withAgent,
            agentJoined: false, openingBy: e?.req.opening ? 'human' : 'agent', events: [], seq: 0, sent: [], humanSent: [], calls: [], feed: [], prev: null, seen: now,
            gambitsBy: { who: e ? 'default' : 'house', t: 0, why: '' } }
          m.players.push(p)
          const opening = e ? e.req.opening : HOUSE[req.vs]
          if (opening) { const input = { gambits: canonicalRules(opening) }; applyInput(m.s, side, input); await appendLog(m, { tick: 0, side, role: e ? 'human' : 'house', input }); if (e) p.gambitsBy = { who: 'you', t: 0, why: 'your opening gambits' } }
          if (e) { e.s.match = m.id; e.s.side = side; e.s.queued = null }
          emit(m, p, `match starts in ${req.planning}s. Home on the ${side ? 'right' : 'left'}. ${p.openingBy === 'human' ? 'Keep your human’s opening gambits unless a change is needed.' : 'Write opening gambits from the doctrine now.'}`)
        }
        await tx.set(`match:${m.id}`, m)
        return m
      }
      if (method === 'GET' && path === '/leaderboard') return { leaderboard: await board() }
      if (method === 'POST' && path === '/session') {
        // Public session creation is bounded per caller IP by the HTTP adapter.
        const humanToken = token(), agentToken = token(), id = token()
        const s = { id, name: text(body.name, 24, 'you'), setup: text(body.setup, 40, 'no agent'), doctrine: DEFAULT_DOCTRINE, agentSeen: body.setup ? now : 0, match: null, side: 0, queued: null, room: null, history: [] }
        await tx.set(`session:${id}`, s, SESSION_TTL)
        await tx.set(`token:${hash(humanToken)}`, { id, role: 'human' }, SESSION_TTL)
        await tx.set(`token:${hash(agentToken)}`, { id, role: 'agent' }, SESSION_TTL)
        return { humanToken, agentToken, lobby: `${this.origin}/?s=${humanToken}` }
      }
      const bearer = q.get('token') || ''
      if (!/^[\w-]{32}$/.test(bearer)) fail(401, 'Unknown session. Open a new lobby.')
      const auth = await tx.get(`token:${hash(bearer)}`, null, SESSION_TTL)
      const s = auth && await loadSession(auth.id)
      if (!s) fail(401, 'Unknown session. Open a new lobby.')
      if (!auth.touched || now - auth.touched >= 60000) { auth.touched = now; persist = true }
      if (!s.touched || now - s.touched >= 60000) { s.touched = now; persist = true }
      const human = () => { if (auth.role !== 'human') fail(401, 'A human session token is required.') }
      const agent = () => { if (auth.role !== 'agent') fail(401, 'An agent session token is required.') }
      if (auth.role === 'agent') { s.agentSeen = now; persist = true }
      const m = await loadMatch(s.match), p = m?.players[s.side]
      if (p && now - p.seen >= 5000) { p.seen = now; persist = true }
      const requireMatch = () => { if (!m) fail(409, 'Not in a match.') }
      const roomInfo = async idx => {
        const room = idx.rooms[s.room]
        if (!room || !room.members.includes(s.id)) { s.room = null; return null }
        const members = await Promise.all(room.members.map(loadSession))
        return { code: s.room, link: `${this.origin}/r/${s.room}`, host: room.host === s.id, settings: room.settings,
          players: members.filter(Boolean).map(o => ({ name: o.name, setup: o.setup, agent: connected(o, now), you: o.id === s.id })), ready: room.ready.map(id => room.members.indexOf(id)), live: active(m), matchId: room.match }
      }
      if (method === 'GET' && path === '/lobby') {
        human()
        const idx = await index(), queued = idx.queue.find(e => e.id === s.id)
        if (queued) queued.seen = now
        s.queued = queued ? queued.at : null
        return { online: true, name: s.name, agent: connected(s, now) ? s.setup : null, doctrine: s.doctrine, history: s.history, live: active(m), inMatch: !!m,
          queued: !!queued, queuedAt: s.queued, room: await roomInfo(idx), leaderboard: await board(), doctrineMax: 500,
          choices: { vs: Object.keys(HOUSE), ...OPTIONS, planning: PLANNING } }
      }
      if (method === 'POST' && path === '/profile') {
        human()
        if (active(m) && body.name !== undefined) fail(409, 'Change your name after the match.')
        if (body.name !== undefined) s.name = text(body.name, 24, s.name)
        if (typeof body.doctrine === 'string') {
          s.doctrine = body.doctrine.trim().slice(0, 500)
          if (active(m)) { emit(m, p, `HUMAN changed the doctrine: ${s.doctrine}`); feed(m, p, 'you', 'changed the doctrine') }
        }
        return { ok: true }
      }
      if (method === 'GET' && path === '/room') { human(); return await roomInfo(await index()) || fail(404, 'Room not found.') }
      if (method === 'POST' && path.startsWith('/rooms')) {
        human()
        const idx = await index()
        if (path === '/rooms/leave') {
          if (active(m)) fail(409, 'Finish the match before leaving the room.')
          const room = idx.rooms[s.room]
          if (room) { room.members = room.members.filter(id => id !== s.id); room.ready = []; room.host = room.members[0]; room.updated = now; if (!room.members.length) delete idx.rooms[s.room] }
          s.room = null
          return { ok: true }
        }
        if (active(m) || s.queued) fail(409, 'Finish your match or cancel the queue first.')
        if (path === '/rooms' || path === '/rooms/join') {
          if (s.room && idx.rooms[s.room]) fail(409, 'Leave your current room first.')
          if (path === '/rooms') {
            const req = parsePlay(body)
            let code
            do { code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join('') } while (idx.rooms[code])
            idx.rooms[code] = { host: s.id, members: [s.id], settings: sharedSettings(req), ready: [], updated: now, match: null }
            s.room = code; s.roomPrefs = req
          } else {
            const code = text(body.code, 6).toUpperCase(), room = idx.rooms[code]
            if (!room) fail(404, 'Room not found. Check the code or ask for a new link.')
            if (room.members.length >= 2) fail(409, 'Room is full.')
            // A finished room can accept a replacement; an active match cannot.
            if (active(await loadMatch(room.match))) fail(409, 'This room is playing a match.')
            room.members.push(s.id); room.ready = []; room.updated = now; s.room = code; s.roomPrefs = parsePlay(body)
          }
          return await roomInfo(idx)
        }
        const room = idx.rooms[s.room]
        if (!room || !room.members.includes(s.id)) fail(404, 'Room not found.')
        room.updated = now
        if (path === '/rooms/player') { s.roomPrefs = parsePlay(body); return { ok: true } }
        if (path === '/rooms/settings') {
          if (room.host !== s.id) fail(403, 'Only the host can change room settings.')
          room.settings = sharedSettings(parsePlay(body)); room.ready = []
          return await roomInfo(idx)
        }
        if (!['/rooms/start', '/rooms/rematch'].includes(path)) fail(404, 'Unknown room action.')
        if (room.members.length !== 2) fail(409, 'Wait for your opponent to join.')
        if (path === '/rooms/start' && room.host !== s.id) fail(403, 'Only the host can start the match.')
        if (active(await loadMatch(room.match))) fail(409, 'Room is already playing.')
        if (Object.keys(body).length) s.roomPrefs = parsePlay(body)
        if (path === '/rooms/rematch') {
          if (!room.match) fail(409, 'Start the first match before requesting a rematch.')
          if (!room.ready.includes(s.id)) room.ready.push(s.id)
          if (room.ready.length < room.members.length) return { ok: true, waiting: true }
        }
        const members = await Promise.all(room.members.map(loadSession))
        if (members.some(o => !o)) fail(409, 'A player session expired. Create a new room.')
        room.match = (await start(members.map(o => ({ s: o, req: { ...room.settings, opening: o.roomPrefs?.opening || null, withAgent: connected(o, now) && o.roomPrefs?.withAgent !== false } })), room.settings, s.room)).id
        room.ready = []
        return { ok: true }
      }
      if (method === 'POST' && path === '/cancel') {
        const idx = await index(); idx.queue = idx.queue.filter(e => e.id !== s.id); s.queued = null; return { ok: true }
      }
      if (method === 'POST' && path === '/play') {
        if (active(m)) fail(409, 'already in a match')
        if (s.room) fail(409, 'Leave your room before starting another match.')
        const req = parsePlay(body), idx = await index()
        idx.queue = idx.queue.filter(e => e.id !== s.id)
        if (req.vs !== 'player') { await start([{ s, req }, null], req); return { ok: true } }
        const entry = idx.queue.find(e => (e.req.anyMinutes || req.anyMinutes || e.req.minutes === req.minutes) && (e.req.anyPlanets || req.anyPlanets || e.req.planets === req.planets))
        if (entry) {
          const other = await loadSession(entry.id)
          if (other && !active(await loadMatch(other.match)) && !other.room) {
            idx.queue = idx.queue.filter(e => e.id !== entry.id)
            const chosen = { ...entry.req, minutes: entry.req.anyMinutes ? req.minutes : entry.req.minutes, planets: entry.req.anyPlanets ? req.planets : entry.req.planets }
            await start([{ s: other, req: entry.req }, { s, req }], chosen)
            return { ok: true }
          }
          idx.queue = idx.queue.filter(e => e.id !== entry.id)
        }
        idx.queue.push({ id: s.id, req, at: now, seen: now }); s.queued = now
        return { ok: true, queued: true }
      }
      if (method === 'GET' && path === '/next') {
        agent()
        if (!active(m) || !p.withAgent) return { match: null }
        p.agentJoined = true
        return { match: { id: m.id, side: s.side, opponent: `${opponent(m, s.side).name} (${opponent(m, s.side).setup})`, options: m.s.opts, doctrine: s.doctrine, openingBy: p.openingBy,
          startsIn: Math.max(0, Math.ceil((m.startsAt - now) / 1000)), state: view(m.s, s.side) } }
      }
      if (frameRead) { requireMatch(); if (!persist) tx.readOnly(); return frame(m, s.side) }
      if (method === 'GET' && path === '/events') {
        agent()
        if (!m || !p.agentJoined) return { events: [], state: null, next: m && !p.withAgent ? 'solo' : 'join' }
        const since = Number(q.get('since')) || 0
        return { events: p.events.filter(e => e.seq > since), state: view(m.s, s.side), startsIn: Math.max(0, Math.ceil((m.startsAt - now) / 1000)) }
      }
      if (method === 'POST' && path === '/input') {
        requireMatch()
        if (m.s.ended) fail(409, 'Match is over.')
        if (auth.role === 'agent' && !p.withAgent) fail(403, 'Your human is playing this match alone.')
        const sentKey = auth.role === 'agent' ? 'sent' : 'humanSent', limit = auth.role === 'agent' ? 5 : 15
        p[sentKey] = p[sentKey].filter(t => now - t < 1000)
        if (p[sentKey].length >= limit) fail(429, `max ${limit} inputs per second`)
        p[sentKey].push(now)
        const input = cleanInput(body)
        if (now < m.startsAt && (input.order || input.split !== undefined || input.release !== undefined)) fail(409, 'Match not started: only gambits can change now.')
        const candidate = structuredClone(m.s)
        const result = applyInput(candidate, s.side, input)
        if (!result.ok) fail(400, result.error)
        if (JSON.stringify(candidate) === JSON.stringify(m.s)) return { ok: true }
        m.s = candidate
        await appendLog(m, { tick: m.s.tick, side: s.side, role: auth.role, input })
        const why = text(body.why, 120), list = m.s.gambits[s.side]
        if (body.gambits || body.toggle !== undefined) p.gambitsBy = { who: auth.role === 'agent' ? 'agent' : 'you', t: Math.floor(m.s.tick / TPS), why: why || (body.toggle !== undefined ? `switched rule ${body.toggle + 1}` : '') }
        if (auth.role === 'human') {
          emit(m, p, `HUMAN ${body.gambits ? `rewrote gambits: ${list.map(describe).join('; ')}` : JSON.stringify(input)}`)
          if (body.order) p.calls = p.calls.filter(c => c.swarm !== body.order.swarm)
        }
        feed(m, p, auth.role === 'human' ? 'you' : 'agent', `${body.gambits ? 'rewrote gambits' : body.toggle !== undefined ? 'switched a rule' : body.order ? `ordered swarm ${body.order.swarm}` : body.split !== undefined ? 'split a swarm' : 'released a swarm'}${why ? `: ${why}` : ''}`)
        return { ok: true }
      }
      if (method === 'POST' && ['/say', '/call', '/dismiss'].includes(path)) {
        requireMatch()
        if (!active(m)) fail(409, 'Match is over.')
        if (path === '/call') {
          agent(); if (!p.withAgent) fail(403, 'Your human is playing alone.')
          const call = { swarm: Number.isFinite(body.swarm) ? body.swarm : null, x: Number.isFinite(body.x) ? Math.round(body.x) : null, y: Number.isFinite(body.y) ? Math.round(body.y) : null, message: text(body.message, 140), t: Math.floor(m.s.tick / TPS) }
          p.calls = [...p.calls.filter(c => call.swarm === null || call.swarm !== c.swarm), call].slice(-3); feed(m, p, 'agent', `asks you: ${call.message}`)
        } else {
          human()
          if (path === '/dismiss') p.calls.splice(Number(body.index), 1)
          else { const message = text(body.text, 140); feed(m, p, 'you', message); emit(m, p, `HUMAN says: ${message}${Number.isFinite(body.x) && Number.isFinite(body.y) ? ` at (${Math.round(body.x)},${Math.round(body.y)})` : ''}`) }
        }
        return { ok: true }
      }
      fail(404, 'Not found.')
    }, { deadline: this.deadline })
  }
}
