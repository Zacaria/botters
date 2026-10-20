# Browser backend isolation

Repair base: `a1449ad357b3a295304c0aed1dc8760450280b3e`, PR #18.

The independent [re-review](swarm-depth-a1449ad.md) found that the 49-test browser suite shares one backend and exceeds the legitimate 20-new-lobbies/IP/ten-minute limit. The accelerated game clock does not accelerate the wall-clock rate-limit bucket. A run crossing a bucket boundary can pass without establishing isolation.

## Test contract

- Build local assets once, then give each local browser test a fresh `scripts/online-dev.js` subprocess on a reserved loopback port. All browser contexts and the request fixture within one test share that origin, preserving real matchmaking, private rooms, reconnect and rematch behavior.
- Keep the production HTTP handler, rate-limit values, clock and game runtime unchanged. Every backend retains the normal anti-abuse checks; no IP spoofing, reset endpoint, assertion skips or retry-based workaround.
- Tear down each subprocess after its test, including failures. A failed startup must report an error instead of using another running server. Local fixtures refuse a configured durable Convex backend.
- Keep explicitly configured remote verification on its existing origin, without launching a local backend. The auth suite retains its separate two-origin fixture.
- Regression coverage exhausts the normal quota and observes HTTP 429, then verifies the next test has a fresh budget. Existing actual-button mode/persistence, queue/room and result-sharing assertions remain intact.

## Evidence

- Fresh original full-suite run: **49/49 passed** in 5.3 minutes. This run did not reproduce the reviewer's **48/49** result and is not claimed as proof of isolation. The original quota bug is timing-dependent, as the preserved independent report explains.
- New quota regression, before the fixture repair: **1 passed, 1 failed**. The first test reaches the real HTTP 429 guard; the following test expects its first `/session` to return 200 but receives 429. After repair: **2/2 passed**. Three repetitions across three workers: **6/6 passed** (explicit stress run, not retries).
- Fresh complete `npm run test:browser`: **51/51 passed**, zero skips, in 6.4 minutes using Brave. The two additions cover quota enforcement and independent budgets; all eight existing spec files are byte-identical to the base after their import line. Real mode buttons/persistence, queue/room, result sharing, clipboard and native offline SSE assertions are unchanged.
- `npm test`: **228/228 passed**, zero skips. `npm run test:auth:browser`: **4/4 passed** using Brave. Its invalidated-connection test intentionally logs authorization denial and socket closure.
- `npm ci --ignore-scripts`: 199 packages installed, zero reported vulnerabilities. `npm run check`: **86 JS files**, inline browser scripts and JSON pass. No separate lint/type/format command is configured. Production-config `npm run build`, source/public `index.html` and `sim.js` byte comparisons, exact account-required live configuration and `git diff --check` pass.
- Optional `npm run test:auth:convex` initially fails because fresh checkouts omit ignored `convex/_generated` wiring. After verifying unchanged Convex sources and identical Convex/convex-test/Better Auth lock entries against `8840ddb9b77557c430abea27c9a22d312646e8c5`, copied the existing SDK-generated `api.js`/`server.js` from that worktree into this checkout's ignored directory. Rerun: **3 files / 4 tests passed**. No hosted codegen, fabricated responses or deployment.
- Local durable-storage guard rejects `BOTTERS_DEV_CONVEX` before backend startup. Remote-config probe preserves the explicitly supplied origin and disables local build/startup, with no retries configured. Runtime/source and dependency files are unchanged by this repair.

No files deleted. Removed only the shared local Playwright `webServer` configuration and fixed default local origin; replaced them with test-scoped origins and one local asset build. No remote online checks, production room-count query, real-client installer verification or deployment were run. Exact signed candidate, remote readback and exact-head CI are recorded in the task handoff and evidence archive. Independent PASS and a zero-active-room check remain release prerequisites.
