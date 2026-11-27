import { createAuth } from './auth.js'
import { json, failure, bytes } from './http.js'
import { hash, clientAddress } from './authority.js'
import { gameTransport } from './game-transport.js'
import { oauthRoute, oauthHTTP, authenticate } from './oauth.js'
import { rangeResponse } from './media.js'
export { MatchRoom } from './match-room.js'
export { AgentGateway } from './agent-gateway.js'

const accepted = new Map()
const gamePaths = new Set(['/account','/session','/exchange','/rules','/leaderboard','/agent/pair','/agent/poll','/agent/request','/agent/approve','/agent/revoke','/lobby','/profile','/room','/rooms','/rooms/leave','/rooms/join','/rooms/player','/rooms/settings','/rooms/start','/rooms/rematch','/cancel','/start-without-agent','/play','/next','/state','/events','/surrender','/input','/say','/chat','/call','/dismiss','/socket'])
const publicProtocol = path => path === '/mcp' || oauthRoute(path) && !path.startsWith('/consent')
const cors = { 'access-control-allow-origin':'*', 'access-control-allow-methods':'GET, POST, DELETE, OPTIONS', 'access-control-allow-headers':'authorization, content-type, mcp-session-id, mcp-protocol-version, last-event-id', 'access-control-expose-headers':'mcp-session-id, www-authenticate' }
async function dispatch(request,env) {
  const url = new URL(request.url)
  if (!env.SITE_URL || new URL(env.SITE_URL).origin !== env.SITE_URL) throw new Error('Site origin not configured')
  if (!publicProtocol(url.pathname) && request.headers.has('origin') && request.headers.get('origin') !== env.SITE_URL) return json({ error:'Use Botters from its own site.' },403)
  const bearer = url.pathname === '/mcp' && /^Bearer ([A-Za-z0-9_-]{32})$/.exec(request.headers.get('authorization') || '')?.[1], id = bearer && hash(bearer)
  // Refuse excess requests before database work, using accepted agent credentials or the sender address.
  if (env.BURST && (gamePaths.has(url.pathname) || url.pathname === '/mcp' || url.pathname.startsWith('/api/auth/'))) {
    if (!(await env.BURST.limit({ key: accepted.get(id) > Date.now() ? `agent:${id}` : clientAddress(request) })).success) return json({ error:'Too many requests. Slow down and retry.' },429,{ 'retry-after':'10' })
  }
  if (url.pathname.startsWith('/api/auth/')) {
    const headers = new Headers(request.headers)
    headers.set('x-botters-client-ip',request.headers.get('cf-connecting-ip') || 'local')
    return createAuth(env).handler(new Request(request,{headers,body:await bytes(request) ?? undefined}))
  }
  if (oauthRoute(url.pathname)) return oauthHTTP(env,request)
  if (url.pathname === '/mcp') {
    const grant = await authenticate(env,request)
    if (accepted.size >= 5000) accepted.clear()
    accepted.set(id,Date.now() + 600000)
    return env.AGENTS.getByName(grant.grantId).fetch(request)
  }
  if (gamePaths.has(url.pathname)) return gameTransport(env,request)
  if (url.pathname === '/live-config.json') return json({url:env.SITE_URL,accountRequired:true})
  if (url.pathname === '/media/public-demo.webm' && request.method === 'GET' && request.headers.has('range') && env.ASSETS) return rangeResponse(request,() => env.ASSETS.fetch(request.url))
  if (/^\/r\/[A-Z2-9]{6}$/.test(url.pathname)) return env.ASSETS.fetch(new Request(new URL('/',request.url),request))
  return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found',{status:404})
}
export default {
  async fetch(request,env) {
    const path = new URL(request.url).pathname, protocol = publicProtocol(path)
    if (request.method === 'OPTIONS' && protocol) return new Response(null,{status:204,headers:cors})
    let response
    try { response = await dispatch(request,env) }
    catch(e) {
      // A client drops its tokens on invalid_grant and registers again on invalid_client: name each case exactly.
      if (oauthRoute(path)) response = json({error:!e.status || e.status >= 500 ? 'server_error' : e.status === 429 ? 'temporarily_unavailable' : e.code || (path === '/token' ? 'invalid_grant' : 'invalid_request'),error_description:e.status ? e.message : 'Authorization service unavailable.'},e.status || 503,e.status === 429 ? {'retry-after':String(600-Math.floor(Date.now()/1000)%600)} : {})
      else response = failure(e)
    }
    if (!protocol && response.status !== 101) {
      const headers = new Headers(response.headers)
      headers.set('referrer-policy', 'no-referrer')
      headers.set('x-content-type-options', 'nosniff')
      if (!headers.has('content-security-policy')) headers.set('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://play.botters.havesomecode.io wss://play.botters.havesomecode.io; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
      return new Response(response.body, {status: response.status, statusText: response.statusText, headers})
    }
    if (!protocol) return response
    const headers = new Headers(response.headers)
    for (const [key,value] of Object.entries(cors)) headers.set(key,value)
    if (path === '/mcp' && response.status === 401) headers.set('www-authenticate',`Bearer resource_metadata="${env.SITE_URL}/.well-known/oauth-protected-resource/mcp", error="invalid_token"`)
    return new Response(response.body,{status:response.status,headers})
  },
  async scheduled(_event,env) {
    for (let pass = 0; pass < 40; pass++) {
      const done = await env.DB.prepare('DELETE FROM game_records WHERE key IN (SELECT key FROM game_records WHERE expires>0 AND expires<? LIMIT 500)').bind(Date.now()).run()
      if (!(done.meta?.changes >= 500)) break
    }
    // Sign-in counters are only read within their ten-minute window.
    await env.DB.prepare('DELETE FROM rateLimit WHERE lastRequest<?').bind(Date.now() - 600000).run()
  },
}
