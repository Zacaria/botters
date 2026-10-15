# Public Botters pages

Owner decision, 16 October 2026: publish a working public homepage, privacy policy and terms at `https://botters.havesomecode.io` so Google OAuth branding can be configured. A logo is not required. This slice does not enable sign-in or publish Google branding.

## Public routes

- `/`: the existing game introduction, usable without signing in or running JavaScript, with visible policy links. Existing lobby and match behavior stays intact.
- `/privacy`: a plain HTML privacy policy describing actual hosted-game data practices, local storage, Vercel and Convex processing, retention, the player's own AI provider and contact/rights requests.
- `/terms`: plain HTML usage terms covering the game, agent access, fair use, availability and contact.

Both policies link home and to each other, work without JavaScript, and remain public when authentication is introduced. `/privacy.html` and `/terms.html` serve the same documents. Build only the five intended browser assets. Serve the canonical routes in Vercel, the online development harness and the packaged local server; include the two policy documents in the package manifest.

Policy copy follows the implemented session model, not a fictional account system. Session/token records use seven-day expiry refreshed by writes; match/log records use a one-day expiry refreshed by writes; rating and room-index records do not all have automatic expiry. Provider logs/backups have separate retention. Clearing browser storage is not a server-side deletion request. Google account data must be documented again against the final provider implementation before activation; do not claim a currently working Google login.

## Verification and release

1. Add failing checks for public links, static build output, routes and packaged policy documents.
2. Verify public pages with JavaScript disabled, keyboard navigation, narrow-screen layout and an unknown-route 404; run repository test/check/build commands.
3. Obtain independent review of the exact source and reader-facing copy. Integrate through the existing PvP source owner, avoiding its active checkout. Publish only after coordinating the current production correction.
4. Read back both Vercel aliases, DNS and strict TLS. Request `/`, `/privacy` and `/terms` through the actual public custom hostname and verify content and links; a forced-IP check is diagnostic evidence, not proof every recursive DNS cache has converged.

No secrets, paid resources, account changes, gameplay changes or new authentication dependencies are part of this slice. Keep the existing `botters.vercel.app` hostname working without a redirect.

## References

- Google homepage and policy requirements: https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance#host-home-page
- CNIL privacy-notice information: https://www.cnil.fr/fr/informer-les-personnes
- Implementation: `index.html`, `online/game.js`, `online/store.js`, `online/http.js`, `convex/store.js` and `convex/crons.js`.
