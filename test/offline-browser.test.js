import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { DEFAULT_GAMBITS, MAX_GAMBITS } from '../sim.js'

async function fixture(t) {
  const reservation = net.createServer()
  await new Promise(r => reservation.listen(0, '127.0.0.1', r))
  const port = reservation.address().port, origin = `http://127.0.0.1:${port}`
  await new Promise(r => reservation.close(r))
  const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), BOTTERS_ORIGIN: origin, BOTTERS_START_DELAY: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
  let browser
  t.after(async () => { await browser?.close(); server.kill(); if (server.exitCode === null) await once(server, 'exit') })
  await Promise.race([once(server.stderr, 'data'), once(server, 'exit').then(() => { throw new Error('Offline server exited before startup') })])
  browser = await chromium.launch({ executablePath: process.env.BOTTERS_BROWSER || '/usr/bin/brave-browser', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  return { browser, origin }
}

test('offline browser renders and reconnects using local SSE without the Colyseus bundle', { timeout: 25000 }, async t => {
  const { browser, origin } = await fixture(t)
  const page = await browser.newPage(), errors = [], requests = []
  page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(new URL(r.url()).pathname))
  await page.goto(origin)
  await page.locator('#startName').fill('Offline regression')
  await page.locator('#startSolo').click()
  await page.locator('#play').waitFor({ state: 'visible' }); await page.locator('#play').click()
  await page.waitForFunction(() => document.querySelector('#hud').textContent.includes('swarms'), null, { timeout: 5000 })
  const read = () => page.evaluate(() => fetch('/state?token=' + localStorage.getItem('botters.session')).then(r => r.json()))
  const first = await read(); assert.ok(first.view.tick > 0)
  const session = await page.evaluate(() => localStorage.getItem('botters.session'))
  const map = frame => frame.view.planets.map(({ id, x, y, r }) => ({ id, x, y, r }))
  await page.reload()
  await page.waitForFunction(() => document.querySelector('#hud').textContent.includes('swarms'), null, { timeout: 5000 })
  // The offline frame has no matchId. Verify actual continuity, not undefined === undefined.
  assert.equal(await page.evaluate(() => localStorage.getItem('botters.session')), session)
  assert.deepEqual(map(await read()), map(first))
  await expect.poll(async () => (await read()).view.tick).toBeGreaterThan(first.view.tick)
  assert.ok(requests.filter(p => p === '/stream').length >= 2)
  assert.ok(!requests.includes('/live-client.js'))
  assert.deepEqual(errors, [])
})

test('offline surrender confirms, recovers from refusal, shows the real result and starts another match', { timeout: 30000 }, async t => {
  const { browser, origin } = await fixture(t)
  const page = await browser.newPage(), errors = [], posts = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/surrender') posts.push(r.url()) })
  await page.goto(origin)
  await page.locator('#startName').fill('Surrender browser')
  await page.locator('#startSolo').click()
  await page.locator('#play').click()
  await expect(page.locator('#hud')).toContainText('swarms')
  const read = () => page.evaluate(() => fetch('/state?token=' + localStorage.getItem('botters.session')).then(r => r.json()))
  if (process.env.BOTTERS_SURRENDER_EVIDENCE) {
    await mkdir(process.env.BOTTERS_SURRENDER_EVIDENCE, { recursive: true })
    await page.locator('#surrender').scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(process.env.BOTTERS_SURRENDER_EVIDENCE, 'offline-surrender-button.png') })
  }
  page.once('dialog', dialog => dialog.dismiss())
  await page.locator('#surrender').click()
  assert.equal(posts.length, 0); assert.equal((await read()).view.ended, null)
  await page.locator('#leave').click()
  await expect(page.locator('#play')).toHaveText('RESUME MATCH')
  await page.locator('#play').click()
  await page.route('**/surrender?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Synthetic surrender refusal"}' }), { times: 1 })
  page.once('dialog', dialog => dialog.accept())
  await page.locator('#surrender').click()
  await expect(page.locator('#toast')).toHaveText('Synthetic surrender refusal')
  await expect(page.locator('#surrender')).toBeEnabled()
  assert.equal((await read()).view.ended, null)
  page.once('dialog', async dialog => { assert.match(dialog.message(), /You will lose/); await dialog.accept() })
  await page.locator('#surrender').focus(); await page.keyboard.press('Enter')
  await expect(page.locator('#again')).toBeVisible()
  await expect(page.locator('#big')).toContainText('you surrendered')
  await expect(page.locator('#big')).toContainText('also removes your surrender')
  await expect(page.locator('#toast')).toBeEmpty()
  await expect(page.locator('#surrender')).toBeHidden()
  assert.deepEqual((await read()).view.ended, { reason: 'surrender', result: 'lost' })
  if (process.env.BOTTERS_SURRENDER_EVIDENCE) {
    await mkdir(process.env.BOTTERS_SURRENDER_EVIDENCE, { recursive: true })
    await page.screenshot({ path: join(process.env.BOTTERS_SURRENDER_EVIDENCE, 'offline-surrender.png') })
  }
  await page.locator('#again').click()
  await expect(page.locator('#surrender')).toBeVisible()
  assert.equal((await read()).view.ended, null)
  assert.equal(posts.length, 2)
  assert.deepEqual(errors, [])
})

