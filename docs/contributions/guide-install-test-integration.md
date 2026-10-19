# Guide installation test integration repair

## Scope and acceptance (recorded before test edits)

This neutral repair adapts the eleven existing `e2e/install.spec.js` cases to the accepted guide feature at base `ab46fcaa3d32c2672e3491cc28345f5a10161fdf` (tree `3bb4314fa57a5abcf565b6e3e480d2848c9de5db`). Only that test file and this note may change. Preserve exact blobs and modes of `guide.html`, `e2e/guide-targeted-install.spec.js` and `docs/contributions/guide-targeted-install.md`.

The intended guide now has five collapsed client disclosures before the visible all-detected-clients command and a separate manual fallback. The first `pre` is therefore a hidden Claude Code command; global `summary`/`details` locators now resolve to six elements. Do not restore the obsolete DOM order or remove the five disclosures.

Select the all-clients `pre` with an anchored exact-command matcher (allowing only the existing copy-button label), require uniqueness and visibility, and retain exact command-text/copy assertions. Locate the manual disclosure through its exact summary name and scope manual snippets/open-state assertions to it. Assert that no disclosure is open initially, not merely that the manual fallback is closed. Preserve all eleven cases and their native clipboard, denied/absent clipboard, text selection, keyboard, JS/no-JS, 320/390/1440 geometry, connection-path and policy navigation assertions. No skips or reduced matrix.

## Reproduction and verification protocol

Historical CI run `39227767574` is retained verbatim as wrapper evidence `ci-pr9-failed.log`: 42 browser cases, 31 passed and 11 failed, all in `install.spec.js`. This historical failure remains a failure.

Local RED runs the unchanged file using `node_modules/.bin/playwright test e2e/install.spec.js --timeout=10000 --output=../evidence/red-results --reporter=line`: all eleven fail with the same selector causes. The ten-second override bounds the hidden-button waits rather than spending the configured ninety seconds; GREEN must replay that same command with only its evidence output directory changed. Final full browser verification uses `playwright test` without filtering or the bounded timeout override; expected 42 cases, not merely the 21 guide cases.

Use installed Node 22.23.3/npm 10.9.9, Brave `/usr/bin/brave-browser`, short scratch TMPDIR, the BINDING shared fixture lock and existing read-only dependencies. All generated build/browser output stays outside committed source in the owned wrapper (temporary links only in the candidate, removed before commit). No dependency installation, remote backend, real installer invocation, actual user client configuration, push, PR, merge, deployment or profile/card change. Run standalone check/build/Node suite gates and retain actual outcomes in external receipts.

## Executed local results

- `red.log`: 11/11 failures on unchanged tests, including the hidden first-command button and six-summary strict-mode violation; bounded timeout 10,000 ms.
- `green.log`: the same focused invocation passes 11/11 in 15.2 seconds after selector-only adaptation, with its output redirected to a distinct GREEN evidence directory.
- `full-browser.log`: unfiltered local `playwright test` passes all 42 cases in 4.8 minutes at the original configured timeout, including all ten unchanged targeted-client cases and the repaired eleven cases. No skips or reduced matrix.
- `check.log`: 81 JavaScript files, inline scripts and JSON configuration pass the declared syntax gate. No separate lint/type/format tool is configured.
- `build.log`: eight intended public assets built. Build output is owned by the wrapper, not committed source.
- `node-tests.log`: `npm test` passes 128 tests, zero failed/cancelled/skipped/todo, under Node 22.23.3/npm 10.9.9. Existing temporary fixture copies work with ordinary writable modes; no shared dependency chmod or source repair was needed.
- Scope and exact feature blob/mode preservation, signed commit verification, recovery into a fresh bare repository and artifact hashes are recorded in external `candidate.json`/manifest receipts. These operator receipts are not independent review verdicts.

## Handoff boundary

The signed local candidate and verified recoverable bundle are for coordinator review only. Prior Luna/Sol approvals remain bound to the old feature tree, not this new test delta. Independent review of the new exact tree is still required; no automatic integration or publication is authorized. Browser checks establish local rendered behavior, not public installation availability or real client compatibility.
