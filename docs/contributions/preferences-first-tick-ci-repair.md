# Preferences first-tick CI repair (neutral maintenance)

Task: t_a2c1d92e. Native Hermes; no CE, Superpowers or pstack workflow.
Bound base: d1dd34026b1e5d9d3001ceade995ca6244965993.

## Acceptance and decision (before implementation)

Repair only the preferences test's first-frame synchronization. Keep all 17
subcases, the strict positive-tick assertion, opening/settings checks, unchanged
raw storage checks, real session/map continuity and advancing ticks after reload.
No product, server, engine, CI, configuration or dependency changes. This is not
a product contribution and does not publish or integrate PR13.

Original RED: CI run 39248127903, `valid disabled strategy`, assertion
`assert.ok(first.view.tick > 0)` at test/offline-browser.test.js:569.
The original full log is retained unchanged in the wrapper with SHA-256
635dc1d3f3e01ad6a332aca0a6b1cf4095f04ca35ddf4dec1f81cd8fb111cd90.
Its failure is evidence; a local pass must not be called a local RED.

## Diagnosis

`sim.js` creates matches at tick zero. `server.js` startMatch initializes the
match before scheduling `step` with setInterval at 1000 / TPS (20 Hz). The
fixture's BOTTERS_START_DELAY=1 does not execute that timer synchronously.
The initial SSE frame and `/state` can therefore expose a valid match before
its first timer callback; a HUD containing `swarms` is not a positive-tick gate.
The existing reload check already uses `expect.poll` on the real `/state` tick,
as does the primary map-input regression earlier in this same file.

Reuse that bounded polling idiom immediately before capturing `first`. Do not
weaken `> 0`, inflate timeouts, add a fixed sleep, fake a frame or change the
engine. A server stuck at zero must still fail the polling condition.

## Verification plan and boundaries

Preserve the CI RED, attempt the unmodified preferences test locally, and record
any intermittency honestly. Observe the real initial zero over loopback HTTP;
exercise the native planning period as a zero-throughout-deadline negative
control, without substituting synthetic game-state responses or stopping HTTP.
Run all 17 preferences cases, the full affected browser file plus guided tests,
applicable local suites, syntax and build under bound Node 22, short TMPDIR,
isolated HOME/cache and the shared fixture lock. Keep raw logs in the wrapper.
Use only the existing read-only dependency link and wrapper build link.

Only this note and test/offline-browser.test.js may change. Check every other
tracked blob against the bound base and source manifest. Deliver a signed local
commit, exact tree, recoverable verified bundle and 64-hex evidence manifest.
No push, PR, merge, deployment, live backend, contact or shared dependency writes.
Offline state exposes no public matchId: unchanged real session, immutable map,
no duplicate session/play POST and advancing ticks are the existing continuity
proof, not a fabricated match identifier. Independent review remains external.

## Executed evidence and limitations

The unchanged local preferences run passed all 17 cases (18 Node results with
the parent), so the intermittent CI assertion failure was not reproduced by that
browser run. A separate real loopback probe with the identical 1 ms fixture
delay observed `/state` at tick 0 with three swarms, then tick 2 after the normal
bounded poll. This observes the real initial state, not a fabricated local RED
or a claim to have captured the HUD race locally.

The negative probe used the existing native 10-second planning period, leaving
HTTP responsive and the real engine unchanged. The unconfigured default
`expect.poll(...).toBeGreaterThan(0)` rejected at its 5000 ms deadline with eight
real zero observations. This proves zero cannot satisfy the bounded condition;
it does not claim to have run an infinitely stalled engine. The retained strict
`assert.ok(first.view.tick > 0)` also remains unchanged.

Executed under Node v22.23.3, Brave, the bound short TMPDIR, isolated HOME/cache
and shared fixture lock:

- Targeted preferences: 18/18 PASS, covering all 17 subcases.
- Full offline browser plus guided-first-match files: 35/35 PASS.
- `npm run check`: PASS (81 JS files, inline scripts and JSON).
- `npm run build`: PASS (8 public assets plus existing live bundle/config).
- `npm test`: 174/174 PASS, no failures or skips.
- `npm run test:browser`: 42/42 PASS, local ephemeral fixtures only.
- `npm run test:auth:browser`: 4/4 PASS. The rejected-socket diagnostic is from
  the existing authorization negative case, not an unhandled test failure.
- Additional local Convex integration attempt: unavailable on this bound checkout.
  All three files fail because `convex/_generated` is absent (two import failures,
  one executed test failure). No codegen, backend access or dependency install was
  attempted. The wrapper config reuses native Vitest settings and relocates only
  cache, with config runner and cache disabled to avoid shared dependency writes.

Raw logs, the original CI failure, probe source and exact commands are retained
in the task wrapper's evidence directory. A shell environment persistence
assumption initially selected system Node 24 and a nonexistent `/evidence` path;
that command failed before running any probe. The successful probe and checks
use the explicit bound runner; the setup failure is not hidden as a test result.

The patch adds only one comment and the existing bounded polling idiom before
the first read. It removes no assertions or cases, and adds no dependency,
sleep or timeout override. Product-byte identity, scoped signature and bundle
recovery are recorded separately with the exact committed candidate/tree.
No remote CI rerun, independent review, publication or integration is claimed.
