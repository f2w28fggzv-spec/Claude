// Build step for the landing page (about/index.html, code in src/landing/),
// served at /Claude/about/ beside the app. After the app's production build
// it builds the page into <outDir>/about/ with Vite, as a build of its own:
// the app's files never depend on the page, so editing the page never
// changes the app on anyone's phone, and the app's offline copy leaves
// about/ out (src/offline/manifest.ts).
//
// The page's static HTML is made from the app's own code at build time
// (src/landing/prerender.ts, run in Node through Vite's module runner): the
// hero's first frame and legends, the logo mark, and the
// Content-Security-Policy and interest list from the sign-up config
// (src/landing/signup.ts).
//
// The page shares its origin with the app, so it may run only this repo's
// own code: the build fails if its script takes in a module from anywhere but
// src/ (an npm package, say), or a file from anywhere but src/, public/ and
// the app's font package (ownCodeOnly).
//
// Runs from the Vite plugin below (vite.config.ts), or by hand into a build folder:
//   node scripts/landing-build.ts dist
// FITEE_LANDING_TEST_SIGNUP (tests only) connects a stand-in service on localhost.
import { readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Plugin, ViteDevServer } from 'vite';
import { LANDING_DIR as LANDING_PATH, poseFilesFor } from '../src/offline/manifest.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** The page's folder in the build (and its URL path under the app's), which the app's offline copy leaves out. */
export const LANDING_DIR = LANDING_PATH.replace(/\/$/, '');
const TEMPLATE = join(ROOT, LANDING_DIR, 'index.html');
const PRERENDER = join(ROOT, 'src', 'landing', 'prerender.ts');
const SIGNUP = join(ROOT, 'src', 'landing', 'signup.ts');
const STYLES = join(ROOT, 'src', 'landing', 'landing.css');
const TOKENS = join(ROOT, 'src', 'tokens.css');
const LICENCE = join(ROOT, 'public', 'licenses', 'bricolage-grotesque-OFL.txt');
/** The one package the page takes files from: the app's own font (its CSS and font files, no code). */
const FONT_PACKAGE = join(ROOT, 'node_modules', '@fontsource-variable', 'bricolage-grotesque');
/** Where it really is (Vite reports files by their real path, so a symlinked node_modules points elsewhere). */
const FONT_DIRS = (() => {
  try {
    return [...new Set([FONT_PACKAGE, realpathSync(FONT_PACKAGE)])];
  } catch {
    return [FONT_PACKAGE];
  }
})();
/** In landing.css: replaced with the Molten tokens, so the interest list's panel is a Molten surface in both themes. */
const MOLTEN_MARK = '/* fitee:molten-tokens */';

type Prerender = typeof import('../src/landing/prerender.ts');
type Signup = typeof import('../src/landing/signup.ts');
/** Loads one of the page's build-time modules (TypeScript, in Node). */
type Loader = <T>(file: string) => Promise<T>;

/** Loads with Vite's module runner (a production build). */
const runner: Loader = async <T>(file: string) => {
  const { runnerImport } = await import('vite');
  const { module } = await runnerImport<T>(file, { configFile: false, root: ROOT, logLevel: 'error' });
  return module;
};

/** The sign-up service the page posts to: the test override, else the config in src/landing/signup.ts. */
async function signupTarget(load: Loader) {
  const signup = await load<Signup>(SIGNUP);
  const test = process.env.FITEE_LANDING_TEST_SIGNUP;
  if (test) {
    console.warn('landing: test build, the interest list posts to a stand-in service on localhost (FITEE_LANDING_TEST_SIGNUP)');
    return signup.testSignupTarget(test);
  }
  return signup.signupTarget(signup.SIGNUP);
}

const isPage = (file: string | undefined) => !!file && resolve(file) === TEMPLATE;
const isStyles = (id: string) => resolve(id.split('?')[0]) === STYLES;
/** Whether `file` is `dir` or inside it. */
const within = (dir: string, file: string) => {
  const r = relative(dir, file);
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
};

/**
 * The bytes a technique check loads and the installed app saves (the pose
 * runtime most browsers use, SIMD, and the full model), from public/mediapipe:
 * the page says the size as the app does (formatMB), so it follows the model
 * CI fetches. Throws if the files aren't there (npm run fetch-assets).
 */
export function poseBytes(): number {
  return poseFilesFor(true, 'full').reduce((n, f) => {
    const file = join(ROOT, 'public', f);
    try {
      return n + statSync(file).size;
    } catch {
      throw new Error(`landing: ${relative(ROOT, file)} is missing (npm run fetch-assets): the page says the pose model's size`);
    }
  }, 0);
}

/**
 * The page's folder in a build folder, which the build replaces. Throws when
 * that would be the page's own source (the build folder is the repo itself):
 * replacing it would delete the template.
 */
export function landingFolder(outDir: string): string {
  const folder = join(resolve(outDir), LANDING_DIR);
  if (within(folder, TEMPLATE)) throw new Error(`landing: the build folder can't be the repo itself (${resolve(outDir)}): building there would delete ${relative(ROOT, TEMPLATE)}`);
  return folder;
}

/** What went into the page's build: the modules its script is made of, and the source files of its other files. */
export interface LandingInputs {
  /** Every module in the page's script (absolute paths, or a bundler's virtual id). */
  modules: string[];
  /** The source files the build copied (pictures, fonts, styles, the icon). */
  sources: string[];
}

/**
 * The page shares its origin with the app, so it runs only this repo's own
 * code: every module of its script from src/, every other file from src/,
 * public/ or the app's font package. Returns what's out of place (empty when
 * all is well).
 */
export function notOwnCode(inputs: LandingInputs): string[] {
  const src = join(ROOT, 'src');
  const out = inputs.modules.filter((m) => {
    const file = resolve(ROOT, m.split('?')[0]);
    // The template is the entry (Vite reads the page's HTML as a module).
    return file !== TEMPLATE && (!within(src, file) || file.includes('node_modules'));
  });
  for (const f of inputs.sources) {
    const file = resolve(ROOT, f);
    const ok = (within(src, file) && !file.includes('node_modules')) || within(join(ROOT, 'public'), file) || FONT_DIRS.some((d) => within(d, file)) || file === TEMPLATE;
    if (!ok) out.push(f);
  }
  return out.map((m) => (isAbsolute(m) ? relative(ROOT, m) : m));
}

/** What the page's build and the dev server share: the HTML from its template, and the panel's tokens. */
function landingPage(load: () => Loader): Plugin {
  return {
    name: 'fitee-landing-page',
    enforce: 'pre',
    async transform(code, id) {
      if (!isStyles(id)) return null;
      if (!code.includes(MOLTEN_MARK)) this.error(`landing: ${MOLTEN_MARK} is missing from landing.css`);
      const pre = await load()<Prerender>(PRERENDER);
      return { code: code.replace(MOLTEN_MARK, pre.moltenTokens(readFileSync(TOKENS, 'utf8'))), map: null };
    },
    transformIndexHtml: {
      order: 'pre',
      async handler(html, ctx) {
        if (!isPage(ctx.filename)) return html;
        const loader = load();
        const pre = await loader<Prerender>(PRERENDER);
        return pre.renderPage(html, await signupTarget(loader), { poseBytes: poseBytes() });
      },
    },
  };
}

/**
 * Builds the page into <outDir>/about/ (the folder is replaced). Its own
 * Vite build: nothing is shared with the app's bundle, nothing is inlined
 * (the page's CSP allows no data: URLs), and nothing from public/ is copied.
 * Fails if the page would run code from outside this repo (notOwnCode).
 * Returns the files it wrote (relative to outDir) and what went into them.
 */
export async function buildLanding(outDir: string): Promise<{ files: string[] } & LandingInputs> {
  const { build } = await import('vite');
  const out = resolve(outDir);
  rmSync(landingFolder(out), { recursive: true, force: true });
  const result = await build({
    configFile: false,
    logLevel: 'warn',
    root: ROOT,
    base: './',
    publicDir: false,
    plugins: [
      landingPage(() => runner),
      {
        name: 'fitee-landing-licence',
        generateBundle() {
          // The font's licence, next to the page (its footer links to it).
          this.emitFile({ type: 'asset', fileName: `${LANDING_DIR}/licenses/bricolage-grotesque-OFL.txt`, source: readFileSync(LICENCE) });
        },
      },
    ],
    build: {
      outDir: out,
      emptyOutDir: false,
      assetsDir: `${LANDING_DIR}/assets`,
      assetsInlineLimit: 0,
      copyPublicDir: false,
      target: 'es2022',
      modulePreload: { polyfill: false },
      sourcemap: false,
      rolldownOptions: { input: TEMPLATE },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => ('output' in r ? r.output : []));
  const files = outputs.map((o) => o.fileName.split(sep).join('/')).sort();
  const stray = files.filter((f) => !f.startsWith(`${LANDING_DIR}/`));
  if (stray.length) throw new Error(`landing: the page's build wrote outside ${LANDING_DIR}/: ${stray.join(', ')}`);
  const inputs: LandingInputs = {
    modules: outputs.flatMap((o) => (o.type === 'chunk' ? o.moduleIds : [])).sort(),
    sources: outputs.flatMap((o) => (o.type === 'asset' ? o.originalFileNames : [])).sort(),
  };
  const foreign = notOwnCode(inputs);
  if (foreign.length) throw new Error(`landing: the page runs only this repo's own code (it shares the app's origin), but its build took in: ${foreign.join(', ')}`);
  return { files, ...inputs };
}

/**
 * Vite plugin for the app's config: builds the page after every production
 * build, into the configured output folder (after sw.js is written; the
 * app's offline copy leaves about/ out either way). In the dev server it
 * serves the page at /about/.
 */
export function landingBuild(): Plugin[] {
  let outDir = '';
  let server: ViteDevServer | undefined;
  /** The dev server's own module loader (fresh after each edit). */
  const dev: Loader = async <T>(file: string) => (await server!.ssrLoadModule(`/${relative(ROOT, file).split(sep).join('/')}`)) as T;
  return [
    {
      name: 'fitee-landing',
      apply: 'build',
      configResolved(config) {
        outDir = resolve(config.root, config.build.outDir);
      },
      closeBundle: {
        sequential: true,
        async handler() {
          const { files } = await buildLanding(outDir);
          console.log(`landing page: ${files.length} files in ${LANDING_DIR}/ (not part of the app's offline copy)`);
        },
      },
    },
    {
      ...landingPage(() => dev),
      apply: 'serve',
      configureServer(s) {
        server = s;
      },
    },
  ];
}

// By hand: node scripts/landing-build.ts <outDir>
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: node scripts/landing-build.ts <outDir>');
    process.exit(1);
  }
  const { files } = await buildLanding(resolve(dir));
  console.log(`landing page: ${files.length} files in ${join(dir, LANDING_DIR)}`);
}
