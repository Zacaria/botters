import { createHash } from 'node:crypto'
import { transaction } from '../online/store.js'
import { D1Store } from './d1-store.js'
import { hash, nonce, authorize, denied } from './authority.js'
import { json, body, runGame } from './http.js'
const scope = 'botters:play', DAY = 86400
const error = (message = 'Invalid authorization request.', status = 400) => Object.assign(new Error(message), { status })
const escape = v => String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c])
const resource = env => `${env.SITE_URL}/mcp`
const validRedirect = v => { try { const u = new URL(v); return v.length <= 2048 && !u.username && !u.password && !u.hash && (u.protocol === 'https:' || u.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname)) } catch { return false } }
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
    await transaction(store, async tx => {
      const counter = await tx.get(`oauth:limit:${hash(request.headers.get('cf-connecting-ip') || 'local')}:${Math.floor(Date.now()/600000)}`, { n:0 },600)
      if (counter.n++ >= 200) throw error('Too many authorization requests.',429)
    })
  }
  if (p === '/register' && request.method === 'POST') {
    if (!Array.isArray(data.redirect_uris) || !data.redirect_uris.length || data.redirect_uris.length > 8 || data.redirect_uris.some(v => typeof v !== 'string' || !validRedirect(v)) || data.token_endpoint_auth_method !== 'none' || data.scope !== undefined && data.scope !== scope || data.grant_types !== undefined && (!Array.isArray(data.grant_types) || data.grant_types.length > 2 || data.grant_types.some(v => !['authorization_code','refresh_token'].includes(v))) || data.response_types !== undefined && (!Array.isArray(data.response_types) || data.response_types.length !== 1 || data.response_types[0] !== 'code') || data.client_name !== undefined && (typeof data.client_name !== 'string' || data.client_name.length > 200)) throw error('Only public PKCE clients with HTTPS or loopback callbacks are supported.')
    const c = { client_id: nonce(), client_name: data.client_name || 'Unnamed application', redirect_uris:data.redirect_uris, token_endpoint_auth_method:'none', grant_types:['authorization_code','refresh_token'], response_types:['code'], scope, client_id_issued_at:Math.floor(Date.now()/1000) }
    await transaction(store, tx => tx.set(`oauth:client:${c.client_id}`, c, 30*DAY))
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
      return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect to Botters</title><main style="max-width:42rem;margin:3rem auto;padding:0 1rem;font:1rem/1.5 system-ui"><h1>Connect an AI agent to Botters</h1><p>Application name (supplied by the application, not verified): <strong>${escape(pending.name)}</strong></p><p>Registered callback origin: <strong>${escape(new URL(pending.redirect_uri).origin)}</strong></p><p>This agent can read your match and doctrine, submit gambits and use agent controls. It cannot manage your account or start a match for you. Approval replaces your previous agent.</p><p>Access lasts up to seven days, including while signed out. Use Disconnect agent in the Botters lobby to revoke it.</p><p><a href="${escape(pending.approvalUrl)}" target="_blank" rel="noopener noreferrer">Sign in to Botters and approve</a></p><p id="status" role="status">Waiting for approval in Botters.</p><button id="cancel">Cancel</button><script nonce="${scriptNonce}">const transaction=${JSON.stringify(id)};let stopped=false;async function poll(){if(stopped)return;try{const r=await fetch('/consent/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({transaction})}),d=await r.json();if(d.approved&&d.url){location.assign(d.url);return}if(!r.ok){document.querySelector('#status').textContent='Approval ended. Start again in your assistant.';return}}catch{}setTimeout(poll,1000)}document.querySelector('#cancel').onclick=async()=>{stopped=true;await fetch('/consent/cancel',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({transaction})});document.querySelector('#status').textContent='Connection cancelled.'};poll()</script></main></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':`default-src 'none'; script-src 'nonce-${scriptNonce}'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`}})
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
      if (!await tx.get(`oauth:client:${data.client_id}`)) throw error('Unknown client.')
      const isCode = data.grant_type === 'authorization_code'
      if (!isCode && data.grant_type !== 'refresh_token') throw error('Unsupported grant type.')
      const key = isCode ? `oauth:code:${hash(data.code || '')}` : `oauth:token:${hash(data.refresh_token || '')}`
      const record = await tx.get(key,null,isCode?60:7*DAY)
      if (!record || record.expires <= Date.now() || isCode && record.clientId !== data.client_id || !isCode && record.kind !== 'refresh') throw error('Invalid grant.')
      const gkey = `oauth:grant:${record.grantId}`, grant = await tx.get(gkey)
      if (!grant || grant.revoked || grant.clientId !== data.client_id || grant.expires <= Date.now()) throw error('Invalid grant.')
      if (!isCode && record.spent) { grant.revoked=true; throw error('Refresh token reuse.') }
      if (isCode && (record.redirect !== data.redirect_uri || !/^[A-Za-z0-9._~-]{43,128}$/.test(data.code_verifier || '') || createHash('sha256').update(data.code_verifier).digest('base64url') !== record.challenge)) throw error('Invalid PKCE verifier or callback.')
      await authorize(env,`token:${hash(grant.agentToken)}`)
      const access_token=nonce(), refresh_token=nonce(), expires=Math.min(Date.now()+600000,grant.expires)
      await tx.set(`oauth:token:${hash(access_token)}`,{kind:'access',grantId:record.grantId,expires},600)
      await tx.set(`oauth:token:${hash(refresh_token)}`,{kind:'refresh',grantId:record.grantId,expires:grant.expires,spent:false},7*DAY)
      if (isCode) await tx.set(key,null,1); else record.spent=true
      return {access_token,refresh_token,token_type:'Bearer',expires_in:Math.floor((expires-Date.now())/1000),scope}
    }))
  }
  if (p === '/revoke' && request.method === 'POST') {
    await transaction(store,async tx=>{const token=await tx.get(`oauth:token:${hash(data.token || '')}`),grant=token && await tx.get(`oauth:grant:${token.grantId}`);if(grant?.clientId===data.client_id)grant.revoked=true})
    return json({})
  }
  throw error('Not found.',404)
}
