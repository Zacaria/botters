# Botters announcement trailer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver a genuinely watchable roughly 60-second real-game trailer with licensed music, burned French captions and readable cause/effect.

**Architecture:** Reuse native offline server, real renderer and capture script; edit the recorded viewport with installed ffmpeg. Replace the existing served demo bytes and static description/transcript, preserving the historical clip in Git and original evidence. No gameplay changes or media framework.

**Tech Stack:** Existing Node 24, Playwright/Brave, ffmpeg/libass/VP9/Opus.

**Spec:** docs/contributions/announcement-trailer.md (signed brief d8bef777). Card authority permits bounded production, not a newly fabricated human design approval. Inline execution and existing coordinator-owned Luna/Sol seats remain the execution/review route.

## Global Constraints

- Roughly 60 seconds, 16:9, 1080p; French first cut, meaningful burned captions, licensed music, no fabricated model response.
- Only owned loopback server 39872, real-time simulation; no game state mutation beyond native inputs, no hosted services or accounts.
- No new dependency, purchase, contact, provider/profile change, merge or deployment; no push before new exact-candidate reviews.
- Shared browser fixture lock at /home/hermes/.hermes/cache/scratch/botters-contribution-browser-fixtures.lock for fixed ports 8788/8789. Raw material under ignored .cache/trailer/.
- Preserve historical R1/915 evidence. Source and new media provenance must distinguish automated human-side operation from a human participant and house fixed rules from a model opponent.

## Review Focus

- Silent/unchanged footage: ffprobe actual streams/duration/dimensions and full audio/video decode, no placeholder output.
- Unreadable phone captions: render actual encoded frames at 390px and inspect, not string assertions alone.
- Claimed manual travel without motion: record same swarm positions, order and release plus inspect actual frames, require displacement >100 game units.
- Music rights or clipping: exact primary license/source/credit/hash and decoded loudness/peak receipt; no clearance inferred from search.
- Missing public delivery or stale transcript: source/build/actual npm package media bytes, native browser playback and consistent French timeline; JS-disabled public reading.

## Task 1: Discriminating media contract

Files: test/announcement-trailer.test.js; docs/contributions/announcement-trailer-production.md.
Interfaces: consumes current media/public-demo.webm; produces tests requiring actual 1920x1080 video, 55–65s duration, audio stream and decoded non-silent soundtrack plus timeline/provenance digest binding.
- [ ] Add test `announcement trailer has a real music stream and a one-minute 1080p picture` using ffprobe JSON and assertions: video width1920/height1080, duration55–65s, audio channels>=1.
- [ ] Run `node --test test/announcement-trailer.test.js`; observe expected failure on existing silent40s1440x900 file before replacing anything.
- [ ] Record production decisions and observed failure, without claiming creative review.

## Task 2: Capture and edit the five-beat film

Files: scripts/capture-announcement-trailer.js (reuse existing capture logic); scripts/edit-announcement-trailer.py; docs/contributions/announcement-trailer-{capture,edit,music}.json; media/public-demo.{webm,vtt}; media/public-demo-poster.jpg; index.html static demo block; test/public-demo.test.js; e2e/public-demo.spec.js.
Interfaces: capture produces ignored raw viewport video and sanitized timestamp/state receipts. Edit consumes explicitly listed source spans and verified licensed music, produces final media plus French transcript/cue timeline. No invented inference.
- [ ] Capture actual rule-following with readable native HUD, conquest/growth, opponent pressure, long-distance manual travel/release and genuine payoff. Record source hash, inputs, tick/position/ownership/count observations. Recapture or rewrite unsupported claims.
- [ ] Verify primary music license and exact file; retain source/hash/credit/edit spans. Coordinate existing research through own card only.
- [ ] Edit five beats with deliberate reframing/cuts, a brief musical contrast, burned large French captions and held BOTTERS/invitation/credit. Preserve cause/effect and real outcome; do not claim victory unless captured.
- [ ] Replace silent asset and matching static intro/transcript/VTT. Keep native controls, no autoplay and same explicit serving/build/package allowlist. Adapt obsolete R1 current-media tests while retaining historical provenance tests against preserved evidence.
- [ ] Run media test to GREEN, full decode and actual phone-frame inspection. Commit scoped production after tests.

## Task 3: Verify, review readiness and recovery

Files: docs/contributions/announcement-trailer-verification.md; ignored .cache/trailer/handoff/; stock review template filled with exact candidate.
Interfaces: consumes finished film and source; produces signed candidate, tree, SHA256(git archive tar) fingerprint and recovery bundle/archive for coordinator-owned same Luna/Sol seats.
- [ ] Execute npm test/check/build/actual npm pack; locked browser/auth suites and local Convex suite after reading commands. Record exact output and limits.
- [ ] Exercise actual source/build/package HTTP bytes, native play/pause/seek/end, muted phone playback/captions and JS-disabled390px paths; inspect full sequence and decoded audio dynamics/peak.
- [ ] Self-review scoped diff, guard unchanged gameplay scripts, run git diff --check; sign commit with established config. Verify signature, clean tree and exact-head receipts.
- [ ] Prepare stock review request and recoverable bundle/archive; independently clone bundle and verify HEAD/tree/fsck and fingerprint. Request coordinator new Luna/Sol on new bytes before push. Required exact-head CI remains separate; local result is not integration, production, human enjoyment or marketing efficacy.

## Plan self-review

All five storyboard beats, actual music, burned captions, primary rights, phone render, unchanged native behavior and new-byte review/CI gates map to tasks2/3. Capture offsets are selected only after observing real footage, never prescribed as evidence in advance. Existing tests/delivery are reused; one media assertion and two small production scripts are the intended additions. This plan implements the source-bound card; no new owner choice or approval is asserted.
