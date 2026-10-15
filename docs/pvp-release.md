# PvP release state

## Status: preview verified; two-machine acceptance pending

Task `t_65971d2d`, branch `pvp-online`. Production https://botters.vercel.app still serves **Botters · plug your agent**, the original guide (HTTP 200 read back). It has not been promoted to the game.

Runtime candidate: signed `e0bb1b3578683886926c190e3a4cd96a78534526`, pushed and read back on `origin/pvp-online`. Preview https://botters-bjufeb6ce-zacaria-chtatars-projects.vercel.app is READY, deployment `dpl_J8CDHXNBqZZZLf9eMAy49tQ2JL8y`, API in iad1. Later evidence-only commits do not change its runtime source.

The owner-side scope correction on `t_ee4ad7df` requires **two physical machines, Linux + Mac**, not separate networks. Shared egress is a limitation to record, not a blocker. Same-host browser contexts still do not satisfy this gate. Release QA is assigned that existing host pair; no new infrastructure or spending is needed.

Staged production is also READY: https://botters-bzspc5sus-zacaria-chtatars-projects.vercel.app, `dpl_8NGD6iBZSoiG5aq7msqJj2W4SjZJ`, target Production, API iad1. It was built from signed evidence-only `0bf8c077b1a8f405c49066d39d7dace2cf085dc9` with identical runtime bytes to `e0bb1b3`, using `--prod --skip-domain`. Vercel assigned its generated team alias, but **botters.vercel.app still points to the old guide**. No public-domain promotion is claimed.

## Dedicated free Convex resource

- Team `botters` (548276), project `botters` (3220896), deployment `fastidious-kookabura-364`, US East/Northern Virginia. Dashboard: https://dashboard.convex.dev/t/botters/botters/fastidious-kookabura-364.
- The existing Havesomecode team is Professional. The newly created empty project was transferred to the new dedicated free Botters team **before** deployment. Current subscription readback is `null`; no paid plan or upgrade was selected. No unrelated projects were modified.
- `CONVEX_URL` and sensitive `CONVEX_DEPLOY_KEY` are configured for both Preview and Production in Vercel project `botters`; targets/types were read back. Neither uses a public/client-prefixed name. Local `.env.local` and `.env.verify` are ignored private files; never print or commit them.
- Backend readback confirms only internal get/commit/expire functions. Unauthenticated invocation is denied. Missing configuration fails closed with 503. Preview/production use separate namespaces. A bounded internal cron removes expired records, while reads/CAS enforce expiry immediately.

## Verified on the runtime candidate

| Check | Actual result |
| --- | --- |
| `npm test` | 37 passed; deterministic/offline tests included |
| `npm run test:browser` | 4 isolated Brave scenarios passed at local clock ×10 |
| `BOTTERS_SERVER=PREVIEW npm run test:browser` | 4 passed at real clock speed in 9.1 minutes: transient-503 recovery; matchmaking/cancel/disconnect/reload/both reports; room link/start/finish/rematch/history; private opening and solo preference preservation |
| Actual configured Convex integration | Atomic multi-key CAS, no partial writes, one concurrent winner, TTL/read-only guards/expired cache, namespace isolation, indexed leaderboard CAS, anonymous denial, concurrent matching, shared 5/s input limit, exactly-once history/Elo and new-instance resume passed |
| Two actual `client.js` MCP processes against preview | Full three-minute/40-planet match, including planning, in 204,631.22 ms. Both saw the 20,232–20,232 draw and persisted history. Streams 12.71/12.62 fps; 36 HTTP samples p95 354.24 ms |
| Live capacity fixture | Actual Vercel iad1 + free Convex: eight-minute/40-planet settings, 40 stationary swarms per side, synthetic late checkpoint at 470 seconds. 50 HTTP samples p95 345.19 ms; two simultaneous 40-frame streams 12.17/12.38 fps. This is not an eight-minute wall-clock match |
| Syntax/build/audit/package | 31 JS files plus inline scripts/JSON passed; 3 public assets built; production dependency audit 0 vulnerabilities; intended 8-file npx package excludes backend, credentials, fixtures and caches |
| Artifact/security checks | All 3 deployed assets match source, allowing only Vercel's exact deployment-specific HTML toolbar trailer; no actual Convex URL/key or bypass credential in browser assets. 57 deployment input files scanned without local env/cache/dependencies or actual credentials |
| Integrity/review | `git diff --check` passed. Independent read-only adversarial review found no concrete remaining blocker and independently ran the 37 tests. It does not replace two-machine acceptance or final production review |

Raw evidence: `pvp-convex-verification.json`, `pvp-convex-assets.json`, `pvp-convex-mcp.json`, `pvp-convex-capacity.json`, `pvp-convex-browser.txt`. JSON summaries pin runtime source/deployment and artifact hashes. All live clients above ran on the Linux host; do not call them two-machine evidence.

