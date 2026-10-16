import { createHash } from 'node:crypto'
import { OnlineGame } from './game.js'
import { transaction } from './store.js'
import { proxyAuth, resolveAccount, consumeAuthLimit } from './auth.js'
import { liveCookieProof } from './live-cookie.js'
const delay = ms => new Promise(r => setTimeout(r, ms))
const json = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)) }

export function createHandler(store, options = {}) {
  return async (req, res) => {
    const entered = performance.now(), deadline = entered + (options.requestMs || 55000)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    let closed = false, game
    res.on('close', () => { closed = true })
    try {
      const origin = options.origin || `https://${req.headers.host}`
      const url = new URL(req.url, origin), path = url.searchParams.get('route') || url.pathname
      if (req.headers.origin && !(options.origins || [origin]).includes(req.headers.origin)) return json(res, 403, { error: 'Use the game from its own site.' })
      if (options.controlOnly && !['/session', '/account', '/rules'].includes(path) && !path.startsWith('/agent/') && !path.startsWith('/auth/')) return json(res, 410, { error: 'Live matches moved to play.botters.havesomecode.io. Reload the website or restart your agent.' })
      let body = {}
      if (req.method === 'POST') {
        // Node IncomingMessage in tests, Vercel may preparse req.body.
        if (req.body !== undefined) {
          if (Buffer.byteLength(typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) > 16384) return json(res, 413, { error: 'Request is too large.' })
          body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
        } else {
          let raw = ''
          for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 16384) return json(res, 413, { error: 'Request is too large.' }) }
          body = raw ? JSON.parse(raw) : {}
        }
      }
      if (path.startsWith('/auth/')) {
        await consumeAuthLimit(store, req, path.slice(5), { deadline })
        return await proxyAuth(req, res, path.slice(5), body, options.env)
      }
      const identity = options.requireAccount ? await (options.resolveAccount || resolveAccount)(req, options.env) : null
      if (req.method === 'GET' && path === '/account') return json(res, 200, { required: !!options.requireAccount, origin: options.env?.BOTTERS_AUTH_ORIGIN || process.env.BOTTERS_AUTH_ORIGIN || 'https://botters.havesomecode.io', user: identity ? { id: identity.id, name: identity.name, emailVerified: true } : null })
      const gameOrigin = options.requireAccount ? options.env?.BOTTERS_AUTH_ORIGIN || process.env.BOTTERS_AUTH_ORIGIN || 'https://botters.havesomecode.io' : origin
      game = options.runtime || new OnlineGame(store.scoped?.() || store, { ...options, identity, origin: gameOrigin, deadline })
      if (req.method === 'POST' && ['/session', '/agent/pair'].includes(path)) {
        const ip = req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown'
        const key = `session-limit:${createHash('sha256').update(String(ip)).digest('hex')}:${Math.floor(Date.now() / 600000)}`
        await transaction(store, async tx => {
          const rate = await tx.get(key, { n: 0 }, 600)
          if (rate.n >= 20) throw Object.assign(new Error('Too many new lobbies. Retry in ten minutes.'), { status: 429 })
          rate.n++
        }, { deadline })
      }
      if (path === '/stream') return json(res, 410, { error: 'Live matches use WebSockets. Reload the website.' })
      const timeoutMax = path === '/next' ? 45 : 20
      const timeout = Math.min(timeoutMax, Math.max(0, Number(url.searchParams.get('timeout') || 0) || 0)) * 1000
      const pollDeadline = Math.min(deadline - 1000, entered + timeout)
      let result
      do {
        result = await game.request(req.method, path, url.searchParams, body, options.runtime ? liveCookieProof(req.headers.cookie, options.liveCookieName) : undefined)
        const waiting = req.method === 'GET' && (path === '/agent/poll' ? !result.approved : path === '/next' ? !result.match : path === '/events' ? result.state && !result.state.ended && !result.events.length : false)
        if (!waiting || performance.now() >= pollDeadline || closed) break
        await delay(Math.min(500, Math.max(0, pollDeadline - performance.now())))
      } while (!closed)
      if (!closed) json(res, 200, result)
    } catch (e) {
      // Never emit tokens, store replies or raw exception stacks in logs/HTTP.
      if (closed) return
      if (res.headersSent) { res.write('event: unavailable\ndata: {}\n\n'); res.end() }
      else json(res, e.status || (e instanceof SyntaxError ? 400 : 503), { error: e.status ? e.message : e instanceof SyntaxError ? 'Send valid JSON.' : 'Online service is unavailable. Retry shortly.' })
    } finally {
      // Live capability checks and frames have process-wide ownership.
    }
  }
}
