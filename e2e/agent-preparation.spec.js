import { test, expect } from './fixtures.js'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

if (process.env.BOTTERS_SERVER || process.env.BOTTERS_LIVE_SERVER || process.env.BOTTERS_DEV_CONVEX) throw new Error('Preparation tests require local ephemeral fixtures.')
const opening = [{ if: 'always', then: 'hold' }]

async function enter(page, request, baseURL, setup = 'Browser agent') {
  const session = await request.post(baseURL + '/session', { data: { name: 'Preparation player', ...(setup && { setup }) } }).then(r => r.json())
  await page.addInitScript(() => localStorage.setItem('botters.prefs', JSON.stringify({ withAgent: true, openingMine: false, minutes: 3, planets: 16, planning: 10 })))
  await page.goto(`${baseURL}/?s=${session.humanToken}`)
  await expect(page.locator('#play')).toBeVisible()
  await page.locator('#setup').evaluate(e => { e.open = true })
  return session
}
const getLobby = (request, baseURL, s) => request.get(`${baseURL}/lobby?token=${s.humanToken}`).then(r => r.json())

test('agent preparation: saved rules, not connection, unlock human start', async ({ page, request, baseURL }) => {
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  const s = await enter(page, request, baseURL)
  await expect(page.locator('#agentState')).toContainText('connected')
  await expect(page.locator('#play')).toBeDisabled()
  await page.getByRole('button', { name: 'Prepare with my agent', exact: true }).click()
  await expect(page.locator('#preparationStatus')).toContainText('Waiting for your agent')
  expect((await getLobby(request, baseURL, s)).live).toBe(false)
  const next = await request.get(`${baseURL}/next?token=${s.agentToken}`).then(r => r.json())
  expect(next.match).toBeNull()
  expect(next.preparation.id).toBeTruthy()
  const saved = await request.post(`${baseURL}/input?token=${s.agentToken}`, { data: { preparationId: next.preparation.id, gambits: opening, why: 'Keep the opening together.' } }).then(r => r.json())
  expect(saved.error).toBeUndefined()
  await expect(page.locator('#preparationStatus')).toHaveText('Opening ready', { timeout: 12000 })
  await expect(page.locator('#preparationRules')).toContainText('IF always → hold')
  await expect(page.locator('#preparationWhy')).toHaveText('Keep the opening together.')
  await expect(page.locator('#play')).toBeEnabled()
  // Fixture clock runs ×10: presence expires after nine real seconds, rules do not.
  await page.waitForTimeout(10000)
  await page.reload()
  await page.locator('#setup').evaluate(e => { e.open = true })
  await expect(page.locator('#agentState')).not.toContainText('Browser agent connected')
  await expect(page.locator('#openEditor')).toBeVisible()
  await expect(page.locator('#preparationStatus')).toHaveText('Opening ready')
  await expect(page.locator('#play')).toBeEnabled()
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.locator('#lobby').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true)
    if (process.env.BOTTERS_PREPARATION_SCREENSHOTS) {
      await page.locator('#preparationPanel').scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${process.env.BOTTERS_PREPARATION_SCREENSHOTS}/saved-opening-${width}.png` })
    }
  }
  await page.locator('#play').click()
  await expect(page.locator('#hud')).toBeVisible()
  const frame = await request.get(`${baseURL}/state?token=${s.humanToken}`).then(r => r.json())
  expect(frame.me.withAgent).toBe(true)
  expect(frame.view.gambits).toEqual([{ ...opening[0], on: true }])
  expect(frame.gambitsBy.who).toBe('agent')
  expect(errors).toEqual([])
})

async function prepare(page, request, origin, s, doctrine) {
  if (doctrine) await page.locator('#doctrine').fill(doctrine)
  // Anonymous fixtures have no durable grant: the agent returns to prepare a new plan.
  expect((await request.get(`${origin}/next?token=${s.agentToken}`)).ok()).toBe(true)
  await page.locator('#prepareAgent').click()
  await expect(page.locator('#preparationStatus')).toContainText('Waiting for your agent')
  const next = await request.get(`${origin}/next?token=${s.agentToken}`).then(r => r.json())
  expect(next.match).toBeNull()
  expect(next.preparation.id).toBeTruthy()
  if (doctrine) expect(next.preparation.doctrine).toBe(doctrine)
  const response = await request.post(`${origin}/input?token=${s.agentToken}`, { data: { preparationId: next.preparation.id, gambits: opening, why: 'Saved before the human starts.' } })
  expect(response.ok()).toBe(true)
  await expect(page.locator('#preparationStatus')).toHaveText('Opening ready', { timeout: 12000 })
  return next.preparation
}

test('agent preparation: flush failures and changed settings never use an old opening', async ({ page, request, baseURL }) => {
  const s = await enter(page, request, baseURL)
  const first = await prepare(page, request, baseURL, s, 'Keep our swarms together.')
  await page.locator('#minutes button[data-v="5"]').click()
  await expect(page.locator('#play')).toBeDisabled()
  await expect(page.locator('#preparationRules')).toBeEmpty()
  await page.locator('#minutes button[data-v="3"]').click()
  await expect(page.locator('#play')).toBeEnabled()
  let blocked = 0
  await page.route('**/profile?*', route => { if (route.request().postDataJSON()?.doctrine) { blocked++; return route.abort('failed') } return route.continue() })
  await page.locator('#doctrine').fill('A changed unsaved strategy.')
  await expect(page.locator('#preparationStatus')).not.toHaveText('Opening ready')
  await page.locator('#prepareAgent').click()
  await expect(page.locator('#lobbyMsg')).toContainText('Doctrine not saved')
  expect(blocked).toBeGreaterThan(0)
  expect((await getLobby(request, baseURL, s)).preparation.id).toBe(first.id)
  await page.locator('#withAgent button[data-v="false"]').click()
  await page.locator('#play').click()
  await expect(page.locator('#lobbyMsg')).toContainText('Doctrine not saved')
  expect((await getLobby(request, baseURL, s)).live).toBe(false)
  await page.unroute('**/profile?*')
  await page.locator('#withAgent button[data-v="true"]').click()
  const second = await prepare(page, request, baseURL, s)
  expect(second.id).not.toBe(first.id)
  expect(second.doctrine).toBe('A changed unsaved strategy.')
  await page.locator('#play').click()
  await expect(page.locator('#hud')).toBeVisible()
})

for (const manual of [false, true]) test(`agent preparation: ${manual ? 'manual opening' : 'solo'} starts without preparation`, async ({ page, request, baseURL }) => {
  const s = await enter(page, request, baseURL, manual ? 'Browser agent' : null)
  if (manual) await page.locator('#openMine').click()
  else {
    await expect(page.locator('#withAgent button[data-v="false"]')).toHaveClass('on')
    await expect(page.locator('#play')).toBeEnabled()
    await page.locator('#withAgent button[data-v="true"]').click()
    await page.waitForResponse(r => r.url().includes('/lobby?') && r.ok())
    await expect(page.locator('#withAgent button[data-v="true"]')).toHaveClass('on')
    await expect(page.locator('#play')).toBeDisabled()
    await page.locator('#withAgent button[data-v="false"]').click()
  }
  await expect(page.locator('#openEditor')).toBeVisible()
  await expect(page.locator('#play')).toBeEnabled()
  await page.locator('#play').click()
  await expect(page.locator('#hud')).toBeVisible()
  const frame = await request.get(`${baseURL}/state?token=${s.humanToken}`).then(r => r.json())
  expect(frame.me.withAgent).toBe(manual)
  expect((await getLobby(request, baseURL, s)).preparation).toBeFalsy()
})

test('agent preparation: offline native SSE prepares and starts with the saved opening', async ({ page, request }) => {
  const reservation = net.createServer()
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const origin = `http://127.0.0.1:${port}`
  const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), BOTTERS_ORIGIN: origin, BOTTERS_START_DELAY: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
  const closed = once(server, 'exit')
  try {
    await Promise.race([once(server.stderr, 'data'), closed.then(() => { throw new Error('Offline fixture exited before startup') })])
    const s = await enter(page, request, origin)
    await expect(page.locator('#play')).toBeDisabled()
    await prepare(page, request, origin, s, 'Offline opening, saved before play.')
    expect((await getLobby(request, origin, s)).live).toBeFalsy()
    await page.locator('#play').click()
    await expect(page.locator('#hud')).toBeVisible()
    const frame = await request.get(`${origin}/state?token=${s.humanToken}`).then(r => r.json())
    expect(frame.me.withAgent).toBe(true)
    expect(frame.gambitsBy.who).toBe('agent')
    expect(frame.view.gambits).toEqual([{ ...opening[0], on: true }])
  } finally {
    server.kill()
    await closed
  }
})


