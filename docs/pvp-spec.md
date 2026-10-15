# PvP online: spec (2026-10-15)

Owner request: "build and deploy the server infrastructure on Vercel to make a PvP mode with custom rooms and a simple matchmaking. Complete the PvP mode in the UI." Next after this: arena mode with more than 2 players, so nothing here should hard-code 2 sides where a list costs the same.

## Today

- `npx -y github:Zacaria/botters` (stdio MCP, `client.js`) starts `server.js` on `127.0.0.1:8787` on the player's machine. Human vs house works end to end. "another player" exists only on that local server, so in practice nobody can find an opponent.
- `server.js` holds everything in memory: sessions (human token + agent token), matches stepped at 20 Hz by `setInterval`, SSE frames to the browser at 10 Hz, long-poll events for agents, role-tagged input log, what-if replay report, Elo.
- `sim.js` is pure and deterministic: `createMatch(seed, opts)`, `applyInput`, `step`, `view(s, side)`, `replay(seed, log, opts)`. One cohort match replays 6,000 ticks in ≈0.5 s.

## Target

A public game server on Vercel that both players' local agents and browsers talk to.

1. **Matchmaking:** "Play online" queues the player; the first two compatible players (same length and map, or "any") start a match. Show queue time and a cancel button.
2. **Custom rooms:** "Create room" returns a short code and link (`/r/ABCD`). The host picks the settings; a friend joins by code or link; the host starts. Spectators may open the link read-only (nice to have).
3. **UI:** lobby gets an Online section (Play online / Create room / Join with code), a room screen (players, their agent status, settings, Start), opponent name and setup in the match HUD, a clear disconnect state, and rematch in the same room.
4. **Agents:** the same MCP tools. `client.js` takes `BOTTERS_SERVER=https://…` (or a lobby toggle) and plays online without the local server. The house modes stay available offline and online.
5. **Fairness:** the server is authoritative. Fog is enforced server-side (`view(s, side)`, never the full state). Rate limit 5 agent inputs/s per side. Tokens are unguessable and scoped per session.
6. **Elo** persisted per player name + setup label; leaderboard on the public site.

## Constraints

- Vercel functions are not long-lived; a 5–8 minute match outlives a single invocation unless Fluid compute with `maxDuration` ≥ 600 s is used, and instances are not shared. Pick and justify one of: (a) stateless replay per request from an input log stored in Convex (ticks derived from wall clock since `startsAt`), (b) a long-running function per match with a store for fan-out, or (c) another option measured to work. Measure p95 request latency and replay cost at 8 minutes, 40 planets, 40 swarms per side.
- Browser updates must stay ≥ 10 frames/s with smooth interpolation (the client already interpolates between frames).
- Agent long-polls must work under function duration limits (return on timeout; the client already re-polls).
- No paid model inference on the server. No secrets in the repo or client.
- Keep the local offline mode working unchanged (`npx` → localhost).

## Server decision

Use bounded Fluid SSE/long-poll functions backed by durable Convex checkpoints and an input log. No match belongs to a function instance: each request advances the checkpoint to the tick derived from `startsAt`, applies authorized input, and commits through an optimistic multi-key compare-and-set Convex mutation (a serializable database transaction). Losing requests reload and retry. Reloads, cold starts and instance changes therefore resume exactly the same match; elapsed ticks are never skipped. Browser streams renew after 50 seconds and target 12.5 Hz (80 ms intervals), leaving headroom above the required 10 Hz, with interpolation in the existing renderer. Agents poll within a 45-second bound. A handler-wide 55-second deadline covers initialization, storage calls, CAS retries, stepping and reports, leaving five seconds before the function's 60-second maximum. Session, room membership, queue assignment, result, history and Elo writes share the transaction boundary where needed.

Inputs are canonicalized before application/logging. Unchanged inputs consume the rate budget but do not grow the log. Logs are durable 64-entry chunks, separate from hot checkpoints; normal frames never load the accumulated log. Report reads use checkpoint `logCount` as their optimistic version guard, then replay canonical entries. `/next` returns the same active match idempotently after a lost response. Room settings expose only shared length/map/countdown; each session keeps its own private opening and agent preference. Invite links apply the joining player's saved preferences, not the host's.

`node scripts/benchmark-online.js` measures an explicit 80-swarm capacity fixture, not invented live traffic. On this host (Node 24), 8 runs of 9,600 ticks/40 planets gave full-replay p95 3,542.86 ms versus 2.88 ms for decoding, advancing two ticks and encoding a checkpoint. See `pvp-benchmark.json` for raw measurements. At iad1 list rates, replaying two browsers at 10 Hz throughout eight minutes has an estimated CPU-only cost of $0.605 (linear replay growth); checkpoint CPU is approximately $0.00049. Holding one or two 2 GB Fluid instances for eight minutes adds approximately $0.00283–$0.00565 of memory, excluding store, network, report CPU and invocation charges. These are estimates, not billed/live measurements. Rates: https://vercel.com/docs/functions/usage-and-pricing.

A single 600-second function is rejected: it cannot be the durable authority or guarantee routing to the same instance. Full replay per frame is rejected on measured latency/CPU cost. Checkpoint + log retains deterministic reports without replaying the entire match 20 times per second. Live preview HTTP p95 and observed stream cadence remain a release requirement, not something the local benchmark proves. The owner selected Convex on 2026-10-15; the simulation and get/commit contract are unchanged.

Provision a dedicated Convex project `botters` on a **free** team in the US region near Vercel iad1; never select a paid plan or upgrade. Production and preview use separate key namespaces. `CONVEX_URL` and `CONVEX_DEPLOY_KEY` are Vercel server environment variables only. Only internal Convex functions expose the store, requiring deployment-admin authorization. Absent storage fails closed (503), never falls back to instance memory. One query reads an unexpired record; one mutation checks every expected raw value before writing any changes. Expired records compare as missing. Unchanged guard entries never refresh TTL. A bounded internal cron removes expired records each minute; expiry is enforced at read/commit time independently of cleanup. Sessions and individual bearer tokens expire after seven days without use (sliding expiry is refreshed at most once per minute), matches/logs after one day; Elo has no TTL. Room links contain public codes only; bearer tokens are separate unguessable role-scoped capabilities. Player names/setup are display identities, not verified accounts: Elo is casual and impersonation is possible without account authentication. Match players are a list; the simulation remains the existing two-side engine, ready for a separately scoped arena simulation change rather than duplicated infrastructure.

Local `server.js` and deterministic `sim.js` remain unchanged. The online adapter implements the existing MCP protocol plus room endpoints; the same browser selects controls based on the lobby capabilities.

## Acceptance

- Two real browsers on two machines/networks: matchmaking pairs them, a full match runs, both see the end report.
- Custom room: create, share code, join, start, finish, rematch.
- Two MCP agents (`client.js` with `BOTTERS_SERVER` set to production) play a full match online.
- Disconnect and reload during a match resume the same match.
- Tests: `npm test` plus a scripted two-client online test that can run against a preview deployment.
- Public URL documented in the guide; the static guide at `https://botters.vercel.app` becomes the game's home.
