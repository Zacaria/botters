// Evidence tool, not a game bot. The opening below was chosen by the operator
// model in native session t_1e2be52d/run 904. No model is invoked by this script.
// Run against ONLY an owned loopback `PORT=39872 node server.js`, real-time clock.
// TMPDIR=/proc/self/cwd/.cache/tmp node scripts/capture-public-demo.js
// Raw video + observations stay ignored in .cache/public-demo-capture/.
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'

const origin = 'http://127.0.0.1:39872', out = '.cache/public-demo-capture'
export const opening = [
  { if: 'bigger_enemy_near', p: 1.15, then: 'retreat', on: true },
  { if: 'planet_attacked', p: 500, then: 'go', on: true },
  { if: 'weaker_enemy_near', p: 0.7, then: 'go', on: true },
  { if: 'small', p: 400, then: 'go', on: true },
  { if: 'big', p: 5500, then: 'split', on: true },
  { if: 'free_planet', p: 2000, then: 'go', on: true },
  { if: 'enemy_planet', p: 2000, then: 'go', on: true },
]
await mkdir(out, { recursive: true })
const request = async (path, data, token) => {
  const response = await fetch(`${origin}${path}${token ? '?token=' + encodeURIComponent(token) : ''}`, {
    method: data ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: data && JSON.stringify(data),
  })
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`)
  return response.json()
}
const session = await request('/session', { name: 'Local demo', setup: 'operator model / scripted UI' })
const options = { vs: 'normal', minutes: 3, planets: 28, planning: 10, withAgent: true }
assert.equal((await request('/play', options, session.humanToken)).ok, true)
// Join via the genuine agent boundary, then submit the operator's opening once.
const joined = await fetch(`${origin}/next?timeout=1&token=${session.agentToken}`).then(r => r.json())
assert.ok(joined.match)
assert.equal((await request('/input', { gambits: opening, why: 'Operator choice: expand, defend, avoid bigger enemies' }, session.agentToken)).ok, true)
let browser
const errors = [], observed = [], humanRequests = []
let context, page, rawVideo, clipStart, recordingStart
try {
  browser = await chromium.launch({ executablePath: process.env.BOTTERS_BROWSER || '/usr/bin/brave-browser', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } })
  recordingStart = Date.now()
  page = await context.newPage()
  rawVideo = page.video()
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => { if (new URL(r.url()).pathname === '/input') humanRequests.push(JSON.parse(r.postData())) })
  await page.goto(`${origin}/?s=${session.humanToken}`)
  await page.locator('#hud').waitFor({ state: 'visible' })
  // The native page removes the capability from its URL. Only viewport frames are recorded.
  assert.equal(new URL(page.url()).search, '')
  const state = () => request('/state', null, session.agentToken)
  const sample = async label => {
    const f = await state()
    observed.push({ label, clipSeconds: (Date.now() - clipStart) / 1000, ...f })
    return f
  }
  while ((await state()).startsIn > 0) await page.waitForTimeout(100)
  clipStart = Date.now()
  await sample('opening')
  await page.waitForTimeout(8000)
  const before = await sample('before automated human-side input')
  await page.keyboard.press('Tab') // genuine native selection handler: first friendly swarm
  const swarm = before.view.swarms[0]
  const target = before.view.planets.filter(p => p.owner === null && p.massLeft > 0)
    .sort((a, b) => Math.hypot(a.x - swarm.x, a.y - swarm.y) - Math.hypot(b.x - swarm.x, b.y - swarm.y))[0]
  // If the random map has no neutral left, choose a point away from home.
  const point = target || { x: 420, y: 180 }
  const box = await page.locator('#c').boundingBox()
  await page.mouse.click(box.x + point.x / 1200 * box.width, box.y + point.y / 700 * box.height)
  await page.waitForTimeout(700)
  const manual = await sample('automated human-side order accepted')
  assert.ok(manual.view.swarms.some(s => s.id === swarm.id && s.manual))
  await page.waitForTimeout(7300)
  await page.keyboard.press('g') // native release handler
  await page.waitForTimeout(700)
  const released = await sample('automated human-side release accepted')
  assert.equal(released.view.swarms.find(s => s.id === swarm.id)?.manual, false)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(7300)
  await sample('expansion continues')
  await page.screenshot({ path: `${out}/frame-24.png` })
  await page.waitForTimeout(16000)
  const end = await sample('clip end')
  assert.ok(end.view.tick > 760, 'real simulation advanced about 40 seconds')
  assert.equal(end.gambitsBy.who, 'agent')
  assert.deepEqual(end.view.gambits, opening)
  assert.deepEqual(errors, [])
  await page.screenshot({ path: `${out}/frame-40.png` })
  await context.close()
  const path = await rawVideo.path()
  const sha256 = async file => createHash('sha256').update(await readFile(file)).digest('hex')
  const result = {
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceHashes: Object.fromEntries(await Promise.all(['index.html', 'sim.js', 'server.js', 'scripts/capture-public-demo.js'].map(async file => [file, await sha256(file)]))),
    capturedAt: new Date().toISOString(), operator: 'gpt-6.1-sol / openai-codex, contrib-superpowers; task t_1e2be52d, run 904',
    inference: 'Operator chose opening once in session; no model invoked by this script; no claim of continuous model inference.',
    opponent: 'house (normal), fixed gambits; no model opponent',
    humanSide: 'Playwright sends real Tab, map click, G, Escape to native page; no human participant',
    options, opening, humanRequests, observed, errors,
    rawVideo: path, rawVideoSha256: await sha256(path),
    trimStartSeconds: (clipStart - recordingStart) / 1000, trimDurationSeconds: 40,
    capture: 'Playwright viewport recording 1440x900, actual native renderer/server at 20Hz; no fake frames or simulation replacement',
  }
  await writeFile(`${out}/capture.json`, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ video: path, trimStartSeconds: result.trimStartSeconds, observations: observed.map(f => ({ label: f.label, tick: f.view.tick, seconds: f.clipSeconds })), humanRequests, errors }, null, 2))
} catch (error) {
  if (page) {
    await page.screenshot({ path: `${out}/failure.png` })
    console.error(JSON.stringify({ errors, visibleText: (await page.locator('body').innerText()).slice(0, 3500) }))
  }
  throw error
} finally { await browser?.close() }
