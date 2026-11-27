import { DurableObject } from 'cloudflare:workers'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createBottersTools } from '../tools.js'
import { authenticate } from './oauth.js'
import { json, failure, body } from './http.js'
import { gameTransport } from './game-transport.js'
import { roundsHTTP } from './rounds-http.js'
export class AgentGateway extends DurableObject {
  constructor(ctx,env) { super(ctx,env); this.sessions=new Map(); this.state=null; this.tail=Promise.resolve() }
  async fetch(request) {
    const sid=request.headers.get('mcp-session-id')
    if (request.method==='POST' && sid && this.sessions.has(sid)) {
      try {
        const call=await request.clone().json()
        if (call?.method==='tools/call' && call.params?.name==='match_frame') return this.handle(request)
      } catch { /* Invalid bodies follow the normal queued path. */ }
    }
    const work=this.tail.then(()=>this.handle(request),()=>this.handle(request)); this.tail=work.catch(()=>{}); return work
  }
  async handle(request) {
    try {
      const grant=await authenticate(this.env,request)
      if (!this.ctx.id.equals(this.env.AGENTS.idFromName(grant.grantId))) return json({error:'Wrong agent session.'},403)
      for (const [id,s] of this.sessions) if (s.touched<Date.now()-600000) { await s.transport.close();this.sessions.delete(id) }
      const sid=request.headers.get('mcp-session-id')
      let entry=sid && this.sessions.get(sid)
      if (sid && !entry) return json({jsonrpc:'2.0',id:null,error:{code:-32001,message:'Session ended. Initialize again.'}},404)
      this.state ||= await this.ctx.storage.get('tools') || {session:{agentToken:grant.agentToken,lobby:this.env.SITE_URL,online:true},since:0,opened:false,inMatch:false,matchId:null}
      if (!entry) {
        if (request.method!=='POST') return json({error:'Initialize an MCP session.'},400)
        // Some clients (ChatGPT) open a session per call and never close it. State lives on the grant, so evict the least recently used session.
        while (this.sessions.size>=8) {
          const [oldest,old]=[...this.sessions].reduce((a,b)=>b[1].touched<a[1].touched?b:a)
          this.sessions.delete(oldest); await old.transport.close()
        }
        const internalFetch=async(url,options={})=>{
          const u=new URL(url)
          if(u.origin!==this.env.SITE_URL) throw new Error('Unexpected game target')
          if(u.pathname==='/live-config.json') return json({url:this.env.SITE_URL,accountRequired:true,rounds:this.env.ROUNDS_ENABLED==='1'})
          const req=new Request(u,{...options})
          try { return u.pathname.startsWith('/rounds') ? await roundsHTTP(this.env,req) : await gameTransport(this.env,req) }
          catch(e) {return failure(e)}
        }
        const server=await createBottersTools({server:this.env.SITE_URL,agentToken:grant.agentToken,requireAgentToken:true,state:this.state,fetchImpl:internalFetch})
        const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:()=>crypto.randomUUID(),enableJsonResponse:true,onsessioninitialized:id=>{this.sessions.set(id,entry)}})
        entry={server,transport,touched:Date.now()}
        await server.connect(transport)
      }
      entry.touched=Date.now()
      const parsedBody=request.method==='POST' ? await body(request) : undefined
      const response=await entry.transport.handleRequest(request,{parsedBody})
      await this.ctx.storage.put('tools',this.state)
      if(request.method==='DELETE' && sid)this.sessions.delete(sid)
      return response
    } catch(e) {return failure(e)}
  }
}
