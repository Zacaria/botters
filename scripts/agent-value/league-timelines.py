# Extract each live-league match's gambit timeline (the agent's set_gambits / toggle_gambit, in game seconds) from a Claude Code
# stream-json transcript. python3 -I scripts/agent-value/league-timelines.py <runs dir with <id>/claude.jsonl + result.json> > timelines.json
import json, os, sys, copy
runs = sys.argv[1]
out = {}
for m in sorted(os.listdir(runs)):
    p = os.path.join(runs, m, 'claude.jsonl')
    if not os.path.exists(p) or not os.path.exists(os.path.join(runs, m, 'result.json')): continue
    r = json.load(open(os.path.join(runs, m, 'result.json')))
    if not r.get('history'): continue
    calls, last_sec, pending = [], 0.0, {}
    cur = None
    for l in open(p):
        e = json.loads(l)
        if e.get('type') == 'assistant':
            for c in e['message']['content']:
                if c['type'] == 'tool_use': pending[c['id']] = c
        elif e.get('type') == 'user':
            for c in e['message']['content']:
                if not (isinstance(c, dict) and c.get('type') == 'tool_result'): continue
                use = pending.get(c['tool_use_id']); txt = c.get('content')
                txt = txt[0]['text'] if isinstance(txt, list) and txt and txt[0].get('type') == 'text' else str(txt)
                try: body = json.loads(txt)
                except Exception: body = {}
                st = body.get('state') or (body.get('view') and {'tick': (180 - body['view'].get('secondsLeft', 180)) * 20})
                if isinstance(st, dict) and 'tick' in st: last_sec = st['tick'] / 20
                if not use: continue
                name = use['name'].split('__')[-1]
                if body.get('ok') is not True: continue
                if name == 'set_gambits':
                    cur = [dict(g) for g in use['input']['gambits']]
                    calls.append({'t': last_sec, 'gambits': copy.deepcopy(cur)})
                elif name == 'toggle_gambit' and cur:
                    i = use['input']['index']
                    if i < len(cur): cur[i]['on'] = cur[i].get('on', True) is False; calls.append({'t': last_sec, 'gambits': copy.deepcopy(cur)})
    out[m] = {'level': r['level'], 'result': r['history']['result'], 'calls': calls}
print(json.dumps(out))