test('primary map input ignores secondary buttons without changing engine control', { timeout: 45000 }, async t => {
  if (process.env.BOTTERS_SERVER || process.env.BOTTERS_LIVE_SERVER || process.env.BOTTERS_DEV_CONVEX) throw new Error('Map input regression requires local ephemeral fixtures')
  const { browser, origin } = await fixture(t)
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [], posts = [], replies = [], observations = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => {
    if (r.method() !== 'POST') return
    const path = new URL(r.url()).pathname
    posts.push({ path, ...(['/input', '/say'].includes(path) && { body: r.postDataJSON() }) })
  })
  page.on('response', async r => {
    const path = new URL(r.url()).pathname
    if (r.request().method() === 'POST' && ['/input', '/say'].includes(path)) replies.push({ path, status: r.status(), body: await r.json() })
  })
  const read = () => page.evaluate(() => fetch('/state?token=' + localStorage.getItem('botters.session')).then(r => r.json()))
  const selected = () => page.locator('#hud').textContent().then(text => text.match(/grabbed: swarm #(\d+)/)?.[1] || null)
  const snapshot = async label => {
    if (!process.env.BOTTERS_MAP_INPUT_EVIDENCE) return
    await mkdir(process.env.BOTTERS_MAP_INPUT_EVIDENCE, { recursive: true })
    await page.screenshot({ path: join(process.env.BOTTERS_MAP_INPUT_EVIDENCE, label + '.png') })
  }
  t.after(async () => {
    t.diagnostic(`Native map input observations (capabilities omitted): ${JSON.stringify(observations)}`)
    if (process.env.BOTTERS_MAP_INPUT_EVIDENCE) {
      await mkdir(process.env.BOTTERS_MAP_INPUT_EVIDENCE, { recursive: true })
      await writeFile(join(process.env.BOTTERS_MAP_INPUT_EVIDENCE, 'observations.json'), JSON.stringify({ origin, posts, replies, observations, errors }, null, 2))
    }
  })
  await page.goto(origin + '/privacy')
  await page.evaluate(() => localStorage.setItem('botters.prefs', JSON.stringify({ vs: 'easy', minutes: 3, planets: 28, planning: 10, withAgent: true, openingMine: true, opening: [{ if: 'always', then: 'hold' }] })))
  await page.goto(origin)
  await page.locator('#startName').fill('Synthetic map input player')
  const created = page.waitForResponse(r => new URL(r.url()).pathname === '/session' && r.request().method() === 'POST')
  await page.locator('#startSolo').click()
  const { agentToken } = await (await created).json()
  // A real local heartbeat enables the existing ping UI; no model is involved.
  assert.equal((await page.request.get(`${origin}/next?token=${agentToken}&timeout=0.001`)).status(), 200)
  await expect(page.locator('#withAgent [data-v="true"]')).toBeVisible({ timeout: 8000 })
  await page.locator('#withAgent [data-v="true"]').click()
  await expect(page.locator('#guidedHouse')).not.toBeChecked()
  await page.context().route('https://chatgpt.com/**', route => route.fulfill({ status: 200, body: '' }))
  const started = page.waitForResponse(r => new URL(r.url()).pathname === '/play' && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Play with ChatGPT' }).click(); await started
  await page.request.get(`${origin}/next?token=${agentToken}&timeout=0.001`)
  // After PLAY evaluations only read; all actions are native mouse/keyboard input.
  await expect(page.locator('#hud')).toContainText('swarms')
  await expect(page.locator('#guidePanel')).toBeHidden()
  await expect.poll(async () => (await read()).view.tick).toBeGreaterThan(0)
  const first = await read(), swarm = first.view.swarms[0]
  const session = await page.evaluate(() => localStorage.getItem('botters.session'))
  const map = frame => frame.view.planets.map(({ id, x, y, r }) => ({ id, x, y, r }))
  assert.equal(first.startsIn, 0)
  assert.equal(first.me.withAgent, true)
  assert.equal(swarm.manual, false)
  const box = await page.locator('#c').boundingBox(), size = await page.locator('#c').evaluate(c => ({ w: c.width, h: c.height }))
  const point = (x, y) => ({ x: Math.round(box.x + x * box.width / size.w), y: Math.round(box.y + y * box.height / size.h) })
  const destination = point(600, 200)
  const target = { x: Math.round((destination.x - box.x) * size.w / box.width), y: Math.round((destination.y - box.y) * size.h / box.height) }
  const grab = async id => {
    await page.keyboard.press('Escape')
    const s = (await read()).view.swarms.find(s => s.id === id), p = point(s.x, s.y)
    await page.mouse.click(p.x, p.y)
    await expect.poll(selected).toBe(String(id))
  }
  const advance = async tick => {
    await expect.poll(async () => (await read()).view.tick).toBeGreaterThan(tick + 2)
    return read()
  }
  await grab(swarm.id)
  assert.equal((await read()).view.swarms.find(s => s.id === swarm.id).manual, false, 'primary selection alone keeps gambits')
  assert.equal(posts.filter(p => p.path === '/input').length, 0)

  for (const button of ['right', 'middle']) await t.test(`${button} order`, async () => {
    await grab(swarm.id)
    const before = await read(), start = posts.length, replyStart = replies.length
    await page.mouse.click(destination.x, destination.y, { button })
    const after = await advance(before.view.tick), actual = after.view.swarms.find(s => s.id === swarm.id)
    const observed = { action: 'secondary order', button, tickBefore: before.view.tick, tickAfter: after.view.tick, posts: posts.slice(start), replies: replies.slice(replyStart), manual: actual.manual, tx: actual.tx, ty: actual.ty }
    observations.push(observed)
    await snapshot(button + '-order')
    // Restore through the real shortcut even on RED, so both buttons are measured.
    if (actual.manual) {
      await page.keyboard.press('g')
      await expect.poll(async () => (await read()).view.swarms.find(s => s.id === swarm.id).manual).toBe(false)
    }
    assert.deepEqual(observed.posts, [], `${button} must emit no order: ${JSON.stringify(observed)}`)
    assert.equal(observed.manual, false)
  })

  for (const button of ['right', 'middle']) await t.test(`${button} selection`, async () => {
    await grab(swarm.id)
    const before = await read(), other = before.view.swarms.find(s => s.id !== swarm.id), p = point(other.x, other.y), start = posts.length
    await page.mouse.click(p.x, p.y, { button })
    const after = await advance(before.view.tick), grabbed = await selected()
    observations.push({ action: 'secondary selection', button, selected: grabbed, expected: String(swarm.id), tick: after.view.tick })
    assert.equal(grabbed, String(swarm.id))
    assert.deepEqual(posts.slice(start), [])
    assert.ok(after.view.swarms.every(s => !s.manual))
  })

  await grab(swarm.id)
  const start = posts.length, replyStart = replies.length
  const accepted = page.waitForResponse(r => new URL(r.url()).pathname === '/input' && r.request().method() === 'POST')
  await page.mouse.click(destination.x, destination.y)
  const response = await accepted
  assert.equal(response.status(), 200); assert.equal((await response.json()).ok, true)
  await expect.poll(async () => { const s = (await read()).view.swarms.find(s => s.id === swarm.id); return { manual: s.manual, tx: s.tx, ty: s.ty } }).toEqual({ manual: true, tx: target.x, ty: target.y })
  assert.deepEqual(posts.slice(start), [{ path: '/input', body: { order: { swarm: swarm.id, ...target } } }])
  observations.push({ action: 'primary order', target, posts: posts.slice(start), replies: replies.slice(replyStart), tick: (await read()).view.tick })
  await snapshot('primary-order')
  await page.keyboard.press('g')
  await expect.poll(async () => (await read()).view.swarms.find(s => s.id === swarm.id).manual).toBe(false)
  assert.deepEqual(posts.slice(start + 1), [{ path: '/input', body: { release: swarm.id } }])
  observations.push({ action: 'G release', manual: false, tick: (await read()).view.tick })
  await page.keyboard.press('Escape')
  await expect.poll(selected).toBe(null)
  for (const button of ['right', 'middle']) await t.test(`${button} ping`, async () => {
    const before = await read(), start = posts.length
    await page.mouse.click(destination.x, destination.y, { button })
    const after = await advance(before.view.tick), emitted = posts.slice(start)
    observations.push({ action: 'secondary ping', button, posts: emitted, tick: after.view.tick })
    assert.deepEqual(emitted, [])
    assert.equal(await selected(), null)
    assert.ok(after.view.swarms.every(s => !s.manual))
  })
  const pingStart = posts.length
  const pinged = page.waitForResponse(r => new URL(r.url()).pathname === '/say' && r.request().method() === 'POST')
  await page.mouse.click(destination.x, destination.y)
  const ping = await pinged
  assert.equal(ping.status(), 200); assert.equal((await ping.json()).ok, true)
  assert.equal(posts.length, pingStart + 1)
  assert.equal(posts[pingStart].path, '/say')
  assert.equal(posts[pingStart].body.text, 'look here')
  assert.ok(Math.abs(posts[pingStart].body.x - target.x) <= 0.5 && Math.abs(posts[pingStart].body.y - target.y) <= 0.5)
  const last = await advance(first.view.tick)
  assert.ok(await page.evaluate(() => localStorage.getItem('botters.session')) === session, 'same session (capability omitted)')
  assert.deepEqual(map(last), map(first))
  assert.ok(last.view.tick > first.view.tick)
  assert.equal(posts.filter(p => p.path === '/session').length, 1)
  assert.equal(posts.filter(p => p.path === '/play').length, 1)
  assert.deepEqual(errors, [])
  observations.push({ action: 'primary ping and continuity', posts: posts.slice(pingStart), sameSession: true, sameMap: true, planets: first.view.planets.length, tickBefore: first.view.tick, tickAfter: last.view.tick, sessionPosts: 1, playPosts: 1 })
  await snapshot('primary-ping')
})

test('in-match keyboard navigation escapes swarm cycling and resumes the same real match', { timeout: 60000 }, async t => {
  const { browser, origin } = await fixture(t)
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [], posts = [], inputs = [], keys = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => {
    if (r.method() !== 'POST') return
    const path = new URL(r.url()).pathname
    posts.push(path)
    if (path === '/input') inputs.push(r.postDataJSON())
  })
  const focus = () => page.evaluate(() => document.activeElement.id || document.activeElement.tagName)
  const selected = () => page.locator('#hud').textContent().then(text => text.match(/grabbed: swarm #(\d+)/)?.[1] || null)
  const press = async key => {
    await page.keyboard.press(key)
    keys.push({ key, focus: await focus(), selected: await selected() })
  }
  const reach = async (selector, key = 'Tab', bound = 40) => {
    const target = page.locator(selector)
    for (let i = 0; i < bound && !await target.evaluate(el => el === document.activeElement); i++) await press(key)
    assert.equal(await target.evaluate(el => el === document.activeElement), true, `${key} must reach ${selector}; native trace: ${JSON.stringify(keys)}`)
  }
  t.after(() => t.diagnostic(`Native keyboard trace (no focus()/click after PLAY): ${JSON.stringify(keys)}`))
  await page.goto(origin)
  await page.evaluate(() => { localStorage.setItem('botters.prefs', JSON.stringify({ vs: 'easy', minutes: 3, planets: 28, planning: 10, withAgent: false, openingMine: true, opening: [{ if: 'always', then: 'hold' }, { if: 'enemy_near', p: 200, then: 'hold', on: false }] })); localStorage.setItem('botters.setupOpen', '1') })
  await page.reload()
  await page.locator('#startName').fill('Keyboard local player')
  await page.locator('#startSolo').click()
  await expect(page.locator('#guidedHouse')).not.toBeChecked()
  await page.locator('#play').click()
  // From here on, all interaction is native keyboard input; evaluations only read.
  await expect(page.locator('#hud')).toContainText('swarms')
  await expect(page.locator('#guidePanel')).toBeHidden()
  const read = () => page.evaluate(() => fetch('/state?token=' + localStorage.getItem('botters.session')).then(r => r.json()))
  const session = await page.evaluate(() => localStorage.getItem('botters.session'))
  const map = frame => frame.view.planets.map(({ id, x, y, r }) => ({ id, x, y, r }))
  const first = await read(), postsBefore = [...posts]
  assert.ok(first.view.tick > 0)
  assert.equal(await focus(), 'BODY')
  await press('Tab')
  assert.equal(await selected(), String(first.view.swarms[0].id))
  await press('Tab')
  const grabbed = await selected()
  assert.equal(grabbed, String(first.view.swarms[1].id))
  await reach('#leave', 'Shift+Tab', 8)
  assert.equal(await selected(), grabbed)
  await press('Shift+Tab'); await expect(page.locator('#editG')).toBeFocused()
  await press('Tab'); await expect(page.locator('#leave')).toBeFocused()
  await press('Shift+Tab'); await expect(page.locator('#editG')).toBeFocused()
  assert.equal(await selected(), grabbed, 'native control traversal must not cycle swarms')
  const originalRules = (await read()).view.gambits, inputsBeforeEditor = inputs.length
  await press('Enter')
  await expect(page.locator('#gEditor')).toBeVisible()
  await reach('#gEditor input[data-k="p"]:not([disabled])', 'Shift+Tab')
  await press('ControlOrMeta+a'); await page.keyboard.type('123')
  await expect(page.locator('#gEditor input[data-k="p"]:not([disabled])')).toHaveValue('123')
  await press('Tab')
  await expect(page.locator('#gEditor select[data-k="then"]').last()).toBeFocused()
  await press('g'); await press('s'); await press('Escape'); await press('1'); await press('0'); await press('F1')
  await expect(page.locator('#guidePanel')).toBeHidden()
  await reach('#cancelG')
  await press('Space')
  await expect(page.locator('#gEditor')).toBeHidden()
  assert.equal(inputs.length, inputsBeforeEditor, 'native editor keys and cancel submit no game orders')
  assert.deepEqual((await read()).view.gambits, originalRules)
  await reach('#leave', 'Shift+Tab')
  await press('F1')
  await expect(page.locator('#guideStep')).toHaveText('1 / 4 · Capture a planet')
  await reach('#guideSwarm', 'Shift+Tab')
  await press('g'); await press('s'); await press('1'); await press('0'); await press('Escape'); await press('F1')
  assert.equal(inputs.length, inputsBeforeEditor, 'native select keys must not become game orders')
  await press('Tab'); await expect(page.locator('#guidePlanet')).toBeFocused()
  await press('Shift+Tab'); await expect(page.locator('#guideSwarm')).toBeFocused()
  await reach('#guideDismiss')
  await press('Enter')
  await expect(page.locator('#guidePanel')).toBeHidden()
  await reach('#leave', 'Shift+Tab')
  // Existing game shortcuts still work outside text fields/selects.
  await press('1')
  await expect.poll(async () => (await read()).view.gambits[0].on).toBe(false)
  await press('1')
  await expect.poll(async () => (await read()).view.gambits[0].on).toBe(true)
  await press('s')
  await expect.poll(() => inputs.some(input => input.split === Number(grabbed))).toBe(true)
  await expect(page.locator('#toast')).toContainText(`✓ swarm #${grabbed} split`)
  await expect.poll(async () => (await read()).view.swarms.length).toBe(first.view.swarms.length + 1)
  await press('g')
  await expect.poll(() => inputs.some(input => input.release === Number(grabbed))).toBe(true)
  await expect(page.locator('#toast')).toContainText(`✓ swarm #${grabbed} back on gambits`)
  await press('Escape')
  assert.equal(await selected(), null)
  await press('Enter')
  await expect(page.locator('#play')).toHaveText('RESUME MATCH')
  const inputsBeforeMenu = inputs.length
  await reach('#doctrine', 'Shift+Tab', 80)
  await press('ControlOrMeta+a')
  await page.keyboard.type('gs10')
  await press('Escape'); await press('F1')
  await expect(page.locator('#doctrine')).toHaveValue('gs10')
  assert.equal(inputs.length, inputsBeforeMenu)
  await reach('#play', 'Tab', 80)
  await press('Space')
  await expect(page.locator('#hud')).toBeVisible()
  assert.equal(await page.evaluate(() => localStorage.getItem('botters.session')), session)
  assert.deepEqual(map(await read()), map(first))
  await expect.poll(async () => (await read()).view.tick).toBeGreaterThan(first.view.tick)
  assert.deepEqual(posts.filter(path => path === '/session' || path === '/play'), postsBefore.filter(path => path === '/session' || path === '/play'))
  assert.equal(posts.filter(path => path === '/session').length, 1)
  assert.equal(posts.filter(path => path === '/play').length, 1)
  assert.deepEqual(errors, [])
  t.diagnostic(`Same session and ${first.view.planets.length}-planet geometry; tick ${first.view.tick} -> ${(await read()).view.tick}; one session/play POST total; no extra session/play on resume`)
})

test('doctrine save recovery preserves refused drafts and acknowledges only submitted revisions', { timeout: 150000 }, async t => {
  const { browser, origin } = await fixture(t)
  for (const inMatch of [false, true]) for (const failure of ['http503', 'network']) await t.test(`${inMatch ? 'match' : 'lobby'} ${failure}`, async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    try {
      const page = await context.newPage(), errors = [], posts = []
      page.on('pageerror', e => errors.push(e.message))
      page.on('request', r => { if (r.method() === 'POST') posts.push(new URL(r.url()).pathname) })
      await page.goto(origin)
      await page.locator('#startName').fill('Synthetic doctrine player')
      const created = page.waitForResponse(r => new URL(r.url()).pathname === '/session' && r.request().method() === 'POST')
      await page.locator('#startSolo').click()
      const { agentToken } = await (await created).json()
      await expect(page.locator('#play')).toBeVisible()
      await page.locator('#setup > summary').click()
      const session = await page.evaluate(() => localStorage.getItem('botters.session'))
      const readLobby = () => page.evaluate(() => fetch('/lobby?token=' + localStorage.getItem('botters.session')).then(r => r.json()))
      const state = () => page.evaluate(() => fetch('/state?token=' + localStorage.getItem('botters.session')).then(r => r.json()))
      const poll = () => page.waitForResponse(r => new URL(r.url()).pathname === '/lobby' && r.request().method() === 'GET', { timeout: 8000 })
      const geometry = frame => frame.view.planets.map(({ id, x, y, r }) => ({ id, x, y, r }))
      let first
      if (inMatch) {
        // A real local API heartbeat, not a model, enables the native agent UI.
        const heartbeat = await context.request.get(`${origin}/next?token=${agentToken}&timeout=0.001`)
        assert.equal(heartbeat.status(), 200)
        await poll()
        await page.locator('#withAgent [data-v="true"]').click()
        await context.route('https://chatgpt.com/**', route => route.fulfill({ status: 200, body: '' }))
        const started = page.waitForResponse(r => new URL(r.url()).pathname === '/play' && r.request().method() === 'POST')
        await page.getByRole('button', { name: 'Play with ChatGPT' }).click(); await started
        await context.request.get(`${origin}/next?token=${agentToken}&timeout=0.001`)
        await expect(page.locator('#hud')).toContainText('swarms')
        await page.locator('#agentBox summary').click()
        await expect(page.locator('#doctrine2')).toBeVisible()
        await expect.poll(async () => (await state()).view.tick).toBeGreaterThan(0)
        first = await state(); assert.ok(first.view.tick > 0)
      }
      const field = page.locator(inMatch ? '#doctrine2' : '#doctrine')
      const status = page.locator(inMatch ? '#doctrineStatus2' : '#saved')
      const retry = page.locator(inMatch ? '#sendDoctrine' : '#retryDoctrine')
      const serverBefore = (await readLobby()).doctrine
      let fail = true, attempts = 0, release, reached, releaseB, reachedB
      let delayed = false, holdB = false
      const held = new Promise(resolve => { reached = resolve })
      const heldB = new Promise(resolve => { reachedB = resolve })
      await page.route('**/profile?*', async route => {
        if (route.request().method() !== 'POST' || typeof route.request().postDataJSON()?.doctrine !== 'string') return route.continue()
        attempts++
        if (fail) return failure === 'http503'
          ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic local refusal' }) })
          : route.abort('failed')
        if (delayed) {
          delayed = false
          // Execute the real write first; hold only its real acknowledgement.
          const response = await route.fetch()
          await new Promise(resolve => { release = resolve; reached() })
          return route.fulfill({ response })
        }
        if (holdB) {
          holdB = false
          const response = await route.fetch()
          await new Promise(resolve => { releaseB = resolve; reachedB() })
          return route.fulfill({ response })
        }
        return route.continue()
      })
      const draft = `  Synthetic ${inMatch ? 'match' : 'lobby'} recovery ${failure}  `
      await field.fill(draft)
      await page.keyboard.press('Tab') // real blur, then native activation in match
      if (inMatch) { await expect(retry).toBeFocused(); await page.keyboard.press('Enter') }
      await expect.poll(() => attempts).toBe(1)
      if (inMatch) {
        await page.locator('#agentBox summary').click()
        await page.locator('#leave').click()
      }
      await poll() // actual scheduled lobby refresh, not a direct helper call
      const actualStatus = await page.locator(inMatch ? '#toast' : '#saved').textContent()
      t.diagnostic(`${inMatch ? 'match' : 'lobby'} ${failure}: post-failure status=${JSON.stringify(actualStatus)}; scheduled poll observed`)
      await expect(page.locator('#doctrine')).toHaveValue(draft)
      assert.equal((await readLobby()).doctrine, serverBefore)
      assert.equal(attempts, 1, 'polls must not retry writes')
      if (inMatch) {
        await page.locator('#play').click()
        await page.locator('#agentBox summary').click()
      }
      await expect(field).toHaveValue(draft)
      await expect(status).toContainText('not saved')
      await expect(page.locator('#toast')).not.toContainText('✓ doctrine')
      await expect(page.locator('#saved')).not.toContainText('doctrine saved')
      if (process.env.BOTTERS_DOCTRINE_EVIDENCE) {
        await mkdir(process.env.BOTTERS_DOCTRINE_EVIDENCE, { recursive: true })
        await page.screenshot({ path: join(process.env.BOTTERS_DOCTRINE_EVIDENCE, `${inMatch ? 'match' : 'lobby'}-${failure}-retained.png`) })
      }
      fail = false
      await field.click(); await page.keyboard.press('Tab')
      await expect(retry).toBeFocused()
      await page.keyboard.press('Enter') // retry without modifying or retyping
      await expect(status).toContainText('doctrine saved')
      assert.equal((await readLobby()).doctrine, draft.trim())
      assert.equal(attempts, 2)

      // Delayed acknowledgement A cannot confirm, replace or discard edit B.
      delayed = true
      await field.fill('Synthetic revision A')
      if (inMatch) { await page.keyboard.press('Tab'); await page.keyboard.press('Enter') }
      await held
      const attemptsAtA = attempts
      await field.fill('Synthetic revision B')
      if (!inMatch) {
        holdB = true
        await page.waitForTimeout(650) // B's real debounce elapses while A is held
        assert.equal(attempts, attemptsAtA, 'writes are serialized, not reordered')
      }
      release()
      if (!inMatch) {
        await heldB
        await expect(field).toHaveValue('Synthetic revision B')
        await expect(status).not.toContainText('doctrine saved')
        releaseB()
      }
      if (inMatch) {
        await page.locator('#agentBox summary').click()
        await page.locator('#leave').click()
        await poll()
        await expect(page.locator('#doctrine')).toHaveValue('Synthetic revision B')
        assert.equal((await readLobby()).doctrine, 'Synthetic revision A')
        await expect(page.locator('#saved')).not.toContainText('doctrine saved')
        await page.locator('#play').click()
        await page.locator('#agentBox summary').click()
        await expect(field).toHaveValue('Synthetic revision B')
        await expect(status).toContainText('not saved')
        await field.click(); await page.keyboard.press('Tab'); await expect(retry).toBeFocused(); await page.keyboard.press('Enter')
      }
      await expect(status).toContainText('doctrine saved')
      assert.equal((await readLobby()).doctrine, 'Synthetic revision B')
      await expect(field).toHaveValue('Synthetic revision B')

      // Ordinary save, server normalization and native maxlength remain intact.
      for (const text of ['   Synthetic trimmed doctrine   ', '', 'x'.repeat(510)]) {
        await field.click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(text)
        const entered = await field.inputValue()
        assert.ok(entered.length <= 500)
        if (inMatch) { await page.keyboard.press('Tab'); await page.keyboard.press('Enter') }
        await expect(status).toContainText('doctrine saved')
        assert.equal((await readLobby()).doctrine, entered.trim().slice(0, 500))
      }
      await field.click(); await page.keyboard.press('Tab')
      if (inMatch) await page.locator('#leave').click()
      await poll()
      await expect(page.locator('#doctrine')).toHaveValue('x'.repeat(500))
      if (inMatch) {
        await page.locator('#play').click()
        const last = await state()
        assert.deepEqual(geometry(last), geometry(first))
        assert.ok(last.view.tick > first.view.tick)
        t.diagnostic(`match ${failure}: same map; ticks ${first.view.tick} -> ${last.view.tick}`)
      }
      assert.ok(await page.evaluate(() => localStorage.getItem('botters.session')) === session, 'same session (capability omitted)')
      assert.equal(posts.filter(path => path === '/session').length, 1)
      assert.equal(posts.filter(path => path === '/play').length, inMatch ? 1 : 0)
      assert.deepEqual(errors, [])
      t.diagnostic(`${inMatch ? 'match' : 'lobby'} ${failure}: keyboard retry, delayed A/edit B, real GET normalization, one session and ${inMatch ? 1 : 0} play POST; no model invoked`)
    } finally { await context.close() }
  })
})

test('doctrine save recovery ignores a lobby snapshot predating an acknowledged edit', { timeout: 20000 }, async t => {
  const { browser, origin } = await fixture(t)
  const page = await browser.newPage()
  await page.goto(origin)
  await page.locator('#startName').fill('Synthetic stale poll player')
  const initial = page.waitForResponse(r => new URL(r.url()).pathname === '/lobby')
  await page.locator('#startSolo').click(); await initial
  await page.locator('#setup > summary').click()
  await expect(page.locator('#doctrine')).not.toHaveValue('')
  let release, reached
  const held = new Promise(resolve => { reached = resolve })
  await page.route('**/lobby?*', async route => {
    const response = await route.fetch()
    await new Promise(resolve => { release = resolve; reached() })
    await route.fulfill({ response })
  }, { times: 1 })
  await held // hold a real, scheduled GET containing the old server value
  await page.locator('#doctrine').fill('Synthetic newer acknowledged doctrine')
  await page.keyboard.press('Tab')
  await expect(page.locator('#saved')).toHaveText('doctrine saved')
  const oldPoll = page.waitForResponse(r => new URL(r.url()).pathname === '/lobby')
  release(); await oldPoll
  // A later render task must have consumed the stale response before asserting.
  await page.waitForTimeout(100)
  await expect(page.locator('#doctrine')).toHaveValue('Synthetic newer acknowledged doctrine')
  const current = await page.evaluate(() => fetch('/lobby?token=' + localStorage.getItem('botters.session')).then(r => r.json()))
  assert.equal(current.doctrine, 'Synthetic newer acknowledged doctrine')
  t.diagnostic('Real old GET released after real POST acknowledgement: newer doctrine retained after blur')
})

test('invalid saved preferences do not block local play', { timeout: 90000 }, async t => {
  const { browser, origin } = await fixture(t)
  const settings = { vs: 'easy', minutes: 3, planets: 16, planning: 10, withAgent: false, openingMine: true }
  const custom = [{ if: 'enemy_near', p: 123.5, then: 'retreat', on: false }, { if: 'always', then: 'hold', on: true }]
  const cases = [
    ['null opening', JSON.stringify({ opening: null })],
    ['truncated JSON', '{"vs":'],
    ['null root', 'null'],
    ['array root', '[{"opening":null}]'],
    ['string root', '"saved"'],
    ['number root', '42'],
    ['boolean root', 'false'],
    ...[
      ['object opening', {}],
      ['empty opening', []],
      ['too many rules', Array.from({ length: MAX_GAMBITS + 1 }, () => ({ if: 'always', then: 'hold' }))],
      ['unknown condition', [{ if: 'obsolete_condition', then: 'hold' }]],
      ['unknown action', [{ if: 'always', then: 'obsolete_action' }]],
      ['invalid parameter', [{ if: 'enemy_near', p: -1, then: 'go' }]],
    ].map(([name, opening]) => [name, JSON.stringify({ ...settings, opening }), settings]),
    ['absent key', null],
    ['absent opening', JSON.stringify(settings), settings],
    ['valid disabled strategy', JSON.stringify({ ...settings, opening: custom }), settings, custom],
    ['existing real session', '{"opening":null}', undefined, undefined, true],
  ]
  for (const [name, initialRaw, savedSettings, opening = DEFAULT_GAMBITS, existingSession] of cases) await t.test(name, async () => {
    let raw = initialRaw
    const context = await browser.newContext()
    try {
      const page = await context.newPage(), errors = [], posts = []
      page.on('pageerror', e => errors.push(e.message))
      page.on('request', r => { if (r.method() === 'POST') posts.push(new URL(r.url()).pathname) })
      // A real same-origin document seeds only synthetic data, once (not again on reload).
      await page.goto(origin + '/privacy')
      let session = null
      if (existingSession) {
        const response = await context.request.post(origin + '/session', { data: { name: 'Returning recovery player' } })
        assert.equal(response.status(), 200)
        session = (await response.json()).humanToken
        assert.equal(typeof session, 'string'); assert.ok(session.length > 0)
      }
      await page.evaluate(({ raw, session }) => {
        if (raw !== null) localStorage.setItem('botters.prefs', raw)
        if (session) localStorage.setItem('botters.session', session)
        localStorage.setItem('unrelated.test', 'keep')
        sessionStorage.setItem('unrelated.tab', 'keep-tab')
        sessionStorage.setItem('botters.pair', 'p'.repeat(32))
      }, { raw, session })
      const storage = () => page.evaluate(() => ({ prefs: localStorage.getItem('botters.prefs'), unrelated: localStorage.getItem('unrelated.test'), tab: sessionStorage.getItem('unrelated.tab'), pair: sessionStorage.getItem('botters.pair'), session: localStorage.getItem('botters.session') }))
      const unchanged = async () => assert.deepEqual(await storage(), { prefs: raw, unrelated: 'keep', tab: 'keep-tab', pair: 'p'.repeat(32), session })
      await page.goto(origin)
      await expect.poll(async () => errors.length > 0 || await page.locator('#startSolo').isEnabled()).toBe(true)
      assert.deepEqual(errors, [], 'saved preferences must not abort module initialization')
      if (!existingSession) {
        await expect(page.locator('#offlineEntry')).toBeVisible()
        await expect(page.locator('#startSolo')).toBeEnabled()
        await unchanged()
        await page.locator('#startName').fill('Preferences recovery player')
        await page.locator('#startSolo').click()
      }
      await expect(page.locator('#play')).toBeVisible()
      await expect(page.locator('#vs .on')).toHaveAttribute('data-v', savedSettings?.vs || 'normal')
      for (const id of ['minutes', 'planets', 'planning']) await expect(page.locator(`#${id} .on`)).toHaveAttribute('data-v', String(savedSettings?.[id] ?? { minutes: 5, planets: 28, planning: 20 }[id]))
      const rows = await page.locator('#openEditor .ed').evaluateAll(rows => rows.map(row => {
        const p = row.querySelector('[data-k="p"]').value
        return { if: row.querySelector('[data-k="if"]').value, ...(p && { p: Number(p) }), then: row.querySelector('[data-k="then"]').value, on: row.querySelector('[data-k="on"]').checked }
      }))
      assert.deepEqual(rows, opening)
      const loadedSession = (await storage()).session
      assert.equal(typeof loadedSession, 'string'); assert.ok(loadedSession.length > 0)
      if (existingSession) assert.equal(loadedSession, session)
      session = loadedSession
      await unchanged()
      await page.locator('#play').click()
      await expect(page.locator('#hud')).toContainText('swarms')
      const read = () => page.evaluate(() => fetch('/state?token=' + localStorage.getItem('botters.session')).then(r => r.json()))
      // The initial HUD can render before the server's first simulation tick.
      await expect.poll(async () => (await read()).view.tick).toBeGreaterThan(0)
      const first = await read()
      assert.ok(first.view.tick > 0)
      assert.equal(first.opponent.name, `house (${savedSettings?.vs || 'normal'})`)
      assert.equal(first.me.withAgent, false)
      assert.deepEqual(first.view.gambits, opening)
      const map = frame => frame.view.planets.map(({ id, x, y, r }) => ({ id, x, y, r }))
      const postsBefore = [...posts]
      await unchanged()
      await page.reload()
      await expect(page.locator('#hud')).toContainText('swarms')
      await expect.poll(async () => (await read()).view.tick).toBeGreaterThan(first.view.tick)
      assert.deepEqual(map(await read()), map(first))
      assert.deepEqual((await read()).view.gambits, opening)
      assert.deepEqual(posts, postsBefore, 'reload must not create a session or start another match')
      assert.equal(posts.filter(p => p === '/session').length, existingSession ? 0 : 1)
      assert.equal(posts.filter(p => p === '/play').length, 1)
      await unchanged()
      if (name === 'null opening') {
        // The next real settings edit still saves normally; recovery itself did not.
        await page.locator('#leave').click()
        await page.locator('#setup > summary').click()
        await page.locator('#minutes [data-v="3"]').click()
        const saved = JSON.parse((await storage()).prefs)
        assert.equal(saved.minutes, 3)
        assert.deepEqual(saved.opening, DEFAULT_GAMBITS)
        raw = JSON.stringify(saved)
        await unchanged()
      }
      assert.deepEqual(errors, [])
      t.diagnostic(`${name}: real house tick ${first.view.tick}, session/map continuity verified; raw storage preserved until explicit edit`)
    } finally { await context.close() }
  })
})

test('casual lobby: one choice and PLAY up front, live swarm backdrop, settings folded away', { timeout: 30000 }, async t => {
  const { browser, origin } = await fixture(t)
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(origin)
  await page.locator('#startName').fill('Casual player')
  await page.locator('#startSolo').click()
  await expect(page.locator('#play')).toBeInViewport()
  await expect(page.locator('#vs [data-v="normal"]')).toHaveText('Normal')
  await expect(page.locator('#withAgent')).toBeHidden() // no agent: no agent choice to read
  for (const id of ['#doctrine', '#openAgent', '#minutes', '#history']) await expect(page.locator(id)).toBeHidden()
  const visibleWords = (await page.locator('#lobby').innerText()).split(/\s+/).filter(Boolean).length
  assert.ok(visibleWords < 60, `lobby shows ${visibleWords} words before any click`)
  const pixels = () => page.locator('#bg').evaluate(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i]) | 0; return h })
  const before = await pixels(); await page.waitForTimeout(300)
  assert.notEqual(await pixels(), before, 'backdrop swarms must move')
  await page.getByText('Strategy & settings').click()
  await expect(page.locator('#doctrine')).toBeVisible()
  await page.locator('#play').click()
  await expect(page.locator('#hud')).toContainText('swarms')
  await expect(page.locator('#bg')).toBeHidden()
  assert.deepEqual(errors, [])
})
