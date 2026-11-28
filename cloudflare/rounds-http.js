import { admission, body, json } from './http.js'
import { createAuth, identity } from './auth.js'
import { denied } from './authority.js'

export async function roundsHTTP(env, request) {
  if (env.ROUNDS_ENABLED !== '1') return json({error:'Not found.'},404)
  const path=new URL(request.url).pathname
  if (!(request.method==='GET' && path==='/rounds') && !(request.method==='POST' && ['/rounds/start','/rounds/bot','/rounds/ready','/rounds/leave'].includes(path))) return json({error:'Not found.'},404)
  const admitted=await admission(env,request), role=admitted.token.role
  if (role==='human') {
    const user=await identity(createAuth(env),request)
    if (user?.id!==admitted.session.accountId || user?.authSessionId!==admitted.token.authSessionId) throw denied()
  } else if (role!=='agent' || request.method==='POST' && path!=='/rounds/bot') throw denied()
  const data=request.method==='POST' ? await body(request) : undefined
  const headers=new Headers({'x-rounds-role':role,'content-type':'application/json'})
  return env.ROUNDS.getByName(admitted.session.accountId).fetch(new Request(`https://rounds.internal${path}`,{method:request.method,headers,...(data !== undefined && {body:JSON.stringify(data)})}))
}
