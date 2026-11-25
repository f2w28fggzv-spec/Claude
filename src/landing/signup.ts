// The landing page's interest list: which sign-up service receives the
// emails. This is the one place to change when the list opens.
//
// While SIGNUP is null the list says sign-ups open soon and has no form at
// all, nothing is collected, and the page's Content-Security-Policy allows
// no form target and no frame.
//
// To connect a service, set SIGNUP to ONE of these, then deploy:
//   export const SIGNUP: SignupConfig | null = { service: 'buttondown', id: 'your-username' };
//   export const SIGNUP: SignupConfig | null = { service: 'mailerlite', id: 'ACCOUNT_ID/FORM_ID' };
//   export const SIGNUP: SignupConfig | null = { service: 'formspree', id: 'FORM_ID' };
// The build (scripts/landing-build.ts) turns it into the form (its endpoint
// and field names), the page's CSP (form-action and frame-src: that one
// service's origin) and the page's privacy note, which then names the
// service. Check the preset against the service's current embed code first
// (endpoints and field names change), and set the service up as its preset
// says (double opt-in on, no CAPTCHA in a hidden frame).
//
// The form is a plain HTML form POST, never fetch(): this page shares its
// origin with the app, whose service worker answers any fetch to another site
// with a network error (form posts are navigations, which it never touches).
// Nothing is stored on the device.
//
// Pure: no DOM, no Node. The build, the tests and the page's own script read it.

export type SignupService = 'buttondown' | 'mailerlite' | 'formspree';

export interface SignupConfig {
  service: SignupService;
  /** Buttondown: your username. MailerLite: "ACCOUNT_ID/FORM_ID". Formspree: the form's id. */
  id: string;
  /** Instead of the preset's way to post: 'frame' (a hidden frame; the page shows its own message) or 'page' (the service's own page). */
  mode?: 'frame' | 'page';
}

/** The interest list's sign-up service. null: not connected yet (the user chose "decide later"). */
export const SIGNUP: SignupConfig | null = null;

/** Everything the page needs to post to a service, resolved at build time. */
export interface SignupTarget {
  /** The service's name, as the page shows it. */
  name: string;
  /** Where the form posts. */
  action: string;
  /** Its origin: the only form target (and frame) the page's CSP allows. */
  origin: string;
  /** The name of the email field the service reads. */
  field: string;
  /** Hidden fields the service's own embed form sends. */
  extra: Record<string, string>;
  /**
   * 'frame': into a hidden, sandboxed iframe, so the visitor stays on the page
   * and sees its own message (which can't know whether the address arrived:
   * the page can't read the service's answer). 'page': a normal post, and the
   * visitor sees the service's own page (its thank-you page, or a CAPTCHA).
   */
  mode: 'frame' | 'page';
  /** The service emails a link to confirm the address (double opt-in). */
  confirms: boolean;
  /** How to leave the list, for the privacy note. */
  leave: string;
}

interface Preset {
  name: string;
  origin: string;
  endpoint: (id: string) => string;
  /** What a valid id looks like. */
  id: RegExp;
  field: string;
  extra: Record<string, string>;
  mode: 'frame' | 'page';
  confirms: boolean;
  leave: string;
}

/**
 * The three services offered for later. Endpoints and field names as their
 * embed forms used them when this was written: check against the service's
 * current embed code when connecting.
 */
