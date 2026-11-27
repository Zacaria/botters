// Long polls wait outside any match object's command queue. Every iteration
// re-enters fresh primary authorization; no agent action inherits an old lease.
import { admission, gameHTTP, json } from './http.js'
import { clientAddress } from './authority.js'
const publicPaths=new Set(['/account','/session','/exchange','/rules','/leaderboard','/agent/pair','/agent/poll'])
async function once(env,request) {
  const path=new URL(request.url).pathname
  if(!publicPaths.has(path)) {
    const a=await admission(env,request)
    if(a.session.match) {
      // The room counts waiting requests per player; only this Worker can name the side.
      const headers=new Headers(request.headers); headers.set('x-botters-side',String(a.session.side??''))
      return env.MATCHES.getByName(a.session.match).fetch(new Request(request,{headers}))
    }
    if(path==='/socket')return json({error:'Join a match first.'},409)
  }
  return gameHTTP(env,request)
}
export async function gameTransport(env,request) {
  const url=new URL(request.url),path=url.pathname
  const timeout=request.method==='GET'&&['/next','/events','/agent/poll'].includes(path)?Math.max(0,Math.min(path==='/next'?45:20,Number(url.searchParams.get('timeout'))||0))*1000:0
  const deadline=performance.now()+timeout
  // Calls made for an agent session arrive without an address; that session already runs them one at a time.
  const sender=env.BURST&&request.headers.get('cf-connecting-ip')?clientAddress(request):null
  for(;;) {
    const response=await once(env,request)
    if(!timeout||response.status!==200||performance.now()>=deadline||request.signal.aborted)return response
    const result=await response.clone().json()
    const waiting=path==='/agent/poll'?!result.approved:path==='/next'?!result.match:result.state&&!result.state.ended&&!result.events.length
    if(!waiting)return response
    await new Promise(resolve=>setTimeout(resolve,Math.min(500,Math.max(0,deadline-performance.now()))))
    // Each further look costs database work, so it counts like a new request; over the allowance the wait ends early.
    if(sender&&!(await env.BURST.limit({key:sender})).success)return response
  }
}
