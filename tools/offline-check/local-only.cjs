// Chromium for the dev tools (offline-check, landing-check, landing-screens,
// demo-sheets), cut off from every site but this machine. Without it the
// browser follows the environment's proxy settings (HTTPS_PROXY and the
// like), so a page that regressed and asked another site for something would
// really reach it before a check could flag the request.
//
// --proxy-server sends every request through a proxy at 127.0.0.1:1, where
// nothing listens: a request to another site fails at once, on this machine
// (net::ERR_PROXY_CONNECTION_FAILED), and Playwright still reports it, so the
// checks' "no request left localhost" sees it. Loopback (localhost,
// 127.0.0.1) never goes through a proxy in Chromium, so the local servers
// work as before. (Not Playwright's own `proxy` option: that sends loopback
// through the proxy too.)
const LOCAL_ONLY_ARGS = ['--proxy-server=http://127.0.0.1:1'];

/** Launches Chromium cut off from other sites, with any extra launch arguments. */
function launchLocalOnly(chromium, { args = [], ...options } = {}) {
  return chromium.launch({ ...options, args: [...LOCAL_ONLY_ARGS, ...args] });
}

/** The error the guard gives a request to another site (the proxy at 127.0.0.1:1 refuses it). */
const GUARD_ERROR = /net::ERR_PROXY_CONNECTION_FAILED/;

/**
 * Proves the browser is cut off by the guard: a page that asks for another
 * site, over http and over https, gets the guard's own error on this machine
 * (any other failure, such as a name no DNS resolves, would also come from a
 * browser without the guard, so it proves nothing). Resolves to the errors'
 * text, or throws. The name is under .invalid, which no DNS resolves, so even
 * a browser without the guard couldn't reach a real site.
 */
async function proveLocalOnly(browser) {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    const seen = [];
    for (const url of ['http://fitee-local-only-check.invalid/', 'https://fitee-local-only-check.invalid/']) {
      const response = await page.goto(url, { timeout: 10000 }).then(
        (r) => r,
        (e) => e,
      );
      if (!(response instanceof Error)) throw new Error(`a request to another site got an answer (${url}: ${response && response.status()})`);
      const message = response.message.split('\n')[0];
      if (!GUARD_ERROR.test(message)) throw new Error(`not cut off by the guard (${message})`);
      seen.push(message);
    }
    return seen.join('; ');
  } finally {
    await ctx.close();
  }
}

module.exports = { LOCAL_ONLY_ARGS, GUARD_ERROR, launchLocalOnly, proveLocalOnly };
