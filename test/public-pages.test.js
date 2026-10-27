import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, copyFile, cp, readdir, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const source = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8')
const policies = ['privacy', 'terms']

test('homepage introduces Botters and exposes policy links before JavaScript runs', async () => {
  const html = await source('index.html')
  assert.match(html, /space strategy game/)
  assert.match(html, /<div id="start" class="screen">/)
  for (const route of policies) assert.match(html, new RegExp(`href="/${route}"`))
  assert.match(await source('guide.html'), /href="\/privacy"/)
  assert.match(await source('guide.html'), /href="\/terms"/)
})

test('public policy documents have real content, navigation and no JavaScript dependency', async () => {
  for (const route of policies) {
    const html = await source(`${route}.html`)
    assert.match(html, /<html lang="en">/)
    assert.match(html, /<meta name="viewport"/)
    assert.match(html, /<main>/)
    assert.match(html, /href="\/"/)
    assert.match(html, /href="\/privacy"/)
    assert.match(html, /href="\/terms"/)
    assert.match(html, /mailto:z@havesomecode.io/)
    assert.doesNotMatch(html, /<script\b/i)
    assert.doesNotMatch(html, /TODO|lorem ipsum|example\.com/i)
  }
  const privacy = await source('privacy.html')
  for (const term of ['Google', 'Vercel', 'Convex', 'local storage', 'retention', 'CNIL']) assert.ok(privacy.includes(term), `Missing privacy disclosure: ${term}`)
})

test('deployment and local servers expose policies, and the offline package includes them', async () => {
  const config = JSON.parse(await source('vercel.json'))
  const manifest = JSON.parse(await source('package.json'))
  for (const route of policies) {
    assert.ok(config.rewrites.some(r => r.source === `/${route}` && r.destination === `/${route}.html`))
    assert.ok(manifest.files.includes(`${route}.html`))
    assert.ok((await source('scripts/online-dev.js')).includes(`'/${route}'`))
    assert.ok((await source('server.js')).includes(`'GET /${route}'`))
  }
  assert.ok(config.rewrites.some(r => r.source.includes('session|lobby')))
})

test('clean build includes the two policies and only intended public files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'botters-public-pages-'))
  const assets = ['index.html', 'guide.html', 'sim.js', 'privacy.html', 'terms.html']
  try {
    for (const file of assets) await copyFile(new URL(`../${file}`, import.meta.url), join(dir, file))
    await cp(new URL('../media', import.meta.url), join(dir, 'media'), { recursive: true })
    await cp(new URL('../sim/pkg', import.meta.url), join(dir, 'sim/pkg'), { recursive: true })
    execFileSync(process.execPath, [new URL('../scripts/build.js', import.meta.url).pathname], { cwd: dir })
    assert.deepEqual((await readdir(join(dir, 'public'))).sort(), [...assets, 'media', 'sim', 'live-client.js', 'live-config.json'].toSorted())
    for (const file of assets) assert.equal(await readFile(join(dir, 'public', file), 'utf8'), await source(file))
  } finally { await rm(dir, { recursive: true }) }
})
