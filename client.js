#!/usr/bin/env node
// Botters MCP server for your agent (Claude Code, Codex, any MCP client), over stdio.
// The agent writes the gambits; the game server runs them 20 times per second. No model in the real-time loop.
import { readFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
try { process.loadEnvFile(new URL('.env', import.meta.url).pathname) } catch {} // optional local settings
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const env = process.env
const SERVER = env.BOTTERS_SERVER || 'http://localhost:8787'
const NAME = env.BOTTERS_NAME || 'anon'
const DOCTRINE_MAX = 500
const doctrineFile = env.BOTTERS_DOCTRINE || new URL('DOCTRINE.md', import.meta.url).pathname
const doctrine = (existsSync(doctrineFile) ? readFileSync(doctrineFile, 'utf8') : 'Grab free planets fast, fight only when bigger, protect what we own.').trim().slice(0, DOCTRINE_MAX)
const log = (...a) => console.error('[botters]', ...a) // stdout belongs to MCP

const api = async (method, path, body) => {
  const r = await fetch(SERVER + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
  return { status: r.status, ...(await r.json()) }
}
const S = { match: null, since: 0 }
const rule = r => `${r.on === false ? '(off) ' : ''}IF ${r.if}${r.p !== undefined ? `(${r.p})` : ''} → ${r.then}`
const brief = (v, startsIn) => ({
  secondsLeft: v.secondsLeft, ...(startsIn > 0 && { startsIn }), ended: v.ended, particles: v.totals,
  yourSwarms: v.swarms.map(c => `#${c.id} n${c.n} at (${c.x},${c.y}) → (${c.tx},${c.ty}) ${c.manual ? 'BY HAND' : c.rule >= 0 ? `rule ${c.rule + 1}` : 'no rule'}${c.fighting ? ' FIGHTING' : ''}`),
  visibleEnemies: v.enemies.map(c => `#${c.id} n${c.n} at (${c.x},${c.y})${c.fighting ? ' FIGHTING' : ''}`),
  planets: v.planets.filter(p => p.massLeft > 0).map(p => `${p.id} (${p.x},${p.y}) ${p.owner || 'free'} mass ${p.massLeft}${Math.abs(p.capture) > 0 && Math.abs(p.capture) < 1 ? ` capture ${p.capture}` : ''}`),
  gambits: v.gambits.map((r, i) => `${i + 1}. ${rule(r)}`),
})

const mcp = new McpServer({ name: 'botters', version: '0.1.0' })
const text = o => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o) }] })
const need = () => S.match ? null : text('Not in a match. Call join_match first.')
const input = async body => { const r = await api('POST', `/input?token=${S.match.token}`, body); return text(r.ok ? { ok: true } : { ok: false, error: r.error }) }
const GAMBIT = z.object({ if: z.string(), p: z.number().optional(), then: z.string(), on: z.boolean().optional() })

mcp.registerTool('join_match', {
  description: `Start a 5-minute 1v1 Botters match. Space swarms conquer and eat planets.
Each side starts with 3 swarms of 3,000 particles next to its home planet. Owned planets are slowly eaten and turned into new particles for their owner. More particles at 5:00 wins; a side with no swarms and no planets left loses at once.
Fights follow the square law: swarms that touch lose particles in proportion to the enemy's size, so concentrating wins and small groups lose fights. Big swarms move slower. Fog of war: you only see enemies near your swarms and planets.
YOU DO NOT MOVE SWARMS ONE BY ONE. Every swarm follows your side's gambits: an ordered list of "IF condition → action" rules, first matching rule wins, re-evaluated every 0.5 s. Your job: rewrite the gambits as the match evolves (set_gambits), take a swarm by hand only for a precise play (order_swarm), and ask your human for help (call_human).
The result includes the rules (conditions and actions) and your human's doctrine. Before the match starts (10 s), turn the doctrine into opening gambits with set_gambits.
vs: "house" (instant opponent with fixed gambits) or "player" (wait for another agent).`,
  inputSchema: { vs: z.enum(['house', 'player']).default('house') },
}, async ({ vs }) => {
  const j = await api('POST', '/join', { name: NAME, setup: env.BOTTERS_SETUP || 'agent', vs })
  let match = j.match
  for (let i = 0; !match && i < 6; i++) match = (await api('GET', `/ticket?id=${j.ticket}`)).match
  if (!match) return text('No opponent yet (waited 2 min). Call join_match again, or use vs "house".')
  S.match = match; S.since = 0
  if (env.BOTTERS_OPEN) spawn('open', [...(env.BOTTERS_OPEN === '1' ? [] : ['-a', env.BOTTERS_OPEN]), match.watch], { stdio: 'ignore', detached: true }).unref()
  const rules = await api('GET', '/rules')
  const st = await api('GET', `/state?token=${match.token}`)
  return text({
    opponent: match.opponent, doctrine, rules: { conditions: rules.conditions, actions: rules.actions, maxGambits: rules.maxGambits, map: rules.map },
    state: brief(st.view, st.startsIn),
    tell_the_human: `Your match is open in the browser: ${match.watch}`,
    next: 'Now: set_gambits from the doctrine. Then call wait_for_event in a loop until the match is over. Messages starting with HUMAN come from your human: follow them.',
  })
})

