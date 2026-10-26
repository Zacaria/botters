// Container-only adapter: private Docker networking, never a published host port.
import { createWebMcp } from '../web-mcp.js'

try {
  const port = Number(process.env.PORT || 8798)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port')
  const app = createWebMcp({ server: process.env.BOTTERS_SERVER, origin: process.env.BOTTERS_MCP_ORIGIN,
    // ponytail: 128 agents; 64 active measured 123.1 MiB RSS (0.60 MiB/agent growth) under 512 MiB; remeasure before raising.
    oauth: { stateFile: process.env.BOTTERS_MCP_OAUTH_STATE }, maxSessions: 128 })
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close() })
  app.server.on('error', () => { console.error('Gateway listener failed'); void app.close(); process.exitCode = 1 })
  app.server.listen(port, '0.0.0.0', () => console.error(`Botters MCP listening on private container port ${port}`))
} catch { console.error('Invalid gateway configuration'); process.exitCode = 1 }
