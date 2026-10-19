# Result sharing implementation plan and acceptance

> For agentic workers: use superpowers:executing-plans to implement this single bounded task, with test-driven-development and a fresh whole-branch code review. This note uses the card's required location instead of the stock plan directory.

Goal: let a player copy the current completed result without sharing a capability or private match link.

Architecture: reuse `F.report.actual`, `endScreen()` and `panel()` in index.html. Match entry already clears `#big`; no new state store, endpoint, dependency or result calculation. Use the existing native Clipboard API pattern, with a readonly selectable textarea on missing/rejected API.

Tech stack: existing browser JavaScript, Node 24, installed Playwright/Brave and local ephemeral servers.

Spec: /home/hermes/research/contribution-harness-1561132421896740937/result-sharing-scope-v2.json
Authority: task t_6b62cf8a and CONTRIBUTION-CONTRACT.md. These are bounded implementation instructions, not a fabricated human design approval.

## Global constraints

- Only index.html, e2e/result-sharing.spec.js and this note may change in source.
- Share only Botters, actual won/lost/draw, the two scores formatted exactly like the real-match row, and https://botters.havesomecode.io/.
- No names, doctrine, setup, match/room IDs, tokens, query/hash, hypothetical replays, location.href or full-state/report serialization in the summary.
- Copy is available only on the current completed report. Preserve PLAY AGAIN, REMATCH IN ROOM and menu.
- No external share, backend, simulation, auth, account, media, installer, test configuration, dependency or profile changes. No push, merge or deployment.
- Hold /home/hermes/.hermes/cache/scratch/botters-contribution-browser-fixtures.lock for standard browser fixture commands. Loopback only, no inherited remote targets or durable backend.
- Keep retained build, logs and candidate.json in the task wrapper's evidence directory, not tracked source.

## Baseline before product code

- Bound base a31e88d8f44c356f12bc2c5d96870a88857cbf57, tree 56d6777f9fc0b7b924a15959b3b9ab66aa4dba2f, branch contrib/superpowers-result-sharing; clean linked worktree, not a submodule.
- index.html:663-681 renders a completed report with real and hypothetical results, only PLAY AGAIN/menu. No Copy result action exists. `match()` clears `#big` before receiving the next report.
- Existing room-link clipboard handler remains unchanged and is not result sharing.
- Maintained remote pvp-online was read with git ls-remote: 94882600b050e58033f471761b58424388799f40; already an ancestor of the bound base. No update needed at orientation; recheck before freeze.
- First unchanged `npm test`: 85/88 passed; two guided-first-match tests and offline-browser failed before page load with Chromium `Socket path too long` under the inherited profile TMPDIR. Existing project documentation describes the checkout-local /proc/self/cwd/.cache/tmp workaround; rerun unchanged baseline with that environment. No product fix for environment failure.

## Review focus

1. Private room pathname, URL sentinels and player/setup text must never enter clipboard output: real room/house tests compare exact allowlisted output and exclude private data.
2. Absent API and rejected write must leave selectable identical text, not claim success: explicit browser boundary fault injection, leaving gameplay real.
3. Equal-score draw and both player perspectives: deterministic hold openings yield a real draw; a distinct rematch opening yields unequal results and opposite won/lost views.
4. In-flight clipboard completion after a new match must not write stale UI: hold one write pending, rematch, then reject; new match must remain free of old fallback/status.
5. Keyboard and narrow viewport: Enter/Space activates the native button; fallback has a label, is focused/selected, and remains inside the viewport at 390px.

## Task 1: Copy current completed result, safely

Files: modify index.html endScreen/panel; create e2e/result-sharing.spec.js; update this note with executed evidence.

Interfaces: consumes existing F.report.actual { result, you, enemy }, v.ended and score formatter n(number). Produces native button #copyResult, polite status #copyResultStatus and readonly textarea #resultSummary for manual recovery. `copyResult()` derives the text from the completed report; its asynchronous UI updates are scoped to the original connected controls.

Builder call (not owner-approved new design): summary shape is `Botters: <won|lost|draw>\n<you> vs <enemy>\nhttps://botters.havesomecode.io/`. This is short and matches the displayed row without introducing labels/names. Successful write reports `Result copied.`; failure explains manual copy and exposes the exact same text.

