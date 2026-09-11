# Screenrecord Demo and walkthrough publication

## Scope

Adds the reusable `screenrecord-demo` skill, its installer integration, the original approved 81-second Forge walkthrough and poster, and a README entry. The video documents the earlier local Forge interface; it is not a demonstration of every capability in the current unified Next.js application.

## Verification

- `npm run verify` passed on Node 24: lint, TypeScript, 466 tests passed / 2 skipped, and the production build.
- Skill-creator schema validation passed.
- `skills:sync` was exercised with a temporary `CODEX_HOME`; all nine installed skill files matched their repository sources. Existing design skills remained in the installation workflow.
- Renderer/audio checks passed for normal, accelerated and slowed clips; sound and silent exports; synthesis without sound events; overwrite refusal; source-duration bounds; frame alignment; and sound-event bounds.
- The reusable timeline was previously rendered against the original footage: 81 seconds at 1920×1080, full-file decode passed, and the contact sheet was visually inspected.
- The committed original MP4 was checked again with FFprobe and a full FFmpeg decode: 81.000 seconds, 1920×1080, 30 fps, H.264 video and AAC audio, 10,263,974 bytes.
- Video SHA-256: `3eee8d1a55b25855b2a1c96df7aebd6c6a80bdb00b55bf12050cb3fc0013ac42`. This matches the approved local video.
- `git diff --check` passed. Selected text files were inspected for credential-shaped values; environment files, raw captures and Python caches are excluded from the commit.

## Limits

No application UI behavior changed, so responsive/e2e browser flows were not rerun for this publication. Full video playback and listening were not repeated during this publication task; successful decoding is a technical check, not a subjective quality assessment. The test command emitted existing ancestor Expo-config and local-storage warnings without failing.

The footage uses a local login preview and HTML export. It does not prove production authentication, payment processing, or public deployment. Typing and generation are accelerated; the soundtrack and UI effects are added sound design. GitHub CI results are recorded on the pull request.
