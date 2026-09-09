# Provider integration

No provider adapter is implemented. This document defines the proposed contract and the evidence required before a provider may be advertised as supported.

## Proposed contract

```ts
interface ProviderAdapter {
  readonly id: string
  listModels(signal: AbortSignal): Promise<ModelDescriptor[]>
  generate(request: GenerationRequest, signal: AbortSignal): AsyncIterable<GenerationEvent>
  validateCredentials(signal: AbortSignal): Promise<CredentialStatus>
}
```

The concrete types do not exist yet. Their eventual design should keep provider-specific request fields inside the adapter and expose normalized text deltas, tool requests, usage, completion, and typed errors to orchestration.

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
