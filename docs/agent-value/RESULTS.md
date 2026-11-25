# Where does an agent beat good fixed rules? (2026-11-23)

**Verdict:** today an agent does not beat good fixed rules in Botters: Claude Sonnet, playing through the real stdio client, won 3 of 20 matches against the `pincer` house, while leaving the starting gambits untouched wins 8 of the same 20 — matches are decided by the map and the opening, and the agent rewrote its rules toward retreating, which loses.

Follow-up: the breed mechanic (`BREED.md`) gives mid-match reading a measured value to scripts, but a real Haiku agent only matches the no-edit baseline (7/20 vs a re-breeding house, 14/20 vs a fixed one); it is not shipped. The tables below are the game before it.

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
| 10 | An agent that rewrites the bot between rounds, TFT-style, beats fixed rules | **False** | Sonnet 14/20 = no edit 14/20; Haiku 9/20 (§4). |

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

## 4. Rounds: the agent rewrites the bot only between rounds (2026-11-24)

**Verdict:** an agent that rewrites the bot between rounds does not beat fixed rules: Sonnet wins 14 of 20 matches, exactly what the unchanged starting bot wins, and Haiku wins 9.

Format (`sim.js` `ROUNDS`, `playRound`, `nextSlots`): a match is 5 rounds. Each round is a fresh 75-second combat on the same map (same seed every round, so the same two bots give the same result), simulated instantly. Before each round both sides get the same 30-second wall-clock pause. At the gong the last valid version is locked; with none, the previous bot plays (round 1: the starting bot `weaker_enemy_near(3) → go · free_planet → go · enemy_planet → go`). Both sides start with 3 rule slots, gain 1 per round, and the round loser gains 1 more (cap 10). More rounds won wins the match. The agent never acts during a round and never sees the house rules; after each round it gets a debrief (result, planets and units every 15 s, share of decisions per rule). The house plays `pincer` trimmed to its slots (`fit` in `scripts/agent-value/rounds.mjs`: expansion and attack rules first, `always → hold` last). The agent is side 0 on seeds 1–20.

| side 0 vs `pincer` house | match wins / 20 | rounds won / 100 | versions per pause (median · mean) | versions refused (invalid · late at the gong) | cost |
|---|---|---|---|---|---|
| Haiku agent | **9** | 41 | 1 · 0.78 | 31 · 0 | $0.09 total, $0.004 median |
| Sonnet agent | **14** | 67 | 0.5 · 0.50 | 20 · 0 | $0.77 total, $0.034 median |
| No edit (starting bot every round) | 14 | 68 | 0 | – | – |
| `pincer` mirror (same bot as the house) | 11 | 55 | 0 | – | – |
| Scripted switcher (next of pincer/blob/flanker/rush/greedy after each lost round) | 12 | 55 | – | – | – |

- Haiku's edits turned 8 maps the starting bot wins into losses and 3 losses into wins. Sonnet's turned 4 into losses and 4 into wins: net zero. Sonnet learned to keep a winning bot (no version in 50 of 100 pauses); Haiku kept changing it.
- No version was late at the gong: every agent answered within the 30 s (median wall time 187 s per match). The refusals are the first pause: 18/20 Haiku and 15/20 Sonnet runs sent more rules than the 3 slots (or an unknown condition) and did not resend, so the starting bot played round 1.
- The mirror wins 55 of 100 rounds: side 0 has a small edge on these maps, so compare rows with each other, not with 50 %.
- In 75-second rounds fewer rules win: the 3-rule starting bot takes 12–14 of the 20 rounds at every slot count the house reached, so the extra slot given to the loser does not slow a snowball here; it does not help.

Per seed in `raw/rounds-<model>-vs-blobflank/`: `seed-N.json` (result, versions per pause, refusals, cost), `seed-N.log.json` (every pause: versions with the agent's reasons, refused versions, locked bot, house bot, round result), `seed-N.stream.jsonl.gz` (Claude Code transcript). Controls: `raw/rounds-control-vs-blobflank-seeds1-20.json`. Claude Code 2.1.326, `--model haiku` (claude-haiku-5-5) and `--model sonnet`, MCP = `scripts/agent-value/rounds-mcp.mjs` only. Model spend for this card: $0.87 (one Haiku smoke match included).

## Reproduce

```
node scripts/agent-value/roundrobin.mjs 16 pincer,blob,flanker,rush,greedy        # §2 (pincer = blobflank in strategies.mjs)
node scripts/agent-value/control.mjs blobflank 1 20 flanker,blob,blobflank,rush    # §3 controls
node scripts/agent-value/lookahead.mjs 8 blobflank blobflank,blob,rush,flanker,greedy,turtle 30 150 4
node scripts/agent-value/agent-bench.mjs --set blobflank --seeds 1,2,...,20 --out <dir> --model sonnet   # costs ~$2/match
node scripts/agent-value/rounds-control.mjs 1 20 noEdit,mirror,switcher <out.json>                    # §4 controls
node scripts/agent-value/rounds-bench.mjs --seeds 1,2,...,20 --out <new dir> --model haiku --parallel 4   # §4, ~$0.005/match (sonnet ~$0.04)
```
