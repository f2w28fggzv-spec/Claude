// The iPhone app's index.html (nativeIndexHtml in scripts/native-build.ts): the native entry, the app's own CSP, no
// home-screen tags; and a loud failure if index.html changes so that an edit no longer finds its target.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NATIVE_CSP, nativeIndexHtml } from '../scripts/native-build';

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('the native index.html', () => {
  const out = nativeIndexHtml(html);

  it('loads the native entry instead of src/main.tsx', () => {
    expect(out).toContain('<script type="module" src="/src/native/entry.ts"></script>');
    expect(out).not.toContain('/src/main.tsx');
  });

  it('has the app’s own CSP, exactly', () => {
    const csp = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(out)?.[1];
    expect(csp).toBe(
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' blob: data:; img-src 'self' blob: data:; media-src 'self' blob: mediastream:; style-src 'self' 'unsafe-inline'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'",
    );
    expect(csp).toBe(NATIVE_CSP);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(out).toContain('<!-- The iPhone app: everything comes from the app itself (capacitor://localhost); nothing may leave the device. -->');
  });

  it('drops the home-screen tags, the icons and the manifest', () => {
    for (const gone of ['mobile-web-app-capable', 'apple-mobile-web-app', 'rel="icon"', 'apple-touch-icon', 'manifest', 'Added to the home screen', 'service worker']) {
      expect(out, gone).not.toContain(gone);
    }
    // What the app keeps: the viewport (safe areas), the theme colours and the colour scheme, the title.
    for (const kept of ['viewport-fit=cover', 'name="theme-color"', 'name="color-scheme"', '<title>fitee</title>', '<div id="app"></div>']) expect(out, kept).toContain(kept);
  });

  it('throws when index.html no longer has a piece an edit expects', () => {
    const pieces = [
      '<script type="module" src="/src/main.tsx"></script>',
      '<meta name="mobile-web-app-capable" content="yes" />',
      '<meta name="apple-mobile-web-app-capable" content="yes" />',
      '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
      '<meta name="apple-mobile-web-app-title" content="fitee" />',
      '<link rel="icon" href="./favicon.svg" type="image/svg+xml" />',
      '<link rel="apple-touch-icon" href="./apple-touch-icon.png" sizes="180x180" />',
      '<link rel="manifest" href="./manifest.webmanifest" />',
      '<!-- Nothing may be sent off the device',
      'http-equiv="Content-Security-Policy"',
      '<!-- Added to the home screen',
    ];
    for (const piece of pieces) {
      expect(html, piece).toContain(piece);
      expect(() => nativeIndexHtml(html.replace(piece, '')), piece).toThrow(/exactly one/);
    }
    // Twice is as wrong as never.
    expect(() => nativeIndexHtml(html.replace('<link rel="manifest"', '<link rel="manifest" href="x" />\n    <link rel="manifest"'))).toThrow(/exactly one/);
  });
});
