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
  await page.waitForFunction(() => document.querySelector('#hud').textContent.includes('battalions'), null, { timeout: 5000 })
  const read = () => page.evaluate(() => fetch('/state?token=' + localStorage.getItem('botters.session')).then(r => r.json()))
  await expect.poll(async () => (await read()).view.tick, { timeout: 5000 }).toBeGreaterThan(0) // the HUD can render before the first tick
  const first = await read()
  const session = await page.evaluate(() => localStorage.getItem('botters.session'))
  const map = frame => frame.view.planets.map(({ id, x, y, r }) => ({ id, x, y, r }))
  await page.reload()
  await page.waitForFunction(() => document.querySelector('#hud').textContent.includes('battalions'), null, { timeout: 5000 })
  // Reconnect keeps the same server-issued match identity and map.
  assert.equal((await read()).matchId, first.matchId)
  assert.equal(await page.evaluate(() => localStorage.getItem('botters.session')), session)
  assert.deepEqual(map(await read()), map(first))
  await expect.poll(async () => (await read()).view.tick).toBeGreaterThan(first.view.tick)
  assert.ok(requests.filter(p => p === '/stream').length >= 2)
  assert.ok(!requests.includes('/live-client.js'))
  assert.deepEqual(errors, [])
})

test('queued actions from an old match do not reach the next match', { timeout: 30000 }, async t => {
  const { browser, origin } = await fixture(t)
  const page = await browser.newPage(), inputs = []
  let release, reached
  const gate = new Promise(r => { release = r }), held = new Promise(r => { reached = r })
  t.after(() => release())
  await page.route('**/input?*', async route => {
    inputs.push(route.request().postDataJSON())
    if (inputs.length === 1) { reached(); await gate }
    await route.continue()
  })
  await page.goto(origin); await page.locator('#startSolo').click(); await page.locator('#play').click()
  if (!await page.locator('#gambitsBox').evaluate(el => el.open)) await page.locator('#gambitsBox > summary').click()
  await page.locator('#gambits [data-g]').first().waitFor()
  await page.locator('#gambits [data-g]').nth(0).click(); await held; t.diagnostic('held old input')
  await page.locator('#gambits [data-g]').nth(1).click(); t.diagnostic('queued second input')
  const token = await page.evaluate(() => localStorage.getItem('botters.session'))
  const old = await page.evaluate(() => fetch('/state?token=' + localStorage.getItem('botters.session')).then(r => r.json()))
  assert.equal((await page.request.post(origin + '/surrender?token=' + token, { data: { matchId: old.matchId } })).status(), 200)
  t.diagnostic('surrendered old match'); await expect(page.locator('#again')).toBeVisible(); await page.locator('#again').click()
  if (!await page.locator('#gambitsBox').evaluate(el => el.open)) await page.locator('#gambitsBox > summary').click()
  await page.locator('#gambits [data-g]').first().waitFor()
  const current = await page.evaluate(() => fetch('/state?token=' + localStorage.getItem('botters.session')).then(r => r.json()))
  assert.notEqual(current.matchId, old.matchId); t.diagnostic('new match ready')
  await page.locator('#gambits [data-g]').nth(2).click()
  await expect.poll(() => inputs.length).toBe(2)
  assert.equal(inputs[1].matchId, current.matchId); assert.equal(inputs[1].toggle, 2)
  const stale = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/input' && r.request().postDataJSON().matchId === old.matchId)
  release(); assert.equal((await stale).status(), 409)
  assert.deepEqual(inputs.map(i => i.toggle), [0, 2])
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
  await expect(page.locator('#hud')).toContainText('battalions')
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
  await page.route('**/surrender?*', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Synthetic surrender refusal"}' }), { times: 1 })
  page.once('dialog', dialog => dialog.accept())
  await page.locator('#surrender').click()
  await expect(page.locator('#toast')).toHaveText('Synthetic surrender refusal')
  await expect(page.locator('#surrender')).toBeEnabled()
  assert.equal((await read()).view.ended, null)
  // A room that is catching up answers 503: the order is retried, not dropped. The route answers once, then lets the retry through.
  let catchingUp = 0
  await page.route('**/input?*', route => { catchingUp++; return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Match is catching up. Retry shortly."}' }) }, { times: 1 })
  if (!await page.locator('#gambitsBox').evaluate(el => el.open)) await page.locator('#gambitsBox > summary').click()
  const rule = page.locator('#gambits [data-g]').first(), wasOff = /off/.test(await rule.getAttribute('class') || '')
  const accepted = page.waitForResponse(r => r.url().includes('/input?') && r.status() === 200)
  await rule.click()
  await accepted
  assert.equal(catchingUp, 1)
  await expect(rule).toHaveClass(wasOff ? /^(?!.*\boff\b)/ : /\boff\b/)
  page.once('dialog', async dialog => { assert.match(dialog.message(), /You will lose/); await dialog.accept() })
  await page.locator('#surrender').focus(); await page.keyboard.press('Enter')
  await expect(page.locator('#again')).toBeVisible()
  await expect(page.locator('#big')).toContainText('lose')
  await expect(page.locator('#surrender')).toBeHidden()
  assert.ok((await read()).view.ended)
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

test('match journal records doctrine and hand orders beside the left panel', { timeout: 30000 }, async t => {
  const { browser, origin } = await fixture(t)
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto(origin); await page.locator('#startName').fill('Journal player'); await page.locator('#startSolo').click(); await page.locator('#play').click()
  await expect(page.locator('#hud')).toContainText('battalions')
  await page.waitForTimeout(1200)
  await page.locator('#gambitsBox > summary').click()
  await page.locator('#gambits [data-g]').first().click()
  await page.locator('#battalions [data-bat]').first().click()
  await page.locator('#c').click({ position: { x: 600, y: 300 } })
  await expect(page.locator('#journal')).toContainText(/Journal player:.*✎/)
  await expect(page.locator('#journal')).toContainText(/Journal player:.*ordered battalion/)
  const aside = await page.locator('aside').boundingBox(), canvas = await page.locator('#c').boundingBox()
  assert.equal(aside.x, 0); assert.equal(aside.width, 400); assert.ok(canvas.x >= aside.x + aside.width - 0.1)
})

test('map orders use the selected battalion and reach the live view', { timeout: 30000 }, async t => {
  const { browser, origin } = await fixture(t)
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), inputs = []
  page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/input') inputs.push(r.postDataJSON()) })
  await page.goto(origin); await page.locator('#startSolo').click(); await page.locator('#play').click()
  const row = page.locator('#battalions [data-bat]').first(); await row.waitFor()
  const id = Number(await row.getAttribute('data-bat')); await row.click()
  const canvas = page.locator('#c'), box = await canvas.boundingBox()
  const size = await canvas.evaluate(c => ({ width: c.width, height: c.height }))
  const position = { x: box.width - 3, y: box.height - 3 }
  const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/input')
  await canvas.click({ position })
  assert.equal((await response).status(), 200)
  assert.equal(inputs[0].order.bat, id)
  assert.ok(Math.abs(inputs[0].order.x - position.x * size.width / box.width) <= 2)
  assert.ok(Math.abs(inputs[0].order.y - position.y * size.height / box.height) <= 2)
  await expect(page.locator(`#battalions [data-bat="${id}"]`)).toContainText('hand order')
  await page.keyboard.press('q')
  await expect(page.locator(`#battalions [data-bat="${id}"]`)).not.toContainText('hand order')
})

test('keyboard selects battalions and dispatches particle commands', { timeout: 30000 }, async t => {
  const { browser, origin } = await fixture(t)
  const page = await browser.newPage(), inputs = []
  page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/input') inputs.push(r.postDataJSON()) })
  await page.goto(origin); await page.locator('#startSolo').click(); await page.locator('#play').click()
  const row = page.locator('#battalions [data-bat]').first(); await row.waitFor()
  const id = Number(await row.getAttribute('data-bat'))
  await page.evaluate(() => document.activeElement.blur())
  await page.keyboard.press('Tab'); await expect(row).toHaveClass(/on/)
  await page.keyboard.press('2'); await expect(page.locator('#battalions [data-bat]').nth(1)).toHaveClass(/on/)
  await page.keyboard.press('1'); await expect(row).toHaveClass(/on/)
  await page.keyboard.press('x'); await expect.poll(() => inputs.some(i => i.flank === id)).toBe(true)
  await page.keyboard.press('r'); await expect.poll(() => inputs.some(i => i.detach?.bat === id && i.detach.role === 'runner')).toBe(true)
  await page.keyboard.press('d'); await expect.poll(() => inputs.some(i => i.detach?.bat === id && !i.detach.role)).toBe(true)
  await page.keyboard.press('q'); await expect.poll(() => inputs.some(i => i.release === id)).toBe(true)
  await page.keyboard.press('Escape'); await expect(row).not.toHaveClass(/on/)
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
        await expect(page.locator('#hud')).toContainText('battalions')
        await page.locator('#doctrineBox > summary').click()
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
        await page.locator('#doctrineBox > summary').click()
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
        await page.locator('#doctrineBox > summary').click()
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
        await page.locator('#doctrineBox > summary').click()
        await page.locator('#leave').click()
        await poll()
        await expect(page.locator('#doctrine')).toHaveValue('Synthetic revision B')
        assert.equal((await readLobby()).doctrine, 'Synthetic revision A')
        await expect(page.locator('#saved')).not.toContainText('doctrine saved')
        await page.locator('#play').click()
        await page.locator('#doctrineBox > summary').click()
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

test('invalid saved preferences do not block local play', { timeout: 180000 }, async t => {
  const { browser, origin } = await fixture(t)
  const settings = { vs: 'easy', minutes: 3, planets: 9, planning: 10, withAgent: false, openingMine: true }
  const custom = [{ if: 'weaker_enemy_near', p: 3, then: 'retreat', on: false }, { if: 'always', then: 'hold', on: true }]
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
      for (const id of ['minutes', 'planets', 'planning']) await expect(page.locator(`#${id} .on`)).toHaveAttribute('data-v', String(savedSettings?.[id] ?? { minutes: 5, planets: 17, planning: 20 }[id]))
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
      await expect(page.locator('#hud')).toContainText('battalions')
      const read = () => page.evaluate(() => fetch('/state?token=' + localStorage.getItem('botters.session')).then(r => r.json()))
      // The initial HUD can render before the server's first simulation tick.
      await expect.poll(async () => (await read()).view.tick).toBeGreaterThan(0)
      const first = await read()
      assert.ok(first.view.tick > 0)
      assert.ok(first.opponent.name.startsWith(`house (${savedSettings?.vs || 'normal'} · `))
      assert.equal(first.me.withAgent, false)
      assert.deepEqual(first.view.gambits, opening)
      const map = frame => frame.view.planets.map(({ id, x, y, r }) => ({ id, x, y, r }))
      const postsBefore = [...posts]
      await unchanged()
      await page.reload()
      await expect(page.locator('#hud')).toContainText('battalions')
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

test('casual lobby: one choice and PLAY up front, live particle backdrop, settings folded away', { timeout: 30000 }, async t => {
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
  assert.notEqual(await pixels(), before, 'backdrop particles must move')
  await page.getByText('Strategy & settings').click()
  await expect(page.locator('#doctrine')).toBeVisible()
  await page.locator('#play').click()
  await expect(page.locator('#hud')).toContainText('battalions')
  await expect(page.locator('#bg')).toBeHidden()
  assert.deepEqual(errors, [])
})
