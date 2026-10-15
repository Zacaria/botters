# PvP release state

## Status: implementation candidate; production promotion blocked

Task: `t_65971d2d`, branch: `pvp-online`. Production https://botters.vercel.app still serves the original guide. It has not been promoted to the online game.

The dedicated free Upstash store cannot yet be provisioned: the Vercel CLI returned `integration_terms_acceptance_required`. Owner acceptance is tracked separately on `t_c9683a14`:

https://vercel.com/zacaria-chtatars-projects/~/integrations/accept-terms/upstash?source=cli

No terms were accepted by the builder, no paid plan selected, and no automatic upgrades enabled. Existing unrelated Neon resources were not changed. No credentials are committed. Missing Redis configuration returns 503 rather than using ephemeral state.

## Verified locally

Fresh verification after the final runtime edits: `npm test` **29 passed**, `npm run test:browser` **3 passed**, `npm run check` **21 JS files plus inline scripts/JSON passed**, `npm run build` **3 assets**, `npm audit --omit=dev` **0 vulnerabilities**, actual Redis integration **PASS**, and a fresh two-MCP match at local clock ×10 **PASS** (21,856.70 ms; streams 12.24/12.21 fps). The real-clock run below is separate evidence, not a claim that the accelerated run lasted three wall-clock minutes.

- Deterministic simulation/offline server unchanged. Baseline and online tests cover fog, role capabilities, 5/s shared input limits, concurrent matchmaking/room admission, idempotent agent attachment, private openings, canonical bounded log chunks, exactly-once Elo/history, new-instance resume, sliding expiry, origin/body checks and request deadlines. An offline house match is exercised against the unchanged local server.
- Three Brave scenarios use isolated contexts: matchmaking/cancel/full finish/disconnect/reload; room link/start/full finish/rematch; invite preserves an agent-connected player's saved solo/opening preferences. These use the explicitly accelerated local clock (×10), not two physical machines or networks.
- Two actual `client.js` MCP processes completed a full three-minute/40-planet match at real clock speed, including planning: 201,906.94 ms wall time. Both reported a 20,232–20,232 draw. Two 40-frame streams measured 12.50 and 12.46 fps; 36 local HTTP samples gave p95 29.45 ms. Raw summary: `pvp-local-verification.json`. No inference was invoked.
- `scripts/test-redis.js` passed against Redis 8.0.2 using a local redis-cli REST bridge: actual Lua multi-key CAS, concurrent matching, shared rate limiting, exactly-once result/Elo/history, new RedisStore-instance resume. This is not an Upstash latency measurement. Docker was unavailable to this user; Debian Redis binaries/libraries were extracted under ignored `.cache/redis`, without system installation.
- Capacity CPU fixture: eight-minute/40-planet/80-swarm replay p95 3,542.86 ms; two-tick checkpoint decode/step/encode p95 2.88 ms. An additional 100-sample localhost HTTP capacity fixture at a synthetic 479.5-second checkpoint measured p95 14.15 ms using MemoryStore. Raw data: `pvp-benchmark.json`, `pvp-http-benchmark.json`. Neither fixture proves Vercel/Redis latency.

`npm run check` syntax-checks JavaScript, inline browser scripts and JSON. The project has no separate lint, type or formatter configuration; none is claimed. `npm run build` emits only `index.html`, `guide.html`, and `sim.js`. `npm pack --dry-run --json` verifies the local npx package contains its runtime assets and excludes server credentials, online internals, fixtures and caches. `git diff --check` must pass before committing.

## Preview evidence

Initial preview (before the final UI label/test-only changes):

- URL: https://botters-1pufo92m4-zacaria-chtatars-projects.vercel.app
- ID: `dpl_9Rpc3BARzcJLPbAGu3zgRC8Jdcv9`
- Readback: READY; Node API in iad1; `/rules` returned the online protocol, `/r/ABCDEF` and `/guide` returned 200, `/session` returned 503 with `Online storage is not configured.` and no-store/no-referrer headers.
- Deployment protection remains enabled. `vercel curl` used its supported project bypass for verification; no bypass credential is in this document or Git.

The final source-pinned preview is recorded below after deployment. No preview full-match result is claimed without durable storage.

## Exact continuation

1. After the owner accepts the Upstash terms, run the free-only provisioning command from `t_c9683a14`. Connect its server-only REST URL/token to this Vercel project's preview and production environments. Keep eviction and auto-upgrade disabled. Confirm credentials are not in browser artifacts. The adapter supports `UPSTASH_REDIS_REST_URL/TOKEN` and Vercel `KV_REST_API_URL/TOKEN`.
2. Deploy the signed `pvp-online` source candidate as a preview. Run `npm test`, `npm run check`, `npm run build`, `BOTTERS_SERVER=https://PREVIEW npm run test:browser`, and `BOTTERS_SERVER=https://PREVIEW npm run test:online`. These test runners and the MCP process support `VERCEL_AUTOMATION_BYPASS_SECRET` for protected `*.vercel.app` previews; inject it privately into the test process, never public files. Remote browser traces are disabled to avoid persisting the bypass header. The protected full-match path has not been exercised yet.
3. Measure live request p95 and streaming cadence at eight minutes/40 planets/40 swarms per side. Local CPU and MemoryStore measurements are not substitutes. Confirm the function/store budgets support at least 10 delivered frames/s.
4. Exercise the two-machine/two-network acceptance flow. The same-host browser/MCP tests are not this acceptance. Verify both end reports, room finish/rematch, reload recovery, and persisted Elo.
5. Only after preview checks pass, promote the exact preview, repeat production acceptance/readback, verify https://botters.vercel.app is the game home, then hand the card to review with exact signed commit/deployment IDs.

There are no database migrations or deleted source files. The obsolete guide-only Vercel build command and guide's public-game-link hiding code were replaced. Generated assets, dependency caches and test traces are ignored, not committed.