- [x] Step 1: Add real browser tests for local house finish, actual clipboard contents, secret sentinels, draw, API absent/rejected, and changed room rematch. Removing copy, using a replay, using a stale report or including any additional fields must fail these assertions.
- [x] Step 2: Run `npx playwright test e2e/result-sharing.spec.js` under the shared lock. Expected RED: completed real report exists, Copy result is missing. Retain failure log.
- [x] Step 3: Implement copyResult() and add the controls to endScreen, bind in panel. Catch unavailable API and rejected writes; expose readonly text and select it. No secondary clipboard mechanism or external calls.
- [x] Step 4: Run `npx playwright test e2e/result-sharing.spec.js e2e/online.spec.js` under the shared lock. Expected: every test passes, no page errors. Record real outcomes and any fixture failures honestly.
- [ ] Step 5: Run `npm run check`, `npm test`, `npm run build`, `git diff --check`; expect exit 0. Recheck maintained remote base, inspect allowlisted diff, commit signed with existing signing configuration. Do not push.
- [ ] Step 6: Request fresh whole-branch review using the stock code-reviewer template; address important defects through RED/GREEN. Preserve reviewer limitations separately from coordinator-owned Luna/Sol gates.
- [ ] Step 7: Retain final build and candidate.json with exact base/commit/tree, native session/run identity, executed commands/results and limitations. Hand off local candidate for coordinator publication/reviews/integration; not a release.

## Method and ledger rulings

- Pre-flight: one task, no shared task interfaces. Existing index.html is a known integration hotspot; contribution changes stay at the end report only.
- Ruling: use the card's complete fixed spec and existing execution authority rather than ask an absent human to reapprove it. No novel scope choice or human approval is claimed; cost if wrong is coordinator rejection before integration.
- Ruling: native inline execution for this one inseparable UI/test change, with a fresh reviewer at end. No per-task implementer subagent; cost if wrong is reduced per-step independent scrutiny, mitigated by real RED/GREEN and final review.

## Executed verification

- Unchanged baseline rerun: `npm test`, 88/88 PASS, 0 skipped, with `TMPDIR=/proc/self/cwd/.cache/tmp` physically inside this checkout. Dependencies/browser already present; no installation.
- Feature RED: first outer command timed out after 180 seconds (roughly two minutes queued on the shared fixture lock, then interrupted run). Retry `npx playwright test e2e/result-sharing.spec.js --max-failures=1` acquired the lock at 04:38:42Z; the real completed report and score comparisons passed, then Copy result was absent and focus timed out. 1 failed, 4 not run; exit 1. Baseline environment failure is not being counted as feature RED.
- First implementation GREEN: shared-lock `npx playwright test e2e/result-sharing.spec.js e2e/online.spec.js`, 10/10 PASS, acquired 04:40:55Z and released 04:45:23Z. The five new tests exercise online house finish, actual Chromium clipboard write/readback, synthetic URL secret sentinels, missing API and rejected writes, genuine equal-score room draw, room-path exclusion, changed won/lost rematch, delayed old-copy rejection, and native offline SSE house finish followed by PLAY AGAIN. Menu/history and original online reconnect/rematch tests pass.
- Fallback is labeled, readonly, focused and completely selected; measured within a 390px viewport. Native Copy result responds to Enter and Space. Three CSS rules are scoped only to the completed report to keep its new fallback accessible and scrollable; no general gameplay/mobile redesign.
- `npm run check`: exit 0, 79 JS files plus inline scripts/JSON; no separate linter/typechecker configured. `npm test`: 88/88 PASS, 0 skipped. `npm run build`: exit 0, 8 public assets plus existing live bundle/config. `git diff --check`: exit 0.
- Maintained remote pvp-online rechecked after these checks: 94882600b050e58033f471761b58424388799f40, unchanged and already inherited. No merge/rebase/push needed or performed.
- Session 20261019_043103_491ae0, native kanban run 943, profile contrib-superpowers, model gpt-6.1-sol/provider openai-codex. No copied trial memory or additional telemetry service. Native counters remain the source; unavailable counters are unknown.

Limitations: browser execution is Chromium/Brave on local ephemeral fixtures, not production, Firefox/Safari, physical-phone or screen-reader validation. Missing/refused clipboard branches use explicit boundary fault injection; successful writes and reads use the real browser clipboard. Automated play is not human approval, enjoyment or adoption. Final independent method review and coordinator-owned Luna/Sol review/publication/integration are separate; no release is claimed. Exact signed candidate identity and retained build/evidence live in the wrapper evidence/candidate.json, avoiding a self-referential commit identifier in source.
