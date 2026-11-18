import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'

function run(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/usage.js'], { env: { ...process.env, ...env } })
    let out = '', err = ''; child.stdout.on('data', s => { out += s }); child.stderr.on('data', s => { err += s })
    child.on('error', reject); child.on('close', code => resolve({ code, out, err }))
  })
}
test('usage CLI requires credentials and prints a counts-only table', async t => {
  const missing = await run({ CONVEX_URL: '', CONVEX_DEPLOY_KEY: '' })
  assert.equal(missing.code, 1); assert.match(missing.err, /CONVEX_URL.*CONVEX_DEPLOY_KEY/)
  let request
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    request = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body) }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ status: 'success', value: { weeks: [{ start: Date.UTC(2026, 10, 16), signups: 3, online: 2, agent: 1, house: 4, returning: 2 }], matchesSince: Date.UTC(2026, 10, 17) } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close())
  const result = await run({ CONVEX_URL: `http://127.0.0.1:${server.address().port}`, CONVEX_DEPLOY_KEY: 'test-secret', BOTTERS_NAMESPACE: 'qa' })
  assert.equal(result.code, 0); assert.match(result.out, /2026-11-16/); assert.match(result.out, /Match counts start 2026-11-17/)
  assert.doesNotMatch(result.out + result.err, /test-secret/)
  assert.deepEqual(request, { url: '/api/query', auth: 'Convex test-secret', body: { path: 'usage:weekly', args: { prefix: 'botters:qa:' }, format: 'json' } })
})
