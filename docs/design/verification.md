# Design milestone verification

9 September 2026. Tested the Vite frontend and compiled production app in the Codex in-app browser. Production QA used port 5174 to keep test briefs separate from the user's development workspace on 5173.

## Automated checks

`npm run verify` passed: ESLint, strict TypeScript, **33 tests across 6 files**, and Vite production build. Includes original normalization/readiness tests, the optional provider's tests, versioned storage validation/failure tests, theme resolution/preset isolation, escaped content and ZIP package contents/failure handling. npm dependency installation reported zero vulnerabilities. Both repository skills passed skill-creator validation and were installed locally.

The build emits a warning about an unrelated ancestor tsconfig referencing `expo/tsconfig.base`; it does not prevent this repository's typecheck, tests or build. That file outside this repository was not changed.

## Browser checks executed

- Landing → login preview → onboarding → new brief → builder.
- Authentication options and email field disabled; local demo entry works and does not report authentication.
- Brief created with name, text and selected preset; reopened after reload. Angle-bracket text renders literally.
- Preset selection updates the preview. Preview appearance remains independent of Forge's appearance.
- Project renamed, duplicated, searched; no-match state displayed; duplicate deleted, Undo restores it; two records remain after reload.
- Dark and light preferences survive page reload. System preference resolution has automated tests.
- Custom project Files tab states that no files exist. Provider-free production app has no enabled generation path.
- User-triggered sample advances through all four deterministic steps. Files are labeled fixtures; Checks explicitly say illustrative, not executed tests.
- ArrowLeft changes and focuses the correct builder tab. Mobile drawer opens, traps focus, closes with Escape and returns focus to its trigger. Navigation also dismisses the drawer.
- Invalid project and unknown route recovery screens offer working routes back to projects/home.
- Editorial Product ZIP download triggers a success notification with no browser console errors. Automated package checks verify all five archives include the correct data and selected artwork.
- All five presets are present in both light/dark specimen variants; styles stay within preview roots. Desktop/tablet/mobile layouts reviewed without document horizontal overflow in inspected routes.

## Visual evidence

Screenshots in [screenshots](screenshots/) capture landing at 390, 768 and 1440px in both themes, login in both themes, and paired preset specimens. Additional mobile builder, tablet file view and component interactions were visually inspected during the session. Landing captures show actual HTML UI, not generated mockups. Compact preset studies intentionally scale preview text to illustrate a complete composition; functional Forge metadata uses the readable 12px minimum.

Semantic palettes were checked for readable primary/secondary text, visible focus and neutral primary actions; disabled authentication controls are intentionally subdued. Scenic media uses text scrims, explicit dimensions and responsive WebP. No video autoplays.

## Limits of this verification

- Corrupt and denied storage were exercised through the adapter's automated tests; not by mutating a real browser's storage behind the UI.
- A 720×500 CSS viewport checked the reflow expected from a 1440×1000 display at 200% zoom. The in-app browser did not expose a working browser-zoom shortcut, so actual 200% browser zoom was not claimed verified.
- Reduced-motion CSS was reviewed: it removes transitions, animation and smooth scrolling; no timed walkthrough or autoplay media exists. OS-level reduced-motion emulation was not available in the test browser.
- Private Mobbin flows and supplied video playback remain uninspected as documented in research.md. No supplied video was assigned to a production preset.
- The separately implemented NVIDIA API received live provider validation in the provider task. This UI milestone adds no execution, authentication or deployment capability.

## Repeat after future UI changes

Run npm run verify and npm run skills:sync. Repeat the affected flow in the browser, inspect paired themes at 390/768/1440px and capture updated evidence. Check keyboard focus, actual browser zoom and OS reduced motion in a browser that exposes those controls before broader public release. Keep provider readiness and deterministic sample evidence separate.
