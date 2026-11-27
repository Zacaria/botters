Live-breed track stopped on 26/11; its scripts stay on branch `botters/t_f6ac0131-changer-une-m-canique-de-botters-pour-qu`.

# Breed: a mechanic where reading the opponent pays (2026-11-23)

**Verdict:** breeds make reading the enemy worth a lot to a script, but not yet to a real agent. Offline, a fog-only script that breeds the counter of what it sees beats the `pincer` house 30 of 32 times on 16 maps × both sides, against 21 of 32 for the best fixed choice. Claude Haiku, playing the same 20 bench maps through the real client, wins 7/20 against a house that re-breeds too (no edit: 7/20) and 14/20 against a house with a fixed breed (no edit: 13/20). No net gain, so Sonnet was not run and the mechanic is not shipped (§ Real agent).

Before this change, editing rules mid-match was worth nothing (`RESULTS.md` premise 1): matches snowball, the right opening depends on the map, and nothing visible during the match says which rules to switch to.

## The mechanic

- Each side picks one **breed**: `runner`, `grunt` or `tank`. From then on its planets breed only that role. Starting armies stay mixed. Default `grunt`.
- **Counter triangle:** runners beat tanks, tanks beat grunts, grunts beat runners. A unit deals 1.25× damage to the role it beats and 0.8× to the role that beats it (`TUNE.counter` in `sim.js`).
- The breed is a rule like gambits: the agent sets it (`set_breed`), the human can set it too, and it can change at any time.
- What the agent sees: its own breed, and the role counts of every enemy battalion in sight (`get_state`, and a `wait_for_event` line the first time each battalion is spotted).
- The house breeds `runner`, `grunt` or `tank` depending on the match seed, so no single fixed breed is right every match.

## Results

All matches: 5 minutes, 17 planets. House = `pincer` gambits + breed from the seed. Raw files in `raw/breed/`.

### Proxy: does reading the enemy beat the best fixed choice? (16 maps × both sides, seeds 1000–1015)

| side vs house | ×1.25 (chosen) | ×1.5 |
|---|---|---|
| Best fixed gambits + breed | 0.66 (`pincer`/`blob`/`flanker` + grunt) | 0.56 (`pincer` + tank) |
| **Counter script** (fog only: breeds the counter of the roles in sight, at most every 5 s) | **0.94** | **1.00** |
| Blind rotation (changes breed every 20 s, never looks) | 0.59 | 0.84 |
| Counter script head to head vs each of the 9 fixed choices, worst | 0.66 | 0.97 |

At ×1.5 even the blind rotation wins, so the gain would come from switching, not from reading. ×1.25 keeps the gain on reading: that is the agent's job.

Breed vs breed with identical gambits (×1.5, 16 maps × both sides): each breed beats its prey 0.94–1.00, so the triangle is real.

### Oracle at 30 s vs best fixed (8 maps × both sides)

| | oracle | best fixed | gap |
|---|---|---|---|
| Before (gambits only, `raw/lookahead-vs-blobflank.json`) | 0.94 | 0.75 | 0.19 |
| After, ×1.5 | 1.00 | 0.56 | 0.44 |
| After, ×1.25 (chosen) | 0.94 | 0.69 (`blob` + grunt) | 0.25 |

The oracle knows the future. What matters more: at ×1.25 the fog-only counter script (0.94 on 16 maps × both sides) reaches the oracle's level without it.

### The bench maps (seeds 1–20, agent side), ×1.25

| side 0, no edit unless stated | wins / 20 |
|---|---|
| Starting rules (`flanker` + grunt), no edit — new baseline | 13 |
| `blob` + grunt | 13 |
| `pincer` + same breed as the house | 10 |
| `pincer` + runner / grunt / tank | 9 / 11 / 7 |
| Blind rotation | 12 |
| **Counter script** | **18** |

Before the change: Sonnet agent 3/20, no edit 8/20 (`RESULTS.md` §3). The agent now has to beat 13/20 (no edit) and can reach 18/20 by reading `roles` and calling `set_breed`.

### Against a house that re-breeds too

A house that keeps one breed is easy to read once. The fairer opponent re-breeds like the agent can: `counter` script on the house side (re-breeds to counter the roles it sees, at most every 5 s). Same 16 maps × both sides, `raw/breed/proxy-k1.25-vs-recounter-house.json`:

