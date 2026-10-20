# Remote MCP web pilot

> Historical no-auth pilot and HTTPS evidence. The current gateway defaults to OAuth; see [`mcp-oauth.md`](mcp-oauth.md). The recorded probe and review below apply to the original hashes, not the OAuth implementation. No real assistant match has been validated.

## Outcome and source

Try one complete match from Claude Web and one from ChatGPT, with no local Node installation for the player. Start from the current `origin/pvp-online` candidate `d26971f4086039731028ac68dd50a5fe925af4ca`, not the stale local `master`. The existing public game, verified-account boundary, human approval and agent revocation stay unchanged. Do not deploy or replace the existing website, Convex functions or live match container for this experiment.

## Smallest implementation

Expose a separate Streamable HTTP MCP gateway. Each initialized MCP session owns a separate existing stdio `client.js` process. Forward its seven existing game tools, schemas, results and errors instead of copying the game client or introducing another authorization system. Never start a browser on the gateway host. The child connects to the explicitly selected existing HTTPS game origin and asks the signed-in human to approve its limited agent access using the existing pairing screen. Connecting an MCP session does not itself grant game access.

The gateway is a temporary pilot: bounded concurrent sessions, bounded request size, finite idle lifetime, host/origin validation, cancellation/error isolation and process cleanup. Do not log tool arguments/results, capability tokens, account records or conversations. A health route may return aggregate session counts only. Tool annotations must describe real read/write effects and cannot disable provider consent.

## Original pilot running and exposure

Run the gateway on loopback behind a temporary HTTPS tunnel. Discover and verify the exact public origin before allowing remote requests. Expose only this gateway, never the repository, shell, local offline server or other services. No new paid resource, global browser/provider configuration, account credentials or production deployment. Stop the gateway and tunnel after the pilot unless an explicit human handoff still consumes them.

The connector uses no transport-level authentication during this isolated pilot; all gameplay remains behind the already-existing account login and explicit per-agent approval. MCP session IDs are not user identities. Separate sessions must never share a child or game capability. This is not a public OAuth release or a claim of compatibility.

## Verification

### Discovery-session admission repair

The user reported `RATE_LIMITED: Session limit reache` from ChatGPT; the gateway's aggregate health simultaneously reported eight sessions, its configured ceiling. The existing lifecycle reserved a child for every initialized transport for up to ten idle minutes, including transports used only to inspect tools. This establishes saturation of this gateway, not a ChatGPT usage quota or evidence that OAuth is missing. It does not establish which client created each session.

Under admission pressure, reclaim only an initialized discovery-only session which has never called a game tool, is not closing and has no metadata RPC in flight. Keep the total session/child ceiling unchanged. Never reclaim a session that has attempted a tool call: it may contain a pending approval, a live match capability or a long poll. Preserve in-progress initialization and discovery requests. A reclaimed session must subsequently return the existing 404 unknown-session response; legacy Streamable HTTP clients must reinitialize. Recheck capacity after asynchronous cleanup so concurrent admissions cannot exceed the ceiling. Return a short Retry-After with a real 429 when all slots are protected. Report only aggregate discovery/tool-session counts in health, never IDs, tool parameters, results or identities.

Regress repeated metadata discovery without DELETE, preservation of a pending-approval session and a real limit when every slot is protected. Do not raise the ceiling or remove isolation. Deploy the gateway repair only after current live-match activity is zero; never restart the production game/site. OAuth 2.1 account linking and per-account quotas remain separate work requiring their own implementation and verification. The Claude subscription cap is not a reason to run more Claude tests.

1. Add a focused runnable transport test; observe it fail before implementation. Use an isolated local game fixture, not real player accounts.
2. Verify discovery of all seven tools, two-client isolation, pairing/lobby responses, invalid or unknown session rejection, host/origin and size limits, bounded admission, and cleanup. Run applicable repository checks.
3. Exercise the external HTTPS endpoint with a real MCP client. Confirm that it uses the same reviewed game/account boundary, not a fabricated response.
4. In each actual assistant, create the connector, discover tools, approve its agent from the real game account, complete a timed match and inspect the result. Record prompts, confirmations and unintended turn endings without copying private chats or credentials.

Record results separately as transport-verified, connected, paired and full-match-verified. A scripted MCP client or simulated browser is not proof of a Claude Web or ChatGPT match. If sign-in, account plan or explicit provider consent is unavailable, preserve the tested code and exact handoff; do not mark that assistant passed.

