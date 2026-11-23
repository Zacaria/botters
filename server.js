// Game server: lobby sessions (one human + optionally one agent), matches vs the house or another player,
// 20 Hz match loop, agent API, browser stream, what-if report, Elo.
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { randomBytes, randomInt } from 'node:crypto'
import { createMirror, encodeFrame, board, boardKey } from './wire.js'
import { servePublicMedia } from './public-media.js'
import { createMatch, applyInput, step, view, rules, describe, changes, matchOptions, OPTIONS, HOUSE, HOUSE_DOCTRINE, TPS, W, H, MAX_GAMBITS } from './sim.js'

const PORT = Number(process.env.PORT || 8787)
const ORIGIN = process.env.BOTTERS_ORIGIN || `http://localhost:${PORT}`
const RATE = 5, FINISHED_TTL = 10 * 60 * 1000, FRAME_EVERY = 2, DOCTRINE_MAX = 500, AGENT_SEEN_MS = 90000
const PLANNING = [10, 20, 30] // seconds before the match starts: time for the agent to write opening gambits
const FORCED_DELAY = process.env.BOTTERS_START_DELAY && Number(process.env.BOTTERS_START_DELAY) // ms, tests only
const SEED = process.env.BOTTERS_SEED ? Number(process.env.BOTTERS_SEED) : undefined // fixed map, tests only
const HOUSE_GAMBITS = process.env.BOTTERS_HOUSE_GAMBITS ? JSON.parse(process.env.BOTTERS_HOUSE_GAMBITS) : null // house rules for every level, benches only
const DEFAULT_DOCTRINE = 'Take free planets early, defend threatened planets, and attack weaker enemies. Never retreat from a larger battalion: flank it.'
const LEVELS = Object.keys(HOUSE)
const tokens = new Map(), elo = new Map()
let waiting = null // a session queued for "another player"
const id = () => randomBytes(12).toString('base64url')

// ---------- sessions: the lobby. One human browser, optionally one agent, many matches ----------
function newSession(name, setup) {
  const s = { name: String(name || 'you').slice(0, 24), setup: String(setup || 'no agent').slice(0, 40), agentToken: id(), humanToken: id(),
    doctrine: DEFAULT_DOCTRINE, agentSeen: 0, agentWaiting: 0, match: null, side: 0, history: [], queued: null, nextWaiters: [] }
  tokens.set(s.agentToken, { s, role: 'agent' }); tokens.set(s.humanToken, { s, role: 'human' })
  return s
}
const agentConnected = s => s.agentWaiting > 0 || Date.now() - s.agentSeen < AGENT_SEEN_MS
const lobbyUrl = s => `${ORIGIN}/?s=${s.humanToken}`
const live = s => s.match && !s.match.s.ended

function parsePlay(b) { // validated match request from the lobby (or a script)
  const vs = [...LEVELS, 'player'].includes(b.vs) ? b.vs : 'normal'
  return { vs, ...matchOptions(b), planning: PLANNING.includes(b.planning) ? b.planning : 20, withAgent: b.withAgent !== false, opening: Array.isArray(b.opening) ? b.opening : null }
}

function play(s, req, human = false) {
  if (live(s)) return { ok: false, error: 'already in a match' }
  if (req.opening) { const t = createMatch(1); const r = applyInput(t, 0, { gambits: req.opening }); if (!r.ok) return r }
  s.notice = null
  if (req.vs !== 'player') return startMatch([{ s, req }, null], req, human && req.withAgent), { ok: true }
  if (waiting && waiting.s !== s && waiting.s.queued) { const a = waiting; waiting = null; a.s.queued = null; startMatch([a, { s, req }], a.req); return { ok: true } }
  waiting = { s, req }; s.queued = Date.now()
  return { ok: true, queued: true }
}

