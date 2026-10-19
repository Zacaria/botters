import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
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
  await page.evaluate(() => localStorage.setItem('botters.prefs', JSON.stringify({ vs: 'easy', minutes: 3, planets: 28, planning: 10, withAgent: false, openingMine: true, opening: [{ if: 'always', then: 'hold' }, { if: 'enemy_near', p: 200, then: 'hold', on: false }] })))
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
