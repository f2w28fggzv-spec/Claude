# Form Check

Mobile web app: pick muscle groups, get a workout program, and (from Phase 2)
technique feedback from your phone camera. All pose detection runs on the
phone with MediaPipe; video never leaves the device.
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

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` builds and deploys on every push to `main`
(or run it manually from the Actions tab). One-time setup: repo
**Settings → Pages → Source: GitHub Actions**. The app is then at
`https://<user>.github.io/<repo>/` (the repo name is case-sensitive:
this one is at https://f2w28fggzv-spec.github.io/Claude/).
