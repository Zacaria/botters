import { chromium } from '/srv/hermes-ssd/workspaces/botters/swarm-release-verification-t_abfb2be1/node_modules/@playwright/test/index.mjs'
import { writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const browser=await chromium.launch({executablePath:'/usr/bin/brave-browser',args:['--no-sandbox','--disable-dev-shm-usage']})
const results=[]
try {
 for (const host of ['botters.havesomecode.io','botters.vercel.app']) {
  const context=await browser.newContext({viewport:{width:1440,height:1000}}), page=await context.newPage(), errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  const r=await page.goto('https://'+host,{waitUntil:'networkidle'}); assert.equal(r.status(),200)
  let signInVisible=false, canonicalLogin=null
  if(host==='botters.havesomecode.io'){
   await page.locator('#authEmail').waitFor({state:'visible'}); assert.ok(await page.locator('#authPassword').isVisible()); assert.ok(await page.locator('#googleLogin').isVisible()); signInVisible=true
  }else{
   await page.locator('#canonicalLink').waitFor({state:'visible'}); canonicalLogin=await page.locator('#canonicalLink').getAttribute('href'); assert.equal(canonicalLogin,'https://botters.havesomecode.io/'); assert.equal(await page.locator('#authEmail').isVisible(),false)
  }
  assert.equal(await page.locator('#play').isVisible(),false)
  const modeButtons=await page.locator('#mode button').evaluateAll(es=>es.map(e=>({mode:e.dataset.v,text:e.textContent.trim()})))
  // Mode buttons are created only after account/lobby initialization. Do not bypass that gate.
  assert.equal(modeButtons.length,0)
  const account=await page.evaluate(()=>fetch('/account').then(r=>r.json()))
  assert.deepEqual(account,{required:true,origin:'https://botters.havesomecode.io',user:null})
  const config=await page.evaluate(()=>fetch('/live-config.json').then(r=>r.json()))
  assert.deepEqual(config,{url:'https://play.botters.havesomecode.io',accountRequired:true})
  const pages=[]
  for(const path of ['/guide','/privacy','/terms']){
   const r=await page.goto('https://'+host+path,{waitUntil:'networkidle'}); assert.equal(r.status(),200); pages.push({path,title:await page.title(),status:r.status()})
  }
  assert.deepEqual(errors,[])
  results.push({host,homepage:200,signInVisible,canonicalLogin,accountRequired:true,playGated:true,modeButtons,config,account,pages,uncaughtErrors:errors,authenticatedMatch:'not run; no saved vault login'})
  await context.close()
 }
}finally{await browser.close(); await writeFile('/home/hermes/.hermes/kanban/boards/gimli/workspaces/t_abfb2be1/source/docs/releases/swarm-successor-t_abfb2be1/public-browser.json',JSON.stringify(results,null,2)+'\n')}
console.log(JSON.stringify(results,null,2))
