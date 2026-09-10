# Builder UX evidence: Pomodoro timer

Captured on September 9, 2026 from the logged-in Brave sessions for Bolt, Lovable, and Emergent.

## Scope

The same product prompt was used in all three builders:

> Build a responsive Pomodoro timer web app. Include a large 25-minute focus timer, Start/Pause and Reset controls, automatic 5-minute break mode, a completed-session count, and a simple settings control for focus and break durations. Keep it accessible, calm, and visually clear on desktop and mobile.

The archive contains retraced screenshots of each dashboard, the completed project workspace, the generated application, settings, and available technical or management surfaces. `visual-walkthrough.mp4` presents the screenshots in workflow order. The `contact-sheets` directory provides quick visual indexes.

## Important capture limitation

The initial account onboarding dialogs and Lovable's three-way design-choice dialog were one-time states and could not be replayed without resetting the accounts or starting new billable generations. Those states are documented below from the live observations made during the original run. The video is a reconstructed visual walkthrough from saved screenshots, not a recording of the original generation clicks.

## Bolt

Project: https://bolt.new/~/sb1-aqr5dkrk

Observed flow:

1. Dashboard with prompt, Website/Slides/App/Prototype modes, context attachment, model, Plan mode, Figma, GitHub, and team-template imports.
2. First-use survey: discovery source, role, and workplace. Completion offered extra tokens; the optional work-email step was skipped.
3. Generation workspace with chat, file-read/action logs, build verification, TypeScript check, and a version card.
4. Preview, Code, Database, and More workspace modes.
5. Version history with bookmarks and reverting.
6. Database entry point for tables, authentication, server functions, secrets, user management, and file storage, with Bolt Database or Supabase choices.

Generated timer behavior was verified by starting and pausing the countdown and opening settings.

## Lovable

Project: https://lovable.dev/projects/f7195a14-830f-4f7f-826a-66f68544cfc1

Observed flow:

1. Dashboard with prompt, Search, Connectors, project collections, recent projects, and templates.
2. Drafts introduction describing side-by-side changes and selective acceptance.
3. Mandatory visual direction choice before generation: Desert stillness, Mistral Focus, or Warm Earthy Focus. Desert stillness was selected.
4. Generation result with mobile and desktop screenshots, design label, details, preview action, and suggested follow-up features.
5. Preview toolbar for element selection, inline text editing, annotations, and comments.
6. Files, read-only Code, History/Bookmarks, Analytics, Cloud, AI, agent integrations, Payments, Connectors, Security, SEO, and Settings.
7. Project settings for monitoring, live preview, publishing, analytics, AI context, security, sharing, remixing, Git, and domains.

The generated timer's start, pause, resume, and settings behavior was verified. The project reported 2.1 credits used.

## Emergent

Preview: https://pomodoro-focus-114.preview.emergentagent.com/

Observed flow:

1. Dashboard with Web App/Mobile App choice and a single product prompt.
2. First-use onboarding: user role, intended product, and discovery source. Completion granted 10 free credits.
3. Pre-generation requirements form covering storage, visual direction, and MVP scope. Browser localStorage, calm warm minimal styling, and the focused MVP were selected.
4. Detailed agent timeline showing delegated design work, files, specification creation, commands, screenshots, typechecking, API smoke checks, and browser tests.
5. Preview and Manage workspace modes.
6. Manage catalog for authentication, storage, AI models, payments, email, messaging, speech, and image generation.

The generated timer's start/pause behavior and full settings sheet were verified. Emergent reported 3.89 credits used and 6.11 remaining.

## Mobbin references used

- Bolt creating a prompt: https://mobbin.com/flows/b2ffd3c5-f515-4077-ad4d-75f0abeb0599
- Lovable editing a component: https://mobbin.com/flows/4b8d19a0-245d-4579-884b-f3b2275b0d00
- Lovable remixing a project: https://mobbin.com/flows/3e682900-f906-449e-be52-2240002396a6
- Lovable creating a theme: https://mobbin.com/flows/6382de0f-a6c3-4640-90c2-e25df41b2d7e
- Lovable dashboard: https://mobbin.com/screens/e7096b98-d438-462b-9b06-214e07cbd6b8
- Emergent dashboard: https://mobbin.com/screens/cca0fbd3-30d1-41c7-8cd5-fd1784a6ab5a

## Files

- `bolt/`: seven screenshots
- `lovable/`: five screenshots
- `emergent/`: six screenshots
- `contact-sheets/`: one index image per product
- `visual-walkthrough.mp4`: timed visual walkthrough in workflow order
- `manifest.json`: machine-readable file inventory and capture notes
