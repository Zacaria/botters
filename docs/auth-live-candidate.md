# Account-to-live activation candidate

## Boundary

This is the account/Colyseus integration delta above signed base `0ba1f2366c963e04b6098c765878b8dee0855c6f` on `pvp-online`. The source candidate is the signed commit containing this report. The previously approved account source is `e860cfa`; its approval did not cover this new live-session exchange. No production deployment, provider configuration, email sending, alias change or customer-data mutation occurred in this increment.

The website verifies the current Better Auth cookie and mints a one-minute, one-use ticket. An internal Convex mutation validates the real session and verified user again, atomically consumes the ticket and binds the human capability to the live host's `__Host-botters-live` cookie. Cookie values and ticket values are not stored in plaintext. A stolen human bearer or seat reservation cannot bypass the cookie at HTTP or WebSocket admission. Capability authorization reads the real Better Auth component, caps expiry and retains existing fail-closed channel behavior. Each queued action and emitted frame rechecks admission. Independently approved agents remain governed by delegation version and capability expiry, not browser logout.

Agent approval/replacement now adopts the remote presence when delegation version changes rather than preserving stale process-local presence. Private-room preferences, ongoing match membership and locally owned state continue to survive refresh. The pairing panel names the concrete permissions, agent-supplied setup name, seven-day maximum and signed-out behavior, and explains Disconnect agent revocation. Its actual rendered screenshot was checked; the warning is fully visible.

`BOTTERS_REQUIRE_ACCOUNT=1` selects account mode in the live entrypoint. The website's account API issues live tickets; both the live origin and account configuration must be coordinated before activation. Defaults do not activate accounts in the currently deployed anonymous service. The non-Secure fixture cookie is guarded by loopback-only binding and is not used by the production entrypoint.

## Fresh verification — 2026-10-16

- `npm test`: **64/64 passed**, no skips. Includes two real stdio MCP clients through the two-origin fixture, secure host-only cookie attributes, queued revocation, expired/disconnected authority, private preferences, offline SSE and anonymous regressions.
- `npm run test:auth:convex`: **4/4 passed** across three files. Uses the real Convex Better Auth component and production proxy; captured email only. Covers parallel single-use exchange, expiry, unverified users, real logout and password-reset invalidation, and separate agent authority.
- `npm run test:auth:browser`: **3/3 passed** using Brave. Two origins, real library sessions, captured mail, actual Colyseus sockets; signup/verification, wrong password/reset, same-name accounts, pairing, private match/reload/history/Elo, revocation, credentialed CORS, bearer theft, stolen seat reservation and live socket termination after logout.
- `npm run test:browser`: **7/7 passed**. Anonymous entry, reconnect, complete match/report, room/rematch, private openings, public policy documents and narrow layout.
- `npm run check`: passed; **66 JS files**, inline scripts and JSON. No separate lint, type or formatting tool is configured.
- `BOTTERS_LIVE_URL=https://play.botters.havesomecode.io BOTTERS_REQUIRE_ACCOUNT=1 npm run build`: passed. Exact seven-file public allowlist and `{url, accountRequired:true}` verified with Node assertions; no server modules enter the public build.
- `git diff --check`: passed. The account browser theft test intentionally logs a sanitized missing-cookie authorization error and socket close 4002 from the SDK; the test passes because that stolen reservation is rejected.

The two new behavioral suites were run failing before implementation: real session metadata was absent, and live HTTP accepted a human bearer without its cookie. Existing assertions were updated for the internal-only session metadata and the new live account startup prerequisite. No files or production data were deleted; obsolete startup-refusal code and outdated online-SSE documentation were replaced.

## Production observation and remaining acceptance

The read-only production check during this run reported the live service healthy on build `c674ac79e5c5e3defc402387df4b87a39b017a51` with zero active matches; the owned website `/account` returned 404. This report was recorded at `2026-10-16T12:59:22Z`. Production remains anonymous; the idle observation is not a reusable future release gate.

The isolated results do **not** prove real Google consent, external email delivery, deployed cross-host Secure-cookie behavior, real Convex subscription invalidation, or the new account path's production function-call budget. Existing anonymous timed-match measurements do not transfer to the account boundary. Production provider round trips, replayed/expired real links, two verified production accounts and a real match remain unaccepted.

Next release step: obtain an independent adversarial review of this exact signed delta. Then resume `t_d5e91f48` for coordinated authorized preview/provider acceptance and production activation, rechecking zero active rooms and the legacy aggregate gate immediately before replacement. Preserve exact rollback artifacts; deploy Convex only from the reviewed account source, not the separate Vercel-only anonymous release branch. Keep the exact Google callback `https://botters.havesomecode.io/api/auth/callback/google`; do not widen credentials, create paid services, invent a sender or reset data. If real provider access remains unavailable, report only that exact blocker and continue eligible independent email/password work.
