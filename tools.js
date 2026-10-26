import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export async function createBottersTools({ server: SERVER, agentToken, requireAgentToken = false, setup = 'agent', name = 'you', open: openUrl = () => {}, bypassSecret, log = () => {} }) {
const serverURL = new URL(SERVER)
let liveServer = SERVER, liveAccounts = true
const reconnectOAuth = 'Agent access ended. Reconnect Botters in your assistant to authorize it again.'
try {
  const config = await fetch(`${SERVER}/live-config.json`, { headers: serverURL.hostname.endsWith('.vercel.app') && bypassSecret ? { 'x-vercel-protection-bypass': bypassSecret } : {}, signal: AbortSignal.timeout(5000) }).then(r => r.ok ? r.json() : {})
  if (config.url && ['https:', 'http:'].includes(new URL(config.url).protocol)) { liveServer = new URL(config.url).origin; liveAccounts = config.accountRequired !== false }
} catch { /* Offline servers do not advertise a live endpoint. */ }
const api = async (method, path, body) => {
  const s = S.session, url = new URL(path, SERVER)
  const headers = { 'content-type': 'application/json' }
  const target = path === '/session' && liveAccounts || path.startsWith('/agent/') ? SERVER : liveServer
  if (new URL(target).hostname.endsWith('.vercel.app') && bypassSecret) headers['x-vercel-protection-bypass'] = bypassSecret
  const r = await fetch(target + path, { method, headers, body: body && JSON.stringify(body), signal: AbortSignal.timeout(55000) })
  if (s?.agentToken && url.searchParams.get('token') === s.agentToken && (r.status === 401 || r.status === 410 && url.pathname === '/agent/poll')) {
    // A late refusal belongs to the connection that sent it, not a newer one.
    if (S.session === s) Object.assign(S, { session: null, opened: false, inMatch: false, matchId: null, since: 0 })
    await r.body?.cancel().catch(() => {}) // refusal is definitive even without a JSON body
    return { status: r.status, error: requireAgentToken ? reconnectOAuth : 'Agent access or approval expired or was revoked. Call join_match to request fresh approval from your human.' }
  }
  return { status: r.status, ...(await r.json()) }
}
const S = { session: agentToken ? { agentToken: agentToken, lobby: SERVER, online: true } : null, since: 0, opened: false, inMatch: false, matchId: null }
const rule = r => `${r.on === false ? '(off) ' : ''}IF ${r.if}${r.p !== undefined ? `(${r.p})` : ''} → ${r.then}`
const brief = (v, startsIn) => ({
  secondsLeft: v.secondsLeft, ...(startsIn > 0 && { startsIn }), ended: v.ended, particles: v.totals,
  yourSwarms: v.swarms.map(c => `#${c.id} n${c.n}${c.hunger >= 0.5 ? ` HUNGRY ${Math.round(c.hunger * 100)}%` : ''}${c.belly > c.n * 0.1 ? ' digesting' : ''} at (${c.x},${c.y}) → (${c.tx},${c.ty}) ${c.manual ? 'BY HAND' : c.rule >= 0 ? `rule ${c.rule + 1}` : 'no rule'}${c.fighting ? ' FIGHTING' : ''}`),
  allies: v.allies.map(c => `#${c.id} n${c.n} at (${c.x},${c.y})`),
  visibleEnemies: v.enemies.map(c => `#${c.id} team${c.k} n${c.n} at (${c.x},${c.y})${c.fighting ? ' FIGHTING' : ''}`),
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
  if (requireAgentToken) throw new Error(reconnectOAuth)
  S.session = await api('POST', '/session', { name: name, setup: setup })
  if (S.session.status === 401) {
    const pair = await api('POST', '/agent/pair', { setup: setup })
    S.session = pair.agentToken ? { ...pair, lobby: pair.approvalUrl, online: true, pairing: true } : pair
  }
  if (!S.session.agentToken) { const error = S.session.error || 'Could not create a lobby.'; S.session = null; throw new Error(error) }
  log(S.session.online ? 'Waiting for your signed-in player to approve this agent.' : `lobby ${S.session.lobby}`)
  return S.session
}

mcp.registerTool('join_match', {
  description: `Play Botters with your human: a real-time space strategy game (1v1, 2v2 or free-for-all). Swarms of particles conquer and eat planets.
Call this first, and again after each match. It opens your human's lobby in their browser and waits until they press Play (they pick the opponent, match length and map there). If they have not pressed Play yet it returns {waiting: true}: tell them the lobby link once, then call join_match again. Pass vs to start a match yourself without waiting (headless play).
THE GAME: each side starts with 3 swarms of 3,000 particles next to its home planet. Owned planets are slowly eaten and turned into new particles for their owner. Most particles at the end wins; a side with no swarms and no planets left loses at once.
Only the front of two touching swarms fights, and a swarm much bigger than its enemy wraps it and wins big. Half of what a swarm kills joins it but is digested slowly (the swarm is slow meanwhile). A swarm that touches no planet and kills nothing for too long starves (hunger 0 to 1 in the state). Big swarms move slower.
MODES: pass mode '1v1' (default), '2v2' (you and a house ally against two house bots), 'ffa4' or 'ffa6' (free-for-all against house bots). Allies share vision and never fight each other; the last team standing wins. Fog of war: you only see enemies near your swarms and planets.
YOU DO NOT MOVE SWARMS ONE BY ONE. Every swarm follows your side's gambits: an ordered list of "IF condition → action" rules, first matching rule wins, re-evaluated every 0.5 s. Your job: rewrite the gambits as the match evolves (set_gambits), take a swarm by hand only for a precise play (order_swarm), and ask your human for help (call_human).
The result includes the rules, the match settings and your human's doctrine (their strategy, in their words). Before the countdown ends, turn the doctrine into opening gambits with set_gambits, unless your human already wrote them.`,
  inputSchema: {
    vs: z.enum(['easy', 'normal', 'hard', 'player']).optional().describe('start a match now instead of waiting for the human: a house level or another player'),
    minutes: z.number().optional().describe('with vs: 3, 5 or 8'),
    planets: z.number().optional().describe('with vs: 16, 28 or 40'),
    planning: z.number().optional().describe('with vs: 10, 20 or 30 seconds'),
    mode: z.enum(['1v1', '2v2', 'ffa4', 'ffa6']).optional().describe('with vs: 1v1 (default), 2v2 + house ally, free-for-all with 4 or 6 sides. Everything but 1v1 is played against house bots (vs easy, normal or hard)'),
  },
}, async ({ vs, minutes, planets, planning, mode }) => {
  const s = await session()
  const changed = () => S.session !== s && text('Agent connection changed. Call join_match again.')
  if (changed()) return changed()
  if (!S.opened) { S.opened = true; openUrl(s.lobby) }
  if (s.pairing) {
    const pair = await api('GET', `/agent/poll?token=${s.agentToken}&timeout=20`)
    if (pair.error) return text(pair.error)
    if (changed()) return changed()
    if (!pair.approved) return text({ waiting: true, tell_the_human: `Sign in and explicitly connect this agent: ${s.approvalUrl}`, next: 'Call join_match again after approval. Never request the human’s password or browser token.' })
    s.pairing = false; s.lobby = SERVER
  }
  if (vs && s.online) return text('Your signed-in human starts online matches in the lobby. Do not use the headless vs option online; call join_match without vs.')
  if (vs) {
    const r = await api('POST', `/play?token=${s.agentToken}`, { vs, minutes, planets, planning, mode })
    if (!r.ok && r.error !== 'already in a match') return text(r.error)
    if (changed()) return changed()
  }
  const r = await api('GET', `/next?token=${s.agentToken}&timeout=45`)
  if (r.error) return text(r.error)
  if (changed()) return changed()
  if (!r.match) return text({ waiting: true, tell_the_human: `Your Botters lobby: ${s.lobby} (pick a mode and press Play).`, next: 'Call join_match again to keep waiting.' })
  const rules = await api('GET', '/rules'), m = r.match
  if (changed()) return changed()
  if (!r.match.id || r.match.id !== S.matchId) S.since = 0
  S.inMatch = true; S.matchId = r.match.id || null
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
  const s = S.session
  const r = await api('GET', `/events?token=${s.agentToken}&since=${S.since}&timeout=${timeout_s}`)
  if (r.error) return text(r.error)
  if (S.session !== s) return text('Agent connection changed. Call join_match again.')
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

return mcp
}
