# Push-up Alarm Demo (Circuit build, 3 Nov 2026)

A self-contained browser demo: a two-tone alarm rings until the front camera counts
your target number of push-ups. Every full rep flies a pixel bird through
Flappy-style pipes. Pose detection runs entirely on-device (MediaPipe Pose
Landmarker); no video or data leaves the phone.

## Deploy

Copy the `alarm/` folder to any static HTTPS host path (e.g. GitHub Pages).
All fetches are relative and same-origin; no external services, no build step.
Camera access requires HTTPS (or localhost).

## Use

1. Open the page on a phone, pick a rep target, tap "Start the alarm".
2. Allow camera access when asked.
3. Prop the phone so the front camera sees your whole body (side view works best).
4. Do full push-ups. Each counted rep flies the bird; at the target the alarm stops.
5. "Tap = 1 rep" is a manual backup if the camera misses a rep.

## Limits

- Demo only: works while the page is open and the screen is on. It cannot wake a
  locked phone; it is not a dependable morning alarm.
- Best with a side view of the body. Front-on framing is less reliable.
- The rep counter uses elbow-angle motion with a plank posture gate; it can miss
  partial reps and ignores standing/talking movement.

## Third-party notices

- @mediapipe/tasks-vision 0.10.14 (vision_bundle.mjs, wasm/): Apache License 2.0,
  (c) Google LLC - https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE
- pose_landmarker_lite.task (MediaPipe Pose Landmarker Lite model): Apache License 2.0,
  model card: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
