#!/usr/bin/env node
// Screenshots of the real app, filled with made-up sample data, for the
// landing page (src/landing/screens/). A dev tool, not part of the app, the
// page's build or `npm test`; run it again when the app's screens change.
//
//   npm run landing:screens -- --work DIR --port 4405
//   npm run landing:screens -- --work DIR --port 4405 --only set,reps
//
// It builds the app (production build) into DIR/app, bundles the seed
// (seed.ts: the app's own program builder, session helpers, analysis engine
// and saved-set store, on a clock fixed at Friday 20 November 2026, 17:40
// UTC) next to it, serves both under http://localhost:<port>/Claude/, and
// shoots each screen at 390 x 844 CSS px, device scale 2, in light and dark:
// the muscle picker, the plan, the technique-check setup, a saved set paused
// on rep 3 and its rep list, a workout the coach adjusted and the coach's
// note, the Log tab, the week's body map, and the Train tab with the network
// switched off, served by the app's own service worker from its offline copy.
// Then it crops them and writes WebP (Chromium's encoder) at two widths per
// picture into src/landing/screens/ (or --out). No request may leave localhost.
//
// Needs Playwright with Chromium (NODE_PATH pointing at a global install is fine).
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../offline-check/server.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const PORT = Number(opt('port', 4405));
const WORK = path.resolve(opt('work', '') || fs.mkdtempSync(path.join(os.tmpdir(), 'fitee-landing-screens-')));
const OUT = path.resolve(opt('out', path.join(ROOT, 'src', 'landing', 'screens')));
const ONLY = opt('only', '').split(',').filter(Boolean);
const QUALITY = Number(opt('quality', '0.8'));
const BASE = `http://localhost:${PORT}/Claude/`;
/** The sample "today": a Friday evening, so this week shows two of three plan days done and Day 1 next. */
const TODAY = '2026-11-20T17:40:00Z';
const APP = path.join(WORK, 'app');
const RAW = path.join(WORK, 'raw');

/**
 * Each picture: the screenshot it comes from, the part of it (CSS px of the
 * 390 x 844 screen), and the widths written. Phones are 780 px wide at
 * device scale 2; cards are cut from a screen (358 CSS px wide).
 */
const PICTURES = [
  { name: 'groups', from: 'groups', top: 0, h: 560, widths: [480, 780] },
  { name: 'program', from: 'program', top: 0, h: 560, widths: [480, 780] },
  { name: 'analyze', from: 'analyze', top: 0, h: 560, widths: [480, 780] },
  { name: 'set', from: 'set', top: 0, h: 716, widths: [480, 780] },
  { name: 'reps', from: 'reps', card: true, widths: [440, 716] },
  { name: 'workout', from: 'workout', top: 0, h: 716, widths: [480, 780] },
  { name: 'coach', from: 'coach', card: true, widths: [440, 716] },
  { name: 'log', from: 'log', top: 0, h: 844, widths: [480, 780] },
  { name: 'week', from: 'week', top: 0, h: 844, widths: [480, 780] },
  { name: 'today', from: 'today-offline', top: 0, h: 844, widths: [480, 780] },
];

function buildApp() {
  if (opt('keep-build', '') !== 'yes' || !fs.existsSync(path.join(APP, 'index.html'))) {
    execFileSync('npx', ['vite', 'build', '--outDir', APP, '--emptyOutDir', '--logLevel', 'warn'], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
  }
}

/** The seed page at /Claude/__seed/: seed.ts bundled for the browser with Vite. */
async function buildSeed() {
  const { build } = await import('vite');
  const dir = path.join(APP, '__seed');
  await build({
    configFile: false,
    logLevel: 'warn',
    root: ROOT,
    publicDir: false,
    build: {
      outDir: dir,
      emptyOutDir: true,
      minify: false,
      target: 'es2022',
      lib: { entry: path.join(__dirname, 'seed.ts'), formats: ['es'], fileName: () => 'seed.js' },
    },
  });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>seed</title><script type="module" src="./seed.js"></script>\n');
}

const settle = (page, ms = 500) => page.waitForTimeout(ms);
const scrollTo = (sel, offset = 16, nth = 0) => async (page) => {
  await page.evaluate(
    ({ sel, offset, nth }) => {
      const el = document.querySelectorAll(sel)[nth];
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset, behavior: 'instant' });
    },
    { sel, offset, nth },
  );
  await settle(page);
};
/** A region of the screen in CSS px (after scrolling it into view), for a card cut from a screen. */
const clipOf = (page, fn, arg) => page.evaluate(fn, arg);

