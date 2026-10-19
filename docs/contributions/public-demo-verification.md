# Public-demo executed verification

Historical run-904 record below (preserved, not a current acceptance receipt). PR #1 was subsequently published at 87caf90d; Luna's historical PASS was followed by Sol CHANGES_REQUESTED R1. The current bounded repair and executed results are recorded separately in public-demo-r1-verification.md. Statements below about pending publication/review describe that earlier moment, not the present state.

## Identity and scope

- Task: t_1e2be52d; native Kanban run 904.
- Native Hermes session: 20261017_221055_a39deb; profile contrib-superpowers; gpt-6.1-sol / openai-codex.
- Branch: contrib/superpowers-public-demo.
- Base: 8871d4842eaf900362052ea1ed3879027a1fa5aa.
- Implementation checked below: 55c95150beac8d9f030408d914150508aeae8e73, tree ce455cd514d9b2f5e99354e93f40efa069fff608. Subsequent documentation-only commit identity is in the task handoff, avoiding a circular self-hash.
- No authentication, installer, game simulation, provider configuration, live account or lockfile changes. index.html changes are confined to the static start screen and its scoped CSS; existing inline application script is preserved.

## Actual capture

The operator model chose the seven opening gambits in this native session, including retreat threshold 1.15, weaker-enemy threshold 0.7 and split threshold 5500. scripts/capture-public-demo.js submits that one choice to the genuine local agent boundary. The house is normal with fixed gambits, not a model. Playwright operates the native human-side Tab, map click, G and Escape controls; no person participated. No model inference runs during the delivered excerpt.

The owned server ran at 20Hz on loopback port 39872. Its PID/cwd were read back before capture. The observed simulation advanced from tick 1 to tick 803 over 40.355 seconds; accepted human-side inputs were order swarm 1 to (225,432), then release swarm 1. State observations confirm manual=true and then false. There were no browser page errors. Two earlier capture-tool attempts waited on a zero-size #game wrapper; the actual visible #hud is the correct readiness target. Those attempts are not presented as successful recordings.

media/public-demo.webm is silent VP9, 1440×900, 20fps, 40.000 seconds, 1,018,285 bytes. Its SHA-256 is 0f37720d9c02da0aba25354a99d4760984b859e3f08810219db41e78247d510d. Full ffmpeg decoding returned exit 0 with no error output. Decoded frames at 0, 10 and 38 seconds were retained locally; the 10-second frame visibly says “by hand”. Visual inspection found no capability token, account credential or private URL. The viewport recording excludes browser chrome, and the native page removed the temporary capability from its URL.

The poster and VTT have digests in public-demo-capture.json, together with original renderer/simulation/server hashes, raw-video digest, exact encoding command, timings, opening and real state snapshots. Reproduction starts a new random-map match through the same script; it does not promise identical pixels or a winning strategy. The original useful delivered bytes are committed; raw attempts remain ignored.

## RED → GREEN and repository checks

Executed, not inferred:

- Baseline npm ci --ignore-scripts: 199 packages installed, zero audit vulnerabilities, package-lock.json unchanged.
- Initial baseline npm test: 77/78 passed; Chromium failed before page load because the profile TMPDIR made its Unix socket pathname too long. Unchanged offline-browser regression then passed with TMPDIR=/proc/self/cwd/.cache/tmp, which points into this task's ignored .cache/tmp. Full unchanged baseline subsequently passed.
- New Node checks initially failed because the clean build omitted media and offline media returned 404. New browser checks initially failed because Understand and the video did not exist. These were observed before product edits.
- Targeted Node checks after implementation: 7/7 passed. They exercise clean build bytes, npm pack file list, real HTTP media bytes, MIME, HEAD, valid byte/suffix ranges, invalid ranges (416), unavailable/non-allowlisted paths (404), and recorded provenance hashes/input acceptance.
- npm test: 81/81 passed, zero failures.
- npm run check: syntax checked 75 JS files, inline browser scripts and JSON configuration. No separate lint/type/format tool is configured in this repository.
- npm run build: 8 intended public source assets plus the existing live bundle/config; media bytes matched source, no server/secret modules copied.
- npm run test:browser: 11/11 passed, including existing real online match, reconnect/rematch and installer guide regressions plus the new public demo checks.
- npm run test:auth:browser: 3/3 passed using only the isolated Better Auth + Colyseus fixture. Expected denial logging (“Sign in again”, close 4002) occurs in the stolen-reservation/logout negative case, not a failed test.
- Both standard browser suites ran under the prescribed shared flock. Request 22:34:57Z, acquisition 22:35:59Z, finish 22:37:58Z on 2026-10-17. Lock wait is separate from implementation. Earlier targeted lock dwell was not instrumented and is unknown; no guessed timing.
- npm run test:auth:convex: first failed because ignored convex/_generated files were absent. After local SDK generation, all 3 files / 4 tests passed. No hosted backend was selected or contacted.
- npm pack --dry-run --json and a real npm pack were executed. The real tarball was unpacked and its server actually launched; tarball SHA-256 ec1a2e2825a71969a43c41e744a740ba030018f674d1a6ff8fec2dd15e3bb0df.

