# Contributing to Forge AI

Thanks for helping shape Forge. The project is pre-alpha, so small, evidence-backed changes are more useful than broad speculative implementations.

## Before you start

- Search existing issues and pull requests.
- Open an issue before a large architectural change.
- Do not publish suspected vulnerabilities; follow [SECURITY.md](SECURITY.md).
- Do not add a provider or feature to public capability lists until working code and tests exist.

## Development setup

```bash
git clone <your-fork-url> forge-ai
cd forge-ai
nvm use
cp .env.example .env.local
npm ci
npm run verify
npm run dev
```

Use Node.js 24.21.0 LTS. Never commit `.env`, API keys, generated credentials, or personal data.

## Workflow

1. Create a focused branch such as `codex/provider-contract` or `codex/draft-validation`.
2. Add or update tests with the implementation.
3. Update documentation, screenshots, and `CHANGELOG.md` when behavior changes.
4. Run `npm run verify` and `npm audit --audit-level=moderate`.
5. Commit using the Conventional Commits shape: `type(scope): summary`.
6. Open a pull request using the repository template.

Common types are `feat`, `fix`, `docs`, `test`, `build`, `ci`, `refactor`, and `chore`.

## Pull-request standard

A reviewable pull request has one coherent purpose, explains security implications, records validation evidence, and avoids unrelated formatting. UI changes should include a real before/after capture. Architecture changes should update the relevant page in `docs/`.

Contributors must confirm that submitted work is theirs to license under MIT and that third-party material is compatible and attributed.

## Code style

- Prefer strict, explicit TypeScript at trust boundaries.
- Keep domain logic separate from DOM rendering.
- Validate untrusted input before use.
- Preserve accessible labels, keyboard interaction, and responsive behavior.
- Avoid secrets in client bundles, logs, fixtures, and snapshots.

## Review and release

Maintainers may ask for a narrower scope, more evidence, or threat-model updates. Merging does not guarantee inclusion in a release. Releases follow semantic versioning once the project has a stable public runtime; until then, `0.x` changes may be breaking.
