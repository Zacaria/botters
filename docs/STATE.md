# Botters — state (18 November 2026)

## Goal

A real-time space strategy game you play with your own AI agent: you set the doctrine, the agent writes the swarm rules, and you take over by hand when it matters. Players sign in, play online 1v1 or against the house bot, and plug in ChatGPT, Claude Code, Codex or any MCP client.

## What works today

- **Website:** https://botters.havesomecode.io (Vercel, project `botters`), with sign-in through Google or a verified email, online matchmaking, rooms, house matches, guide, privacy and terms pages. Old address https://botters.vercel.app still answers.
- **Live host:** https://play.botters.havesomecode.io (Colyseus on the Lightsail Paris instance, Convex for accounts, Elo and history). `/health` reports build `d86f8e3`, `activeMatches: 0` on 18/11.
- **Remote MCP:** https://play.botters.havesomecode.io/mcp (OAuth). ChatGPT and Claude Code have each completed a real match through it (Claude Code: match `cAo6-GBWR88Cr6HcseVl2ulWEZgRGMyA`, 18/11, lost to the Normal house bot).
- **Local:** `npx -y github:Zacaria/botters` (house game, no account) and `npx -y github:Zacaria/botters install` (stdio MCP for Claude Code, Codex, Cursor, Windsurf, Claude Desktop).
- **"Play with Claude" button:** opens `claude.ai/new?q=<prompt>` with the same prompt as ChatGPT. The prompt and connector path were played end to end from Claude Code on 18/11; the claude.ai web chat itself still needs one owner test. `master` fixes the lobby so the button appears right after connecting an agent (production still needs the "With my agent" click).
- **Production lags `master`:** the website and live host run `d86f8e3` (30 Oct). `master` adds manual swarm routes (Shift+drag, PR #32) and match-bound actions. A separate Vercel project, `start-hero`, auto-deploys `master` (https://start-hero.vercel.app). `npx github:Zacaria/botters` clients already get the `master` code.

## What is left to make the product viable (in order)

1. **Ship `master` to production**: website plus live host, following [colyseus.md](colyseus.md#deployment). Check a match end to end at the real URL afterwards. *Sonnet.*
2. **Play a real match with "Play with Claude"**: done from Claude Code on 18/11; fixes merged to `master`. Remaining: Zacaria tries the button once in claude.ai.
3. **Count real usage**: weekly signups, online matches, agent-played matches and returning players, from Convex aggregates and without exposing personal data, shown somewhere the owner can read. *Sonnet.*
4. **Decide the three open PRs**: #19 (swarm looks) and #20 (swarm groups), plus #4 (account-cost and auth-form repair). Rebase each onto `master`, play a match, then merge or close. *Opus* (gameplay judgement).
5. **Cloudflare Email** replaces Resend for sign-in emails (18/11): `online/auth-options.js`, sender `no-reply@mail.havesomecode.io`.
6. **First contact polish**: the trailer caption is in French on an English page, and new players face a lot of setup text before the first match. *Haiku.*

## Cloudflare / PostgreSQL / Better Auth migration — verdict

- **Better Auth: done**, already in production through the Convex component.
- **PostgreSQL: dropped.** It was superseded by the Cloudflare port on 8 November. The branches are deleted; only commits not on GitHub are kept, in `archive/2026-11-18/*` tags.
- **Cloudflare port (Workers + D1 + Durable Objects + native email): built, not adopted.** It is running at https://botters.chtatar-zacaria.workers.dev, with PvP verified between two owner accounts. Source: tag `archive/2026-11-18/fix/cloudflare-say-t_50f4127c` (28 commits on `d86f8e3`), plus the working-tree snapshot `archive/2026-11-18/migration/cloudflare-20261108`. Still missing: a rebase on `master` (12 shared files conflict, including `index.html`, `online/game.js` and `server.js`), email open to every player (currently owner-only), the Google callback on the new origin, the custom domain, a new MCP connector URL, and **importing existing accounts and Elo** (the port explicitly imports nothing).
- **Worth it now? No.** Players see no difference. It costs at least two sessions plus a data migration, and would put existing accounts at risk. It only saves the Lightsail VM and Convex. Reopen it only if their cost or reliability becomes a real problem.

## What we drop

Independent-review, preflight, "evidence" and parity cards and branches (Luna/Sol review snapshots, release preflights, revocation-race qualification under 2 s, the Convex "≤ 50 calls per match" re-measurement, PostgreSQL refusal proofs). The archived tenants `botters-cloudflare` and `botters-stack-migration` stay closed. The committed `docs/pvp-*.json` and `docs/evidence/` files are history: do not extend them.

## Real blockers (need Zacaria)

1. Feature 2 needs a Claude.ai account with the Botters connector added: will you run that match yourself, or give a session to an agent?
2. The Cloudflare worker `botters` (holding two owner test accounts in D1) is still live: keep it or delete it?
