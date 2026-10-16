import { createHash } from 'node:crypto'
import { transaction } from './store.js'

const clientIP = req => String(req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()
// Atomic durable outer boundary: the library's adapter uses non-atomic increments.
export async function consumeAuthLimit(store, req, path, { now = Date.now(), deadline = Infinity } = {}) {
  const [window, max] = path === '/sign-in/email' ? [60000, 5] : ['/sign-up/email', '/request-password-reset', '/send-verification-email'].includes(path) ? [600000, path === '/sign-up/email' ? 5 : 3] : [60000, 30]
  const group = ['/sign-in/email', '/sign-up/email', '/request-password-reset', '/send-verification-email'].includes(path) ? path : 'other'
  const hash = createHash('sha256').update(clientIP(req)).digest('hex')
  return transaction(store, async tx => {
    const record = await tx.get(`auth-limit:${group}:${hash}:${Math.floor(now / window)}`, { n: 0 }, window / 1000 + 60)
    if (record.n >= max) throw Object.assign(new Error('Too many sign-in attempts. Retry later.'), { status: 429 })
    record.n++
  }, { deadline })
}

const routes = new Map([
  ['/sign-up/email', 'POST'], ['/sign-in/email', 'POST'], ['/sign-in/social', 'POST'],
  ['/send-verification-email', 'POST'], ['/verify-email', 'GET'],
  ['/request-password-reset', 'POST'], ['/reset-password', 'POST'],
  ['/sign-out', 'POST'], ['/callback/google', 'GET'],
])
export function authBackend(env = process.env) {
  const site = new URL(env.BOTTERS_AUTH_SITE_URL || 'https://invalid.invalid')
  const origin = new URL(env.BOTTERS_AUTH_ORIGIN || 'https://botters.havesomecode.io').origin
  if (!site.hostname.endsWith('.convex.site') || site.protocol !== 'https:' || !env.BOTTERS_AUTH_PROXY_SECRET || env.BOTTERS_AUTH_PROXY_SECRET.length < 32) throw Object.assign(new Error('Sign-in is not configured.'), { status: 503 })
  return { site: site.origin, origin, secret: env.BOTTERS_AUTH_PROXY_SECRET }
}
function headersFor(req, config) {
  const headers = new Headers({ 'content-type': 'application/json', 'x-botters-auth-proxy': config.secret })
  if (req.headers.cookie) headers.set('cookie', req.headers.cookie)
  if (req.headers.origin) headers.set('origin', req.headers.origin)
  // Vercel overwrites this header; never trust arbitrary x-forwarded-for.
  headers.set('x-botters-client-ip', clientIP(req))
  return headers
}
export async function resolveAccount(req, env = process.env, fetcher = fetch) {
  if (!req.headers.cookie) return null
  const config = authBackend(env)
  if (new URL(`https://${req.headers.host}`).origin !== config.origin) return null
  const r = await fetcher(`${config.site}/api/auth/get-session?disableCookieCache=true&disableRefresh=true`, { headers: headersFor(req, config), redirect: 'manual', signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw Object.assign(new Error('Sign-in is unavailable. Retry shortly.'), { status: 503 })
  const data = await r.json(), user = data?.user
  const expires = new Date(data?.session?.expiresAt).getTime()
  if (!user || typeof user.id !== 'string' || user.emailVerified !== true || !Number.isFinite(expires) || expires <= Date.now()) return null
  return { id: user.id, name: user.name, emailVerified: true }
}
export async function proxyAuth(req, res, path, body, env = process.env, fetcher = fetch) {
  const config = authBackend(env), external = new URL(req.url, config.origin)
  const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }
  if (new URL(`https://${req.headers.host}`).origin !== config.origin) return send(400, { error: `Sign in at ${config.origin}.` })
  if (routes.get(path) !== req.method && !(req.method === 'GET' && /^\/reset-password\/[A-Za-z0-9_-]{10,256}$/.test(path))) return send(404, { error: 'Not found.' })
  if (req.method === 'POST' && req.headers.origin !== config.origin) return send(403, { error: 'Sign in from the Botters website.' })
  const query = new URLSearchParams(external.search); query.delete('route')
  // Canonical return paths only; clients cannot inject external post-login/reset redirects.
  if (body && typeof body === 'object') {
    for (const k of ['callbackURL', 'newUserCallbackURL', 'errorCallbackURL', 'redirectTo']) if (body[k] !== undefined && (!String(body[k]).startsWith('/') || String(body[k]).startsWith('//') || /[\\\r\n]/.test(String(body[k])))) return send(400, { error: 'Return to a Botters page.' })
    if (path === '/sign-in/social' && body.provider !== 'google') return send(400, { error: 'Use Google sign-in.' })
  }
  const upstream = await fetcher(`${config.site}/api/auth${path}${query.size ? '?' + query : ''}`, { method: req.method, headers: headersFor(req, config), body: req.method === 'POST' ? JSON.stringify(body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(12000) })
  const cookies = upstream.headers.getSetCookie()
  if (cookies.length) res.setHeader('Set-Cookie', cookies)
  const location = upstream.headers.get('location')
  if (location) {
    const target = new URL(location, config.origin)
    if (target.origin !== config.origin && target.origin !== 'https://accounts.google.com') return send(502, { error: 'Sign-in returned an unexpected address.' })
    res.setHeader('Location', target.href)
  }
  res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/json' })
  res.end(await upstream.text())
}
