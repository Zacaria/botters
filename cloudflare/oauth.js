import { createHash } from 'node:crypto'
import { transaction } from '../online/store.js'
import { D1Store } from './d1-store.js'
import { hash, nonce, authorize, denied, clientAddress } from './authority.js'
import { json, body, runGame } from './http.js'
const scope = 'botters:play', DAY = 86400
const error = (message = 'Invalid authorization request.', status = 400) => Object.assign(new Error(message), { status })
const escape = v => String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c])
const resource = env => `${env.SITE_URL}/mcp`
const validRedirect = v => { try { const u = new URL(v); return v.length <= 400 && !u.username && !u.password && !u.hash && (u.protocol === 'https:' || u.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname)) } catch { return false } }
export const oauthRoute = path => ['/register','/authorize','/token','/revoke','/consent','/consent/complete','/consent/cancel','/.well-known/oauth-authorization-server','/.well-known/oauth-protected-resource/mcp'].includes(path)
const bearerToken = req => /^Bearer ([A-Za-z0-9_-]{32})$/.exec(req.headers.get('authorization') || '')?.[1]
export async function authenticate(env, request) {
  const bearer = bearerToken(request)
  if (!bearer) throw denied()
  const store = new D1Store(env.DB), raw = await store.get(`oauth:token:${hash(bearer)}`), token = raw && JSON.parse(raw)
  if (token?.kind !== 'access' || token.expires <= Date.now()) throw denied()
  const g = await store.get(`oauth:grant:${token.grantId}`), grant = g && JSON.parse(g)
  if (!grant || grant.revoked || grant.expires <= Date.now()) throw denied()
  await authorize(env, `token:${hash(grant.agentToken)}`)
  return { ...grant, grantId: token.grantId }
}
async function parameters(request) {
  if (request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
    // Use the same streaming byte bound as JSON, including chunked requests.
    const clone = new Request(request, { headers: { 'content-type':'application/json' }, body: request.body, duplex: 'half' })
    const reader = clone.body.getReader(); let text = '', n = 0
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; n += value.byteLength; if (n > 16384) throw error('Request is too large.', 413); text += new TextDecoder().decode(value, { stream: true }) } }
    finally { await reader.cancel() }
    return Object.fromEntries(new URLSearchParams(text))
  }
  return body(request)
}
export async function oauthHTTP(env, request) {
  const u = new URL(request.url), p = u.pathname, store = new D1Store(env.DB)
  if (request.method === 'GET' && p === '/.well-known/oauth-protected-resource/mcp') return json({ resource: resource(env), authorization_servers: [env.SITE_URL], scopes_supported: [scope], bearer_methods_supported: ['header'] })
  if (request.method === 'GET' && p === '/.well-known/oauth-authorization-server') return json({ issuer: env.SITE_URL, authorization_endpoint: env.SITE_URL+'/authorize', token_endpoint: env.SITE_URL+'/token', registration_endpoint: env.SITE_URL+'/register', revocation_endpoint: env.SITE_URL+'/revoke', response_types_supported:['code'], grant_types_supported:['authorization_code','refresh_token'], token_endpoint_auth_methods_supported:['none'], revocation_endpoint_auth_methods_supported:['none'], code_challenge_methods_supported:['S256'], scopes_supported:[scope] })
  if (!['GET','POST'].includes(request.method)) return json({error:'Method not allowed.'},405)
  const data = request.method === 'POST' ? await parameters(request) : Object.fromEntries(u.searchParams)
  if (request.method === 'POST' && ['/register','/token','/revoke'].includes(p) || p === '/authorize') {
    // Registration writes a record for anyone who asks, so it has its own smaller allowance.
    const registering = p === '/register'
    await transaction(store, async tx => {
      const counter = await tx.get(`oauth:limit:${registering ? 'register:' : ''}${hash(clientAddress(request))}:${Math.floor(Date.now()/600000)}`, { n:0 },600)
      if (counter.n++ >= (registering ? 30 : 200)) throw error('Too many authorization requests.',429)
    })
  }
  if (p === '/register' && request.method === 'POST') {
    if (!Array.isArray(data.redirect_uris) || !data.redirect_uris.length || data.redirect_uris.length > 4 || data.redirect_uris.some(v => typeof v !== 'string' || !validRedirect(v)) || data.token_endpoint_auth_method !== 'none' || data.scope !== undefined && data.scope !== scope || data.grant_types !== undefined && (!Array.isArray(data.grant_types) || data.grant_types.length > 2 || data.grant_types.some(v => !['authorization_code','refresh_token'].includes(v))) || data.response_types !== undefined && (!Array.isArray(data.response_types) || data.response_types.length !== 1 || data.response_types[0] !== 'code') || data.client_name !== undefined && (typeof data.client_name !== 'string' || data.client_name.length > 80)) throw error('Only public PKCE clients with HTTPS or loopback callbacks are supported.')
    const c = { client_id: nonce(), client_name: data.client_name || 'Unnamed application', redirect_uris:data.redirect_uris, token_endpoint_auth_method:'none', grant_types:['authorization_code','refresh_token'], response_types:['code'], scope, client_id_issued_at:Math.floor(Date.now()/1000) }
    // Kept one day until a person approves it, then for thirty days after each use.
    await transaction(store, tx => tx.set(`oauth:client:${c.client_id}`, c, DAY))
    return json(c,201)
  }
  if (p === '/authorize' && request.method === 'GET') {
    const c = JSON.parse(await store.get(`oauth:client:${data.client_id}`) || 'null')
    if (!c || !c.redirect_uris.includes(data.redirect_uri) || data.resource !== resource(env) || data.scope !== scope || data.response_type !== 'code' || data.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(data.code_challenge || '') || (data.state?.length || 0) > 2048) throw error()
    const id = nonce(), browser = nonce(), pair = await runGame(env,'POST','/agent/pair',new URLSearchParams(),{setup:'MCP OAuth'})
    await transaction(store, tx => tx.set(`oauth:pending:${id}`, { ...data, browserHash:hash(browser), agentToken:pair.agentToken, approvalUrl:pair.approvalUrl, name:c.client_name, expires:Date.now()+600000 },600))
    return new Response(null,{status:302,headers:{location:`/consent?transaction=${id}`,'cache-control':'no-store','referrer-policy':'no-referrer','set-cookie':`botters_oauth_${id}=${browser}; Path=/consent; HttpOnly; SameSite=Lax; Max-Age=600${env.SITE_URL.startsWith('https:')?'; Secure':''}`}})
  }
  if (p.startsWith('/consent')) {
    if (request.method === 'POST' && request.headers.get('origin') !== env.SITE_URL) throw error('Use the consent page.',403)
    const id = data.transaction, key = `oauth:pending:${id}`
    const pending = JSON.parse(await store.get(key) || 'null')
    const cookie = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`botters_oauth_${id}=`))?.slice(`botters_oauth_${id}=`.length)
    if (!pending || !cookie || hash(cookie) !== pending.browserHash || pending.expires <= Date.now()) throw error('Invalid or expired browser transaction.',403)
    if (request.method === 'GET' && p === '/consent') {
      const scriptNonce = nonce()
      return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect to Botters</title><style nonce="${scriptNonce}">html{min-height:100%;background:#050507 radial-gradient(ellipse at 50% 25%,#1a0a14 0,#050507 65%) fixed;color:#b8b8c4;font:14px/1.6 ui-monospace,monospace}body{margin:0}main{box-sizing:border-box;width:min(520px,calc(100% - 24px));margin:8vh auto 24px;padding:28px 28px 22px;background:#08080bb0;border:1px solid #24242e;border-radius:16px}.logo{margin:0;text-align:center;color:#fff;font-size:34px;font-weight:bold;letter-spacing:7px}.logo b{color:#ff2e88}.logo i{color:#5b8cff;font-style:normal}h1{margin:6px 0 22px;text-align:center;color:#e4e4ec;font:600 19px/1.4 system-ui,sans-serif}strong{color:#fff;overflow-wrap:anywhere}.approve{display:block;margin:24px 0 12px;padding:16px;border-radius:10px;background:#ff2e88;color:#000;font-weight:bold;font-size:17px;letter-spacing:1px;text-align:center;text-decoration:none;box-shadow:0 0 32px #ff2e8866}.approve:hover{box-shadow:0 0 44px #ff2e88aa}:focus-visible{outline:2px solid #ff2e88;outline-offset:3px}#status{margin:0;text-align:center;color:#9fe8c0}button{display:block;margin:12px auto 0;padding:6px 16px;font:inherit;background:#1a1a22;color:#ddd;border:1px solid #444;border-radius:8px;cursor:pointer}button:hover{border-color:#888}</style><main><p class="logo" aria-hidden="true"><b>BOT</b><i>TERS</i></p><h1>Connect an AI agent to Botters</h1><p>Application name (supplied by the application, not verified): <strong>${escape(pending.name)}</strong></p><p>Registered callback origin: <strong>${escape(new URL(pending.redirect_uri).origin)}</strong></p><p>This agent can read your match and doctrine, submit gambits and use agent controls. It can start a house match for you and play it; it cannot manage your account, give hand orders or play against other people. Other connected agents stay connected.</p><p>Access lasts up to seven days, including while signed out. Use Disconnect agent in the Botters lobby to revoke every agent.</p><a class="approve" href="${escape(pending.approvalUrl)}" target="_blank" rel="noopener noreferrer">Sign in to Botters and approve</a><p id="status" role="status">Waiting for approval in Botters.</p><button id="cancel">Cancel</button><script nonce="${scriptNonce}">const transaction=${JSON.stringify(id)};let stopped=false;async function poll(){if(stopped)return;try{const r=await fetch('/consent/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({transaction})}),d=await r.json();if(d.approved&&d.url){location.assign(d.url);return}if(!r.ok){document.querySelector('#status').textContent='Approval ended. Start again in your assistant.';return}}catch{}setTimeout(poll,1000)}document.querySelector('#cancel').onclick=async()=>{stopped=true;await fetch('/consent/cancel',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({transaction})});document.querySelector('#status').textContent='Connection cancelled.'};poll()</script></main></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':`default-src 'none'; script-src 'nonce-${scriptNonce}'; connect-src 'self'; style-src 'nonce-${scriptNonce}'; base-uri 'none'; frame-ancestors 'none'`}})
    }
    if (p === '/consent/cancel' && request.method === 'POST') { await transaction(store,tx=>tx.set(key,null,1)); return json({cancelled:true}) }
    if (p === '/consent/complete' && request.method === 'POST') {
      const poll = await runGame(env,'GET','/agent/poll',new URLSearchParams({token:pending.agentToken}))
      if (!poll.approved) return json({approved:false})
      const admitted = await authorize(env,`token:${hash(pending.agentToken)}`)
      const code = nonce(), grantId = nonce(), grant = {accountId:admitted.session.accountId,clientId:pending.client_id,agentToken:pending.agentToken,expires:Math.min(admitted.expires,Date.now()+7*DAY*1000),revoked:false}
      await transaction(store, async tx => {
        const current = await tx.get(key)
        if (!current || current.browserHash !== pending.browserHash) throw error('Consent already completed.')
        await tx.set(key,null,1)
        const client = await tx.get(`oauth:client:${pending.client_id}`,null,30*DAY)
        if (client) client.used = Date.now()
        await tx.set(`oauth:grant:${grantId}`,grant,7*DAY)
        await tx.set(`oauth:code:${hash(code)}`,{grantId,clientId:pending.client_id,redirect:pending.redirect_uri,challenge:pending.code_challenge,expires:Date.now()+60000},60)
      })
      const callback = new URL(pending.redirect_uri); callback.searchParams.set('code',code); if (pending.state !== undefined) callback.searchParams.set('state',pending.state)
      return json({approved:true,url:callback.href})
    }
    throw error('Unknown consent action.',404)
  }
  if (p === '/token' && request.method === 'POST') {
    if (data.resource !== resource(env) || data.scope !== undefined && data.scope !== scope) throw error('The exact MCP resource and scope are required.')
    return json(await transaction(store, async tx => {
      const client = await tx.get(`oauth:client:${data.client_id}`,null,30*DAY)
      if (!client) throw Object.assign(error('Unknown client.',401),{code:'invalid_client'})
      const isCode = data.grant_type === 'authorization_code'
      if (!isCode && data.grant_type !== 'refresh_token') throw error('Unsupported grant type.')
      const key = isCode ? `oauth:code:${hash(data.code || '')}` : `oauth:token:${hash(data.refresh_token || '')}`
      const record = await tx.get(key,null,isCode?60:7*DAY)
      if (!record || record.expires <= Date.now() || isCode && record.clientId !== data.client_id || !isCode && record.kind !== 'refresh') throw error('Invalid grant.')
      const gkey = `oauth:grant:${record.grantId}`, grant = await tx.get(gkey)
      if (!grant || grant.revoked || grant.clientId !== data.client_id || grant.expires <= Date.now()) throw error('Invalid grant.')
      // Clients refresh concurrently (ChatGPT does): a reuse within 30 s gets fresh tokens; a later reuse is theft and ends the grant.
      if (!isCode && record.spent && !(record.spentAt > Date.now()-30000)) { grant.revoked=true; throw error('Refresh token reuse.') }
      if (isCode && (record.redirect !== data.redirect_uri || !/^[A-Za-z0-9._~-]{43,128}$/.test(data.code_verifier || '') || createHash('sha256').update(data.code_verifier).digest('base64url') !== record.challenge)) throw error('Invalid PKCE verifier or callback.')
      await authorize(env,`token:${hash(grant.agentToken)}`)
      const access_token=nonce(), refresh_token=nonce(), expires=Math.min(Date.now()+600000,grant.expires)
      await tx.set(`oauth:token:${hash(access_token)}`,{kind:'access',grantId:record.grantId,expires},600)
      await tx.set(`oauth:token:${hash(refresh_token)}`,{kind:'refresh',grantId:record.grantId,expires:grant.expires,spent:false},7*DAY)
      if (isCode) await tx.set(key,null,1); else if (!record.spent) { record.spent=true; record.spentAt=Date.now() }
      if (!(client.used > Date.now()-DAY*1000)) client.used = Date.now()
      return {access_token,refresh_token,token_type:'Bearer',expires_in:Math.floor((expires-Date.now())/1000),scope}
    }))
  }
  if (p === '/revoke' && request.method === 'POST') {
    await transaction(store,async tx=>{const token=await tx.get(`oauth:token:${hash(data.token || '')}`),grant=token && await tx.get(`oauth:grant:${token.grantId}`);if(grant?.clientId===data.client_id)grant.revoked=true})
    return json({})
  }
  throw error('Not found.',404)
}
