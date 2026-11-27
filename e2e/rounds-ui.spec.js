import { test, expect, enterAccount } from './fixtures.js'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`rounds journey ${viewport.width}px`, async ({ page }) => {
    test.skip(!!process.env.BOTTERS_SERVER, 'Local mock only')
    await page.setViewportSize(viewport)
    let match = null
    const bot = { breed: 'runner', gambits: [{ if: 'always', then: 'hold', on: true }] }
    const debrief = { round: 1, result: 'You win', reason: 'More units', planets: { you: 3, house: 2 }, units: { you: 1200, house: 1100 }, timeline: [{ t: 3, planets: [3, 2], units: [1200, 1100] }], yourArmy: { breed: 'tank', atStart: { tank: 1200 }, atEnd: { tank: 1200 } }, houseArmy: { breed: 'grunt', atStart: { grunt: 1200 }, atEnd: { grunt: 1100 } }, yourRules: [{ rule: { if: 'always', then: 'hold' }, share: 1 }] }
    await page.route('**/live-config.json', async route => route.fulfill({ json: { ...(await (await route.fetch()).json()), rounds: true } }))
    await page.route('**/rounds**', async route => {
      const req = route.request(), url = new URL(req.url()), body = req.postDataJSON()
      if (url.pathname === '/rounds/start') match = { id: 'one', seed: 12345, planets: 17, phase: 'pause', round: 1, of: 5, score: { you: 0, house: 0 }, slots: { you: 3, house: 3 }, secondsLeft: 60, bot: { ...bot, breed: body.breed }, versions: [], refused: [], fight: null, rounds: [], result: null }
      if (url.pathname === '/rounds/bot') { match.bot = { breed: body.breed, gambits: body.gambits }; match.versions.push({ at: 3, who: 'human', breed: body.breed, rules: body.gambits.length, why: body.why }) }
      if (url.pathname === '/rounds/ready') { match.phase = 'fight'; match.secondsLeft = 3; match.fight = { round: 1, bots: [match.bot, { ...bot, breed: 'grunt' }], seconds: 3, counter: 2, planets: 17, msLeft: 60000 }; match.rounds = [debrief] }
      await route.fulfill({ json: url.pathname === '/rounds' ? { available: true, match } : { ok: true, match } })
    })
    await enterAccount(page, 'Rounds player')
    await expect(page.locator('#roundsCard')).toBeVisible()
    await page.locator('#roundStartBreeds [data-breed="tank"]').click()
    await page.locator('#roundStart').click()
    await expect(page.locator('#roundPause')).toBeVisible()
    await page.locator('#roundAdd').click()
    await page.locator('#roundWhy').fill('Protect the planets')
    await page.locator('#roundSave').click()
    await expect(page.locator('#roundVersions')).toContainText('Protect the planets')
    const shots = path.join(process.env.TMPDIR, 'rounds-ui-shots'); await mkdir(shots, { recursive: true })
    await page.screenshot({ path: path.join(shots, `pause-${viewport.width}.png`), fullPage: true })
    expect(await page.evaluate(() => document.querySelector('#rounds').scrollWidth <= document.querySelector('#rounds').clientWidth)).toBeTruthy()
    await page.locator('#roundFight').click()
    await expect(page.locator('#roundFightView')).toBeVisible()
    await page.screenshot({ path: path.join(shots, `fight-${viewport.width}.png`), fullPage: true })
    await page.locator('#roundSkip').click()
    await expect(page.locator('#roundDebrief')).toContainText('More units')
    await page.screenshot({ path: path.join(shots, `debrief-${viewport.width}.png`), fullPage: true })
    match.phase = 'over'; match.score.you = 3; match.result = 'You win'; match.fight = null
    await page.locator('#roundContinue').click()
    await expect(page.locator('#roundOver')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('#roundFinal')).toContainText('You win')
    await page.screenshot({ path: path.join(shots, `over-${viewport.width}.png`), fullPage: true })
  })
}
