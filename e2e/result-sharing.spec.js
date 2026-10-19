import { test, expect } from '@playwright/test'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { state } from './preview.js'

// These tests must never drive a hosted backend or a real account.
if (process.env.BOTTERS_SERVER || process.env.BOTTERS_LIVE_SERVER || process.env.BOTTERS_DEV_CONVEX) throw new Error('Result sharing tests require local ephemeral fixtures.')
const hold = [{ if: 'always', then: 'hold' }]

async function enter(page, name, url = '/') {
  await page.goto(url)
  await page.evaluate(opening => localStorage.setItem('botters.prefs', JSON.stringify({ vs: 'hard', minutes: 3, planets: 16, planning: 10, withAgent: false, openingMine: true, opening })), hold)
  await page.reload()
  await page.locator('#startName').fill(name)
  await page.locator('#startSolo').click()
  await expect(page.locator('#play')).toBeVisible()
}

async function finished(page, timeout = 40000) {
  await expect(page.locator('#again')).toBeVisible({ timeout })
  const frame = await state(page), actual = frame.report.actual
  const row = page.locator('#big tr').first()
  await expect(row.locator('td').nth(1)).toHaveText(actual.result.toUpperCase())
  const scores = `${Math.round(actual.you).toLocaleString('en')} vs ${Math.round(actual.enemy).toLocaleString('en')}`
  await expect(row.locator('td').nth(2)).toHaveText(scores)
  return { frame, summary: `Botters: ${actual.result}\n${scores}\nhttps://botters.havesomecode.io/` }
}

async function secretsInURL(page) {
  // Added after entry: auth bootstrap must not consume these synthetic sentinels.
  await page.evaluate(() => history.replaceState(null, '', location.pathname + '?token=QUERY_SECRET_SENTINEL&s=SESSION_SECRET_SENTINEL#HASH_SECRET_SENTINEL'))
}

async function copied(page, summary, key = 'Enter') {
  const copy = page.getByRole('button', { name: 'Copy result', exact: true })
  // Traverse like a keyboard-only player; programmatic focus hid a Tab trap.
  for (let i = 0; i < 40 && !await copy.evaluate(el => el === document.activeElement); i++) await page.keyboard.press('Tab')
  await expect(copy).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.locator('#again')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(copy).toBeFocused()
  await page.keyboard.press(key)
  await expect(page.getByRole('status').filter({ hasText: 'Result copied.' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(summary)
}

test('house finish copies only the actual displayed result through the real clipboard', async ({ page, context }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await enter(page, 'PRIVATE_PLAYER_SENTINEL')
  await page.locator('#doctrine').fill('PRIVATE_DOCTRINE_SENTINEL')
  await page.locator('#play').click()
  await expect(page.locator('#hud')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy result', exact: true })).toHaveCount(0)
  await secretsInURL(page)
  const { frame, summary } = await finished(page)
  await copied(page, summary)
  expect(summary).not.toMatch(/PRIVATE_|SECRET_SENTINEL|token=|\?|#|\/r\//)
  expect(summary).not.toContain(frame.matchId)
  await expect(page.getByLabel('Result summary')).toBeHidden()
  await test.info().attach('house-result.json', { body: JSON.stringify({ actual: frame.report.actual, summary }), contentType: 'application/json' })
  await page.locator('#menu').click()
  await expect(page.locator('#play')).toBeVisible()
  expect(errors).toEqual([])
})

for (const failure of ['unavailable', 'rejected']) {
  test(`clipboard ${failure} leaves the same selected summary for manual copy`, async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await enter(page, 'Manual copy player')
    await page.locator('#play').click()
    const { summary } = await finished(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await secretsInURL(page)
    // Fault only the OS clipboard boundary; server, match, report and UI stay real.
    await page.evaluate(failure => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: failure === 'unavailable' ? undefined : { writeText: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) } }), failure)
    await page.getByRole('button', { name: 'Copy result', exact: true }).click()
    const text = page.getByLabel('Result summary')
    await expect(page.locator('#copyResultStatus')).toContainText('Copy manually')
    await expect(page.locator('#copyResultStatus')).not.toContainText('Result copied.')
    await expect(text).toBeVisible()
    await expect(text).toHaveValue(summary)
    await expect(text).toHaveAttribute('readonly', '')
    await expect(text).toBeFocused()
    expect(await text.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd))).toBe(summary)
    const box = await text.boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    expect(errors).toEqual([])
  })
}

