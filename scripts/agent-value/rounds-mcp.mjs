import { writeFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { ROUNDS, CONDITIONS, ACTIONS, checkGambits, describe, nextSlots, playRound } from '../../sim.js'
import { CORE, fit } from './rounds.mjs'
import { SETS } from './strategies.mjs'

const seed = Number(process.env.ROUNDS_SEED ?? 1), house = process.env.ROUNDS_HOUSE ?? 'blobflank', logPath = process.env.ROUNDS_LOG
const settings = { ...ROUNDS, count: Number(process.env.ROUNDS_COUNT ?? ROUNDS.count), seconds: Number(process.env.ROUNDS_SECONDS ?? ROUNDS.seconds), pause: Number(process.env.ROUNDS_PAUSE ?? ROUNDS.pause) }
if (!logPath || !SETS[house] || !Number.isInteger(seed) || !Number.isInteger(settings.count) || settings.count < 1 || !Number.isFinite(settings.seconds) || settings.seconds <= 0 || !Number.isFinite(settings.pause) || settings.pause <= 0) throw new Error('Invalid rounds configuration or missing ROUNDS_LOG')
const reference = `Conditions (default p): ${Object.entries(CONDITIONS).map(([k, v]) => `${k}(${v.p}): ${v.doc}`).join('; ')}. Actions: ${Object.entries(ACTIONS).map(([k, v]) => `${k}: ${v}`).join('; ')}`
const instructions = `Play ${settings.count} fresh rounds on the same map, ${settings.seconds}s of simulated combat each. Both sides plan for ${settings.pause}s before each round. At the gong the last valid bot is locked; otherwise your previous bot plays. Start with ${settings.slots} slots, gain one after each round and an extra on a loss (maximum 10). First matching rule controls each battalion. You never act during combat. The house bot is not shown. ${reference}`
const mcp = new McpServer({ name: 'botters', version: '0.1.0' }, { instructions })
const text = (o, error = false) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o) }], ...(error && { isError: true }) })
const state = { seed, house, settings, pauses: [], score: [0, 0], winner: null, finishedAt: null }
let slots = [settings.slots, settings.slots], bot = structuredClone(CORE), current = null, started = false, returned = 0, lastRound = null, timer = null
const waiters = new Set()
const notify = () => { for (const resolve of waiters) resolve(); waiters.clear() }
const persist = () => writeFileSync(logPath, JSON.stringify(state, null, 2))
const outcome = winner => winner === null ? 'draw' : winner === 0 ? 'won' : 'lost'
const score = () => ({ you: state.score[0], house: state.score[1] })
const open = () => {
  current = { round: state.pauses.length + 1, slots: slots.slice(), openedAt: new Date().toISOString(), versions: [], invalid: [], late: [], locked: null, houseBot: null, result: null }
  current.start = Date.now(); current.deadline = current.start + settings.pause * 1000
  state.pauses.push(current); timer = setTimeout(gong, settings.pause * 1000); notify()
}
const gong = () => {
  if (!current) return
  clearTimeout(timer); const pause = current; current = null
  bot = structuredClone(pause.versions.at(-1)?.gambits ?? bot)
  pause.locked = structuredClone(bot); pause.houseBot = fit(SETS[house], pause.slots[1])
  const result = playRound(seed, [bot, pause.houseBot], { seconds: settings.seconds }); pause.result = result
  if (result.winner !== null) state.score[result.winner]++
  const n = result.ruleUse[0].reduce((a, b) => a + b, 0)
  lastRound = { round: pause.round, result: outcome(result.winner), reason: result.reason, endedAt: result.t, planets: { you: result.planets[0], house: result.planets[1] }, units: { you: result.units[0], house: result.units[1] }, timeline: result.timeline.map(e => `${e.t}s planets ${e.planets.join('-')} units ${e.units.join('-')}`), yourRuleUse: bot.map((r, i) => ({ rule: describe(r), share: `${n ? Math.round(result.ruleUse[0][i] / n * 100) : 0}%` })), botPlayed: bot.map(describe) }
  slots = nextSlots(slots, result.winner); delete pause.start; delete pause.deadline
  persist()
  if (pause.round < settings.count) open()
  else { state.winner = state.score[0] === state.score[1] ? null : state.score[0] > state.score[1] ? 0 : 1; state.finishedAt = new Date().toISOString(); persist(); notify() }
}
const left = () => Math.max(0, Math.round((current.deadline - Date.now()) / 1000))
const endPayload = () => ({ matchOver: true, result: outcome(state.winner), score: score(), rounds: state.pauses.map(p => outcome(p.result.winner)), next: 'The match is over. Stop.' })
mcp.registerTool('wait_for_pause', { description: `Wait for the next planning pause or match end. ${instructions}`, inputSchema: {} }, async () => {
  if (!started) { started = true; open() }
  for (;;) {
    if (current && Date.now() >= current.deadline) gong()
    if (state.finishedAt) return text(endPayload())
    if (current && current.round > returned) {
      returned = current.round
      return text({ round: current.round, of: settings.count, secondsLeft: left(), yourSlots: current.slots[0], score: score(), yourBot: { descriptions: bot.map(describe), gambits: bot }, lastRound, next: 'call set_bot({round, gambits, why}) before the gong, then wait_for_pause again' })
    }
    await new Promise(resolve => waiters.add(resolve))
  }
})
mcp.registerTool('set_bot', { description: `Replace your bot during the current pause. The last valid submission before the gong plays; invalid or late submissions do not replace it. ${reference}`, inputSchema: { round: z.number().int(), gambits: z.array(z.object({ if: z.string(), then: z.string(), p: z.number().optional() })), why: z.string() } }, async ({ round, gambits, why }) => {
  if (current && Date.now() >= current.deadline) gong()
  if (!current || round !== current.round) {
    const p = state.pauses.find(p => p.round === round) ?? current ?? state.pauses.at(-1)
    if (p) { p.late.push({ at: new Date().toISOString(), round, gambits, why }); if (p.result) persist() }
    return text(`too late: the gong rang, round ${round} plays your previous version`, true)
  }
  const at = (Date.now() - current.start) / 1000, error = checkGambits(gambits) || (gambits.length > current.slots[0] ? `maximum ${current.slots[0]} rules this round` : null)
  if (error) { current.invalid.push({ at, gambits, why, error }); return text(error, true) }
  current.versions.push({ at, gambits: structuredClone(gambits), why })
  return text({ ok: true, round, version: current.versions.length, secondsLeft: left() })
})
await mcp.connect(new StdioServerTransport())
process.stdin.on('end', () => { clearTimeout(timer); process.exit(0) })
