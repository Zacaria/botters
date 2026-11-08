# Feature regression coverage

This is a living feature-to-test map, not a claim that every test passed on the current revision. Update it whenever a feature or its observable behavior changes. Link the test that exercises the actual player or agent path; mark missing coverage explicitly. A feature may have unit, integration and browser tests, and a browser test can still use fixtures or mocked failures.

## Commands

- `npm test`: Node tests in `test/*.test.js`, including simulation, service integration and some real-browser tests. It is not a unit-only count.
- `npm run test:browser`: Playwright `e2e/` tests, excluding `auth.spec.js`; the local setup builds the app.
- `npm run test:auth:browser`: separate browser authentication suite.
- `npm run test:auth:convex`: Convex integration suite.
- `npm run test:online`: scripted MCP clients against the configured server; creates a match. Do not point it at production without authorization.

The PR workflow runs the Node and both browser suites. Check each run's output for failures, skipped cases and environment requirements; an inventory entry is not proof of a passing run.

## Feature map

| Feature / user journey | Existing regression coverage | Known boundary |
| --- | --- | --- |
| First visit, public explanation and policies | `e2e/public-demo.spec.js`, `e2e/public-pages.spec.js`, `test/public-pages.test.js` | Does not measure comprehension or retention. |
| Local lobby, start, controls and reconnect | `test/offline-browser.test.js`, `test/local.test.js`, `e2e/narrow-map-layout.spec.js` | Local server; not deployed PvP. |
| First-match guidance | `test/guided-first-match.test.js` | Local guidance; not a full new-player online journey. |
| Match simulation, combat, vision, gambits and replay | `test/sim.test.js`, `test/golden-sim.test.js`, `test/swarm-invariants.test.js` | Deterministic engine assertions do not establish game balance. |
| Manual route prototype: select, draw, send, progress and cancel | `test/offline-browser.test.js`; `e2e/online.spec.js` (two-browser route and reconnect, fixed seed and controlled server clock); `test/route.test.js`; `test/local.test.js`; journal and replay in `test/online-regressions.test.js` | Shift-drag is mouse-only. The two-browser and replay tests use isolated local services; the separate real-time test does not exercise the route. The two-browser model comparison uses the same simulation as the server, so it is not an independent simulation oracle. |
| Modes and room/queue play, reconnection, surrender and rematch | `e2e/mode-picker.spec.js`, `e2e/online.spec.js`, `test/online.test.js`, `test/live-wire.test.js` | Fixtures exercise local services; not proof of the production deployment. |
| Result and sharing | `e2e/result-sharing.spec.js`, `test/offline-browser.test.js` (surrender) | Clipboard failure uses a simulated failure. |
| Account, verification, agent approval and revocation | `e2e/auth.spec.js`, `integration/auth.test.js`, `test/accounts.test.js`, `test/mcp-auth.test.js` | Auth browser suite has its own configuration and must be run separately. |
| MCP, tool calls and authorization | `test/web-mcp.test.js`, `test/mcp-oauth.test.js`, `test/mcp-auth.test.js` | Local and fixture-backed; scripted clients do not prove real-model strategy. |
| Client installation and guide | `test/install.test.js`, `e2e/install.spec.js`, `e2e/guide-targeted-install.spec.js` | Does not establish behavior of every external client version. |

## Adding a feature

1. Add its user-visible journey and test location to the map; state any boundary or missing scenario.
2. Exercise deterministic domain behavior and service integration where relevant. Add a real-browser journey when the feature depends on browser interaction, rendering or end-to-end behavior; verify the resulting server state, not only the click.
3. Run the relevant tests and report exact commands, pass/fail/skip counts and fixture limits. Do not infer a production or PvP pass from a local fixture.
