# fitee

Mobile web app: pick muscle groups, get a workout program, and get technique
feedback from your phone camera. All pose detection runs on the phone with
MediaPipe; video never leaves the device, and the app blocks every request to
other websites. The same code is also built into an iPhone app (see
[iPhone app](#iphone-app)).
See [CLAUDE.md](CLAUDE.md) for the full brief.

## Run locally

```sh
npm install      # also downloads the MediaPipe wasm + pose models into public/mediapipe/
npm run dev      # HTTPS dev server (self-signed cert) on all interfaces
npm test         # run tests
```

### Test on your phone (same Wi-Fi)

1. `npm run dev` and note the `Network:` URL, e.g. `https://192.168.1.20:5173/`.
2. Open it on the phone. You'll get a certificate warning because the cert is self-signed:
   - **iPhone Safari:** tap *Show Details* → *visit this website* → *Visit Website*.
   - **Android Chrome:** tap *Advanced* → *Proceed to … (unsafe)*.
3. Tap **Start camera** and allow camera access.

The camera only works over HTTPS, so plain `http://<ip>` will not work.

## Install on your phone

Open https://f2w28fggzv-spec.github.io/Claude/ and add it to your home screen:

- **iPhone or iPad (Safari):** tap *Share*, then *Add to Home Screen*, then
  open it once while you're online and leave it open until it has saved the
  pose model (about 24 MB; it shows how far it has got, and *Settings* says
  *Ready to use offline*): the home-screen app has its own storage, apart
  from Safari, so it saves itself (and the pose model) on that first launch.
  To bring your plans and log, use *Settings → Back up my data* in Safari,
  then *Restore from a backup* in the app.
- **Android (Chrome):** *Settings → Install and offline → Install fitee*, or
  the browser menu's *Install app* / *Add to Home screen*.

It then opens like an app, on its own, without the browser bars.

## Offline use

A service worker (`src/offline/`, written into the build as `sw.js`) keeps a
copy of the app in the browser's cache, so it opens and every screen works
with no signal. Technique checks also need the pose model (about 24 MB): the
installed app saves it by itself on its first launch online, once the terms
are accepted (not where the browser reports Data Saver; iPhones don't report
Low Data Mode to websites); in a browser tab it's saved the first time you
use a technique check, or with *Settings → Install and offline → Save for
offline use*. While it saves, every screen says so (keep the app open until
it's done). Settings shows what is saved, and says so if the phone couldn't
keep the pose model: any refused store of a file that downloaded and matched
counts (`QuotaExceededError`, or `UnknownError` on a really full disk in
Chromium, whose storage estimate shows a fixed headroom however full the disk
is, so the estimate is only a first check). The service worker remembers a
file the phone couldn't keep with an empty cache named for the file and the
time (`fitee-unkept-<hash>-<time>`, so it survives the worker stopping and new
versions): for a week (a day for the app's own files, which are small) nothing
downloads it again by itself (a technique check gets it through the HTTP
cache, unsaved; the installed app doesn't save it; an update that needs it
doesn't download it), until a save asks to try again. On a nearly full disk
even that marker can be lost when the browser restarts, and the file may then
be downloaded again sooner (the privacy policy says so). An
update that changes a pose file the phone had saved installs only once the new
copy is kept, so it never leaves the phone without it: until there's room, the
current version keeps running (offline too), and Settings says how much free
space the new version needs (all it writes: Chromium's estimate can't show the
shortfall), with *Try again*. If a new version is waiting,
*Update and save* applies it first and carries on saving after the reload
(never on the old version); the installed app's own save waits for an update
on its way. When the site already serves a newer version that the phone hasn't
found yet, *Try again* looks for it and downloads nothing until it's here.

Nothing leaves the device: the service worker only loads this site's own files,
never follows a redirect, and refuses every request to another origin (on top
of `src/privacy.ts` and the page's Content Security Policy). The offline copy
holds none of your data. Before downloading a file it looks in the browser's
own HTTP cache, keeping a copy only if its SHA-256 matches the build's list,
and it downloads each file once however many requests ask for it. New versions
download in the background (only the files that changed; each pose file has a
cache of its own, so a new model doesn't copy the rest) and apply the next time
you open the app, or with *Update now* in Settings. A version that fails to
download leaves the current one working; the browser tries again later. If the
very first save fails, Settings says so (and when the phone had no room for
it, says that instead of blaming the connection) and offers *Try again*.

Keep `sw.js` at its URL: a 404 or a redirect there leaves installed phones on
their old version. To retire offline use (or before moving the app to another
address), deploy a `sw.js` that deletes the `fitee-*` caches and unregisters
itself, with no fetch handler.

Check it end to end (Chromium via Playwright, fake camera):

```sh
npm run offline:check -- --work /tmp/offline-check --port 4180
```

The service worker is only registered in production builds, so `npm run dev`
always serves fresh files.

## Landing page

fitee's landing page lives beside the app at
https://f2w28fggzv-spec.github.io/Claude/about/ (source: `about/index.html`
and `src/landing/`). It describes fitee and its vision and has an interest
list; it doesn't link to the app. `npm run build` builds it into
`dist/about/` as a build of its own: the app's files and `sw.js` come out the
same with or without it, and the app's offline copy leaves `about/` out, so
editing the page never updates the app on anyone's phone. The deploy workflow
publishes it with the app, unchanged. (The page is inside the app's
service-worker scope, though, so for someone who uses the app, opening the
page lets the browser check for a new version of the app and install it in
the background, as opening the app does. It only ever fetches this site's own
files.)

The page shares the app's origin, so it runs only its own files (no
third-party scripts, styles, fonts, images or analytics, no cookies) and reads
none of the app's data; its build fails if the page's script takes in code
from outside `src/`. Its Content Security Policy is written at build time.

**The interest list** isn't connected yet: it says sign-ups open soon and
collects nothing. Before it opens, have the page's copy (its privacy note
above all) reviewed along with the app's legal drafts. To open it, set
`SIGNUP` in `src/landing/signup.ts` to one of the presets and deploy:

```ts
export const SIGNUP: SignupConfig | null = { service: 'buttondown', id: 'your-username', contact: 'list@your-domain.example' };
// or { service: 'mailerlite', id: 'ACCOUNT_ID/FORM_ID', contact: 'list@your-domain.example' },
// or { service: 'formspree', id: 'FORM_ID', contact: 'list@your-domain.example' }
```

The build then writes the form (a plain HTML form post to that service, never
`fetch()`: the app's service worker refuses cross-origin fetches from pages it
controls), opens the page's CSP to that one service, and names the service in
the page's privacy note and footer. Check the preset's endpoint and field
names against the service's current embed code first (MailerLite: turn on
double opt-in, leave reCAPTCHA off). The page can't read the service's
answer, so it never says the sign-up went through: Buttondown and Formspree
show their own page, and MailerLite's answer shows in a sandboxed frame under
the form. Every service needs `contact`, an address people can write to to
leave the list, ask what it holds about them or have their address deleted
(an unsubscribe link only stops the emails, and Formspree sends none of its
own): a project or list address, as the page shows it.

Check it end to end (Chromium via Playwright, cut off from every site but
this machine; a stand-in sign-up service runs on port + 1; it also builds the
app alone and checks its files and `sw.js` come out byte for byte the same):

```sh
npm run landing:check -- --work /tmp/landing-check --port 4402
```

The app screens on the page are the real app with made-up sample data; when
the app's screens change, make them again (writes `src/landing/screens/`):

```sh
npm run landing:screens -- --work /tmp/landing-screens --port 4405
```

In `npm run dev` the page is at `/about/`, and reloads when you edit a module
that writes its HTML (`src/landing/prerender.ts`, `src/landing/signup.ts`).

## iPhone app

fitee's iPhone app (`ios/`) is the same web code, built for it with
`npm run build:native` (into `dist-native/`), inside a Capacitor 8.6.3 shell:
iPhone only, iOS 17 or later (an iPhone-only app also runs on iPads, in
compatibility mode). The pose model ships inside it, and it makes no network
requests: the page's own guard, its Content Security Policy and a content
blocker in the web view refuse them, and a gate in front of Capacitor's bridge
lets the page reach only fitee's own plugin, console logging and the status
bar. The plans, log, profile and settings stay in the web view's storage with
a copy in the app's folder (in the phone's backups, like any app's data);
saved sets and videos are files the app asks iOS to leave out of backups.
"Back up my data" opens iOS's Save to Files panel. CLAUDE.md has the rules and
the design (its hard rules, and "iPhone app" under Decisions);
`src/native/bridge.ts` is the contract between the page and the Swift code.

### No Mac needed

GitHub's macOS runner builds and runs the app (`.github/workflows/ios.yml`);
everything else works on Linux. To put the app's web files into the Xcode
project:

```sh
npm run build:native   # typecheck, then dist-native/ (pose files checked against scripts/native-pose-files.json)
npm run native:sync    # dist-native/ into ios/App/App/public/, Capacitor's two config files, the bundle ID
```

`native:sync` does what the Capacitor CLI's `cap copy ios` does (its output
was compared once with the CLI's, byte for byte); the CLI isn't a dependency.
What it writes is git-ignored. Run it before every `xcodebuild`.

A new pose model from Google's "latest" URLs (which `npm install` fetches)
fails `build:native` on purpose: the app ships the files it was tested with.
If the new model is the one wanted, update `scripts/native-pose-files.json` in
a commit of its own.

On Linux, check the native build in Chromium with a stand-in for the native
side, and check that the web build hasn't changed by a single byte (after any
change to a file the two builds share; quote the last line in the pull
request):

```sh
npm run native:check -- --work /tmp/native-check --port 4460
tools/native-check/web-identity.sh <base commit> /tmp/web-identity
```

### The Xcode project

`ios/` was generated once, in a scratch copy of the repo, with a throwaway
CLI (not in `package.json`; `CI=1` keeps it from asking anything or sending
telemetry), then edited by hand (iOS 17.0, iPhone only, no storyboard but the
launch screen, fitee's Swift files: CLAUDE.md's code layout lists them):

```sh
CI=1 npx --yes @capacitor/cli@8.6.3 add ios --packagemanager CocoaPods
```

CocoaPods compiles Capacitor from `node_modules/@capacitor/ios`. Its output
(`ios/App/Pods/`, `ios/App/Podfile.lock`, `ios/App/App.xcworkspace`) is
committed, and CI never runs `pod install`. Run it again only when
`ios/App/Podfile` or Capacitor's version changes, with CocoaPods 1.17.0 (the
runner's), which runs on Linux too (`$GEMS` and `$SCRATCH` are folders of your
choice; `--allow-root` only as root):

```sh
gem install --no-document --install-dir "$GEMS" cocoapods -v 1.17.0
cd ios/App && LANG=C.UTF-8 GEM_HOME="$GEMS" GEM_PATH="$GEMS" PATH="$GEMS/bin:$PATH" \
  CP_HOME_DIR="$SCRATCH/.cocoapods" pod install --allow-root
```

Every pod is a local `:path` pod, so CocoaPods' trunk isn't needed. Then run
`npx vitest run tests/native-project.test.ts`: `Podfile.lock` must equal
`Pods/Manifest.lock`, and nothing committed may hold an absolute path.

**The bundle ID** is `appId` in `capacitor.config.ts` (the placeholder
`app.fitee`) and nowhere else: change it there, run `npm run native:sync`
(it writes both `PRODUCT_BUNDLE_IDENTIFIER` lines of the Xcode project), and
commit both. Do it before the App Store Connect record is made: a bundle ID
can't change after release.

**The icon** is `tools/app-icon/icon.svg`: `npm run app-icon` renders
`AppIcon-1024.png` (opaque RGB: App Store Connect refuses an icon with alpha).

### The simulator check (CI)

Every push to a `claude/**` branch, and every manual run (Actions → iPhone
app → Run workflow), runs the `simulator` job on `macos-26` with Xcode 26.6.
It builds the web files, copies them in, builds Debug and Release for the
simulator without signing, and runs `tools/ios-check/simulator-check.sh`
(its header says what each launch must show):

- both bundles: Info.plist's keys, the files the app must and mustn't ship,
  the privacy manifests of the app, Capacitor and Cordova;
- the Debug build on an iPhone 17, in light and then dark appearance: the
  `fitee:ready` marker's facts (the app's own origin, the pose model loaded
  through the privacy guard, the runtime served as `application/wasm`, an
  outside request refused, the content rules and the bridge gate in place),
  the status bar text, one bridge, no error line;
