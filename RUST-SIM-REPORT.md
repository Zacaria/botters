# Rust simulation progress

Incomplete. Rust creates initial planet and swarm geometry and computes side totals; the rest of the simulation and all live match state remain in JavaScript.

- Added a wasm-bindgen 0.2.100 crate with V8-style two-argument hypot, mulberry32, initial geometry and side totals, a WASM build script, source hash, and focused tests. Node and browsers load the same artifact; static builds, package and Docker include it.
- Initial geometry and the remaining JavaScript simulator pass all 104 golden traces. Rust match parity is not established: stepping, inputs, gambits, fog and reports have not been ported. The golden fixtures and tests were not changed.
- The Node suite passed 256 tests in an isolated checkout copy with temporary files outside that copy but inside the worktree. The browser run before the totals change had 50 passed and one connection-refused failure; the failed offline result-sharing test passed on its isolated rerun. The browser suite has not been rerun since the totals change.
- Before-port benchmark (`MATCHES=16 SECONDS=10 node scripts/measure-live-capacity.js`): 16 matches, 80 swarms/match, 32 views, 103.44056906008441% CPU of one core, minimum 12.449938623351702 FPS, maximum frame p95 117.32376399999976 ms, peak RSS 258355200 bytes, passed.
- Partial-port benchmark (same command): 16 matches, 80 swarms/match, 32 views, 102.25170479159416% CPU of one core, minimum 12.469882595401867 FPS, maximum frame p95 120.14898799999992 ms, peak RSS 271745024 bytes, passed. This is not an after-port measurement: stepping and live state remain in JavaScript.
- Deleted code: the JavaScript map generator and RNG.
- Remaining: Rust match state, stepping, inputs, gambits, fog, view, replay, live registry and lifecycle, full Rust golden parity and post-port benchmark. The 24-room ceiling remains unchanged.
