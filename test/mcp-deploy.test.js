import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'

async function freePort() {
  const server = http.createServer()
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

test('private-container entrypoint requires OAuth even with the pilot bypass flag and stops cleanly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'botters-mcp-deploy-'))
  const port = await freePort(), origin = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, ['deploy/mcp-entry.js'], {
    cwd: new URL('..', import.meta.url),
    env: { PATH: process.env.PATH, PORT: String(port), BOTTERS_SERVER: 'http://127.0.0.1:9', BOTTERS_MCP_ORIGIN: origin,
      BOTTERS_MCP_OAUTH_STATE: join(dir, 'oauth.json'), BOTTERS_MCP_ALLOW_NO_AUTH: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let errors = ''; child.stderr.on('data', chunk => { errors += chunk })
  const exited = once(child, 'exit')
  try {
    let ready = false
    for (let i = 0; i < 100; i++) {
      assert.equal(child.exitCode, null, `entrypoint exited: ${errors}`)
      try { ready = (await fetch(origin + '/health')).ok } catch {}
      if (ready) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal(ready, true, 'container listener did not become ready')
    assert.equal((await fetch(origin + '/.well-known/oauth-authorization-server')).status, 200)
    for (const method of ['GET', 'POST', 'DELETE']) {
      const response = await fetch(origin + '/mcp', { method })
      assert.equal(response.status, 401)
      assert.match(response.headers.get('www-authenticate'), /oauth-protected-resource\/mcp/)
    }
    child.kill('SIGTERM')
    const result = await Promise.race([exited, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('shutdown timed out')), 5000); timer.unref() })])
    assert.deepEqual(result, [0, null])
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited }
    await rm(dir, { recursive: true, force: true })
  }
})
