# Where does an agent beat good fixed rules? (2026-11-23)

**Verdict:** today an agent does not beat good fixed rules in Botters: Claude Sonnet, playing through the real stdio client, won 3 of 20 matches against the `pincer` house, while leaving the starting gambits untouched wins 8 of the same 20 — matches are decided by the map and the opening, and the agent rewrote its rules toward retreating, which loses.

Follow-up: the breed mechanic (`BREED.md`) gives mid-match reading a measured value offline; the tables below are the game before it.

All numbers: 5-minute matches, 17 planets, `sim.js` at this commit. A score is wins + ½ draws over matches; "both sides" means each map is played once from each home.

## 1. Premises

| # | Premise (source) | Status | Evidence |
|---|---|---|---|
| 1 | The agent adds value by editing gambits during the match (DESIGN.md, DOCTRINE.md) | **False** | Real agent 3/20 vs `pincer`; same maps with no edit 8/20 (§3). Scripted fog-only switching (by clock, by planet lead) 0.44–0.56 vs 0.56 for not switching (`raw/adaptive-vs-blobflank.json`). |
| 2 | House levels get stronger easy → normal → hard (sim.js) | **False** (fixed here) | hard (`flanker`) lost to normal (`blob`) 0.31 over 16 maps × 2 sides. Hard is now `pincer`, which beats `blob` 0.63. |
| 3 | Avoid larger battalions (default lobby doctrine) | **False** | Every set that retreats loses: `cautious` 0/20 vs `pincer`, 0.11 mean in the round robin. 19/20 agent runs added `bigger_enemy_near → retreat` in their first edit, 5–8 s in. The default doctrine now says "Never retreat from a larger battalion: flank it." |
| 4 | Changing rules mid-match can matter at all | **True, with foresight only** | An oracle that forks the match every 30 s and keeps the set that wins to the end scores 0.94 vs `pincer`; the best single set scores 0.75 on the same 16 matches (`raw/lookahead-vs-blobflank.json`). It knows the future; no agent does. |
| 5 | The best opening depends on the map | **True** | Picking, per map, the right one of four fixed sets would win 15/20 vs `pincer`; any single set wins at most 10/20 (`raw/control-vs-blobflank-seeds1-20.json`). |
| 6 | Matches swing | **False** | 80 % end in a wipe; median lead changes 0 (320 matches, `raw/rr-top5-16seeds.json`). Whoever is ahead after the first fights wins. |
| 7 | One `wait_for_event` loop keeps a chat turn alive for a whole match (DESIGN.md risk) | **True** | 20/20 runs played to the end: median 105 turns, ~100 `wait_for_event` calls. |
| 8 | Agent cost ≈ $0.13 per match (DESIGN.md) | **False** | Median $2.36 per match with Sonnet in Claude Code; $0.51 for one Haiku match. |
| 9 | An agent helps elsewhere: counter a scouted opponent, learn between matches, advise the player | **Untested** | A hill-climb against a known opponent found nothing confirmed better than 0.75 (`raw/counter-vs-blobflank.jsonl`, noisy). Premise 5 says choosing per map is worth +5 wins in 20 if something can predict it. |

## 2. Strongest fixed set

Round robin, 16 maps × both sides (`raw/rr-top5-16seeds.json`; first pass with 8 sets on 4 maps in `raw/rr-handwritten-4seeds.json`):

| row vs column | pincer | blob | flanker | rush | greedy | mean |
|---|---|---|---|---|---|---|
| **pincer** | – | 0.63 | 0.72 | 0.66 | 0.81 | **0.70** |
| blob | 0.38 | – | 0.69 | 0.66 | 0.84 | 0.64 |
| flanker | 0.28 | 0.31 | – | 0.59 | 0.73 | 0.48 |
| rush | 0.34 | 0.34 | 0.41 | – | 0.47 | 0.39 |
| greedy | 0.19 | 0.16 | 0.27 | 0.53 | – | 0.29 |

`pincer` (named `blobflank` in the raw logs) = `planet_attacked → go · weaker_enemy_near(3) → go · bigger_enemy_near(1) → flank · free_planet → go · enemy_planet → go · always → hold`. Hill-climbing from `blob`, `rush` and `pincer` (`raw/search-*.jsonl`) found no confirmed improvement.

## 3. Real agent vs `pincer`

Claude Code 2.1.326, `--model sonnet`, MCP = this repo's `client.js` only, prompt = the guide's opening line plus "play this one match to the end". Local server per match with `BOTTERS_SEED` = 1…20 and `BOTTERS_HOUSE_GAMBITS` = pincer. Per match in `raw/agent-vs-blobflank-sonnet/`: `seed-N.json` (result, edits with the agent's reasons, cost), `seed-N.server.json` (server end report with the full input log), `seed-N.stream.jsonl.gz` (the Claude Code transcript).

| | wins / 20 | rule edits (median) | wall time (median) | cost |
|---|---|---|---|---|
| Sonnet agent | **3** | 5 | 238 s | $44.20 total, $2.36 median |
| No edit (starting `flanker`) | 8 | 0 | – | – |
| `blob`, no edit | 8 | 0 | – | – |
| `pincer` mirror | 10 | 0 | – | – |
| Best of 4 fixed sets, chosen per map | 15 | 0 | – | – |

The agent's edits turned 7 maps the starting rules win into losses and 2 losses into wins. Total model spend for this card: $46.42 of the $50 cap (two smoke matches included), so step 4 (change one mechanic, rerun) was not run.

## Reproduce

```
node scripts/agent-value/roundrobin.mjs 16 pincer,blob,flanker,rush,greedy        # §2 (pincer = blobflank in strategies.mjs)
node scripts/agent-value/control.mjs blobflank 1 20 flanker,blob,blobflank,rush    # §3 controls
node scripts/agent-value/lookahead.mjs 8 blobflank blobflank,blob,rush,flanker,greedy,turtle 30 150 4
node scripts/agent-value/agent-bench.mjs --set blobflank --seeds 1,2,...,20 --out <dir> --model sonnet   # costs ~$2/match
```