mcp.registerTool('wait_for_event', {
  description: 'Block until something happens (enemy swarm spotted, planet captured or lost, swarm destroyed, lead change, a message or action from your human) or timeout. Returns new events and the current state. Call it again right after acting. Do not stop before the match is over.',
  inputSchema: { timeout_s: z.number().min(1).max(20).default(10) },
}, async ({ timeout_s }) => {
  if (need()) return need()
  const r = await api('GET', `/events?token=${S.match.token}&since=${S.since}&timeout=${timeout_s}`)
  if (r.error) return text(r.error)
  S.since = r.events.at(-1)?.seq ?? S.since
  return text({ events: r.events.map(e => `[${e.t}s] ${e.text}`), state: brief(r.state, r.startsIn), next: r.state.ended ? 'Match over. Tell your human the result in 3 lines and what you would change.' : 'Act if needed, then call wait_for_event again.' })
})

mcp.registerTool('set_gambits', {
  description: 'Replace your side\'s whole gambit list (1 to 10 rules, first match wins, applies to every swarm not held by hand). Each rule: { if: condition, p?: number tuning the condition, then: action, on?: false to keep it written but disabled }. Say why in one short sentence: your human sees it live.',
  inputSchema: { gambits: z.array(GAMBIT).min(1).max(10), why: z.string().max(120) },
}, async ({ gambits, why }) => need() || input({ gambits, why }))

mcp.registerTool('order_swarm', {
  description: 'Take one of your swarms by hand and send it to x,y (map 1200×700). It stops following the gambits until release_swarm. Use for precise plays only: a hand-held swarm does not react to threats.',
  inputSchema: { swarm: z.number(), x: z.number(), y: z.number(), why: z.string().max(120) },
}, async ({ swarm, x, y, why }) => need() || input({ order: { swarm, x, y }, why }))

mcp.registerTool('split_swarm', {
  description: 'Split one of your swarms in two (needs ≥200 particles, max 40 swarms). The new half heads for the second-nearest planet you do not own.',
  inputSchema: { swarm: z.number(), why: z.string().max(120) },
}, async ({ swarm, why }) => need() || input({ split: swarm, why }))

mcp.registerTool('release_swarm', {
  description: 'Give a hand-held swarm back to the gambits.',
  inputSchema: { swarm: z.number() },
}, async ({ swarm }) => need() || input({ release: swarm }))

mcp.registerTool('call_human', {
  description: 'Ask your human for a hand: a yellow card appears in their browser. Use it when a precise move matters more than the gambits can handle (a bait, a flank, a rescue). Give the swarm id and target if you have them, and say why in one short sentence. Your human has faster hands than your tool calls.',
  inputSchema: { message: z.string().max(140), swarm: z.number().optional(), x: z.number().optional(), y: z.number().optional() },
}, async args => need() || text(await api('POST', `/call?token=${S.match.token}`, args)))

await mcp.connect(new StdioServerTransport())
log(`MCP ready. server ${SERVER}, player ${NAME}`)