- the self-test (`-fiteeSelfTest`): video files saved, served by range, left
  out of backups and played; the copy of the log, written twice (the second
  write moves the first to `snapshot.prev.json`); the pose model; the CSP's
  and the privacy guard's refusals; keep-awake; the bridge gate (ten calls to
  plugins the page must never reach, each unanswered); and the content rules
  blocking a request to a server on the runner (`probe-server.cjs`) that
  loads without them;
- the same Debug build on an iPad (A16), in compatibility mode and the light
  appearance, checked as the iPhone's light launch;
- the Release build: it keeps running for 15 s, shows a page and logs nothing.

The artifact `ios-simulator-<run>-<attempt>` (kept 14 days) holds each
launch's console (`console-light.log`, `console-dark.log`,
`console-selftest.log`, `console-ipad.log`, `console-release.log`), the
screenshots (`welcome-light.png`, `welcome-dark.png`, `welcome-ipad.png`,
`release.png`), both bundles' Info.plist as JSON, the probe server's log and,
when the job failed, the simulators' system logs. Debug builds print every
plugin call: these consoles are of made-up data, so never give a Debug build
to a tester or upload a console from a real phone. `tests/ios-check.test.ts`
runs the same script on Linux against stand-in `xcrun` and `plutil`, and the
workflow runs it again under the runner's own bash (3.2) before building.

