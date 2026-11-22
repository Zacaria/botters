import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { createLiveView, createPractice } from '../browser-live.js'

const delay = ms => new Promise(r => setTimeout(r, ms))

test('practice emits playable fog frames, accepts orders and finishes on surrender', { timeout: 5000 }, async t => {
  const game = createPractice({ seed: 123 }), messages = [], live = createLiveView()
  t.after(() => game.close())
  game.start(m => messages.push(m))
  await delay(220)
  const frames = messages.filter(m => m.t === 'f'), first = messages.find(m => m.t === 'meta')
  assert.ok(frames.length); for (const f of frames) assert.equal(live.receive(f.bytes, Date.now()), true)
  assert.ok(live.ready); assert.ok(first.board.planets.length); assert.ok(first.board.bats.length)
  const bat = first.board.bats[0].id
  assert.equal(game.input({ order: { bat, x: 600, y: 350 } }).ok, true)
  await delay(150)
  assert.equal(messages.filter(m => m.t === 'meta').at(-1).board.bats.find(b => b.id === bat).manual, true)
  assert.equal(game.input({ surrender: true }).ok, true)
  await delay(150)
  const final = messages.filter(m => m.t === 'meta').at(-1)
  assert.equal(final.report.result, 'lost'); assert.equal(final.report.reason, 'surrender')
  const count = messages.length; await delay(200); assert.equal(messages.length, count)
})


test('signed-out visitor plays a browser-only practice match', { timeout: 30000 }, async t => {
  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname
    if (path === '/live-config.json' || path === '/account') {
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify(path === '/account' ? { required: true, origin: `http://127.0.0.1:${server.address().port}`, user: null } : { accountRequired: true }))
    }
    const files = { '/': 'index.html', '/sim.js': 'sim.js', '/wire.js': 'wire.js', '/browser-live.js': 'browser-live.js' }
    if (!files[path]) { res.statusCode = 404; return res.end() }
    res.setHeader('content-type', path === '/' ? 'text/html' : 'text/javascript')
    res.end(await readFile(files[path]))
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r)))
  const browser = await chromium.launch({ executablePath: process.env.BOTTERS_BROWSER || '/usr/bin/brave-browser', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [], posts = []
  page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (r.method() === 'POST') posts.push(r.url()) })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await expect(page.locator('#practice')).toBeVisible(); await page.locator('#practice').click()
  await expect(page.locator('#hud')).toContainText('battalions'); await expect(page.locator('#guidePanel')).toBeVisible()
  await page.locator('#battalions [data-bat]').first().click()
  const canvas = page.locator('#c'), box = await canvas.boundingBox()
  await canvas.click({ position: { x: box.width - 3, y: box.height - 3 } })
  await expect(page.locator('#toast')).toHaveText('Move ordered')
  page.once('dialog', d => d.accept()); await page.locator('#surrender').click()
  await expect(page.locator('#big')).toContainText('You lose'); await expect(page.locator('#again')).toHaveText('PLAY AGAIN')
  await expect(page.locator('#menu')).toHaveText('Sign in to play online')
  await page.locator('#again').click(); await expect(page.locator('#surrender')).toBeVisible()
  page.once('dialog', d => d.accept()); await page.locator('#surrender').click(); await expect(page.locator('#menu')).toBeVisible()
  await page.locator('#menu').click(); await expect(page.locator('#start')).toBeVisible(); await expect(page.locator('#googleLogin')).toBeFocused()
  assert.deepEqual(posts, []); assert.deepEqual(errors, [])
})
