# Botters swarm-depth independent review — PASS

Review task: `t_4c176b13`
Approved candidate: `bb249e1c6bcb8670751ffc935012e41c530b1ae3`
Approved tree: `c31dca916ca1ab94237f7c759c57253e2ccba4b5`
PR: https://github.com/Zacaria/botters/pull/18 (`feat/swarm-depth` → `pvp-online`)
Repair base: `a1449ad357b3a295304c0aed1dc8760450280b3e`
Repair binary-diff SHA-256: `afc5b91aa1c271a62cb875b6e2ad6cd65af94672e3676b677f696df0d95b0515`

## Verdict

PASS for this exact signed candidate. No release-blocking finding remains. All four original gameplay findings and the subsequent browser-suite quota-isolation blocker are resolved. This is independent candidate approval, not a claim that production was deployed. The release operator must preserve exact identity and satisfy the zero-active-Lightsail-room condition immediately before deployment.

## Reviewed scope and closure

The original ten-path swarm-depth allowlist and its gameplay repair were reviewed in the retained `swarm-depth-00fc4b6.md` and `swarm-depth-a1449ad.md` reports. This round inspected the exact sixteen-path isolation repair. The two new review documents, `e2e/fixtures.js`, `e2e/build.js`, `e2e/backend-isolation.spec.js`, eight existing browser spec imports, README, PR-CI documentation and Playwright configuration are the only changes since a1449ad. A programmatic allowlist check passes. All assertions in the eight existing specs are byte-identical after their import lines; selected runtime, anti-abuse and dependency files are unchanged. Source and regressions for simulation restrictions, map totals, combat accounting, replay and online result/room/duel mapping were re-read.

- Mode selection: real clicks preserve each mode as a string, survive reload and start the actual selected mode. Numeric settings stay numeric; queue/private rooms stay duels after ffa6 selection.
- Morph restrictions: split and merge retain active cocoon/cooldown; movement and early remorph behavior regressions pass.
- Kill attribution: simultaneous attackers share actual available kills; over-credit, nonnegative population/belly and deterministic replay regressions pass.
- Map size: all twelve mode/size combinations assert exact totals and mirrored resources over 100 seeds each.
- Browser isolation: every local test receives a separate loopback subprocess and in-memory store; contexts within one test share its origin. Startup waits for that child's own readiness message, teardown is awaited, and configured durable local storage is refused. Production quotas and clocks are unchanged. The regression reaches the legitimate HTTP 429 and the following test receives a fresh budget. No assertion skips or retries substitute for this repair. Explicit remote-origin behavior and the auth suite remain separate.

## Fresh independent execution

Run from an exported candidate, using Brave and locked dependencies:

| Check | Actual result |
| --- | --- |
| `npm ci --ignore-scripts` | 199 packages installed; audit reported zero vulnerabilities |
| `npm test` | 228 passed; zero failures/skips |
| `npm run check` | 86 JavaScript files plus inline scripts and JSON passed |
| `npm run test:browser` | 51 passed in 6.2 minutes; zero failures/skips; includes quota and previously failing result-sharing room/rematch tests |
| `npm run test:auth:browser` | 4 passed; expected invalidated-connection denial/socket-close logs |
| Isolation regression repeated three times with three workers | 6 passed; not retries |
| Production-config build | Passed with `BOTTERS_LIVE_URL=https://play.botters.havesomecode.io` and `BOTTERS_REQUIRE_ACCOUNT=1`; exact generated configuration and source/public HTML/simulation comparisons passed |
| `git diff --check` | Passed |

An interim diagnostic inspected generated live configuration while local test builds were replacing it and saw the expected local null origin. After all browser builds completed, a fresh explicit production build and immediate configuration comparison passed. This was generated-output sequencing in the review copy, not candidate source drift or a production defect.

## Fresh gameplay and visual evidence

Independent Brave probe selected each mode through actual buttons, checked stored preferences, reloaded, started it with exactly 16 planets, successfully used P/L/C on three own swarms, and completed all four matches to reports with zero pageerror events. Team mode exposed allied swarms and one opposing team; ffa4/ffa6 exposed three/five opposing teams. Hunger values included 1.0 and 0.74; `index.html:744–747` draws the observed orange-red rings from those values. All four gameplay screenshots were inspected.

Camp hues and circle/triangle/square badges remain distinguishable when visible. The ffa6 mid-match capture correctly has no surviving own swarms, while its earlier keyboard/state evidence proves the three successful type changes. Continued play until remaining house teams finish is consistent with the last-team-standing rules. Planet HUD counts exclude depleted/neutral planets; circles on the map are not a reliable count of owned live planets (`index.html:753–755,827–830`). Fog/range shading and long HUD text clipping persist as previously observed; no new release-blocking visual defect was demonstrated.

## Exact-head remote evidence

Git signature verifies locally and GitHub reports it valid. Before and after review, PR #18 points to the approved SHA. Required `Botters local checks` is SUCCESS for that SHA:

https://github.com/Zacaria/botters/actions/runs/39384790056/job/118501942715

The run's head SHA matches. Downloaded logs report 223 Node passes plus five ffmpeg-unavailable skips, 51 browser passes and four auth-browser passes. The independent local run above passed all 228 Node tests without those skips.

## Integrity and boundaries

All 180 tracked exported files compare byte-for-byte with the approved Git objects after testing. The shared source checkout was intentionally left at clean a1449ad throughout; this review did not checkout or edit that workspace. Candidate SHA/tree and repair fingerprint are fixed. No source files were edited, deleted, committed or pushed. Build outputs, probes and logs are confined to the review export. Review browser contexts and owned servers were closed.

No production calls, active-room query, deployment, publication, hosted accounting window, real-client installer rerun or separate Convex Vitest rerun was performed. Convex/auth-storage implementation and dependencies are unchanged by this isolation repair; the implementer's component-test evidence is labeled separately in its Git receipt and is not represented as fresh reviewer execution. No lint/type/format command is configured beyond the repository syntax check.

## Retained evidence and next action

Evidence directory: `/srv/hermes-ssd/workspaces/botters/t_4c176b13-bb249e1-review`.

`review-evidence.zip` contains this report; identity manifest; install/Node/syntax/build/browser/auth/stress/CI logs; independent browser probe, results and server log; and four play plus four result screenshots. The report and archive are delivered on the review task. Candidate source remains retained on the signed remote PR ref; archive outputs are not source commits.

Next: release role consumes this exact PASS and the current owner authorization recorded on the review task, checks current protected refs/checks and zero active Lightsail rooms immediately before deployment, then verifies deployed identity and player-facing behavior. Do not deploy this review export, override branch protection, replace newer work, infer an unperformed production check or transfer this PASS to changed implementation bytes. Preserve review/release receipts on a separate evidence ref through the owning release role, without changing the approved candidate.
