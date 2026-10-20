import concurrent.futures, datetime, hashlib, json, pathlib, subprocess, urllib.request, urllib.error
ROOT=pathlib.Path('/srv/hermes-ssd/workspaces/botters/swarm-release-verification-t_abfb2be1')
OUT=pathlib.Path('/home/hermes/.hermes/kanban/boards/gimli/workspaces/t_abfb2be1/source/docs/releases/swarm-successor-t_abfb2be1')
OUT.mkdir(parents=True,exist_ok=True)
SHA='d6630fca9b252948088ea06f9c3b6329ff72ded8'
DEPLOY='dpl_7v2xmoicQzJMPc2RFRVswAbtuUk7'
def command(args):
 p=subprocess.run(args,cwd=ROOT,text=True,capture_output=True,check=True); return p.stdout

def get(url,headers=None):
 req=urllib.request.Request(url,headers=headers or {})
 try:
  with urllib.request.urlopen(req,timeout=45) as r: return r.status,dict(r.headers),r.read()
 except urllib.error.HTTPError as r: return r.code,dict(r.headers),r.read()

def jsonget(url,headers=None):
 status,hs,body=get(url,headers); assert status==200,(url,status); return json.loads(body)

def save(name,obj):
 (OUT/name).write_text(json.dumps(obj,indent=2)+'\n')

