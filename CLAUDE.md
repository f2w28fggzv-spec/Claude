# CLAUDE.md

## Project

AI form-check app. Long term: a phone app that analyzes lifting videos and adjusts the user's training program based on detected form issues. This repo is the first prototype.

**Current goal:** turn the prototype into a working app for general use: a muscle group selector, an exercise library, technique feedback for every exercise, workout programs built from the selected muscle groups, and a training log (calendar, sets, reps, weights, progress) with a coach that adapts the plan (in the spirit of MyFitnessPal, for lifting). Built in phases (see Roadmap). The original v0 goal (squat depth from a side-view video) is folded into Phase 2.

## Hard rules

- Video never leaves the device. No uploads, no storage, no analytics. Discard frames after analysis.
- Must run in mobile Safari and Chrome over HTTPS (needed for camera access).
- No third-party network requests. `src/privacy.ts` (imported first in `main.tsx`) blocks any cross-origin fetch/XHR/beacon, and `index.html` sets a CSP with `connect-src 'self'`. Keep both: MediaPipe tasks-vision has a built-in usage logger that POSTs to `odml.pa.googleapis.com` and can't be turned off.
- No backend. Only settings, programs and numbers (never video or images) are stored, and only on the device (localStorage; IndexedDB for calibration landmark recordings). Exports are files saved on the device, never uploads.
- Keep the live skeleton overlay working.
- UI copy calls this "technique feedback". No injury-prevention or medical claims.
- Don't add checks the landmarks can't support (e.g. no spine rounding: there are no spine landmarks). When confidence is low or the camera view can't show a check, report "couldn't judge"; never guess.
- Don't download or scrape videos from YouTube, Instagram, TikTok or any other site.

## Stack

- Vite + TypeScript + Preact, no backend
- Vitest for tests (landmark JSON fixtures, no video). `tests/tsconfig.json` adds Node types for tests only.
- MediaPipe Pose Landmarker (tasks-vision, web), running on-device
- Deploy to GitHub Pages

## Roadmap

1. **Phase 1 (done):** muscle group selector, exercise library (data file), rule-based program builder, programs saved on device.
2. **Phase 2 (done):** generic form analysis engine driven by exercise config: rep segmentation, all check types, per-rep pass/fail/couldn't judge, generalized setup check, limb-proportion personalization, live recording (hands-free) and video-file analysis, results screen.
3. **Phase 3 (done):** sourced technique standards → thresholds (cited in `src/data/sources.ts` and next to each check, all still "unvalidated"). Full analysis for back squat, bench press, deadlift, overhead press, barbell row, Romanian deadlift; others "basic analysis" (placement, rep counting, range of motion).
4. **Phase 4 (done):** hidden calibration screen: label own reps, compare verdicts, tune thresholds, export thresholds JSON and landmark fixtures. Shipped together with: front/back camera flip, page transitions and motion, and the training log + coach (most of Phase 5).
5. **Phase 5 (mostly done in the Phase 4 PR):** technique checks saved as numbers to the log; repeated faults lower load and add the corrective; full sets progress load. Still open: tune the coach rules on real logs, and calibrate thresholds with real labelled reps (`src/data/calibrated.json` is empty until then).

After each phase: open a PR, wait for the user's "merge it", then confirm the Pages deploy.

## Original v0 features (now covered by Phase 2)

1. **Setup check:** show the squat placement criteria (side-on, phone around hip height, 1x lens), then run a live check on the camera preview. Whole body in frame (nose to ankles detected with good confidence) and side-on (left and right shoulders and hips nearly overlap horizontally). Show nudges like "step back" or "turn side-on". Enable recording only when the check passes.
2. **Record** a set, or pick an existing video.
3. **Detect reps** from the hip's vertical movement. At the bottom of each rep, compare hip and knee landmark heights: depth is hit when the hip is at or below the knee, with a margin the user can tune.
4. **Results:** hit or miss per rep, the bottom frame with a skeleton overlay, and "couldn't judge" when landmarks are low-confidence.

**Out of scope:** accounts, payments.

## Code layout

