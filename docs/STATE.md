# Botters — state (21 November 2026)

## Goal

A real-time space strategy game you play with your own AI agent: you set the doctrine, the agent writes the gambits every battalion follows, and you take over by hand when it matters. Since 21/11 every match is the particle war (one particle = one unit, planets that breed); browsers replay the match locally from the orders the server relays (DESIGN.md). Players sign in, play online 1v1 or against the house bot, and plug in ChatGPT, Claude Code, Codex or any MCP client.

## What works today

- **Site and game:** https://play.botters.havesomecode.io, served by one Cloudflare Worker `botters-play`: static client, Better Auth on D1 `botters-play`, match Durable Objects over WebSocket, native email, remote MCP + OAuth at `/mcp`. Operations: `docs/cloudflare.md`.
- **Old address:** https://botters.havesomecode.io (Vercel project `botters`) redirects every path to the play origin.
- **Accounts:** email sign-up open to everyone (mail from `botters@mail.havesomecode.io`) and Google sign-in (callback `https://play.botters.havesomecode.io/api/auth/callback/google`). The database started empty on 19/11: no accounts or Elo were imported.
- **Checked at the real URL on 19/11:** two new accounts signed up by email and verified from an outside inbox, then played a full online 1v1 (match `9PBH3n3kPVHEzP76eQwZNcOBkWXj-aPn`, both drew a manual route, finished on time); Google sign-in returned to the signed-in lobby; MCP OAuth metadata answers on the new origin.
- **Agent doctrine (21/11):** agents read the battle per battalion and rewrite or toggle gambits with a reason; hand orders are human-only (an agent asks with `call_human`). The match panel lists each edit (time, author, change, reason). Checked at the real URL: Claude Code over the stdio client beat the house `blob` with 8 live edits (about $2.2 of model usage for a 3–5 minute match).
- **Usage counts:** `npm run usage` reads D1 through wrangler and prints weekly counts only.
- **Local:** `npx -y github:Zacaria/botters` (house game, no account) and `npx -y github:Zacaria/botters install` (stdio MCP for Claude Code, Codex, Cursor, Windsurf, Claude Desktop).

## What is left to make the product viable (in order)

1. **Reconnect the agents:** the MCP URL is unchanged (`https://play.botters.havesomecode.io/mcp`), but OAuth clients registered on the old server are gone, so ChatGPT and Claude must add the connector again.
2. **First contact:** decide whether signed-out visitors get a literal Play entry; today the first screen asks them to sign in.

## Old infrastructure still running

Nothing points to these any more; Zacaria decides when to stop them: the Lightsail instance in Paris (`51.44.31.107`, `/opt/stacks/botters`), the old hosted backend `fastidious-kookabura-364`, the test Worker `botters` (https://botters.chtatar-zacaria.workers.dev) with its D1 `botters`, and the old origins in the Google OAuth client's authorized URIs.
