// Game server: lobby sessions (one human + optionally one agent), matches vs the house or another player,
// 20 Hz match loop, agent API, browser stream, what-if report, Elo.
// ponytail: all state in memory, one process. Port to Vercel + Convex once the game is fun.
import http from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { randomBytes, randomInt } from 'node:crypto'
import { createMatch, applyInput, step, view, rules, replay, totals, describe, matchOptions, OPTIONS, HOUSE, TPS, W, H, MAX_GAMBITS } from './sim.js'

const PORT = Number(process.env.PORT || 8787)
const ORIGIN = process.env.BOTTERS_ORIGIN || `http://localhost:${PORT}`
const RATE = 5, FINISHED_TTL = 10 * 60 * 1000, FRAME_EVERY = 2, DOCTRINE_MAX = 500, AGENT_SEEN_MS = 90000
const PLANNING = [10, 20, 30] // seconds before the match starts: time for the agent to write opening gambits
const FORCED_DELAY = process.env.BOTTERS_START_DELAY && Number(process.env.BOTTERS_START_DELAY) // ms, tests only
const DOCTRINE_FILE = new URL('DOCTRINE.md', import.meta.url)
const DEFAULT_DOCTRINE = (existsSync(DOCTRINE_FILE) ? readFileSync(DOCTRINE_FILE, 'utf8') : 'Grab free planets fast, fight only when bigger, protect what we own.').trim().slice(0, DOCTRINE_MAX)
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

function play(s, req) {
  if (live(s)) return { ok: false, error: 'already in a match' }
  if (req.opening) { const t = createMatch(1); const r = applyInput(t, 0, { gambits: req.opening }); if (!r.ok) return r }
  if (req.vs !== 'player') return startMatch([{ s, req }, null], req), { ok: true }
  if (waiting && waiting.s !== s && waiting.s.queued) { const a = waiting; waiting = null; a.s.queued = null; startMatch([a, { s, req }], a.req); return { ok: true } }
  waiting = { s, req }; s.queued = Date.now()
  return { ok: true, queued: true }
}

// ---------- matches ----------
function startMatch(entries, req) { // entries[1] === null: the house plays side 1 with fixed gambits and no agent
  const delay = FORCED_DELAY ?? req.planning * 1000
  const m = { id: id(), s: createMatch(randomInt(2 ** 31), req), level: req.vs, players: [], log: [], streams: new Set(), startsAt: Date.now() + delay }
  entries.forEach((e, side) => {
    const p = { side, session: e?.s || null, name: e ? e.s.name : `house (${req.vs})`, setup: e ? (e.req.withAgent ? e.s.setup : 'no agent') : 'fixed gambits',
      withAgent: !!e?.req.withAgent, agentJoined: false, openingBy: e?.req.opening ? 'human' : 'agent', doctrine: e?.s.doctrine || '',
      events: [], seq: 0, waiters: [], sent: [], calls: [], feed: [], prev: null, gambitsBy: { who: e ? 'default' : 'house', t: 0, why: '' } }
    m.players[side] = p
    const opening = e ? e.req.opening : HOUSE[req.vs]
    if (opening) { applyInput(m.s, side, { gambits: opening }); m.log.push({ tick: 0, side, role: e ? 'human' : 'house', input: { gambits: opening } }); if (e) p.gambitsBy = { who: 'you', t: 0, why: 'your opening gambits' } }
    if (e) { e.s.match = m; e.s.side = side }
  })
  for (const p of m.players) emit(m, p.side, `match starts in ${Math.round(delay / 1000)}s. Your home planet is on the ${p.side ? 'right' : 'left'}. ${p.openingBy === 'human' ? 'Your human wrote the opening gambits: keep them unless the situation demands a change.' : 'Write your opening gambits from the doctrine now.'}`)
  const timer = setInterval(() => {
    if (Date.now() < m.startsAt) { for (const st of m.streams) send(st, m); return }
    step(m.s)
    if (m.s.tick % TPS === 0 || m.s.ended) for (const p of m.players) diffEvents(m, p)
    if (m.s.ended) { clearInterval(timer); finish(m) } // before the last frame: it carries the report
    if (m.s.tick % FRAME_EVERY === 0 || m.s.ended) for (const st of m.streams) send(st, m)
  }, 1000 / TPS)
  for (const e of entries) e?.s.nextWaiters.splice(0).forEach(fn => fn()) // wake agents only once the match is complete
  return m
}

