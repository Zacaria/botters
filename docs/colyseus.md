# Live matches on Lightsail

This supersedes the checkpoint/subscription architecture in `pvp-spec.md`. Historical measurements in `pvp-release.md` describe the previous deployment, not this candidate.

## Authority and transport

One Colyseus room owns each match. `sim.js` advances at 20 Hz in server memory; recipient-filtered frames go over WebSockets at 12.5 Hz. The same in-memory game accepts MCP HTTP inputs/events. Private rooms, queue, input logs, presence and reconnect state live in this process. A dropped browser reconnects to the same match; process loss interrupts unfinished matches rather than silently replaying them from Convex. Finished reports, Elo and session history survive restarts.

The website and account flows stay on Vercel. This release preserves the currently active anonymous production mode. Human and agent capabilities are separate; the live service subscribes to capability/session authorization only (never match state), fails closed on a disconnected channel, and revalidates half-open channels every 90 seconds. Expiry remains explicit. Identity is never accepted from client-supplied account IDs.

The separately gated account rollout is not activated here. Its cookie-bound human tokens are deliberately rejected by anonymous live mode; enabling account mode fails at startup until a reviewed cookie-to-live-session exchange exists. This avoids weakening the already-reviewed cookie requirement merely to cross origins. Offline mode remains separate.

Convex is used for session/capability checks and match start/end boundaries, Elo and history. Simulation ticks, frames, events and inputs do not call Convex. Boundary writes must be atomic and idempotent; failed result persistence is retried without double-rating a result. The measured release target is at most 50 Convex function calls per full eight-minute match, including authorization refreshes and persistence. Count actual adapter calls, not an extrapolated frame-rate reduction.

## Deployment

The owner selected an existing Lightsail $12 / 2 GB Paris instance. Deploy Docker Compose (Botters plus Caddy) in `/opt/stacks/botters`; only Caddy binds public ports 80/443. SSH is key-only with `~/.ssh/botters_lightsail`; public firewall initially allows 22/80/443 only. Card `t_a2f00cae` owns Tailscale setup, tags/ACLs and closing public port 22 after tailnet SSH is confirmed. This app deployment must leave public SSH unchanged until that handoff. Do not create AWS resources or IAM. Keep the game container memory-limited. The only service credential on the instance is the Convex deployment key. Domain: `play.botters.havesomecode.io`; the owner provides the instance IP. No homelab/VPN/monitoring integration in this card.

Release must use the previously deployed unauthenticated site as its base and carry only live-migration changes. Do not promote the separately gated account UI/API merely because it exists on `pvp-online`.
