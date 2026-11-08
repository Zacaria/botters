import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createPostgresAuth } from '../online/postgres-auth.js'
import { PostgresStore } from '../online/postgres-store.js'
const database = process.env.BOTTERS_TEST_POSTGRES_URL
test('actual PostgreSQL control survives an idle database socket cut', { skip: !database, timeout: 30000 }, async () => {
const target = new URL(database)
assert.ok(['postgres:', 'postgresql:'].includes(target.protocol) && target.hostname === '127.0.0.1' && !target.search, 'use an isolated loopback database')
const schema = `botters_http_${randomUUID().replaceAll('-', '')}`
const admin = new pg.Pool({connectionString:database})
let pool, child, proxy
const sockets = new Set()
try {
  await admin.query(`CREATE SCHEMA "${schema}"`)
  pool = new pg.Pool({connectionString:database,options:`-c search_path=${schema}`})
  const auth = await createPostgresAuth({pool,env:{SITE_URL:'http://127.0.0.1:1',BETTER_AUTH_SECRET:'test-secret-isolated-12345678901234567890'},sendEmail:async()=>{}})
  await auth.migrate(); await new PostgresStore(pool,'journey').init()
  proxy = net.createServer(c => { const u = net.connect(Number(target.port || 5432),'127.0.0.1'); for (const s of [c,u]) { sockets.add(s); s.on('error',()=>{}); s.on('close',()=>sockets.delete(s)) } c.pipe(u).pipe(c) }).listen(0,'127.0.0.1')
  await once(proxy,'listening')
  const portServer=net.createServer().listen(0,'127.0.0.1'); await once(portServer,'listening'); const port=portServer.address().port; await new Promise(r=>portServer.close(r))
  const origin=`http://127.0.0.1:${port}`
  const url=new URL(database); url.port=String(proxy.address().port); url.searchParams.set('options',`-c search_path=${schema}`)
  child=spawn(process.execPath,['scripts/postgres-http-server.js'],{env:{...process.env,DATABASE_URL:url.toString(),BOTTERS_STORE_NAMESPACE:'journey',SITE_URL:origin,BOTTERS_AUTH_ORIGIN:origin,BETTER_AUTH_SECRET:'test-secret-isolated-12345678901234567890',HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']})
  let out='',err=''; child.stdout.on('data',b=>out+=b); child.stderr.on('data',b=>err+=b)
  const start=Date.now(); while(!out.includes('botters-control') && child.exitCode===null && Date.now()-start<10000) await new Promise(r=>setTimeout(r,30))
  if(!out.includes('botters-control')) throw new Error('control startup failed: '+err.slice(0,500))
  for(const s of sockets) s.destroy()
  await new Promise(r=>setTimeout(r,1000))
  assert.equal(child.exitCode, null, `control must survive an idle database socket cut: ${err}`)
  assert.ok(err.includes('PostgreSQL idle connection lost'), 'pool reports lost idle connection without leaking details')
} finally {
  if(child && child.exitCode===null) { child.kill('SIGTERM'); await once(child,'exit') }
  for(const s of sockets) s.destroy()
  if(proxy) await new Promise(r=>proxy.close(r))
  if(pool) await pool.end()
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end()
}

})
