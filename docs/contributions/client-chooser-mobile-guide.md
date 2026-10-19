# Truthful client chooser and mobile guide

## Bound scope and baseline (before implementation)

Task: t_c1371d28, native Hermes, profile contrib-hermes. Starting commit:
`a31e88d8f44c356f12bc2c5d96870a88857cbf57` (tree
`56d6777f9fc0b7b924a15959b3b9ab66aa4dba2f`). Inherited tutorial,
trailer, installer and authentication decisions remain unchanged.

Baseline source inspection: guide.html has no viewport, no client-path chooser,
and a two-column tools/settings layout with long identifiers. Its clipboard
handler only handles success. Existing e2e/install.spec.js covers the unique
main command, clipboard success and the native no-JavaScript fallback.

Only guide.html, e2e/install.spec.js and this note may change. No installer
execution, client configuration writes, remote MCP implementation, dependencies,
model/provider/profile changes, release or deployment are part of this work.

## Acceptance and implementation decisions

- Put native anchor choices before installation instructions: local client,
  web interface, and phone. Name exactly the installer's five local targets:
  Claude Code, Codex, Claude Desktop, Cursor and Windsurf.
- Local route retains the unique primary command
  `npx -y github:Zacaria/botters install`, Node.js 22+, restart, existing
  configuration/approval warnings, collapsed manual fallback and play steps.
- Web/phone routes explicitly say the local stdio path does not demonstrate a
  direct MCP connection there. Link to the documented local route; invent no
  remote endpoint, future availability, tested web compatibility or touch play.
- At 320×640, 390×844 and 1440×900, test actual document and block geometry,
  including expanded fallback and tools/settings. Anchor navigation and native
  disclosure must work with JavaScript disabled and with keyboard input.
- Clipboard denial/unavailability must never report success; command text stays
  selectable and instructions explain manual copying. Keep back-to-game and
  policies, approval expiry/replacement/revocation information intact.

Reuse the existing page and native anchors/details, not a JavaScript chooser.
Keep the installed command identities and snippets unchanged. Reflow narrow
rows rather than hiding overflowing content. Add a discriminating browser
check and observe it fail on the unchanged guide before implementing.

## Verification record

Executed on Node v24.21.0 with the existing installed Playwright 1.61.1 and
Brave/Chromium, using only the repository's loopback fixtures. Fixed-port work
was serialized with the existing
`/home/hermes/.hermes/cache/scratch/botters-contribution-browser-fixtures.lock`.
Hosted BOTTERS target variables were unset. No dependency installation was needed.

- Unchanged-guide baseline: `npx --no-install playwright test e2e/install.spec.js
  --reporter=line` — 2/2 passed.
- RED, before editing guide.html: same command with
  `--grep 'fit 320px|clipboard is'` — 4/4 failed as intended. Both real mobile
  contexts measured `innerWidth = 980`, not 320, with and without JavaScript.
  Clipboard denial/unavailability had no status feedback. Failure traces/logs
  are preserved; these were observed failures, not inferred from source.
- GREEN guide: 11/11 passed, including real clipboard success, denied/missing
  clipboard APIs, native keyboard navigation and disclosure, and all three
  sizes with JavaScript on/off. Clipboard failure injection is limited to the
  browser API; no model/game/backend responses are fabricated.
- `npm run check` — passed: 78 JS files, inline scripts and JSON configuration.
- `npm test` — 88/88 passed, none skipped. Existing installer unit tests use
  disposable fixture homes; no real client installation was run.
- `npx --no-install playwright test --reporter=line,json` — 21/21 passed,
  including all 11 guide tests and the actual homepage-to-guide entry.
- `npm run test:auth:browser -- --reporter=line` — 4/4 passed. The negative
  stolen-ticket/logout test logged its expected sign-in rejection.
- `npm run build` — passed, 8 public assets plus live client/config output.
- `git diff --check` — passed.

The full sequence and actual output are in `../evidence/verify-local.sh` and
`../evidence/verification.log`. Its recorded lock request/acquisition both fall
at 2026-10-19T04:34:26Z (only second-resolution dwell is known). Browser JSON
retains the collapsed/expanded block dimensions. Document widths are exactly
320, 390 and 1440 respectively; no measured visible block overflowed. Screenshots
of chooser/local setup without JavaScript supplement these behavioral checks.
The 320px captures show all three route choices and a fully readable soft-wrapped
command; copying still yields the unchanged single-line command.

Remote freshness: `git ls-remote origin refs/heads/pvp-online
refs/heads/contrib/hermes-guided-first-match` observed the maintained candidate
base still at `a31e88d8f44c356f12bc2c5d96870a88857cbf57`, with pvp-online at
`94882600b050e58033f471761b58424388799f40` already included in that base.
No base update, merge, push or publication is required/performed by this worker.

Native session: `20261019_043011_2dba3f`; kanban run 942. Provider token/cost
counters are unknown here, not estimated. Initial terminal calls failed because
the inherited working-directory environment named a missing old scratch path;
all successful commands explicitly used this task's bound checkout instead.

## Limits and handoff

Recoverable signed source, build and exact candidate/base/tree are retained in
the task-bound `../evidence` directory with candidate.json. No files outside the
three authorized source paths were added to the commit. Shared dependencies were
read-only; existing tutorial, trailer and native assets were not edited.

These are local guide observations, not proof of remote MCP compatibility,
touch gameplay, screen-reader certification or human playtest acceptance. Only
Chromium was exercised, with mobile viewport/touch emulation, not physical phones.
No external sign-in link, install command or account/provider mutation was run.
Publication, independent Luna/Sol review and integration remain coordinator-owned;
this local candidate is not a release or production deployment.
