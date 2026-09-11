# Worked example: the 81-second Forge walkthrough

The user preferred a recording of making a site inside Forge, with most runtime devoted to the app's process. Long prompt entry was sped up, generation became a short timelapse, and the finished site received a brief tour. The final version had lo-fi music, typing and mouse effects, and no voice or title cards.

| Output time | Content | Source interval | Output seconds |
| --- | --- | --- | ---: |
| 0:00–0:14 | Opening and entering the app | process 0.700–14.620 | 14 |
| 0:14–0:32 | Prompt timelapse | process 14.620–120.751 | 18 |
| 0:32–0:41 | Design choice and project creation | process 120.751–131.119 | 9 |
| 0:41–0:42.8 | Open the brief | process 131.119–133.000 | 1.8 |
| 0:42.8–0:46 | Refine the prompt | process 133.000–142.200 | 3.2 |
| 0:46–0:52.5 | Save and trigger generation | process 142.200–149.841 | 6.5 |
| 0:52.5–0:59 | Actual generation timelapse | process 149.841–280.245 | 6.5 |
| 0:59–1:08 | Preview and export | process 280.245–289.329 | 9 |
| 1:08–1:21 | Result and feature tour | tour 0.250–11.934 | 13 |

The result was Respawn, a gaming storefront frontend generated with DeepSeek. The recorded flow included local preview state and an HTML export opened locally. It was not evidence of production authentication, payment processing, or public deployment. Check the current app before making new claims.

## Reuse the reference

The bundled timeline expects `raw-forge-process.webm` and `raw-website-tour.webm` beside it. Raw video is intentionally not shipped in the skill. In the originating Forge repository, the recordings were under `output/respawn/silent-process/`; the final edit was `output/respawn/social-cut/forge-social-cut.mp4`, also copied to `docs/media/forge-workflow.mp4`.

These are historical locations, not portable dependencies. Discover or ask for the appropriate source footage if absent. Copy the raw files and timeline into a task directory, or change the manifest to verified absolute local paths. Never substitute unrelated recordings just to make the example run.

The original export was 1920×1080, 30 fps, H.264 video with stereo AAC audio, exactly 81 seconds. New footage will need new markers and sound-event times. Preserve the pacing principles rather than blindly applying these source timestamps.
