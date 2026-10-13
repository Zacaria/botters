// Spike game server: matchmaking queue, 10 Hz match loop, player API, browser stream, Elo.
// ponytail: all state in memory, one process. Port to Vercel + Convex once the game is fun.
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { randomBytes, randomInt } from 'node:crypto'
import { createMatch, applyInput, step, view, mapInfo, TPS } from './sim.js'

const PORT = Number(process.env.PORT || 8787)
const ORIGIN = process.env.BOTTERS_ORIGIN || `http://localhost:${PORT}`
const RATE = 5, START_DELAY = 3000, FINISHED_TTL = 10 * 60 * 1000
const tickets = new Map(), matches = new Map(), tokens = new Map(), elo = new Map()
let waiting = null
const id = () => randomBytes(12).toString('base64url')

function startMatch(a, b) {
  const m = { id: id(), s: createMatch(randomInt(2 ** 31)), players: {}, log: [], streams: new Set(), startsAt: Date.now() + START_DELAY }
  for (const [side, t] of [['blue', a], ['red', b]]) {
    const p = { side, name: t.name, setup: t.setup, agent: id(), human: id(), events: [], seq: 0, waiters: [], sent: [], calls: [], pilotMs: null, prev: null }
    m.players[side] = p
    tokens.set(p.agent, { m, side, role: 'agent' }); tokens.set(p.human, { m, side, role: 'human' })
    t.match = { matchId: m.id, side, token: p.agent, watch: `${ORIGIN}/?m=${m.id}&t=${p.human}`, opponent: { name: b === t ? a.name : b.name, setup: b === t ? a.setup : b.setup } }
  }
  matches.set(m.id, m)
  for (const side of ['blue', 'red']) emit(m, side, `match starts in ${START_DELAY / 1000}s. You are ${side}.`)
  const timer = setInterval(() => {
    if (Date.now() < m.startsAt) return
    step(m.s)
    for (const side of ['blue', 'red']) diffEvents(m, side)
    const frame = side => `data: ${JSON.stringify({ view: view(m.s, side), calls: m.players[side].calls, opponent: m.players[side === 'blue' ? 'red' : 'blue'].pilotMs })}\n\n`
    for (const st of m.streams) st.res.write(frame(st.side))
    if (m.s.ended) { clearInterval(timer); finish(m); setTimeout(() => matches.delete(m.id), FINISHED_TTL) }
  }, 1000 / TPS)
}

function finish(m) {
  const [b, r] = [m.players.blue, m.players.red], w = m.s.ended.winner
  const rb = elo.get(b.name) ?? 1000, rr = elo.get(r.name) ?? 1000
  const exp = 1 / (1 + 10 ** ((rr - rb) / 400)), got = w === 'blue' ? 1 : w === 'red' ? 0 : 0.5
  elo.set(b.name, Math.round(rb + 32 * (got - exp))); elo.set(r.name, Math.round(rr - 32 * (got - exp)))
  console.log(JSON.stringify({ match: m.id, ...m.s.ended, blue: `${b.name} (${b.setup})`, red: `${r.name} (${r.setup})`, score: m.s.score, inputs: m.log.length }))
}

function emit(m, side, text) {
  const p = m.players[side]
  p.events.push({ seq: ++p.seq, t: Math.floor(m.s.tick / TPS), text })
  if (p.events.length > 200) p.events.shift()
  p.waiters.splice(0).forEach(fn => fn())
}

function diffEvents(m, side) { // turn state changes into things an agent should react to
  const p = m.players[side], v = view(m.s, side), was = p.prev
  p.prev = { v, lastSeen: was?.lastSeen ?? {} }
  const lastSeen = p.prev.lastSeen
  for (const e of v.enemies) {
    if (!(e.id in lastSeen) || v.tick - lastSeen[e.id] > 5 * TPS) emit(m, side, `enemy ${e.type} ${e.id} spotted at (${e.x},${e.y})`)
    lastSeen[e.id] = v.tick
  }
  if (!was) return
  for (const [k, pt] of Object.entries(v.points)) if (pt.owner !== was.v.points[k].owner)
    emit(m, side, pt.owner ? `${pt.owner === 'you' ? 'you' : 'enemy'} captured ${k}` : `${k} is neutral again`)
  for (const u of was.v.units) if (!v.units.some(x => x.id === u.id)) emit(m, side, `your ${u.type} ${u.id} died at (${u.x},${u.y})`)
  for (const e of was.v.enemies) if (!v.enemies.some(x => x.id === e.id) && !m.s.units.some(x => x.id === e.id)) emit(m, side, `enemy ${e.type} ${e.id} killed`)
  for (const k of v.strikes) if (k.by === 'enemy' && !was.v.strikes.some(o => o.x === k.x && o.y === k.y)) emit(m, side, `ENEMY STRIKE landing at (${k.x},${k.y}) in ${k.inSeconds}s, move out`)
  if (v.ended) emit(m, side, `match over: ${v.ended.winner === side ? 'you WON' : v.ended.winner ? 'you lost' : 'draw'} (${v.ended.reason}) ${v.score.you}-${v.score.enemy}`)
}

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const body = req => new Promise((ok, ko) => { let d = ''; req.on('data', c => { d += c; if (d.length > 65536) req.destroy() }); req.on('end', () => { try { ok(d ? JSON.parse(d) : {}) } catch (e) { ko(e) } }) })
const auth = (q, role) => { const a = tokens.get(q); return a && (!role || a.role === role) ? a : null }

