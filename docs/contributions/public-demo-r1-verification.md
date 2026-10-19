# Public-demo R1 repair verification

## Identity, scope and retained history

Task t_1e2be52d; native run 914; native Hermes session 20261018_085523_9773e2; profile contrib-superpowers; gpt-6.1-sol / openai-codex. Product base remains 8871d4842eaf900362052ea1ed3879027a1fa5aa. Repair starts at signed 87caf90dbb43954925388c9558e20f3c5c604402 / tree ce14b9c44277d825d835aace2da0816b94eb2b18, on existing contrib/superpowers-public-demo. Final signed commit/tree and SHA-256 candidate_fingerprint are in the external task handoff, avoiding a circular source self-hash.

Sol's rendered review requested changes for R1: a selected swarm/white ring and the HUD's “by hand” were visible, but the promised dashed route and directed journey were not discernible. Capture state corroborates the issue: the accepted target (225,432) is almost the current position (226,432). A successful order is not evidence of visible directed travel. The original video and historical PASS/CHANGES_REQUESTED records remain preserved, not replayed as approvals of new bytes.

The minimal repair changes only introduction, the 0:08–0:16 transcript paragraph and the corresponding caption text. The introduction describes selection/taking control/return; the transcript distinguishes an issued nearby order from a visible journey; captions identify selection, white ring and “by hand”. Release wording/times, all four cue intervals, source capture observations, gameplay, inline application scripts, styles, authentication, installer and dependencies are unchanged. No new recording, mock model, human approval, CI workflow, provider setting or PR was created.

## Media identity

- Video unchanged: VP9, 1440×900, 20fps, 40.000000 seconds, 1,018,285 bytes; SHA-256 0f37720d9c02da0aba25354a99d4760984b859e3f08810219db41e78247d510d.
- Poster unchanged: SHA-256 4ec20a6745c9835a37d57cb2374a9853743989188fe2f08fefe9f33e4cbf5ade.
- Revised VTT: 620 bytes, SHA-256 7d898a709a1f789807f876802d22c6b40a7d0226e2348f4d82a9bf603e5ea575.
- Original VTT: 639 bytes, SHA-256 2d51f3b5155849f0164a8eaad7633973c90640f34ab442def5b481f6e86042a9; retained in the reviewed commit and captionRevision provenance.

public-demo-capture.json now binds current caption bytes and explicitly records the revision. public-demo-artifacts.json and public-demo-verification.md are marked historical; their original measurements remain intact. Fresh output is isolated under .cache/r1/, not overwriting run-904 evidence.

## Actual RED → GREEN and executed verification

The regression exercises served HTML and native active video cues, not source markers or a mocked player. It catches stale journey promises in intro/transcript/captions independently. It is not an automated visual truth oracle: exact-candidate scene recheck remains independent.

- Before copy changes, `node node_modules/@playwright/test/cli.js test e2e/public-demo.spec.js --grep 'demo descriptions'`: exit 1, one test failed on intro's movement promise/missing selection, transcript's dashed route and sends-it wording/missing order distinction, and active 10-second caption's dashed line. Trace/log preserved in .cache/r1/red-results and red.log. All three surfaces were actually reached; no setup error substituted for RED.
- Same targeted command after repair: exit 0, 1 passed (4.2s), active selection cue at 10 seconds and release cue at 17.2 seconds exercised.
- `npm test`: exit 0, 81 passed / 0 failed / 0 skipped.
- `npm run check`: exit 0, 75 JS files plus inline scripts/JSON; no separate lint/type/format tool configured.
- `npm run test:browser -- --output=.cache/r1/browser-results`: exit 0, 12 passed, including no-JS 390px, native play/pause/keyboard seek and new surface/cue consistency check.
- `npm run test:auth:browser -- --output=.cache/r1/auth-results`: exit 0, 3 passed. Expected “Sign in again” / socket4002 logging belongs to the stolen-reservation/logout denial test.
- Full browser/auth sequence used the prescribed native flock identity. Request and acquisition 2026-10-18T09:00:17Z; finish 09:02:15Z, no measured wait at one-second resolution. RED/GREEN also used that same lock; their acquisition dwell was not separately measured.
- `npm run test:auth:convex`: exit 0, 3 files / 4 tests passed using the existing ignored local SDK-generated wiring from run904. No hosted codegen, backend target or deployment. Fresh checkouts still need that documented local wiring; this is not a claim that ignored generated files ship.
- `npm run build`: exit 0, 8 public assets plus native live bundle/config. Clean environment prevents a hosted live URL; actual built config asserted url=null.
- Actual `npm pack --json --pack-destination .cache/r1`, extraction and running its server: exit 0. Tarball SHA-256 0f74dfa21ace6d57fa778868813fd5ed4e31dd02c99fa8a1b4fc2995c195061d. Not merely a dry-run file list.
- `ffmpeg -v error -i media/public-demo.webm -f null -`: exit 0, empty error output; ffprobe confirmed unchanged dimensions/codec/fps/duration/size.
- `git diff --check`: exit 0.

All local commands used the installed Node24 toolchain with a clean environment and task-local TMPDIR=/proc/self/cwd/.cache/tmp for browser Unix-socket length. No BOTTERS_DEV_CONVEX, hosted target, real login, new installer or dependency installation was used.

## Real source/build/package delivery and author visual self-check

The existing actual-artifact harness was reused as .cache/r1/verify-artifacts.mjs, with distinct evidence/package paths and worktree-content hashes (before commit, HEAD alone would identify the old bytes). On reserved port39872 it verifies the owned process cwd, refuses an occupied port, and tests three delivery fixtures: source server, built static assets with repository CSP/security headers, and actual unpacked npm-package server. All three passed exact media bytes/types, byte ranges206, missing media404, public navigation and native playback/seek/end with JavaScript both disabled and enabled. Each context at390×844 followed Play/Understand/transcript/guide/privacy/terms with no overflow; playback checked at native size. The revised active caption at10s was checked in all six source/build/package × JSoff/on runs. No page errors or external player/service requests occurred. Servers/browsers are closed by the harness.

Author inspected actual repair screenshots at10s and the narrow no-JS transcript: captions and visible transcript describe selection/nearby order, the ring and “by hand” are visible, and the transcript explicitly disclaims a visible journey. No overlap/overflow was seen in that transcript screenshot. This is author self-check, not independent Sol approval. The screenshot cannot prove automated keypresses by itself; original capture/state provenance supplies those. Small game HUD text in the mobile thumbnail remains a known limitation; fullscreen/download and readable transcript are retained.

## Review/publication boundary

The signed descendant, recoverable archive, original/new candidate fingerprints, exact checks and review package are supplied to the coordinator for focused Sol recheck of the same8.5–20s window and all three corrected surfaces. The stock review-package script and requesting-code-review template are used for that handoff, not described as an executed independent verdict. No duplicate reviewer graph is created and no other card is altered.

The prior PR is https://github.com/Zacaria/botters/pull/1. This correction is local only until coordinator-owned recheck, before any push or PR acceptance claim. Historical Luna PASS on87caf90d is not acceptance of the repair. Native required-CI acceptance is a separate unresolved lane, not replaced with fake checks or weaker guards. No merge, integration or deployment is claimed. Browser coverage is installed Chromium/Brave on Linux, not hardware mobile/Safari/Firefox, production/CDN behavior, assistive-technology user evidence, enjoyment or adoption.

Hotspot: index.html remains shared with the tutorial lane; only its two existing static demo paragraphs changed here. Never reset, clean or overwrite a peer checkout. Native usage counters remain in session/run records; missing provider counters are unknown.
