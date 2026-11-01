# CLAUDE.md

## Project

AI form-check app. Long term: a phone app that analyzes lifting videos and adjusts the user's training program based on detected form issues. This repo is the first prototype.

**Current goal:** turn the prototype into a working app for general use: a muscle group selector, an exercise library, technique feedback for every exercise, and workout programs built from the selected muscle groups. Built in phases (see Roadmap). The original v0 goal (squat depth from a side-view video) is folded into Phase 2.

## Hard rules

- Video never leaves the device. No uploads, no storage, no analytics. Discard frames after analysis.
- Must run in mobile Safari and Chrome over HTTPS (needed for camera access).
- No backend. Only settings, programs and numbers (never video or images) are stored, and only on the device (localStorage). Exports are files saved on the device, never uploads.
- Keep the live skeleton overlay working.
- UI copy calls this "technique feedback". No injury-prevention or medical claims.
- Don't add checks the landmarks can't support (e.g. no spine rounding: there are no spine landmarks). When confidence is low or the camera view can't show a check, report "couldn't judge"; never guess.
- Don't download or scrape videos from YouTube, Instagram, TikTok or any other site.

## Stack

- Vite + TypeScript + Preact, no backend
- Vitest for tests (landmark JSON fixtures, no video)
- MediaPipe Pose Landmarker (tasks-vision, web), running on-device
- Deploy to GitHub Pages

## Roadmap

1. **Phase 1 (done):** muscle group selector, exercise library (data file), rule-based program builder, programs saved on device.
2. **Phase 2:** generic form analysis engine driven by exercise config: rep segmentation, all check types, per-rep pass/fail/couldn't judge, generalized setup check, limb-proportion personalization.
3. **Phase 3:** sourced technique standards → thresholds (cite each, mark "unvalidated"). Full analysis for back squat, bench press, deadlift, overhead press, barbell row, Romanian deadlift; others "basic analysis" (placement, rep counting, range of motion).
4. **Phase 4:** hidden calibration screen: label own reps, compare verdicts, tune thresholds, export thresholds JSON and landmark fixtures.
5. **Phase 5:** store per-exercise results (numbers only); repeated faults lower load or add the corrective; consistent form progresses load.

After each phase: open a PR, wait for the user's "merge it", then confirm the Pages deploy.

## Original v0 features (built in Phase 2)

1. **Setup check:** show the squat placement criteria (side-on, phone around hip height, 1x lens), then run a live check on the camera preview. Whole body in frame (nose to ankles detected with good confidence) and side-on (left and right shoulders and hips nearly overlap horizontally). Show nudges like "step back" or "turn side-on". Enable recording only when the check passes.
2. **Record** a set, or pick an existing video.
3. **Detect reps** from the hip's vertical movement. At the bottom of each rep, compare hip and knee landmark heights: depth is hit when the hip is at or below the knee, with a margin the user can tune.
4. **Results:** hit or miss per rep, the bottom frame with a skeleton overlay, and "couldn't judge" when landmarks are low-confidence.

**Out of scope:** accounts, payments.

## Code layout

- `src/data/types.ts` — exercise config schema (placement, landmarks, tracking, checks, faults)
- `src/data/exercises.ts` — the library: one `ex({...})` entry per exercise. Add exercises here only.
- `src/data/helpers.ts` — builders for checks (`C.*`), faults (`F.*`), placements and joint angles
- `src/program/builder.ts` — rule-based program builder (evidence sources in its header comment)
- `src/screens/` — Preact screens; `src/router.ts` hash routes (`#/groups`, `#/build`, `#/program/:id`, `#/library`, `#/exercise/:id`, `#/camera?exercise=id`)
- `src/storage.ts` — localStorage wrapper
- `src/pose.ts`, `src/camera.ts`, `src/draw.ts` — MediaPipe, camera and skeleton overlay
- `tests/` — library integrity rules and program builder rules

## Decisions

- Library covers free weights, bodyweight, cables and machines. Free weights are preferred by the program builder because machines can hide joints from the camera.
- Every exercise needs: at least one fault with a cue and a corrective that is another library exercise; every check links to a listed fault; checks only use declared landmarks; symmetry checks only on front-view placements; "basic" exercises only carry range-of-motion or hold-alignment checks. `tests/library.test.ts` enforces this.
- Rep tracking uses a joint's vertical movement only, so mainly-horizontal movements (cable flys, face pulls, seated cable rows) are not in the library yet.
- "Top"/"bottom" of a rep = where the tracked joint is highest/lowest on screen. Distances in checks are fractions of torso length.
- Equipment settings: full gym (everything); dumbbells only = dumbbells + bodyweight + pull-up bar (no bench); bodyweight = bodyweight + pull-up bar. A pull-up bar is always assumed.
- Program builder: weekly sets 10/14/18 by level, each muscle 2× a week (3× with 5+ days), session caps, multi-joint first, secondary muscles count half. Unloaded bodyweight moves get higher rep ranges. `minLevel`/`maxLevel` keep advanced moves from beginners and regressions (knee push-ups) from experienced lifters. Deterministic: same inputs give the same program. It adds notes when volume is scaled down or a muscle can't be trained.
- All thresholds are drafts with status "unvalidated" until Phase 3/4.

## Implementation notes

- The MediaPipe WASM runtime and pose model are served from this site (`public/mediapipe/`, populated by `npm run fetch-assets`), not from a CDN, so the app makes no third-party requests at runtime.
- `site/` holds an unrelated landing page and is not part of the app build.

## Commands

- `npm install` — installs deps and fetches MediaPipe assets (postinstall)
- `npm run dev` — dev server on all interfaces (HTTPS needed for camera on a phone; see README)
- `npm test` — run the test suite
- `npm run build` — typecheck + production build to `dist/`