// ---------- matches ----------
const foe = (m, side) => ({ name: m.players[1 - side].name, setup: m.players[1 - side].setup })
function startMatch(entries, req, waitingForAgent = false) { // entries[1] === null: the house plays side 1 with fixed gambits and no agent
  const delay = FORCED_DELAY ?? req.planning * 1000
  const m = { id: id(), s: createMatch(SEED ?? randomInt(2 ** 31), req), level: req.vs, players: [], log: [], streams: new Set(), waitingForAgent, createdAt: Date.now(), delay, startsAt: Date.now() + delay }
  entries.forEach((e, side) => {
    const p = { side, session: e?.s || null, name: e ? e.s.name : HOUSE_GAMBITS ? 'house' : `house (${req.vs} · ${HOUSE_DOCTRINE[req.vs]})`, setup: e ? (e.req.withAgent ? e.s.setup : 'no agent') : 'fixed gambits',
      withAgent: !!e?.req.withAgent, agentJoined: false, openingBy: e?.req.opening ? 'human' : 'agent', doctrine: e?.s.doctrine || '',
      events: [], seq: 0, waiters: [], sent: [], calls: [], feed: [], prev: null, edits: [] }
    m.players[side] = p
    const opening = e ? e.req.opening : HOUSE_GAMBITS ?? HOUSE[req.vs]
    if (opening) { const before = structuredClone(m.s.gambits[side]); applyInput(m.s, side, { gambits: opening }); m.log.push({ tick: 0, side, role: e ? 'human' : 'house', input: { gambits: opening } }); p.edits.push({ t: 0, who: e ? 'you' : 'house', why: 'opening gambits', change: changes(before, m.s.gambits[side]) }) }
    if (e) { e.s.match = m; e.s.side = side }
  })
  for (const p of m.players) emit(m, p.side, `match starts in ${Math.round(delay / 1000)}s. Your home planet is at (${Math.round(m.s.planets[p.side].x)},${Math.round(m.s.planets[p.side].y)}). You start with three battalions of 400 units. ${p.openingBy === 'human' ? 'Your human wrote the opening gambits.' : 'Write your opening gambits from the doctrine now.'}`)
  let waitingFrame = 0
  m.timer = setInterval(() => {
    if (m.waitingForAgent && Date.now() >= m.createdAt + 300000) return cancelMatch(m, 'Match cancelled: your agent did not join within 5 minutes.')
    if (m.waitingForAgent) { if (++waitingFrame % FRAME_EVERY === 0) for (const st of m.streams) send(st, m); return }
    if (Date.now() < m.startsAt) { if (++waitingFrame % FRAME_EVERY === 0) for (const st of m.streams) send(st, m); return }
    step(m.s)
    if (m.s.ended) return finish(m)
    if (m.s.tick % TPS === 0) for (const p of m.players) diffEvents(m, p)
    if (m.s.tick % FRAME_EVERY === 0) for (const st of m.streams) send(st, m)
  }, 1000 / TPS)
  for (const e of entries) e?.s.nextWaiters.splice(0).forEach(fn => fn()) // wake agents only once the match is complete
  return m
}

function cancelMatch(m, notice) {
  clearInterval(m.timer)
  for (const p of m.players) if (p.session?.match === m) { p.session.match = null; p.session.notice = notice }
  for (const st of m.streams) st.res.end()
}

const frame = (m, side) => {
  const p = m.players[side]
  return { matchId: m.id, side, view: view(m.s, side), report: m.report?.[side], calls: p.calls, feed: p.feed, edits: p.edits, waitingForAgent: !!m.waitingForAgent, startsIn: m.waitingForAgent ? null : Math.max(0, Math.ceil((m.startsAt - Date.now()) / 1000)),
    me: { name: p.name, withAgent: p.withAgent, agentJoined: p.agentJoined, setup: p.setup }, opponent: foe(m, side), options: m.s.opts }
}
const write = (st, data) => st.res.write(`data: ${JSON.stringify(data)}\n\n`)
const send = (st, m, force = false) => {
  st.res.write(`event: f\ndata: ${Buffer.from(encodeFrame(m.s, st.side, st.mirror)).toString('base64')}\n\n`)
  const { view: v, ...meta } = frame(m, st.side)
  meta.gambits = v.gambits; meta.board = board(m.s, st.side)
  const data = JSON.stringify(meta), now = Date.now(), key = boardKey(meta.board)
  if (force || key !== st.key || (data !== st.meta && now - st.metaAt >= 1000)) { write(st, { t: 'meta', ...meta }); st.meta = data; st.metaAt = now; st.key = key }
}