/** The screens: where to go, what to do first, and (cards) which part to cut. */
const SHOTS = [
  {
    name: 'groups',
    route: '#/groups',
    prep: async (page) => {
      await page.evaluate(() => localStorage.setItem('formcheck.v1.groups', JSON.stringify(['chest', 'back', 'quads', 'glutes'])));
      await page.reload();
      await settle(page, 900);
    },
  },
  { name: 'program', route: '#/program/PLAN' },
  { name: 'analyze', route: '#/analyze/back-squat' },
  {
    name: 'set',
    route: '#/set/sampleC',
    prep: async (page, info) => {
      // Paused at the bottom of rep 3, the shallow one.
      await page.evaluate((v) => {
        const r = document.querySelector('.player-controls input[type=range]');
        r.value = String(v);
        r.dispatchEvent(new Event('input', { bubbles: true }));
      }, info.shown.reps[2].tTurn);
      await settle(page);
    },
  },
  {
    name: 'reps',
    route: '#/set/sampleC',
    // Reps 3 and 4 of the set's rep list: a fault and a check it couldn't judge.
    clip: (page) =>
      clipOf(page, () => {
        const items = document.querySelectorAll('.set-reps > li');
        window.scrollTo({ top: items[2].getBoundingClientRect().top + window.scrollY - 16, behavior: 'instant' });
        const card = items[0].closest('.card').getBoundingClientRect();
        const a = items[2].getBoundingClientRect();
        const b = items[3].getBoundingClientRect();
        // From just below the line above rep 3 to the line below rep 4.
        return { x: card.left, top: a.top + 1, width: card.width, bottom: b.bottom };
      }),
  },
  {
    name: 'workout',
    route: '',
    prep: async (page) => {
      await page.getByRole('button', { name: 'Start workout' }).click();
      await settle(page, 1200);
    },
  },
  {
    name: 'coach',
    route: '',
    // The coach's card with its first note (the repeated fault, its cue and the exercise that helps).
    clip: (page) =>
      clipOf(page, () => {
        const card = document.querySelector('section.card.coach');
        window.scrollTo({ top: card.getBoundingClientRect().top + window.scrollY - 16, behavior: 'instant' });
        const c = card.getBoundingClientRect();
        const [first, second] = card.querySelectorAll('.insights > li');
        const f = first.getBoundingClientRect();
        // Down to half way to the next note, so none of it shows.
        const next = second ? second.getBoundingClientRect().top : f.bottom + 20;
        return { x: c.left, top: c.top, width: c.width, bottom: Math.round((f.bottom + next) / 2) + 6 };
      }),
  },
  { name: 'log', route: '#/log' },
  { name: 'week', route: '', prep: scrollTo('section.card.week') },
];

async function shootApp(browser, offsite) {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      colorScheme: theme,
      // No service worker here: every screen comes from the network (Playwright's block makes register() fail, which the app shrugs off).
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
      timezoneId: 'UTC',
      locale: 'en-US',
    });
    await ctx.clock.install({ time: new Date(TODAY) });
    await ctx.clock.resume();
    ctx.on('request', (r) => {
      const u = new URL(r.url());
      if (u.hostname !== 'localhost' && !['data:', 'blob:'].includes(u.protocol)) offsite.push(r.url());
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log(`  (${theme}) page error: ${e.message}`));
    await page.goto(BASE + '__seed/');
    await page.waitForFunction(() => typeof window.seed === 'function');
    const info = await page.evaluate(() => window.seed());
    if (theme === 'light') console.log('seeded:', JSON.stringify({ program: info.program, workouts: info.workouts, shown: info.shown && info.shown.reps.map((r) => r.checks) }));
    const planId = await page.evaluate(() => JSON.parse(localStorage.getItem('formcheck.v1.programs'))[0].id);
    for (const s of SHOTS) {
      if (ONLY.length && !ONLY.includes(s.name)) continue;
      await page.goto(BASE + s.route.replace('PLAN', planId));
      await settle(page, 1000);
      if (s.prep) await s.prep(page, info);
      const file = path.join(RAW, `${s.name}.${theme}.png`);
      if (s.clip) {
        const c = await s.clip(page);
        await settle(page);
        // In the viewport (the app's tab bar is fixed to the bottom; the cut stays above it).
        if (c.bottom > 844 - 90) throw new Error(`${s.name}: the card doesn't fit above the tab bar`);
        await page.screenshot({ path: file, clip: { x: c.x, y: c.top, width: c.width, height: c.bottom - c.top } });
      } else await page.screenshot({ path: file });
      console.log(`  shot ${s.name} (${theme})`);
    }
    await ctx.close();
  }
}

