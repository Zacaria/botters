// Game server: matchmaking (vs another player or vs the house), 20 Hz match loop, agent API, browser stream, Elo.
// ponytail: all state in memory, one process. Port to Vercel + Convex once the game is fun.
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { randomBytes, randomInt } from 'node:crypto'
import { createMatch, applyInput, step, view, rules, replay, totals, HOUSE_GAMBITS, TPS, W, H, MAX_GAMBITS } from './sim.js'

const PORT = Number(process.env.PORT || 8787)
const ORIGIN = process.env.BOTTERS_ORIGIN || `http://localhost:${PORT}`
const RATE = 5, START_DELAY = Number(process.env.BOTTERS_START_DELAY || 10000), FINISHED_TTL = 10 * 60 * 1000, FRAME_EVERY = 2 // browser: 10 frames/s
const tickets = new Map(), matches = new Map(), tokens = new Map(), elo = new Map()
let waiting = null
const id = () => randomBytes(12).toString('base64url')

function startMatch(a, b) { // b === null: the house plays side 1 with fixed gambits and no agent
  const m = { id: id(), s: createMatch(randomInt(2 ** 31)), players: [], log: [], streams: new Set(), startsAt: Date.now() + START_DELAY }
  if (!b) { applyInput(m.s, 1, { gambits: HOUSE_GAMBITS }); m.log.push({ tick: 0, side: 1, role: 'house', input: { gambits: HOUSE_GAMBITS } }) }
  ;[a, b].forEach((t, side) => {
    const p = { side, name: t ? t.name : 'house', setup: t ? t.setup : 'fixed gambits', agent: id(), human: id(), events: [], seq: 0, waiters: [], sent: [], calls: [], feed: [], prev: null }
    m.players[side] = p
    if (!t) return
    tokens.set(p.agent, { m, side, role: 'agent' }); tokens.set(p.human, { m, side, role: 'human' })
    const o = side ? a : b
    t.match = { side, token: p.agent, watch: `${ORIGIN}/?t=${p.human}`, opponent: o ? `${o.name} (${o.setup})` : 'house (fixed gambits, no agent)' }
  })
  matches.set(m.id, m)
  for (const p of m.players) emit(m, p.side, `match starts in ${START_DELAY / 1000}s. Your home planet is on the ${p.side ? 'right' : 'left'}. Set your opening gambits now.`)
  const timer = setInterval(() => {
    if (Date.now() < m.startsAt) { for (const st of m.streams) send(st, m); return }
    step(m.s)
    if (m.s.tick % TPS === 0 || m.s.ended) for (const p of m.players) diffEvents(m, p)
    if (m.s.ended) { clearInterval(timer); finish(m); setTimeout(() => matches.delete(m.id), FINISHED_TTL) } // before the last frame: it carries the report
    if (m.s.tick % FRAME_EVERY === 0 || m.s.ended) for (const st of m.streams) send(st, m)
  }, 1000 / TPS)
}

const frame = (m, side) => ({ view: view(m.s, side), report: m.report?.[side], calls: m.players[side].calls, feed: m.players[side].feed, startsIn: Math.max(0, Math.ceil((m.startsAt - Date.now()) / 1000)) })
const send = (st, m) => st.res.write(`data: ${JSON.stringify(frame(m, st.side))}\n\n`)

function finish(m) {
  const [a, b] = m.players, w = m.s.ended.winner
  const ra = elo.get(a.name) ?? 1000, rb = elo.get(b.name) ?? 1000
  const exp = 1 / (1 + 10 ** ((rb - ra) / 400)), got = w === 0 ? 1 : w === 1 ? 0 : 0.5
  elo.set(a.name, Math.round(ra + 32 * (got - exp))); elo.set(b.name, Math.round(rb - 32 * (got - exp)))
  m.report = m.players.map(p => whatIf(m, p.side))
  console.log(JSON.stringify({ ...m.s.ended, at: m.s.tick / TPS, left: `${a.name} (${a.setup})`, right: `${b.name} (${b.setup})`, totals: view(m.s, 0).totals, inputs: m.log.length, report: m.report[0] }))
}

