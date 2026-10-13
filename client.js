#!/usr/bin/env node
// Local player client. Runs the pilot (fast decision model, ~4 calls/s) and exposes MCP tools to the commander.
//   node client.js          MCP server over stdio (Claude Code, Codex)
//   node client.js --auto   pilot only: joins, plays one match with the doctrine, exits
import { readFileSync, existsSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const env = process.env
const SERVER = env.BOTTERS_SERVER || 'http://localhost:8787'
const NAME = env.BOTTERS_NAME || 'anon'
const PILOT = { url: env.BOTTERS_PILOT_URL || 'https://api.typesafe.ai/v1/systemone', model: env.BOTTERS_PILOT_MODEL || 'jev-latest', key: env.BOTTERS_PILOT_KEY || env.TYPESAFE_API_KEY }
const DOCTRINE_MAX = 500, INTENT_MAX = 200
const doctrineFile = env.BOTTERS_DOCTRINE || 'DOCTRINE.md'
const doctrine = (existsSync(doctrineFile) ? readFileSync(doctrineFile, 'utf8') : 'Protect miners. Take the nearest points. Fight with counters.').slice(0, DOCTRINE_MAX)
const log = (...a) => console.error('[botters]', ...a) // stdout belongs to MCP

const api = async (method, path, body) => {
  const r = await fetch(SERVER + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
  return { status: r.status, ...(await r.json()) }
}

// ---------- match session ----------
const S = { match: null, map: null, intent: '', locks: new Map(), pilot: { calls: 0, ms: [], errors: 0, last: {}, tokens: 0 }, since: 0, running: false }

async function join(setup) {
  const j = await api('POST', '/join', { name: NAME, setup })
  let match = j.match
  for (let i = 0; !match && i < 6; i++) match = (await api('GET', `/ticket?id=${j.ticket}`)).match
  if (!match) return null
  S.match = match
  S.map = (await api('GET', `/state?token=${match.token}&map=1`)).map
  S.since = 0; S.locks.clear(); S.pilot = { calls: 0, ms: [], errors: 0, last: {}, tokens: 0 }
  pilotLoop()
  return match
}

// ---------- pilot ----------
const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const near = (u, list, n) => [...list].sort((a, b) => d(u, a) - d(u, b)).slice(0, n)
const at = p => `(${p.x},${p.y})`

function options(u, v) { // the menu for one unit: key -> [description, order]
  const o = {}, U = S.map.units, base = S.map.base[v.side]
  if (u.type !== 'miner') for (const e of near(u, v.enemies, 3)) {
    const edge = U[u.type].beats === e.type ? ' YOU COUNTER IT' : U[e.type].beats === u.type ? ' IT COUNTERS YOU' : ''
    o[`attack_${e.id}`] = [`attack enemy ${e.type} ${e.id} hp ${e.hp}/${e.maxHp} at ${at(e)}, ${d(u, e).toFixed(1)} away${edge}`, { target: e.id }]
  }
  for (const [k, p] of Object.entries(v.points)) o[`point_${k}`] = [`go to control point ${k} ${at(p)} owned by ${p.owner || 'nobody'}, ${d(u, p).toFixed(1)} away`, { x: p.x, y: p.y }]
  if (u.type === 'miner') near(u, S.map.nodes, 2).forEach((n, i) => { o[`mine_${i}`] = [`mine resource node ${at(n)}, ${d(u, n).toFixed(1)} away`, n] })
  else for (const m of near(u, v.units.filter(x => x.type === 'miner'), 1)) o[`guard_${m.id}`] = [`guard your miner ${m.id} at ${at(m)}`, { x: m.x, y: m.y }]
  const bush = nearestBush(u)
  if (bush) o.hide = [`hide in the bush at ${at(bush)}, ${d(u, bush).toFixed(1)} away`, bush]
  o.retreat = [`retreat to your base ${at(base)}`, base]
  o.keep = [`keep current order: ${u.order ? JSON.stringify(u.order) : 'none'}`, null]
  return o
}

function nearestBush(u) {
  let best = null
  S.map.bush.forEach((b, i) => { if (b) { const p = { x: i % S.map.W + 0.5, y: Math.floor(i / S.map.W) + 0.5 }; if (!best || d(u, p) < d(u, best)) best = p } })
  return best
}

function pilotRequest(v) {
  const menus = {}, questions = {}
  for (const u of v.units) {
    if ((S.locks.get(u.id) || 0) > Date.now()) continue
    menus[u.id] = options(u, v)
    questions[u.id] = { type: 'choice', instructions: `Best order right now for your ${u.type} ${u.id} (hp ${u.hp}/${u.maxHp}) at ${at(u)}${u.inBush ? ', hidden in a bush' : ''}`, criteria: Object.fromEntries(Object.entries(menus[u.id]).map(([k, [desc]]) => [k, desc])) }
  }
  const miners = v.units.filter(u => u.type === 'miner').length
  const costs = v.units.length >= S.map.maxUnits ? [] : Object.entries(S.map.units).filter(([k, t]) => t.cost <= v.resources && !(k === 'miner' && miners >= S.map.maxMiners))
  if (costs.length) questions._buy = { type: 'choice', instructions: `Spend resources (${v.resources}) on a reinforcement now?`, criteria: { none: 'save resources', ...Object.fromEntries(costs.map(([k, t]) => [k, `buy a ${k} for ${t.cost}`])) } }
  const state = [
    `RTS match, you are ${v.side}. ${v.secondsLeft}s left. Score you ${v.score.you} vs enemy ${v.score.enemy}, first to ${v.score.win}. Control points score 1/s each.`,
    `Counters: fast beats ranged, ranged beats tank, tank beats fast. Miners earn resources and cannot fight. Enemies in bushes are invisible unless within 1.5.`,
    `Doctrine: ${doctrine}`, S.intent && `Commander's current order (top priority): ${S.intent}`,
    `Your units: ${v.units.map(u => `${u.type} ${u.id} ${at(u)} hp ${u.hp}`).join('; ')}`,
    `Visible enemies: ${v.enemies.map(e => `${e.type} ${e.id} ${at(e)} hp ${e.hp}`).join('; ') || 'none'}`,
    v.strikes.filter(k => k.by === 'enemy').map(k => `DANGER: enemy strike lands at ${at(k)} in ${k.inSeconds}s, radius 2`).join(' '),
  ].filter(Boolean).join('\n')
  return { menus, body: { model: PILOT.model, state, questions } }
}

async function pilotLoop() {
  if (S.running) return
  S.running = true
  const token = S.match.token
  try {
    while (S.match?.token === token) {
      const v = await api('GET', `/state?token=${token}`)
      if (v.ended) break
      if (v.startsIn > 0) { await sleep(v.startsIn * 1000); continue }
      const { menus, body } = pilotRequest(v)
      if (!Object.keys(body.questions).length) { await sleep(200); continue }
      const t0 = Date.now()
      const r = await fetch(PILOT.url, { method: 'POST', headers: { 'content-type': 'application/json', ...(PILOT.key && { authorization: `Bearer ${PILOT.key}` }) }, body: JSON.stringify(body) })
      const ms = Date.now() - t0
      if (!r.ok) { S.pilot.errors++; log('pilot', r.status, (await r.text()).slice(0, 200)); await sleep(r.status === 429 || r.status === 529 ? 1000 : 300); continue }
      const res = await r.json()
      S.pilot.calls++; S.pilot.ms = [...S.pilot.ms.slice(-19), ms]; S.pilot.tokens += res.usage?.input_tokens || 0
      const orders = {}
      for (const [id, a] of Object.entries(res.answers)) {
        if (id === '_buy') continue
        const [, order] = menus[id][a.choice] || []
        S.pilot.last[id] = a.choice
        if (order && (S.locks.get(id) || 0) <= Date.now()) orders[id] = order.target ? { target: order.target } : { x: order.x, y: order.y }
      }
      const buy = res.answers._buy?.choice
      const out = await api('POST', `/input?token=${token}`, { orders, buy: buy && buy !== 'none' ? buy : undefined, pilotMs: ms, intent: S.intent })
      if (out.status === 429) await sleep(200)
      else if (out.status >= 400 && out.error !== 'match ended') log('input', out.error)
    }
  } catch (e) { log('pilot stopped:', e.message) } finally { S.running = false }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const pilotStats = () => {
  const ms = [...S.pilot.ms].sort((a, b) => a - b)
  return { model: PILOT.model, calls: S.pilot.calls, medianMs: ms[ms.length >> 1] ?? null, errors: S.pilot.errors, inputTokens: S.pilot.tokens, lastChoices: S.pilot.last }
}
const brief = v => ({
  t: v.tick / 10, secondsLeft: v.secondsLeft, ended: v.ended, score: v.score, resources: v.resources, points: v.points, abilitiesCooldown: v.abilities,
  units: v.units.map(u => `${u.id} ${u.type} ${at(u)} hp${u.hp}${u.inBush ? ' bush' : ''}`),
  enemies: v.enemies.map(e => `${e.id} ${e.type} ${at(e)} hp${e.hp}`),
})

// ---------- auto mode ----------
if (process.argv.includes('--auto')) {
  log(`${NAME} queueing, pilot ${PILOT.model}`)
  const m = await join(`${PILOT.model} (no commander)`)
  if (!m) { log('no opponent found'); process.exit(1) }
  log(`matched vs ${m.opponent.name} (${m.opponent.setup}) as ${m.side}. Watch: ${m.watch}`)
  while (S.running || !S.pilot.calls) await sleep(1000)
  const v = await api('GET', `/state?token=${m.token}`)
  log('result', JSON.stringify(v.ended), JSON.stringify(v.score), JSON.stringify(pilotStats()))
  process.exit(0)
}

// ---------- MCP tools for the commander ----------
const mcp = new McpServer({ name: 'botters', version: '0.0.1' })
const text = o => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o) }] })
const need = () => S.match ? null : text('Not in a match. Call join_match first.')

