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
  const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), BOTTERS_ORIGIN: origin, BOTTERS_START_DELAY: '1', BOTTERS_SEED: '7' }, stdio: ['ignore', 'ignore', 'pipe'] })
  let browser
  t.after(async () => { await browser?.close(); for (const socket of sockets) socket.destroy(); await new Promise(r => proxy.close(r)); server.kill(); if (server.exitCode === null) await once(server, 'exit') })
  await Promise.race([once(server.stderr, 'data'), once(server, 'exit').then(() => { throw new Error('Local server exited before startup') })])
  browser = await chromium.launch({ executablePath: process.env.BOTTERS_BROWSER || '/usr/bin/brave-browser', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(origin)
  await page.evaluate(() => localStorage.setItem('botters.prefs', JSON.stringify({ vs: 'easy', minutes: 3, planets: 9, planning: 10, withAgent: false, openingMine: true, opening: [{ if: 'always', then: 'hold' }, { if: 'free_planet', then: 'go' }, { if: 'always', then: 'hold', on: false }] })))
  await page.reload()
  await page.locator('#startName').fill('Guided local learner'); await page.locator('#startSolo').click()
  const state = () => page.evaluate(() => fetch('/state?token=' + localStorage.getItem('botters.session')).then(r => r.json()))
  return { browser, page, origin, state, errors, dropStreams: () => { assert.ok(streamSockets.size > 0); for (const socket of streamSockets) socket.destroy() } }
}

// Guidance observes authoritative battalion transitions rather than simulating orders locally.
test('guided match selects, moves and releases a battalion', { timeout: 30000 }, async t => {
  const { page, errors } = await fixture(t)
  await page.locator('#guidedHouse').check(); await page.locator('#play').click()
  await expect(page.locator('#guideStep')).toHaveText('Select a battalion')
  await page.locator('#battalions [data-bat]').first().click()
  await expect(page.locator('#guideStep')).toHaveText('Move to a planet')
  await page.locator('#guideSend').click()
  await expect(page.locator('#guideStep')).toHaveText('Return to gambits')
  await page.locator('#guideRelease').click()
  await expect(page.locator('#guideStep')).toHaveText('Complete')
  await page.locator('#guideDismiss').click()
  await expect(page.locator('#guidePanel')).toBeHidden()
  assert.deepEqual(errors, [])
})
