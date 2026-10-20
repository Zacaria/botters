# Announcement trailer — executed local verification (run 919)

## HQ re-render (20 Oct 2026) — supersedes the figures below

Cause of the pixelated shots: the game canvas is 1200×700; the old edit cropped and enlarged it up to 3×. Fix: capture-only `scripts/hq-render.js` draws the same canvas ×3 (simulation, rules and inputs untouched) in a headed kiosk Brave at device scale 2 on a 3840×2160 Xvfb, grabbed by ffmpeg (x11grab, H.264 4:4:4). Brave's analytics notice is pre-acknowledged in the profile; otherwise a banner shifts the frame.

New take `take-2026-10-20T19-39-11-245Z` (random match, house normal): time/won, pink 35,483 vs blue 8,532 at 170 s; manual order on swarm 1 at 65.06 s, displacement 200.5, release 80.2 s. Selection rule (`.cache/judge.py`): no defeat or wipe, first conquest before 16 s, manual displacement >100, a late conquest, pink ≥ 80% of blue at 170 s; 3 of 6 earlier takes were lost or wiped, 2 crashed before writing a receipt.

Re-timed shots (match seconds): rule 4 at 1 s; planet 24 flips at 8.8 s; planet 4 at 14.6 s; retreat battle 44–55 s; manual order/travel 65–78 s; release 78–81 s; "later" shot 154.5–158.5 s, planet 10 turns pink at 156.1 s (film ≈ 50.6 s); invitation over 171–178 s. Crops are applied to the 3840×2160 source (layout px ×2).

Shipped bytes: `public-demo.webm` 18,258,141 bytes, SHA256 `f3694f043cc42dbb7adf3402700c22aa84cf316aa3bf2f2e1a52080f1d8cf351`; poster SHA256 `e837b799a5caa9bc3b86aa4c9867156c51f3d0dd4597b083cbbdad7f9094a850`; VTT unchanged. `npm test` 86/86 after re-aiming the two ownership-fill probes at planet 10 (6×4 px window). Not rerun on this revision: `npm run check`, build, pack, browser/auth suites, full-decode/loudness, 390 px player checks. Wide shots are sharp; the 3× close crops (shots 1–3, 10) still show the particle grain of the game itself. No Luna/Sol review of these bytes yet.

## Identity and scope

Task t_1e2be52d; native session `20261018_111025_4722ef`, run919, profile contrib-superpowers, model gpt-6.1-sol/provider openai-codex. Existing isolated checkout/branch only. Production base `d8bef777dd31ae1362d26c3095fd1625381d88d0`; original product base `8871d4842eaf900362052ea1ed3879027a1fa5aa`; inherited reviewed CI baseline `3e0c15df37b584c2a688332a09759495c4a71bf0`. Exact final signed commit/tree and SHA256(git archive tar) fingerprint are in the native handoff/recovery capsule, avoiding a circular self-hash in this source document.

This is a new film, not the old silent clip's R1 copy repair. Historical candidates, source/scene verdicts, R1 rejection, run915/error/breaker remain preserved. This document records author execution/self-check, not new Luna/Sol approval or human enjoyment. No push, feature merge, deployment, provider/profile/auth change, spend or contact occurred in this run.

## Delivered film

`media/public-demo.webm`: 14,363,067 bytes, SHA256 `b467075591a69280f72f8cc1e1c4556f95a038e1263e28b2f4cf3e6160e0e20a`. Actual ffprobe:1920x1080,16:9,VP9,30fps,stereo Opus48kHz; container60.018s, video track59.933s. Eleven native-game source shots, thirteen burned French caption cues and matching optional VTT. The website does not auto-play or prefetch the movie; native keyboard controls and transcript remain.

`media/public-demo.vtt`: SHA256 `dd62274548b65c2b90380a893e85bdb51a0ff943682be67aca2563dc59b9c82b`.

`media/public-demo-poster.jpg`: SHA256 `0b24f79618f4300f193b16f3afee65357e573f540e25ee10baf068b3be39d6fe`.

The H.264/AAC1080p master is retained ignored at `.cache/trailer/edit/botters-announcement-1080p.mp4`; it is not an extra public site asset. The public film itself includes music credit, source, licence and modification notice. No standalone source MP3 is shipped.

## Narrative and actual evidence

- 0–8s: actual native rule4 free_planet→go enlarged over moving game, then planet14 changes neutral→pink. No long logo/menu opening.
- 8–20s: more planet captures and growing particle swarms; explicit goal inside the film: most particles at match end. Pink/blue roles stated before the confrontation.
- 20–33s: native rule1 bigger_enemy_near(1.15)→retreat, contemporary confrontation and real rule0 movement toward allied swarms; short musical breath at31–33s.
- 33–49s: uninterrupted source65–81s for actual swarm217 manual order/travel/release (one editorial cut with unchanged crop). Observed position456,320→658,247, displacement214.7859399495 game units, order target672,242. Same swarm is manual=true, then G restores manual=false. Enlarged by-hand/green return statuses are contemporaneous native source pixels, not fabricated UI.
- 49–53s: explicit “same match, later” jump to source144–148s. Planet7 becomes pink at observed146.22s. No claim the manual order instantly captured it or caused victory.
- 53–60s: held BOTTERS, “Découvrez Botters.”, real URL and exact Scott Buckley credit/licence/modification notice over darkened continuing native gameplay. No Steam listing, release date or testimonial invented.

