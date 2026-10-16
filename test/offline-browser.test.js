import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chromium } from '@playwright/test'

test('offline browser renders and reconnects using local SSE without the Colyseus bundle', { timeout: 25000 }, async t => {
  const reservation = net.createServer()
  await new Promise(r => reservation.listen(0, '127.0.0.1', r))
  const port = reservation.address().port, origin = `http://127.0.0.1:${port}`
  await new Promise(r => reservation.close(r))
  const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), BOTTERS_ORIGIN: origin, BOTTERS_START_DELAY: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
  let browser
  t.after(async () => { await browser?.close(); server.kill(); if (server.exitCode === null) await once(server, 'exit') })
  await Promise.race([once(server.stderr, 'data'), once(server, 'exit').then(() => { throw new Error('Offline server exited before startup') })])
  browser = await chromium.launch({ executablePath: process.env.BOTTERS_BROWSER || '/usr/bin/brave-browser', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await browser.newPage(), errors = [], requests = []
  page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(new URL(r.url()).pathname))
  await page.goto(origin)
  await page.locator('#startName').fill('Offline regression')
  await page.locator('#startSolo').click()
  await page.locator('#play').waitFor({ state: 'visible' }); await page.locator('#play').click()
  await page.waitForFunction(() => document.querySelector('#hud').textContent.includes('swarms'), null, { timeout: 5000 })
  const read = () => page.evaluate(() => fetch('/state?token=' + localStorage.getItem('botters.session')).then(r => r.json()))
  const first = await read(); assert.ok(first.view.tick > 0)
  await page.reload()
  await page.waitForFunction(() => document.querySelector('#hud').textContent.includes('swarms'), null, { timeout: 5000 })
  assert.equal((await read()).matchId, first.matchId)
  assert.ok(requests.filter(p => p === '/stream').length >= 2)
  assert.ok(!requests.includes('/live-client.js'))
  assert.deepEqual(errors, [])
})
