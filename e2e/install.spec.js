import { test, expect } from '@playwright/test'

test('guide leads with one copyable command and keeps client snippets in a collapsed fallback', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/guide')
  const command = page.locator('pre').first()
  await expect(command).toHaveText('npx -y github:Zacaria/botters installcopy')
  await command.getByRole('button', { name: 'copy', exact: true }).click()
  await expect(command.getByRole('button')).toHaveText('copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('npx -y github:Zacaria/botters install')
  await expect(page.locator('details')).not.toHaveAttribute('open')
  await expect(page.locator('details pre').first()).not.toBeVisible()
  await page.getByText('Manual setup fallback', { exact: true }).click()
  await expect(page.locator('details pre').first()).toBeVisible()
  await expect(page.locator('details')).toContainText('default_tools_approval_mode = "approve"')
  for (const text of ['backs up existing configuration', 'approves Botters tools automatically', 'Restart your agent', 'install --uninstall']) await expect(page.locator('main')).toContainText(text)
})

test('guide setup works without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL })
  try {
    const page = await context.newPage()
    await page.goto('/guide')
    await expect(page.locator('pre').first()).toHaveText('npx -y github:Zacaria/botters install')
    await page.getByText('Manual setup fallback', { exact: true }).click()
    await expect(page.locator('details pre').first()).toBeVisible()
  } finally { await context.close() }
})
