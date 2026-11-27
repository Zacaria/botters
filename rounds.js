import { ROUNDS, BREEDS, CONDITIONS, ACTIONS, DOCTRINES, describe, nextSlots, playRound, checkBot } from './sim.js'

const r = (cond, then, p) => ({ if: cond, then, ...(p !== undefined && { p }) })
export const CORE = [r('weaker_enemy_near', 'go', 3), r('free_planet', 'go'), r('enemy_planet', 'go')]
export const START = { gambits: CORE, breed: 'grunt' }
export const PREDATOR = { runner: 'grunt', grunt: 'tank', tank: 'runner' }
export const PAUSE_S = 60, REPLAY_SPEED = 5
export function fit(list, k) {
  const priority = r => ['weaker_enemy_near', 'free_planet', 'enemy_planet'].includes(r.if) ? 0 : r.if === 'always' ? 2 : 1
  const picked = list.map((rule, i) => ({ i, priority: priority(rule) })).sort((a, b) => a.priority - b.priority || a.i - b.i).slice(0, k)
  const indices = new Set(picked.map(x => x.i))
  return list.filter((_, i) => indices.has(i))
}
export function house(_round, slots, history, seed) {
  const last = history.at(-1)
  return { gambits: fit(DOCTRINES.pincer, slots).map(({on, ...rule}) => rule), breed: !last ? BREEDS[((seed % 3) + 3) % 3] : last.result.winner === 0 ? PREDATOR[last.bots[0].breed] : last.bots[1].breed }
}
export function refusal(gambits, breed, max) {
  const problems = []
  if (!BREEDS.includes(breed)) problems.push(`breed "${breed}" is not one of ${BREEDS.join(', ')}`)
  if (!Array.isArray(gambits)) problems.push('send a list of rules')
  else {
    if (!gambits.length) problems.push('send at least one rule')
    if (gambits.length > max) problems.push(`you sent ${gambits.length} rules but you have ${max} slots this round: keep your ${max} most important rules`)
    gambits.forEach((r, i) => {
      if (!r || typeof r !== 'object' || Array.isArray(r)) { problems.push(`rule ${i + 1}: send a rule object`); return }
      const inline = /^(\w+)\(([\d.]+)\)$/.exec(r.if)
      if (inline && Object.hasOwn(CONDITIONS, inline[1])) problems.push(`rule ${i + 1}: write the number in p, as {"if":"${inline[1]}","then":"${r.then}","p":${inline[2]}}`)
      else if (!Object.hasOwn(CONDITIONS, r.if)) problems.push(`rule ${i + 1}: unknown condition "${r.if}" (use one of ${Object.keys(CONDITIONS).join(', ')})`)
      if (!Object.hasOwn(ACTIONS, r.then)) problems.push(`rule ${i + 1}: unknown action "${r.then}" (use one of ${Object.keys(ACTIONS).join(', ')})`)
      if (r.p !== undefined && !(Number.isFinite(r.p) && r.p > 0 && r.p <= 100000)) problems.push(`rule ${i + 1}: p must be a number above 0 and at most 100000`)
      if (r.on !== undefined && typeof r.on !== 'boolean') problems.push(`rule ${i + 1}: on must be true or false`)
    })
  }
  return problems.length ? `Refused, your previous bot still plays: ${problems.join('; ')}. Fix it and call set_bot again now` : null
}
const clone = x => structuredClone(x)
const canonical = list => list.map(r => ({ if:r.if, ...(r.p !== undefined && {p:r.p}), then:r.then, on:r.on !== false }))
const since = (m, now) => Math.max(0, Math.round((now - m.pauseStart) / 1000)) // seconds into the pause, as the editor shows them
const label = w => w === null ? 'Draw' : w === 0 ? 'You win' : 'House wins'
export function startRounds({seed, breed, now, seconds = ROUNDS.seconds, of = ROUNDS.count}) {
  if (!Number.isSafeInteger(seed) || !BREEDS.includes(breed) || !Number.isFinite(now) || !Number.isFinite(seconds) || seconds <= 0 || !Number.isInteger(of) || of < 1 || of > 100) throw new Error('Invalid rounds settings.')
  return {id:`${seed}-${now}`, seed, planets:17, seconds, of, phase:'pause', round:1, score:[0,0], slots:[ROUNDS.slots,ROUNDS.slots], bot:{breed,gambits:canonical(START.gambits)}, versions:[], refused:[], rounds:[], history:[], pauseStart:now, deadline:now+PAUSE_S*1000, fight:null, result:null}
}
export const nextWake = m => m && m.phase !== 'over' ? m.deadline : null
// clock: the real time after a round's simulation, so the 15 s replay window starts once the round is computed
export function advance(m, now, clock = () => now) {
  if (!m) return m
  while (m.phase !== 'over' && now >= m.deadline) {
    const at = m.deadline
    if (m.phase === 'pause') {
      const bots = [clone(m.bot), house(m.round,m.slots[1],m.history,m.seed)]
      const result = playRound(m.seed,bots,{seconds:m.seconds,planets:m.planets})
      m.history.push({round:m.round,bots:clone(bots),result:clone(result)})
      if (result.winner !== null) m.score[result.winner]++
      const n = result.ruleUse[0].reduce((a,b)=>a+b,0)
      m.rounds.push({round:m.round,result:label(result.winner),reason:result.reason,endedAt:result.t,planets:{you:result.planets[0],house:result.planets[1]},units:{you:result.units[0],house:result.units[1]},timeline:result.timeline,yourArmy:{breed:bots[0].breed,atStart:result.roles.start[0],atEnd:result.roles.end[0]},houseArmy:{breed:bots[1].breed,atStart:result.roles.start[1],atEnd:result.roles.end[1]},yourRules:bots[0].gambits.map((r,i)=>({rule:describe(r),share:n ? result.ruleUse[0][i]/n : 0})),bots:clone(bots)})
      m.slots = nextSlots(m.slots,result.winner)
      m.fight = {round:m.round,bots,seconds:m.seconds,counter:ROUNDS.counter,planets:m.planets}
      const replay=m.seconds/REPLAY_SPEED*1000
      m.phase='fight'; m.deadline=at+replay > now ? Math.max(at, clock())+replay : at+replay // a missed window stays missed
    } else if (m.round >= m.of) {
      m.phase='over'; m.fight=null; m.deadline=null; m.result=label(m.score[0]===m.score[1] ? null : m.score[0]>m.score[1] ? 0 : 1)
    } else {
      m.round++; m.phase='pause'; m.pauseStart=at; m.deadline=at+PAUSE_S*1000; m.versions=[]; m.refused=[]; m.fight=null
    }
  }
  return m
}
export function setBot(m, who, data, now) {
  advance(m,now)
  if (!m) return {error:'No rounds match. Start rounds first.'}
  const errorTime = m.phase !== 'pause' ? `Too late: the gong rang, round ${data?.round} plays your previous bot.` : data?.round !== m.round ? `Refused: this pause is before round ${m.round}, not round ${data?.round}. Resend with round ${m.round}.` : null
  const breed = data?.breed ?? m.bot.breed
  const error = errorTime || refusal(data?.gambits,breed,m.slots[0]) || (typeof data?.why !== 'string' || data.why.length > 300 ? 'Refused: why must be a string of at most 300 characters.' : null)
  if (error) { m.refused.push({at:since(m,now),who,error}); return {error} }
  const bot={breed,gambits:canonical(data.gambits)}, invalid=checkBot(bot)
  if (invalid) { const error=`Refused, your previous bot still plays: ${invalid}.`; m.refused.push({at:since(m,now),who,error}); return {error} }
  m.bot=bot; m.versions.push({at:since(m,now),who,breed,rules:bot.gambits.length,why:data.why}); return {ok:true}
}
export function ready(m, round, now, clock) {
  advance(m,now,clock)
  if (!m || m.phase !== 'pause' || round !== m.round) return {error:'No matching planning pause. The gong may already have rung.'}
  m.deadline=now; advance(m,now,clock); return {ok:true}
}
export function publicMatch(m, now) {
  if (!m) return null
  return clone({id:m.id,seed:m.seed,planets:m.planets,phase:m.phase,round:m.round,of:m.of,score:{you:m.score[0],house:m.score[1]},slots:{you:m.slots[0],house:m.slots[1]},secondsLeft:m.deadline === null ? 0 : Math.max(0,Math.ceil((m.deadline-now)/1000)),bot:m.bot,versions:m.versions,refused:m.refused,fight:m.phase==='fight' ? {...m.fight,msLeft:Math.max(0,m.deadline-now)} : null,rounds:m.rounds,result:m.result})
}
