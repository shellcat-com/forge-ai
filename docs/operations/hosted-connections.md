# Hosted account and key connections

This is the first connected milestone of [the free hosted architecture](../decisions/0003-free-hosted-runtime.md). It does not enable generation, sandboxes, previews or publication. The release stays draft until live A–P acceptance passes.

Apply the existing application migrations through `drizzle/0005_public_auth.sql` and existing engine migrations through 0003 in the same dedicated PostgreSQL database. Review and apply engine `0004_hosted_identity.sql` and `0005_hosted_byok.sql` as the migration owner. Do not renumber or overwrite prior migrations. Native tests exercise these migrations against real PostgreSQL and restricted runtime identities; the actual Neon migration-owner permissions still need verification.

Use distinct non-owner runtime logins for Better Auth and the control API. The control login must belong only to `forge_control_api`, not the worker, maintenance, guard or owner roles. Retain existing TLS host verification and private connection-string configuration. The bridge grants the guard narrowly scoped access to authoritative account/session columns; the API login cannot read those tables or identity mappings directly.

Private server configuration:

| Variable | Purpose |
| --- | --- |
| `FORGE_HOSTED_CONTROL=true` | Expose authenticated account/key APIs; does not enable builds. |
| `FORGE_CONTROL_API_DATABASE_URL` | Separate limited control API login, protected server configuration. |
| `FORGE_CONTROL_DATABASE_HOST` | Expected verified PostgreSQL hostname. |
| `FORGE_IDENTITY_BRIDGE_KEY` | Independent random 32-byte secret, encoded as 64 lowercase hexadecimal characters. |
| `FORGE_CREDENTIAL_KEYS_JSON` | Private encryption keyring, JSON mapping key IDs to independent 32-byte hexadecimal secrets. |
| `FORGE_CREDENTIAL_KEY_ID` | Current key ID; defaults to `v1`. Retain old keys until stored ciphertext and backups no longer need them. |

Keep these values out of client environment variables, source control, logs and recordings. Existing Better Auth origin, secret, auth database and delivery settings remain required. Do not reuse a model key as an infrastructure or encryption secret.

Explicitly configure `forge_control.hosted_identity_settings` with the exact Better Auth issuer (`https://<installation>/api/auth`), an enrollment cap and `enabled=true`, and set the dedicated control database environment to `hosted`. Leave `admission_enabled` and `worker_enabled` false until the rest of the release passes its gates. A migration alone enables nothing. Changing the issuer or bridge key requires a deliberate session migration/revocation procedure; do not rotate them casually while sessions are active.

Every hosted API request validates the current Better Auth account and session. The bridge derives internal child credentials server-side, uses immutable Better Auth user IDs, and atomically allocates one owner workspace per user. It never links accounts by email, resets revoked memberships or freshens an old login. Logout, expired/deleted parent sessions and suspended/unverified users lose API access immediately. Worker account suspension is fenced; job-specific parent-session cancellation is still part of the forthcoming worker integration.

In Connections, save a user-owned Gemini, Groq or OpenRouter key, choose a reviewed model candidate and confirm the account's free-tier eligibility before checking. Metadata validation checks key/model access without sending a completion. OpenRouter requires both its protected key endpoint and zero-price model metadata. A checked model is **not generation acceptance**. Gemini/Groq free-tier account eligibility still requires account verification; discovery cannot prove billing status. Rotation/removal invalidates selection. Removal erases the active ciphertext but cannot revoke the upstream provider key or remove retained encrypted backups instantly.

Limits currently enforced: at most six active and thirty lifetime credential records per workspace, five model checks per minute, bounded metadata response size and ten-second metadata deadline, plus fresh-session/origin/role/revision checks. These limits do not replace the forthcoming global generation, source, sandbox and retention quotas.

Rollback: disable `FORGE_HOSTED_CONTROL` and hosted enrollment to remove the connection surface; retain additive tables and ciphertext keys. Do not delete account data, drop migrations, reset provider credentials, promote production or reverse application database migrations as part of a code rollback.
