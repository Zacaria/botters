import { writeFileSync } from 'node:fs'
import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { ROUNDS, CONDITIONS, ACTIONS, BREEDS, BREED_DOC, MAX_GAMBITS, describe, nextSlots, playRound, checkBot } from '../../sim.js'
import { START, POLICIES, house, refusal } from './rounds.mjs'

export function createRoundsMatch({ seed, sides, settings: overrides = {}, logPath, startGrace = 90 }) {
  const settings = { ...ROUNDS, ...overrides }
  if (!Number.isInteger(seed) || !Array.isArray(sides) || sides.length !== 2 || sides.some(s => s !== 'agent' && s !== 'house' && !Object.hasOwn(POLICIES, s)) || !Number.isInteger(settings.count) || settings.count < 1 || !(settings.seconds > 0) || !(settings.pause > 0) || !(startGrace >= 0)) throw new Error('invalid match configuration')
  const k = settings.counter
  const reference = `Breeds (your whole army is one role, and your planets breed it): ${BREEDS.map(b => `${b}: ${BREED_DOC[b]}`).join('; ')}. A unit deals ${k}× damage to the role it beats and ${+(1 / k).toFixed(2)}× to the role that beats it. Conditions (default p): ${Object.entries(CONDITIONS).map(([c, v]) => `${c}(${v.p}): ${v.doc}`).join('; ')}. Actions: ${Object.entries(ACTIONS).map(([a, v]) => `${a}: ${v}`).join('; ')}`
  const instructions = `Play ${settings.count} fresh rounds on the same map, ${settings.seconds}s of simulated combat each. A bot is a breed plus a list of rules. Both sides plan for ${settings.pause}s before each round. At the gong the last valid bot is locked; otherwise your previous bot plays. Start with ${settings.slots} rule slots, gain one after each round and an extra on a loss (maximum ${MAX_GAMBITS}). First matching rule controls each battalion. You never act during combat. Your opponent may change its bot between rounds too; its rules are hidden, but each debrief shows its army. ${reference}`
  const state = { seed, sides: sides.slice(), settings, connectedAt: [null, null], pauses: [], score: [0, 0], winner: null, finishedAt: null }
  let slots = [settings.slots, settings.slots], bots = [structuredClone(START), structuredClone(START)], current = null, started = false, timer, startTimer, deadline = 0
  const returned = [0, 0], history = [], waiters = new Set()
  const persist = () => { if (logPath) writeFileSync(logPath, JSON.stringify(state, null, 2)) }
  const notify = () => { for (const r of waiters) r(); waiters.clear() }
  const text = (o, error = false) => ({ text: typeof o === 'string' ? o : JSON.stringify(o), ...(error && { isError: true }) })
  const outcome = (winner, side) => winner === null ? 'draw' : winner === side ? 'won' : 'lost'
  const score = side => ({ you: state.score[side], opponent: state.score[1 - side] })
  const show = b => ({ breed: b.breed, rules: b.gambits.map(describe) })
  const left = () => Math.max(0, Math.round((deadline - Date.now()) / 1000))
  const debrief = side => {
    const p = state.pauses.at(-2), r = p?.result; if (!r) return null
    const other = 1 - side, n = r.ruleUse[side].reduce((a, b) => a + b, 0)
    return { round: p.round, result: outcome(r.winner, side), reason: r.reason, endedAt: r.t, planets: { you: r.planets[side], opponent: r.planets[other] }, units: { you: r.units[side], opponent: r.units[other] }, timeline: r.timeline.map(e => `${e.t}s planets ${e.planets[side]}-${e.planets[other]} units ${e.units[side]}-${e.units[other]}`), yourArmy: { breed: p.locked[side].breed, atStart: r.roles.start[side], atEnd: r.roles.end[side] }, opponentArmy: { breed: p.locked[other].breed, atStart: r.roles.start[other], atEnd: r.roles.end[other] }, yourRuleUse: p.locked[side].gambits.map((rule, i) => ({ rule: describe(rule), share: `${n ? Math.round(r.ruleUse[side][i] / n * 100) : 0}%` })) }
  }
  function open() {
    started = true; clearTimeout(startTimer)
    current = { round: state.pauses.length + 1, slots: slots.slice(), openedAt: new Date().toISOString(), sides: [0, 1].map(() => ({ versions: [], invalid: [], late: [] })), locked: null, result: null }
    deadline = Date.now() + settings.pause * 1000; state.pauses.push(current); timer = setTimeout(gong, settings.pause * 1000); notify()
  }
  function gong() {
    if (!current) return
    clearTimeout(timer); const p = current; current = null
    bots = sides.map((spec, side) => {
      if (spec === 'agent') return structuredClone(p.sides[side].versions.at(-1)?.bot ?? bots[side])
      const expected = spec === 'house' ? 1 : 0, swap = side !== expected
      const view = history.map(h => swap ? { ...h, bots: [h.bots[1], h.bots[0]], result: { ...h.result, winner: h.result.winner === null ? null : 1 - h.result.winner } } : h)
      const b = (spec === 'house' ? house : POLICIES[spec])(p.round, p.slots[side], structuredClone(view), seed)
      const error = checkBot(b) || (b.gambits.length > p.slots[side] ? 'too many rules' : null); if (error) throw new Error(`side ${side}: ${error}`)
      return structuredClone(b)
    })
    p.locked = structuredClone(bots); p.result = playRound(seed, bots, { seconds: settings.seconds }); history.push({ round: p.round, bots: p.locked, result: p.result })
    if (p.result.winner !== null) state.score[p.result.winner]++
    slots = nextSlots(slots, p.result.winner); persist()
    if (p.round < settings.count) open()
    else { state.winner = state.score[0] === state.score[1] ? null : state.score[0] > state.score[1] ? 0 : 1; state.finishedAt = new Date().toISOString(); persist(); notify() }
  }
  const validSide = side => { if (![0, 1].includes(side) || sides[side] !== 'agent') throw new Error('invalid agent side') }
  async function wait(side) {
    validSide(side); if (!state.connectedAt[side]) { state.connectedAt[side] = new Date().toISOString(); persist() }
    if (!started && sides.every((s, i) => s !== 'agent' || state.connectedAt[i])) open()
    for (;;) {
      if (current && Date.now() >= deadline) gong()
      if (state.finishedAt) return text({ matchOver: true, result: outcome(state.winner, side), score: score(side), rounds: state.pauses.map(p => outcome(p.result.winner, side)), next: 'The match is over. Stop.' })
      if (current && current.round > returned[side]) { returned[side] = current.round; return text({ round: current.round, of: settings.count, secondsLeft: left(), yourSlots: current.slots[side], score: score(side), yourBot: { ...show(bots[side]), gambits: bots[side].gambits }, lastRound: debrief(side), next: `call set_bot({round, breed, gambits, why}) with at most ${current.slots[side]} rules before the gong, then wait_for_pause again` }) }
      await new Promise(resolve => waiters.add(resolve))
    }
  }
  function set(side, { round, breed, gambits, why }) {
    validSide(side); if (current && Date.now() >= deadline) gong()
    if (!current || round !== current.round) {
      const p = state.pauses.find(p => p.round === round) ?? current ?? state.pauses.at(-1)
      if (p) { p.sides[side].late.push({ at: new Date().toISOString(), round, breed, gambits, why }); if (p.result) persist() }
      return text(current ? `Refused: this pause is before round ${current.round}, not round ${round}. Resend with round ${current.round}; ${left()} s left before the gong.` : `too late: the gong rang, round ${round} plays your previous bot`, true)
    }
    const at = (Date.now() - (deadline - settings.pause * 1000)) / 1000, chosen = breed ?? bots[side].breed
    const error = !Array.isArray(gambits) || gambits.some(r => !r || typeof r.if !== 'string' || typeof r.then !== 'string') ? 'Refused: invalid gambits' : refusal(gambits, chosen, current.slots[side]) || (checkBot({ breed: chosen, gambits }) ? `Refused: ${checkBot({ breed: chosen, gambits })}` : null)
    if (error) { current.sides[side].invalid.push({ at, breed: chosen, gambits, why, error }); return text(`${error}; ${left()} s left before the gong.`, true) }
    const bot = { breed: chosen, gambits: structuredClone(gambits) }; current.sides[side].versions.push({ at, bot, why })
    return text({ ok: true, round, version: current.sides[side].versions.length, bot: show(bot), secondsLeft: left() })
  }
  startTimer = setTimeout(open, sides.every(s => s !== 'agent') ? 0 : startGrace * 1000)
  return { wait, set, state, instructions, reference }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1] }
  const socket = arg('socket', process.env.ROUNDS_HOST), logPath = arg('log', process.env.ROUNDS_LOG)
  if (!socket || !logPath) throw new Error('socket and log required')
  const match = createRoundsMatch({ seed: Number(arg('seed', process.env.ROUNDS_SEED ?? 1)), sides: arg('sides', process.env.ROUNDS_SIDES ?? 'agent,house').split(','), logPath, startGrace: Number(arg('start-grace', process.env.ROUNDS_START_GRACE ?? 90)), settings: { count: Number(arg('count', process.env.ROUNDS_COUNT ?? ROUNDS.count)), seconds: Number(arg('seconds', process.env.ROUNDS_SECONDS ?? ROUNDS.seconds)), pause: Number(arg('pause', process.env.ROUNDS_PAUSE ?? ROUNDS.pause)) } })
  const server = http.createServer(async (req, res) => {
    try {
      let result
      if (req.method === 'GET' && req.url === '/instructions') result = { instructions: match.instructions, reference: match.reference }
      else if (req.method === 'POST' && ['/wait', '/set'].includes(req.url)) {
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 100000) throw new Error('request too large') }
        const data = JSON.parse(body); result = req.url === '/wait' ? await match.wait(data.side) : match.set(data.side, data)
      } else { res.writeHead(404).end(); return }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result))
    } catch (e) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.message })) }
  })
  server.requestTimeout = 0; server.headersTimeout = 600000; server.listen(socket)
  const monitor = setInterval(() => { if (match.state.finishedAt) { clearInterval(monitor); setTimeout(() => server.close(), 3000) } }, 100)
}
