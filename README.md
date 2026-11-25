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
is, so the estimate is only a first check). A file the phone couldn't keep is
then fetched through the HTTP cache until a save asks the service worker to
try again, and the installed app doesn't download it by itself for a week.
If a new version is waiting, *Update and save* applies it first and carries
on saving after the reload; the installed app's own save waits for an update
on its way.

Nothing leaves the device: the service worker only loads this site's own files,
never follows a redirect, and refuses every request to another origin (on top
of `src/privacy.ts` and the page's Content Security Policy). The offline copy
holds none of your data. Before downloading a file it looks in the browser's
own HTTP cache, keeping a copy only if its SHA-256 matches the build's list,
and it downloads each file once however many requests ask for it. New versions
download in the background (only the files that changed; each pose file has a
cache of its own, so a new model doesn't copy the rest) and apply the next time
you open the app, or with *Update now* in Settings. A changed pose file the
phone can't keep is skipped (saved later) rather than holding the update back.
A version that fails to download leaves the current one working; the browser
tries again later. If the very first save fails, Settings says so and offers
*Try again*.

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

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` builds and deploys on every push to `main`
(or run it manually from the Actions tab). One-time setup: repo
**Settings → Pages → Source: GitHub Actions**. The app is then at
`https://<user>.github.io/<repo>/` (the repo name is case-sensitive:
this one is at https://f2w28fggzv-spec.github.io/Claude/).
