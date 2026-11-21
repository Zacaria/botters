import { test, expect, enterAccount } from './fixtures.js'

test('opponent, length and map choices persist across reload', async ({ page }) => {
  test.skip(!!process.env.BOTTERS_SERVER, 'Requires isolated local account fixtures')
  await enterAccount(page, 'Picker player')
  await page.locator('#setup > summary').click()
  for (const [id, value] of [['vs', 'hard'], ['minutes', 5], ['planets', 17]]) {
    await page.locator(`#${id} button[data-v="${value}"]`).click()
    await expect(page.locator(`#${id} button.on`)).toHaveAttribute('data-v', String(value))
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem('botters.prefs'))[key], id)).toBe(value)
  }
  await page.reload()
  await page.locator('#setup > summary').click()
  for (const [id, value] of [['vs', 'hard'], ['minutes', 5], ['planets', 17]]) {
    await expect(page.locator(`#${id} button.on`)).toHaveAttribute('data-v', String(value))
  }
})
