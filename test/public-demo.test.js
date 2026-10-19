import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, cp, rm } from 'node:fs/promises'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

const files = ['public-demo.webm', 'public-demo-poster.jpg', 'public-demo.vtt']
const types = ['video/webm', 'image/jpeg', 'text/vtt']
const source = file => readFile(new URL(`../${file}`, import.meta.url))

// Catches missing media in clean builds or npm tarballs, not just manifest text.
test('clean build and actual package contain the exact delivered media', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'botters-demo-build-'))
  try {
    for (const file of ['index.html', 'guide.html', 'privacy.html', 'terms.html', 'sim.js', 'media']) await cp(new URL(`../${file}`, import.meta.url), join(dir, file), { recursive: true })
    execFileSync(process.execPath, [new URL('../scripts/build.js', import.meta.url).pathname], { cwd: dir })
    for (const file of files) assert.deepEqual(await readFile(join(dir, 'public/media', file)), await source(`media/${file}`))
    const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' }))
    for (const file of [...files.map(f => `media/${f}`), 'public-media.js']) assert.ok(pack.files.some(f => f.path === file), `not packaged: ${file}`)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

// Catches token-gated/missing/mistyped assets, truncated binary responses and broken seek.
test('offline server serves public media, byte ranges, HEAD and refuses unrelated paths', async t => {
  const reservation = net.createServer()
  await new Promise(r => reservation.listen(0, '127.0.0.1', r))
  const port = reservation.address().port
  await new Promise(r => reservation.close(r))
  const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), BOTTERS_ORIGIN: `http://127.0.0.1:${port}` }, stdio: ['ignore', 'ignore', 'pipe'] })
  t.after(async () => { server.kill(); if (server.exitCode === null) await once(server, 'exit') })
  await Promise.race([once(server.stderr, 'data'), once(server, 'exit').then(() => { throw Error('offline server exited') })])
  const base = `http://127.0.0.1:${port}`
  for (const [i, file] of files.entries()) {
    const data = await source(`media/${file}`), response = await fetch(`${base}/media/${file}`)
    assert.equal(response.status, 200)
    assert.ok(response.headers.get('content-type').startsWith(types[i]))
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), data)
    const head = await fetch(`${base}/media/${file}`, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(Number(head.headers.get('content-length')), data.length)
    assert.equal((await head.arrayBuffer()).byteLength, 0)
    const partial = await fetch(`${base}/media/${file}`, { headers: { Range: 'bytes=5-19' } })
    assert.equal(partial.status, 206)
    assert.equal(partial.headers.get('content-range'), `bytes 5-19/${data.length}`)
    assert.deepEqual(Buffer.from(await partial.arrayBuffer()), data.subarray(5, 20))
    const suffix = await fetch(`${base}/media/${file}`, { headers: { Range: 'bytes=-8' } })
    assert.equal(suffix.status, 206)
    assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), data.subarray(-8))
    for (const range of [`bytes=${data.length}-`, 'bytes=9-1', 'bytes=0-1,4-5', 'bytes=-0']) {
      const invalid = await fetch(`${base}/media/${file}`, { headers: { Range: range } })
      assert.equal(invalid.status, 416)
      assert.equal(invalid.headers.get('content-range'), `bytes */${data.length}`)
    }
  }
  for (const path of ['/media/missing.webm', '/media/capture.json', '/media/%2e%2e/server.js', '/server.js']) assert.equal((await fetch(`${base}${path}`)).status, 404)
  assert.equal((await fetch(`${base}/media/public-demo.webm`, { method: 'POST' })).status, 404)
})

// Current film bytes are bound to its edit manifest; original40s evidence
// remains unmodified in public-demo-capture.json and historical Git.
test('trailer provenance binds shipped bytes and meaningful same-swarm manual travel', async () => {
  const edit = JSON.parse(await source('docs/contributions/announcement-trailer-edit.json'))
  const provenance = JSON.parse(await source('docs/contributions/announcement-trailer-capture.json'))
  for (const file of files) {
    const data = await source(`media/${file}`)
    assert.equal(createHash('sha256').update(data).digest('hex'), edit.media[file].sha256)
    assert.equal(data.length, edit.media[file].bytes)
  }
  assert.equal(edit.burnedCaptions, true)
  assert.equal(edit.shots.length, 11)
  assert.equal(edit.outputSeconds, 60)
  const { before, after } = provenance.manual
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 200)
  assert.ok(provenance.manual.displacement > 200)
  assert.equal(provenance.manual.before.manual, false)
  assert.equal(provenance.manual.after.manual, true)
  const release = provenance.marks.find(m => m.label === 'release')
  assert.equal(release.swarm.id, provenance.manual.id)
  assert.equal(release.swarm.manual, false)
  assert.ok(provenance.humanRequests.some(r => r.input.order?.swarm === provenance.manual.id))
  assert.ok(provenance.humanRequests.some(r => r.input.release === provenance.manual.id))
  assert.deepEqual(provenance.errors, [])
})