## Verified checkpoint — 19 October 2026

- The parent reran `node --test test/web-mcp.test.js` (6 passed), `npm test` (190 passed, no skips/failures) and `npm run check` successfully. No original game source was changed.
- Independent read-only Sol review returned **PASS for the temporary pilot, with no MUSTFIX**. It reran the six focused tests and checked duplicate initialization, unknown-method/terminated-session isolation and exclusion of synthetic private parent variables. It did not validate either real assistant, production approval enforcement independently of the existing client, or actual cancellation of upstream work. Transport authentication, request/concurrency rate limiting, stronger abuse controls and demonstrated upstream cancellation remain public-release work, not claims made by this pilot. Reviewed gateway SHA-256: `ad5cfee26a9ed14284b3fccb9cc279201caa0258970ab835fb99c76e55aaa194`; focused-test SHA-256: `0736e12b4937949ee17feb5cecb9ed6f361bc3d84ccd97ba9f017e3eba734d71`.
- A real SDK client initialized through the public HTTPS tunnel, discovered exactly seven tools, called `join_match` against the real account-protected website, received the existing pending-approval flow and deleted its MCP session. Aggregate sessions were 0 before, 1 during and 0 after. Sanitized output: [`evidence/web-mcp-https-verification.json`](evidence/web-mcp-https-verification.json). No pairing capability or full approval URL is retained there.
- The first probe incorrectly assumed an `/agent/approve` URL; it failed an assertion. Inspection of `online/game.js:174` established the actual `/?pair=...` route. The check was corrected and rerun; the gateway was restarted to clear the first probe's unclosed transport. No human approval or match was started by either probe.
- Claude Web and ChatGPT account connection, explicit game approval and a complete model-played match remain **not performed**. VM Brave showed signed-out provider pages; existing Mac browsers did not yield a verified task account through the available permitted controls. No browser security setting was enabled and no login/consent challenge was bypassed. All six task-created provider tabs across VM/Mac were closed; Mac stable-tab-ID readback confirmed absence.

## Original temporary human test handoff (no-auth mode only)

Current endpoint: `https://presidential-recruitment-pour-celebrities.trycloudflare.com/mcp`. It is a Cloudflare quick tunnel for this pilot, not a stable/public product URL. The initial localhost.run tunnel rotated addresses and was stopped before handoff. The current tunnel binary was obtained from the official Cloudflare release and verified against its SHA-256 release digest; it runs with an isolated HOME and no account configuration.

For a deliberate repetition of this historical no-auth probe only, use `BOTTERS_MCP_ALLOW_NO_AUTH=1 BOTTERS_SERVER=https://botters.havesomecode.io BOTTERS_MCP_ORIGIN=https://presidential-recruitment-pour-celebrities.trycloudflare.com PORT=8798 node web-mcp.js`. Without the explicit no-auth flag, current source requires OAuth and `BOTTERS_MCP_OAUTH_STATE`. The constructor is `createWebMcp({ server, origin, oauth, maxSessions, maxRequestBytes, idleMs })`; `oauth: false` is the explicit test-only escape hatch. The CLI binds only `127.0.0.1`. Defaults remain eight sessions, 64 KiB per MCP request and ten minutes of transport inactivity.

Reproduce transport/pending-approval verification with `BOTTERS_MCP_URL=https://presidential-recruitment-pour-celebrities.trycloudflare.com/mcp BOTTERS_PROBE_PAIR=1 node scripts/verify-web-mcp.js`. The optional pairing probe creates only an unapproved ten-minute request, not an account or match. Without `BOTTERS_PROBE_PAIR=1`, it checks transport and tool discovery only.

In Claude Web, add a custom connector named Botters with the endpoint above and no authentication. In ChatGPT, the official guide currently describes Plugins → plus → Add custom MCP server, then the endpoint, authentication, explicit risk acknowledgement and Create as a plugin. The human must perform any unavailable sign-in or provider consent. After selecting Botters in a new conversation, use: “Play Botters with me. Call join_match, give me the approval link, then wait for my match. Follow my doctrine and keep observing until the result.” Start one three-minute house match from the real game lobby after explicit approval. Record whether the assistant actually stays in the loop, how many user relaunches/confirmations are needed and whether it receives the final result. Repeat independently in the other assistant.

Official ChatGPT procedure checked on 19 October 2026: https://developers.openai.com/apps-sdk/deploy/connect-chatgpt/ . Menu availability still depends on the actual account/workspace; no new subscription is authorized by this pilot.
