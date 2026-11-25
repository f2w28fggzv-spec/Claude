// The interest list's form, once a sign-up service is connected
// (src/landing/signup.ts). While it isn't, the page has no form at all and
// this does nothing.
//
// The form is a plain HTML form POST to the service, never fetch(): this page
// shares its origin with the app, whose service worker answers any fetch to
// another site with a network error, and a form post is a navigation, which
// it never touches. Nothing is stored on the device. Without this script the
// form still posts, as a normal page (the browser checks the address).
//
// With it: the address is checked here, with the error in words next to the
// field (aria-invalid, announced) rather than the browser's bubble; an
// offline phone is told so before anything is sent; and a 'frame' service
// gets the post in a hidden, sandboxed frame, so the visitor stays here. The
// page can't read the service's answer, so its message only says what
// happens next if the sign-up went through, never that it did; a slow or
// missing answer says so, and "try again" brings the form back.

/** How long to wait for the service's answer in the hidden frame. */
export const ANSWER_TIMEOUT_MS = 20_000;
const FRAME_NAME = 'fitee-signup';
/** Something@something.tld: what the services accept (the browser's own check allows "a@b"). */
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;

export const isEmail = (value: string) => EMAIL.test(value);

const reduced = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export function startList(doc: Document): void {
  const form = doc.querySelector<HTMLFormElement>('form.signup');
  if (!form) return; // not connected: there is nothing to send
  const input = form.querySelector<HTMLInputElement>('input[type=email]');
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]');
  const status = form.querySelector<HTMLElement>('.signup-status');
  if (!input || !button || !status) return;
  const panel = form.closest<HTMLElement>('.panel') ?? form.parentElement!;
  const thanks = panel.querySelector<HTMLElement>('.thanks');
  const mode = form.dataset.mode === 'page' ? 'page' : 'frame';
  // Our own messages instead of the browser's bubbles.
  form.noValidate = true;

  const say = (text: string, error = false) => {
    status.textContent = text;
    status.classList.toggle('is-error', error);
  };
  const invalid = (text: string) => {
    input.setAttribute('aria-invalid', 'true');
    say(text, true);
    input.focus();
  };
  input.addEventListener('input', () => {
    if (input.getAttribute('aria-invalid')) {
      input.removeAttribute('aria-invalid');
      say('');
    }
  });

  // "Join the interest list" elsewhere on the page goes straight to the field.
  for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[data-join]')) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      panel.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
      input.focus({ preventScroll: true });
    });
  }

  let frame: HTMLIFrameElement | null = null;
  if (mode === 'frame' && thanks) {
    frame = doc.createElement('iframe');
    frame.name = FRAME_NAME;
    frame.title = 'Sign-up service’s answer';
    // The answer loads here with no scripts and no way to move this page.
    frame.setAttribute('sandbox', '');
    frame.hidden = true;
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    panel.append(frame);
    form.target = FRAME_NAME;
  }

  let sending = false;
  let timer = 0;
  const done = () => {
    window.clearTimeout(timer);
    sending = false;
    button.disabled = false;
  };

  form.addEventListener('submit', (e) => {
    if (sending) return e.preventDefault();
    const email = input.value.trim();
    input.value = email;
    if (!email) {
      e.preventDefault();
      return invalid('Enter your email address.');
    }
    if (!isEmail(email) || !input.checkValidity()) {
      e.preventDefault();
      return invalid('That doesn’t look like an email address. Check it, then try again (like name@example.com).');
    }
    if (navigator.onLine === false) {
      e.preventDefault();
      return say('You’re offline. Connect to the internet, then try again.', true);
    }
    // 'page': the browser goes on to the service's own page.
    if (!frame) return say('Opening the sign-up page…');
    sending = true;
    say('Sending…');
    // Disabled only after the browser has read the form for this post.
    window.setTimeout(() => (button.disabled = sending), 0);
    timer = window.setTimeout(() => {
      done();
      say('The sign-up service didn’t answer. Check your connection, then try again.', true);
    }, ANSWER_TIMEOUT_MS);
  });

  frame?.addEventListener('load', () => {
    // The empty frame loads once when it's added; only an answer to a post counts.
    if (!sending) return;
    done();
    // An error page loads too: going offline meanwhile is the one case the page can tell.
    if (navigator.onLine === false) return say('You’re offline. Connect to the internet, then try again.', true);
    say('');
    form.hidden = true;
    thanks!.hidden = false;
    thanks!.focus();
  });

  thanks?.querySelector<HTMLButtonElement>('[data-again]')?.addEventListener('click', () => {
    thanks.hidden = true;
    form.hidden = false;
    input.focus();
    input.select();
  });
}
