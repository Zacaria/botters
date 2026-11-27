import { createAuth } from './auth.js'
import { json, failure } from './http.js'
import { gameTransport } from './game-transport.js'
import { oauthRoute, oauthHTTP, authenticate } from './oauth.js'
export { MatchRoom } from './match-room.js'
export { AgentGateway } from './agent-gateway.js'

const gamePaths = new Set(['/account','/session','/exchange','/rules','/leaderboard','/agent/pair','/agent/poll','/agent/request','/agent/approve','/agent/revoke','/lobby','/profile','/room','/rooms','/rooms/leave','/rooms/join','/rooms/player','/rooms/settings','/rooms/start','/rooms/rematch','/cancel','/start-without-agent','/play','/next','/state','/events','/surrender','/input','/say','/chat','/call','/dismiss','/socket'])
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
  if (url.pathname === '/media/public-demo.webm' && request.method === 'GET' && request.headers.has('range') && env.ASSETS) {
    const response = await env.ASSETS.fetch(request)
    if (response.status !== 200) return response
    const reader = response.body.getReader(), chunks = []; let length = 0
    try {
      for (;;) {
        const {value,done} = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > 20 * 1024 * 1024) throw new Error('Video asset exceeds limit')
        chunks.push(value)
      }
    } finally { await reader.cancel() }
    const bytes = new Uint8Array(length); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength }
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range'))
    const a = match?.[1], b = match?.[2]
    const start = a ? Number(a) : Math.max(0, length - Number(b)), end = a && b ? Math.min(Number(b), length - 1) : length - 1
    if (!match || (!a && !b) || (!a && Number(b) === 0) || (a && !Number.isSafeInteger(Number(a))) || (b && !Number.isSafeInteger(Number(b))) || start >= length || start > end) {
      return new Response(null,{status:416,headers:{'content-range':`bytes */${length}`}})
    }
    const headers = new Headers(response.headers)
    headers.set('content-range',`bytes ${start}-${end}/${length}`)
    headers.set('content-length',String(end-start+1))
    headers.set('accept-ranges','bytes')
    return new Response(bytes.slice(start,end+1),{status:206,headers})
  }
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
  },
}
