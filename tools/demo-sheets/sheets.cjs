#!/usr/bin/env node
// Renders exercise demos to PNG sheets with the app's real renderer and theme
// tokens, for reviewing movements without opening the app.
//
//   npm run demo:sheets -- --ids back-squat,deadlift --frames 5 --out /tmp/sheets
//   npm run demo:sheets -- --out /tmp/sheets                 (all exercises)
//
// Options: --ids a,b      exercises (default: all)
//          --frames N     frames from start (s = 0) to turnaround (s = 1); default 5
//          --themes a,b   light, dark or both (default: light)
//          --out DIR      output folder (default: ./demo-sheets-out)
//          --height PX    height of each frame (default 300)
//          --per N        exercises per image (default 1); with N > 1 the
//                         images are sheet-01.<theme>.png, sheet-02... in order
// Writes one PNG per exercise and theme: <id>.<theme>.png (or sheets, see --per).
// Needs Playwright with Chromium (a dev tool, not a dependency of the app).
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const out = path.resolve(opt('out', 'demo-sheets-out'));
const themes = opt('themes', 'light').split(',');
const height = Number(opt('height', 300));
const per = Math.max(1, Number(opt('per', 1)));
fs.mkdirSync(out, { recursive: true });

const json = path.join(os.tmpdir(), `demo-frames-${process.pid}.json`);
try {
  execFileSync('npx', ['vitest', 'run', '--config', 'tools/demo-sheets/vitest.config.ts'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DEMO_OUT: json, DEMO_IDS: opt('ids', ''), DEMO_FRAMES: opt('frames', '5') },
  });
} catch (e) {
  console.error('Exporting frames failed:\n' + (e.stdout || '') + (e.stderr || ''));
  process.exit(1);
}
const demos = JSON.parse(fs.readFileSync(json, 'utf8'));
fs.rmSync(json, { force: true });

// Theme tokens straight from the app's stylesheet.
const css = fs.readFileSync(path.join(ROOT, 'src', 'style.css'), 'utf8');
const block = (marker) => {
  const i = css.indexOf(marker);
  if (i < 0) throw new Error('token block not found: ' + marker);
  const open = css.indexOf('{', i);
  return css.slice(open + 1, css.indexOf('\n}', open));
};
const row = (d) => {
  const w = Math.round(Math.min(height * 1.5, Math.max(height * 0.62, height * d.aspect)));
  const muscles = d.muscles.map((m) => `${m.group} (${m.role} ${m.peak})`).join('<br>');
  return `<div class="row"><div class="label">${d.name}<small>${d.id}<br>${d.view} view · ${d.firstPhase} first<br>${muscles}</small></div>${d.frames
    .map((f) => `<div class="cell"><span class="cap">s=${f.s}</span><svg width="${w}" height="${height}" viewBox="${d.viewBox}">${f.svg}</svg></div>`)
    .join('')}</div>`;
};
const groups = [];
for (let i = 0; i < demos.length; i += per) groups.push(demos.slice(i, i + per));
const nameOf = (g, k) => (per === 1 ? g[0].id : `sheet-${String(k + 1).padStart(2, '0')}`);
const page = (theme) => `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font-family:system-ui,sans-serif}
.base{${block(':root {')}}
.theme-dark{${block(":root[data-theme='dark'] {")}}
.sheet{display:inline-block;background:var(--bg);color:var(--text);padding:10px}
.row{display:flex;align-items:stretch;gap:8px;margin-bottom:8px}
.label{width:128px;font:600 13px/1.25 system-ui;color:var(--text);align-self:center}
.label small{display:block;font-weight:400;color:var(--muted);font-size:11px;margin-top:3px}
.cell{background:var(--card);border-radius:14px;padding:6px;position:relative}
.cell svg{display:block}
.cap{position:absolute;left:8px;top:6px;font:11px system-ui;color:var(--muted)}
</style></head><body>${groups
  .map((g, k) => `<div class="sheet base theme-${theme}" data-id="${nameOf(g, k)}">${g.map(row).join('')}</div><br>`)
  .join('')}</body></html>`;

(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('This tool needs Playwright (npm i -g playwright, then npx playwright install chromium).');
    process.exit(1);
  }
  const browser = await chromium.launch();
  const errors = [];
  for (const theme of themes) {
    const tab = await browser.newPage({ viewport: { width: 2200, height: 900 }, deviceScaleFactor: 1 });
    tab.on('pageerror', (e) => errors.push(e.message));
    await tab.setContent(page(theme));
    for (let k = 0; k < groups.length; k++) {
      const name = nameOf(groups[k], k);
      await tab.locator(`[data-id="${name}"]`).screenshot({ path: path.join(out, `${name}.${theme}.png`) });
    }
    await tab.close();
  }
  await browser.close();
  const bad = demos.filter((d) => d.frames.some((f) => /NaN|undefined|Infinity/.test(f.svg))).map((d) => d.id);
  console.log(`${demos.length} demo(s) x ${themes.length} theme(s) in ${groups.length * themes.length} image(s), written to ${out}`);
  if (per > 1) groups.forEach((g, k) => console.log(`  ${nameOf(g, k)}: ${g.map((d) => d.id).join(', ')}`));
  if (bad.length) console.log('BAD NUMBERS in markup: ' + bad.join(', '));
  if (errors.length) console.log('PAGE ERRORS: ' + errors.join(' | '));
})();
