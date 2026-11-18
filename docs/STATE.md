# Botters — state (18 November 2026)

## Goal

A real-time space strategy game you play with your own AI agent: you set the doctrine, the agent writes the swarm rules, and you take over by hand when it matters. Players sign in, play online 1v1 or against the house bot, and plug in ChatGPT, Claude Code, Codex or any MCP client.

## What works today

- **Website:** https://botters.havesomecode.io (Vercel, project `botters`), with sign-in through Google or a verified email, online matchmaking, rooms, house matches, guide, privacy and terms pages. Old address https://botters.vercel.app still answers.
- **Live host:** https://play.botters.havesomecode.io (Colyseus on the Lightsail Paris instance, Convex for accounts, Elo and history). `/health` reports build `de3ce4e` (`master`, 18/11). The remote MCP gateway and Convex functions run the same commit.
- **Remote MCP:** https://play.botters.havesomecode.io/mcp (OAuth). ChatGPT and Claude Code have each completed a real match through it (Claude Code: match `cAo6-GBWR88Cr6HcseVl2ulWEZgRGMyA`, 18/11, lost by wipe-out to the Normal house bot).
- **Usage counts:** `npm run usage` prints, per week for the last 8 weeks, verified signups, online matches, agent (MCP) matches, house matches and returning players. Counts only, never ids or emails. It needs `CONVEX_URL` and `CONVEX_DEPLOY_KEY` (production values live in `/opt/stacks/botters/.env` on the live host). Signups and returning players come from Better Auth history. Match counts start on 18/11, when the live host began storing one `usage:` record per finished match: older matches expired after a day and cannot be recovered.
- **Local:** `npx -y github:Zacaria/botters` (house game, no account) and `npx -y github:Zacaria/botters install` (stdio MCP for Claude Code, Codex, Cursor, Windsurf, Claude Desktop).
- **"Play with Claude" button:** opens `claude.ai/new?q=<prompt>` with the same prompt as ChatGPT. Prompt and connector were played end to end from Claude Code on 18/11 (PR #37); the claude.ai web chat itself still needs one owner try. PR #37 also keeps "With my agent" selected once an agent connects.
- **Production = `master`** (`de3ce4e`, deployed 18/11 on website, live host, MCP gateway and Convex): manual swarm routes (select a swarm, Shift+drag), Play with Claude (PR #37), the auth repair (PR #38: the Create account form no longer snaps back to Sign in, and the site's own session checks no longer trip the 100-per-10-minute auth limit), usage records (PR #39) and English trailer captions (PR #40). Checked at the real URL: house match `xOTUEXbd2KHOnjTOZU7bpea4gp9xfez2` finished normally (lost by wipe-out, route accepted) and shows in `npm run usage`; a password-reset mail arrived from `botters@mail.havesomecode.io`. A separate Vercel project, `start-hero`, auto-deploys `master` (https://start-hero.vercel.app). `npx github:Zacaria/botters` clients get the same code.

## What is left to make the product viable (in order)

1. **Play a real match with "Play with Claude"**: done from Claude Code on 18/11, PR #37 is live. Left: Zacaria tries the button once in claude.ai.
2. **First contact**: decide whether signed-out visitors get a literal Play entry; today the first screen asks them to sign in.

## Cloudflare / PostgreSQL / Better Auth migration — verdict

- **Better Auth: done**, already in production through the Convex component.
- **PostgreSQL: dropped.** It was superseded by the Cloudflare port on 8 November. The branches are deleted; only commits not on GitHub are kept, in `archive/2026-11-18/*` tags.
- **Cloudflare port (Workers + D1 + Durable Objects + native email): built, not adopted.** It is running at https://botters.chtatar-zacaria.workers.dev, with PvP verified between two owner accounts. Source: tag `archive/2026-11-18/fix/cloudflare-say-t_50f4127c` (28 commits on `d86f8e3`), plus the working-tree snapshot `archive/2026-11-18/migration/cloudflare-20261108`. Still missing: a rebase on `master` (12 shared files conflict, including `index.html`, `online/game.js` and `server.js`), email open to every player (currently owner-only), the Google callback on the new origin, the custom domain, a new MCP connector URL, and **importing existing accounts and Elo** (the port explicitly imports nothing).
- **Worth it now? No.** Players see no difference. It costs at least two sessions plus a data migration, and would put existing accounts at risk. It only saves the Lightsail VM and Convex. Reopen it only if their cost or reliability becomes a real problem.

## What we drop

Independent-review, preflight, "evidence" and parity cards and branches (Luna/Sol review snapshots, release preflights, revocation-race qualification under 2 s, the Convex "≤ 50 calls per match" re-measurement, PostgreSQL refusal proofs). The archived tenants `botters-cloudflare` and `botters-stack-migration` stay closed. The committed `docs/pvp-*.json` and `docs/evidence/` files are history: do not extend them.

## Real blockers (need Zacaria)

1. "Play with Claude" needs a Claude.ai account with the Botters connector added: will you run that match yourself, or give a session to an agent?
2. The Cloudflare worker `botters` (holding two owner test accounts in D1) is still live: keep it or delete it?