mcp.registerTool('join_match', {
  description: `Queue for a 1v1 Botters match (real-time strategy, 5 minutes) and wait for an opponent. Your pilot (${PILOT.model}) then orders every unit ~4 times per second following the doctrine and your intent. You are the commander: loop on wait_for_event until the match ends, steer with set_intent, override with order_units, and use call_human for decisive abilities. Rules: 40x24 grid, fog of war, bushes hide units unless an enemy is within 1.5 tiles. fast beats ranged, ranged beats tank, tank beats fast. Miners earn resources at nodes and cannot fight. 3 control points score 1/s each; win at 200, by wipe, or by lead at 5 minutes.`,
  inputSchema: {},
}, async () => {
  const m = await join(`${PILOT.model} + commander`)
  if (!m) return text('No opponent yet (waited ~2 min). Call join_match again.')
  return text({ ...m, token: undefined, doctrine, tell_the_human: `Watch and play your abilities at ${m.watch}`, next: 'Call wait_for_event in a loop until the match ends. Do not stop early.' })
})

mcp.registerTool('wait_for_event', {
  description: 'Block until something happens (enemy spotted, unit died, point captured, enemy strike incoming, a message from your human) or timeout. Returns new events, a brief state and pilot stats. Call it again immediately after acting.',
  inputSchema: { timeout_s: z.number().min(1).max(20).default(8) },
}, async ({ timeout_s }) => {
  if (need()) return need()
  const r = await api('GET', `/events?token=${S.match.token}&since=${S.since}&timeout=${timeout_s}`)
  if (r.error) return text(r.error)
  S.since = r.events.at(-1)?.seq ?? S.since
  return text({ events: r.events.map(e => `[${e.t}s] ${e.text}`), state: brief(r.state), pilot: pilotStats(), intent: S.intent, next: r.state.ended ? 'Match over. Report the result to the human.' : 'Act if needed, then call wait_for_event again.' })
})

