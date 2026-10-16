import { httpRouter, httpActionGeneric } from 'convex/server'
import { createAuth } from './auth.js'
const http = httpRouter()
const handler = httpActionGeneric(async (ctx, request) => {
  // Only the same-origin Vercel proxy may reach auth, including rate-limit IP input.
  const secret = process.env.BOTTERS_AUTH_PROXY_SECRET
  if (!secret || secret.length < 32 || request.headers.get('x-botters-auth-proxy') !== secret) return new Response('Not found', { status: 404 })
  try { return await createAuth(ctx).handler(request) }
  catch { return Response.json({ message: 'Sign-in is unavailable. Retry shortly.' }, { status: 503 }) }
})
for (const method of ['GET', 'POST']) http.route({ pathPrefix: '/api/auth/', method, handler })
export default http