function finish(m) {
  if (m.report) return
  clearInterval(m.timer)
  for (const p of m.players) diffEvents(m, p)
  const [a, b] = m.players, w = m.s.ended.winner
  if (m.players.length === 2) {
    const ra = elo.get(a.name) ?? 1000, rb = elo.get(b.name) ?? 1000
    const exp = 1 / (1 + 10 ** ((rb - ra) / 400)), got = w === 0 ? 1 : w === 1 ? 0 : 0.5
    elo.set(a.name, Math.round(ra + 32 * (got - exp))); elo.set(b.name, Math.round(rb - 32 * (got - exp)))
  }
  m.report = m.players.map(p => { const v = view(m.s, p.side); return { result: v.ended.result, reason: v.ended.reason, you: v.totals.you, enemy: v.totals.enemy, planets: v.totals.planets } })
  for (const p of m.players) if (p.session) p.session.history = [{ ...m.report[p.side], reason: m.s.ended.reason, at: Math.round(m.s.tick / TPS), vs: foe(m, p.side).name, withAgent: p.withAgent }, ...p.session.history].slice(0, 10)
  for (const st of m.streams) send(st, m, true)
  setTimeout(() => { for (const p of m.players) if (p.session?.match === m) p.session.match = null }, FINISHED_TTL)
  console.error(JSON.stringify({ ...m.s.ended, at: m.s.tick / TPS, left: `${a.name} (${a.setup})`, right: `${foe(m, 0).name} (${foe(m, 0).setup})`, options: m.s.opts, inputs: m.log.length, report: m.report[0], ...(HOUSE_GAMBITS && { seed: m.s.seed, log: m.log }) }))
}

function emit(m, side, text) {
  const p = m.players[side]
  p.events.push({ seq: ++p.seq, t: Math.floor(m.s.tick / TPS), text })
  if (p.events.length > 200) p.events.shift()
  p.waiters.splice(0).forEach(fn => fn())
}
const feed = (m, side, who, text) => { const p = m.players[side]; p.feed = [...p.feed, { t: Math.floor(m.s.tick / TPS), who, text }].slice(-12) }

function diffEvents(m, p) { // once per second: turn state changes into things an agent should react to
  const v = view(m.s, p.side), was = p.prev
  p.prev = v
  if (v.ended) return emit(m, p.side, `match over: you ${v.ended.result} (${v.ended.reason}). Particles ${v.totals.you} vs ${v.totals.enemy}.`)
  if (!was) return
  for (const pl of v.planets) {
    const before = was.planets[pl.id].owner
    if (pl.owner !== before) emit(m, p.side, `planet ${pl.id} ${pl.owner === 'you' ? 'taken' : before === 'you' ? 'lost' : 'changed hands'}`)
  }
  for (const bat of was.battalions) if (!v.battalions.some(b => b.id === bat.id)) emit(m, p.side, `battalion ${bat.id} lost`)
  for (const bat of v.battalions) if (bat.fighting && !was.battalions.find(b => b.id === bat.id)?.fighting) emit(m, p.side, `battalion ${bat.id} fighting`)

}

function joinInfo(s) { // what the agent learns when it joins its session's match
  const m = s.match, p = m.players[s.side]
  p.agentJoined = true
  if (m.waitingForAgent) { m.waitingForAgent = false; m.startsAt = Date.now() + m.delay }
  return { id: m.id, side: s.side, opponent: `${foe(m, s.side).name} (${foe(m, s.side).setup})`, options: m.s.opts, doctrine: s.doctrine, openingBy: p.openingBy,
    startsIn: Math.max(0, Math.ceil((m.startsAt - Date.now()) / 1000)), state: view(m.s, s.side) }
}

// ---------- http ----------
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const body = req => new Promise((ok, ko) => { let d = ''; req.on('data', c => { d += c; if (d.length > 65536) req.destroy() }); req.on('end', () => { try { ok(d ? JSON.parse(d) : {}) } catch (e) { ko(e) } }) })
const auth = (q, role) => { const a = tokens.get(q.get('token')); if (a?.role === 'agent') a.s.agentSeen = Date.now(); return a && (!role || a.role === role) ? a : null }
const page = (file, vars = {}) => (req, res) => { res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(Object.entries(vars).reduce((t, [k, v]) => t.replaceAll(`{{${k}}}`, v), readFileSync(new URL(file, import.meta.url), 'utf8'))) }
const leaderboard = () => [...elo].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, rating]) => ({ name, rating }))

