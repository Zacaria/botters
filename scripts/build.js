import { mkdir, copyFile } from 'node:fs/promises'
const assets = ['index.html', 'guide.html', 'sim.js', 'privacy.html', 'terms.html']
await mkdir('public', { recursive: true })
await Promise.all(assets.map(file => copyFile(file, `public/${file}`)))
console.log(`Built ${assets.length} public assets; API secrets and server modules are not public.`)
