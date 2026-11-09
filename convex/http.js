import { httpRouter, httpActionGeneric } from 'convex/server'
import { createAuth } from './auth.js'
const http = httpRouter()
const handler = httpActionGeneric(async (ctx, request) => {
  // Only the same-origin Vercel proxy may reach auth, including rate-limit IP input.
  const secret = process.env.BOTTERS_AUTH_PROXY_SECRET
  if (!secret || secret.length < 32 || request.headers.get('x-botters-auth-proxy') !== secret) return new Response('Not found', { status: 404 })
  try {
    const auth = createAuth(ctx)
    // Private server identity lookup, not a public auth attempt. Keep fresh
    // session/user reads without writing a second abuse bucket on every reload.
    if (request.method === 'GET' && new URL(request.url).pathname === '/api/auth/get-session') return Response.json(await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true, disableRefresh: true } }))
    return await auth.handler(request)
  }
  catch { return Response.json({ message: 'Sign-in is unavailable. Retry shortly.' }, { status: 503 }) }
})
for (const method of ['GET', 'POST']) http.route({ pathPrefix: '/api/auth/', method, handler })
export default http