const routes = {
  'POST /session': async (req, res) => { // agent client or browser: a new lobby
    const b = await body(req), s = newSession(b.name, b.setup)
    if (b.setup) s.agentSeen = Date.now()
    json(res, 200, { agentToken: s.agentToken, humanToken: s.humanToken, lobby: lobbyUrl(s) })
  },
  'GET /lobby': (req, res, q) => {
    const a = auth(q, 'human'); if (!a) return json(res, 401, { error: 'unknown lobby (the server restarted?)' })
    const s = a.s
    json(res, 200, { name: s.name, agent: agentConnected(s) ? s.setup : null, doctrine: s.doctrine, history: s.history, inMatch: !!s.match, live: live(s), queued: !!s.queued, notice: s.notice,
      leaderboard: leaderboard(), choices: { vs: [...LEVELS, 'player'], ...OPTIONS, planning: PLANNING }, doctrineMax: DOCTRINE_MAX })
  },
  'POST /profile': async (req, res, q) => { // human: name and doctrine
    const a = auth(q, 'human'); if (!a) return json(res, 401, { error: 'bad token' })
    const b = await body(req), s = a.s
    if (typeof b.name === 'string' && b.name.trim()) s.name = b.name.trim().slice(0, 24)
    if (typeof b.doctrine === 'string') {
      s.doctrine = b.doctrine.trim().slice(0, DOCTRINE_MAX)
      if (live(s) && s.match.players[s.side].withAgent) { emit(s.match, s.side, `HUMAN changed the doctrine: ${s.doctrine}`); feed(s.match, s.side, 'you', 'changed the doctrine') }
    }
    json(res, 200, { ok: true })
  },
  'POST /play': async (req, res, q) => { // human (or a headless script with its agent token): start a match or queue
    const a = auth(q); if (!a) return json(res, 401, { error: 'bad token' })
    const b = await body(req), r = play(a.s, parsePlay(b), a.role === 'human' && b.withAgent === true)
    json(res, r.ok ? 200 : 400, r)
  },
  'POST /cancel': (req, res, q) => {
    const a = auth(q, 'human'); if (!a) return json(res, 401, { error: 'bad token' })
    if (waiting?.s === a.s) waiting = null
    a.s.queued = null
    if (a.s.match?.waitingForAgent) cancelMatch(a.s.match, 'Match cancelled.')
    json(res, 200, { ok: true })
  },
  'POST /start-without-agent': (req, res, q) => {
    const a = auth(q, 'human'), m = a?.s.match
    if (!a) return json(res, 401, { error: 'bad token' })
    if (!m?.waitingForAgent) return json(res, 409, { error: 'Match is not waiting for an agent.' })
    m.waitingForAgent = false; m.startsAt = Date.now() + m.delay; m.players[a.s.side].withAgent = false; m.players[a.s.side].setup = 'no agent'
    json(res, 200, { ok: true })
  },
  'GET /next': (req, res, q) => { // agent: long-poll until its human starts a match
    const a = auth(q, 'agent'); if (!a) return json(res, 401, { error: 'unknown session (the server restarted?)' })
    const s = a.s, ready = () => live(s) && s.match.players[s.side].withAgent && !s.match.players[s.side].agentJoined
    const reply = () => { s.agentWaiting--; s.agentSeen = Date.now(); json(res, 200, ready() ? { match: joinInfo(s) } : { match: null, lobby: lobbyUrl(s) }) }
    s.agentWaiting++
    if (ready()) return reply()
    const t = setTimeout(() => { s.nextWaiters = s.nextWaiters.filter(f => f !== fn); reply() }, Math.min(55, Number(q.get('timeout') || 30)) * 1000)
    const fn = () => { clearTimeout(t); reply() }
    s.nextWaiters.push(fn)
  },
  'GET /rules': (req, res) => json(res, 200, { map: { W, H }, maxGambits: MAX_GAMBITS, ...rules() }),
  'GET /state': (req, res, q) => {
    const a = auth(q); if (!a?.s.match) return json(res, a ? 409 : 401, { error: a ? 'not in a match' : 'bad token' })
    json(res, 200, frame(a.s.match, a.s.side))
  },
  'GET /events': (req, res, q) => { // agent: long-poll for events after `since`
    const a = auth(q, 'agent'); if (!a) return json(res, 401, { error: 'bad token' })
    const s = a.s, m = s.match
    if (!m) return json(res, 200, { events: [], state: null, next: 'join' })
    if (!m.players[s.side].agentJoined) return json(res, 200, { events: [], state: null, next: m.players[s.side].withAgent ? 'join' : 'solo' })
    if (q.has('matchId') && q.get('matchId') !== m.id) return json(res, 409, { error: 'match is no longer active' })
    const p = m.players[s.side], since = Number(q.get('since') || 0)
    const reply = () => json(res, 200, { matchId: m.id, events: p.events.filter(e => e.seq > since), state: view(m.s, s.side), startsIn: Math.max(0, Math.ceil((m.startsAt - Date.now()) / 1000)) })
    if (p.events.some(e => e.seq > since) || m.s.ended) return reply()
    const t = setTimeout(() => { p.waiters = p.waiters.filter(f => f !== fn); reply() }, Math.min(25, Number(q.get('timeout') || 10)) * 1000)
    const fn = () => { clearTimeout(t); reply() }
    p.waiters.push(fn)
  },
  'POST /surrender': async (req, res, q) => {
    const a = auth(q, 'human'); if (!a) return json(res, 401, { error: 'bad token' })
    const m = a.s.match, b = await body(req)
    if (!m || a.s.match !== m || b.matchId !== undefined && b.matchId !== m.id || m.s.ended) return json(res, 409, { error: 'match is no longer active' })
    const input = { surrender: true }, side = a.s.side
    applyInput(m.s, side, input)
    m.log.push({ tick: m.s.tick, side, role: 'human', input })
    finish(m)
    json(res, 200, { ok: true })
  },
  'POST /input': async (req, res, q) => { // agent or human: gambits, toggle, order, split, release
    const a = auth(q); if (!a) return json(res, 401, { error: 'bad token' })
    const m = a.s.match, side = a.s.side; if (!m) return json(res, 409, { error: 'not in a match' })
    const b = await body(req), p = m.players[side], now = Date.now()
    if (a.s.match !== m || b.matchId !== undefined && b.matchId !== m.id || m.s.ended) return json(res, 409, { error: 'match is no longer active' })
    if (a.role === 'agent' && ['order', 'flank', 'detach', 'release'].some(k => Object.hasOwn(b, k))) return json(res, 403, { error: 'Hand orders are for your human. Ask with call_human.' })
    if (a.role === 'agent') {
      if (!p.withAgent) return json(res, 403, { error: 'your human is playing this match alone' })
      p.sent = p.sent.filter(x => now - x < 1000)
      if (p.sent.length >= RATE) return json(res, 429, { error: `max ${RATE} inputs per second` })
      p.sent.push(now)
    }
    const input = Object.fromEntries(['gambits', 'toggle', 'order', 'flank', 'detach', 'release'].filter(k => Object.hasOwn(b, k)).map(k => [k, b[k]]))
    if ((m.waitingForAgent || now < m.startsAt) && Object.keys(input).some(k => k !== 'gambits' && k !== 'toggle')) return json(res, 409, { error: 'match not started: only gambits and toggle can change now' })
    const before = structuredClone(m.s.gambits[side]), r = applyInput(m.s, side, input)
    if (r.ok) {
      m.log.push({ tick: m.s.tick, side, role: a.role, input })
      const why = typeof b.why === 'string' ? b.why.trim().slice(0, 120) : '', t = Math.floor(m.s.tick / TPS), change = changes(before, m.s.gambits[side]), doctrine = Object.hasOwn(input, 'gambits') || Object.hasOwn(input, 'toggle')
      if (doctrine) { p.edits.push({ t, who: a.role === 'agent' ? 'agent' : 'you', why, change }); p.edits = p.edits.slice(-10) }
      const action = b.gambits ? 'rewrote the gambits' : b.toggle !== undefined ? `switched gambit ${b.toggle + 1}` : b.order ? `ordered battalion ${b.order.bat}` : b.detach ? `detached battalion ${b.detach.bat}` : b.flank !== undefined ? `flanked battalion ${b.flank}` : `released battalion ${b.release}`
      feed(m, side, a.role === 'agent' ? 'agent' : 'you', `${a.role === 'agent' && doctrine ? change : action}${why ? `: ${why}` : ''}`)
      if (a.role === 'human') { if (b.order) p.calls = p.calls.filter(c => c.bat !== b.order.bat); emit(m, side, `HUMAN ${doctrine ? (b.toggle !== undefined ? `switched ${change}` : `rewrote gambits: ${change}`) : action}`) }
    }
    json(res, r.ok ? 200 : 400, r)
  },
  'POST /call': async (req, res, q) => { // agent asks its human to take a battalion somewhere by hand
    const a = auth(q, 'agent'); if (!a?.s.match) return json(res, a ? 409 : 401, { error: a ? 'not in a match' : 'bad token' })
    const m = a.s.match, b = await body(req)
    if (a.s.match !== m || b.matchId !== undefined && b.matchId !== m.id || m.s.ended) return json(res, 409, { error: 'match is no longer active' })
    const p = m.players[a.s.side]
    const call = { bat: Number.isFinite(b.bat) ? b.bat : null, x: Number.isFinite(b.x) ? Math.round(b.x) : null, y: Number.isFinite(b.y) ? Math.round(b.y) : null, message: String(b.message || '').slice(0, 140), t: Math.floor(m.s.tick / TPS) }
    p.calls = [...p.calls.filter(c => call.bat === null || c.bat !== call.bat), call].slice(-3)
    feed(m, a.s.side, 'agent', `asks you: ${call.message}`)
    json(res, 200, { ok: true })
  },
  'POST /dismiss': async (req, res, q) => {
    const a = auth(q, 'human'); if (!a?.s.match) return json(res, 409, { error: 'not in a match' })
    const m = a.s.match, b = await body(req)
    if (a.s.match !== m || b.matchId !== undefined && b.matchId !== m.id || m.s.ended) return json(res, 409, { error: 'match is no longer active' })
    const p = m.players[a.s.side]
    p.calls = p.calls.filter((c, i) => i !== b.index)
    json(res, 200, { ok: true })
  },
  'POST /say': async (req, res, q) => { // human message or ping to their agent
    const a = auth(q, 'human'); if (!a?.s.match) return json(res, 409, { error: 'not in a match' })
    const m = a.s.match, b = await body(req)
    if (a.s.match !== m || b.matchId !== undefined && b.matchId !== m.id || m.s.ended) return json(res, 409, { error: 'match is no longer active' })
    const text = String(b.text || 'look here').slice(0, 140), at = Number.isFinite(b.x) ? ` at (${Math.round(b.x)},${Math.round(b.y)})` : ''
    emit(m, a.s.side, `HUMAN: ${text}${at}`); feed(m, a.s.side, 'you', `${text}${at}`)
    json(res, 200, { ok: true })
  },
  'GET /stream': (req, res, q) => { // human browser: frames of the session's current match
    const a = auth(q, 'human'); if (!a?.s.match) return json(res, 409, { error: 'not in a match' })
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const m = a.s.match, st = { res, side: a.s.side, mirror: createMirror(), meta: null, metaAt: 0, key: null }
    send(st, m, true)
    m.streams.add(st); req.on('close', () => m.streams.delete(st))
  },
  'GET /leaderboard': (req, res) => json(res, 200, leaderboard()),
  'GET /': page('index.html'),
  'GET /sim.js': page('sim.js'),
  'GET /wire.js': page('wire.js'),
  'GET /browser-live.js': page('browser-live.js'),
  'GET /guide': page('guide.html'),
  'GET /privacy': page('privacy.html'),
  'GET /privacy.html': page('privacy.html'),
  'GET /terms': page('terms.html'),
  'GET /terms.html': page('terms.html'),
}