test('real room draw and changed rematch never copy the previous report or private room URL', async ({ page, browser, context }) => {
  const other = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] }), guest = await other.newPage()
  const errors = []
  for (const p of [page, guest]) p.on('pageerror', error => errors.push(error.message))
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  try {
    await enter(page, 'PRIVATE_HOST_SENTINEL')
    await page.locator('#createRoom').click()
    await expect(page.locator('#roomPanel')).toBeVisible()
    const code = await page.locator('#roomCode').textContent()
    await enter(guest, 'PRIVATE_GUEST_SENTINEL', `/r/${code}`)
    await expect(guest.locator('#roomCode')).toHaveText(code)
    await expect(page.locator('#roomPlayers')).toContainText('PRIVATE_GUEST_SENTINEL')
    await page.locator('#startRoom').click()
    await expect(page.locator('#hud')).toBeVisible()
    await secretsInURL(guest)
    const first = await finished(page), guestFirst = await finished(guest)
    expect(first.frame.report.actual.result).toBe('draw')
    expect(first.frame.report.actual.you).toBe(first.frame.report.actual.enemy)
    await copied(guest, guestFirst.summary, 'Space')
    expect(guestFirst.summary).not.toContain(code)
    await test.info().attach('draw-result.json', { body: JSON.stringify({ actual: first.frame.report.actual, summary: first.summary }), contentType: 'application/json' })

    // Keep a failed copy pending across a real new match, to catch stale async UI writes.
    await page.evaluate(() => { navigator.clipboard.writeText = () => new Promise((resolve, reject) => { window.rejectOldCopy = reject }) })
    await page.getByRole('button', { name: 'Copy result', exact: true }).click()
    await page.locator('#menu').click()
    await page.locator('#openEditor select[data-k="if"]').first().selectOption('free_planet')
    await page.locator('#openEditor select[data-k="then"]').first().selectOption('go')
    await page.locator('#rematchRoom').click()
    await expect(page.locator('#roomReady')).toContainText('1/2 ready')
    await guest.locator('#again').click()
    await expect(page.locator('#hud')).toBeVisible()
    await expect(guest.locator('#hud')).toBeVisible()
    await expect(guest.getByRole('button', { name: 'Copy result', exact: true })).toHaveCount(0)
    await page.evaluate(() => { window.rejectOldCopy(new DOMException('Late denial', 'NotAllowedError')); delete navigator.clipboard.writeText })
    await expect(page.locator('#resultSummary')).toHaveCount(0)
    const next = await finished(guest), hostNext = await finished(page)
    expect(next.frame.matchId).not.toBe(first.frame.matchId)
    expect(next.frame.report.actual.result).toBe('lost')
    expect(hostNext.frame.report.actual.result).toBe('won')
    expect(next.summary).not.toBe(guestFirst.summary)
    await copied(guest, next.summary)
    await copied(page, hostNext.summary)
    await test.info().attach('rematch-result.json', { body: JSON.stringify({ guest: next.frame.report.actual, host: hostNext.frame.report.actual, summary: next.summary }), contentType: 'application/json' })
    await guest.locator('#menu').click()
    await expect(guest.locator('#roomCode')).toHaveText(code)
    await expect(guest.locator('#history tr')).toHaveCount(2)
    expect(errors).toEqual([])
  } finally { await other.close() }
})

test('offline native SSE house result is copyable and PLAY AGAIN clears it', async ({ page, context }) => {
  test.setTimeout(240000)
  const reservation = net.createServer()
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const origin = `http://127.0.0.1:${port}`
  const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), BOTTERS_ORIGIN: origin, BOTTERS_START_DELAY: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await Promise.race([once(server.stderr, 'data'), once(server, 'exit').then(() => { throw new Error('Offline fixture exited before startup') })])
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
    await enter(page, 'Offline private player', origin)
    await page.locator('#play').click()
    await expect(page.locator('#hud')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copy result', exact: true })).toHaveCount(0)
    await secretsInURL(page)
    const { summary, frame } = await finished(page, 210000)
    await copied(page, summary)
    await test.info().attach('offline-result.json', { body: JSON.stringify({ actual: frame.report.actual, summary }), contentType: 'application/json' })
    await expect(page.locator('#again')).toHaveText('PLAY AGAIN')
    await page.locator('#again').click()
    await expect(page.locator('#hud')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copy result', exact: true })).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    server.kill()
    if (server.exitCode === null) await once(server, 'exit')
  }
})
