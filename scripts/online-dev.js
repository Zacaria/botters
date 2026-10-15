// Local test harness only. Not packaged or imported by the Vercel handler.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { MemoryStore, ConvexStore } from '../online/store.js'
import { createHandler } from '../online/http.js'
const port = Number(process.env.PORT || 8788), origin = `http://127.0.0.1:${port}`
const speed = Number(process.env.BOTTERS_TEST_SPEED || 1), start = Date.now()
const now = () => start + (Date.now() - start) * speed
const store = process.env.BOTTERS_DEV_CONVEX ? new ConvexStore() : new MemoryStore(now)
const handler = createHandler(store, { origin, now })
const staticFiles = { '/': ['index.html', 'text/html'], '/guide': ['guide.html', 'text/html'], '/guide.html': ['guide.html', 'text/html'], '/sim.js': ['sim.js', 'text/javascript'] }
http.createServer(async (req, res) => {
  const url = new URL(req.url, origin), file = staticFiles[url.pathname] || (/^\/r\/[A-Z2-9]{6}$/i.test(url.pathname) ? staticFiles['/'] : null)
  if (!file) return handler(req, res)
  res.writeHead(200, { 'content-type': file[1], 'Referrer-Policy': 'no-referrer' }); res.end(await readFile(new URL(`../${file[0]}`, import.meta.url)))
}).listen(port, '127.0.0.1', () => console.log(`Online development harness: ${origin} (clock ×${speed}; ${process.env.BOTTERS_DEV_CONVEX ? 'Convex' : 'ephemeral test storage'})`))
