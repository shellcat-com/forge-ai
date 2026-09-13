# Respawn — gaming marketplace showcase

## Open the website

Open `index.html` directly in a modern browser. It includes all artwork and does not need an internet connection. Or, from this directory, run:

```sh
python3 -m http.server 4187 --bind 127.0.0.1
```

Then visit http://127.0.0.1:4187 . The current local preview uses this address.

## Watch or share

`respawn-3-minute-walkthrough.mp4` is the edited 1920×1080 H.264/AAC walkthrough. It includes narration, chapter labels, the actual Forge generation recording, and the tested marketplace flow. The 98-second provider wait is cut out. `respawn-captions.srt` is an optional transcript with approximate sentence timings; chapter labels are already burned into the video. The narration is synthetic (macOS Samantha).

## What is functional

Search, category filtering, sorting, saved items, in-memory demo login/sign-out, cart quantities/removal, subtotal, a demo order confirmation, themes and responsive layout. No real identity verification, payment processing, fulfillment, database, server-side application execution or public deployment is included. All storefront state resets on reload.

## Provenance and review

- `brief.txt`: brief sent from Forge to DeepSeek V4 Pro.
- `provider-original.html` and `provider-result.json`: original successful response, with no key.
- `reviewed-source.html`: human-readable version after Codex refinements.
- `index.html`: portable reviewed version with WebP artwork embedded.
- `qa/`: browser captures and validation reports.
- `raw/`: actual Forge generation recording, including the original wait.
- `interaction-recording/`: browser interaction capture(s).
- `storyboard.json`: editable narration and edit structure.
- `film/`: lossless narration clips and edit graphics.

Review fixes include cart listener preservation, native modal focus, visible icons, sign-out, accessible quantity controls, responsive spacing and clearer concept-product labeling. The stock imagery is original GPT image-tool output, compressed to WebP; no exact image-model version was exposed by the tool.

Forge integration documentation: `docs/deepseek-frontend.md` in the repository. The key is stored only in the ignored server `.env.local` and is absent from this package. A local frontend experiment is separate from Forge's production engine work.
