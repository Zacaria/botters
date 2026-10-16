// Local Colyseus harness; never deployed to Vercel.
import { readFile } from 'node:fs/promises'
import { createLiveServer } from '../online/live-server.js'
import { LiveDurable } from '../online/live-durable.js'
const port = Number(process.env.PORT || 8788), origin = `http://127.0.0.1:${port}`
const speed = Number(process.env.BOTTERS_TEST_SPEED || 1), start = Date.now()
const now = () => start + (Date.now() - start) * speed
const remote = process.env.BOTTERS_DEV_CONVEX ? new LiveDurable() : null
const staticFiles = { '/': ['index.html', 'text/html'], '/guide': ['guide.html', 'text/html'], '/guide.html': ['guide.html', 'text/html'], '/sim.js': ['sim.js', 'text/javascript'], '/live-client.js': ['public/live-client.js', 'text/javascript'], '/privacy': ['privacy.html', 'text/html'], '/privacy.html': ['privacy.html', 'text/html'], '/terms': ['terms.html', 'text/html'], '/terms.html': ['terms.html', 'text/html'] }
const service = await createLiveServer({ remote, now, origin, origins: [origin], authority: remote?.authority.bind(remote),
  staticHandler: async (req, res) => {
    const url = new URL(req.url, origin)
    if (url.pathname === '/live-config.json') { res.json({ url: origin, accountRequired: false }); return true }
    const file = staticFiles[url.pathname] || (/^\/r\/[A-Z2-9]{6}$/i.test(url.pathname) ? staticFiles['/'] : null)
    if (!file) return false
    res.type(file[1]); res.end(await readFile(new URL(`../${file[0]}`, import.meta.url))); return true
  },
})
await service.listen(port)
console.log(`Online Colyseus harness: ${origin} (clock ×${speed}; ${remote ? 'Convex boundaries' : 'ephemeral storage'})`)
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => service.close().then(() => process.exit(0)))
