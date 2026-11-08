// Local Colyseus harness; never deployed to Vercel.
import { readFile } from 'node:fs/promises'
import { servePublicMedia } from '../public-media.js'
import { createLiveServer } from '../online/live-server.js'
import { LiveDurable } from '../online/live-durable.js'
const port = Number(process.env.PORT || 8788), origin = `http://127.0.0.1:${port}`
const speed = Number(process.env.BOTTERS_TEST_SPEED || 1), start = Date.now()
const clockKey = process.env.NODE_ENV !== 'production' && !process.env.BOTTERS_DEV_CONVEX && process.env.BOTTERS_TEST_CLOCK_KEY
let controlledNow = 1700000000000
const now = clockKey ? () => controlledNow : () => start + (Date.now() - start) * speed
const remote = process.env.BOTTERS_DEV_CONVEX ? new LiveDurable() : null
const staticFiles = { '/': ['index.html', 'text/html'], '/guide': ['guide.html', 'text/html'], '/guide.html': ['guide.html', 'text/html'], '/sim.js': ['sim.js', 'text/javascript'], '/sim/pkg/botters_sim.js': ['sim/pkg/botters_sim.js', 'text/javascript'], '/sim/pkg/botters_sim_bg.wasm': ['sim/pkg/botters_sim_bg.wasm', 'application/wasm'], '/live-client.js': ['public/live-client.js', 'text/javascript'], '/privacy': ['privacy.html', 'text/html'], '/privacy.html': ['privacy.html', 'text/html'], '/terms': ['terms.html', 'text/html'], '/terms.html': ['terms.html', 'text/html'] }
const service = await createLiveServer({ remote, now, origin, origins: [origin], authority: remote?.authority.bind(remote),
  staticHandler: async (req, res) => {
    const url = new URL(req.url, origin)
    if (url.pathname === '/__test/advance' && clockKey) {
      if (req.method !== 'POST' || req.socket.remoteAddress !== '127.0.0.1' || req.headers.origin || req.headers['x-test-clock-key'] !== clockKey) { res.sendStatus(403); return true }
      let raw = ''
      if (req.body === undefined) for await (const chunk of req) { raw += chunk; if (raw.length > 128) { res.sendStatus(413); return true } }
      let ms
      try { ms = (req.body ?? JSON.parse(raw)).ms } catch { res.sendStatus(400); return true }
      if (!Number.isSafeInteger(ms) || ms < 0 || ms > 10000) { res.sendStatus(400); return true }
      controlledNow += ms; res.json({ now: controlledNow }); return true
    }
    if (servePublicMedia(req, res, url.pathname)) return true
    if (url.pathname === '/live-config.json') { res.json({ url: origin, accountRequired: false }); return true }
    const file = staticFiles[url.pathname] || (/^\/r\/[A-Z2-9]{6}$/i.test(url.pathname) ? staticFiles['/'] : null)
    if (!file) return false
    res.type(file[1]); res.end(await readFile(new URL(`../${file[0]}`, import.meta.url))); return true
  },
})
if (clockKey) service.runtime.options.seed = () => 123456
await service.listen(port, '127.0.0.1')
console.log(`Online Colyseus harness: ${origin} (clock ×${speed}; ${remote ? 'Convex boundaries' : 'ephemeral storage'})`)
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => service.close().then(() => process.exit(0)))
