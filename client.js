#!/usr/bin/env node
// Botters MCP server for your agent (Claude Code, Codex, any MCP client), over stdio.
// The agent writes the gambits; the game server runs them 20 times per second. No model in the real-time loop.
// Flow: join_match opens your lobby in the browser, waits until you press Play, then the agent plays with you.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
if (process.argv[2] === 'install') {
  const { install } = await import('./install.js')
  process.exit(await install(process.argv.slice(3)))
}
try { process.loadEnvFile(fileURLToPath(new URL('.env', import.meta.url))) } catch {} // optional local settings
import { createBottersTools } from './tools.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const env = process.env
const SERVER = (env.BOTTERS_SERVER || 'http://localhost:8787').replace(/\/$/, '')
const serverURL = new URL(SERVER)
if (serverURL.protocol !== 'https:' && !(serverURL.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(serverURL.hostname))) throw new Error('BOTTERS_SERVER must use HTTPS (except localhost).')
const up = () => fetch(SERVER + '/rules').then(r => r.ok, () => false)
if (!env.BOTTERS_SERVER && !(await up())) {
  if (process.stdin.isTTY) { // run from a terminal: host the game here until Ctrl+C
    env.PORT = '8787'; const srv = await import('./server.js')
    try { await srv.listening } catch (e) { if (e.code !== 'EADDRINUSE' || !(await up())) throw e } // started twice at once: use the other one
  }
  else { // agent: start the game as its own process, shared by every agent on this machine; it exits once idle
    spawn(process.execPath, [fileURLToPath(new URL('server.js', import.meta.url))], { detached: true, stdio: 'ignore', env: { ...env, PORT: '8787', BOTTERS_IDLE_EXIT: '1' } }).unref()
    for (let i = 0; i < 50 && !(await up()); i++) await new Promise(r => setTimeout(r, 100)) // two agents racing: the loser's server exits on EADDRINUSE, both use the winner's
  }
}
const openUrl = url => { // BOTTERS_OPEN: unset = default browser, 0 = never, else a macOS app name
  if (env.BOTTERS_OPEN === '0') return
  const [cmd, args] = process.platform === 'darwin' ? ['open', env.BOTTERS_OPEN && env.BOTTERS_OPEN !== '1' ? ['-a', env.BOTTERS_OPEN, url] : [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
}
if (process.stdin.isTTY) { openUrl(SERVER); console.error(`Botters is running: ${SERVER}  (Ctrl+C to stop)`) } // run from a terminal: just play
const log = (...a) => console.error('[botters]', ...a) // stdout belongs to MCP

const mcp = await createBottersTools({ server: SERVER, agentToken: env.BOTTERS_AGENT_TOKEN, requireAgentToken: env.BOTTERS_REQUIRE_AGENT_TOKEN === '1', setup: env.BOTTERS_SETUP, name: env.BOTTERS_NAME, open: openUrl, bypassSecret: env.VERCEL_AUTOMATION_BYPASS_SECRET, log })

if (!process.stdin.isTTY) { process.stdin.on('close', () => process.exit(0)); await mcp.connect(new StdioServerTransport()); log(`MCP ready. server ${SERVER}`) 
 }