/** The Train tab with no network at all, served by the app's own service worker from its offline copy. */
async function shootOffline(browser, offsite, server) {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: theme, serviceWorkers: 'allow', reducedMotion: 'reduce', timezoneId: 'UTC', locale: 'en-US' });
    await ctx.clock.install({ time: new Date(TODAY) });
    await ctx.clock.resume();
    ctx.on('request', (r) => {
      const u = new URL(r.url());
      if (u.hostname !== 'localhost' && !['data:', 'blob:'].includes(u.protocol)) offsite.push(r.url());
    });
    const page = await ctx.newPage();
    await page.goto(BASE + '__seed/');
    await page.waitForFunction(() => typeof window.seed === 'function');
    await page.evaluate(() => window.seed());
    await page.goto(BASE);
    // The worker saves the app's own files (a tab doesn't save the pose model by itself), then takes over.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 });
    await ctx.setOffline(true);
    server.setDown(true);
    await page.reload();
    await settle(page, 1500);
    const offline = await page.evaluate(() => !navigator.onLine && !!document.querySelector('h1'));
    if (!offline) throw new Error('the Train tab did not open offline');
    await page.screenshot({ path: path.join(RAW, `today-offline.${theme}.png`) });
    server.setDown(false);
    console.log(`  shot today-offline (${theme}), network off`);
    await ctx.close();
  }
}

/** Crops and scales each picture and writes it as WebP with Chromium's own encoder. */
async function encode(browser) {
  fs.mkdirSync(OUT, { recursive: true });
  const page = await browser.newPage();
  let total = 0;
  for (const p of PICTURES) {
    if (ONLY.length && !ONLY.includes(p.from) && !ONLY.includes(p.name)) continue;
    for (const theme of ['light', 'dark']) {
      const data = 'data:image/png;base64,' + fs.readFileSync(path.join(RAW, `${p.from}.${theme}.png`)).toString('base64');
      for (const width of p.widths) {
        const webp = await page.evaluate(
          async ({ data, p, width, q }) => {
            const img = new Image();
            img.src = data;
            await img.decode();
            // Screens: CSS px of a 390 px wide screen at device scale 2. Cards: the whole cut.
            const k = img.naturalWidth / (p.card ? img.naturalWidth / 2 : 390);
            const sx = 0;
            const sy = p.card ? 0 : p.top * k;
            const sw = img.naturalWidth;
            const sh = p.card ? img.naturalHeight : p.h * k;
            const c = document.createElement('canvas');
            c.width = width;
            c.height = Math.round((sh * width) / sw);
            const ctx = c.getContext('2d');
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
            return { url: c.toDataURL('image/webp', q), w: c.width, h: c.height };
          },
          { data, p, width, q: QUALITY },
        );
        const buf = Buffer.from(webp.url.split(',')[1], 'base64');
        const file = path.join(OUT, `${p.name}-${theme}-${width}.webp`);
        fs.writeFileSync(file, buf);
        total += buf.length;
        console.log(`  ${path.basename(file)}  ${webp.w} x ${webp.h}  ${(buf.length / 1024).toFixed(1)} KB`);
      }
    }
  }
  await page.close();
  console.log(`wrote ${(total / 1024).toFixed(0)} KB of pictures to ${OUT}`);
}

(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('landing:screens needs Playwright (npm i -D playwright, or NODE_PATH to a global install).');
    process.exit(1);
  }
  fs.mkdirSync(RAW, { recursive: true });
  console.log(`Building the app into ${APP} …`);
  buildApp();
  await buildSeed();
  const server = createServer({ port: PORT });
  server.setRoot(APP);
  await server.listen();
  const browser = await chromium.launch();
  const offsite = [];
  try {
    await shootApp(browser, offsite);
    if (!ONLY.length || ONLY.includes('today') || ONLY.includes('today-offline')) await shootOffline(browser, offsite, server);
    await encode(browser);
  } finally {
    await browser.close();
    await server.close();
  }
  if (offsite.length) {
    console.error('FAIL: requests left localhost:\n  ' + offsite.join('\n  '));
    process.exit(1);
  }
  console.log('No request left localhost.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
