import { randomBytes, randomInt, createHash } from 'node:crypto'
import { createMatch, applyInput, step, view, rules, replay, totals, describe, matchOptions, OPTIONS, MODES, TYPES, HOUSE, TPS, W, H, MAX_GAMBITS, checkGambits } from '../sim.js'
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
  if (b.morph !== undefined) {
    if (!Number.isSafeInteger(b.morph?.swarm) || !TYPES.includes(b.morph?.type)) fail(400, `Send a swarm ID and a type: ${TYPES.join(', ')}.`)
    input.morph = { swarm: b.morph.swarm, type: b.morph.type }
  }
  if (b.regroup !== undefined) {
    if (!Number.isSafeInteger(b.regroup?.swarm) || (b.regroup.with !== undefined && !Number.isSafeInteger(b.regroup.with))) fail(400, 'Send a swarm ID and optionally the ID of a swarm whose group it joins.')
    input.regroup = { swarm: b.regroup.swarm, ...(b.regroup.with !== undefined && { with: b.regroup.with }) }
  }
  if (b.produce !== undefined) {
    if (!Number.isSafeInteger(b.produce?.planet) || (b.produce.type !== null && !TYPES.includes(b.produce.type))) fail(400, `Send a planet ID and a type: ${TYPES.join(', ')}, or null for auto.`)
    input.produce = { planet: b.produce.planet, type: b.produce.type }
  }
  if (!Object.keys(input).length) fail(400, 'Send a gambit change or swarm action.')
  return input
}
const parsePlay = b => {
  if (b.opening != null && checkGambits(b.opening)) fail(400, checkGambits(b.opening))
  if (matchOptions(b).mode !== '1v1' && b.vs === 'player') fail(400, '2v2 and free-for-all are played against house bots for now. Pick Easy, Normal or Hard.')
  return { ...matchOptions(b), vs: [...Object.keys(HOUSE), 'player'].includes(b.vs) ? b.vs : 'normal', planning: PLANNING.includes(b.planning) ? b.planning : 20,
    withAgent: b.withAgent !== false, opening: b.opening ? canonicalRules(b.opening) : null,
    anyMinutes: b.minutes === 'any', anyPlanets: b.planets === 'any' }
}
const sharedSettings = req => ({ ...matchOptions(req), mode: '1v1', planning: req.planning, vs: 'player' }) // human rooms and the queue are duels
const foes = (m, side) => m.players.filter(p => m.s.teams[p.side] !== m.s.teams[side])
const opponent = (m, side) => { const f = foes(m, side); return f.length > 1 ? { ...f[0], name: `${f.length} house bots (${f[0].name.replace(/^house \(|\)$/g, '')})` } : f[0] }
const emit = (m, p, message) => { p.events.push({ seq: ++p.seq, t: Math.floor(m.s.tick / TPS), text: message }); p.events = p.events.slice(-200) }
const feed = (m, p, who, message) => { p.feed.push({ t: Math.floor(m.s.tick / TPS), who, text: message }); p.feed = p.feed.slice(-12) }

function diffEvents(m, p) {
  const v = view(m.s, p.side), was = p.prev
  p.prev = v
  if (v.ended) return emit(m, p, `match over: you ${v.ended.result} (${v.ended.reason}). Particles ${v.totals.you} vs ${v.totals.enemy}.`)
  if (!was) return
  for (const e of v.enemies) if (e.n >= 1500 && !was.enemies.some(o => o.id === e.id)) emit(m, p, `enemy swarm ${e.id} (${e.n}) spotted at (${e.x},${e.y})`)
  for (const pl of v.planets) if (pl.owner !== was.planets[pl.id].owner && pl.massLeft > 0) emit(m, p, `${pl.owner || 'neutral'} captured planet ${pl.id} (${pl.x},${pl.y})`)
  for (const c of v.swarms) if (c.hunger >= 1 && !was.swarms.some(o => o.id === c.id && o.hunger >= 1)) emit(m, p, `swarm ${c.id} (${c.type}) is starving at (${c.x},${c.y}): it has not touched a planet or killed anything for too long`)
  for (const c of was.swarms) if (c.n >= 500 && c.fighting && !v.swarms.some(o => o.id === c.id)) emit(m, p, `your swarm ${c.id} was destroyed near (${c.x},${c.y})`)
  if ((v.totals.you < v.totals.enemy) !== (was.totals.you < was.totals.enemy)) emit(m, p, `lead changed: ${v.totals.you} vs ${v.totals.enemy} particles`)
  if (v.secondsLeft === 60) emit(m, p, '1 minute left.')
}

