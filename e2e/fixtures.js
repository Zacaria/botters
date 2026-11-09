import { test as base, expect } from '@playwright/test'
import net from 'node:net'
import { runtime } from '../test/helpers/cloudflare.js'
export { expect }
const runners = new Map()
let accountNumber=0
export const test=base.extend({
  baseURL:async({},use)=>{
    if(process.env.BOTTERS_SERVER) return use(process.env.BOTTERS_SERVER)
    const reservation=net.createServer()
    await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve)})
    const port=reservation.address().port
    await new Promise(resolve=>reservation.close(resolve))
    const origin=`http://127.0.0.1:${port}`
    const runner=await runtime({port,host:'127.0.0.1',assets:{directory:'public',binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:true}},bindings:{SITE_URL:origin,AUTH_EMAIL_ALLOWED_RECIPIENTS:Array.from({length:1000},(_,i)=>`player${i}@example.invalid`).join(',')}})
    runners.set(origin,runner)
    // Local browser-suite clock fixture only. No production speed flag or fake API replies.
    let clockWork=Promise.resolve(),clockError
    const clock=setInterval(()=>{clockWork=clockWork.then(()=>runner.db.prepare("UPDATE game_records SET value=json_set(value,'$.startsAt',json_extract(value,'$.startsAt')-9000) WHERE key LIKE 'match:%' AND json_extract(value,'$.report') IS NULL AND json_extract(value,'$.waitingForAgent')=0").run()).catch(e=>{clockError=e})},1000)
    try { await use(origin) }
    finally {clearInterval(clock);await clockWork;runners.delete(origin);await runner.mf.dispose();if(clockError)throw clockError}
  },
})
export async function enterAccount(page,name,url='/') {
  if(process.env.BOTTERS_SERVER)throw new Error('Local account helper cannot create hosted accounts.')
  await page.goto(url)
  await page.evaluate(() => { if (!localStorage.getItem('botters.prefs')) localStorage.setItem('botters.prefs', JSON.stringify({withAgent:false,minutes:3,planets:16,planning:10})) })
  const origin=new URL(page.url()).origin,runner=runners.get(origin)
  if(!runner)throw new Error('No local Cloudflare runtime for this page')
  const email=`player${accountNumber++}@example.invalid`,password='Browser-local-proof-password-1234'
  const response=await page.context().request.post(origin+'/api/auth/sign-up/email',{headers:{origin},data:{email,password,name,callbackURL:origin+url}})
  expect(response.status()).toBe(200)
  await verifyEmail(page,email)
  await expect(page.locator('#accountName')).toHaveText(name)
  if (!url.startsWith('/r/')) await expect(page.locator('#play')).toBeVisible()
  return {email,password}
}
export async function ageAgentPresence(page) {
  const runner=runners.get(new URL(page.url()).origin)
  if(!runner)throw new Error('Local presence fixture only')
  await runner.db.prepare("UPDATE game_records SET value=json_set(value,'$.agentSeen',?) WHERE key LIKE 'session:%' AND json_extract(value,'$.agentGranted')=1").bind(Date.now()-91000).run()
}
export async function verifyEmail(page,email) {
  const runner=runners.get(new URL(page.url()).origin)
  if(!runner)throw new Error('No local Cloudflare runtime for this page')
  await runner.mf.captureMail()
  const message=runner.mail.find(m=>m.text.includes('Verify your email')&&(m.to===email||m.to?.[0]===email||m.to?.[0]?.email===email))
  if(!message)throw new Error('Native local email capture missing')
  await page.goto(message.text.match(/http:\/\/[^\s]+/)[0])
}
