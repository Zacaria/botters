# Authentication

The Cloudflare Worker serves Better Auth at `https://play.botters.havesomecode.io/api/auth`. Email/password accounts require email verification. Reset and verification messages use the native `EMAIL` binding with sender `botters@mail.havesomecode.io`. Google sign-in is optional and requires both `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`; its callback is `https://play.botters.havesomecode.io/api/auth/callback/google`. Store secrets as Worker secrets.

Human sessions, human capabilities and agent grants are separate. Agents need explicit, revocable approval and never receive account cookies. Account deletion removes account-owned game data. Local tests use isolated D1 and synthetic mail, never production identity. Sign-in and email actions are rate limited; session reads are exempt.
