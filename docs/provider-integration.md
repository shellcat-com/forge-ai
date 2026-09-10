# Provider integration

A local NVIDIA plan-generation adapter is implemented in `server/provider.mjs`. A private development key is configured and all three enabled models have returned real plans through the local API. This verifies the prototype request path; the broader streaming adapter acceptance checklist below remains future work. See [NVIDIA setup and limitations](nvidia-provider.md). This document defines the longer-term contract and evidence required before a provider may be advertised as supported.

## Proposed contract

```ts
interface ProviderAdapter {
  readonly id: string
  listModels(signal: AbortSignal): Promise<ModelDescriptor[]>
  generate(request: GenerationRequest, signal: AbortSignal): AsyncIterable<GenerationEvent>
  validateCredentials(signal: AbortSignal): Promise<CredentialStatus>
}
```

Versioned runtime schemas and TypeScript contracts now exist in [engine/contracts/provider.ts](../engine/contracts/provider.ts), with explicit fixture tests and no live generation adapter. They normalize bounded text deltas, rejected tool proposals, optional classified usage, structured completion and typed errors. Provider-specific wire parsing, cancellation/timeout enforcement and account capability validation remain E2 work. The loopback NVIDIA planning prototype remains separate and is not upgraded to production support by these contracts.

## Requirements

- Credentials are read only by the server-side adapter and never serialized to clients or logs.
- Model identifiers are configuration, not hard-coded marketing labels.
- Requests have timeouts, cancellation, bounded retries with jitter, and explicit retryability.
- Streaming parsers handle split frames, malformed events, provider errors, and early disconnects.
- Usage metadata is treated as optional and never converted into unsupported performance claims.
- Tool requests are data until policy validation; adapters cannot execute them directly.
- Error messages preserve actionable context while redacting secrets and sensitive prompt content.

## Acceptance checklist

A provider becomes **supported** only when all are true:

- Adapter implementation and contract tests are merged.
- Credential validation, cancellation, timeout, rate-limit, and malformed-stream cases are tested.
- One end-to-end generation path produces a reviewable, non-mocked result.
- Environment variables and secret rotation are documented.
- Threat-model changes are reviewed.
- A real UI capture and changelog entry show the capability.

## Local endpoints

An OpenAI-compatible local endpoint should be treated as a distinct adapter because authentication, model discovery, tool support, and streaming behavior differ between servers. A user-supplied base URL is also an SSRF boundary and must be validated by the control plane.
