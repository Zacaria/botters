# Primary-only map input

## Source-bound contract

Base: `274ef105b3ec72becc6dc9665cd8ae725d613c77` (tree `c9cb6a7b301a7b17c92d7d42e81d571264ce213b`). Task: `t_a299a902`. Only this note, `test/offline-browser.test.js` and `index.html` may change.

The map accepts primary mouse presses only. Right and middle presses must not select a swarm, send an order, switch a swarm from gambits to manual control, or ping the agent. Primary selection, exactly one accepted primary order with the actual transformed destination, keyboard G release, and primary ping remain functional. Existing ended-game and server-side planning/ownership/validation guards stay intact.

## Implementation decision

Filter the native mouse button at the entry of `cv.onmousedown`, before coordinate conversion and all selection/order/ping branches. Reuse the existing handler and native `MouseEvent.button`; do not change `act`, context-menu suppression, engine, server, protocols, Pointer Events, dependencies or other controls.

## Discriminating browser check

Use the existing offline fixture (real loopback server, engine and SSE) and the layout regression's canvas/client coordinate conversion. Start one real house match with optional tutorial disabled and a synthetic hold strategy, wait past planning, and select an automatic swarm using a native primary click. Exercise right and middle separately and retain observations of HTTP input acknowledgements and subsequent real engine state. On the original handler both must demonstrate an accepted order and `manual=true`, not merely a fixture failure. Restore through native G where necessary so both buttons are measured independently.

The same unmodified test must pass after the handler guard. Also exercise secondary selection and ping with no selection; enable the agent UI through the existing local `/next` heartbeat, not an AI model. All interactions after setup use Playwright native mouse/keyboard input; evaluation only reads state, storage and geometry. Never assign engine state, dispatch synthetic events, intercept state/input responses or fabricate acknowledgements.

Positive controls require primary selection, one accepted primary order and exact real destination, G returning to gambits, and one primary `/say` ping. Verify the same session without printing its capability, unchanged planet geometry, advancing ticks and exactly one session/play POST across the entire scenario. Save useful screenshots and sanitized diagnostics outside source.

## Verification and limits

Run the focused RED then identical GREEN driver, the complete offline browser/guided-first-match/simulation suites, syntax check, build and complete existing browser suite (including 390/1440 layout). Serialize shared fixture commands with the assigned lock; use bound Node 22, installed Brave, readonly dependencies, task-owned HOME/TMPDIR and output paths. Preserve doctrine, keyboard/menu/resume, tutorial and narrow-map regressions.

Produce a scoped signed local commit, recoverable bundle and evidence manifest with exact base/candidate/tree and native session identity. No publication, PR, push, merge, deployment, provider/profile mutation, real installation or external contact is authorized. Automated desktop mouse behavior is not touch certification, human preference evidence or adoption evidence. Independent Luna/Sol review and integration remain coordinator-owned.

## Executed local verification — 19 October 2026

- RED on the unchanged base handler: both native secondary presses produced one HTTP 200 `/input` acknowledgement with `ok=true`, actual target `(600,200)` and `manual=true`. Both secondary selection checks changed swarm 1 to 2; both secondary ping checks emitted `/say`. All six discriminating subtests failed as intended; positive controls and same-session/map checks still ran (ticks 1 → 52).
- GREEN after the one-line guard: all seven focused checks passed. Right/middle emitted no requests and left `manual=false`; selection stayed on swarm 1. Primary emitted exactly one accepted order to `(600,200)`, G released it, and primary ping emitted one accepted `/say`. Same session and 28-planet geometry, ticks 1 → 35, exactly one session/play POST each.
- The test file was unchanged between RED and GREEN: SHA-256 `66faa3804b2d83947bd697eb177874535b9a354369d72bf1f245b3447a30f604`.
- Complete affected command `node --test test/offline-browser.test.js test/guided-first-match.test.js test/sim.test.js`: 50 passed, zero failed (includes doctrine and native keyboard regressions).
- `npm run check`: 81 JS files, inline scripts and JSON checked; no separate lint/type/format tool configured. `npm run build`: eight public assets plus the live-client bundle built locally.
- Complete `npm run test:browser -- --output=<evidence>/browser-artifacts --reporter=line`: 42 passed, including all six 390/1440 map-layout cases, guide, local multiplayer and result-sharing checks. No auth-specific suite or full `npm test` is claimed.

Evidence is outside the source checkout in the assigned wrapper's `evidence/` directory: RED/GREEN TAP logs, sanitized observations, screenshots, complete-suite logs, verification timing, manifest and signed candidate bundle. Shared-lock request/acquisition were both recorded at 10:55:41 UTC (sub-second dwell unknown). Node v22.23.3 and installed Brave were used with isolated HOME/TMPDIR and readonly dependencies. npm's update notice was not acted on. Native run 970/session `20261019_105220_f64e93`; provider/token counters are not measured here. Candidate commit/tree and bundle-recovery verification belong to the external manifest, avoiding a self-referential commit ID in source.
