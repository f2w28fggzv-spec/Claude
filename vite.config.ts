/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { landingBuild } from './scripts/landing-build.ts';
import { nativeBuild, webHasNoNativeCode } from './scripts/native-build.ts';
import { offlineBuild } from './scripts/offline-build.ts';

// Relative base so the build works at https://<user>.github.io/<repo>/.
// basicSsl gives the dev server a self-signed HTTPS cert so phones on the
// same Wi-Fi can open the camera (getUserMedia requires a secure context).
// offlineBuild writes the service worker (sw.js) after each production build;
// landingBuild then builds the landing page into about/ (a build of its own,
// left out of the app's offline copy) and serves it at /about/ in dev.
//
// `vite build --mode native` (npm run build:native) builds the iPhone app's copy into dist-native/:
// __NATIVE__ is true, the native build swaps in a few modules and its own index.html entry
// (scripts/native-build.ts), and there is no service worker and no landing page. In every other mode
// __NATIVE__ is false, so the web build drops each `if (__NATIVE__)` branch as dead code, with any
// import() of src/native/ inside it; webHasNoNativeCode() fails the web build if anything native gets in.
export default defineConfig(({ mode }) => {
  const native = mode === 'native';
  return {
    base: './',
    define: { __NATIVE__: JSON.stringify(native) },
    plugins: native ? [preact(), nativeBuild()] : [preact(), basicSsl(), webHasNoNativeCode(), offlineBuild(), landingBuild()],
    server: { host: true },
    build: native ? { target: 'es2022', outDir: 'dist-native', emptyOutDir: true } : { target: 'es2022' },
    // npm test (Vitest reads this file too): this checkout's tests only, not those of other checkouts of the repo that
    // tools keep inside it (.claude/worktrees/). The first two are Vitest's own defaults.
    test: { exclude: ['**/node_modules/**', '**/.git/**', '.claude/**'] },
  };
});