export const PRESETS: Record<SignupService, Preset> = {
  // Buttondown: the embed form posts `email` (and `embed=1`) to
  // https://buttondown.com/api/emails/embed-subscribe/<username>, and
  // Buttondown emails a link to confirm. Check against Buttondown's current
  // embed code when connecting.
  buttondown: {
    name: 'Buttondown',
    origin: 'https://buttondown.com',
    endpoint: (id) => `https://buttondown.com/api/emails/embed-subscribe/${encodeURIComponent(id)}`,
    id: /^[A-Za-z0-9_-]+$/,
    field: 'email',
    extra: { embed: '1' },
    mode: 'frame',
    confirms: true,
    leave: 'Every email from the list has a link to unsubscribe.',
  },
  // MailerLite: the embedded form posts `fields[email]` (with `ml-submit=1`
  // and `anticsrf=true`) to
  // https://assets.mailerlite.com/jsonp/<account>/forms/<form>/subscribe and
  // answers with JSON, which lands in the hidden frame. Turn on double opt-in
  // for the form and leave its reCAPTCHA off (a hidden frame can't show it).
  // Check against MailerLite's current embed code when connecting.
  mailerlite: {
    name: 'MailerLite',
    origin: 'https://assets.mailerlite.com',
    endpoint: (id) => {
      const [account, form] = id.split('/');
      return `https://assets.mailerlite.com/jsonp/${encodeURIComponent(account)}/forms/${encodeURIComponent(form)}/subscribe`;
    },
    id: /^\d+\/\d+$/,
    field: 'fields[email]',
    extra: { 'ml-submit': '1', anticsrf: 'true' },
    mode: 'frame',
    confirms: true,
    leave: 'Every email from the list has a link to unsubscribe.',
  },
  // Formspree: a plain form posts `email` to https://formspree.io/f/<form id>
  // and the visitor sees Formspree's own page, which can ask for a CAPTCHA
  // (so it posts top-level, not into a hidden frame). It's a form inbox: it
  // sends no confirmation email. Check against Formspree's current docs when
  // connecting.
  formspree: {
    name: 'Formspree',
    origin: 'https://formspree.io',
    endpoint: (id) => `https://formspree.io/f/${encodeURIComponent(id)}`,
    id: /^[A-Za-z0-9]+$/,
    field: 'email',
    extra: {},
    mode: 'page',
    confirms: false,
    leave: 'Reply to any email from us and we’ll take you off the list.',
  },
};

/** The form's target for a config, or null while the list isn't connected. Throws on a config the build can't use. */
export function signupTarget(config: SignupConfig | null): SignupTarget | null {
  if (!config) return null;
  const preset = PRESETS[config.service];
  if (!preset) throw new Error(`landing sign-up: unknown service "${String(config.service)}" (use buttondown, mailerlite or formspree)`);
  const id = config.id.trim();
  if (!preset.id.test(id)) throw new Error(`landing sign-up: "${id}" isn't a valid ${preset.name} id`);
  if (config.mode !== undefined && config.mode !== 'frame' && config.mode !== 'page') throw new Error(`landing sign-up: mode must be 'frame' or 'page'`);
  return {
    name: preset.name,
    action: preset.endpoint(id),
    origin: preset.origin,
    field: preset.field,
    extra: { ...preset.extra },
    mode: config.mode ?? preset.mode,
    confirms: preset.confirms,
    leave: preset.leave,
  };
}

/**
 * A stand-in service for tests (tools/landing-check), from the build's
 * FITEE_LANDING_TEST_SIGNUP environment variable: JSON with `action` (an
 * http URL on localhost or 127.0.0.1, nothing else) and optionally `mode`,
 * `field` and `confirms`. Never used by a normal build.
 */
export function testSignupTarget(raw: string): SignupTarget {
  const v = JSON.parse(raw) as { action?: unknown; mode?: unknown; field?: unknown; confirms?: unknown };
  const url = new URL(String(v.action));
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('landing sign-up: the test service must be an http URL on localhost');
  }
  const mode = v.mode === 'page' ? 'page' : 'frame';
  return {
    name: 'a stand-in sign-up service (test build)',
    action: url.href,
    origin: url.origin,
    field: typeof v.field === 'string' && v.field ? v.field : 'email',
    extra: {},
    mode,
    confirms: v.confirms !== false,
    leave: 'This is a test build: nothing is kept.',
  };
}

/**
 * The page's Content-Security-Policy (a meta tag, written at build time).
 * Only this site's own scripts, styles, fonts and images; no inline script
 * or style; no plugins; no <base>. form-action and frame-src are 'none'
 * until a service is connected, then only that service's origin (frame-src
 * only when the form posts into the hidden frame).
 */
export function landingCsp(target: SignupTarget | null): string {
  const form = target ? target.origin : "'none'";
  const frame = target && target.mode === 'frame' ? target.origin : "'none'";
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    `form-action ${form}`,
    `frame-src ${frame}`,
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');
}
