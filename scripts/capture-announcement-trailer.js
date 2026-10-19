// Production evidence recipe; no model call or simulated game state.
// Own loopback PORT=39872 node server.js, then:
// TMPDIR=/proc/self/cwd/.cache/tmp node scripts/capture-announcement-trailer.js
// Opening chosen by operator gpt-6.1-sol in native run919; house normal is fixed.
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'

const origin = 'http://127.0.0.1:39872'
const out = `.cache/trailer/take-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`
const opening = [
  { if: 'bigger_enemy_near', p: 1.15, then: 'retreat', on: true },
  { if: 'big', p: 5000, then: 'split', on: true },
  { if: 'weaker_enemy_near', p: 0.8, then: 'go', on: true },
  { if: 'free_planet', p: 2000, then: 'go', on: true },
  { if: 'enemy_planet', p: 2000, then: 'go', on: true },
]
const options = { vs: 'normal', minutes: 3, planets: 28, planning: 10, withAgent: true }
await mkdir(out, { recursive: true })
const request = async (path, data, token) => {
  const r = await fetch(`${origin}${path}${token ? '?token=' + encodeURIComponent(token) : ''}`, {
    method: data ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: data && JSON.stringify(data),
  })
  assert.equal(r.status, 200, `${path} HTTP ${r.status}`)
  return r.json()
}
const session = await request('/session', { name: 'Pink', setup: 'operator opening / scripted controls' })
assert.equal((await request('/play', options, session.humanToken)).ok, true)
const joined = await fetch(`${origin}/next?timeout=1&token=${encodeURIComponent(session.agentToken)}`).then(r => r.json())
assert.ok(joined.match)
assert.equal((await request('/input', { gambits: opening, why: 'Expand. Split above 5000. Avoid larger enemies.' }, session.agentToken)).ok, true)
const state = () => request('/state', null, session.agentToken)
const errors = [], observed = [], humanRequests = [], marks = []
let browser, context, page, video, recordStart, clipStart, manual = null, released = false
const sha = async p => createHash('sha256').update(await readFile(p)).digest('hex')
try {
  browser = await chromium.launch({ executablePath: process.env.BOTTERS_BROWSER || '/usr/bin/brave-browser', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: out, size: { width: 1920, height: 1080 } } })
  recordStart = Date.now()
  page = await context.newPage(); video = page.video()
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => { if (new URL(r.url()).pathname === '/input') humanRequests.push({ seconds: clipStart ? (Date.now() - clipStart) / 1000 : null, input: JSON.parse(r.postData()) }) })
  await page.goto(`${origin}/?s=${session.humanToken}`)
  await page.locator('#hud').waitFor({ state: 'visible' })
  assert.equal(new URL(page.url()).search, '')
  while ((await state()).startsIn > 0) await page.waitForTimeout(100)
  clipStart = Date.now()
  for (;;) {
    const f = await state(), seconds = (Date.now() - clipStart) / 1000
    observed.push({ seconds, ...f })
    if (Math.floor(seconds) % 10 === 0 && !marks.some(m => m.label === `frame-${Math.floor(seconds)}`)) {
      const label = `frame-${Math.floor(seconds)}`
      marks.push({ label, seconds, tick: f.view.tick })
      await page.screenshot({ path: `${out}/${label}.png` })
    }
    // Real threat first; take a healthy swarm with a visible opponent nearby.
    // Fall back at 125s only to ensure genuine movement, never fabricate danger.
    if (!manual && seconds >= 65 && !f.view.ended) {
      const choices = f.view.swarms.filter(s => s.n > 1200).map(s => ({ s, d: Math.min(...f.view.enemies.map(e => Math.hypot(s.x - e.x, s.y - e.y))) })).sort((a, b) => a.d - b.d)
      const chosen = choices[0]
      if (chosen && (chosen.d < 260 || seconds > 125)) {
        const s = chosen.s
        await page.keyboard.press('Escape')
        for (let i = 0; i <= f.view.swarms.indexOf(s); i++) await page.keyboard.press('Tab')
        // Head 250+ units towards a real non-owned planet; if none, sideways.
        const target = f.view.planets.filter(p => p.owner !== 'you' && p.massLeft > 0 && Math.hypot(p.x - s.x, p.y - s.y) > 220).sort((a, b) => Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y))[0] || { x: Math.min(1150, s.x + 260), y: s.y > 350 ? 100 : 600 }
        const box = await page.locator('#c').boundingBox()
        manual = { seconds, id: s.id, before: s, target, nearestVisibleEnemy: chosen.d }
        marks.push({ label: 'manual-order', ...manual })
        await page.mouse.click(box.x + target.x / 1200 * box.width, box.y + target.y / 700 * box.height)
        await page.waitForTimeout(200)
        await page.screenshot({ path: `${out}/manual-order.png` })
      }
    }
    if (manual && !released && seconds >= manual.seconds + 13) {
      const s = f.view.swarms.find(s => s.id === manual.id)
      assert.ok(s, 'same controlled swarm survived')
      assert.ok(s.manual, 'native manual order accepted')
      manual.after = s
      manual.displacement = Math.hypot(s.x - manual.before.x, s.y - manual.before.y)
      assert.ok(manual.displacement > 100, `visible movement: ${manual.displacement}`)
      await page.screenshot({ path: `${out}/manual-travelled.png` })
      await page.keyboard.press('g'); await page.waitForTimeout(700)
      const after = await state(), same = after.view.swarms.find(s => s.id === manual.id)
      assert.equal(same?.manual, false, 'same swarm returned to gambits')
      marks.push({ label: 'release', seconds: (Date.now() - clipStart) / 1000, swarm: same, tick: after.view.tick })
      await page.screenshot({ path: `${out}/release.png` })
      await page.keyboard.press('Escape'); released = true
    }
    if (f.view.ended || seconds > 185) break
    await page.waitForTimeout(500)
  }
  assert.ok(manual && released)
  assert.deepEqual(errors, [])
  await context.close()
  const raw = await video.path()
  const result = {
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceHashes: Object.fromEntries(await Promise.all(['index.html', 'sim.js', 'server.js', 'scripts/capture-announcement-trailer.js'].map(async f => [f, await sha(f)]))),
    capturedAt: new Date().toISOString(), nativeSession: process.env.HERMES_SESSION_ID,
    nativeRun: 919, operator: 'gpt-6.1-sol/openai-codex; contrib-superpowers',
    inference: 'Operator selected opening once; this script makes no model calls. No continuous inference or human participant.',
    opponent: 'house normal fixed gambits', options, opening, humanRequests, manual, marks, observed, errors,
    rawVideo: raw, rawVideoSha256: await sha(raw), trimStartSeconds: (clipStart - recordStart) / 1000,
    capture: 'Native1920x1080 viewport; real-time20Hz simulation, genuine UI inputs, no game-state replacement or fabricated gameplay frames',
  }
  await writeFile(`${out}/capture.json`, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ out, raw, manual, marks, end: observed.at(-1).view.ended, errors }, null, 2))
} finally { await browser?.close() }