- `src/data/types.ts` — exercise config schema (placement, landmarks, tracking, checks, faults)
- `src/data/exercises.ts` — the library: one `ex({...})` entry per exercise. Add exercises here only.
- `src/data/helpers.ts` — builders for checks (`C.*`), faults (`F.*`), placements and joint angles
- `src/data/sources.ts` — written sources behind thresholds (`SRC`), `cite()`, shared constants (`LOCKOUT_DEG`, `MIN_ECCENTRIC_SEC`), and the draft-source text for basic-analysis checks
- `src/data/filters.ts` — Exercises-tab filters (muscle, equipment group, difficulty, type, full analysis only); pure and tested in `tests/filters.test.ts`
- `src/program/builder.ts` — rule-based program builder (evidence sources in its header comment)
- `src/screens/` — Preact screens; `src/router.ts` hash routes: `#/` (Plan tab "Today": next workout with suggested weights, this week, coach, full plan; or "Create my plan"), `#/groups` (step 1: muscle tiles), `#/build` (step 2: days, experience, equipment), `#/program/:id` (an earlier plan), `#/workout` (workout in progress), `#/log` (Log tab: calendar, month stats, recent workouts, progress per exercise), `#/session/:id` (one finished workout), `#/progress/:id` (chart + records + history for one exercise), `#/settings` (units, backup/restore, delete all, camera test), `#/library` (Exercises tab), `#/exercise/:id`, `#/analyze/:id` (technique check; `?calibrate` saves the recording for calibration instead), `#/camera` (camera test), `#/dev/calibrate` (hidden: tap the version in Settings 5 times)
- `src/router.ts` also sets `html[data-nav]` (forward / back / tab, from the route depth table) and wraps route changes in `document.startViewTransition` when supported; `src/app.tsx` keys each page on path + query.
- `src/screens/Layout.tsx` — `Screen` (header with back button, optional bottom tab bar `tab`, optional pinned `action` button); `src/screens/icons.tsx` — inline SVG icons: `MuscleIcon` (anatomical muscle map, front view for chest/shoulders/biceps/core/quads and back view for back/triceps/glutes/hamstrings/calves, selected group highlighted; shapes authored for the left half and mirrored, smoothed with Catmull-Rom), line icons, `LevelIcon`
- `src/storage.ts` — localStorage wrapper (plans, settings, overrides, camera facing)
- `src/log/` — training log, pure and tested in `tests/log.test.ts`: `types.ts` (Workout, SetEntry, TechniqueSummary; weights always stored in kg), `stats.ts` (unit conversion, `formatWeight`, Epley e1RM, volume, history, records, week streak, calendar keys, muscle sets), `store.ts` (localStorage: workouts, active workout, technique summaries, unit; backup / restore / delete all), `session.ts` (start a plan day with the coach's planned weights, tick sets, finish), `coach.ts` (suggestions, next plan day, insights, add corrective)
- `src/calibration/` — `calibrate.ts` (score labelled recordings per check, threshold suggestions, export thresholds / fixtures, `applyCalibration`), `store.ts` (recordings in IndexedDB via `src/db.ts`); tested in `tests/calibration.test.ts`
- `src/data/calibrated.json` — thresholds exported from the calibration screen and committed; `exercises.ts` applies them on load (`DRAFT_EXERCISES` → `EXERCISES`) and marks those checks `calibrated`
- `src/ui/` — `toast.tsx`, `CountUp.tsx` (animated numbers), `download.ts` (save JSON to the device)
- `src/pose.ts`, `src/camera.ts`, `src/draw.ts` — MediaPipe, camera and skeleton overlay
- `src/engine/` — analysis engine, pure TypeScript with no DOM: `analyze.ts` (entry), `reps.ts` + `zigzag.ts` (rep segmentation), `checks.ts` (one evaluator per check type), `setup.ts` (live setup check), `personalize.ts` (limb proportions), `landmarks.ts`, `geometry.ts`, `signal.ts`, `types.ts` (PoseSequence format)
- `src/analysis/` — browser side: `runner.ts` (shared model, monotonic timestamps), `usePoseCamera.ts` (live loop + overlay), `fileSource.ts` (video files), `snapshots.ts` (in-memory JPEGs for results), `feedback.ts` (beeps, wake lock)
- `src/screens/Analyze.tsx` (setup → countdown → recording / file → results), `Results.tsx`; `DevCalibrate.tsx`; `WorkoutScreen.tsx`, `LogScreen.tsx`, `SessionScreen.tsx`, `ProgressScreen.tsx` + `ProgressChart.tsx` (single-series SVG chart with crosshair, pointer and arrow keys), `SettingsScreen.tsx`
- `src/privacy.ts` — network guard
- `src/demo/` — animated how-to demos: `figure.ts` (2D body, segment lengths from Winter 2009, forward kinematics + two-link IK), `patterns.ts` (movement patterns: squat, lunge, hinge, deadlift, presses, rows, pull-ups, curls, planks…), `timeline.ts` (rep timing), `attach.ts` (props on joints), `types.ts`. Rendered by `src/screens/ExerciseDemo.tsx`; every exercise's `demo` field picks a pattern with parameters.
- Hidden page `#/dev/demos` shows every demo (`?still` for start / middle / turnaround frames).
- `tests/demo.test.ts` — every demo is well-formed and, run through the engine as a recording (`tests/fixtures/demoSeq.ts`), counts its reps and passes all its exercise's checks.
- `tests/` — library and builder rules; `tests/engine/` engine tests; `tests/fixtures/` landmark fixtures (`synth.ts` generates them, `npm run fixtures` writes `*.json.gz`, `load.ts` reads `.json` or `.json.gz`); `tests/fixtures/real/` labelled recordings exported from the calibration screen (each becomes a test that the current thresholds agree with the labels)

## Decisions

- Library covers free weights, bodyweight, cables and machines. Free weights are preferred by the program builder because machines can hide joints from the camera.
- Every exercise needs: at least one fault with a cue and a corrective that is another library exercise; every check links to a listed fault; checks only use declared landmarks; symmetry checks only on front-view placements; "basic" exercises only carry range-of-motion or hold-alignment checks. `tests/library.test.ts` enforces this.
- Rep tracking uses a joint's vertical movement only, so mainly-horizontal movements (cable flys, face pulls, seated cable rows) are not in the library yet.
- "Top"/"bottom" of a rep = where the tracked joint is highest/lowest on screen. Distances in checks are fractions of torso length.
- Equipment settings: full gym (everything); dumbbells only = dumbbells + bodyweight + pull-up bar (no bench); bodyweight = bodyweight + pull-up bar. A pull-up bar is always assumed.
- Program builder: weekly sets 10/14/18 by level, each muscle 2× a week (3× with 5+ days), session caps, multi-joint first, secondary muscles count half. Unloaded bodyweight moves get higher rep ranges. `minLevel`/`maxLevel` keep advanced moves from beginners and regressions (knee push-ups) from experienced lifters. Deterministic: same inputs give the same program. It adds notes when volume is scaled down or a muscle can't be trained.
- Thresholds (Phase 3): every check has a `source` (enforced by tests). Full-analysis lifts use written standards: NSCA lifting proficiencies, IPF Technical Rules 2026, Larsen et al. 2021 (squat torso angle), Duffey & Challis 2005 (bench bar path, lowering time), ACSM 2009 (tempo), Schellenberg et al. 2013 (deadlift hip range), Soucie et al. 2011 (normal joint ranges). Where a standard is qualitative only, the comment and source say the number is derived. Lockout = 165° (180° minus a 15° tolerance for 2D landmark error, Wade et al. 2023). Tempo limits are in measured seconds (engine trims the slow ends, so ACSM's 1 s → 0.8 s). Basic-analysis range checks carry a "draft, no published standard yet" source with normal joint ranges for context. Every threshold stays `status: 'unvalidated'` until Phase 4 calibration.
- Standards changes in Phase 3: squat depth = thighs parallel (NSCA; IPF is stricter, users can raise the margin), torso lean ≤ 60°, squat hip-path check removed (no standard); bench depth = elbows to shoulder level (IPF 2026 rule) instead of an elbow angle; deadlift set-up = hips below shoulders (NSCA) instead of a torso angle; row torso ≥ 60° from vertical (NSCA "slightly above parallel").
- The exercise page shows "Full analysis"/"Basic analysis" and a "How we judge it" list with each check's target and source.
- Engine: no exercise-specific code. Joint names resolve to the near side (side view, chosen by visibility) or both sides/midpoint (front view). Torso length (shoulder to hip) is the scale for distances. Reps = home → far → home turning points of the tracked joint (hysteresis = max(minAmplitude/2, 25% of movement range); reps smaller than `minAmplitude` are ignored; recordings that start or end mid-rep don't count that rep). `firstPhase` says whether the first move is eccentric or concentric (for tempo).
- "Couldn't judge" whenever a check's joints are below visibility 0.6 at the key frames, under 60% coverage for whole-rep checks, or the camera angle is wrong for the rep (side-on ratio of shoulder/hip separation to torso length < 0.35, front > 0.3; setup check is stricter: < 0.25 / > 0.4). Tempo only needs the tracked joint, so it's still judged.
- Personalization: `ProportionMeter` measures thigh/shin/upper arm/forearm ÷ torso while standing side-on during setup (saved on device, numbers only). Rules are named in config (`personalize: 'squatTorsoLean'`), based on Winter (2009) reference proportions and a bar-over-mid-foot model, capped at ±12°.
- Recording: the live camera computes landmarks as it goes; no video is recorded or buffered. Hands-free mode (default on) starts 3 s after the setup check holds and stops when the lifter stays still at the start position for 3 s after a rep, leaves the frame for 2 s, or after 3 minutes. Picked video files are read locally via an object URL at 20 fps, then released.
- Results pictures: small JPEGs of each rep's turnaround frame kept in memory only and cleared when the results screen closes. Live recordings capture them at the online turning points; files seek back to the exact frames after analysis.
- User-tuned depth margin (results screen, under "Adjust depth strictness") is stored as a threshold override in localStorage.
- Exercises tab filters: muscle row plus a Filters sheet (equipment groups match if the exercise uses any selected item; "Bodyweight" = needs no weights, pull-up/dip bars and benches allowed; difficulty = the exercise's `minLevel`; compound/isolation; full analysis only). Remembered per device in localStorage.
- UI: keep it simple. Three tabs (Plan, Log, Exercises); one primary action per screen; plan creation is two steps with large tappable tiles; details (weekly volume, all checks, depth tuning) go behind `<details>`. Icons are inline SVG (no icon fonts or external assets). The pose-model picker only appears on the camera test page (default: full model).
- How-to demos are animated figures, not videos (user's choice): drawn from the same camera angle as the exercise's placement, correct form by construction, no copyright or network requests, respects reduced motion. Demos must pass their own exercise's checks (tests/demo.test.ts); when thresholds change in Phase 3/4, fix the demo or the threshold, whichever is wrong.
- Front-view one-sided exercises (e.g. side-lying hip abduction, cable lateral raise) read angles from the working side (the side whose tracked joint travels further) instead of averaging both sides.
- Calibration (Phase 4): labels are per rep (fault ids; empty = good). A check is expected to fail exactly when its fault is labelled; accuracy = agreement on judged reps ("couldn't judge" is not counted). Suggestions sweep the threshold and only appear when they beat the current agreement. Personalization is off while calibrating so thresholds suit average proportions. Recordings (landmark numbers only) live in IndexedDB, can be exported as fixtures, and are wiped by "Delete all my data". Workflow: export thresholds JSON → merge into `src/data/calibrated.json` → commit; "Use these thresholds on this phone" saves them as local overrides instead.
- Camera: the front camera is the default (users need to see the screen to set up), mirrored in the preview; a flip button sits on the preview during setup and countdown, and the choice is remembered. The back camera gives sharper landmarks when someone else films.
- Motion: page changes use the View Transitions API (slide forward/back by route depth, fade between tabs; fallback CSS entrance where unsupported), tab pill glides, cards and rows rise in with a stagger, press feedback on tappables, toasts, counting numbers, the chart line draws in. Everything collapses to instant under `prefers-reduced-motion`. Animate only transform/opacity where possible.
- Training log: weights stored in kg and shown in kg or lb (Settings). A workout from a plan day is pre-filled with the coach's weights and reps; typing a value carries it to later unfilled sets; ticking a set fills planned values and starts a rest timer. Unticked sets are dropped when finishing. Estimated one-rep max = Epley (1985). Backup is a JSON file saved on the device (all `formcheck.v1.*` keys); restore reads it back.
- Coach ("AI analysis"): rule-based and on-device, not an AI service (hard rules: no network, no backend). Double progression: same weight until every set hits the top of the rep range, then add the smallest sensible step (kg: 2 dumbbell / 5 lower-body compound / 2.5 other; lb: 5 / 10 / 5), capped at 10% (ACSM 2009: 2–10%). Two sessions below the range → about 10% lighter. A fault in 2 of the last 3 technique checks → about 10% lighter, the fault's cue, and its corrective added to the workout and offered for the plan. Insights: new bests (grouped, last 7 days), stalls (no e1RM gain in 3 sessions), week progress, muscles not trained in 10 days. Next plan day = the one after the last day trained from that plan.
- Technique checks save a numbers-only summary (reps, faults per rep, clean reps) to the log automatically; calibration recordings don't.
- Dumbbell fly has no range-of-motion check: from a side-on camera the arms move toward and away from the lens, so the shoulder angle can't be measured. Reps are still counted.

## Implementation notes

- The MediaPipe WASM runtime and pose model are served from this site (`public/mediapipe/`, populated by `npm run fetch-assets`), not from a CDN, so the app makes no third-party requests at runtime.
- `site/` holds an unrelated landing page and is not part of the app build.

## Commands

- `npm install` — installs deps and fetches MediaPipe assets (postinstall)
- `npm run dev` — dev server on all interfaces (HTTPS needed for camera on a phone; see README)
- `npm test` — run the test suite
- `npm run fixtures` — regenerate synthetic landmark fixtures
- `npm run typecheck` — typecheck app and tests
- `npm run build` — typecheck + production build to `dist/`
