# PvP release state

## Status: Convex replacement in progress; production not promoted

Task `t_65971d2d`, branch `pvp-online`. Production https://botters.vercel.app still serves the original guide. The owner selected a new dedicated **free** Convex project `botters` on 2026-10-15. No paid plan, inference, or automatic upgrades are authorized. This document supersedes the old storage provisioning gate.

## Architecture and checks

Vercel serves the authoritative deterministic simulation. Convex stores checkpoints, role-scoped session capabilities, chunked canonical input logs, room/queue state, history and casual Elo. `ConvexStore` preserves the get/commit contract: one internal query reads an unexpired value and one internal mutation atomically compares all expected values before changing any. Missing configuration fails closed. Preview/production namespaces are separate. Convex TTL is checked synchronously on reads and commits; a bounded internal cron physically removes expired records.

`CONVEX_URL` and `CONVEX_DEPLOY_KEY` belong only in server-side Vercel environments and ignored local env files. No deploy credentials or bearer tokens belong in browser assets, Git, test artifacts, reports or logs. Backend functions are internal and require deployment-admin authorization. Local offline `sim.js` and `server.js` remain unchanged. No data migration is needed because the public online service has not launched.

Run `npm test`, `npm run test:browser`, `npm run check`, `npm run build`, `npm audit --omit=dev`, `npm pack --dry-run --json`, and `git diff --check`. There is no separate lint/type/formatter setup; do not claim one. `node --env-file=.env.local scripts/test-convex.js` exercises the actual configured backend (not a mocked response): multi-key atomicity, concurrent matching, shared 5/s limits, exactly-once Elo/history and new-instance resume.

## Historical evidence (not current Convex verification)

Signed previous source `08412b2413e80f165a2f3995c191f8b640717c9d` and evidence-only `ae2cfe31d8c821b19b3ee348c6643f20b72fb82f` passed 29 unit tests and 3 isolated Brave scenarios. Two actual MCP processes completed a real-clock three-minute/40-planet local match in 201,906.94 ms at 12.50/12.46 fps. These were local tests, not two machines/networks or live Convex/Vercel measurements. Raw summaries: `pvp-local-verification.json`, `pvp-benchmark.json`, `pvp-http-benchmark.json`.

Previous source-pinned preview: https://botters-18hrciezh-zacaria-chtatars-projects.vercel.app (`dpl_4axEQvMWJTd5wxyfPiKdsh8GHXiY`). It was READY but returned 503 for sessions because storage was absent. Static assets matched the previous candidate after removing Vercel's exact HTML toolbar trailer; `sim.js` matched byte-for-byte. See `pvp-preview-verification.json`. It is not the current release candidate.

## Continuation

1. Provision the dedicated free Convex project; deploy its schema/functions; configure and read back server-only preview/production Vercel environments. Confirm public assets exclude secrets.
2. Deploy the signed candidate to preview. Run all local checks plus `BOTTERS_SERVER=https://PREVIEW npm run test:browser` and `BOTTERS_SERVER=https://PREVIEW npm run test:online`. Protected previews support privately injected `VERCEL_AUTOMATION_BYPASS_SECRET`; remote traces remain disabled.
3. Measure live HTTP p95 and delivered stream cadence with an eight-minute/40-planet/40-swarms-per-side fixture. Local CPU/MemoryStore fixtures are not substitutes; require at least 10 delivered frames/s.
4. Exercise two browsers on two machines/networks, room finish/rematch, disconnect/reload, both end reports and persisted Elo. Same-host isolated browser/MCP tests must not be called two-network acceptance.
5. Promote only after preview checks pass, repeat production acceptance/readback, verify https://botters.vercel.app is the game home, and hand the exact signed commit/deployment to review.

No source database was deleted or reset. The obsolete durable adapter and its provider-specific test are replaced, not retained as compatibility code. Build outputs, dependencies, credentials and traces stay ignored. Existing build warnings: Node `>=22` permits future major upgrades; Vercel injects an unknown npm `cache-dir` setting. Neither was suppressed.
