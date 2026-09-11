# Edit and render

## Timeline format

Copy `assets/forge-81s.timeline.json` to a task output directory, or create a smaller timeline. Relative source paths resolve against the JSON file's directory. Use local files, not remote URLs. All times are seconds.

```json
{
  "version": 1,
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "clips": [
    {"name": "prompt", "source": "raw.webm", "start": 14.62, "end": 120.751, "duration": 18}
  ],
  "sound": {
    "music": true,
    "bpm": 78,
    "seed": 20260911,
    "typing": [{"start": 0, "end": 17.5, "spacing": 0.105}],
    "clicks": []
  }
}
```

Each clip's speed is `(end − start) / duration`. Output duration is the sum of clip durations. Durations must fall on the requested frame grid. The renderer pads at most one frame to cover timestamp rounding; it rejects footage that is materially too short.

To map an event from a source clip to output time:

`preceding output durations + (source event − clip start) × clip duration / (clip end − clip start)`

Drop events outside retained clips. If a source interval appears twice, map each occurrence deliberately. Audio events use **output time**, so update them when the timeline changes. Effects should correspond to visible typing or clicks, not arbitrary rhythmic decoration.

## Run

Replace `SKILL_DIR` with this skill's absolute directory. Paths with spaces must be shell-quoted.

```sh
python3 SKILL_DIR/scripts/compose_audio.py timeline.json --out soundtrack.wav
python3 SKILL_DIR/scripts/render_timeline.py timeline.json --audio soundtrack.wav --out walkthrough.mp4
```

For a silent version, omit `--audio`. Both tools refuse to replace their output unless `--overwrite` is supplied. The renderer discards source audio to prevent retimed clicks, notification sounds, or duplicate music. Use an explicitly prepared continuous mix for narration or other supplied audio.

Python 3 and FFmpeg/FFprobe are required; audio synthesis also needs NumPy. Check what is already installed before adding dependencies. Use a task-local virtual environment if needed.

The composer holds audio in memory and supports walkthroughs up to 600 seconds. Split longer projects or use a dedicated audio editor. Keep the source capture untouched when tuning the mix.

## Pacing

Keep the opening and major choices readable. Long prompt entry often works at approximately 5–6× speed, but use the actual source length and readability to choose it. Show enough of the completed brief to understand the request. Condense waiting to 6–7 seconds when following the Forge example, preserving visible progress and completion. Do not add fake terminal output, progress bars, or performance claims.

Use direct cuts at meaningful states. Avoid forced gaps, freeze-frame filler, and transitions that hide whether the app actually worked. Let the result tour show a few concrete features in 10–15 seconds. Adapt runtime for other workflows; 81 seconds is not mandatory unless requested.

Keep landscape UI readable for social feeds. A portrait version needs deliberate reframing and inspection, not an automatic center crop of the whole desktop.

## Sound

The composer creates a seeded electric-piano, bass, and soft-drum instrumental, with mechanical-style typing and mouse effects. It uses synthesized sound only. It does not claim to reproduce the exact keyboard or live audio. Its output is a reusable interpretation of the Forge style, not a byte-identical copy of the original mix.

Music can be disabled with `"music": false`; effects can be omitted independently. Typing ranges gently duck the music. Use the user's licensed track instead if requested, keeping source and rights notes. Do not download an arbitrary commercial song as background music.

The renderer normalizes an explicit soundtrack toward −19 LUFS with a −2 dB true-peak target, then measures the encoded output. These are editing defaults, not platform requirements. Listen for harsh clicks, excessive typing, distortion, and abrupt fades when audio playback is available.

## Verify

The renderer produces the MP4, `<stem>.verification.json`, `<stem>.poster.jpg`, and `<stem>.contact.jpg`. It checks duration, video dimensions, audio presence, full-file decoding, and records encoded audio loudness when present. Inspect the contact sheet, plus frames immediately before and after every cut; watch the full export when possible. Automated checks cannot establish truthful content or subjective quality.
