# Spec: the simulation runs in Rust

Owner decision (26 Oct 2026): move the simulation to Rust for raw speed, measure before and after, then raise the live room ceiling (24, `online/live-runtime.js`) to the new measured limit.

## Why the shape below

The live server spends each frame (per room, 10 per second) on more than `step()`: `LiveRuntime.frames()` parses and re-serialises the whole match record, then `OnlineGame` reloads it, steps twice and commits it as JSON again. A Rust `step()` fed by a JSON-serialised JS object would pay that cost anyway. The state must live in Rust between frames for the change to give raw speed.

## Contract

1. **One implementation.** Rust crate `sim/` (Cargo, no network access at runtime) compiled to WebAssembly (`wasm32-unknown-unknown`, wasm-bindgen). The same `.wasm` runs in Node (live server, local `server.js`, tests, report replays) and in the browser (offline mode, menu backdrop). The JavaScript simulation logic is deleted.
2. **No Rust needed to use or deploy the game.** The built `.wasm` and its JS glue are committed, listed in `package.json` `files`, copied by `scripts/build.js` and the game `deploy/Dockerfile`. `npx github:Zacaria/botters`, Vercel and Docker builds must not need cargo. A test fails when the committed artifact does not match the crate sources (e.g. source hash stamped at build time); `npm run build:sim` rebuilds it.
3. **`sim.js` keeps its exports and behaviour** for every caller (`online/game.js`, `server.js`, `index.html`, tests, scripts): constants, `CONDITIONS`/`ACTIONS` docs, `checkGambits`, `matchOptions`, `createMatch`, `addSwarm`, `applyInput`, `step`, `replay`, `totals`, `view`, `rules`, `describe`, `rad`. Cold helpers may stay in JS; the hot path (`step`, gambit conditions, fog/`seen`, `view`, `replay`) runs in Rust. Callers that read state fields (`tick`, `ended`, `seed`, `opts`, `teams`, `endTick`, `swarms`, `planets`, `gambits`) keep working.
4. **Same game.** Before deleting the JS logic, record golden traces from the current JS: at least 24 seeds × each mode, with the HOUSE and DEFAULT gambit sets and a scripted input log (gambits, toggle, order, split, release, surrender), checksum of the full state every 100 ticks and the final state. The Rust version must reproduce them bit for bit (match JS float semantics: V8 `Math.hypot`, `Math.round`, iteration and Map insertion order, the mulberry32 RNG). If an exact match proves impossible for a specific operation, stop and report it with the evidence instead of loosening the test.
5. **Live state stays in Rust.** The live runtime no longer JSON-parses/serialises the simulation state on every frame. Keep a process-local registry of live match handles; the stored match record keeps its metadata, players and input log. Finished-match reports, Elo/history boundaries, rematches, private rooms, reconnects and the `/state`, `/events`, `/input` contracts stay unchanged. Report replays (`whatIf`) run in Rust. Release handles when a match is finished and swept.
6. **Measure, then raise the ceiling.** Same machine, same script (`scripts/measure-live-capacity.js`, 80-swarm fixture), before (master) and after: matches 16, 24, 32, 48, 64… until minimum FPS < 10. Record CPU % of one core, min FPS, frame p95, RSS. The new ceiling is the largest count that keeps every view ≥ 10 FPS on the production instance, with margin; it replaces 24 in `online/live-runtime.js` and `docs/colyseus.md`.

## Not in scope

Multi-process or worker-thread sharding; Colyseus, MCP gateway or protocol changes; gameplay balance changes.

## Done when

Golden-trace parity passes; `npm test` and `npm run test:browser` pass; offline browser match and menu backdrop run on the WASM sim; before/after measurements are recorded in `docs/colyseus.md`; independent review passes; production runs it and a real ChatGPT match completes.
