import { mkdir, copyFile } from 'node:fs/promises'
const assets = ['index.html', 'guide.html', 'sim.js', 'privacy.html', 'terms.html']
await mkdir('public', { recursive: true })
await Promise.all(assets.map(file => copyFile(file, `public/${file}`)))
console.log(`Built ${assets.length} public assets; API secrets and server modules are not public.`)
const { build } = await import('esbuild')
const { writeFile } = await import('node:fs/promises')
await build({ entryPoints: [new URL('../browser-live.js', import.meta.url).pathname], bundle: true, format: 'esm', minify: true, outfile: 'public/live-client.js' })
const live = process.env.BOTTERS_LIVE_URL || null
if (live && new URL(live).origin !== live) throw new Error('BOTTERS_LIVE_URL must be an exact origin')
await writeFile('public/live-config.json', JSON.stringify({ url: live, accountRequired: !live || process.env.BOTTERS_REQUIRE_ACCOUNT === '1' }))