// Local server on the player's machine: loopback only, and only pages served from itself may call it (no LAN peers, no DNS rebinding, no other web pages).
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, new URL(ORIGIN).host])
const srv = http.createServer(async (req, res) => {
  if (!HOSTS.has(req.headers.host) || (req.headers.origin && !HOSTS.has(req.headers.origin.replace(/^https?:\/\//, '')))) return json(res, 403, { error: 'forbidden host or origin' })
  try {
    const u = new URL(req.url, ORIGIN), route = routes[`${req.method} ${u.pathname}`]
    if (!route) { if (servePublicMedia(req, res, u.pathname)) return; return json(res, 404, { error: 'not found' }) }
    await route(req, res, u.searchParams)
  } catch (e) { console.error(e); if (res.headersSent) res.end(); else json(res, 400, { error: String(e.message || e) }) }
}).listen(PORT, process.env.BOTTERS_HOST || '127.0.0.1', () => console.error(`botters server on ${ORIGIN}`))
export const listening = new Promise((ok, ko) => srv.once('listening', ok).once('error', ko)) // importers handle EADDRINUSE
if (process.env.BOTTERS_IDLE_EXIT) { // started by an agent: exit after ~90 s with no agent, no live match and no open game page
  let idle = 0
  setInterval(() => {
    const busy = [...tokens.values()].some(a => agentConnected(a.s) || live(a.s) || a.s.match?.streams.size)
    idle = busy ? 0 : idle + 1
    if (idle >= 3) process.exit(0)
  }, Number(process.env.BOTTERS_IDLE_MS || 30000)).unref()
} // stderr: stdout belongs to MCP when client.js embeds the server
