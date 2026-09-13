# Capture a real workflow

## Prepare

1. Inspect repository instructions and the current app. Identify the real route from opening the app through the final result. Determine whether login, provider generation, export, and publishing actually exist.
2. Reuse the user's existing session and authorized configuration. Enter secrets off camera. Avoid exposing account menus, private tabs, notifications, tokens, or local environment files.
3. Choose a stable viewport, theme, zoom, and readable text size. Landscape 1600×900 or 1920×1080 is a useful starting point. Record a short sample and inspect it before spending time on the full workflow.
4. Use capabilities exposed by the current tools and their documentation. A skill does not authorize bypassing tool restrictions or replacing a prohibited browser-control method.

## Choose the capture surface

- **Browser viewport:** appropriate for web app interactions. If an authorized Playwright workflow is available, start video capture before navigation and close the recording context cleanly to flush the file. This records page content only.
- **Native screen/window:** required for opening the browser, address bar actions, desktop interaction, or native upload dialogs. Verify the selected window and a sample recording for black frames, wrong scaling, and unwanted audio.
- **Existing footage:** preserve the raw original and edit a copy. Do not reenact a paid generation unless the task needs new evidence.

Do not silently substitute fixture data, prerecorded responses, or synthetic UI animation for a claimed live generation.

## Record and mark

Capture a continuous take where practical. Type the actual brief, choose the actual design, trigger the provider, inspect the result, export it, and interact with the exported result. Leave brief natural holds after meaningful state changes; long waits will be edited later.

Record monotonic timestamps for: first visible action, prompt start/end, generation click, provider completion, preview ready, export complete, and tour end. Map these markers to the media's actual timestamps; recorder startup can add an offset. Verify the mapping against visible actions before cutting.

Preserve the original waiting period. Keep redacted generation evidence when available, without storing secrets in the skill or final video. A spinner alone is not evidence of successful generation. Confirm the resulting artifact opens and exercise two or three representative features.

For a storefront, distinguish filters and cart interactions from real payment processing. For Forge, verify the current implementation rather than assuming a historical feature is still a local fixture or has become a production service.

## Recover without wasting the take

After a failed click, refresh the accessibility/browser state and verify focus. Native file sheets can appear late and change the active application. Avoid repeating clicks or typing blindly. After two similar failures, change the approach based on new evidence or report the concrete blocker.

Check free space and write to a task-owned directory. Use ordinary local storage first. A temporary RAM volume is an exceptional workaround, not a default: copy and verify all outputs on persistent storage before detaching it. Never remove unrelated caches or recordings to make room.

Before sharing, inspect frames around login, settings, errors, and downloads for private information. Crop or redact a discovered exposure and verify the finished export again.