function whatIf(m, p, log, deadline) {
  const result = s => { const t = view(s, p.side).totals; return { result: s.ended.winner === s.teams[p.side] ? 'won' : s.ended.winner === null ? 'draw' : 'lost', you: t.you, enemy: t.enemy } }
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

function matchFrame(m, side, now) {
  const p = m.players[side], foe = opponent(m, side)
  return { matchId: m.id, roomCode: m.roomCode, view: view(m.s, side), report: m.report?.[side], calls: p.calls, feed: p.feed, gambitsBy: p.gambitsBy,
    startsIn: Math.max(0, Math.ceil((m.startsAt - now) / 1000)), me: { name: p.name, setup: p.setup, withAgent: p.withAgent, agentJoined: p.agentJoined },
    opponent: { name: foe.name, setup: foe.setup, human: !!foe.session, connected: !foe.session || now - foe.seen < 15000 }, options: m.s.opts }
}

export class OnlineGame {
  constructor(store, { now = Date.now, origin = 'https://botters.vercel.app', deadline = Infinity, requireAccount = false, liveExchange = false, identity = null, startId } = {}) { this.store = store; this.now = now; this.origin = origin; this.deadline = deadline; this.requireAccount = requireAccount; this.liveExchange = liveExchange; this.identity = identity?.emailVerified === true ? identity : null; this.startId = startId }
  async request(method, path, q = new URLSearchParams(), body = {}) {
    if (!body || Array.isArray(body) || typeof body !== 'object') fail(400, 'Send a JSON object.')
    if (method === 'GET' && path === '/rules') return { online: true, map: { W, H }, maxGambits: MAX_GAMBITS, ...rules() }
    const frameRead = method === 'GET' && path === '/state'
    return transaction(this.store, async tx => {

      const now = this.now()
      const loadSession = id => tx.get(`session:${id}`, null, this.requireAccount ? 0 : SESSION_TTL)
      const ratingPrefix = this.requireAccount ? 'verified:' : ''
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
        const pairs = new Map([...(await tx.get(`${ratingPrefix}leaderboard`, [], 0)), ...updatedRatings])
        return rankPairs([...pairs]).slice(0, 10).map(([, entry]) => entry)
      }
      const finish = async m => {
        if (!m.s.ended || m.report) return

        const chunks = []
        for (let i = 0; i < Math.ceil(m.logCount / 64); i++) {
          const chunk = await tx.get(`log:${m.id}:${i}`)
          if (!chunk) fail(503, 'Match log is unavailable. Retry shortly.')
          chunks.push(chunk)
        }
        const log = chunks.flat().slice(0, m.logCount)
        m.report = m.players.map(p => p.session ? whatIf(m, p, log, this.deadline) : null)
        const rated = m.players.length === 2 && (!this.requireAccount || m.players.every(p => p.accountId) && m.players[0].accountId !== m.players[1].accountId)
        if (rated) {
          const ratings = await Promise.all(m.players.map(async p => {
            const key = hash(JSON.stringify([this.requireAccount ? p.accountId : p.name, p.setup]))
            return { key, entry: await tx.get(`${ratingPrefix}elo:${key}`, { name: p.name, setup: p.setup, rating: 1000, games: 0 }, 0) }
          }))
          const expected = 1 / (1 + 10 ** ((ratings[1].entry.rating - ratings[0].entry.rating) / 400))
          const got = m.s.ended.winner === 0 ? 1 : m.s.ended.winner === null ? .5 : 0
          const delta = Math.round(32 * (got - expected))
          if (ratings[0].key !== ratings[1].key) for (const [side, { key, entry }] of ratings.entries()) {
            const value = { ...entry, name: m.players[side].name, rating: entry.rating + (side ? -delta : delta), games: entry.games + 1 }
            await tx.set(`${ratingPrefix}elo:${key}`, value, 0); updatedRatings.set(key, value)
          }
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

        while (m.s.tick < target && !m.s.ended) {
          if (m.s.tick % 100 === 0) checkDeadline(this.deadline)
          step(m.s)
          if (m.s.tick % TPS === 0 || m.s.ended) for (const p of m.players) diffEvents(m, p)
        }

        await finish(m)
        return m
      }
      const start = async (entries, req, roomCode = null) => {
        const m = { id: this.startId || token(), s: createMatch(randomInt(2 ** 31), req), players: [], logCount: 0, roomCode, planning: req.planning, startsAt: now + req.planning * 1000 }
        entries = Array.from({ length: MODES[req.mode].length }, (_, side) => entries[side] || null) // sides nobody sits on are played by the house
        for (const [side, e] of entries.entries()) {
          const p = { side, session: e?.s.id || null, accountId: e?.s.accountId || null, name: e?.s.name || `house (${req.vs})`, setup: e ? (e.req.withAgent ? e.s.setup : 'no agent') : 'fixed gambits', withAgent: !!e?.req.withAgent,
            agentJoined: false, openingBy: e?.req.opening ? 'human' : 'agent', events: [], seq: 0, sent: [], humanSent: [], calls: [], feed: [], prev: null, seen: now,
            gambitsBy: { who: e ? 'default' : 'house', t: 0, why: '' } }
          m.players.push(p)
          const opening = e ? e.req.opening : HOUSE[req.vs]
          if (opening) { const input = { gambits: canonicalRules(opening) }; applyInput(m.s, side, input); await appendLog(m, { tick: 0, side, role: e ? 'human' : 'house', input }); if (e) p.gambitsBy = { who: 'you', t: 0, why: 'your opening gambits' } }
          if (e) { e.s.match = m.id; e.s.side = side; e.s.queued = null }
          emit(m, p, `match starts in ${req.planning}s. Your home planet is at (${Math.round(m.s.planets[side].x)},${Math.round(m.s.planets[side].y)}).${m.s.teams.length > 2 ? ` Mode ${req.mode}: ${m.s.teams.filter(t => t === m.s.teams[side]).length > 1 ? 'a house ally shares your team. ' : ''}${new Set(m.s.teams).size - 1} enemy team${new Set(m.s.teams).size > 2 ? 's' : ''}.` : ''} You start with one swarm of each type (locust, carapace, spore). ${p.openingBy === 'human' ? 'Keep your human’s opening gambits unless a change is needed.' : 'Write opening gambits from the doctrine now.'}`)
        }
        await tx.set(`match:${m.id}`, m)
        return m
      }
      if (method === 'INTERNAL' && path === '/tick') {
        const m = await loadMatch(body.id)
        return m ? m.players.map(p => matchFrame(m, p.side, now)) : null
      }
      if (method === 'POST' && path === '/agent/pair' && this.requireAccount) {
        const agentToken = token(), id = token(), setup = text(body.setup, 40, 'agent')
        await tx.set(`pair:${id}`, { secretHash: hash(agentToken), setup, expires: now + 600000 }, 600)
        await tx.set(`pending:${hash(agentToken)}`, { id, expires: now + 600000 }, 600)
        return { id, agentToken, approvalUrl: `${this.origin}/?pair=${id}`, expiresIn: 600 }
      }
      if (method === 'GET' && path === '/agent/poll' && this.requireAccount) {
        const bearer = q.get('token') || ''
        if (!/^[\w-]{32}$/.test(bearer)) fail(401, 'Invalid pairing token.')
        const grant = await tx.get(`token:${hash(bearer)}`)
        if (grant?.role === 'agent') {
          const owner = await loadSession(grant.id)
          if (!owner || owner.agentVersion !== grant.version || grant.expires <= now) fail(401, 'Agent access was revoked or expired.')
          return { approved: true }
        }
        const pending = await tx.get(`pending:${hash(bearer)}`)
        if (!pending || pending.expires <= now) fail(410, 'Pairing expired. Start a new request.')
        return { approved: false }
      }
      if (method === 'GET' && path === '/leaderboard') {
        if (this.requireAccount && !this.identity) fail(401, 'Sign in to play online.')
        return { leaderboard: await board() }
      }
      if (method === 'POST' && path === '/session') {
        if (this.requireAccount) {
          if (!this.identity) fail(401, 'Sign in and verify your email to play online.')
          const accountKey = `account:${hash(this.identity.id)}`, account = await tx.get(accountKey, null, 0)
          let s = account && await tx.get(`session:${account.id}`, null, 0)
          if (!s) {
            s = { id: token(), accountId: this.identity.id, agentVersion: 0, name: text(this.identity.name, 24, 'you'), setup: 'no agent', doctrine: DEFAULT_DOCTRINE, agentSeen: 0, match: null, side: 0, queued: null, room: null, history: [] }
            await tx.set(`session:${s.id}`, s, 0)
            await tx.set(accountKey, { id: s.id }, 0)
          }
          const humanToken = token(), expires = this.liveExchange ? Math.min(this.identity.authExpires, now + SESSION_TTL * 1000) : now + SESSION_TTL * 1000
          if (this.liveExchange && (!this.identity.authSessionId || !Number.isFinite(expires) || expires <= now)) fail(401, 'Sign in again to connect to live play.')
          const key = `token:${hash(humanToken)}`
          await tx.set(key, { id: s.id, role: 'human', accountId: s.accountId, expires, ...(this.liveExchange ? { authSessionId: this.identity.authSessionId } : {}) }, Math.ceil((expires - now) / 1000))
          if (!this.liveExchange) return { humanToken, sessionId: s.id }
          const liveTicket = token()
          await tx.set(`live-ticket:${hash(liveTicket)}`, { tokenKey: key }, 60)
          return { humanToken, sessionId: s.id, liveTicket }
        }
        // Isolated development fixture compatibility only; production requires accounts.
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
      if (this.requireAccount) {
        if (!s.accountId || auth.expires <= now || !auth.expires) fail(401, 'Access expired. Sign in or pair your agent again.')
        if (auth.role === 'human' && (!this.identity || this.identity.id !== s.accountId || auth.accountId !== s.accountId)) fail(401, 'Sign in to your own account.')
        if (auth.role === 'agent' && auth.version !== s.agentVersion) fail(401, 'Agent access was revoked.')
        if (auth.role === 'agent' && !(method === 'GET' && ['/next', '/events', '/state'].includes(path) || method === 'POST' && ['/input', '/call'].includes(path))) fail(401, 'Agent access cannot perform human actions.')
      }
      if (!auth.touched || now - auth.touched >= 60000) auth.touched = now
      if (!s.touched || now - s.touched >= 60000) s.touched = now
      const human = () => { if (auth.role !== 'human') fail(401, 'Human token required.') }
      const agent = () => { if (auth.role !== 'agent') fail(401, 'Agent token required.') }
      if (path.startsWith('/agent/')) {
        human()
        if (method === 'POST' && path === '/agent/revoke') { s.agentVersion++; s.agentGranted = false; s.agentSeen = 0; s.setup = 'no agent'; return { ok: true } }
        const id = method === 'GET' ? q.get('id') : body.id
        if (!/^[\w-]{32}$/.test(id || '')) fail(400, 'Invalid pairing request.')
        const pair = await tx.get(`pair:${id}`)
        if (!pair || pair.expires <= now) fail(410, 'Pairing expired. Ask your agent to start again.')
        if (pair.used) fail(409, 'Pairing already approved.')
        if (method === 'GET' && path === '/agent/request') return { setup: pair.setup }
        if (method === 'POST' && path === '/agent/approve') {
          s.agentVersion++; s.agentGranted = true; s.setup = pair.setup; s.agentSeen = now; pair.used = true
          await tx.set(`token:${pair.secretHash}`, { id: s.id, role: 'agent', version: s.agentVersion, expires: now + SESSION_TTL * 1000 }, SESSION_TTL)
          return { ok: true }
        }
        fail(404, 'Unknown agent action.')
      }
      if (auth.role === 'agent' && (!s.agentSeen || now - s.agentSeen >= 15000)) s.agentSeen = now
      const m = await loadMatch(s.match), p = m?.players[s.side]
      if (p && now - p.seen >= 5000) p.seen = now
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
        return { online: true, name: s.name, agent: connected(s, now) ? s.setup : null, agentGranted: !!s.agentGranted, doctrine: s.doctrine, history: s.history, live: active(m), inMatch: !!m,
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
        if (path === '/rooms/rematch') {
          if (!m || body.matchId !== undefined && body.matchId !== m.id) fail(409, 'This match is no longer available for a rematch.')
          if (!s.room) {
            const foe = opponent(m, s.side), other = foe.session && await loadSession(foe.session)
            if (!other || other.match !== m.id || other.queued || other.room && other.room !== m.rematchRoomCode) fail(409, 'Your opponent has left. Find a new opponent from the lobby.')
            const req = parsePlay(body)
            let room = idx.rooms[m.rematchRoomCode]
            if (!room) {
              let code
              do { code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join('') } while (idx.rooms[code])
              room = idx.rooms[code] = { host: s.id, members: [s.id], invited: other.id, settings: sharedSettings({ ...m.s.opts, planning: m.planning || 20 }), ready: [s.id], updated: now, match: m.id }
              m.rematchRoomCode = code; s.room = code; s.roomPrefs = req
              return { ok: true, waiting: true }
            }
            if (room.match !== m.id || room.invited !== s.id || room.members.length !== 1 || room.members[0] !== other.id) fail(409, 'This rematch is no longer available.')
            room.members.push(s.id); s.room = m.rematchRoomCode; s.roomPrefs = req
          }
        }
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
            if (room.invited && room.invited !== s.id) fail(403, 'This rematch is reserved for the original opponent.')
            if (room.members.length >= 2) fail(409, 'Room is full.')
            // A finished room can accept a replacement; an active match cannot.
            if (active(await loadMatch(room.match))) fail(409, 'This room is playing a match.')
            const req = parsePlay(body)
            room.members.push(s.id); room.ready = []; room.updated = now; s.room = code; s.roomPrefs = req
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
        if (path === '/rooms/rematch' && room.invited && room.members.length === 1 && room.members[0] === s.id) return { ok: true, waiting: true }
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
          if (other && (!this.requireAccount || other.accountId && other.accountId !== s.accountId) && !active(await loadMatch(other.match)) && !other.room) {
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
      if (frameRead) { requireMatch(); if (this.requireAccount && auth.role === 'agent' && !p.withAgent) fail(403, 'Your human is playing this match alone.'); return matchFrame(m, s.side, now) }
      if (method === 'GET' && path === '/events') {
        agent()
        if (!m || !p.agentJoined) return { events: [], state: null, next: m && !p.withAgent ? 'solo' : 'join' }
        const since = Number(q.get('since')) || 0
        return { events: p.events.filter(e => e.seq > since), state: view(m.s, s.side), startsIn: Math.max(0, Math.ceil((m.startsAt - now) / 1000)) }
      }
      if (method === 'POST' && path === '/surrender') {
        human(); requireMatch()
        if (m.s.ended) fail(409, 'Match is over.')
        const input = { surrender: true }
        applyInput(m.s, s.side, input)
        await appendLog(m, { tick: m.s.tick, side: s.side, role: 'human', input })
        for (const player of m.players) diffEvents(m, player)
        await finish(m)
        return { ok: true }
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
        if (now < m.startsAt && (input.order || input.morph || input.regroup || input.produce || input.split !== undefined || input.release !== undefined)) fail(409, 'Match not started: only gambits can change now.')
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
        feed(m, p, auth.role === 'human' ? 'you' : 'agent', `${body.gambits ? 'rewrote gambits' : body.toggle !== undefined ? 'switched a rule' : body.order ? `ordered swarm ${body.order.swarm}` : body.morph ? `changed swarm ${body.morph.swarm} to ${body.morph.type}` : body.split !== undefined ? 'split a swarm' : 'released a swarm'}${why ? `: ${why}` : ''}`)
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
