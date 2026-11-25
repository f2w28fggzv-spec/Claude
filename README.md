# fitee

Mobile web app: pick muscle groups, get a workout program, and get technique
feedback from your phone camera. All pose detection runs on the phone with
MediaPipe; video never leaves the device, and the app blocks every request to
other websites.
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
collects nothing. To open it, set `SIGNUP` in `src/landing/signup.ts` to one
of the presets and deploy:

```ts
export const SIGNUP: SignupConfig | null = { service: 'buttondown', id: 'your-username' };
// or { service: 'mailerlite', id: 'ACCOUNT_ID/FORM_ID' },
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
the form. Formspree sends no email of its own, so it needs `contact`, an
address people can write to to leave the list (a project or list address: the
page shows it).

Check it end to end (Chromium via Playwright, cut off from every site but
this machine; a stand-in sign-up service runs on port + 1):

```sh
npm run landing:check -- --work /tmp/landing-check --port 4402
```

The app screens on the page are the real app with made-up sample data; when
the app's screens change, make them again (writes `src/landing/screens/`):

```sh
npm run landing:screens -- --work /tmp/landing-screens --port 4405
```

In `npm run dev` the page is at `/about/`.

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` builds and deploys on every push to `main`
(or run it manually from the Actions tab). One-time setup: repo
**Settings → Pages → Source: GitHub Actions**. The app is then at
`https://<user>.github.io/<repo>/` (the repo name is case-sensitive:
this one is at https://f2w28fggzv-spec.github.io/Claude/).