### TestFlight

The `testflight` job runs only by hand (Run workflow), after the simulator
job has passed, and only when four repository secrets exist: `ASC_KEY_ID`,
`ASC_ISSUER_ID`, `ASC_KEY_P8` (the text of the `.p8` file) and
`APPLE_TEAM_ID`. Without them it says so and does nothing. It hasn't run yet:
its first run is a launch-checklist step. Before it, the account owner:

- makes the App Store Connect API key a **Team** key (not an individual one)
  with the **Admin** role: cloud signing refuses the other roles, and a key's
  role can't be raised later (make a new key);
- registers the bundle ID and creates the app's record in App Store Connect
  (the API can't create an app);
- accepts any pending agreement in the developer account (the Account Holder
  must have signed the latest one);
- checks the team's name: with accented or other non-ASCII letters, cloud-
  signed uploads are currently refused with ITMS-90035 (Apple feedback
  FB24633162), so use `development` below until Apple fixes it (or renames
  the team).

The Run workflow form's `archive_signing` picks how the archive is signed:

- `adhoc` (the default): a local ad hoc signature, as Xcode Cloud does: no
  certificate, profile or registered device. The export then signs the app
  for distribution with Apple's cloud signing, through the API key, and
  uploads it.
- `development`: the archive is signed for development through the API key.
  That needs one iPhone registered in the developer account, and every run
  makes a new "Apple Development" certificate whose private key goes with the
  runner: delete those in the developer account now and then, before the
  account's limit (reported at about ten).

No certificate is ever put in a keychain. The build number is the run's
number, and App Store Connect refuses a build number it already has, so
start a new run rather than re-running one. Make the first upload the bare
shell, before any subscription work: App Store Connect might refuse
Capacitor's frameworks built from source (ITMS-91065); the fallbacks are in
CLAUDE.md ("iPhone app" under Decisions).

### What only the simulator run, or a real iPhone, can show

No Swift toolchain runs here, so the first macOS run is the first compile.
The simulator run shows that the Swift compiles against Capacitor 8.6.3 with
Xcode 26.6 and the committed pods build with `xcodebuild` alone; that the app
launches with one bridge; WebKit's facts (the page's origin
`capacitor://localhost`, the CSP's `'self'`, a secure context, the camera and
MediaRecorder APIs, SIMD, no service worker); that the content rules compile
and block, the gate drops what it must and the status bar follows the
appearance; that saved videos are served with Range requests and play, with
their backup flags read back, and that the copy of the log is written,
rotated into `snapshot.prev.json` by the next write, and read back; that
MediaPipe loads in the web view; the bundles' contents; that the Release
configuration compiles and runs; and that the app opens on an iPad.