test('agent preparation: quick play requires an online opening, not a house plan', async ({ page, request, baseURL }) => {
  const s = await enter(page, request, baseURL)
  await prepare(page, request, baseURL, s)
  await expect(page.locator('#quick')).toBeDisabled()
  await page.locator('#vs button[data-v="player"]').click()
  await expect(page.locator('#play')).toBeDisabled()
  await expect(page.locator('#quick')).toBeDisabled()
  const plan = await prepare(page, request, baseURL, s)
  expect(plan.options.vs).toBe('player')
  await expect(page.locator('#quick')).toBeEnabled()
  await page.locator('#quick').click()
  await expect(page.locator('#cancel')).toBeVisible()
  const lobby = await getLobby(request, baseURL, s)
  expect(lobby.queued).toBe(true)
  expect(lobby.live).toBe(false)
  await page.locator('#cancel').click()
})

test('agent preparation: room settings are canonical, plans private, rematch guarded', async ({ page, browser, request, baseURL }) => {
  const other = await browser.newContext(), guest = await other.newPage()
  try {
    const hostSession = await enter(page, request, baseURL)
    await page.locator('#withAgent button[data-v="false"]').click()
    await page.locator('#createRoom').click()
    await expect(page.locator('#roomPanel')).toBeVisible()
    const code = await page.locator('#roomCode').textContent()
    const guestSession = await enter(guest, request, baseURL)
    await guest.locator('#minutes button[data-v="5"]').click()
    await guest.locator('#joinCode').fill(code)
    await guest.locator('#joinRoom').click()
    await expect(guest.locator('#roomCode')).toHaveText(code)
    const plan = await prepare(guest, request, baseURL, guestSession)
    expect(plan.options.minutes).toBe(3)
    expect((await getLobby(request, baseURL, hostSession)).preparation).toBeFalsy()
    await expect(page.locator('#preparationRules')).toBeEmpty()
    await expect(page.locator('#startRoom')).toBeEnabled()
    await page.locator('#startRoom').click()
    await expect(guest.locator('#hud')).toBeVisible()
    await guest.locator('#doctrine2').evaluate(e => { e.closest('details').open = true })
    await guest.locator('#doctrine2').fill('A fresh opening for the rematch.')
    await guest.locator('#sendDoctrine').click()
    await expect(guest.locator('#doctrineStatus2')).toContainText('doctrine saved')
    page.once('dialog', d => d.accept())
    await page.locator('#surrender').click()
    await expect(guest.locator('#again')).toBeVisible()
    let rematches = 0
    guest.on('request', r => { if (r.url().includes('/rooms/rematch')) rematches++ })
    await guest.locator('#again').click()
    await expect(guest.locator('#play')).toBeVisible()
    await expect(guest.locator('#rematchRoom')).toBeDisabled()
    expect(rematches).toBe(0)
    await guest.locator('#setup').evaluate(e => { e.open = true })
    const rematchPlan = await prepare(guest, request, baseURL, guestSession)
    expect(rematchPlan.id).not.toBe(plan.id)
    await expect(guest.locator('#rematchRoom')).toBeEnabled()
    await guest.locator('#rematchRoom').click()
    await expect(guest.locator('#roomReady')).toContainText('1/2 ready')
    await page.locator('#again').click()
    await expect(guest.locator('#hud')).toBeVisible()
    expect(rematches).toBe(1)
  } finally { await other.close() }
})
