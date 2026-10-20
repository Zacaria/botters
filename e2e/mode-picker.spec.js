import { test, expect } from '@playwright/test'
import { authorizePreview, state } from './preview.js'

const modes = ['1v1', '2v2', 'ffa4', 'ffa6']
test.beforeEach(async ({ context }) => authorizePreview(context))

async function enter(page, name) {
  await page.goto('/')
  await page.locator('#startName').fill(name)
  await page.locator('#startSolo').click()
  await expect(page.locator('#play')).toBeVisible()
  await page.locator('#setup').evaluate(e => { e.open = true })
}

for (const mode of modes) {
  test(`mode buttons select, persist, reload and start ${mode}`, async ({ page }) => {
    test.skip(!!process.env.BOTTERS_SERVER, 'Isolated local mode fixtures only')
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await enter(page, `Mode ${mode}`)
    // Start with another real click, so even the default button must update preferences.
    await page.locator(`#mode button[data-v="${mode === '1v1' ? 'ffa6' : '1v1'}"]`).click()
    await page.locator(`#mode button[data-v="${mode}"]`).click()
    await expect(page.locator('#mode button.on')).toHaveAttribute('data-v', mode)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('botters.prefs')).mode)).toBe(mode)
    await page.reload()
    await expect(page.locator('#mode button.on')).toHaveAttribute('data-v', mode)
    // Numeric controls remain numbers after using the same picker.
    for (const [id, value] of [['minutes', 3], ['planets', 16], ['planning', 10]]) {
      await page.locator(`#${id} button[data-v="${value}"]`).click()
      expect(await page.evaluate(id => JSON.parse(localStorage.getItem('botters.prefs'))[id], id)).toBe(value)
    }
    await page.locator('#play').click()
    await expect(page.locator('#hud')).toBeVisible()
    const frame = await state(page)
    expect(frame.options.mode).toBe(mode)
    expect(frame.view.mode).toBe(mode)
    expect(frame.view.planets).toHaveLength(16)
    expect(frame.view.totals.foes).toHaveLength(mode === 'ffa6' ? 5 : mode === 'ffa4' ? 3 : 1)
    expect(errors).toEqual([])
  })
}

test('queue and rooms stay duels after selecting ffa6 with real buttons', async ({ page, browser }) => {
  test.skip(!!process.env.BOTTERS_SERVER, 'Isolated local duel fixtures only')
  const other = await browser.newContext(), b = await other.newPage()
  try {
    await enter(page, 'Mode duel A'); await enter(b, 'Mode duel B')
    for (const p of [page, b]) {
      await p.locator('#mode button[data-v="ffa6"]').click()
      for (const [id, value] of [['minutes', 3], ['planets', 16], ['planning', 10]]) await p.locator(`#${id} button[data-v="${value}"]`).click()
    }
    await page.locator('#quick').click(); await b.locator('#quick').click()
    await expect(page.locator('#hud')).toBeVisible(); await expect(b.locator('#hud')).toBeVisible()
    for (const p of [page, b]) expect((await state(p)).options.mode).toBe('1v1')
    page.once('dialog', d => d.accept()); await page.locator('#surrender').click()
    await expect(page.locator('#again')).toBeVisible(); await expect(b.locator('#again')).toBeVisible()
    await page.locator('#menu').click(); await b.locator('#menu').click()
    await page.locator('#createRoom').click()
    await expect(page.locator('#roomPanel')).toBeVisible()
    const code = await page.locator('#roomCode').textContent()
    await b.locator('#joinCode').fill(code); await b.locator('#joinRoom').click()
    await expect(b.locator('#roomCode')).toHaveText(code)
    await expect(page.locator('#roomPlayers')).toContainText('Mode duel B')
    await page.locator('#startRoom').click()
    await expect(page.locator('#hud')).toBeVisible(); await expect(b.locator('#hud')).toBeVisible()
    for (const p of [page, b]) expect((await state(p)).options.mode).toBe('1v1')
  } finally { await other.close() }
})
