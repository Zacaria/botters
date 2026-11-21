import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { runtime, client, ORIGIN } from './helpers/cloudflare.js'
async function resources() {
  const rows=execFileSync('ps',['-eo','pid=,ppid=,comm='],{encoding:'utf8'}).trim().split('\n').map(l=>l.trim().split(/\s+/))
  const descendants=new Set([process.pid]);let changed=true
  while(changed){changed=false;for(const [pid,ppid] of rows)if(descendants.has(+ppid)&&!descendants.has(+pid)){descendants.add(+pid);changed=true}}
  let jiffies=0,rssKiB=0,workerdProcesses=0
  for(const [pid,,comm] of rows)if(descendants.has(+pid)&&comm==='workerd'){
    const stat=await readFile(`/proc/${pid}/stat`,'utf8'),fields=stat.slice(stat.lastIndexOf(')')+2).split(' '),status=await readFile(`/proc/${pid}/status`,'utf8')
    jiffies+=+fields[11]+ +fields[12];rssKiB+=+status.match(/VmRSS:\s+(\d+)/)[1];workerdProcesses++
  }
  return {jiffies,rssKiB,workerdProcesses}
}

test('workerd cadence: real 20 Hz match, two live readers, bounded local resource sample', {timeout:40000},async t=>{
  const {mf,db,mail}=await runtime();t.after(()=>mf.dispose())
  const c=client(mf);await c.signUp('Cadence')
  const verify=new URL(mail[0].text.match(/http:\/\/[^\s]+/)[0]);await c.call('GET',verify.pathname+verify.search)
  const s=(await c.call('POST','/session',{})).body;await c.call('POST','/exchange',{ticket:s.liveTicket})
  await c.call('POST',`/play?token=${s.humanToken}`,{withAgent:false,vs:'normal',minutes:3,planets:40,planning:10})
  const sockets=[]
  for(let i=0;i<2;i++){
    const r=await mf.dispatchFetch(ORIGIN+`/socket?token=${s.humanToken}`,{headers:{upgrade:'websocket',origin:ORIGIN,cookie:[...c.cookies].map(([k,v])=>`${k}=${v}`).join('; ')}})
    assert.equal(r.status,101);r.webSocket.accept();sockets.push(r.webSocket)
  }
  t.after(()=>sockets.forEach(s=>s.close()))
  await new Promise((resolve,reject)=>{
    sockets[0].addEventListener('message',function started(e){const f=JSON.parse(e.data);if(f.t==='step' && f.tick>0){sockets[0].removeEventListener('message',started);resolve()}})
    setTimeout(()=>reject(new Error('Match did not advance after planning')),14000).unref()
  })
  const frames=[],second=[]; let collecting=true
  sockets[0].addEventListener('message',e=>{const f=JSON.parse(e.data);if(collecting && f.t==='step') frames.push({at:performance.now(),bytes:Buffer.byteLength(e.data),tick:f.tick})})
  sockets[1].addEventListener('message',e=>{const f=JSON.parse(e.data);if(collecting && f.t==='step') second.push(f.tick)})
  const before=await resources(),start=performance.now()
  await new Promise(r=>setTimeout(r,5000))
  collecting=false
  const elapsed=performance.now()-start,after=await resources(),hz=frames.length/(elapsed/1000)
  const gaps=frames.slice(1).map((f,i)=>f.at-frames[i].at).sort((a,b)=>a-b)
  assert.ok(hz>=7&&hz<=12,`Observed ${hz} frames/s`)
  assert.ok(second.length>=30,'Both real socket readers receive frames')
  assert.ok(frames.at(-1).tick-frames[0].tick>=85,'Simulation remains 20 Hz, not frame-rate bound')
  assert.ok(after.workerdProcesses>0)
  const data=await db.prepare('SELECT count(*) AS records,sum(length(key)+length(value)) AS payloadBytes FROM game_records').first()
  const tickHz=+execFileSync('getconf',['CLK_TCK'],{encoding:'utf8'}).trim()
  const evidence={proof:'local-workerd-cadence',durationMs:elapsed,frames:frames.length,secondReaderFrames:second.length,framesPerSecond:hz,p95GapMs:gaps[Math.floor(gaps.length*.95)],simulationTicks:frames.at(-1).tick-frames[0].tick,bytesSentOneReader:frames.reduce((a,f)=>a+f.bytes,0),workerdCpuMs:(after.jiffies-before.jiffies)*1000/tickHz,workerdRssKiB:after.rssKiB,workerdProcesses:after.workerdProcesses,d1:data,scope:'one 17-planet match, two readers; local shared workerd process, not per-isolate or hosted billing proof'}
  console.log(JSON.stringify(evidence))
})
