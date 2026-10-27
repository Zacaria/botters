Incomplete.

Rust creates initial planet and swarm geometry, computes side totals, determines fog visibility, and calculates swarm movement and combat. Match state and the remaining simulation still live in JavaScript. Movement and combat use temporary arrays across the WASM boundary, so they do not satisfy the Rust-owned state requirement and are not evidence of a speedup.

- This round: `npm run build:sim` succeeded; `npm test` passed all 256 tests; the separate golden suite passed both tests covering 104 traces. Fixtures were unchanged.
- Deleted the JavaScript movement and combat calculation loops, replacing them with Rust calculations while keeping existing JavaScript swarm objects and tuning constants. The rest of `step` remains in JavaScript.

- Added a wasm-bindgen 0.2.100 crate with V8-style two-argument hypot, mulberry32, initial geometry and side totals, a WASM build script, source hash, and focused tests. Node and browsers load the same artifact; static builds, package and Docker include it.
- Initial geometry and the remaining JavaScript simulator pass all 104 golden traces. Rust match parity is not established: stepping, inputs, gambits, fog and reports have not been ported. The golden fixtures and tests were not changed.
- The Node suite passed 256 tests in an isolated checkout copy with temporary files outside that copy but inside the worktree. The browser run before the totals change had 50 passed and one connection-refused failure; the failed offline result-sharing test passed on its isolated rerun. The browser suite has not been rerun since the totals change.
- Before-port benchmark (`MATCHES=16 SECONDS=10 node scripts/measure-live-capacity.js`): 16 matches, 80 swarms/match, 32 views, 103.44056906008441% CPU of one core, minimum 12.449938623351702 FPS, maximum frame p95 117.32376399999976 ms, peak RSS 258355200 bytes, passed.
- Partial-port benchmark (same command): 16 matches, 80 swarms/match, 32 views, 102.25170479159416% CPU of one core, minimum 12.469882595401867 FPS, maximum frame p95 120.14898799999992 ms, peak RSS 271745024 bytes, passed. This is not an after-port measurement: stepping and live state remain in JavaScript.
- Deleted code: the JavaScript map generator and RNG.
- Fog visibility now runs in Rust through a temporary array boundary; its JavaScript visibility algorithm was deleted. `npm run build:sim` succeeded and `npm test` passed 256 tests, including all 104 golden traces. This is not yet the Rust-owned state required by the contract.
- Baseline rechecked in this checkout: `npm test` passed 256 tests, and a separate `node --test test/golden-sim.test.js` passed both golden tests (104 traces). No new port code has been added in this round.
- Baseline rechecked again: `npm test` passed 256 tests in 97 seconds. Existing simulation tests directly replace and mutate `s.swarms` and `s.planets`, and retain swarm object references; the Rust handle adapter must preserve those behaviours as well as the field reads and JSON property order used by the golden checksums.
- Remaining: Rust match state and handle, the rest of stepping, inputs, gambits, view, replay, removal of the temporary movement, combat and fog array boundaries, live registry and lifecycle, full Rust golden parity, browser suite, before/after benchmark series, and documentation updates. The 24-room ceiling remains unchanged.
