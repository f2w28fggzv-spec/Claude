# CLAUDE.md

## Project

AI form-check app. Long term: a phone app that analyzes lifting videos and adjusts the user's training program based on detected form issues. This repo is the first prototype.

**v0 goal:** a mobile web app that judges squat depth from a side-view video, with all processing on the phone.

## Hard rules

- Video never leaves the device. No uploads, no storage, no analytics. Discard frames after analysis.
- Must run in mobile Safari and Chrome over HTTPS (needed for camera access).

## Stack

- Vite + TypeScript, no backend
- MediaPipe Pose Landmarker (tasks-vision, web), running on-device
- Deploy to GitHub Pages

## Features

1. **Setup check:** show the squat placement criteria (side-on, phone around hip height, 1x lens), then run a live check on the camera preview. Whole body in frame (nose to ankles detected with good confidence) and side-on (left and right shoulders and hips nearly overlap horizontally). Show nudges like "step back" or "turn side-on". Enable recording only when the check passes.
2. **Record** a set, or pick an existing video.
3. **Detect reps** from the hip's vertical movement. At the bottom of each rep, compare hip and knee landmark heights: depth is hit when the hip is at or below the knee, with a margin the user can tune.
4. **Results:** hit or miss per rep, the bottom frame with a skeleton overlay, and "couldn't judge" when landmarks are low-confidence.

**Out of scope for v0:** accounts, training programs, the muscle-group setup screen, other lifts, payments.

## Implementation notes

- The MediaPipe WASM runtime and pose model are served from this site (`public/mediapipe/`, populated by `npm run fetch-assets`), not from a CDN, so the app makes no third-party requests at runtime.
- `site/` holds an unrelated landing page and is not part of the app build.

## Commands

- `npm install` — installs deps and fetches MediaPipe assets (postinstall)
- `npm run dev` — dev server on all interfaces (HTTPS needed for camera on a phone; see README)
- `npm run build` — typecheck + production build to `dist/`
