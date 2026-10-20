# Swarm-depth / OAuth MCP integration

## Candidate contract

Combine approved swarm head `bb249e1c6bcb8670751ffc935012e41c530b1ae3` with current `pvp-online` head `cd5dadea98d28f266b53e708e3b8d309215c7765` using an ordinary signed merge. Preserve both histories, the per-test browser backend isolation and the OAuth grant/session/revocation boundaries. This is a source-only release candidate for PR #18; no production deployment or provider mutation is authorized here.

Default's earlier `merge-check` commit `a918e9c3d45c8334dfa3ea7b0a0fb6df329267da` has parents `a1449ad` and `cd5dade`. Recomputing its automatic merge yields the same tree `7b5f7a7dcc342d64d2e33b4266ce4cfe58b599d8`. It predates bb249e1's browser-isolation repair, so this candidate merges the baseline directly into bb249e1 instead of adopting that older merge. Default subsequently produced signed `1a44d32f3c9700909c56c7851458d7f25a7283e0`, merging the same baseline and changing only gateway seven-tool expectations to eight; preserve that concurrent integration ancestry with an ordinary merge, retaining this candidate's stronger exact-name and morph assertions. No edits are made in default's workspace.

## Integration regression

The combined client exposes eight game tools: join_match, wait_for_event, set_gambits, order_swarm, split_swarm, morph_swarm, release_swarm and call_human. The OAuth gateway forwards their actual stdio schemas unchanged. Historical seven-tool pilot evidence remains historical, not a claim about this candidate.

The initial combined Node suite reproduced five failures in `test/web-mcp.test.js`: seven-tool count assertions received eight. Replace those stale counts with an explicit complete tool-name contract, retaining schema parity, session isolation, admission limits, refresh/revocation and child-cleanup assertions. Exercise morph_swarm through the real HTTP/stdio gateway, verify its resulting swarm type, and include it in revoked/pending agent denial coverage.

The initial parallel Node run also timed out the real two-process MCP reapproval test at 125 seconds. A focused unchanged replay passed in 72 seconds; treat that as a verification warning until the complete final suite passes. Do not extend the timeout or weaken assertions to hide it.

## Verification and release boundary

Run locked dependency install, repository syntax/JSON checks, production build, all Node tests, all local Brave browser tests, local auth browser tests, and offline Convex auth tests. Verify all four house modes and keep human rooms/queue as duels through the existing mode-picker and online tests. No separate lint/type/format command is configured.

Record exact signed SHA/tree, integration parents, final checks, changed paths, artifact verification, exact-head GitHub required CI and remote readback in the task handoff. Independent review `t_c274105c` must approve this combined candidate before release `t_abfb2be1` resumes. These local fixtures do not prove real Google login or a Claude/ChatGPT model-played match.
