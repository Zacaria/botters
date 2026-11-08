import { ConvexStore } from '../online/store.js'
import { createHandler } from '../online/http.js'
import { proxyAuth } from '../online/auth.js'
import { createPostgresAuth } from '../online/postgres-auth.js'
import { PostgresStore } from '../online/postgres-store.js'

export async function createPostgresControl({ pool, env, sendEmail }) {
  const origin = new URL(env.SITE_URL)
  if (origin.origin !== env.SITE_URL || env.BOTTERS_AUTH_ORIGIN !== origin.origin ||
      !(origin.protocol === 'https:' || origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) || !env.BOTTERS_STORE_NAMESPACE) throw new Error('Invalid PostgreSQL control configuration.')
  await pool.query('SELECT namespace, key, value, expires_at FROM botters_records LIMIT 0')
  await pool.query('SELECT s.id, s."userId", s."expiresAt", u.id, u."emailVerified" FROM session s JOIN "user" u ON u.id = s."userId" LIMIT 0')
  const { auth } = await createPostgresAuth({ pool, env, sendEmail })
  const store = new PostgresStore(pool, env.BOTTERS_STORE_NAMESPACE)
  const config = { origin: origin.origin, site: origin.origin, secret: '' }
  const localFetch = (url, init) => auth.handler(new Request(url, init))
  const handler = createHandler(store, { origin: origin.origin, origins: [origin.origin], env, requireAccount: true, controlOnly: true, liveExchange: true,
    proxyAuth: (req, res, path, body) => proxyAuth(req, res, path, body, env, localFetch, config),
    resolveAccount: async req => {
      if (!req.headers.cookie || req.headers.host !== origin.host) return null
      const data = await auth.api.getSession({ headers: new Headers({ cookie: req.headers.cookie }), query: { disableCookieCache: true, disableRefresh: true } })
      const expires = new Date(data?.session?.expiresAt).getTime()
      if (!data?.user || data.user.emailVerified !== true || typeof data.user.id !== 'string' || !data.session?.id || !Number.isFinite(expires) || expires <= Date.now()) return null
      return { id: data.user.id, name: data.user.name, emailVerified: true, authSessionId: data.session.id, authExpires: expires }
    },
  })
  return (req, res) => {
    // Only the socket peer is authoritative without an explicitly trusted ingress.
    delete req.headers['x-vercel-forwarded-for']
    if (req.url.startsWith('/api/auth/')) req.url = req.url.slice(4)
    return handler(req, res)
  }
}

export default createHandler(new ConvexStore(), { requireAccount: true, controlOnly: true, liveExchange: true })
