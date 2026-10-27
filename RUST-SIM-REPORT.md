Complete.

- `npm run build:sim` succeeded. `npm test` passed 258 tests.
- The unchanged golden suite passed both tests covering 104 traces. The browser suite's saved result was `passed` with no failed tests; its local test list contains 51 tests. The context tool timed out after five minutes while Playwright continued, so the saved result and test listing provide the count and status.
- Offline browser tests exercised a local match and the moving menu backdrop through the shared WASM simulator. View snapshots matched the before-port simulator across 40 matches in all four modes.

The Rust struct owns match entities, gambits, tick and outcome. The JavaScript wrapper exposes snapshots and restore; live matches reuse process-local handles, write separate checkpoints and free handles on sweep. The live ceiling remains 24 rooms.

Before: commit `717ced7`. After: this checkout. Both series ran on this machine with Node v24.21.0, `MATCHES=<n> SECONDS=10 node scripts/measure-live-capacity.js`, 80 swarms per match and two loopback views. The fixture bypasses room admission only in its process. Each series stopped at the first minimum FPS below 10. RSS is peak bytes; frame p95 is the maximum across views. The short synthetic sample is not a production capacity guarantee.

| Matches | Before CPU % of one core | Before min FPS | Before frame p95 ms | Before RSS bytes | After CPU % of one core | After min FPS | After frame p95 ms | After RSS bytes |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 16 | 100.02 | 12.48 | 124.37 | 267452416 | 77.05 | 12.50 | 120.66 | 281731072 |
| 24 | 107.63 | 12.03 | 152.93 | 291692544 | 104.65 | 12.49 | 128.44 | 309194752 |
| 32 | 103.20 | 6.52 | 305.37 | 287305728 | 107.55 | 12.47 | 137.12 | 246726656 |
| 48 | — | — | — | — | 110.59 | 11.07 | 118.84 | 367464448 |
| 64 | — | — | — | — | 108.40 | 8.27 | 205.08 | 380444672 |

Deleted the JavaScript RNG and map generator, gambit decision and action logic, movement and combat loops, planet capture and growth, merge and starvation logic, fog and totals calculations, and the temporary per-tick movement/combat/fog array interfaces. Snapshot arrays now cross the boundary only for explicit state reads, restoration, and view output.
