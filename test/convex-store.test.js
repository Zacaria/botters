import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { ConvexStore } from '../online/store.js'

async function backend(t, respond) {
  const calls = []
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    calls.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(raw) })
    await respond(req, res)
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)) })
  return { calls, store: new ConvexStore({ CONVEX_URL: `http://127.0.0.1:${server.address().port}`, CONVEX_DEPLOY_KEY: 'test-only-secret', VERCEL_ENV: 'production' }) }
}

test('Convex sends one internal query or atomic mutation, with server-only authorization and isolated keys', async t => {
  const { calls, store } = await backend(t, (req, res) => res.end(JSON.stringify({ status: 'success', value: req.url === '/api/query' ? 'raw-value' : 1 })))
  assert.equal(await store.get('session:x'), 'raw-value')
  assert.equal(await store.commit([{ key: 'a', raw: null, value: 'new', ttl: 60 }, { key: 'b', raw: 'guard', value: '', ttl: 0 }]), 1)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].path, '/api/query'); assert.equal(calls[0].body.path, 'store:get')
  assert.equal(calls[0].auth, 'Convex test-only-secret')
  assert.equal(calls[0].body.args.key, 'botters:production:session:x')
  assert.ok(Number.isFinite(calls[0].body.args.now))
  assert.equal(calls[1].path, '/api/mutation'); assert.equal(calls[1].body.path, 'store:commit')
  assert.deepEqual(calls[1].body.args.entries, [{ key: 'botters:production:a', raw: null, value: 'new', ttl: 60 }, { key: 'botters:production:b', raw: 'guard', value: '', ttl: 0 }])
  assert.equal(new ConvexStore({}).prefix, 'botters:preview:')
  assert.equal(new ConvexStore({ BOTTERS_NAMESPACE: 'test' }).prefix, 'botters:test:')
})

test('Convex errors are sanitized and missing configuration fails closed', async t => {
  const { store } = await backend(t, (req, res) => res.end(JSON.stringify({ status: 'error', errorMessage: 'private token and record contents' })))
  await assert.rejects(store.get('x'), e => e.status === 503 && !e.message.includes('private'))
  await assert.rejects(new ConvexStore({}).get('x'), e => e.status === 503 && e.message === 'Online storage is not configured.')
})

test('Convex request obeys entry deadline', async t => {
  const { store } = await backend(t, () => {})
  const start = performance.now()
  await assert.rejects(store.get('x', { deadline: start + 80 }))
  assert.ok(performance.now() - start < 750)
})
