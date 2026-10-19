# Announcement trailer — production decisions and execution

Spec: announcement-trailer.md. Implementation plan: ../superpowers/plans/2026-10-18-announcement-trailer.md. Native session20261018_111025_4722ef/run919; production base d8bef777dd31ae1362d26c3095fd1625381d88d0. The signed coordinator brief is authority for bounded production, not newly invented human design approval.

## RED, before new media

`node --test test/announcement-trailer.test.js`: exit1,0/1 pass. Exact failure: “announcement must contain a real music stream, not silent capture”. Old shipped capture has no audio; unchanged baseline `npm test` passed81/81 before adding this gate. Full receipt: ignored .cache/trailer/red.log. Probe executed on actual bytes, not a declared manifest.

## Builder decisions

- Reuse native renderer/server and existing media serving/build/package paths; no game/auth code change. Capture one real3-minute match with selected five-rule opening (retreat larger enemies, split above5000, approach weaker enemies, free/enemy planet conquest), house normal fixed rules. The operator model chooses once; the capture script does not invoke a model.
- Capture1920x1080 viewport, use deliberate editorial crops/enlargement only; real-time source intervals except explicitly noted transitions. No fabricated gameplay, chat, victory or model control.
- Manual sequence: genuine selection/map click/G, target over220 game units away, same-swarm displacement over100 before release. Actual opponent proximity recorded; do not label a fallback as danger without visible threat.
- French burned captions are editorial explanation, distinct from native English HUD. Short high-contrast captions large enough for390px view; primary score/license evidence required before music import.
- Final review belongs to coordinator's existing Luna/Sol seats on new fingerprint before push. Historical PASS and repaired bootstrap do not approve film.

Execution ledger: ignored .superpowers/sdd/2026-10-18-announcement-trailer/progress.md. Raw takes and intermediate exports: ignored .cache/trailer/. Actual verification and limits are recorded in announcement-trailer-verification.md; new independent reviews remain pending.

## Executed recipe

Use only an owned loopback listener39872 (check availability first), Node24 and installed ffmpeg/Playwright. No hosted backend. Browser commands here use the checkout-local short TMPDIR to avoid the inherited Linux socket-path limit.

1. `PORT=39872 BOTTERS_ORIGIN=http://127.0.0.1:39872 node server.js`
2. `mkdir -p .cache/tmp` then `TMPDIR=/proc/self/cwd/.cache/tmp node scripts/capture-announcement-trailer.js`
3. The actual retained take is `.cache/trailer/take-2026-10-18T11-15-07-470Z/capture.json`; its raw video is hash-bound. A new execution starts a genuinely new random match, not byte-identical footage.
4. `python scripts/edit-announcement-trailer.py <capture.json> <verified sb_resonance.mp3>` produces a master under ignored .cache/trailer/edit/, the three allowlisted media files and the exact edit manifest. The private source MP3 stays outside public media. Full primary licence proof and source hash are in the music manifest; never substitute an unverified file.
5. `node --test test/announcement-trailer.test.js test/public-demo.test.js` checks actual media/provenance/serving/build/package behavior. Repository/browser/auth/Convex commands and actual artifact playback are recorded in the verification report.

Six real export iterations are preserved ignored: first cut, native by-hand/return insets, readable native rules/tighter payoff, explicit win objective, caption lower-quarter repair, then the measured native-overlay refinement. The repair is based on actual embedded390px paused-player screenshots: the native overlay is taller than the initial lower-quarter assumption. A decoded-pixel safe-band regression was RED at18s before margin56→300px, and a tighter measured-band regression was RED at47.8s before margin300→400px. The manual sentence stays on one line to avoid covering the selected swarm. The public player/game code was not changed to hide this problem.