const frame = (m, side) => {
  const p = m.players[side]
  return { view: view(m.s, side), report: m.report?.[side], calls: p.calls, feed: p.feed, gambitsBy: p.gambitsBy, startsIn: Math.max(0, Math.ceil((m.startsAt - Date.now()) / 1000)),
    me: { name: p.name, withAgent: p.withAgent, agentJoined: p.agentJoined, setup: p.setup }, opponent: { name: m.players[1 - side].name, setup: m.players[1 - side].setup }, options: m.s.opts }
}
const send = (st, m) => st.res.write(`data: ${JSON.stringify(frame(m, st.side))}\n\n`)

function finish(m) {
  const [a, b] = m.players, w = m.s.ended.winner
  const ra = elo.get(a.name) ?? 1000, rb = elo.get(b.name) ?? 1000
  const exp = 1 / (1 + 10 ** ((rb - ra) / 400)), got = w === 0 ? 1 : w === 1 ? 0 : 0.5
  elo.set(a.name, Math.round(ra + 32 * (got - exp))); elo.set(b.name, Math.round(rb - 32 * (got - exp)))
  m.report = m.players.map(p => p.session && whatIf(m, p))
  for (const p of m.players) if (p.session) p.session.history = [{ ...m.report[p.side], reason: m.s.ended.reason, at: Math.round(m.s.tick / TPS), vs: m.players[1 - p.side].name, withAgent: p.withAgent }, ...p.session.history].slice(0, 10)
  setTimeout(() => { for (const p of m.players) if (p.session?.match === m) p.session.match = null }, FINISHED_TTL)
  console.error(JSON.stringify({ ...m.s.ended, at: m.s.tick / TPS, left: `${a.name} (${a.setup})`, right: `${b.name} (${b.setup})`, options: m.s.opts, inputs: m.log.length, report: m.report[0] }))
}

// Who won it? Replay the match without this side's human inputs, then without its agent's. Same seed, same opponent inputs.
// ponytail: honest but partial — in the replay the agent repeats its orders blindly instead of reacting to the new situation.
// ponytail: synchronous replays (~0.5 s each) at match end block the server loop; move to a worker if matches overlap.
function whatIf(m, p) {
  const side = p.side
  const res = s => { const t = totals(s), w = s.ended.winner; return { result: w === side ? 'won' : w === null ? 'draw' : 'lost', you: t[side], enemy: t[1 - side] } }
  const without = role => res(replay(m.s.seed, m.log.filter(l => l.side !== side || l.role !== role), m.s.opts))
  const count = role => m.log.filter(l => l.side === side && l.role === role).length
  return { actual: res(m.s), humanInputs: count('human'), agentInputs: count('agent'), withoutHuman: without('human'), withoutAgent: p.withAgent ? without('agent') : null }
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
  for (const e of v.enemies) if (e.n >= 1500 && !was.enemies.some(o => o.id === e.id)) emit(m, p.side, `enemy swarm ${e.id} (${e.n}) spotted at (${e.x},${e.y})`)
  for (const pl of v.planets) {
    const before = was.planets[pl.id].owner
    if (pl.owner === before || pl.massLeft <= 0) continue
    emit(m, p.side, pl.owner === 'you' ? `you captured planet ${pl.id} (${pl.x},${pl.y})` : pl.owner === 'enemy' ? `ENEMY captured planet ${pl.id} at (${pl.x},${pl.y})` : `planet ${pl.id} at (${pl.x},${pl.y}) is neutral again (was ${before === 'you' ? 'yours' : 'enemy'})`)
  }
  for (const c of was.swarms) if (c.n >= 500 && !v.swarms.some(o => o.id === c.id) && c.fighting) emit(m, p.side, `your swarm ${c.id} (${c.n}) was destroyed near (${c.x},${c.y})`)
  const behind = v.totals.you < v.totals.enemy
  if (behind !== was.totals.you < was.totals.enemy) emit(m, p.side, behind ? `you fell behind: ${v.totals.you} vs ${v.totals.enemy} particles` : `you took the lead: ${v.totals.you} vs ${v.totals.enemy} particles`)
  if (v.secondsLeft === 60) emit(m, p.side, `1 minute left. Particles ${v.totals.you} vs ${v.totals.enemy}.`)
}