Local Convex setup used the installed SDK's componentApiJs() and serverCodegen({useTypeScript:false, envVars:undefined}) outputs. Direct template import initially failed on an optional unpublished CLI dependency (chalk). Existing esbuild bundled only the pure template exports, excluding unused CLI-import side effects; the untouched generator functions then wrote ignored api.js/server.js. This is local SDK-generated API wiring for convex-test, not a fake Convex backend and not deployment/type generation against a live schema. The product code and tests were not patched to make this pass. The exact local setup scripts are retained with the ignored execution evidence.

## Real artifact/browser acceptance

.cache/verify-artifacts.mjs launched three separate delivery fixtures sequentially on reserved port 39872, failing rather than killing any occupied listener:

1. Exact source server, PID/cwd verified against this task checkout.
2. Real public/ build served with installed Express static delivery and the repository Vercel CSP/security headers. This is local static acceptance, not a Vercel deployment.
3. Server from the actually unpacked npm tarball, PID/cwd verified against that package directory.

For each: exact media digests and response types matched; byte ranges returned 206; missing media returned 404. With and without JavaScript, a fresh browser at 390×844 followed Play, Understand, transcript, guide, privacy and terms without a session or horizontal overflow. Keyboard Enter operated public anchors/details. Native video Space play/pause and ArrowRight seek worked; the browser decoded the manual-control frame, sought to 38s, reached the end, reported 1440×900 / 40s / no media error and loaded all four VTT cues. No external player/service request or page error occurred. Script-disabled browser diagnostics needed Node-side polling: page waitForFunction's requestAnimationFrame did not execute with JS disabled even while native media was playing (observed currentTime 30.01). No product change was needed.

The committed regression suite exercises the online fixture. These additional source/build/package and no-JS media runs are execution evidence, not a claim of a cross-browser matrix. Raw output and source/build/package process identities are in .cache/artifact-evidence/report.json. Screenshots include the narrow public explanation/transcript and actual decoded manual-control frame.

## Author self-review and limitations

The author inspected the base-to-candidate diff, relevant serving/security paths, capture text and decoded frames. No author-discovered critical/important defect remains. This is self-review, not the independent judge's verdict or human approval.

Deferred minor observations: the recorded game sidebar is small when embedded, especially on a phone; fullscreen/download and the full static transcript provide alternatives. Native default captions can cover part of the map; they are optional player controls. Neither observation is evidence of human enjoyment or adoption. No Safari/Firefox, mobile hardware, assistive-technology user study, public hosting/CDN or production behavior was tested. No “wins” claim is made.

The requested Superpowers route used its native bootstrap, acceptance/plan before product changes, stock worktree detection, task-start/task-done and review-package scripts, actual RED/GREEN checks and verification. Headless execution used the existing card's bounded authority, not a fabricated additional design approval. The independent final review is pre-created as child t_d3de20ae (contrib-judge, gpt-5.6-luna / openai-codex); it has not run. Do not treat reading the review skill/template or this self-review as that procedural gate. The separate exact-candidate Sol scene check remains required before game delivery. No duplicate review graph was created.

## Publication hold, not an authentication claim

No push, PR publication, merge or deployment has occurred. VERCEL-ACCESS-READBACK-v2.json is authoritative: connection is active, native botters.vercel.app/project binding was read successfully, hosted GET_PROJECT is 403, and domain gitBranch=null is NOT proof that automatic Git deployments are disabled. Do not request the same OAuth link again. The remaining external prerequisite is the full Git/auto-deployment read and orchestrator binding of a verified source-only destination. Preserve this signed local candidate and resume only that eligible external action once bound. A source PR would still not constitute integration or production.

Hotspot: index.html is shared with the first-match tutorial lane. Only this task checkout was touched. The static #start additions should be reviewed when integrating; no sibling branch was reset, staged or repaired.

Native run/session records hold usage and elapsed cost accounting; missing provider counters remain unknown. This document is verification evidence, not a second telemetry system.
