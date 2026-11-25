import { writeFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { ROUNDS, CONDITIONS, ACTIONS, BREEDS, BREED_DOC, MAX_GAMBITS, describe, nextSlots, playRound } from '../../sim.js'
import { START, house as variableHouse, bot as namedBot, fit, refusal } from './rounds.mjs'

// ROUNDS_HOUSE: `variable` (default, rounds.mjs `house`, which changes between rounds) or a fixed bot name such as `pincer+tank`
const seed = Number(process.env.ROUNDS_SEED ?? 1), houseName = process.env.ROUNDS_HOUSE ?? 'variable', logPath = process.env.ROUNDS_LOG
const settings = { ...ROUNDS, count: Number(process.env.ROUNDS_COUNT ?? ROUNDS.count), seconds: Number(process.env.ROUNDS_SECONDS ?? ROUNDS.seconds), pause: Number(process.env.ROUNDS_PAUSE ?? ROUNDS.pause) }
const housePolicy = houseName === 'variable' ? variableHouse : (() => { const b = namedBot(houseName); return (_r, slots) => ({ gambits: fit(b.gambits, slots), breed: b.breed }) })()
if (!logPath || !Number.isInteger(seed) || !Number.isInteger(settings.count) || settings.count < 1 || !Number.isFinite(settings.seconds) || settings.seconds <= 0 || !Number.isFinite(settings.pause) || settings.pause <= 0) throw new Error('Invalid rounds configuration or missing ROUNDS_LOG')
const k = settings.counter
const reference = `Breeds (your whole army is one role, and your planets breed it): ${BREEDS.map(b => `${b}: ${BREED_DOC[b]}`).join('; ')}. A unit deals ${k}× damage to the role it beats and ${+(1 / k).toFixed(2)}× to the role that beats it. Conditions (default p): ${Object.entries(CONDITIONS).map(([c, v]) => `${c}(${v.p}): ${v.doc}`).join('; ')}. Actions: ${Object.entries(ACTIONS).map(([a, v]) => `${a}: ${v}`).join('; ')}`
const instructions = `Play ${settings.count} fresh rounds on the same map, ${settings.seconds}s of simulated combat each. A bot is a breed plus a list of rules. Both sides plan for ${settings.pause}s before each round. At the gong the last valid bot is locked; otherwise your previous bot plays. Start with ${settings.slots} rule slots, gain one after each round and an extra on a loss (maximum ${MAX_GAMBITS}). First matching rule controls each battalion. You never act during combat. The house also rebuilds its bot between rounds; its rules are hidden, but each debrief shows its army. ${reference}`
const mcp = new McpServer({ name: 'botters', version: '0.2.0' }, { instructions })
const text = (o, error = false) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o) }], ...(error && { isError: true }) })
const state = { seed, house: houseName, settings, pauses: [], score: [0, 0], winner: null, finishedAt: null }
let slots = [settings.slots, settings.slots], bot = structuredClone(START), current = null, started = false, returned = 0, lastRound = null, timer = null
const history = [], waiters = new Set()
const notify = () => { for (const resolve of waiters) resolve(); waiters.clear() }
const persist = () => writeFileSync(logPath, JSON.stringify(state, null, 2))
const outcome = winner => winner === null ? 'draw' : winner === 0 ? 'won' : 'lost'
const score = () => ({ you: state.score[0], house: state.score[1] })
const show = b => ({ breed: b.breed, rules: b.gambits.map(describe) })
const open = () => {
  current = { round: state.pauses.length + 1, slots: slots.slice(), openedAt: new Date().toISOString(), versions: [], invalid: [], late: [], locked: null, houseBot: null, result: null }
  current.start = Date.now(); current.deadline = current.start + settings.pause * 1000
  state.pauses.push(current); timer = setTimeout(gong, settings.pause * 1000); notify()
}
const gong = () => {
  if (!current) return
  clearTimeout(timer); const pause = current; current = null
  bot = structuredClone(pause.versions.at(-1)?.bot ?? bot)
  pause.locked = structuredClone(bot); pause.houseBot = housePolicy(pause.round, pause.slots[1], history, seed)
  const result = playRound(seed, [bot, pause.houseBot], { seconds: settings.seconds }); pause.result = result
  history.push({ round: pause.round, bots: [pause.locked, pause.houseBot], result })
  if (result.winner !== null) state.score[result.winner]++
  const n = result.ruleUse[0].reduce((a, b) => a + b, 0)
  lastRound = { round: pause.round, result: outcome(result.winner), reason: result.reason, endedAt: result.t, planets: { you: result.planets[0], house: result.planets[1] }, units: { you: result.units[0], house: result.units[1] },
    timeline: result.timeline.map(e => `${e.t}s planets ${e.planets.join('-')} units ${e.units.join('-')}`),
    yourArmy: { breed: bot.breed, atStart: result.roles.start[0], atEnd: result.roles.end[0] }, houseArmy: { breed: pause.houseBot.breed, atStart: result.roles.start[1], atEnd: result.roles.end[1] },
    yourRuleUse: bot.gambits.map((r, i) => ({ rule: describe(r), share: `${n ? Math.round(result.ruleUse[0][i] / n * 100) : 0}%` })) }
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
      return text({ round: current.round, of: settings.count, secondsLeft: left(), yourSlots: current.slots[0], score: score(), yourBot: { ...show(bot), gambits: bot.gambits }, lastRound,
        next: `call set_bot({round, breed, gambits, why}) with at most ${current.slots[0]} rules before the gong, then wait_for_pause again` })
    }
    await new Promise(resolve => waiters.add(resolve))
  }
})
mcp.registerTool('set_bot', { description: `Replace your bot during the current pause: a breed and at most yourSlots rules. Omit breed to keep your current one. The last valid submission before the gong plays; a refused or late one does not replace it, and a refusal says what to fix so you can resend. ${reference}`,
  inputSchema: { round: z.number().int(), breed: z.string().optional(), gambits: z.array(z.object({ if: z.string(), then: z.string(), p: z.number().optional() })), why: z.string() } }, async ({ round, breed, gambits, why }) => {
  if (current && Date.now() >= current.deadline) gong()
  if (!current || round !== current.round) {
    const p = state.pauses.find(p => p.round === round) ?? current ?? state.pauses.at(-1)
    if (p) { p.late.push({ at: new Date().toISOString(), round, breed, gambits, why }); if (p.result) persist() }
    return text(current ? `Refused: this pause is before round ${current.round}, not round ${round}. Resend with round ${current.round}; ${left()} s left before the gong.` : `too late: the gong rang, round ${round} plays your previous bot`, true)
  }
  const at = (Date.now() - current.start) / 1000, chosen = breed ?? bot.breed, error = refusal(gambits, chosen, current.slots[0])
  if (error) { current.invalid.push({ at, breed: chosen, gambits, why, error }); return text(`${error}; ${left()} s left before the gong.`, true) }
  current.versions.push({ at, bot: { breed: chosen, gambits: structuredClone(gambits) }, why })
  return text({ ok: true, round, version: current.versions.length, bot: show({ breed: chosen, gambits }), secondsLeft: left() })
})
await mcp.connect(new StdioServerTransport())
process.stdin.on('end', () => { clearTimeout(timer); process.exit(0) })