Only a real iPhone can show (the launch checklist):

- the live camera, the skeleton overlay and an MP4 recording of the camera;
  saving a real 20–40 MB recording (time, memory);
- the camera and microphone prompts (Take Video in the picker), and that a
  picked or filmed video's temporary copy is gone after its results close;
- that iCloud backups leave `sets/` out and keep `data/`; an iCloud restore
  onto a second phone; WebKit clearing its storage, and the restore toast;
  file protection with the phone locked;
- the screen staying on during a hands-free recording, and sleeping again
  after the web process dies during a check; a copy written as the app goes
  to the background;
- beeps with the Silent switch on and with music playing;
- the App Privacy Report showing no network activity for fitee;
- Save to Files (Back up my data) and Restore from a backup;
- the status-bar strip in landscape and with a pinned theme;
- the keyboard opening by itself where a screen focuses a field (the app lets
  script focus open it, unlike Safari);
- iOS 17 (CI has iOS 26 only), and speed on an older iPhone.

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` builds and deploys on every push to `main`
(or run it manually from the Actions tab). One-time setup: repo
**Settings → Pages → Source: GitHub Actions**. The app is then at
`https://<user>.github.io/<repo>/` (the repo name is case-sensitive:
this one is at https://f2w28fggzv-spec.github.io/Claude/).