// Who won it? Replay the match without this side's human inputs, then without its agent's. Same seed, same opponent inputs.
// ponytail: honest but partial — in the replay the agent repeats its orders blindly instead of reacting to the new situation.
// ponytail: 3 synchronous replays (~0.5 s each) at match end block the server loop; move to a worker if matches overlap.
function whatIf(m, side) {
  const res = s => { const t = totals(s), w = s.ended.winner; return { result: w === side ? 'won' : w === null ? 'draw' : 'lost', you: t[side], enemy: t[1 - side] } }
  const without = role => res(replay(m.s.seed, m.log.filter(l => l.side !== side || l.role !== role)))
  const count = role => m.log.filter(l => l.side === side && l.role === role).length
  return { actual: res(m.s), humanInputs: count('human'), agentInputs: count('agent'), withoutHuman: without('human'), withoutAgent: without('agent') }
}

function emit(m, side, text) {
  const p = m.players[side]
  p.events.push({ seq: ++p.seq, t: Math.floor(m.s.tick / TPS), text })
  if (p.events.length > 200) p.events.shift()
  p.waiters.splice(0).forEach(fn => fn())
}
const feed = (m, side, who, text) => { const p = m.players[side]; p.feed = [...p.feed, { t: Math.floor(m.s.tick / TPS), who, text }].slice(-8) }

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

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const body = req => new Promise((ok, ko) => { let d = ''; req.on('data', c => { d += c; if (d.length > 65536) req.destroy() }); req.on('end', () => { try { ok(d ? JSON.parse(d) : {}) } catch (e) { ko(e) } }) })
const auth = (q, role) => { const a = tokens.get(q); return a && (!role || a.role === role) ? a : null }
export const describe = r => `${r.on === false ? '(off) ' : ''}IF ${r.if}${r.p !== undefined ? `(${r.p})` : ''} → ${r.then}`

