// Isolated loopback-only browser fixture. Never imported by production.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { betterAuth } from 'better-auth/minimal'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { authOptions } from '../online/auth-options.js'
import { MemoryStore } from '../online/store.js'
import { createHandler } from '../online/http.js'
const port = Number(process.env.PORT || 8789), origin = `http://127.0.0.1:${port}`
const database = { user: [], account: [], session: [], verification: [], rateLimit: [] }, mail = []
const auth = betterAuth({ ...authOptions({ SITE_URL: origin, BETTER_AUTH_SECRET: 'isolated-browser-only-secret-123456789012345' }, async message => mail.push(message)), database: memoryAdapter(database) })
const start = Date.now(), now = () => start + (Date.now() - start) * 10
const game = createHandler(new MemoryStore(now), { origin, now, requireAccount: true, env: { BOTTERS_AUTH_ORIGIN: origin }, resolveAccount: async req => {
  const session = await auth.api.getSession({ headers: new Headers(req.headers), query: { disableCookieCache: true, disableRefresh: true } })
  return session?.user?.emailVerified ? { id: session.user.id, name: session.user.name, emailVerified: true } : null
} })
const assets = { '/': ['index.html', 'text/html'], '/sim.js': ['sim.js', 'text/javascript'], '/guide': ['guide.html', 'text/html'], '/privacy': ['privacy.html', 'text/html'], '/terms': ['terms.html', 'text/html'] }
http.createServer(async (req, res) => {
  const url = new URL(req.url, origin)
  if (url.pathname === '/test/mail') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(mail.filter(m => m.to === url.searchParams.get('email')).map(m => ({ text: m.text, subject: m.subject })))) }
  const asset = assets[url.pathname] || (/^\/r\/[A-Z2-9]{6}$/.test(url.pathname) ? assets['/'] : null)
  if (asset) { res.setHeader('Content-Type', asset[1]); return res.end(await readFile(new URL(`../${asset[0]}`, import.meta.url))) }
  if (url.pathname.startsWith('/api/auth/')) {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const response = await auth.handler(new Request(url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined }))
    for (const [name, value] of response.headers) if (name !== 'set-cookie') res.setHeader(name, value)
    res.setHeader('Set-Cookie', response.headers.getSetCookie()); res.writeHead(response.status); return res.end(await response.text())
  }
  return game(req, res)
}).listen(port, '127.0.0.1', () => console.log(`Isolated auth fixture: ${origin}; captured mail only, clock ×10`))