Staged-production evidence: `pvp-production-staged.json`, `pvp-production-mcp.json`. All three production-target assets matched byte-for-byte with no credential leakage. A newly created test bearer exists only in `botters:production:`; the production lobby accepted it with 200 and the preview lobby rejected it with 401. Two actual MCP processes completed a real-clock three-minute/40-planet match in 204,254.69 ms with both reports/history, streams 11.97/12.51 fps, 36 HTTP samples p95 448.89 ms. The staged browser's 503 recovery passed, then duplicate full-suite execution was intentionally cancelled to conserve the free allowance; it is **not** reported as a full staged browser pass.

## Free-resource warning

`pvp-convex-usage.json` records a partial usage readback of 73,026 calls and 1.3282 GB database I/O from verification traffic. Free entitlement readback is 1,000,000 calls and 1,073,741,824 bytes of database bandwidth per month. Historical usage is still loading and may understate totals. The provider currently reports `usageState: Default`, not an observed suspension; do not infer unlimited headroom from working endpoints. No paid plan or automatic upgrade was selected. Duplicate staged browser coverage was stopped, prioritizing the required two-machine test.

This is a real free-tier capacity limitation, not another approval gate or a request to buy an upgrade. If the provider actually refuses calls, preserve that error and stop repeated load; do not bypass the quota, move unrelated resources, reset data or choose a paid plan. References: https://docs.convex.dev/production/state/limits and https://www.convex.dev/pricing.

## Reproduced findings and fixes

The first cloud run completed an MCP match but delivered only 8.82/7.44 fps. A later 80-swarm run ended before both streams reached 40 frames, and an agent poll exhausted checkpoint CAS retries. Every-frame competing checkpoint writes were the cause. The final adapter reads bearer/session/checkpoint in one consistent Convex query, projects deterministic subsecond frames read-only, and persists a checkpoint when it is at least one second behind. Inputs, refreshes and results still commit atomically; all read-only records must belong to the same fresh snapshot. Fresh report-log reads bypass speculative caches. Final live capacity and MCP tests pass above 10 fps.

Cloud browser diagnostics found a finished, report-bearing match whose UI had stopped receiving frames. An initial HTTP 503 permanently closes EventSource; the prior label claimed reconnecting without reopening it. A regression test failed with exactly one stream attempt, then passed after adding an explicit same-match retry for permanently closed streams. Stale callbacks and reconnects after leaving/final report are ignored.

Permanent aggregate Elo could exceed Convex's 1 MiB document limit. It is now one record per identity plus an indexed, bounded top-twelve projection; the game overlays at most two pending changes and returns the exact top ten. Tests cover over 1 MiB of aggregate ratings, rating drops and indexed-board CAS without oversized records.

No database was reset or deleted. `sim.js` and offline `server.js` are unchanged from baseline. Deleted `scripts/test-redis.js`; replaced it with `scripts/test-convex.js`. The old durable adapter/Lua and provider references were removed, not retained as compatibility code. Generated bindings, build outputs, dependency caches, credentials and traces remain ignored.

## Exact continuation

1. Finish the two-physical-machine acceptance on `t_ee4ad7df`, using Linux + Mac against the pinned preview. Exercise matchmaking/both reports, disconnect/reload of the same match, room finish/rematch and persisted Elo/history. Record shared egress, not a request for another network. Its earlier attachment 173 records the now-superseded network requirement, **not** a current failure of the two-machine scenario.
2. Reuse the already verified production-target deployment above; no rebuild is needed. Its namespace, assets and complete two-MCP match have been verified. Keep the old guide serving until the actual two-machine gate passes.
3. After that gate passes, run `npx vercel promote https://botters-bzspc5sus-zacaria-chtatars-projects.vercel.app --yes`, then read back the exact assignment of **botters.vercel.app** (current old guide deployment `dpl_4Xs8LQqFGcLSq6Ycw9EM1fXZVKWX`). Alternatively, promoting the preview triggers a production rebuild with production environment variables, so record the **new** production deployment ID and reverify it; never assume preview bytes/environment were simply re-aliased. Vercel reference: https://vercel.com/docs/deployments/promoting-a-deployment.
4. Repeat acceptance/readback on https://botters.vercel.app, including both real MCP clients, reports/history and game-home routing. Confirm the production namespace is separate from preview, then hand the exact signed source/deployment to review.

No separate lint/type/formatter configuration exists; syntax checks are reported instead. Vercel's Node `>=22` future-major warning and injected npm `cache-dir` warning remain unsuppressed. Convex deployment reported an optional CLI update, cross-filesystem temporary-directory advisory and optional AI-files notice; deployments succeeded. No paid inference was invoked.
