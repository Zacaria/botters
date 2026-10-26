# Remote MCP authorization

## Contract

Implement OAuth 2.1 for the remote MCP endpoint and push the reviewed source on its own branch. Do not deploy the website, Convex functions, match host or gateway as part of this source change. Local stdio play remains unchanged.

Reuse the installed MCP SDK authorization router for discovery, dynamic client registration, authorization-code flow, S256 PKCE, token exchange and revocation. Publish the canonical `/mcp` resource and require that exact resource and the single `botters:play` scope. Do not advertise OIDC identity, CIMD, issuer-identification extensions or client-authentication methods that are not implemented. DCR is the supported first version; it is supported by both target browser connectors.

## Account consent

The authorization transaction creates a real existing `/agent/pair` request. Its consent page identifies the requesting application's supplied name and registered callback origin, explains the actual agent permissions, and opens the existing Botters sign-in/approval screen in another tab. The original tab waits for approval and returns to the OAuth client automatically. Browser-bound, expiring transactions prevent another browser from completing a captured consent link; completion and cancellation require same-origin POSTs. No passwords, account cookies or human-control tokens pass through the gateway.

Only the upstream `/agent/poll` result can establish approval. OAuth grants retain this approved agent capability, not a human capability or an invented account ID. A new approval keeps the existing rule that it replaces the previous agent. Disconnecting the agent in Botters invalidates its OAuth access too. Tokens do not permit human account management or bypass the player's decision to start a match.

## Tokens and isolation

Issue opaque short-lived access tokens and rotating refresh tokens, bound to one registered client, one grant and the canonical resource. Authorization codes are short-lived and single-use, bound to the client, exact callback and PKCE challenge. Detect spent refresh-token reuse and revoke its grant; revocation invalidates the entire grant. Reject foreign resources, unknown scopes, token reuse and expired or revoked credentials. Never accept an upstream game token as an OAuth token or forward an OAuth token upstream.

Persist client registrations and grant/token state atomically to an explicitly configured private state file outside the source tree. Keep its parent private, the file mode 0600, and bind state to this issuer and upstream origin. Store hashes of OAuth secrets; upstream agent capabilities must remain private to the gateway. Bound clients, pending approvals, grants and token history. This first version is a single-process gateway, not a horizontally shared authorization service.

Every MCP request needs a valid bearer token, including initialized sessions, GET streams and DELETE. Bind each transport session and in-process tool instance to its OAuth grant. All sessions of one grant share a single tool instance, so match state survives assistants (ChatGPT) that open a new MCP session per tool call; a grant keeps at most eight sessions (oldest idle one dropped; HTTP 429 with retry-after: 1 if all are busy) and the gateway limit counts instances, not sessions. Token refresh preserves that grant; another grant cannot reuse or delete the session. Pass only its approved agent capability directly to its tool instance. A revoked grant must not silently fall back to the instance's anonymous pairing flow. Keep the discovery-session admission repair and the existing hard instance/session ceiling.

## Run the gateway

### Existing Lightsail ingress

The deployment target is a separate MCP container on the existing Botters Lightsail instance, behind the existing `play.botters.havesomecode.io` HTTPS origin. The connector URL is `https://play.botters.havesomecode.io/mcp`. No new DNS, AWS resource, website release or match-container replacement is required. This is the target configuration; publication is verified separately in the release evidence.

`deploy/mcp-compose.yaml` uses the existing private `botters_default` network with no published port. `deploy/mcp-entry.js` consumes the already-tested gateway API and binds port 8798 inside that private container; the ordinary CLI below remains loopback-only. The dedicated state directory must be created privately for UID 1000 before startup. Set `BOTTERS_MCP_RELEASE` to the exact source commit and `BOTTERS_MCP_STATE_DIR` to that absolute directory; run Compose with `--env-file /dev/null` so no game credentials are loaded. Do not share the game's `.env` with this service.

The Caddy matcher forwards only MCP/OAuth routes to the sidecar and preserves the game's existing routes, `/health`, 16 KiB body ceiling and process. MCP routes are limited to 64 KiB. Their application-generated consent CSP/referrer policy is preserved, and Caddy removes the unrelated live-host proof cookie before forwarding. Validate configuration and private health before a graceful Caddy reload; retain the previous Caddyfile for rollback. Do not recreate the game or Caddy containers merely to reload routes.

### Standalone loopback process

Use Node 22+ on a POSIX host. Install the repository's locked dependencies, choose a stable HTTPS origin and keep its reverse proxy's original `Host` header. The gateway listens only on loopback; do not put it behind a public path that changes its issuer or `/mcp` resource. `mcp.example.com` below is a reserved example, not a provisioned Botters address.

