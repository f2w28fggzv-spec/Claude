import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { landingBuild } from './scripts/landing-build.ts';
import { offlineBuild } from './scripts/offline-build.ts';

// Relative base so the build works at https://<user>.github.io/<repo>/.
// basicSsl gives the dev server a self-signed HTTPS cert so phones on the
// same Wi-Fi can open the camera (getUserMedia requires a secure context).
// offlineBuild writes the service worker (sw.js) after each production build;
// landingBuild then builds the landing page into about/ (a build of its own,
// left out of the app's offline copy) and serves it at /about/ in dev.
export default defineConfig({
  base: './',
  plugins: [preact(), basicSsl(), offlineBuild(), landingBuild()],
  server: { host: true },
  build: { target: 'es2022' },
});
