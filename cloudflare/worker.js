import { createAuth } from './auth.js'
import { json, failure } from './http.js'
import { gameTransport } from './game-transport.js'
import { oauthRoute, oauthHTTP, authenticate } from './oauth.js'
export { MatchRoom } from './match-room.js'
export { AgentGateway } from './agent-gateway.js'

const gamePaths = new Set(['/account','/session','/exchange','/rules','/leaderboard','/agent/pair','/agent/poll','/agent/request','/agent/approve','/agent/revoke','/lobby','/profile','/room','/rooms','/rooms/leave','/rooms/join','/rooms/player','/rooms/settings','/rooms/start','/rooms/rematch','/cancel','/start-without-agent','/play','/next','/state','/events','/surrender','/input','/call','/dismiss','/socket'])
const publicProtocol = path => path === '/mcp' || oauthRoute(path) && !path.startsWith('/consent')
const cors = { 'access-control-allow-origin':'*', 'access-control-allow-methods':'GET, POST, DELETE, OPTIONS', 'access-control-allow-headers':'authorization, content-type, mcp-session-id, mcp-protocol-version, last-event-id', 'access-control-expose-headers':'mcp-session-id, www-authenticate' }
async function dispatch(request,env) {
  const url = new URL(request.url)
  if (!env.SITE_URL || new URL(env.SITE_URL).origin !== env.SITE_URL) throw new Error('Site origin not configured')
  if (!publicProtocol(url.pathname) && request.headers.has('origin') && request.headers.get('origin') !== env.SITE_URL) return json({ error:'Use Botters from its own site.' },403)
  if (url.pathname.startsWith('/api/auth/')) {
    const headers = new Headers(request.headers)
    headers.set('x-botters-client-ip',request.headers.get('cf-connecting-ip') || 'local')
    return createAuth(env).handler(new Request(request,{headers}))
  }
  if (oauthRoute(url.pathname)) return oauthHTTP(env,request)
  if (url.pathname === '/mcp') {
    const grant = await authenticate(env,request)
    return env.AGENTS.getByName(grant.grantId).fetch(request)
  }
  if (gamePaths.has(url.pathname)) return gameTransport(env,request)
  if (url.pathname === '/live-config.json') return json({url:env.SITE_URL,accountRequired:true})
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
      if (oauthRoute(path)) response = json({error:!e.status || e.status >= 500 ? 'server_error' : path === '/token' ? 'invalid_grant' : 'invalid_request',error_description:e.status ? e.message : 'Authorization service unavailable.'},e.status || 503)
      else response = failure(e)
    }
    if (!protocol) return response
    const headers = new Headers(response.headers)
    for (const [key,value] of Object.entries(cors)) headers.set(key,value)
    if (path === '/mcp' && response.status === 401) headers.set('www-authenticate',`Bearer resource_metadata="${env.SITE_URL}/.well-known/oauth-protected-resource/mcp", error="invalid_token"`)
    return new Response(response.body,{status:response.status,headers})
  },
  async scheduled(_event,env) {
    await env.DB.prepare('DELETE FROM game_records WHERE key IN (SELECT key FROM game_records WHERE expires>0 AND expires<? LIMIT 500)').bind(Date.now()).run()
  },
}
