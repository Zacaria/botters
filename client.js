#!/usr/bin/env node
// Botters MCP server for your agent (Claude Code, Codex, any MCP client), over stdio.
// The agent writes the gambits; the game server runs them 20 times per second. No model in the real-time loop.
// Flow: join_match opens your lobby in the browser, waits until you press Play, then the agent plays with you.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
try { process.loadEnvFile(fileURLToPath(new URL('.env', import.meta.url))) } catch {} // optional local settings
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const env = process.env
const SERVER = (env.BOTTERS_SERVER || 'http://localhost:8787').replace(/\/$/, '')
const serverURL = new URL(SERVER)
if (serverURL.protocol !== 'https:' && !(serverURL.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(serverURL.hostname))) throw new Error('BOTTERS_SERVER must use HTTPS (except localhost).')
const up = () => fetch(SERVER + '/rules').then(r => r.ok, () => false)
if (!env.BOTTERS_SERVER && !(await up())) {
  if (process.stdin.isTTY) { // run from a terminal: host the game here until Ctrl+C
    env.PORT = '8787'; const srv = await import('./server.js')
    try { await srv.listening } catch (e) { if (e.code !== 'EADDRINUSE' || !(await up())) throw e } // started twice at once: use the other one
  }
  else { // agent: start the game as its own process, shared by every agent on this machine; it exits once idle
    spawn(process.execPath, [fileURLToPath(new URL('server.js', import.meta.url))], { detached: true, stdio: 'ignore', env: { ...env, PORT: '8787', BOTTERS_IDLE_EXIT: '1' } }).unref()
    for (let i = 0; i < 50 && !(await up()); i++) await new Promise(r => setTimeout(r, 100)) // two agents racing: the loser's server exits on EADDRINUSE, both use the winner's
  }
}
const openUrl = url => { // BOTTERS_OPEN: unset = default browser, 0 = never, else a macOS app name
  if (env.BOTTERS_OPEN === '0') return
  const [cmd, args] = process.platform === 'darwin' ? ['open', env.BOTTERS_OPEN && env.BOTTERS_OPEN !== '1' ? ['-a', env.BOTTERS_OPEN, url] : [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
}
if (process.stdin.isTTY) { openUrl(SERVER); console.error(`Botters is running: ${SERVER}  (Ctrl+C to stop)`) } // run from a terminal: just play
const log = (...a) => console.error('[botters]', ...a) // stdout belongs to MCP

const api = async (method, path, body) => {
  const headers = { 'content-type': 'application/json' }
  if (serverURL.hostname.endsWith('.vercel.app') && env.VERCEL_AUTOMATION_BYPASS_SECRET) headers['x-vercel-protection-bypass'] = env.VERCEL_AUTOMATION_BYPASS_SECRET
  const r = await fetch(SERVER + path, { method, headers, body: body && JSON.stringify(body), signal: AbortSignal.timeout(55000) })
  return { status: r.status, ...(await r.json()) }
}
const S = { session: null, since: 0, opened: false, inMatch: false, matchId: null }
const rule = r => `${r.on === false ? '(off) ' : ''}IF ${r.if}${r.p !== undefined ? `(${r.p})` : ''} → ${r.then}`
const brief = (v, startsIn) => ({
  secondsLeft: v.secondsLeft, ...(startsIn > 0 && { startsIn }), ended: v.ended, particles: v.totals,
  yourSwarms: v.swarms.map(c => `#${c.id} n${c.n} at (${c.x},${c.y}) → (${c.tx},${c.ty}) ${c.manual ? 'BY HAND' : c.rule >= 0 ? `rule ${c.rule + 1}` : 'no rule'}${c.fighting ? ' FIGHTING' : ''}`),
  visibleEnemies: v.enemies.map(c => `#${c.id} n${c.n} at (${c.x},${c.y})${c.fighting ? ' FIGHTING' : ''}`),
  planets: v.planets.filter(p => p.massLeft > 0).map(p => `${p.id} (${p.x},${p.y}) ${p.owner || 'free'} mass ${p.massLeft}${Math.abs(p.capture) > 0 && Math.abs(p.capture) < 1 ? ` capture ${p.capture}` : ''}`),
  gambits: v.gambits.map((r, i) => `${i + 1}. ${rule(r)}`),
})

const mcp = new McpServer({ name: 'botters', version: '0.2.0' })
const text = o => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o) }] })
const need = () => S.inMatch ? null : text('Not in a match. Call join_match first.')
const input = async body => { const r = await api('POST', `/input?token=${S.session.agentToken}`, body); return text(r.ok ? { ok: true } : { ok: false, error: r.error }) }
const GAMBIT = z.object({ if: z.string(), p: z.number().optional(), then: z.string(), on: z.boolean().optional() })

async function session() {
  if (S.session) return S.session
  S.session = await api('POST', '/session', { name: env.BOTTERS_NAME || 'you', setup: env.BOTTERS_SETUP || 'agent' })
  if (!S.session.agentToken) { const error = S.session.error || 'Could not create a lobby.'; S.session = null; throw new Error(error) }
  log(`lobby ${S.session.lobby}`)
  return S.session
}

