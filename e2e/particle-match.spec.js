import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`house particle match ${size.width}px`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: size })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('dialog', dialog => dialog.accept())
    await page.goto(process.env.BOTTERS_SERVER || 'http://localhost:18787')
    await page.locator('#startSolo').click()
    await page.locator('#lobby details').first().locator('summary').click()
    await page.locator('#minutes button').filter({ hasText: '3 min' }).click()
    await page.locator('#planets button').filter({ hasText: 'small' }).click()
    await page.locator('#play').click()
    await expect(page.locator('#battalions [data-bat]').first()).toBeVisible()
    await page.locator('#battalions [data-bat]').first().click()
    const canvas = page.locator('#c')
    await canvas.click({ position: { x: 200, y: 100 } })
    await expect(page.locator('#battalions [data-bat]').first()).toContainText('manual')
    await page.locator('#flank').click()
    await page.locator('#detach').click()
    await expect(page.locator('#battalions [data-bat]')).toHaveCount(4)
    await page.locator('#release').click()
    await expect(page.locator('#battalions [data-bat]').first()).not.toContainText('manual')
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
