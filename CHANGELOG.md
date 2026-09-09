# Changelog

## 0.2.0 — Next.js foundation

- Migrated the workspace to Next.js, React, Tailwind, and Node 24.21.0 LTS.
- Added working starter prompts, provider navigation, keyboard skip link, and responsive layouts.
- Bundled fonts locally and added browser evidence tests.
- Generation remains disabled. Docker packaging awaits container testing; the engine recovered after restart.

All notable changes to this project will be documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project intends to follow [Semantic Versioning](https://semver.org/) once a supported runtime exists.

## [Unreleased]

### Added

- Pre-alpha Forge workspace with project brief and stack selection.
- Original Forge AI logo and banner.
- TypeScript validation logic and unit tests.
- Local and containerized development paths.
- Contributor, architecture, self-hosting, provider, and security documentation.
- GitHub community health, CI, and dependency maintenance configuration.

### Security

- Generation remains disabled until a provider and execution boundary are implemented.
- Static container runs unprivileged with a read-only filesystem-compatible configuration.
