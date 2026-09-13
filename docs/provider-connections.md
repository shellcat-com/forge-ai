# Account-owned AI provider connections

Forge cloud accounts can connect DeepSeek or NVIDIA keys, check access, replace/remove a key, and generate text plans or standalone HTML frontends from an owned saved brief. The default local demo remains separate. Generated frontends have no backend, real authentication, payments, server execution or deployment; responses stay in the current tab and can be downloaded.

## Host setup

1. Run `npm run db:migrate` using the separate migration role. The ordered migration runner verifies checksums and uses one advisory-locked transaction. `0003_provider_connections.sql` adds encrypted connections and shared request reservations with forced account row security and identity-deletion cascades.
2. Create a cryptographically random 32-byte key, encode it as 64 hex characters, and put it in the host secret manager as `FORGE_PROVIDER_ENCRYPTION_KEY`. Never use a `VITE_` variable. Back up this key separately from the database; losing or changing it without re-encrypting rows requires users to reconnect their providers. Existing keys are not automatically rotated.
3. Restart the cloud API or deploy a new cloud package. Leave the encryption variable absent to keep connections disabled while accounts remain available. The Vercel package includes the provider adapter and requests a 150-second function duration; confirm the hosting plan supports that duration.
4. Verify a real account's Settings → Your AI providers → Check and save key, then open an owned project → Build with your API key. Testing a key makes a small provider completion request and may cost money. A successful check proves that model worked at that time; it does not guarantee future balance, entitlement or availability.

## Security and cost controls

The server binds AES-256-GCM ciphertext to both the verified user and provider with authenticated additional data and a random 96-bit nonce. Responses contain only a SHA-256-derived fingerprint and connection metadata. Plaintext keys are not returned, logged, exported or saved in browser storage. They exist transiently in server memory for the authorized provider call. The browser clears the input immediately on submission. Custom endpoints are not accepted, provider URLs are fixed, and redirects are rejected.

PostgreSQL reservations enforce one active request per account and 20 attempts per UTC day across restarts and replicas. UUID request IDs prevent replay of the same attempt. Reservations are committed before calling a provider; timeouts and failures count because the provider may already have billed them. A three-minute lease handles interrupted processes, while requests time out after two minutes. Connection checks allow 32 output tokens, plans 2,048 and frontends 8,000. These are request/output limits, not dollar caps. Users should configure spending limits with their provider; Forge makes no guaranteed savings claim. Removed keys cannot start new calls, but already-running calls may complete. Provider-side revocation is required to invalidate a key elsewhere.

The existing general account API limiter remains per instance. These new shared provider reservations specifically protect provider spending; they do not replace ingress rate limiting. Request UUIDs/timestamps are retained until account deletion to prevent replay, without prompts, outputs or keys. Monitor table growth before large-scale release.

## Verification

See `docs/reports/provider-connections-readiness.md` for the current bounded results. Synthetic tests and UI fixtures are explicitly separate from live provider evidence. Never use the QA fixture as an account service.

Provider contracts: [DeepSeek API](https://api-docs.deepseek.com/), [NVIDIA API quickstart](https://docs.api.nvidia.com/nim/docs/api-quickstart).