```sh
BOTTERS_SERVER=https://botters.havesomecode.io \
BOTTERS_MCP_ORIGIN=https://mcp.example.com \
BOTTERS_MCP_OAUTH_STATE="$HOME/.local/share/botters-mcp/oauth.json" \
PORT=8798 node web-mcp.js
```

OAuth is the default. Missing or unsafe state configuration fails startup; only `BOTTERS_MCP_ALLOW_NO_AUTH=1` explicitly enables the historical temporary pilot. Never use that exception for the authenticated service. API tests use the equivalent explicit `oauth: false` option.

The state file must be outside the checkout, owned by the service user and mode 0600 in a mode-0700 parent. The service creates a new private parent and file; it rejects existing permissive files, symlinks and state for another issuer/upstream. It contains private upstream agent credentials and must not be committed, served, logged or copied into build artifacts. Keep it across ordinary restarts. Losing it invalidates connector registrations and tokens; users must reconnect. Use one gateway process per state file. Pending browser consent does not survive a restart.

The implemented endpoints are `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server`, `/register`, `/authorize`, `/token`, `/revoke`, `/consent`, `/consent/complete` and `/consent/cancel`. Connectors use OAuth with automatic dynamic registration, client-authentication method `none`, scope `botters:play` and resource `<origin>/mcp`. A client must explicitly register method `none`; confidential client secrets and OIDC scopes are not supported. No provider API key is required.

Access tokens last ten minutes; codes two minutes; consent requests ten minutes. Grants and refresh history expire after at most seven days and fail sooner when Botters revokes the underlying agent. Refresh tokens rotate without extending that grant. The private store is capped at 8 MiB, 256 registrations, 512 grants, 256 outstanding codes and 4,096 token-history entries; pending consent is capped at 128. Exhaustion fails closed rather than erasing clients or granting more resources. The standalone gateway defaults to eight live MCP instances (the container caps them at 128) and reclaims unused discovery sessions. Capacity or multi-instance operation requires an explicit operator change, not a silent reset of account/delegation state.

The existing site asks the verified player to approve the agent in a separate tab; the consent tab returns to the connector automatically. Cancel returns `access_denied`. The consent page uses `Referrer-Policy: same-origin` to preserve Chromium's native-form Origin header without sending a referrer to another origin; its CSP permits the form's redirect only to the registered callback origin. Other OAuth responses keep `no-referrer`.

## Verification

Use real local HTTP routes, the installed SDK, the existing account-protected OnlineGame handler with isolated test identities and real in-process tools. Observe failing tests before implementation. Cover OAuth discovery and challenge, no-token denial before spawning, PKCE and redirect/resource/scope binding, explicit pending/approved consent, cancellation/expiry, refresh rotation/reuse, revocation, persistence/restart, cross-grant session isolation and upstream revocation. Run repository checks and obtain independent read-only security review of the final bytes before signing and pushing.

These offline checks do not prove a production account login, ChatGPT or Claude connection, or a model-played match. Those remain separate activation checks. No provider subscription, production secret or deployment is needed to implement and verify the source.

## References

- MCP authorization: https://modelcontextprotocol.io/specification/latest/basic/authorization
- OpenAI MCP authentication: https://developers.openai.com/apps-sdk/build/auth
- Installed implementation contracts: `@modelcontextprotocol/sdk/server/auth/router.js`, `provider.d.ts` and the existing `client.js` capability injection.


## Deploying the website

Production Vercel builds bake `public/live-config.json` from build-time variables. Deploy with `vercel deploy --prod --build-env BOTTERS_LIVE_URL=https://play.botters.havesomecode.io --build-env BOTTERS_REQUIRE_ACCOUNT=1`, then check `curl https://botters.havesomecode.io/live-config.json` returns the live URL. Without them the lobby calls the control site and every signed-in player gets HTTP 410. Each new MCP tool instance reads that file on creation; existing instances keep their current configuration.

## In-process memory measurement

Local Node process, separate local game server: each agent joined a headless match and called `wait_for_event`. RSS was sampled after garbage collection; baseline was 85.1 MiB. These are process-level observations, not a production capacity guarantee.

| Agents | RSS MiB | Growth MiB | Growth MiB/agent |
| ---: | ---: | ---: | ---: |
| 1 | 95.8 | 10.7 | 10.69 |
| 8 | 98.0 | 12.9 | 1.62 |
| 32 | 106.5 | 21.4 | 0.67 |
| 64 | 123.1 | 38.1 | 0.59 |

The container allows 128 instances with a 512 MiB memory/swap limit; remeasure under actual traffic before raising it. The game server's separate 24-match limit is unchanged.