| side vs re-breeding house | score |
|---|---|
| Best fixed gambits + breed | 0.50 (`pincer` + grunt) |
| Counter script (breeds the counter of what it sees) | 0.66 |
| Blind rotation every 20 s | 0.66 |
| **Outguess script** (guesses the breed the house picks against our army, breeds what beats it) | **0.81** |

Reading still pays, but only one step ahead: plain countering is no better than rotating blindly.

Bench maps (seeds 1–20, agent side), `raw/breed/control-k1.25-vs-recounter-seeds1-20.json`:

| side 0 vs re-breeding house | wins / 20 |
|---|---|
| Starting rules (`flanker` + grunt), no edit | 7 |
| Best fixed (`pincer` + grunt) | 12 |
| Blind rotation | 13 |
| Counter script | 14 |
| Outguess script | 15 |

### Real agent (Claude Code + `client.js`, Haiku, 20 bench maps)

Same brief as `RESULTS.md` §3 (`--set blobflank`, seed = map, house breed from the seed). Per match: `seed-N.json` (result, edits with reasons, cost), `seed-N.server.json`, `seed-N.stream.jsonl.gz`.

| | before breeds (Sonnet, `RESULTS.md`) | Haiku vs re-breeding house | Haiku vs fixed-breed house |
|---|---|---|---|
| Agent wins | 3/20 | **7/20** | **14/20** |
| Same maps, no edit | 8/20 | 7/20 | 13/20 |
| Script that reads the enemy | – | 14–15/20 | 18/20 |
| Cost (total · median · max per match) | $46.42 | $14.14 · $0.67 · $1.36 | $14.25 · $0.76 · $1.06 |
| Raw | `raw/agent-vs-blobflank-sonnet/` | `raw/breed/agent-haiku-vs-recounter/` | `raw/breed/agent-haiku-vs-frozen/` |

What the transcripts show: Haiku does read the enemy (every `set_breed` cites the roles in sight: "Enemy army is mostly grunts (199); tanks beat grunts"), but its first breed change comes late (median 93 s and 72 s into the run, the scripts switch as soon as 30 enemy units are in sight) and it plays plain counter, which a re-breeding house answers. It no longer loses to its own edits as Sonnet did before breeds (agent ≈ no edit instead of 3 vs 8), but it does not beat the no-edit baseline either. 18 and 19 of the 20 matches end in a wipe: the opening still decides most games.

The plan required Haiku above 13/20 against the re-breeding house before paying ~$45 for Sonnet; 7/20 stops it there. Total model spend for this card: $28.39 of $55.

What would have to change for an agent to gain: start reading earlier (a `spotted` event already fires; the brief could say "breed the counter the moment you see their army"), or a slower house re-breed so plain countering is not answered within 5 s. Both are untested.

## Reproduce

```
node scripts/agent-value/breeds.mjs 16 pincer '{"counter":1.5}' runner,grunt,tank
node scripts/agent-value/proxy.mjs 16 <out.json> pincer,blob,flanker 7 '{"counter":1.25}'
node scripts/agent-value/lookahead.mjs 8 pincer+seeded pincer+runner,pincer+grunt,pincer+tank,blob+runner,blob+grunt,blob+tank 30 150 7 <out.json>
node scripts/agent-value/control.mjs blobflank+seeded 1 20 flanker+grunt,blobflank+counter,blobflank+cycle <out.json>
node scripts/agent-value/agent-bench.mjs --set blobflank --seeds 1,2,...,20 --out <dir> --model haiku   # house breed = BREEDS[seed % 3]
node scripts/agent-value/proxy.mjs 16 <out.json> pincer,blob,flanker 7 '{"counter":1.25}' vsHouse counter outguess   # house re-breeds
node scripts/agent-value/control.mjs blobflank+seeded+counter 1 20 flanker+grunt,blobflank+grunt,blobflank+counter,blobflank+cycle,blobflank+outguess <out.json>
node scripts/agent-value/agent-bench.mjs --set blobflank --house-script counter --seeds 1,...,20 --out <dir> --model haiku   # BOTTERS_HOUSE_SCRIPT
```

Rounds mode (`RESULTS.md` §5) reuses this triangle with ×2 instead of 1.25, one breed per side per round, and a house that changes breed between rounds; there, Sonnet wins 16/20 where the unchanged bot wins 4.
