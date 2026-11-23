import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { W, H } from './sim.js'
import { MATCH_VIEW_URI, MATCH_VIEW_MIME, matchViewHtml } from './match-view.js'

export async function createBottersTools({ server: SERVER, agentToken, requireAgentToken = false, setup = 'agent', name = 'you', open: openUrl = () => {}, bypassSecret, log = () => {}, fetchImpl = fetch, state = null }) {
const serverURL = new URL(SERVER)
let liveServer = SERVER, liveAccounts = true, advertisedLive = false
const reconnectOAuth = 'Agent access ended. Reconnect Botters in your assistant to authorize it again.'
const withDeadline = async (ms, work) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try { return await work(controller.signal) } finally { clearTimeout(timer) }
}
try {
  const config = await withDeadline(5000, signal => fetchImpl(`${SERVER}/live-config.json`, { headers: serverURL.hostname.endsWith('.vercel.app') && bypassSecret ? { 'x-vercel-protection-bypass': bypassSecret } : {}, signal }).then(r => r.ok ? r.json() : {}))
  if (config.url && ['https:', 'http:'].includes(new URL(config.url).protocol)) { liveServer = new URL(config.url).origin; liveAccounts = config.accountRequired !== false; advertisedLive = true }
} catch { /* Offline servers do not advertise a live endpoint. */ }
const api = async (method, path, body) => {
  const s = S.session, url = new URL(path, SERVER)
  const headers = { 'content-type': 'application/json' }
  const target = path === '/session' && liveAccounts || path.startsWith('/agent/') ? SERVER : liveServer
  if (new URL(target).hostname.endsWith('.vercel.app') && bypassSecret) headers['x-vercel-protection-bypass'] = bypassSecret
  return withDeadline(55000, async signal => {
    const r = await fetchImpl(target + path, { method, headers, body: body && JSON.stringify(body), signal })
    if (s?.agentToken && url.searchParams.get('token') === s.agentToken && (r.status === 401 || r.status === 410 && url.pathname === '/agent/poll')) {
      // A late refusal belongs to the connection that sent it, not a newer one.
      if (S.session === s) Object.assign(S, { session: null, opened: false, inMatch: false, matchId: null, since: 0 })
      await r.body?.cancel().catch(() => {}) // refusal is definitive even without a JSON body
      return { status: r.status, error: requireAgentToken ? reconnectOAuth : 'Agent access or approval expired or was revoked. Call join_match to request fresh approval from your human.' }
    }
    return { status: r.status, ...(await r.json()) }
  })
}
const S = state || { session: agentToken ? { agentToken: agentToken, lobby: SERVER, online: true, legacyLocal: !requireAgentToken && !advertisedLive } : null, since: 0, opened: false, inMatch: false, matchId: null }
const rule = r => `${r.on === false ? '(off) ' : ''}IF ${r.if}${r.p !== undefined ? `(${r.p})` : ''} → ${r.then}`
const brief = (v, startsIn) => ({ ...v, ...(startsIn > 0 && { startsIn }) })

const mcp = new McpServer({ name: 'botters', version: '0.2.0' })
const text = o => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o) }] })
const need = () => S.inMatch ? null : text('Not in a match. Call join_match first.')
const input = async body => { const r = await api('POST', `/input?token=${S.session.agentToken}`, { ...body, matchId: body.matchId ?? S.matchId ?? undefined }); return text(r.ok ? { ok: true } : { ok: false, error: r.error }) }
const MATCH_ID = z.string().optional().describe('Match ID from the observation that informed this action. Always supply it; omission uses the latest joined match for compatibility.')
const GAMBIT = z.object({ if: z.string(), p: z.number().optional(), then: z.string(), on: z.boolean().optional() })

