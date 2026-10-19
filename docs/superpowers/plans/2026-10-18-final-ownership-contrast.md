# Final ownership contrast Implementation Plan

> For agentic workers: use superpowers:executing-plans inline, task-by-task. Bounded repair authority is the updated card, not invented human approval; independent review remains pending.

Goal: improve the actual49–53s disk fill separation without another crop-only change.
Architecture: reuse capture and ffmpeg pipeline, adding one static whole-shot RGB midtone curve before captions; preserve all timing and other assets.
Tech Stack: installed ffmpeg/Python stdlib/Node24/Playwright/Brave.
Spec: docs/contributions/announcement-trailer-contrast.md; t_1e2be52d.

## Global Constraints

Same real event, crop and1x speed; no painting, freeze, fake victory, gameplay change, new dependency/graph, push/merge/deploy. PCM/captions/poster/rights/auth/service limits unchanged. Preserve both independent historical verdicts. Existing checkout only.

## Review Focus

- Colour lift must cover the whole shot, not synthesize ownership: inspect recipe/manifest plus raw source hash and timing invariants.
- Dark disk versus bright existing rim/swarm: decoded interior neutral-before, persistent brighter coloured-after at308px; actual natural playback308/946px, controls visible.
- Caption/credits/other shots: apply curve before captions; compare VTT/poster hashes, other shot metadata and unaffected decoded picture PSNR.
- Soundtrack: real full decode and exact decoded PCM equality to preserved f7d4fd6 movie.
- Delivery: actual source/build-CSP/extracted npm fixture bytes/range/MIME/native keyboard, plus canonical suites; physical-phone and subjective-listening limitations explicit.

## Task 1: uniform shot grade with regression and handoff

Files: test/announcement-trailer.test.js; scripts/edit-announcement-trailer.py; generated media/public-demo.webm and docs/contributions/announcement-trailer-edit.json; acceptance/report docs/contributions/announcement-trailer-contrast.md; EOF-only hygiene docs/contributions/announcement-trailer-sol-film-01.md. Ignored evidence .cache/trailer/contrast/run930/.
Consumes: hash-bound existing capture.json and cleared music MP3. Produces: same60s film with shot9 `grade` manifest field and no other story change.

- [ ] Write decoded interior test at50/51.5/52.5: before neutral/dark, after median red≥160 and luminance ratio≥2.0; adjust historical classifier red ceiling220 without dropping its other protections.
- [ ] Run node --test test/announcement-trailer.test.js; require correct RED on f7d4fd6, preserve receipt.
- [ ] Add shot9 curves all='0/0 0.2/0.15 0.42/0.82 1/1':interp=pchip before captions and record grade; run existing full export. Preserve original VTT/poster exactly. (Ruling after first natural-spline attempt: preserve shadow neutrality and late-state separation; see ledger.)
- [ ] Run targeted GREEN and full npm test; repair EOF blank line. Inspect actual new player screenshots/natural playback at308/946px.
- [ ] Run npm run check/build, locked browser/auth suites, local Convex, real npm pack/extraction and existing artifact verifier, full ffmpeg decode, PCM equality and shot/source/caption/rights invariants.
- [ ] Report executed checks/limitations; self-review scoped diff, git diff --check, scoped signed commit with signature verification; exact candidate archive and verified recoverable capsule.
- [ ] Stock full-branch review request to same existing Luna/Sol through coordinator, no author approval or new graph.

Plan self-review: one repair unit, no new interface except optional shot9 grade metadata. Every card requirement maps to a step. Tone thresholds are regression guards only; independent perception gate remains outside producer authority. Native execution already mandated by card; no interactive design decision is missing.
