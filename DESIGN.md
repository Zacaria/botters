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

## Proposal under review (2026-10-13): three clocks

| Layer | Speed | Does |
|---|---|---|
| Human (browser) | every 10–30 s | Intent: map pings, drawn zones, short orders |
| Agent (MCP) | every 2–10 s | `wait_for_event` → read state + human orders → rewrite bot |
| Bot (server) | 10 ticks/s | Moves the 12 units |

Hosting: no server tick loop. The simulation is deterministic: match state = f(seed, timestamped bot edits). Convex stores only the event log; the MCP server (Vercel, `mcp-handler`) and each browser replay it to the current tick. A 10-minute match is 6,000 ticks × 24 units, which replays in milliseconds. Vercel functions cap at 300 s (Hobby) / 800 s (Pro), so no function owns a match.

Biggest technical risk: chat clients (Claude.ai, ChatGPT) only act during a turn. One `wait_for_event` loop must keep one turn alive for the whole match. Spike this first.
