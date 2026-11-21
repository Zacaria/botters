import { OnlineGame } from '../online/game.js'
import { D1Store } from './d1-store.js'
import { authorize, hash, proof, exchange, denied } from './authority.js'
import { createAuth, identity } from './auth.js'
import { transaction } from '../online/store.js'
export const json = (value, status = 200, headers = {}) => Response.json(value, { status, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', ...headers } })
export function failure(e) { return json({ error: e.status ? e.message : 'Online service is unavailable. Retry shortly.' }, e.status || 503) }
export async function body(request, max = 16384) {
  if (!request.body) return {}
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw Object.assign(new Error('Send JSON.'), { status: 415 })
  const reader = request.body.getReader(), chunks = []; let size = 0
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > max) throw Object.assign(new Error('Request is too large.'), { status: 413 }); chunks.push(value) } }
  finally { await reader.cancel() }
  if (!size) return {}
  try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(chunks.flatMap(c => [...c])))) }
  catch { throw Object.assign(new Error('Send valid JSON.'), { status: 400 }) }
}
export async function runGame(env, method, path, q = new URLSearchParams(), data = {}, user = null, store = new D1Store(env.DB), stateCache = null) {
  const game = new OnlineGame(store, { requireAccount: true, liveExchange: true, origin: env.SITE_URL, identity: user, stateCache, deadline: performance.now() + 4000 })
  return game.request(method, path, q, data)
}
export async function admission(env, request) {
  const url = new URL(request.url), bearer = url.searchParams.get('token') || ''
  return authorize(env, `token:${hash(bearer)}`, proof(request, env))
}
export async function gameHTTP(env, request, stateCache = null) {
  const url = new URL(request.url), path = url.pathname, store = new D1Store(env.DB)
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405)
  const auth = createAuth(env), user = await identity(auth, request)
  if (path === '/account') return json({ required: true, origin: env.SITE_URL, user: user ? { id: user.id, name: user.name, emailVerified: true } : null })
  const data = request.method === 'POST' ? await body(request) : {}
  if (path === '/exchange' && request.method === 'POST') return json({ ok: true }, 200, { 'set-cookie': await exchange(env, store, data.ticket, user) })
  if (path === '/session' && request.method === 'POST' || path === '/agent/pair' && request.method === 'POST') {
    const ip = request.headers.get('cf-connecting-ip') || 'local'
    await transaction(store, async tx => {
      const counter = await tx.get(`limit:${hash(ip)}:${path}:${Math.floor(Date.now() / 600000)}`, { n: 0 }, 600)
      if (counter.n++ >= (path === '/session' ? 20 : 200)) throw Object.assign(new Error('Too many requests. Retry in ten minutes.'), { status: 429 })
    })
  } else if (path === '/agent/poll') {
    if (await store.get(`token:${hash(url.searchParams.get('token') || '')}`)) await admission(env, request)
  } else if (!['/rules', '/leaderboard'].includes(path)) {
    const admitted = await admission(env, request)
    if (admitted.token.role === 'human' && (user?.id !== admitted.session.accountId || user?.authSessionId !== admitted.token.authSessionId)) throw denied()
  }
  const result = await runGame(env, request.method, path, url.searchParams, data, user, store, stateCache)
  // Wake a newly-created match even when neither participant opens a socket.
  const humanToken = result.humanToken || url.searchParams.get('token')
  const t = humanToken && await store.get(`token:${hash(humanToken)}`)
  const session = t && await store.get(`session:${JSON.parse(t).id}`)
  const matchId = session && JSON.parse(session).match
  if (matchId) await env.MATCHES.getByName(matchId).wake(matchId)
  return json(result)
}
