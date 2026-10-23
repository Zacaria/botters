import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chromium, expect } from '@playwright/test'

async function fixture(t) {
  const reservation = net.createServer()
  await new Promise(r => reservation.listen(0, '127.0.0.1', r))
  const port = reservation.address().port
  await new Promise(r => reservation.close(r))
  // Byte-for-byte TCP forwarding, solely to cut a real SSE connection without
  // restarting the authoritative match or substituting any server responses.
  const sockets = new Set(), streamSockets = new Set()
  const proxy = net.createServer(socket => {
    const upstream = net.connect(port, '127.0.0.1')
    sockets.add(socket)
    socket.on('data', bytes => { if (bytes.toString().includes('GET /stream?')) streamSockets.add(socket) })
    socket.pipe(upstream); upstream.pipe(socket)
    socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy())
    socket.on('close', () => { sockets.delete(socket); streamSockets.delete(socket); upstream.destroy() })
  })
  await new Promise(r => proxy.listen(0, '127.0.0.1', r))
  const origin = `http://127.0.0.1:${proxy.address().port}`
  const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), BOTTERS_ORIGIN: origin, BOTTERS_START_DELAY: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
  let browser
  t.after(async () => { await browser?.close(); for (const socket of sockets) socket.destroy(); await new Promise(r => proxy.close(r)); server.kill(); if (server.exitCode === null) await once(server, 'exit') })
  await Promise.race([once(server.stderr, 'data'), once(server, 'exit').then(() => { throw new Error('Local server exited before startup') })])
  browser = await chromium.launch({ executablePath: process.env.BOTTERS_BROWSER || '/usr/bin/brave-browser', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(origin)
  await page.evaluate(() => localStorage.setItem('botters.prefs', JSON.stringify({ vs: 'easy', minutes: 3, planets: 28, planning: 10, withAgent: false, openingMine: true, opening: [{ if: 'always', then: 'hold' }, { if: 'free_planet', then: 'go' }, { if: 'always', then: 'hold', on: false }] })))
  await page.reload()
  await page.locator('#startName').fill('Guided local learner'); await page.locator('#startSolo').click()
  const state = () => page.evaluate(() => fetch('/state?token=' + localStorage.getItem('botters.session')).then(r => r.json()))
  return { browser, page, origin, state, errors, dropStreams: () => { assert.ok(streamSockets.size > 0); for (const socket of streamSockets) socket.destroy() } }
}

// Every view/input comes from the existing server/simulation; no mocked frames or model.
test('optional local guidance requires capture, disabled gambit, manual order and same-swarm release', { timeout: 70000 }, async t => {
  const { page, state, errors, dropStreams } = await fixture(t)
  let streams = 0, inputs = 0
  page.on('request', r => { const path = new URL(r.url()).pathname; if (path === '/stream') streams++; if (path === '/input' && r.method() === 'POST') inputs++ })
  await expect(page.locator('#guidedHouse')).not.toBeChecked()
  await page.locator('#guidedHouse').check(); await page.locator('#play').click()
  const step = page.locator('#guideStep')
  await expect(step).toHaveText('1 / 4 · Capture a planet')
  const initial = await state()
  assert.equal(initial.view.planets.filter(p => p.owner === 'you').length, 1)
  await page.waitForTimeout(1100) // Negative assertion only: idle time is not a milestone.
  await expect(step).toHaveText('1 / 4 · Capture a planet')
  await page.locator('#guideSwarm').selectOption('1')
  await expect(step).toHaveText('1 / 4 · Capture a planet')
  const swarm = (await state()).view.swarms.find(s => s.id === 1)
  const target = initial.view.planets.filter(p => p.owner === null).sort((a, b) => Math.hypot(a.x - swarm.x, a.y - swarm.y) - Math.hypot(b.x - swarm.x, b.y - swarm.y))[0]
  await page.locator('#guidePlanet').selectOption(String(target.id))
  await page.locator('#guideSend').focus(); await page.keyboard.press('Enter')
  await expect.poll(async () => (await state()).view.swarms.find(s => s.id === 1)?.manual).toBe(true)
  await expect(step).toHaveText('1 / 4 · Capture a planet')
  await expect(step).toHaveText('2 / 4 · Switch a gambit off', { timeout: 30000 })
  assert.equal((await state()).view.planets.find(p => p.id === target.id).owner, 'you')
  // A rule that was already off, and an already manual swarm, are not new transitions.
  await page.waitForTimeout(400)
  await expect(step).toHaveText('2 / 4 · Switch a gambit off')
  await page.locator('#guideSend').focus(); await page.keyboard.press('1')
  await expect(step).toHaveText('3 / 4 · Take manual control')
  // Restore the hold rule for this test; the guide must not force a strategy.
  await page.keyboard.press('1')
  await expect.poll(async () => (await state()).view.gambits[0].on).toBe(true)
  await page.waitForTimeout(400)
  await expect(step).toHaveText('3 / 4 · Take manual control')
  await expect(page.locator('#guideRelease')).toBeEnabled()
  await page.locator('#guideRelease').focus(); await page.keyboard.press('Enter')
  await expect.poll(async () => (await state()).view.swarms.find(s => s.id === 1)?.manual).toBe(false)
  await expect(step).toHaveText('3 / 4 · Take manual control')
  await page.locator('#guideSwarm').selectOption('2')
  await page.locator('#guideSwarm').selectOption('1')
  await page.waitForTimeout(300)
  await expect(step).toHaveText('3 / 4 · Take manual control')
  // Tab reaches the next control instead of trapping keyboard users in swarm cycling.
  await page.locator('#guideSwarm').focus(); await page.keyboard.press('Tab')
  await expect(page.locator('#guidePlanet')).toBeFocused()
  await page.locator('#guideSend').focus(); await page.keyboard.press('Enter')
  await expect(step).toHaveText('4 / 4 · Return to gambits')
  await page.keyboard.press('Escape')
  // Releasing a different swarm cannot satisfy the tracked swarm's release. Orders act on whole groups, so swarm 2 first leaves swarm 1's group (key U).
  await page.locator('#guideSwarm').selectOption('2')
  await page.evaluate(() => document.activeElement.blur()); await page.keyboard.press('u')
  await expect.poll(async () => { const w = (await state()).view.swarms; return w.find(s => s.id === 2)?.group !== w.find(s => s.id === 1)?.group }).toBe(true)
  await page.locator('#guidePlanet').selectOption('0')
  await page.locator('#guideSend').focus(); await page.keyboard.press('Enter')
  await expect.poll(async () => (await state()).view.swarms.find(s => s.id === 2)?.manual).toBe(true)
  await expect(page.locator('#guideRelease')).toBeEnabled()
  await page.locator('#guideRelease').focus(); await page.keyboard.press('Enter')
  await expect.poll(async () => (await state()).view.swarms.find(s => s.id === 2)?.manual).toBe(false)
  await expect(step).toHaveText('4 / 4 · Return to gambits')
  await page.waitForTimeout(400)
  await expect(step).toHaveText('4 / 4 · Return to gambits')
  assert.equal((await state()).view.swarms.find(s => s.id === 1).manual, true)
  // A real SSE reconnection must not manufacture completion or restart the observer.
  const streamsBefore = streams, tickBefore = (await state()).view.tick
  await page.context().setOffline(true)
  await expect(page.locator('#connection')).toBeVisible({ timeout: 8000 })
  dropStreams()
  await page.context().setOffline(false)
  await expect(page.locator('#connection')).toBeHidden({ timeout: 8000 })
  await expect.poll(() => streams, { timeout: 8000 }).toBeGreaterThan(streamsBefore)
  await expect.poll(async () => (await state()).view.tick).toBeGreaterThan(tickBefore)
  await expect(step).toHaveText('4 / 4 · Return to gambits')
  await page.locator('#guideSwarm').selectOption('1')
  await expect(page.locator('#guideRelease')).toBeEnabled()
  await page.locator('#guideRelease').focus(); await page.keyboard.press('Enter')
  await expect(step).toHaveText('Complete · Keep playing')
  assert.equal((await state()).view.swarms.find(s => s.id === 1).manual, false)
  const before = (await state()).view.gambits
  const inputsBefore = inputs
  await page.locator('#guideReplay').focus(); await page.keyboard.press('Enter')
  await expect(step).toHaveText('1 / 4 · Capture a planet')
  await page.waitForTimeout(300)
  await expect(step).toHaveText('1 / 4 · Capture a planet')
  await page.locator('#guideDismiss').focus(); await page.keyboard.press('Enter')
  await expect(page.locator('#guidePanel')).toBeHidden()
  assert.deepEqual((await state()).view.gambits, before)
  await page.locator('#guideLaunch').focus(); await page.keyboard.press('Enter')
  await expect(step).toHaveText('1 / 4 · Capture a planet')
  assert.equal(inputs, inputsBefore, 'restart, dismiss and launch submit no game inputs')
  await page.reload()
  await expect(page.locator('#hud')).toContainText('swarms')
  await expect(page.locator('#guidePanel')).toBeHidden()
  assert.deepEqual(errors, [])
})

test('guidance is absent by default, may start mid-house-match, and is not offered in local PvP', { timeout: 25000 }, async t => {
  const { page, browser, origin, errors } = await fixture(t)
  await page.locator('#play').click()
  await expect(page.locator('#hud')).toContainText('swarms')
  await expect(page.locator('#guidePanel')).toBeHidden()
  await page.locator('#guideLaunch').focus(); await page.keyboard.press('F1')
  await expect(page.locator('#guideStep')).toHaveText('1 / 4 · Capture a planet')
  const other = await browser.newPage()
  await other.goto(origin)
  await other.locator('#startName').fill('Local PvP learner'); await other.locator('#startSolo').click()
  await other.locator('#vs [data-v="player"]').click()
  await expect(other.locator('#guidedHouse')).toBeHidden()
  await other.locator('#play').click()
  const peer = await browser.newPage()
  await peer.goto(origin)
  await peer.locator('#startName').fill('Local PvP peer'); await peer.locator('#startSolo').click()
  await peer.locator('#vs [data-v="player"]').click(); await peer.locator('#play').click()
  await expect(other.locator('#hud')).toContainText('swarms')
  await expect(other.locator('#guideLaunch')).toBeHidden()
  await expect(other.locator('#guidePanel')).toBeHidden()
  assert.deepEqual(errors, [])
})
