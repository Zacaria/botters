import { matchOptions, HOUSE, checkGambits } from './sim.js'

const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const canonicalOptions = options => ({ ...matchOptions(options), vs: [...Object.keys(HOUSE), 'player'].includes(options?.vs) ? options.vs : 'normal', planning: [10, 20, 30].includes(options?.planning) ? options.planning : 20 })
const current = session => session.preparation && session.agentGranted !== false && session.preparation.doctrine === session.doctrine && session.preparation.agentVersion === (session.agentVersion || 0)

export function createPreparation(session, options, id) {
  return { id, options: canonicalOptions(options), doctrine: session.doctrine, agentVersion: session.agentVersion || 0, gambits: null, why: '' }
}

export function preparationReady(session, options = session.preparation?.options) {
  return !!(current(session) && !checkGambits(session.preparation.gambits) && JSON.stringify(session.preparation.options) === JSON.stringify(canonicalOptions(options)))
}

export function savePreparation(session, { preparationId, gambits, why }) {
  if (!current(session) || session.preparation.id !== preparationId) fail(409, 'Preparation is stale. Ask your human to prepare again.')
  const error = checkGambits(gambits)
  if (error) fail(400, error)
  session.preparation = { ...session.preparation, gambits: gambits.map(r => ({ if: r.if, ...(r.p !== undefined ? { p: r.p } : {}), then: r.then, on: r.on !== false })), why: typeof why === 'string' ? why.trim().slice(0, 120) : '' }
  return session.preparation
}