function joinInfo(s) { // what the agent learns when it joins its session's match
  const m = s.match, p = m.players[s.side]
  p.agentJoined = true
  return { side: s.side, opponent: `${m.players[1 - s.side].name} (${m.players[1 - s.side].setup})`, options: m.s.opts, doctrine: s.doctrine, openingBy: p.openingBy,
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
    json(res, 200, { name: s.name, agent: agentConnected(s) ? s.setup : null, doctrine: s.doctrine, history: s.history, inMatch: !!s.match, live: live(s), queued: !!s.queued,
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
    const r = play(a.s, parsePlay(await body(req)))
    json(res, r.ok ? 200 : 400, r)
  },
  'POST /cancel': (req, res, q) => {
    const a = auth(q); if (!a) return json(res, 401, { error: 'bad token' })
    if (waiting?.s === a.s) waiting = null
    a.s.queued = null
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
    const p = m.players[s.side], since = Number(q.get('since') || 0)
    const reply = () => json(res, 200, { events: p.events.filter(e => e.seq > since), state: view(m.s, s.side), startsIn: Math.max(0, Math.ceil((m.startsAt - Date.now()) / 1000)) })
    if (p.events.some(e => e.seq > since) || m.s.ended) return reply()
    const t = setTimeout(() => { p.waiters = p.waiters.filter(f => f !== fn); reply() }, Math.min(25, Number(q.get('timeout') || 10)) * 1000)
    const fn = () => { clearTimeout(t); reply() }
    p.waiters.push(fn)
  },
  'POST /input': async (req, res, q) => { // agent or human: gambits, toggle, order, split, release
    const a = auth(q); if (!a) return json(res, 401, { error: 'bad token' })
    const m = a.s.match, side = a.s.side; if (!m) return json(res, 409, { error: 'not in a match' })
    const b = await body(req), p = m.players[side], now = Date.now()
    if (a.role === 'agent') {
      if (!p.withAgent) return json(res, 403, { error: 'your human is playing this match alone' })
      p.sent = p.sent.filter(x => now - x < 1000)
      if (p.sent.length >= RATE) return json(res, 429, { error: `max ${RATE} inputs per second` })
      p.sent.push(now)
    }
    const input = { gambits: b.gambits, toggle: b.toggle, order: b.order, split: b.split, release: b.release }
    if (now < m.startsAt && (input.order || input.split !== undefined || input.release !== undefined)) return json(res, 409, { error: 'match not started: only gambits can change now' })
    const r = applyInput(m.s, side, input)
    if (r.ok) {
      m.log.push({ tick: m.s.tick, side, role: a.role, input })
      const why = b.why ? String(b.why).slice(0, 120) : '', t = Math.floor(m.s.tick / TPS), list = m.s.gambits[side]
      if (b.gambits) p.gambitsBy = { who: a.role === 'agent' ? 'agent' : 'you', t, why }
      if (b.toggle !== undefined) p.gambitsBy = { who: a.role === 'agent' ? 'agent' : 'you', t, why: `switched rule ${b.toggle + 1} ${list[b.toggle].on ? 'on' : 'off'}` }
      if (a.role === 'agent') {
        if (b.gambits) feed(m, side, 'agent', `rewrote the gambits${why && `: ${why}`}`)
        if (b.order) feed(m, side, 'agent', `took swarm ${b.order.swarm} to (${Math.round(b.order.x)},${Math.round(b.order.y)})${why && `: ${why}`}`)
        if (b.split !== undefined) feed(m, side, 'agent', `split swarm ${b.split}${why && `: ${why}`}`)
        if (b.release !== undefined) feed(m, side, 'agent', `gave swarm ${b.release} back to the gambits`)
      } else {
        if (b.gambits) { emit(m, side, `HUMAN rewrote the gambits:\n${list.map((r, i) => `${i + 1}. ${describe(r)}`).join('\n')}`); feed(m, side, 'you', 'rewrote the gambits') }
        if (b.toggle !== undefined) emit(m, side, `HUMAN switched gambit ${b.toggle + 1} ${list[b.toggle].on ? 'ON' : 'OFF'}: ${describe(list[b.toggle])}`)
        if (b.order) { p.calls = p.calls.filter(c => c.swarm !== b.order.swarm); emit(m, side, `HUMAN took swarm ${b.order.swarm} by hand to (${Math.round(b.order.x)},${Math.round(b.order.y)})`) }
        if (b.split !== undefined) emit(m, side, `HUMAN split swarm ${b.split}`)
        if (b.release !== undefined) emit(m, side, `HUMAN gave swarm ${b.release} back to the gambits`)
      }
    }
    json(res, r.ok ? 200 : 400, r)
  },
  'POST /call': async (req, res, q) => { // agent asks its human to take a swarm somewhere by hand
    const a = auth(q, 'agent'); if (!a?.s.match) return json(res, a ? 409 : 401, { error: a ? 'not in a match' : 'bad token' })
    const m = a.s.match, b = await body(req), p = m.players[a.s.side]
    const call = { swarm: Number.isFinite(b.swarm) ? b.swarm : null, x: Number.isFinite(b.x) ? Math.round(b.x) : null, y: Number.isFinite(b.y) ? Math.round(b.y) : null, message: String(b.message || '').slice(0, 140), t: Math.floor(m.s.tick / TPS) }
    p.calls = [...p.calls.filter(c => call.swarm === null || c.swarm !== call.swarm), call].slice(-3)
    feed(m, a.s.side, 'agent', `asks you: ${call.message}`)
    json(res, 200, { ok: true })
  },
  'POST /dismiss': async (req, res, q) => {
    const a = auth(q, 'human'); if (!a?.s.match) return json(res, 409, { error: 'not in a match' })
    const b = await body(req), p = a.s.match.players[a.s.side]
    p.calls = p.calls.filter((c, i) => i !== b.index)
    json(res, 200, { ok: true })
  },
  'POST /say': async (req, res, q) => { // human message or ping to their agent
    const a = auth(q, 'human'); if (!a?.s.match) return json(res, 409, { error: 'not in a match' })
    const b = await body(req), m = a.s.match, text = String(b.text || 'look here').slice(0, 140), at = Number.isFinite(b.x) ? ` at (${Math.round(b.x)},${Math.round(b.y)})` : ''
    emit(m, a.s.side, `HUMAN: ${text}${at}`); feed(m, a.s.side, 'you', `${text}${at}`)
    json(res, 200, { ok: true })
  },
  'GET /stream': (req, res, q) => { // human browser: frames of the session's current match
    const a = auth(q, 'human'); if (!a?.s.match) return json(res, 409, { error: 'not in a match' })
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const st = { res, side: a.s.side }, m = a.s.match
    send(st, m)
    m.streams.add(st); req.on('close', () => m.streams.delete(st))
  },
  'GET /leaderboard': (req, res) => json(res, 200, leaderboard()),
  'GET /': page('index.html'),
  'GET /sim.js': page('sim.js'),
  'GET /guide': page('guide.html'),
}

// Local server on the player's machine: loopback only, and only pages served from itself may call it (no LAN peers, no DNS rebinding, no other web pages).
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, new URL(ORIGIN).host])
const srv = http.createServer(async (req, res) => {
  if (!HOSTS.has(req.headers.host) || (req.headers.origin && !HOSTS.has(req.headers.origin.replace(/^https?:\/\//, '')))) return json(res, 403, { error: 'forbidden host or origin' })
  try {
    const u = new URL(req.url, ORIGIN), route = routes[`${req.method} ${u.pathname}`]
    if (!route) return json(res, 404, { error: 'not found' })
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