const routes = {
  'POST /join': async (req, res) => {
    const b = await body(req)
    const t = { id: id(), name: String(b.name || 'anon').slice(0, 24), setup: String(b.setup || '?').slice(0, 40), match: null }
    tickets.set(t.id, t)
    if (b.vs === 'house') startMatch(t, null)
    else if (waiting && tickets.has(waiting.id) && waiting.name !== t.name) { const a = waiting; waiting = null; startMatch(a, t) } else waiting = t
    json(res, 200, { ticket: t.id, match: t.match })
  },
  'GET /ticket': (req, res, q) => { // long-poll until matched (≤20 s)
    const t = tickets.get(q.get('id'))
    if (!t) return json(res, 404, { error: 'unknown ticket' })
    const until = Date.now() + 20000
    const poll = () => t.match || Date.now() > until ? json(res, 200, { match: t.match }) : setTimeout(poll, 250)
    poll()
  },
  'GET /rules': (req, res) => json(res, 200, { map: { W, H }, maxGambits: MAX_GAMBITS, ...rules() }),
  'GET /state': (req, res, q) => {
    const a = auth(q.get('token')); if (!a) return json(res, 401, { error: 'bad token' })
    json(res, 200, frame(a.m, a.side))
  },
  'GET /events': (req, res, q) => { // long-poll for events after `since`
    const a = auth(q.get('token')); if (!a) return json(res, 401, { error: 'bad token' })
    const p = a.m.players[a.side], since = Number(q.get('since') || 0)
    const reply = () => json(res, 200, { events: p.events.filter(e => e.seq > since), state: view(a.m.s, a.side), startsIn: Math.max(0, Math.ceil((a.m.startsAt - Date.now()) / 1000)) })
    if (p.events.some(e => e.seq > since) || a.m.s.ended) return reply()
    const t = setTimeout(() => { p.waiters = p.waiters.filter(f => f !== fn); reply() }, Math.min(25, Number(q.get('timeout') || 10)) * 1000)
    const fn = () => { clearTimeout(t); reply() }
    p.waiters.push(fn)
  },
  'POST /input': async (req, res, q) => { // agent or human: gambits, toggle, order, split, release
    const a = auth(q.get('token')); if (!a) return json(res, 401, { error: 'bad token' })
    const b = await body(req), p = a.m.players[a.side], now = Date.now()
    if (a.role === 'agent') {
      p.sent = p.sent.filter(x => now - x < 1000)
      if (p.sent.length >= RATE) return json(res, 429, { error: `max ${RATE} inputs per second` })
      p.sent.push(now)
    }
    const input = { gambits: b.gambits, toggle: b.toggle, order: b.order, split: b.split, release: b.release }
    if (now < a.m.startsAt && (input.order || input.split !== undefined || input.release !== undefined)) return json(res, 409, { error: 'match not started: only gambits can change now' })
    const r = applyInput(a.m.s, a.side, input)
    if (r.ok) {
      a.m.log.push({ tick: a.m.s.tick, side: a.side, role: a.role, input })
      const why = b.why ? `: ${String(b.why).slice(0, 120)}` : ''
      if (a.role === 'agent') {
        if (b.gambits) feed(a.m, a.side, 'agent', `rewrote the gambits${why}`)
        if (b.order) feed(a.m, a.side, 'agent', `took swarm ${b.order.swarm} to (${Math.round(b.order.x)},${Math.round(b.order.y)})${why}`)
        if (b.split !== undefined) feed(a.m, a.side, 'agent', `split swarm ${b.split}${why}`)
        if (b.release !== undefined) feed(a.m, a.side, 'agent', `gave swarm ${b.release} back to the gambits`)
      } else {
        const list = a.m.s.gambits[a.side]
        if (b.toggle !== undefined) emit(a.m, a.side, `HUMAN switched gambit ${b.toggle + 1} ${list[b.toggle].on ? 'ON' : 'OFF'}: ${describe(list[b.toggle])}`)
        if (b.order) { p.calls = p.calls.filter(c => c.swarm !== b.order.swarm); emit(a.m, a.side, `HUMAN took swarm ${b.order.swarm} by hand to (${Math.round(b.order.x)},${Math.round(b.order.y)})`) }
        if (b.split !== undefined) emit(a.m, a.side, `HUMAN split swarm ${b.split}`)
        if (b.release !== undefined) emit(a.m, a.side, `HUMAN gave swarm ${b.release} back to the gambits`)
      }
    }
    json(res, r.ok ? 200 : 400, r)
  },
  'POST /call': async (req, res, q) => { // agent asks its human to take a swarm somewhere by hand
    const a = auth(q.get('token'), 'agent'); if (!a) return json(res, 401, { error: 'bad token' })
    const b = await body(req), p = a.m.players[a.side]
    const call = { swarm: Number.isFinite(b.swarm) ? b.swarm : null, x: Number.isFinite(b.x) ? Math.round(b.x) : null, y: Number.isFinite(b.y) ? Math.round(b.y) : null, message: String(b.message || '').slice(0, 140), t: Math.floor(a.m.s.tick / TPS) }
    p.calls = [...p.calls.filter(c => call.swarm === null || c.swarm !== call.swarm), call].slice(-3)
    feed(a.m, a.side, 'agent', `asks you: ${call.message}`)
    json(res, 200, { ok: true })
  },
  'POST /dismiss': async (req, res, q) => {
    const a = auth(q.get('token'), 'human'); if (!a) return json(res, 401, { error: 'bad token' })
    const b = await body(req), p = a.m.players[a.side]
    p.calls = p.calls.filter((c, i) => i !== b.index)
    json(res, 200, { ok: true })
  },
  'POST /say': async (req, res, q) => { // human message or ping to their agent
    const a = auth(q.get('token'), 'human'); if (!a) return json(res, 401, { error: 'bad token' })
    const b = await body(req), text = String(b.text || 'look here').slice(0, 140), at = Number.isFinite(b.x) ? ` at (${Math.round(b.x)},${Math.round(b.y)})` : ''
    emit(a.m, a.side, `HUMAN: ${text}${at}`); feed(a.m, a.side, 'you', `${text}${at}`)
    json(res, 200, { ok: true })
  },
  'GET /stream': (req, res, q) => {
    const a = auth(q.get('token'), 'human'); if (!a) return json(res, 401, { error: 'bad token' })
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    res.write(`event: hello\ndata: ${JSON.stringify({ W, H, side: a.side, players: a.m.players.map(p => ({ name: p.name, setup: p.setup })), rules: rules() })}\n\n`)
    const st = { res, side: a.side }
    send(st, a.m)
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