const routes = {
  'POST /join': async (req, res) => {
    const b = await body(req)
    const t = { id: id(), name: String(b.name || 'anon').slice(0, 24), setup: String(b.setup || '?').slice(0, 40), match: null }
    tickets.set(t.id, t)
    if (waiting && tickets.has(waiting.id) && waiting.name !== t.name) { const a = waiting; waiting = null; startMatch(a, t) } else waiting = t
    json(res, 200, { ticket: t.id, match: t.match })
  },
  'GET /ticket': (req, res, q) => { // long-poll until matched (≤20 s)
    const t = tickets.get(q.get('id'))
    if (!t) return json(res, 404, { error: 'unknown ticket' })
    const until = Date.now() + 20000
    const poll = () => t.match || Date.now() > until ? json(res, 200, { match: t.match }) : setTimeout(poll, 250)
    poll()
  },
  'GET /state': (req, res, q) => {
    const a = auth(q.get('token')); if (!a) return json(res, 401, { error: 'bad token' })
    const p = a.m.players[a.side]
    json(res, 200, { ...view(a.m.s, a.side), startsIn: Math.max(0, (a.m.startsAt - Date.now()) / 1000), calls: p.calls, map: q.get('map') ? mapInfo(a.m.s) : undefined })
  },
  'GET /events': (req, res, q) => { // long-poll for events after `since` (≤ timeout s)
    const a = auth(q.get('token')); if (!a) return json(res, 401, { error: 'bad token' })
    const p = a.m.players[a.side], since = Number(q.get('since') || 0)
    const reply = () => json(res, 200, { events: p.events.filter(e => e.seq > since), state: view(a.m.s, a.side) })
    if (p.events.some(e => e.seq > since) || a.m.s.ended) return reply()
    const t = setTimeout(() => { p.waiters = p.waiters.filter(f => f !== fn); reply() }, Math.min(25, Number(q.get('timeout') || 10)) * 1000)
    const fn = () => { clearTimeout(t); reply() }
    p.waiters.push(fn)
  },
  'POST /input': async (req, res, q) => {
    const a = auth(q.get('token')); if (!a) return json(res, 401, { error: 'bad token' })
    const b = await body(req), p = a.m.players[a.side], now = Date.now()
    if (now < a.m.startsAt) return json(res, 409, { error: 'match not started' })
    if (a.role === 'agent') {
      if (b.ability) return json(res, 403, { error: 'abilities are human-only: use call_human' })
      p.sent = p.sent.filter(x => now - x < 1000)
      if (p.sent.length >= RATE) return json(res, 429, { error: `max ${RATE} inputs per second` })
      p.sent.push(now)
      if (Number.isFinite(b.pilotMs)) p.pilotMs = { ms: Math.round(b.pilotMs), setup: p.setup }
    }
    const input = { orders: b.orders, buy: b.buy, ability: b.ability, x: b.x, y: b.y }
    const r = applyInput(a.m.s, a.side, input)
    if (r.ok) a.m.log.push({ tick: a.m.s.tick, side: a.side, input })
    if (r.ok && b.ability) p.calls = p.calls.filter(c => c.ability !== b.ability)
    json(res, r.ok ? 200 : 400, r)
  },
  'POST /call': async (req, res, q) => { // agent asks the human for an ability
    const a = auth(q.get('token'), 'agent'); if (!a) return json(res, 401, { error: 'bad token' })
    const b = await body(req), p = a.m.players[a.side]
    p.calls = [...p.calls.filter(c => c.ability !== b.ability), { ability: b.ability, x: b.x, y: b.y, message: String(b.message || '').slice(0, 140), t: Math.floor(a.m.s.tick / TPS) }].slice(-3)
    json(res, 200, { ok: true })
  },
  'POST /say': async (req, res, q) => { // human ping or order to their agent
    const a = auth(q.get('token'), 'human'); if (!a) return json(res, 401, { error: 'bad token' })
    const b = await body(req)
    emit(a.m, a.side, `HUMAN: ${String(b.text || 'ping').slice(0, 140)}${Number.isFinite(b.x) ? ` at (${b.x},${b.y})` : ''}`)
    json(res, 200, { ok: true })
  },
  'GET /stream': (req, res, q) => {
    const a = auth(q.get('token'), 'human'); if (!a) return json(res, 401, { error: 'bad token' })
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    res.write(`event: map\ndata: ${JSON.stringify({ ...mapInfo(a.m.s), side: a.side, players: Object.fromEntries(Object.entries(a.m.players).map(([s, p]) => [s, { name: p.name, setup: p.setup }])) })}\n\n`)
    const st = { res, side: a.side }
    a.m.streams.add(st); req.on('close', () => a.m.streams.delete(st))
  },
  'GET /leaderboard': (req, res) => json(res, 200, [...elo].sort((a, b) => b[1] - a[1]).map(([name, rating]) => ({ name, rating }))),
  'GET /': (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(readFileSync(new URL('./index.html', import.meta.url))) },
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, ORIGIN), route = routes[`${req.method} ${u.pathname}`]
  if (!route) return json(res, 404, { error: 'not found' })
  try { await route(req, res, u.searchParams) } catch (e) { json(res, 400, { error: String(e.message || e) }) }
}).listen(PORT, () => console.log(`botters server on ${ORIGIN}`))
