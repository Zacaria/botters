# Public gameplay demonstration

## Production direction superseded — 18 October 2026

The owner requests a scripted game-announcement trailer with a clear goal and appeal, music and subtitles. The governing production brief is [announcement-trailer.md](announcement-trailer.md). The silent gameplay clip and all R1 scope/checks below are historical source material and evidence, not acceptance of that announcement trailer. In particular, the historical “no new capture” repair limit below applied to R1 only and does not prohibit the new footage and editing requested by the owner. No new trailer has yet passed its required reviews.

Current local production and actual verification are recorded in [announcement-trailer-production.md](announcement-trailer-production.md) and [announcement-trailer-verification.md](announcement-trailer-verification.md); the new edit/capture/music manifests bind the replacement media. All scope, byte hashes and PASS results below refer to the historical silent clip/R1 unless explicitly stated otherwise.

## Source-bound scope and acceptance

Task t_1e2be52d; base 8871d4842eaf900362052ea1ed3879027a1fa5aa.
Authority is the assigned contribution card and CONTRIBUTION-CONTRACT.md, not a new human design approval. This is bounded reuse of the existing homepage, rules, game and styles. No authentication, installer, simulation or provider changes; no live accounts, new dependencies, external video service or deployment.

The public homepage must explain the loop: set doctrine, let an agent write ordered IF → action gambits, take direct control of a swarm, then release it. Explain planets, fog and particle-count victory without requiring sign-in. Keep two explicit paths: Play (existing entry) and Understand (static explanation/demo and guide). All explanations, transcript, guide and policy links must remain usable without JavaScript at 390px.

A compact, locally served real-game clip must show moving swarms, the model-selected gambits and human-side direct control/release. It must decode in the actual browser, expose native keyboard-accessible controls, not autoplay, and have a readable transcript plus timed descriptions. No real account, private URL, capability token, fabricated model output or claim of continuous AI inference. The opponent is house (normal), fixed gambits. The operator model chooses the exact opening in this native session; automation only submits those choices and operates the human-side UI. This is not evidence of a person playing or enjoying the game.

Media must be present in the static build and npm package and served by both local harnesses with correct types; exercise actual asset bytes and browser playback, not just source strings. Record capture source commit, simulation/renderer hashes, selected gambits, observed input/state evidence, timing, encoding command, media digest and reproduction steps. Tie this provenance to the final candidate without a circular self-hash.

## R1 focused repair (run 914)

Independent Sol rendered review of 87caf90dbb43954925388c9558e20f3c5c604402 requested changes: selection/white ring and “by hand” are visible, but directed travel and a dashed route are not discernible at 8.5–15.5 seconds. The recorded order (225,432) is near the swarm's existing (226,432); accepted input is not proof of visible travel. Preserve the original clip, poster, capture observations and historical verification. No redesign, new capture, gameplay/auth change or new PR.

Repair acceptance: introduction describes swarm selection, taking control and return to gambits; transcript describes the automated selection and issued order, not a visible journey; captions describe the white ring / “by hand” and subsequent green release status. None promises a visible dashed path or directed movement. Keep timing and all four cues. Add a real-browser consistency regression on rendered intro/transcript and active cues at 10s and 17.2s, observe RED before editing these surfaces, then run repository checks and browser suites under the shared lock. Refresh only the changed VTT digest, retaining its original digest as historical evidence. Sign a local descendant, preserve an independently fingerprinted recoverable archive and request coordinator-owned focused Sol recheck before any push or acceptance claim. Old Luna PASS is historical, not approval of the repair.

## Builder decisions (not additional owner decisions)

