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

Local Node server + local MCP client, to test the feel before hosting. The simulation (`sim.js`) is pure and deterministic and every input is logged by tick, so moving it to Vercel + Convex later is a port, not a rewrite. See README.md to run it.

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

## Proposal under review (2026-10-13 #2): pilot / commander / human

| Role | Model | Speed | Does |
|---|---|---|---|
| Pilot | Jev-class decision model (or any fast model) | ~5 batched calls/s | Picks an order for every unit from typed choices |
| Commander | Claude Code / Codex (any LLM) | every 5–15 s | Rewrites what the pilot is asked and weighs; can also order directly |
| Human | browser | a few times per match | Decisive abilities on cooldown, pings |
| Units | server rules | 10 ticks/s | Execute last order: move, auto-attack, mine |

Evidence: Jev (TypeSafe, launched 2026-09-15) returns typed choices in ~114–500 ms at $0.042 per million input tokens, output free. The Jev Wall plays 27–36 real-time games at one batched request per ~180 ms tick. Field reports: Jev beats slower chat models when a clock punishes latency, but loses on strategy without a clock — so a slower commander still matters.

Cost estimate (unmeasured): pilot 5 Hz × 300 s × ~2k tokens ≈ 3M tokens ≈ $0.13/match.

Design rule: the public API is the game. Assume every client is a bot and will exploit any leaked information or loophole.

Hosting: no server tick loop. The simulation is deterministic: match state = f(seed, timestamped orders). Convex stores only the order log; the MCP/HTTP API (Vercel, `mcp-handler`) and each browser replay it to the current tick. A 5-minute match is 3,000 ticks × ~30 units, which replays in milliseconds. Orders are applied at the tick the server receives them, so latency is a real cost. Vercel functions cap at 300 s (Hobby) / 800 s (Pro), so no function owns a match.

Biggest technical risk: chat clients (Claude.ai, ChatGPT) only act during a turn. One `wait_for_event` loop must keep one turn alive for the whole match. Spike this first.
