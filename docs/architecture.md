# Architecture

Forge AI currently implements a Next.js project-brief workspace. This page separates the checked-in system from the intended generation system so diagrams do not imply unavailable behavior.

## Current system

```mermaid
flowchart LR
  B[Browser] --> UI[TypeScript workspace UI]
  UI --> D[Project draft module]
  D --> R[Readiness decision]
  R -->|provider absent| X[Disabled generate action]

  classDef live fill:#d7ff46,color:#111412,stroke:#9ab51f
  class B,UI,D,R,X live
```

Next.js serves the React application during development and production. A production build emits a standalone Node server and locally bundled fonts. The supplied Dockerfile packages that server, but container startup is not yet validated. There is no server API, database, provider connection, background worker, or command execution path.

## Intended system

```mermaid
flowchart TB
  UI[Web workspace] --> API[Control API]
  API --> AUTH[AuthZ and policy]
  API --> PLAN[Planner/orchestrator]
  PLAN --> ADAPTER[Versioned provider adapter]
  PLAN --> QUEUE[Job queue]
  QUEUE --> RUNNER[Disposable sandbox runner]
  RUNNER --> FS[(Workspace volume)]
  RUNNER --> VERIFY[Lint · test · build]
  VERIFY --> DIFF[Reviewable diff and evidence]
  DIFF --> UI
  API --> DB[(Project metadata)]
  API --> AUDIT[(Append-only audit events)]

  classDef control fill:#20251a,color:#e9e7e0,stroke:#d7ff46
  classDef untrusted fill:#2a1f19,color:#f1d1b6,stroke:#d08c55,stroke-dasharray:5 5
  class UI,API,AUTH,PLAN,ADAPTER,QUEUE,DB,AUDIT control
  class RUNNER,FS,VERIFY,DIFF untrusted
```

## Boundary rules

1. Browser clients never receive provider credentials.
2. Provider adapters return a normalized event stream; orchestration does not depend on provider-specific payloads.
3. Generated code and its tools execute only in disposable runners, never in the control API process.
4. Workspaces are scoped per job and mounted with the minimum permissions needed.
5. Network access is denied by default and granted per task through policy.
6. Every mutation is represented as a reviewable diff with command evidence.
7. Project metadata and audit events are distinct from generated workspace contents.

## Proposed request lifecycle

```mermaid
sequenceDiagram
  participant U as User
  participant C as Control API
  participant M as Model adapter
  participant S as Sandbox
  U->>C: Submit validated brief
  C->>M: Request structured plan
  M-->>C: Normalized plan events
  C-->>U: Plan for approval
  U->>C: Approve scoped execution
  C->>S: Create disposable workspace
  S-->>C: Diff + verification evidence
  C-->>U: Review result
```

## Decision record

- **Interactive foundation first:** makes status, identity, and contribution workflow reviewable without pretending a generator exists.
- **Adapters behind a contract:** avoids spreading provider payload shapes and retry semantics throughout orchestration.
- **Control plane separate from execution:** reduces the blast radius of generated code.
- **Evidence as output:** generation is incomplete until the resulting diff and relevant checks are visible.

These target decisions require implementation and security review before they become guarantees.