receipt={'observed_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'task':'t_abfb2be1','candidate':SHA,'approved_head':'581ce19d05e3d1fde122049cdfe9f74a40ed34f7','approved_tree':'04d55305ba1beadeb6233683e8b3afd481aa44ef','production_mutations_this_run':[],'status':'PARTIAL; authenticated gameplay unavailable'}
assert command(['git','status','--porcelain'])==''
receipt['candidate_tree']=command(['git','rev-parse',SHA+'^{tree}']).strip()
assert receipt['candidate_tree']==receipt['approved_tree']
receipt['remote_refs']=command(['git','ls-remote','origin','refs/heads/pvp-online','refs/heads/feat/swarm-depth']).strip()
receipt['exact_head_ci']=json.loads(command(['gh','api','repos/Zacaria/botters/actions/runs/39389931993','--jq','{id,head_sha,status,conclusion,updated_at,html_url}']))
assert receipt['exact_head_ci']['conclusion']=='success'
receipt['merge_signature']=json.loads(command(['gh','api','repos/Zacaria/botters/git/commits/'+SHA,'--jq','{sha,tree:.tree.sha,verification:{verified:.verification.verified,reason:.verification.reason,verified_at:.verification.verified_at}}']))
assert receipt['merge_signature']['verification']['verified']
auth=json.loads(pathlib.Path('/home/hermes/.local/share/com.vercel.cli/auth.json').read_text())
headers={'Authorization':'Bearer '+auth['token']}
files=jsonget(f'https://api.vercel.com/v6/deployments/{DEPLOY}/files?teamId=team_lpN3ikyEWpXFfrV53eNYNWQd',headers)
flat={}
def flatten(nodes,prefix=''):
 for n in nodes:
  p=prefix+n['name']
  if n['type']=='directory': flatten(n.get('children',[]),p+'/')
  else: flat[p]=n.get('uid')
flatten(files)
tracked=command(['git','ls-tree','-r','--name-only',SHA]).splitlines()
# Compare uploaded bytes, not Git blob hashes. Keep inventory hashes only; no file contents or secrets.
compared=[]
for file in tracked:
 key='src/'+file
 if key not in flat: continue
 digest=hashlib.sha1((ROOT/file).read_bytes()).hexdigest()
 compared.append({'path':file,'sha1':digest,'uploaded_sha1':flat[key],'match':digest==flat[key]})
assert compared and all(v['match'] for v in compared)
critical=['index.html','sim.js','browser-live.js','client.js','server.js','api/index.js','scripts/build.js','vercel.json','package.json','package-lock.json']+[p for p in tracked if p.startswith('online/') and p.endswith('.js')]
assert all(any(c['path']==p for c in compared) for p in critical)
save('vercel-source-parity.json',{'deployment_id':DEPLOY,'matched_count':len(compared),'critical_count':len(critical),'comparisons':compared,'uploaded_source_files':sorted(flat)})
receipt['vercel_source_matched_count']=len(compared)
receipt['vercel_deployments']={}
for host in ['botters.havesomecode.io','botters.vercel.app']:
 d=jsonget(f'https://api.vercel.com/v13/deployments/{host}?teamId=team_lpN3ikyEWpXFfrV53eNYNWQd',headers)
 selected={k:d.get(k) for k in ['id','url','target','readyState','createdAt','ready','aliasAssigned','aliasAssignedAt']}
 assert selected['id']==DEPLOY and selected['readyState']=='READY'
 receipt['vercel_deployments'][host]=selected
assets=sorted(p for p in (ROOT/'public').rglob('*') if p.is_file())
assert len(assets)==10,len(assets)
def verify_asset(pair):
 host,p=pair
 path=p.relative_to(ROOT/'public').as_posix()
 route='/' if path=='index.html' else '/'+path
 status,hs,body=get('https://'+host+route)
 expected=hashlib.sha256(p.read_bytes()).hexdigest(); actual=hashlib.sha256(body).hexdigest()
 return {'host':host,'path':route,'status':status,'bytes':len(body),'sha256':actual,'expected_sha256':expected,'match':status==200 and expected==actual,'content_type':hs.get('Content-Type')}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 public=list(pool.map(verify_asset,[(h,p) for h in receipt['vercel_deployments'] for p in assets]))
save('public-assets.json',public)
assert len(public)==20 and all(x['match'] for x in public)
receipt['public_asset_comparisons_passed']=len(public)
receipt['live_config']=jsonget('https://botters.havesomecode.io/live-config.json')
assert receipt['live_config']=={'url':'https://play.botters.havesomecode.io','accountRequired':True}
receipt['health']=jsonget('https://play.botters.havesomecode.io/health')
assert receipt['health']['build']==SHA and receipt['health']['status']=='ok'
routes=[]
for host in receipt['vercel_deployments']:
 for path,expected in [('/guide',200),('/privacy',200),('/terms',200),('/account',200),('/state?token=release-unallocated-invalid',410),('/release-route-not-found',404)]:
  status,hs,body=get('https://'+host+path)
  routes.append({'host':host,'path':path,'status':status,'expected':expected,'match':status==expected,'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()})
for path,expected in [('/state?token=release-unallocated-invalid',401),('/account',200),('/mcp',401)]:
 status,hs,body=get('https://play.botters.havesomecode.io'+path)
 routes.append({'host':'play.botters.havesomecode.io','path':path,'status':status,'expected':expected,'match':status==expected,'body':body.decode()[:300],'www_authenticate':hs.get('Www-Authenticate') or hs.get('WWW-Authenticate')})
save('routes-errors.json',routes)
# Preserve observations even if an expectation is wrong; classify from source before escalation.
receipt['route_expectation_failures']=[r for r in routes if not r['match']]
metadata={p:jsonget('https://play.botters.havesomecode.io'+p) for p in ['/.well-known/oauth-authorization-server','/.well-known/oauth-protected-resource/mcp']}
assert metadata['/.well-known/oauth-authorization-server']['issuer']=='https://play.botters.havesomecode.io/'
assert metadata['/.well-known/oauth-protected-resource/mcp']['resource']=='https://play.botters.havesomecode.io/mcp'
save('mcp-public-metadata.json',metadata)
ssh=['ssh','-i','/home/hermes/.ssh/botters_lightsail','-o','BatchMode=yes','ubuntu@100.104.109.95']
runtime=command(ssh+['sudo docker exec botters-game-1 sh -c "cd /app && sha256sum scripts/live-server.js online/*.js sim.js package.json package-lock.json"'])
runtime_matches=[]
for line in runtime.splitlines():
 digest,file=line.split(None,1); file=file.strip(); expected=hashlib.sha256((ROOT/file).read_bytes()).hexdigest()
 runtime_matches.append({'path':file,'sha256':digest,'expected_sha256':expected,'match':digest==expected})
assert len(runtime_matches)==15 and all(r['match'] for r in runtime_matches)
save('runtime-source-parity.json',runtime_matches)
containers=command(ssh+['sudo docker inspect botters-game-1 botters-mcp-mcp-1 botters-caddy-1 --format "{{.Name}} {{.Id}} {{.Image}} {{.State.StartedAt}} {{.RestartCount}}"'])
(OUT/'container-receipt.txt').write_text(containers)
receipt['runtime_source_files_matched']=len(runtime_matches)
receipt['sibling_mcp_and_caddy']='Container identities/start times show MCP started 2026-10-20T05:25:28Z and Caddy 2026-10-16T08:28:28Z, before game at 08:10:06Z; public OAuth metadata and anonymous MCP 401 readbacks preserved.'
receipt['authenticated_gameplay']='NOT RUN: fresh browser signed out; browser_vault list returned no saved logins. No signup, email, owner session reuse, capability bypass, or account manipulation.'
receipt['not_run']=['Authenticated mode selection, house match, in-match morph and result on public production','Real Claude/ChatGPT gameplay','Production Convex deployment or customer-data queries','Local test-suite reruns; independent exact-tree PASS reused']
receipt['deletions']=[]
save('verification.json',receipt)
print(json.dumps({k:v for k,v in receipt.items() if k not in ['vercel_deployments']},indent=2))