mcp.registerTool('join_match', {
  description: `Play Botters with your human: a 1v1 real-time space strategy game. Swarms of particles conquer and eat planets.
Call this first, and again after each match. It opens your human's lobby in their browser and waits until they press Play (they pick the opponent, match length and map there). If they have not pressed Play yet it returns {waiting: true}: tell them the lobby link once, then call join_match again. Pass vs to start a match yourself without waiting (headless play).
THE GAME: each side starts with 3 swarms of 3,000 particles next to its home planet. Owned planets are slowly eaten and turned into new particles for their owner. Most particles at the end wins; a side with no swarms and no planets left loses at once.
Fights follow the square law: swarms that touch lose particles in proportion to the enemy's size, so concentrating wins and small groups lose fights. Big swarms move slower. Fog of war: you only see enemies near your swarms and planets.
YOU DO NOT MOVE SWARMS ONE BY ONE. Every swarm follows your side's gambits: an ordered list of "IF condition → action" rules, first matching rule wins, re-evaluated every 0.5 s. Your job: rewrite the gambits as the match evolves (set_gambits), take a swarm by hand only for a precise play (order_swarm), and ask your human for help (call_human).
The result includes the rules, the match settings and your human's doctrine (their strategy, in their words). Before the countdown ends, turn the doctrine into opening gambits with set_gambits, unless your human already wrote them.`,
  inputSchema: {
    vs: z.enum(['easy', 'normal', 'hard', 'player']).optional().describe('start a match now instead of waiting for the human: a house level or another player'),
    minutes: z.number().optional().describe('with vs: 3, 5 or 8'),
    planets: z.number().optional().describe('with vs: 16, 28 or 40'),
    planning: z.number().optional().describe('with vs: 10, 20 or 30 seconds'),
  },
}, async ({ vs, minutes, planets, planning }) => {
  const s = await session()
  if (vs) { const r = await api('POST', `/play?token=${s.agentToken}`, { vs, minutes, planets, planning }); if (!r.ok && r.error !== 'already in a match') return text(r.error) }
  if (!S.opened) { S.opened = true; openUrl(s.lobby) }
  const r = await api('GET', `/next?token=${s.agentToken}&timeout=45`)
  if (r.status === 401) { S.session = null; return text('The game server restarted. Call join_match again.') }
  if (!r.match) return text({ waiting: true, tell_the_human: `Your Botters lobby: ${s.lobby} (pick a mode and press Play).`, next: 'Call join_match again to keep waiting.' })
  if (!r.match.id || r.match.id !== S.matchId) S.since = 0
  S.inMatch = true; S.matchId = r.match.id || null
  const rules = await api('GET', '/rules'), m = r.match
  return text({
    opponent: m.opponent, settings: m.options, doctrine: m.doctrine,
    opening: m.openingBy === 'human' ? 'Your human wrote the opening gambits. Keep them unless the situation demands a change.' : 'Write the opening gambits from the doctrine now.',
    rules: { conditions: rules.conditions, actions: rules.actions, maxGambits: rules.maxGambits, map: rules.map },
    state: brief(m.state, m.startsIn),
    next: 'set_gambits if needed, then call wait_for_event in a loop until the match is over. Events starting with HUMAN come from your human (messages, doctrine changes, gambit edits, swarms they took): follow them.',
  })
})

mcp.registerTool('wait_for_event', {
  description: 'Block until something happens (enemy swarm spotted, planet captured or lost, swarm destroyed, lead change, a message, doctrine change or action from your human) or timeout. Returns new events and the current state. Call it again right after acting. Do not stop before the match is over.',
  inputSchema: { timeout_s: z.number().min(1).max(20).default(10) },
}, async ({ timeout_s }) => {
  if (need()) return need()
  const r = await api('GET', `/events?token=${S.session.agentToken}&since=${S.since}&timeout=${timeout_s}`)
  if (r.error) return text(r.error)
  if (!r.state) { S.inMatch = false; return text('Your match is over. Call join_match to wait for the next one.') }
  S.since = r.events.at(-1)?.seq ?? S.since
  if (r.state.ended) S.inMatch = false
  return text({ events: r.events.map(e => `[${e.t}s] ${e.text}`), state: brief(r.state, r.startsIn), next: r.state.ended ? 'Match over. Tell your human the result in 3 lines and what you would change, then call join_match for the next match.' : 'Act if needed, then call wait_for_event again.' })
})

mcp.registerTool('set_gambits', {
  description: 'Replace your side\'s whole gambit list (1 to 10 rules, first match wins, applies to every swarm not held by hand). Each rule: { if: condition, p?: number tuning the condition, then: action, on?: false to keep it written but disabled }. Keep the rules your human switched off, off. Say why in one short sentence: your human sees it live.',
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
}, async args => need() || text(await api('POST', `/call?token=${S.session.agentToken}`, args)))

if (!process.stdin.isTTY) { process.stdin.on('close', () => process.exit(0)); await mcp.connect(new StdioServerTransport()); log(`MCP ready. server ${SERVER}`) 
 }