- Keep one HTML homepage. Add a labelled demonstration section and inline transcript before the unchanged sign-in/local entry; reuse cards, pink/blue/mint palette and responsive wrap. No new app/framework.
- Store the useful delivered media under media/: public-demo.webm (silent VP9), public-demo.vtt (timed descriptions), public-demo-poster.jpg. Native video controls, preload=none, no autoplay/loop. No network request to an external player. A direct download link and inline text remain if decoding fails.
- Use the existing loopback-only server on reserved port 39872 at real 20Hz speed. Record only the page viewport (not browser chrome), no developer overlays. Playwright records actual rendered frames; ffmpeg trims/encodes with no synthetic gameplay.
- A checked-in capture script documents and validates operator-selected choices, uses live API state and actual UI actions. Re-running makes another real match (random server seed), not byte-identical footage. The original clip's state observations remain recorded.
- Use explicit media allowlists in the local servers. Do not expose arbitrary filesystem paths. Static build recursively copies only the media directory's explicit delivered files. Preserve authentication and lifecycle logic.

## Implementation plan

> For agentic workers: use superpowers:executing-plans inline; independent final review is pre-created as t_d3de20ae. No duplicate review graph.

Goal: truthful real gameplay plus public explanation on the existing home.
Architecture: static HTML and native video with allowlisted local serving/build/package additions.
Tech stack: existing Node 24, Playwright/Brave and installed ffmpeg; no new dependency.
Spec: acceptance above and task/contract.

Global constraints: 390px no-JS reading; loopback 39872; serialize 8788/8789 browser fixtures using the prescribed flock; never use hosted backend settings. Ignored evidence lives in .cache/. Publication waits for the orchestrator's verified source-only destination and anti-deployment read.

Review focus: missing/partial media responses; blocked/unsupported playback; keyboard-only controls; narrow layouts and JS-disabled navigation; secrets/private tokens in captured frames or provenance. Each is checked below, not inferred from build success.

### Task 1: Real capture and provenance
- [x] Verify tools and unchanged baseline, launch only owned server, inspect live rules/state.
- [x] Choose gambits as operator model, document rationale, record actual match with manual-side UI selection/order/release and advancing simulation ticks.
- [x] Decode entire delivered clip, inspect frames, preserve sanitized observations and media digests. Confirm no fabricated inference, account or token in frame/text.
- [x] Commit only final useful media, capture script and provenance; leave raw recording ignored.

### Task 2: Public explanation and delivery (RED/GREEN)
Files: index.html, server.js, scripts/online-dev.js, scripts/build.js, package.json; test/public-pages.test.js, e2e/public-pages.spec.js, test/public-demo.test.js.
- [x] Add failing assertions for native video, transcript, explicit Play/Understand links, and delivered media; run targeted checks and record expected failures.
- [x] Add smallest HTML/CSS change and explicit asset serving/build/package paths. Preserve auth IDs/handlers.
- [x] Run targeted checks to green, including real HTTP bytes and clean build/package contents.

### Task 3: Candidate verification and handoff
- [x] At 390px without JS, follow both public paths, transcript, guide and policies; assert no horizontal overflow. Keyboard-focus native controls, play/pause/seek and decode with JS enabled.
- [x] Run npm test, npm run check, npm run build, npm pack --dry-run, locked browser/auth suites, local Convex harness. Inspect each command for remote writes first. Also exercise built/package assets, MIME, missing-route 404 and CSP-compatible same-origin requests.
- [ ] Self-review scoped diff, sign candidate with established key, report exact base/commit/tree and native session/run. Independent judge and exact-candidate scene check remain downstream gates; PR is not integration or production.

## Baseline and execution notes

- Locked dependencies installed with npm ci --ignore-scripts, no lockfile change, zero audit vulnerabilities.
- Initial npm test: 77/78 passed; browser launch failed before page load with Socket path too long under the profile's long TMPDIR. Unchanged offline browser regression passed with TMPDIR=/proc/self/cwd/.cache/tmp (directory resides in this task checkout). Use this environment for subsequent browser commands; no product workaround added.
- Executed results and limitations: public-demo-verification.md. Capture provenance: public-demo-capture.json. The final signed identity is in the task handoff. PR publication remains held by the orchestrator's Git/auto-deployment read and source-only destination binding, not missing OAuth. Independent review and Sol scene check remain downstream gates; a skill read alone is not evidence they ran.
