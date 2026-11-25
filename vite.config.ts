import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { offlineBuild } from './scripts/offline-build.ts';

// Relative base so the build works at https://<user>.github.io/<repo>/.
// basicSsl gives the dev server a self-signed HTTPS cert so phones on the
// same Wi-Fi can open the camera (getUserMedia requires a secure context).
// offlineBuild writes the service worker (sw.js) after each production build.
export default defineConfig({
  base: './',
  plugins: [preact(), basicSsl(), offlineBuild()],
  server: { host: true },
  build: { target: 'es2022' },
});
