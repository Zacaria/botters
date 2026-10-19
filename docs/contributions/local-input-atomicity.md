# Local input atomicity implementation plan

> Execution: bounded inline implementation of card `t_0b198003`, using the
> supplied design and Superpowers RED/GREEN workflow. Independent programme
> review remains coordinator-owned; this note is not human design approval.

Goal: a refused local `POST /input` must not silently change the simulation.
Architecture: reuse `online/game.js`'s `structuredClone(m.s)` candidate,
apply the existing `applyInput(candidate, side, input)`, and publish the
candidate only on success, before the existing log and notifications.
Tech stack: native Node 22 HTTP tests and existing local browser fixture.
Spec: card attachments `BINDING.json` and
`NEXT-SUPERPOWERS-SCOPE-AFTER-PR12-a84cb9c1.json`, base
`a84cb9c114c9397ae49638bb8024c5f2fae4391c`.

## Constraints and decision

Only this note, `test/local.test.js`, and `server.js` may change. No new
production helper, dependency, engine/online edit, UI change, provider,
account, installation, push, PR, merge, or deployment. Existing guards,
agent rate-budget consumption (including refused requests), response shapes,
canonical log, attribution and notifications remain in their existing order.
Do not import online-only no-op filtering or other validation differences.

The engine applies gambits, toggle, order, split, release sequentially.
The local route currently passes its live state directly, whereas online
validates on a clone. Thus a valid early operation can survive a rejected
later operation without a corresponding accepted-input log entry.

## Review focus

- Both human and agent use the same local route and must reject atomically.
- Disabled gambits, toggle ordering, and coordinate clamping remain intact.
- Valid mixed order/release retains the destination and releases control.
- Refused commands preserve feed, calls and gambit attribution; accepted
  commands retain the existing notifications and human/agent attribution.
- Pre-start refusal and the five-input agent rate budget are not rolled back.

## Task 1: local route transaction boundary

Files: this note (contract/results), `test/local.test.js` (real loopback
fixture and behavioral checks), `server.js:200-232` (candidate boundary).
Interface: `POST /input` returns the existing `{ ok }` / `{ ok: false,
error }`; `/state` exposes the stable game fields used in assertions.

- [x] Reuse the existing real session/match HTTP fixture; wait for tick > 0
  with `BOTTERS_START_DELAY=1`. Reject gambits + `split:-1` with HTTP 400
  and assert unchanged gambits. Run before editing production; expected
  RED is changed gambits, not a transport/startup error.
- [x] Reject valid order + `release:-1`; compare the same swarm's manual,
  tx and ty, not naturally advancing tick/position. Use hold opening for
  stable pre-command targets. Exercise both roles and unchanged metadata.
- [x] Clone state, apply to candidate, assign `m.s` only within success
  before the existing log. Repeat the same tests, expected GREEN.
- [x] Positive HTTP checks: valid mixed order/release, disabled gambits,
  toggle, clamping and simple commands. Retain original local smoke.
- [x] Run local/sim/online-regressions, `npm run check`, `npm run build`,
  complete `npm test` under the shared fixture lock and short TMPDIR.
  Use isolated HOME, readonly dependencies, no hosted backend target.
- [x] Targeted existing browser smoke: accepted simple command, same real
  session/map and advancing ticks. No new global browser campaign.
- [ ] Self-review exact allowed diff; preserve real logs, signed candidate,
  exact base/commit/tree and recovered external bundle with SHA-256 manifest.
  Hand off for independent review through the native board lifecycle.

## Evidence and limitations

Results will be recorded after execution, not inferred from the source.
Mixed-input human usage/frequency is unknown; no human incident, adoption,
model behavior or final what-if report divergence is claimed. HTTP checks
observe stable public fields, not equality of naturally ticking full state.
The local log is not exposed via HTTP; its unchanged success-only location
is reviewed in source, not represented as an HTTP-observed log assertion.

## Execution ledger

Ruling: keep the plan and ledger in this authorized note rather than adding
stock plan/scratch source paths; the card permits exactly three source paths.
Cost if wrong: less granular process scaffolding, no runtime behavior change.
Pre-flight: one task, no shared inter-task interfaces. The card's prescribed
design is the implementation authority; no additional approval is fabricated.

### Executed results

Native identity: Hermes profile `contrib-superpowers`, session
`20261019_114922_57cbad`, card `t_0b198003`, run `977`; configured model
`gpt-6.1-sol`, provider `openai-codex`. Provider usage counters are not
measured here. Inherited base includes the already-integrated UI, tutorial,
guide, doctrine recovery and agent reapproval; none is reimplemented.

Logs live outside source at the bound wrapper's `evidence/` directory.

- `red-local.log`: Node 22.23.3, exit 1 before production modification.
  Both human/agent cases return HTTP 400, then fail on changed gambits
  (`hold`/disabled -> `go`) or changed control/target (`false,135,280` ->
  `true,600,350`). Original local smoke passes. TAP counts 1 pass/6 fail
  include the two parent failures and four leaf failures, not six incidents.
- `green-local-node22.log`: the same regressions pass, 7/7. An initial
  additional GREEN ran accidentally on default Node 24.21.0; it is retained
  as `green-local-initial.log` and is not the required Node 22 evidence.
  Tool-call environment exports did not carry into the next call, so later
  commands use explicit environment bindings.
- `focused.log`: Node 22 local/sim/online-regressions, 30/30, zero failures.
  Added positive controls cover both roles, valid mixed operation ordering,
  disabled rules, toggle, clamping, simple order/split/release, notifications
  and attribution. Planning test proves five refusals consume agent budget,
  sixth is 429, while human pre-start gambits remain accepted.
- `check.log`: exit 0, syntax checked 81 JS files, inline browser scripts
  and JSON. Repository has no separate lint/type/format tool. npm printed
  an update notice; no update/install was performed.
- `build.log`: exit 0, eight public assets and existing client bundle.
  `public` remains the pre-existing link to this wrapper's isolated build.
- `npm-test.log`: full `npm test`, 177/177, zero failures/cancellations/skips.
  One existing Node MockTimers ExperimentalWarning is retained, not hidden.
  This is the Node suite (including its existing browser fixtures), not a
  claim that separate Playwright/Convex deployment suites ran.
- `verification-run.log`: fresh empty environment with bound Node 22,
  isolated HOME/short TMPDIR/Brave and shared fixture lock. Lock requested
  11:54:17.540057869Z, acquired 11:54:17.542234004Z, released
  11:55:38.783251368Z on 2026-10-19. No foreign listener reused/killed.
- `browser-smoke.log`: separately reran only existing in-match keyboard
  browser test under the shared lock, 1/1. Real toggles/split/release are
  accepted; same session/28-planet geometry, ticks 2 -> 46, one session and
  one play POST, no extra on resume, no page errors. No API interception or
  model invocation in this targeted case. Browser source remains untouched.

Source review: only the candidate boundary changes in the local route.
Agent rate and planning guards precede cloning; success-only journal,
feed, calls and attribution remain after assignment. There is no `await`
between cloning, engine application, state assignment and journal append.
No final local what-if report or throughput benchmark was executed.

Ruling: the prescribed three-path scope and coordinator-owned programme
review replace stock extra plan/workspace files and integration choices.
The bounded native card, not a claimed interactive approval, authorizes
implementation. Cost if wrong: process evidence is less scaffolded; the
coordinator still must independently review this exact candidate.
