// The app must not send anything off the device. Everything it needs is
// served from its own origin, so any request to another origin is refused
// here before it leaves the phone. index.html adds a Content Security Policy
// (connect-src 'self') as a second, browser-enforced layer.
//
// Why: MediaPipe tasks-vision creates a usage logger for every task that
// POSTs to odml.pa.googleapis.com every 60 s, with no option to turn it off.

const sameOriginOrLocal = (url: string | URL): boolean => {
  try {
    const u = new URL(String(url), location.href);
    return u.origin === location.origin || u.protocol === 'blob:' || u.protocol === 'data:';
  } catch {
    return false;
  }
};

const blocked = (url: string | URL) => new TypeError(`Blocked request to ${new URL(String(url), location.href).origin}: this app never sends data off the device.`);

export function installNetworkGuard(): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input;
    return sameOriginOrLocal(url) ? realFetch(input, init) : Promise.reject(blocked(url));
  };

  const realOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    if (!sameOriginOrLocal(url)) throw blocked(url);
    return (realOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;

  if (navigator.sendBeacon) {
    const realBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => (sameOriginOrLocal(url) ? realBeacon(url, data) : false);
  }
}

export { sameOriginOrLocal };

// Installed as soon as this module is imported (main.tsx imports it first).
installNetworkGuard();
