# Public-policy release

Source: signed integration `74128966c71f4a8e85ab748fdcdbeb78f6d6df58` on `origin/pvp-online` (exact remote readback). Operator attachment 182 SHA-256 `5201eba23e04eaa61ff7900113ff2d537cb5badc0267a976f9bd9004fc343aca` was integrated without changing any source bytes. Its twelve-file sorted `path sha256\n` manifest is `66e32c11a7d15f4f6153fac3320ae8b4709cca7d64997c72aafa4023264e1ade`. Auth WIP was isolated and not published; API/game/Convex source is unchanged from runtime `4211338`.

Independent Sol review passed on this exact slice (operator handoff on task `t_d5e91f48`). Fresh owning-lane verification: 42/42 Node tests, syntax/JSON checks, five-asset build, 10-file package dry run, six Brave scenarios (four gameplay plus no-JS/mobile policy checks), `git diff --check` and signature verification all passed. No separate lint/type/format configuration exists.

Promoted existing READY production-target candidate `dpl_3DJ62FpRQzy1MgKjDdTyk4XddrvC`, URL `https://botters-nj0qnlnhj-zacaria-chtatars-projects.vercel.app`. Vercel inspection immediately after promotion resolves both `botters.vercel.app` and `botters.havesomecode.io` to that deployment. No new build, paid resource or Convex backend deployment.

Unauthenticated strict-TLS readback from the Linux builder:

| Public alias route | HTTP | Exact source SHA-256 |
| --- | --- | --- |
| `https://botters.vercel.app/` | 200 | `588dced2870d69315adc76c695558c3ccbd67690245e1f634390af86843593f3` |
| `https://botters.vercel.app/privacy` | 200 | `de912f9fb0b2fe3ddce2a9359e63e2e8917c268c63a1f5e83376fbb6e1405187` |
| `https://botters.vercel.app/terms` | 200 | `eac2638702b79ecf43fe5326dd2db7747d6e27dc5957f527b7f92e6d44ab45af` |
| `https://botters.vercel.app/guide` | 200 | `e3ee79be2f305f57b06d3d080273d7ba337a45555ceecf2983d7a013fb68eca4` |

The Linux recursive resolver still reports name-not-known for the custom hostname. Alias configuration is verified, but this is not proof of end-to-end custom-host availability. Operator is performing independent DNS/TLS/public readback. Keep the existing alias intact. Future auth activation must update policy descriptions against the actual account/email/session implementation; this slice intentionally describes current production capability sessions and conditional Google sign-in.
