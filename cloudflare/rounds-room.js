import { DurableObject } from 'cloudflare:workers'
import { startRounds, advance, setBot, ready, publicMatch, nextWake } from '../rounds.js'
import { BREEDS } from '../sim.js'
import { json, body, failure } from './http.js'

export class RoundsRoom extends DurableObject {
  constructor(ctx, env) { super(ctx,env); this.tail=Promise.resolve() }
  queue(fn) { const work=this.tail.then(fn,fn); this.tail=work.catch(()=>{}); return work }
  fetch(request) { return this.queue(()=>this.handle(request)) }
  alarm() { return this.queue(async()=>{ const m=await this.ctx.storage.get('match'); if (!m) return; advance(m,Date.now(),Date.now); await this.save(m) }) }
  async save(m) {
    if (m) await this.ctx.storage.put('match',m); else await this.ctx.storage.delete('match')
    const wake=nextWake(m)
    if (wake !== null) await this.ctx.storage.setAlarm(wake); else await this.ctx.storage.deleteAlarm()
  }
  async handle(request) {
    try {
      const role=request.headers.get('x-rounds-role'), path=new URL(request.url).pathname, now=Date.now()
      if (!['human','agent'].includes(role)) return json({error:'Access denied.'},401)
      let m=await this.ctx.storage.get('match') || null
      advance(m,now,Date.now)
      const parsed=request.method==='POST' ? await body(request) : {}
      const data=parsed && typeof parsed==='object' && !Array.isArray(parsed) ? parsed : {}
      let result={ok:true}
      if (request.method==='GET' && path==='/rounds') { await this.save(m); return json({available:true,match:publicMatch(m,now)}) }
      if (request.method!=='POST') return json({error:'Method not allowed.'},405)
      if (role==='agent' && path!=='/rounds/bot') return json({error:'Human access required.'},401)
      if (path==='/rounds/start') {
        if (!BREEDS.includes(data.breed)) result={error:'Choose a valid breed.'}
        else m=startRounds({seed:crypto.getRandomValues(new Uint32Array(1))[0],breed:data.breed,now})
      } else if (path==='/rounds/bot') result=setBot(m,role==='human'?'you':'agent',data,now)
      else if (path==='/rounds/ready') result=ready(m,data.round,now,Date.now)
      else if (path==='/rounds/leave') m=null
      else return json({error:'Not found.'},404)
      await this.save(m)
      return result.error ? json(result, path==='/rounds/ready' ? 409 : 400) : json({ok:true,match:publicMatch(m,now)})
    } catch(e) { return failure(e) }
  }
}
