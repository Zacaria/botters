# Authentication

The Cloudflare Worker serves Better Auth at `https://play.botters.havesomecode.io/api/auth`. Email/password accounts require email verification. Reset and verification messages use the native `EMAIL` binding with sender `botters@mail.havesomecode.io`. Google sign-in is optional and requires both `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`; its callback is `https://play.botters.havesomecode.io/api/auth/callback/google`. Store secrets as Worker secrets.

Human sessions, human capabilities and agent grants are separate. Agents need explicit, revocable approval and never receive account cookies. Account deletion removes account-owned game data. Local tests use isolated D1 and synthetic mail, never production identity. Sign-in and email actions are rate limited; session reads are exempt.

An account can keep several agents connected at once (for example Claude and ChatGPT through `/mcp`, plus a local client): approving a new agent leaves the others working. **Disconnect agent** in the lobby revokes every agent token of the account. An agent token may read its side, rewrite gambits, call its human and start a **house** match with the agent (`POST /play` with `vs` easy, normal or hard; `withAgent` is forced on). It cannot start a match against players, join rooms, give hand orders or touch the account.

OAuth refresh tokens rotate. A spent refresh token presented again within 30 seconds (clients that refresh concurrently) receives fresh tokens; presented later, it ends the whole grant.
