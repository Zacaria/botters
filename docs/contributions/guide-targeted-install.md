# Guide targeted installation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a visitor to `/guide` discover and copy an installation command for only their chosen local client.

**Architecture:** Add five native `details`/`summary` disclosures, each containing one plain `pre`, inside the existing local setup section. Reuse the existing copy-button loop and CSS unchanged; retain the global command and manual setup fallback.

**Tech Stack:** Static HTML, native browser disclosure/selection/clipboard controls, existing Playwright and Node tests; no dependencies or new JavaScript.

**Spec:** Allocated card `t_46fdfe8e` and attached `NEXT-SUPERPOWERS-SCOPE-AFTER-PR7-1566ed3e.json` (SHA-256 `fd2a630da80abf15427f411f4a50432758d680c85df2b1860dd492da9fd33bb0`). Base `1566ed3eb942a29803efeb3c2f3e9cd323440416`, tree `ea459d294cb454e17f50e0152831491204a2f6b6`.

## Global Constraints

- Only source paths: `guide.html`, `e2e/guide-targeted-install.spec.js`, this document.
- Exact prefix: `npx -y github:Zacaria/botters#pvp-online install --client `.
- Exact targets: Claude Code → `claude`; Codex → `codex`; Claude Desktop → `desktop`; Cursor → `cursor`; Windsurf → `windsurf`.
- Each command has exactly one target and no `--yes`, credentials or additional option.
- Explain before commands: selection limits configuration to that client; no selection targets all detected clients; a missing selected client errors without installing it or switching to another client.
- Preserve Node 22+, confirmation, restart advice, multi-client command, manual fallbacks and truthful web/phone limits.
- No installer/prefs changes, shell execution of displayed commands, real client/HOME, remote backend, accounts, provider, dependencies, media, push, PR, merge or deployment.
- Local browser checks only: installed Brave, shared browser-fixture lock, short scratch TMPDIR, no remote BOTTERS variables. Artifacts live in the task wrapper's `evidence/`, outside committed source.

## Review Focus

- Wrong client or `desktop` alias: keyboard-discover all five commands and capture the exact argument passed by the real copy handler.
- Clipboard absence or rejection: keyboard-activate each copy, check existing manual-copy status and select the command's actual text node.
- No JavaScript: open native disclosures at 390×844 and 1440×900, select all commands and check overflow.
- Wrong connection-path guidance: exercise local/web/phone anchors, global command and manual fallback; retain honest limitations.
- Unexpected side effects: collect browser requests/errors; guide interactions must remain on the initial local document, with no account requests or script installation action.

## Task 1: Expose and verify targeted local commands

**Files:** Create this decision/acceptance note and `e2e/guide-targeted-install.spec.js`; modify only the connection section of `guide.html`.

**Interfaces:** Consumes the existing `pre` copy loop (`pre.firstChild.textContent` → `navigator.clipboard.writeText`) and native `details` semantics. Produces five accessible named disclosures and exact single-client command text; no new programmatic API.

- [x] Step 1: Write browser behavior tests. Missing disclosure/command, wrong copy payload, inaccessible selection or clipped layout must fail. Clipboard instrumentation intercepts only `writeText`; it never reconstructs a successful copy.
- [x] Step 2: Run the keyboard copy test against unchanged `guide.html` via local Playwright configuration. Expected: served `/guide` is 200; failure specifically reports absent named client disclosure/targeted command. Retain RED output.
- [x] Step 3: Add the explanatory text and five HTML disclosures before the retained global command; label the latter as all detected clients. Expected: existing JavaScript and fallback bytes unchanged.
- [x] Step 4: Replay the same test, then the full new file, including real browser clipboard, rejection/absence, no-JS and both viewports. Expected: all pass, no page errors or unintended requests; retain rendered screenshots.
- [x] Step 5: Run `node --test test/install.test.js test/public-demo.test.js`, `npm run check`, `npm run build`, `npm test`, and local Playwright for `e2e/public-pages.spec.js e2e/public-demo.spec.js e2e/guide-targeted-install.spec.js`, plus `git diff --check`. Expected: zero exit codes; report all actual failures and diagnostic reruns.
- [ ] Step 6: Self-review the scope and script/fallback preservation, make scoped signed commit(s), run stock review-package and fresh-context code review. Expected: verified source range and explicit findings, not simulated human approval. Coordinator separately owns Luna/Sol gates and publication.

## Method and decision record (written before implementation)

