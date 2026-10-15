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

- Vercel functions are not long-lived; a 5–8 minute match outlives a single invocation unless Fluid compute with `maxDuration` ≥ 600 s is used, and instances are not shared. Pick and justify one of: (a) stateless replay per request from an input log stored in a durable store (Convex or Upstash/Redis; ticks derived from wall clock since `startsAt`), (b) a long-running function per match with a store for fan-out, or (c) another option measured to work. Measure p95 request latency and replay cost at 8 minutes, 40 planets, 40 swarms per side.
- Browser updates must stay ≥ 10 frames/s with smooth interpolation (the client already interpolates between frames).
- Agent long-polls must work under function duration limits (return on timeout; the client already re-polls).
- No paid model inference on the server. No secrets in the repo or client.
- Keep the local offline mode working unchanged (`npx` → localhost).

## Acceptance

- Two real browsers on two machines/networks: matchmaking pairs them, a full match runs, both see the end report.
- Custom room: create, share code, join, start, finish, rematch.
- Two MCP agents (`client.js` with `BOTTERS_SERVER` set to production) play a full match online.
- Disconnect and reload during a match resume the same match.
- Tests: `npm test` plus a scripted two-client online test that can run against a preview deployment.
- Public URL documented in the guide; the static guide at `https://botters.vercel.app` becomes the game's home.
