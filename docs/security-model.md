# Security model

## Current model

The checked-in app is a Next.js server with a client-side workspace. It accepts a prompt and editable starter ideas in browser memory and does not transmit or persist them. The generate action is disabled. There is no provider secret, generation backend, upload path, repository access, shell, generated-code runner, or sandbox.

The supplied, not yet container-tested Docker configuration narrows the Next.js server process with an unprivileged user, dropped capabilities, no-new-privileges, a read-only root filesystem, and controlled temporary mounts. This is deployment hardening, not workload isolation.

## Assets

- Project briefs may contain confidential product information.
- Provider credentials authorize paid or private model access.
- Source repositories may contain proprietary code and developer secrets.
- Generated artifacts and build logs may reproduce sensitive input.
- The host and adjacent network are high-value targets for generated code.

## Trust boundaries

```mermaid
flowchart LR
  U[Untrusted browser input] --> C[Control plane]
  C --> P[External provider]
  C --> Q[Job descriptor]
  Q --> S[Untrusted sandbox]
  S --> O[Reviewed artifacts]
  S -. denied by default .-> N[Network / host]

  classDef trusted fill:#20251a,color:#e9e7e0,stroke:#d7ff46
  classDef untrusted fill:#2a1f19,color:#f1d1b6,stroke:#d08c55,stroke-dasharray:5 5
  class C,Q,O trusted
  class U,P,S,N untrusted
```

This diagram is a target design, not current functionality.

## Target controls

- Validate and cap all request bodies, filenames, archives, and event streams.
- Store secrets in a server-side secret manager; redact logs and diagnostics.
- Require authorization for projects, workspaces, provider use, and execution approvals.
- Create a disposable runner per job with a non-root user, minimal capabilities, resource quotas, process limits, and timeouts.
- Mount only a job-specific workspace; never mount the Docker socket, host home, or broad repository roots.
- Deny egress by default; resolve and pin approved destinations to resist SSRF and DNS rebinding.
- Treat model output and generated code as untrusted instructions and content.
- Separate plan approval from execution, and display commands and diffs before durable application.
- Produce append-only audit events without prompts, secrets, or full source snapshots by default.
- Scan dependencies and generated artifacts before preview or export.

## Non-goals

The first sandbox will not guarantee containment against kernel or container-runtime vulnerabilities. Forge cannot guarantee generated code is correct, secure, licensed appropriately, or free of embedded secrets. Human review remains required.

## Security release gate

Before enabling generation, the project needs abuse-case tests for path traversal, symlink escapes, archive bombs, command injection, prompt injection, SSRF, credential exfiltration, resource exhaustion, cross-project access, malicious dependencies, and log leakage. The threat model and deployment guide must be updated with measured controls and residual risks.
