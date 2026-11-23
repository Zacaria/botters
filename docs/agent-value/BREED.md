# Breed: a mechanic where reading the opponent pays (2026-11-23)

**Verdict (offline):** with breeds, a fog-only script that reads the enemy's roles and breeds their counter beats the `pincer` house 30 of 32 times on 16 maps × both sides, against 21 of 32 for the best fixed choice. A blind rotation gains nothing (19/32). The real-agent replay (20 Claude Code matches) has not been run yet.

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

## Reproduce

```
node scripts/agent-value/breeds.mjs 16 pincer '{"counter":1.5}' runner,grunt,tank
node scripts/agent-value/proxy.mjs 16 <out.json> pincer,blob,flanker 7 '{"counter":1.25}'
node scripts/agent-value/lookahead.mjs 8 pincer+seeded pincer+runner,pincer+grunt,pincer+tank,blob+runner,blob+grunt,blob+tank 30 150 7 <out.json>
node scripts/agent-value/control.mjs blobflank+seeded 1 20 flanker+grunt,blobflank+counter,blobflank+cycle <out.json>
node scripts/agent-value/agent-bench.mjs --set blobflank --seeds 1,2,...,20 --out <dir> --model haiku   # house breed = BREEDS[seed % 3]
```
