import { test, expect, enterAccount } from './fixtures.js'
import { mkdir } from 'node:fs/promises'

for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`house particle match ${size.width}px`, async ({ page, baseURL }) => {
    await page.setViewportSize(size)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('dialog', dialog => dialog.accept())
    if (process.env.BOTTERS_SERVER) { await page.goto(baseURL); await page.locator('#startSolo').click() }
    else await enterAccount(page, `Particle ${size.width}`)
    await page.locator('#lobby details').first().locator('summary').click()
    await page.locator('#minutes button').filter({ hasText: '3 min' }).click()
    await page.locator('#planets button').filter({ hasText: 'small' }).click()
    await page.locator('#play').click()
    await expect(page.locator('#battalions [data-bat]').first()).toBeVisible({ timeout: 30000 })
    await expect(page.locator('#big')).not.toContainText('Starts in', { timeout: 20000 })
    const selected = await page.locator('#battalions [data-bat]').first().getAttribute('data-bat')
    await page.locator(`#battalions [data-bat="${selected}"]`).click()
    const canvas = page.locator('#c'), box = await canvas.boundingBox()
    await canvas.click({ position: { x: box.width - 3, y: box.height - 3 } })
    await expect(page.locator(`#battalions [data-bat="${selected}"]`)).toContainText('hand order')
    await page.locator('#flank').click()
    const before = await page.locator('#battalions [data-bat]').evaluateAll(els => els.map(el => el.dataset.bat))
    await page.locator('#detach').click()
    await expect.poll(async () => (await page.locator('#battalions [data-bat]').evaluateAll(els => els.map(el => el.dataset.bat))).some(id => !before.includes(id))).toBe(true)
    await page.locator('#release').click()
    await expect(page.locator(`#battalions [data-bat="${selected}"]`)).not.toContainText('hand order')
    const rule = page.locator('#gambits [data-g]').first()
    await rule.click(); await expect(rule).toHaveClass(/off/)
    const shots = `${process.env.TMPDIR}/pw-shots`
    await mkdir(shots, { recursive: true })
    await page.screenshot({ path: `${shots}/match-${size.width}.png` })
    await page.locator('#surrender').click()
    await expect(page.locator('#big')).toContainText('lose', { timeout: 10000 })
    expect(errors).toEqual([])
    await page.close()
  })
}
