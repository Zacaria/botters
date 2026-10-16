import { createLiveServer } from '../online/live-server.js'
import { LiveDurable } from '../online/live-durable.js'
import { readFile } from 'node:fs/promises'
const remote = new LiveDurable()
if (!remote.store.url || !remote.store.token) throw new Error('Configure the existing Convex deployment before starting')
const origins = process.env.PLAYER_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean)
const build = JSON.parse(await readFile(new URL('../build-id.json', import.meta.url), 'utf8'))
const service = await createLiveServer({ remote, authority: remote.authority.bind(remote), origins, origin: 'https://botters.havesomecode.io', requireAccount: process.env.BOTTERS_REQUIRE_ACCOUNT === '1', buildId: build.commit })
await service.listen(Number(process.env.PORT || 2567), '0.0.0.0')
console.log(JSON.stringify({ service: 'botters-live', build: build.commit, namespace: remote.store.prefix, transport: 'colyseus' }))
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await service.close(); process.exit(0) })
