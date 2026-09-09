# Security policy

## Supported versions

Forge AI is pre-alpha and has no supported production release. The latest commit on the default branch receives security fixes. Do not deploy the current interface as a trusted code-generation service.

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** flow under this repository's Security tab to open a private security advisory. Do not open a public issue, discussion, or pull request containing exploit details or secrets.

Include the affected commit, impact, prerequisites, reproduction steps, and any suggested remediation. Use synthetic data and redact tokens, local paths, and personal information.

Maintainers will aim to acknowledge a report within five business days, establish severity and next steps after reproduction, and coordinate disclosure when a fix is available. These are response goals, not a service-level agreement.

## Current boundary

The checked-in application is a Next.js server rendering a client workspace. It makes no model requests, stores no projects, and executes no generated code. The container hardening limits the web server, not untrusted workloads. See [docs/security-model.md](docs/security-model.md) for the current and target threat models.

## Out of scope

- Findings that require a provider, server, sandbox, or authentication system that is not present in the repository.
- Vulnerabilities in a contributor's own deployment configuration outside the supplied files.
- Automated reports without a reproducible security impact.

Dependency advisories that affect the checked-in development or production graph remain in scope.
