# Cloudflare runtime

The Worker serves `https://play.botters.havesomecode.io`, including `/mcp`. `wrangler.jsonc` defines the D1 `DB`, native `EMAIL`, assets, Durable Objects and scheduled cleanup. The sender is `botters@mail.havesomecode.io`; Google is optional. `SITE_URL` is the canonical origin. Set `BETTER_AUTH_SECRET` and optional Google credentials as Worker secrets.

Run `npm install`, `npm run check`, `npm test`, `npm run build:worker` and `npx wrangler deploy --dry-run --outdir .cache/release` locally. Deployment, provider changes and remote database operations require explicit authorization. `npm run usage` reads aggregate usage inputs from remote D1 and prints counts only; run it only with authorization to access production data.
