# Cloudflare runtime

Hosted duels use the particle simulation. Match sockets send an initial `snap`, indexed `step` inputs and periodic hashes, and position-free `meta` updates; clients can request a fresh snapshot with `resync`. Snapshots expose the full simulation to browsers, so fog is display-only there; agent views remain fogged.

The Worker serves `https://play.botters.havesomecode.io`, including `/mcp`. `wrangler.jsonc` defines the custom domain, D1 `DB`, native `EMAIL`, assets, Durable Objects and scheduled cleanup. Email is open to all recipients and uses `botters@mail.havesomecode.io` as sender. Set `BETTER_AUTH_SECRET` as a Worker secret. Google sign-in is optional; when enabled, set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`, and configure its callback as `https://play.botters.havesomecode.io/api/auth/callback/google`.

For local verification, run `npm install`, `npm run check`, `npm test`, `npm run build:worker` and `npx wrangler deploy --dry-run --outdir .cache/release`. When explicitly authorized, apply migrations with `npx wrangler d1 migrations apply botters-play --remote` and deploy with `npx wrangler deploy`.

`npm run usage` reads from remote D1 and prints counts only; run it only with authorization to access production data. Match usage records contain no player identifiers. Returning-player counts use retained authentication session timestamps, so expired or deleted sessions can make historical counts incomplete.
