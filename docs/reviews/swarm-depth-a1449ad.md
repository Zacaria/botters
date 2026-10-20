# Botters swarm-depth re-review — CHANGES_REQUESTED

Candidate: `a1449ad357b3a295304c0aed1dc8760450280b3e`
Tree: `a5e85d22dcc2a524c5e84e058703ac0b38e55f2a`
PR: https://github.com/Zacaria/botters/pull/18 (base `pvp-online`)
Repair base: `00fc4b6c4aa6574dd38072143984a9dceb27f1e7`
Review card: `t_4c176b13`

## Verdict

The four original gameplay findings are repaired, including fresh actual-button complete matches in every mode. One release-evidence blocker remains: the normal full browser command and exact-head GitHub CI both fail because tests share and exhaust the legitimate lobby-creation quota. This is not evidence of a new production gameplay defect; do not weaken production rate limiting to fix the tests. No PASS, merge or deployment approval is issued.

## Required correction

1. **P2 — New mode coverage makes the full browser suite depend on the wall-clock rate-limit window.** `e2e/mode-picker.spec.js:6-20,44-47` creates six additional sessions against the same local backend as the rest of the suite; `playwright.config.js:5-7` shares one harness. The unchanged legitimate guard at `online/http.js:43-48` permits 20 new lobbies per IP per ten-minute `Date.now()` bucket. The accelerated game clock does not accelerate that bucket.

   Fresh `npm run test:browser` returns **48 passed, 1 failed**. `e2e/result-sharing.spec.js:104` fails in `enter` at line 17 because the second room player cannot reach PLAY. The trace records `POST /session` returning HTTP **429** and `{"error":"Too many new lobbies. Retry in ten minutes."}`. Exact-head GitHub run https://github.com/Zacaria/botters/actions/runs/39381720426/job/118492106733 fails at precisely the same assertion, also 48/49. Running only `--grep 'real room draw'` with a fresh harness passes. A prior all-green run can occur when the suite crosses a wall-clock bucket boundary and does not establish reliable isolation.

   Required delta: isolate test lobby budgets/backends (or otherwise make local test setup independent of wall-clock buckets) without skipping assertions, adding retries as a substitute, or relaxing production anti-abuse checks. Preserve actual-button mode, queue/room and result-sharing coverage. Obtain a fresh complete browser pass and green exact-head CI for the replacement signed candidate.

## Verified repairs and checks

- `npm ci --ignore-scripts`: 199 packages; zero reported vulnerabilities.
- `npm test`: **228 passed**, zero failures/skips, including split/merge cooldown and cocoon behavior, simultaneous-kill accounting, all map mode/size combinations over 100 seeds, and full-state morph replay sequences in all four modes.
- `npm run check`: passed, 83 JavaScript files plus inline browser scripts and JSON. No separate lint/type/format tool is configured.
- `npm run test:browser`: **48 passed, 1 failed**, described above. All five new mode/duel tests pass. The isolated result-sharing rerun passes **1/1**.
- `npm run test:auth:browser`: **4 passed**. Expected invalidated-connection denial and socket closure are logged by the rejection test.
- Browser webServer build succeeds. Generated `public/index.html` and `public/sim.js` match source bytes. `git diff --check` passes.
- Independent Brave full matches: select mode with actual buttons, verify stored string, reload, start, verify exact actual mode and 16 planets, use P/L/C successfully on separate own swarms, reach the result report. All four modes complete with **zero pageerror events**. 2v2 has allied swarms; opposing-team totals number 1/1/3/5 for 1v1/2v2/ffa4/ffa6. Hunger values and rings are present. Screenshots inspected for all four modes: camp hues and own circle/triangle/square badges are distinguishable; long HUD text clips as in the prior review, but no additional release-blocking visual defect is demonstrated.

## Identity and boundaries

GitHub confirms the commit signature valid. PR head matches the exact candidate. Candidate checkout is clean and SHA/tree unchanged before and after review. Tests/builds/probes run only in an exported archive at this directory; all **175 tracked files** compare byte-for-byte with the candidate after testing. Source was not edited. No files were deleted. No production calls, room count, publication or deployment were performed.

Reviewed scope combines the original candidate's allowlist (`DESIGN.md`, `README.md`, `client.js`, `index.html`, `online/game.js`, `server.js`, `sim.js`, `test/online.test.js`, `test/sim.test.js`) with the repair's scoped additions (`docs/reviews/swarm-depth-00fc4b6.md`, `docs/reviews/swarm-depth-repair.md`, `e2e/mode-picker.spec.js`, `test/swarm-invariants.test.js`). No separate Convex Vitest suite or remote online verification was run; the repair does not alter those backends.

## Evidence

All paths below are relative to `/srv/hermes-ssd/workspaces/botters/t_4c176b13-a1449ad-review`:

- `review-install.log`, `review-npm-test.log`, `review-check.log`, `review-playwright.log`, `review-auth-browser.log`
- `review-ci-failed.log`, `review-result-sharing-rerun.log`
- `test-results/result-sharing-real-room-d-dd592--report-or-private-room-URL/trace.zip` and `error-context.md` (contains 429 denial)
- `review-browser.mjs`, `review-browser-results.json`, `review-browser.log`, `review-browser-server.log`
- `review-play-{1v1,2v2,ffa4,ffa6}.png`, `review-ended-{1v1,2v2,ffa4,ffa6}.png`

Next: owning builder repairs only test isolation and returns the new signed exact candidate; independent review must remain unsatisfied until PASS. The authorized release lane must still check zero active Lightsail rooms immediately before deployment after PASS.