let committedJoin = 0
const joins = new WeakMap()
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
  description: `Play Botters with your human: a real-time duel. Each particle is a unit in a battalion; runners, grunts and tanks fight for planets. Owned planets breed units. Gambits are ordered IF condition → action rules; the first match controls each battalion unless held by hand. Battalions follow your side’s gambits; only the human moves battalions by hand. Ask them with call_human. Call join_match, write gambits from your human's doctrine, then wait for events and adapt.`,
  inputSchema: {
    vs: z.enum(['easy', 'normal', 'hard', 'player']).optional().describe('start a match now instead of waiting for the human: a house level or another player'),
    minutes: z.number().optional().describe('with vs: 3, 5 or 8'),
    planets: z.number().optional().describe('with vs: 9, 17 or 25'),
    planning: z.number().optional().describe('with vs: 10, 20 or 30 seconds'),
  },
}, async ({ vs, minutes, planets, planning }) => {
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
    const r = await api('POST', `/play?token=${s.agentToken}`, { vs, minutes, planets, planning })
    if (!r.ok && r.error !== 'already in a match') return text(r.error)
    if (changed()) return changed()
  }
  // ponytail: joins sharing a session wait for its long poll; separate sessions proceed independently.
  const previous = joins.get(s) || Promise.resolve()
  let release
  const turn = new Promise(resolve => { release = resolve })
  joins.set(s, turn)
  await previous
  try {
    if (changed()) return changed()
    const r = await api('GET', `/next?token=${s.agentToken}&timeout=45`)
    if (r.error) return text(r.error)
    if (changed()) return changed()
    if (!r.match) return text({ waiting: true, tell_the_human: `Your Botters lobby: ${s.lobby} (pick an opponent and press Play).`, next: 'Call join_match again to keep waiting.' })
    const rules = await api('GET', '/rules'), m = r.match
    if (changed()) return changed()
    // ponytail: legacy loopback servers cannot fence stale actions; upgrade the server for match identity protection.
    if (!m.id && ((s.online && !s.legacyLocal) || !['localhost', '127.0.0.1', '[::1]'].includes(serverURL.hostname) || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(liveServer).hostname))) return text('Server did not provide a match ID. Call join_match after upgrading the server.')
    committedJoin++
    if (!r.match.id || r.match.id !== S.matchId) S.since = 0
    S.inMatch = true; S.matchId = r.match.id || null
    return text({
      matchId: m.id, opponent: m.opponent, settings: m.options, doctrine: m.doctrine,
      opening: m.openingBy === 'human' ? 'Your human wrote the opening gambits. Keep them unless the situation demands a change.' : 'Write the opening gambits from the doctrine now.',
      rules: { conditions: rules.conditions, actions: rules.actions, maxGambits: rules.maxGambits, map: rules.map },
      state: brief(m.state, m.startsIn),
      next: 'Call show_match once so your human sees the live map in this conversation. Then set_gambits if needed, then call wait_for_event in a loop until the match is over. Events starting with HUMAN come from your human (messages, doctrine changes, gambit edits, battalions they took): follow them.',
    })
  } finally { release(); if (joins.get(s) === turn) joins.delete(s) }
})

mcp.registerTool('wait_for_event', {
  description: 'Block until something happens (enemy spotted, planet captured or lost, battalion destroyed, lead change, a message, doctrine change or action from your human) or timeout. Returns new events and the current state. Call it again right after acting. Do not stop before the match is over.',
  inputSchema: { timeout_s: z.number().min(1).max(20).default(10) },
}, async ({ timeout_s }) => {
  if (need()) return need()
  const s = S.session, matchId = S.matchId, joined = committedJoin
  const r = await api('GET', `/events?token=${s.agentToken}&since=${S.since}&timeout=${timeout_s}${matchId ? `&matchId=${encodeURIComponent(matchId)}` : ''}`)
  if (r.error) return text(r.error)
  if (S.session !== s || S.matchId !== matchId || committedJoin !== joined || r.matchId && r.matchId !== matchId) return text('Match or agent connection changed. Call join_match again.')
  if (!r.state) { S.inMatch = false; return text('Your match is over. Call join_match to wait for the next one.') }
  S.since = r.events.at(-1)?.seq ?? S.since
  if (r.state.ended) S.inMatch = false
  return text({ matchId, events: r.events.map(e => `[${e.t}s] ${e.text}`), state: brief(r.state, r.startsIn), next: r.state.ended ? 'Match over. Tell your human the result in 3 lines and what you would change, then call join_match for the next match.' : 'Act if needed, then call wait_for_event again.' })
})

mcp.registerTool('set_gambits', {
  description: 'Replace your side\'s whole gambit list (1 to 10 rules, first match wins, applies to every battalion not held by hand). Each rule: { if: condition, p?: number tuning the condition, then: action, on?: false to keep it written but disabled }. Keep the rules your human switched off, off. Say why in one short sentence: your human sees the author, time and reason live in the panel.',
  inputSchema: { matchId: MATCH_ID, gambits: z.array(GAMBIT).min(1).max(10), why: z.string().max(120) },
}, async ({ gambits, why, matchId }) => need() || input({ gambits, why, matchId }))

