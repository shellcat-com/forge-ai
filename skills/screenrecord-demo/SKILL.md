---
name: screenrecord-demo
description: "Record real app or browser workflows and edit concise product walkthroughs with readable actions, prompt timelapses, shortened waits, a result tour, and optional music and typing/click effects. Use for screen-recorded demos or editing existing app footage, including the 81-second Forge style; not synthetic footage pretending to show a working product."
---

# Screenrecord Demo

Make a video of the actual workflow: user actions, the app doing its work, and the working result. Preserve the user's app, visual style, duration, sound preferences, and destination. Work from existing footage when the request is an edit.

## Choose the workflow

- New recording: read [capture.md](references/capture.md), inspect the app, and capture a short sample before the full take.
- Existing recording: inspect its metadata and key frames, then read [editing.md](references/editing.md). Do not repeat paid generation just to change pacing.
- The 1:21 Forge style: read [forge-81s.md](references/forge-81s.md). Its timeline is a worked example, not a universal requirement.
- Export, repository documentation, or a social draft: read [delivery.md](references/delivery.md). Upload or publish only within the user's requested scope.

## Editing judgment

For the Forge style, default to clean landscape footage, no voice, no title cards, and no decorative overlays. Keep most of the runtime on the app's workflow. Accelerate long prompt entry; reduce generation to approximately 6–7 seconds of real progress; reserve 10–15 seconds for the resulting website. Keep clicks, design choices, and state changes readable.

Use mellow instrumental music and subtle keyboard/mouse effects when requested. These preferences can be overridden. Added effects are sound design, not audio captured during the original session.

Cut dead time instead of adding freezes to meet a target. For a strict duration, plan enough useful interactions and adjust the timeline deliberately. Do not imply that an accelerated generation completed in real time.

## Evidence and boundaries

Distinguish live provider output from fixtures, real authentication from local preview state, and local export from public deployment. Never manufacture a success screen or imply missing backend, payment, or deployment features work. Record failures honestly when they affect the claimed result.

A browser viewport recording does not capture browser chrome, the desktop, or native file dialogs. Choose native recording when those are part of the requested story. Configure credentials off camera and inspect footage for accidental exposure before sharing.

## Included tools

- `scripts/render_timeline.py`: validate a JSON timeline, retime local footage, concatenate clips, add an optional continuous soundtrack, and export a checked MP4 with poster and contact sheet.
- `scripts/compose_audio.py`: generate an original lo-fi instrumental and synthetic keyboard/mouse effects from output-time events. Requires NumPy; no downloaded samples.
- `assets/forge-81s.timeline.json`: the nine-clip structure of the approved Forge edit. Supply its raw recordings locally before rendering.

Both scripts expose `--help`. Rendering requires Python 3, FFmpeg, and FFprobe. The renderer intentionally drops source audio; pass a prepared soundtrack explicitly when sound is wanted. Keep dependencies task-local when installation is necessary.

## Completion

Inspect the beginning, all edit boundaries, prompt readability, generation completion, and final result. Watch and listen to the finished export when playback tools are available. Metadata and successful decoding do not prove good pacing or audio quality; state any inspection limits.

Keep raw footage, the timeline, and a short provenance note. Deliver an absolute link to the finished MP4 and report its actual duration. For an authorized social draft, verify that both text and video survive saving and reopening. Saving a draft does not authorize publishing it.