Provenance: `announcement-trailer-capture.json` contains source hashes, opening, native inputs,33 projected real observations and complete ownership transitions. Full original receipt/raw video remain in ignored evidence and are hash-bound; projection is declared, not represented as a complete state dump. Capture server used only owned loopback39872. It ran at the native nominal20Hz wall clock; no forced seed/state, simulation acceleration, fake chat or model response. Opponent: house normal/fixed rules. Operator model selected opening once; capture script never invokes a model. Automated human-side UI is not a human participant.

Native simulation ended time/won46444:153, but the captured UI did not yet display the completed result when recording closed. The film therefore claims no completed victory. Native counterfactual also says withoutHuman won; no causal victory claim is inferred from manual movement.

## Music and checks actually executed

Common preproduction input: coordinator research deleg_4841e226, separately attributed, not Superpowers implementation. Exact Resonance/Scott Buckley source MP3 SHA256 `264be9c44c32419b6de70f0ac24c92f81401419419c8fb111b8e19e62261331b`; author's primary track/usage pages and CC BY4 legal code inspected and retained with hashes. `announcement-trailer-music.json` records clearance, exact requested credit, permitted synchronized use and limitations. No purchase/account. Contiguous source145–205s, level rise, two-second breath, fades and headroom limiter; exact filter/timeline in `announcement-trailer-edit.json` and small edit recipe.

Executed on final media/source before signing:

- Baseline before changes: Node81/81.
- RED: ffprobe test failed specifically on missing audio in old clip; served browser failed specifically on stale silent intro; new provenance manifest absent; decoded second-cut contrast test failed before shifted breath export. Receipts retained, not called product passes.
- GREEN `npm test`:84/84,0 fail,0 skip, including actual stream/dimensions/duration, decoded soundtrack headroom/contrast, burned-caption safe-area pixels, byte-serving/ranges/build/package provenance tests.
- `npm run check`:77JS files, inline scripts and JSON checked; no separate lint/type/format tool configured. Python edit recipe executed successfully for six real export iterations.
- `npm run build`:8public assets. No hosted backend target; built live-config URL null.
- Actual `npm pack` tarball extracted, not just a dry-run manifest.
- Shared-lock browser suites:12/12; auth browser4/4. The auth negative stolen-ticket/logout case deliberately logs a rejected connection (“Sign in again”/4002), while its test passes. Earlier progress shorthand said3 auth tests; the actual current suite is4, as recorded in the receipts.
- Local `npm run test:auth:convex`:4/4 in3files; local in-process harness only, no hosted account/data.
- ffmpeg `-xerror` full video+audio decode: exit0, empty error log. Decoded final mix: integrated -19.3LUFS, LRA8.7LU, true peak -5.0dBFS. PCM test proves actual non-silence, headroom and31–33s contrast; it does not prove artistic fit.
- Real source, built-CSP static and extracted npm-package processes each served exact final media bytes/MIME/ranges/404. At390px with JS off/on, native Space play/pause, ArrowRight seek, active French cue and seek/end passed; Play/Understand/transcript/guide/policies stayed navigable without overflow or external player requests.
- Source fixture additionally played the whole film sequentially muted at390px to ended, with over1000decoded frames; exact elapsed/frame count in artifact receipt. Actual encoded390px contact sheet plus rule/manual/return/payoff/title frames inspected. Main French captions and native status inset were checked as pixels, not merely source strings.
- `git diff --check` passed. Inline game/auth script and CSS byte contents identical to production base (recorded SHA256); sim/server/build/allowlist/package/lockfile/workflow/Vercel config not changed by this revision.

Full command outputs, lock dwell timestamps, fixture PID/CWD/hash bindings and pre/post-signing receipts live in ignored `.cache/trailer/`; the recovery capsule carries decisive receipts. Signing and exact-head reruns are recorded by the final native handoff, not assumed from this pre-signing report.

## Remaining limits and gates

- No subjective audio audition is available in this worker. Actual licensed music, decode, dynamics/headroom, synchronization and muted visual story were exercised; musical emotional fit and edit rhythm still need the new independent rendered-film review, not a made-up listening PASS.
- Linux Brave/Chromium only; no Safari/Firefox, physical phone, production/CDN or real-player enjoyment/marketing conversion test.390px is browser emulation. Native HUD pixels are enlarged and remain raster-soft; fine-print credit URLs are smaller than primary captions on phones. Native controls can temporarily overlay lower picture while interacting; fullscreen/download and transcript remain.
- Planet ownership uses dark tinted fills and capture arcs, not bright solid particle clouds. The later capture is factual in state and continuous pixels, but subtle at phone size; render judge must assess clarity without relying on the transcript.
- Six local cut iterations remain in ignored evidence with real receipts, including rejected-by-author shortcomings; no prior PASS transfers to final movie bytes. The embedded paused-player check found captions obscured by controls: lower-quarter margin300px was insufficient for the actual overlay. Tighter decoded-band RED at47.8s preceded margin400px and a single-line manual sentence. Media3/3 GREEN and the final uniquely named actual390px paused screenshot confirm “G : retour aux gambits.” now clears time/volume controls; no webpage/game change hides the issue.
- Same coordinator-owned Luna source and separate Sol6.1 rendered-video seats must review the new exact fingerprint before a source-only push of PR1. Actual repository-required exact-head CI must follow publication; neither local tests nor old CI establishes it. Feature merge/deployment remain unauthorized. Final whole-branch review is requested, not completed by a skill read.