mcp.registerTool('toggle_gambit', {
  description: 'Switch one gambit on or off by its zero-based index.',
  inputSchema: { matchId: MATCH_ID, index: z.number().int().min(0), why: z.string().max(120) },
}, async ({ index, why, matchId }) => need() || input({ toggle: index, why, matchId }))

mcp.registerTool('get_state', {
  description: 'Battle view: your battalions (size, roles, fighting, active rule), planets (owner, capture progress), enemy battalions visible under fog, your gambits with battalions per rule (perRule) and the recent doctrine edits.', inputSchema: {},
}, async () => { if (need()) return need(); const r = await api('GET', `/state?token=${S.session.agentToken}`); return text(r.view ? { matchId: r.matchId, state: brief(r.view, r.startsIn), edits: r.edits } : r) })

// MCP Apps: hosts that render UI (Claude, ChatGPT…) draw this map in the conversation; others just get the text summary.
mcp.registerResource('match-map', MATCH_VIEW_URI, { title: 'Botters live match map', description: 'Read-only live map of the current match.', mimeType: MATCH_VIEW_MIME }, async () => ({
  contents: [{ uri: MATCH_VIEW_URI, mimeType: MATCH_VIEW_MIME, text: matchViewHtml({ W, H }), _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false } } }],
}))
const round = o => ({ ...o, x: Math.round(o.x), y: Math.round(o.y) })
mcp.registerTool('show_match', {
  title: 'Show the live match map',
  description: 'Show your human a live, read-only map of the current match inside this conversation (planets, your battalions, enemies in sight). Call it once after join_match; it keeps updating by itself. Hosts without UI get a one-line summary.',
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  _meta: { ui: { resourceUri: MATCH_VIEW_URI }, 'openai/outputTemplate': MATCH_VIEW_URI, 'openai/widgetAccessible': true, 'openai/toolInvocation/invoking': 'Opening the map…', 'openai/toolInvocation/invoked': 'Live map' },
}, async () => {
  if (!S.session) return { ...text('Not connected to a match yet. Call join_match first.'), structuredContent: { message: 'Waiting for the agent to join a match…' } }
  const r = await api('GET', `/state?token=${S.session.agentToken}`)
  if (!r.view) return { ...text(r.error || 'No match running.'), structuredContent: { message: r.error ? `No match yet: ${r.error}` : 'Waiting for a match…' } }
  const v = r.view
  const frame = { matchId: r.matchId, opponent: r.opponent?.name, startsIn: r.startsIn, view: { secondsLeft: v.secondsLeft, ended: v.ended, totals: v.totals,
    battalions: v.battalions.map(b => round({ id: b.id, x: b.x, y: b.y, n: b.n, fighting: b.fighting, manual: b.manual })),
    enemies: v.enemies.map(e => round({ id: e.id, x: e.x, y: e.y, n: e.n, fighting: e.fighting })),
    planets: v.planets.map(p => ({ id: p.id, x: p.x, y: p.y, r: p.r, owner: p.owner, capture: Math.round(p.capture) })) } }
  return { ...text(v.ended ? `Match over: you ${v.ended.result}.` : `Live map shown to your human. ${Math.ceil(v.secondsLeft)}s left, units ${v.totals.you}–${v.totals.enemy}, planets ${v.totals.planets.you}–${v.totals.planets.enemy}. Keep playing with wait_for_event.`), structuredContent: frame }
})

mcp.registerTool('call_human', {
  description: 'Ask your human for a hand: a yellow card appears in their browser. Use it when a precise move matters more than the gambits can handle (a bait, a flank, a rescue). Give the battalion id and target if you have them, and say why in one short sentence. Your human has faster hands than your tool calls.',
  inputSchema: { matchId: MATCH_ID, message: z.string().max(140), bat: z.number().optional(), x: z.number().optional(), y: z.number().optional() },
}, async args => need() || text(await api('POST', `/call?token=${S.session.agentToken}`, { ...args, matchId: args.matchId ?? S.matchId ?? undefined })))

return mcp
}
