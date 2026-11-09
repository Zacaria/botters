# Account execution repair and installer integration

## Candidate boundary

Task `t_7c7b7a64` assembles a local release candidate only. It does not authorize
pushes, production deployment, provider operations or hosted account measurement.
Independent review of this combined candidate is the next gate.

Inputs:

- Remote default branch `pvp-online`, read back and fetched at
  `8871d4842eaf900362052ea1ed3879027a1fa5aa`.
- Reviewed account repair `63639f4df10363c6d02d500c313453de61fe2719`, including
  producer base `196e10b848405b2820af7be7cd18122abd50676c`.
- Common ancestor `5f34d62cd2dbbe55d98da5f83b7194b962c12230`.

The two input deltas do not overlap. A two-parent merge retains both histories;
there are no source conflict resolutions or behavior changes beyond the approved
inputs. Every path changed by the account branch must equal its reviewed input
blob, and every path changed by the installer branch must equal its input blob.
This document is the only integration-authored tracked addition. No files or
runtime dependencies are removed by integration.

The isolated linked worktree uses the task's existing native-bound scratch path
outside the canonical repository. Producer/reviewer workspaces are read-only
inputs and must remain until the integration evidence has been retained.

## Verification and evidence

Run `npm ci`, `npm test`, `npm run test:auth:convex`,
`npm run test:auth:browser`, `npm run test:browser`, `npm run check`,
`npm run build`, `npm audit --omit=dev` and `git diff --check`.
Both browser suites use isolated Brave and loopback servers, without remote-target
or credential environment variables. There is no separate lint/type/format tool.

On a fresh checkout, component tests require ignored `convex/_generated/api.js`.
Generate this JavaScript runtime utility locally with the installed Convex SDK's
`componentApiJs()` template; this does not contact or modify a deployment.
The component tests then execute the actual schema and Better Auth component in
`convex-test`, not fabricated responses or hosted measurements.

The installer smoke uses the existing `scripts/verify-install.js` in an ignored
harness copy. Redirect its evidence output away from the tracked installer
receipt, and execute all MCP transports from the packed integration artifact
against a closed loopback endpoint. Keep registration assertions unchanged.
This tests real installed Claude/Codex config reads, install/update/uninstall,
idempotence and the candidate's stdio tools/list without fetching an older
GitHub package or contacting production. It does not re-validate the released
unqualified GitHub command or perform account pairing.

Retain command logs, installer receipt, build-file hashes, exact changed-path
hashes, candidate archive fingerprint, binary patch and a self-contained Git
bundle in the task evidence. Keep the original producer repair bundle and
measurement ZIP byte-identical alongside the integration evidence.

## Measurement limits and release handoff

Cold 50 and warm 48 are the reviewed isolated-backend windows retained in
`account-function-overhead.md` and its evidence, not new measurements of this
integration or hosted-production results. Cold meets the limit exactly and is
not a universal execution ceiling. Security behavior, fresh authority checks,
public abuse controls and CAS writes remain those of the reviewed inputs.

The installer document's statement that the default branch is `master` records
its pre-release state. This integration's fresh Git remote readback resolves
HEAD to `pvp-online` at the installer input above; this does not re-authorize
publication or change those reviewed installer bytes.

After independent review, the release owner must re-read the remote head,
reconcile any intervening changes and use current effect-specific release
authority immediately before any push or deployment. Hosted acceptance, if
required by that release scope, remains a separate authorized action. Do not
interpret this local candidate or its inherited measurement evidence as a
production release.
