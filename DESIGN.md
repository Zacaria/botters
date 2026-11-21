# Botters — design notes (draft, 2026-10-13)

> A game designed to be played by bots and agents. The human is the coach; the agent is the athlete.

Status: **discovery.** Nothing below is decided until marked ✅ in "Decisions".

## What it must feel like (owner intent → testable pillars)

| Feeling | Testable as |
|---|---|
| Superpower / leverage | One sentence from the human changes visible behaviour within ~10 s |
| Authorship | After a round, the human can point at a moment and say "that was my instruction" |
| Inhuman execution | Units react at game speed (≥10 Hz); no human could micro it by hand |
| Rivalry | Named opponents (other humans' agents) on a shared, public leaderboard |
| Immediacy | First match in < 2 minutes from landing on the site |

## Evidence (what already worked, and its ceiling)

| Precedent | Model | Result | Lesson |
|---|---|---|---|
| Screeps (2016) | MMO RTS controlled by JavaScript | ~70k Steam owners, 87% positive, ~60 concurrent today | Strong fantasy, tiny audience: **coding is the barrier**. LLMs remove that barrier. |
| Halite II / III (Two Sigma) | Write a bot, ladder | ~6,000 / 4,000+ players | Bot ladders retain a niche for months, not a mass market |
| Lux AI S1 (Kaggle) | Bot competition | 5,691 registrations, 1,178 teams | Same niche |
| CodinGame summer 2025 | Bot contest | ~12,700 participants | Time-boxed events concentrate players |
| Dota Auto Chess / TFT (2019) | Prepare, then watch units fight | Genre-defining hits | **Mass-market version of "you don't control the fight"**: skill = preparation, payoff = watching |
| Idle games (Alharthi et al., CHI 2018) | Play by waiting | Large genre | Play = periodic decisions, not inputs |
| Gandalf (Lakera) | Prompt is the gameplay | >1M players, 40M prompts | Prompting can be a skill people grind when feedback is instant |
| Twitch Plays Pokémon (2014) | Crowd input | 1.16M participants, 121k peak concurrent | Chaos + shared narrative = spectacle |
| AI Diplomacy (Every, 2025) | LLMs vs LLMs, humans watch | ~50k live Twitch viewers at peak | **Model-vs-model is content**; spun out as Good Start Labs ($3.6M) |
| SaltyBet (since 2013) | AI fighters, viewers bet play money | Small, loyal, 13 years | Spectating AI works when you have a stake |
| Moltbook (Jan 2026) | Social network for agents | 1.5M "agents", ~17k humans behind them | Agent spectacle goes viral; actual human owners are few |
| Artifice (2026, Show HN) | 4-player, 25-turn strategy, agent follows a strategy prompt | Live, small | **Direct precedent.** Turn-based, LLM decides every turn |

Theory: Self-Determination Theory (Ryan, Rigby, Przybylski 2006) — enjoyment and continued play are predicted by **competence, autonomy, relatedness**. The core risk here is competence attribution: if the agent wins, the human must feel *they* won.

## Proposed core (to test, not decided)

**The agent writes the bot; the server runs the bot.**

1. Human talks to their agent (Claude/ChatGPT connector or local agent) through MCP.
2. Agent calls `observe()` → compact state + last-round debrief.
3. Agent calls `set_policy(rules)` → an ordered list of `if condition → action` rules in a tiny, sandboxed JSON DSL.
4. Server runs every player's policy at 10 ticks/s with identical limits. No LLM in the tick loop.
5. Browser shows the arena live (coloured squares on a grid) and the active policy as a readable rule list.

Why: LLM latency (0.5–5 s) and cost cannot sit in a real-time loop; a compiled policy gives inhuman speed, near-zero cost per tick, and fairness (the DSL is the same for everyone; the model only affects strategy quality).

First game: always-on 2D grid territory conquest (splix/paper.io-like), 5-minute rounds, house bots fill empty seats, leaderboard shows player + model.

## Parking lot

- Multi-dimensional space, persistent world, economy — after a round is fun.
- Dofus / Pokémon assets — legal takedown risk at the exact moment traction arrives. Theme ("the game where botting is legal") gives the buzz without the assets.
- Betting / spectator stakes (SaltyBet pattern) — after there is something to watch.

## Decisions

- ✅ Players bring their own inference (API key, subscription, local model). Spending tokens is the price of play, so a match must be worth it.
- ✅ No rounds. One continuous real-time match; the agent acts through game tools and edits its bot live.
- ✅ Any model size allowed; speed must matter enough that big slow models lose tempo.
- ✅ Visuals: coloured squares until the game primitives are proven.
- ✅ Format: 1v1 matchmaking queue with Elo; each side commands a swarm of ~12 units.

- ✅ Human: tight-character doctrine before the match + gestures; the agent does the heavy lifting, the human owns decisive actions through separate tools.
- ✅ Win: 3 control points, first to 100 points, wipe, or leader at **5 minutes**.
- ✅ Units: counter-triangle combat units **+ miners** that earn resources and need protection.
- ✅ First test clients: Claude Code and Codex.
- ✅ The agent plays by calling tools that give orders ("piloting a plane"), not by uploading rule logic.

- ✅ Fog of war from day one. Bushes hide units unless an enemy is within 1.5 tiles; attacking from a bush reveals the attacker for 1 s.
- ✅ Latency is a real cost: an order applies on the tick the server receives it.
- ✅ The pilot runs on the player's machine (`npx botters`); their model key never leaves it.
- ✅ Hand-written scripts allowed. Cap: 5 order batches per second per player. One Elo ladder, labelled by setup.
- ✅ Human abilities (strike, overdrive, recall, reveal) are browser-only. The agent can **call for the human** with a message, a suggested ability and a target; the human confirms with one click.
- ✅ Pilots to compare: Jev (TypeSafe API) and Clef-flash (local Ollama on the gamer tower). No placeholder pilot.

Measured 2026-10-13: Jev, 12 unit questions in one request, median 237 ms (225–265 ms, n=6), ~1.9k input tokens. Clef-flash blocked: tower Ollama is 0.34.0, `/v1/systemone` needs ≥0.35.0.

## Spike (built 2026-10-13)


### Spike results (2026-10-13, local server, real models)

| Match | Result | Commander activity | Cost |
|---|---|---|---|
| Jev pilot vs Jev pilot, different doctrines | Aggressive doctrine won 200–0 | none | ~2–3M Jev input tokens per side ≈ $0.09–0.13 |
| Claude Code (Haiku) + Jev vs Jev alone | Commander lost by wipe at 122–106 (enemy spent everything on miners, then flooded units) | 46 waits, 7 intents, 1 call_human, whole match in one turn | $0.35 Haiku + ~$0.11 Jev |
| Codex + Jev vs Jev alone | Commander won 200–0 in 83 s | 9 waits, 2 intents, 1 direct order, 1 call_human | 286k input tokens (256k cached) |

- Jev pilot: median 223–319 ms per decision for 12–60 units, 0 errors in ~1,900 calls.
- Both CLIs held one turn for a whole match. Codex `exec` needs `default_tools_approval_mode="approve"` for the server.
- Fixed after match 2: unit cap 20, miner cap 6 (an economy snowball decided the match).
- Open balance problem: holding all 3 points ends the match in ~67 s, so the first fight decides everything. Candidates: higher win score, score only for the majority holder, or a comeback mechanic. Decide after a human plays.
- Clef-flash untested: the tower's Ollama is 0.34.0; `/v1/systemone` needs ≥ 0.35.0.
- Browser view: HTTP and stream verified (page 200, 10 frames/s, ping and abilities accepted); not yet looked at by a human.

## Proposal under review (2026-10-14 #3): gambits, no model in the tick loop

Trigger: the per-tick Jev pilot costs ~$0.10 per side per match (2–3M input tokens); tests already spent ~$1. Owner agrees to return to "the agent writes the bot, the server runs the bot".

- Each squad runs an ordered list of `if condition → action` rules picked from fixed menus (Final Fantasy XII "gambits"). Server evaluates every tick for free.
- The agent watches events and rewrites gambits live (~10–30 LLM calls per match, on the player's own subscription).
- The browser shows each squad's gambits and highlights the one firing (authorship).
- The human keeps the decisive abilities and answers the agent's calls.
- Jev leaves the tick loop.

Decisions 2026-10-14:
- ✅ Q16 Gambits replace the Jev pilot; pilot code is deleted in the gambit build (no fallback kept).
- ✅ Q17 Go massive: swarms of particles, still grouped; agent manages groups. Art direction: neon pixel point-cloud on near-black (owner reference: omp.sh landing page).
- ✅ Q18 Doctrine → agent → starting gambits. Players can share them; the meta should keep shifting through rule granularity.
- ✅ Q19 Try: only the side holding 2 of 3 points scores, win at 300.

Swarm feasibility (measured 2026-10-14, Xeon 4214 single thread, cell-binned square-law fights): 1k units 0.6 ms/tick, 10k 0.7 ms, 100k 8.4 ms, 1M 54 ms. Browser sketch (`spikes/swarm.html`, headless Chromium, software rendering): 40k units 12.6 ms/frame, 200k 36 ms/frame. Consequence: at ≥100k units, replaying the whole match on each request (the Vercel plan) is too slow (≈17 s per replay); a long-lived simulation process per match is needed.

Decisions 2026-10-14 #2:
- ✅ Q20 Swarm feel confirmed. Steering 3 swarms by hand is too hard → gambits drive swarms, the human grabs one at a time. Theme: space swarms conquering and consuming planets, many planets, several swarm types later.
- ✅ Q21 10–50k particles per side. Simulate **cohorts** (centre + count), draw particles client-side only.
- ✅ Q22 Swarm-level gambits.

Cohort measurement (VM, Node, square-law fights between cohorts): full 5-minute replay of 3,000 ticks = 97 ms at 16 cohorts/side, 534 ms at 64, 2.1 s at 128 (O(n²) pairs; cap swarms per side at 40). `spikes/space.html`: 8 headless house-vs-default-gambit matches, 0.09–0.17 ms per tick, up to 77 swarms on the map, 1–8 lead changes per match, gambits won 6/8.

Decisions 2026-10-14 #3 (owner played the space sketch: "felt great, there's a learning curve and I could feel the pressure"):
- ✅ Q24 The space sketch becomes the game: `sim.js` (deterministic cohort sim, 20 Hz, fog), `server.js`, `client.js` (MCP: join_match, wait_for_event, set_gambits, order_swarm, split_swarm, release_swarm, call_human), `index.html`. Jev pilot deleted. House opponent = fixed gambits, no agent, no model.
- ✅ Q25 Three swarm types (locusts fast/fragile/fast eaters, carapace slow/tough, spores ranged) right after the first agent-played match.
- ✅ Q26 (2026-10-20) Swarm depth shipped: front-and-wrap combat with 50% digestion replaces the square law (the old law melted equal swarms for two minutes and rarely let a trailing side come back); hunger and satiety counter the snowball; the three types form a triangle and can be changed in play; colour is the camp and shape the type so 2v2 and free-for-all (4 or 6 sides, against house bots for now) stay readable. Measured over 12 seeds per cell with `$TMPDIR` probes: comebacks after 1:30 went from 3/40 to 14/40 in duels.


## Polish pass (2026-10-15)

Owner, after 5 played matches vs Codex: "I don't understand how we can influence the written gambits, they don't seem to change. Also we don't get to configure the doctrine." Server log of those matches: Codex rewrote the gambits 6–13 times per match, but the panel only showed the current list, without who changed it or when; the doctrine was a file on disk.

- Lobby per player session: name, **doctrine editor** (500 chars, saved on the server, editable mid-match: the agent gets a `HUMAN changed the doctrine` event), opponent, length, map, planning countdown, play alone or with the agent, opening gambits written by the agent or by hand.
- Modes: house easy / normal / hard (fixed gambit sets; vs the default gambits over 12 seeds the default side wins 11 / 8 / 4) and another player (queue). 3 / 5 / 8 minutes. 16 / 28 / 40 planets.
- In match: "last written by agent/you, at, why" line that flashes on change; new rules flash; full gambit editor; every human edit is sent to the agent as an event with the new list.
- The agent no longer starts matches. `join_match` waits until the human presses Play (headless scripts can still pass `vs`).
- End screen with a one-line verdict and Play again; history of the last 10 matches and leaderboard in the lobby.
- `/guide`: how to plug Claude Code, Codex, any MCP client, or a plain HTTP script.

## Back to one kind of swarm (2026-10-24)

Owner, after playing the typed and grouped version: "I don't like the rendering at all compared to the system without types. Go back and work on it more deeply, so the base version is secured and in players' hands. Still adjust the combat functions, I did not like the square system."

- `feat/swarm-core` = the shipped swarm-depth engine **minus swarm types**: N sides and teams (1v1, 2v2, ffa4, ffa6 vs house), contact-front combat with wrapping (no square law), digestion and hunger, merging of overlapping friendly swarms, seven MCP tools (no `morph_swarm`).
- The typed work is kept, unmerged, on `feat/swarm-looks` (#19) and `feat/swarm-groups` (#20), as source for the next iteration.
- House levels re-measured without types (24 seeds, 3 min, 28 planets, default list wins): easy 20, normal 14, hard 7. `normal` now defends its planets first.
- Next: spike where every particle is a unit (own speed, blockers and flankers, detachable battalions). Worst case to design for: 3,000 units per side (a throwaway probe measured about 6 ms per tick for that, against a 50 ms budget; 9,000 per side did not fit).

## Particle war replaces the cohort model (2026-11-21) ✅

Owner played the `feat/particles` spike and approved replacing production with it ("je valide et enchaîne"). The cohort sim, its Rust/WASM build and every swarm-only mechanic (digestion, hunger, merging overlap, routes, split, 2v2/free-for-all) are deleted, not kept as a fallback.

**Game.** One particle = one unit, three roles (runner fast/fragile, grunt, tank slow/tough). Units belong to battalions. Owned, unthreatened planets breed units into the nearest battalion. A crowd standing alone on a planet drains it and takes it. Each battalion follows its side's gambits (`IF condition → action`, first match wins, every 10 ticks) unless a human holds it. Duels only (1v1). Length 3 / 5 / 8 min; map 9 / 17 / 25 planets (two homes, one centre prize, mirrored pairs). A side with no units and no planets loses at once; at time, more planets wins, then more units.

**Gambits.** Conditions `bigger_enemy_near, planet_attacked, ally_fighting, weaker_enemy_near, small, big, free_planet, enemy_planet, always`; actions `go, flank, retreat, split, hold`. House bots are fixed gambit sets: `blob` (never retreats or splits), `flanker` (the default for players), `cautious`. Wire name stays `gambits`; the lobby "doctrine" is still the human's free text for the agent.

**Hand orders** (human or agent, agents still capped at 5 inputs/s): `order {bat, x, y}` (move), `flank bat` (swing round the nearest enemy), `detach {bat, role?}` (half, or only one role), `release bat` (back to the gambits). API: `docs/specs/particle-sim.md`.

**Lockstep replica.** The server still runs the authoritative match (results, Elo, agent views). Browsers run the same `sim.js` and never receive positions. Every message, over the online WebSocket and the local SSE stream alike:

| Message | Meaning |
|---|---|
| `{t:'snap', side, log, state}` | Full state at `state.tick`; `log` inputs are already in it. Sent on connect and on `{t:'resync'}` from the client. |
| `{t:'step', tick, inputs:[{i, tick, side, input}], hash?:[tick, h]}` | Advance up to `tick`. Each input applies at its own tick, before that tick's step, in `i` order. `hash` is the server's `hash(s)` at the last multiple of 20 ticks. |
| `{t:'meta', ...}` | Match frame without positions (ids, side, players, startsIn, calls, feed, edits (last 10 doctrine edits: t, who, why, change), result report). On change, at most once a second. |

The server stamps an input with its own tick when it accepts it, and announces tick T only after stepping to T, so every input at a tick below T is sent before the client may pass it. A client that sees a gap in `i`, an input older than its tick, or a different hash asks for a snapshot. Clients play the announced ticks at 20 Hz, about one message behind.

**Fog is display only.** Each browser runs the whole match, so a modified client can see through fog and read the opponent's orders. Agent views from the server keep fog. Accepted for now; a ranked anti-cheat would need server-side views again.

**Cost.** A 5-minute match is ~2.6 ms per tick in Node (bench: `node scripts/bench-sim.js`). A what-if replay of a whole match is ~15 s of CPU, too slow for the Worker, so the end report shows the result and input counts only.

## Previous proposal (2026-10-13 #2, superseded on cost): pilot / commander / human

| Role | Model | Speed | Does |
|---|---|---|---|
| Pilot | Jev-class decision model (or any fast model) | ~5 batched calls/s | Picks an order for every unit from typed choices |
| Commander | Claude Code / Codex (any LLM) | every 5–15 s | Rewrites what the pilot is asked and weighs; can also order directly |
| Human | browser | a few times per match | Decisive abilities on cooldown, pings |
| Units | server rules | 10 ticks/s | Execute last order: move, auto-attack, mine |

Evidence: Jev (TypeSafe, launched 2026-09-15) returns typed choices in ~114–500 ms at $0.042 per million input tokens, output free. The Jev Wall plays 27–36 real-time games at one batched request per ~180 ms tick. Field reports: Jev beats slower chat models when a clock punishes latency, but loses on strategy without a clock — so a slower commander still matters.

Cost estimate (unmeasured): pilot 5 Hz × 300 s × ~2k tokens ≈ 3M tokens ≈ $0.13/match.

Design rule: the public API is the game. Assume every client is a bot and will exploit any leaked information or loophole.


Biggest technical risk: chat clients (Claude.ai, ChatGPT) only act during a turn. One `wait_for_event` loop must keep one turn alive for the whole match. Spike this first.