- Native session: `20261019_101455_2408c5`; Hermes profile `contrib-superpowers`, run 958; model `gpt-6.1-sol`, provider `openai-codex`.
- Bootstrap supplied by user; registered brainstorming, using-git-worktrees, writing-plans, executing-plans and TDD skills loaded, with Hermes mapping and good-tests reference. Actual procedural execution is recorded in task-local evidence/ledger, not inferred from loading skills.
- This is the brainstorming skill's quick, fully specified branch. The allocated card settles design and requests bounded implementation; no new human approval is claimed. Native inline execution keeps this single HTML task in its bound session and uses a fresh reviewer at the end.
- Ruling: store the short plan in this authorized document rather than the skill's default plan path — three-path source limit takes precedence; cost if wrong: documentation location only.
- Ruling: reuse the already-linked worktree and installed read-only dependencies, not create a worktree or run npm install — explicit isolation/dependency guard; cost if wrong: missing dependencies would surface as a blocker.
- Environment discovery found inherited `HERMES_KANBAN_WORKSPACE` pointing to a nonexistent older scratch directory. All commands use the exact bound checkout explicitly; no old trial memories were read.
- Baseline: first `npm test` on unchanged source failed 3/110 tests (`optional local guidance…`, `guidance is absent by default…`, `offline browser renders…`) because Brave reported `Socket path too long` under the profile's long scratch path. A short-TMPDIR retry passed; the final audit discovered that terminal exports reset between calls, so that retry also inherited Node 24/npm 11. It was not a controlled one-variable comparison. Both logs are retained; no product-source fix was made.
- Runtime correction: only the first baseline call explicitly selected installed Node 22.23.2 / npm 10.9.8. Earlier later-call GREEN/regression checks inherited Node 24.21.0 / npm 11.19.0 and the default short scratch root. Final verification explicitly sets `/home/hermes/.local/share/hermes-toolchains/node22/bin` and `/home/hermes/.hermes/cache/scratch/gti` in the same call as every required check. No downloads or profile changes.

## Executed results

- `red.log`: one selected browser test failed after HTTP 200/local keyboard navigation, with `missing targeted installation disclosure for Claude Code`. No product HTML had changed.
- `green.log`: first full replay had 7 passes and 3 test failures. The real button had changed to `copied`, but the test's name-constrained locator still required `copy` (confirmed in browser accessibility snapshot). Corrected only the test locator, preserving explicit before/after label assertions; no product fix needed. `green-fixed-locator.log`: 10/10 pass.
- `install-public-demo.log`: 34/34 pass, zero skipped. Installer tests use existing isolated fixtures; no displayed npx command or real user client configuration was executed.
- `check.log`: syntax checks for 80 JS files, inline scripts and JSON pass; repository has no separate linter/type/format tool.
- `build.log`: eight public assets built; task-local `public/guide.html` equals source.
- `npm-test.log`: 110/110 pass, zero skipped.
- `regression-browser.log`: 15/15 pass (new guide plus public pages/demo); real native copy of all five commands, instrumented payload capture and absent/refused clipboard cases pass. Both 390×844 and 1440×900 have no horizontal overflow with or without JavaScript. No unexpected requests, page errors or session cookies in guide tests.
- `source-audit.json`: exactly three allowed source paths; no overlap with preferences candidate; all original guide bytes, inline JavaScript and manual fallback preserved. Only 22 HTML lines added.
- Screenshots are produced by actual local Brave rendering in each viewport and JS/no-JS state. Selection is browser-automation Range selection of the visible command text node, not an assertion of manual human drag selection. Visual evidence inspection of mobile Claude Desktop and desktop Codex found no clipping; not a Luna/Sol or human approval.
- Browser commands use the installed `node_modules/.bin/playwright` equivalent of the scope's npx command to prohibit package downloads. Each browser/suite run holds `/home/hermes/.hermes/cache/scratch/botters-contribution-browser-fixtures.lock` and neutralizes remote backend variables.
- The post-review environment audit corrected only this documentation, not the reviewed HTML/tests. Final Node 22/npm 10 outputs and explicit environment receipt live under `evidence/final-node22-*`; earlier successful/failing runs remain distinct. A prior reviewer PASS is not transferred to new documentation bytes or represented as a Luna/Sol verdict.

## Delivery boundaries

Tests validate local rendered command text and copying, not GitHub resolution, public guide availability, a real installation, client compatibility, user adoption or enjoyment. Publication/ref availability and independent Luna/Sol review of the exact candidate remain coordinator gates. A signed local candidate/bundle is not integration or production.