mcp.registerTool('set_intent', {
  description: `Change your pilot's top-priority order, in plain words (max ${INTENT_MAX} chars), e.g. "all fast units raid the enemy miners near (35,6); tanks hold B". Takes effect on the pilot's next decision (<0.5 s). Empty string clears it.`,
  inputSchema: { intent: z.string().max(INTENT_MAX) },
}, async ({ intent }) => { S.intent = intent; return text({ ok: true, intent }) })

mcp.registerTool('order_units', {
  description: 'Give a direct order that the pilot will not override for lock_s seconds. Either target (a visible enemy id) or x,y. Use for precise plays; prefer set_intent for general direction.',
  inputSchema: { unit_ids: z.array(z.string()).min(1), target: z.string().optional(), x: z.number().optional(), y: z.number().optional(), lock_s: z.number().min(1).max(30).default(8) },
}, async ({ unit_ids, target, x, y, lock_s }) => {
  if (need()) return need()
  const order = target ? { target } : { x, y }
  const r = await api('POST', `/input?token=${S.match.token}`, { orders: Object.fromEntries(unit_ids.map(id => [id, order])) })
  if (r.ok) unit_ids.forEach(id => S.locks.set(id, Date.now() + lock_s * 1000))
  return text(r)
})

mcp.registerTool('call_human', {
  description: 'Ask your human to fire a decisive ability (only they can). strike: area damage radius 2 at x,y, lands 1 s later, 45 s cooldown. overdrive: all your units +50% speed for 5 s. recall: teleport your miners to base. reveal: see the whole map for 3 s. Explain why in one short sentence.',
  inputSchema: { ability: z.enum(['strike', 'overdrive', 'recall', 'reveal']), message: z.string().max(140), x: z.number().optional(), y: z.number().optional() },
}, async args => { if (need()) return need(); return text(await api('POST', `/call?token=${S.match.token}`, args)) })

await mcp.connect(new StdioServerTransport())
log(`MCP ready. server ${SERVER}, pilot ${PILOT.model}`)
