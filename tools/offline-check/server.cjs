// A small static server for the offline check: serves one build folder under
// /Claude/ (like GitHub Pages), with the MIME types the app needs
// (application/wasm, application/manifest+json) and Pages' 10-minute cache
// header. It logs every request by phase, and can play "no signal" (every
// connection dropped), switch to another build (a deploy), answer chosen
// requests with 404 (a file missing half-way through a deploy) or a redirect
// (as GitHub Pages does for every file once a site moves to a custom
// domain), and send chosen files slowly (a phone's connection).
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml',
  png: 'image/png',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
  wasm: 'application/wasm',
  task: 'application/octet-stream',
};

function createServer({ port, prefix = '/Claude/' }) {
  let root = '';
  let down = false;
  let fail = null;
  let redirect = null;
  let slow = null;
  let phase = 'start';
  const log = [];
  const sockets = new Set();

  /** Sends a body at about `rate` bytes a second, in small pieces; stops if the client goes away. */
  const trickle = (req, res, body, rate) => {
    const piece = Math.max(16 * 1024, Math.round(rate / 20));
    let at = 0;
    const next = () => {
      if (res.destroyed || req.socket.destroyed) return;
      const end = Math.min(body.length, at + piece);
      res.write(body.subarray(at, end));
      at = end;
      if (at >= body.length) res.end();
      else setTimeout(next, (piece / rate) * 1000);
    };
    next();
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const entry = { phase, method: req.method, path: url.pathname, query: url.search, status: 0, bytes: 0 };
    log.push(entry);
    if (down) {
      entry.status = 'dropped';
      req.socket.destroy();
      return;
    }
    if (fail && fail(entry)) {
      entry.status = 404;
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const location = redirect && redirect(entry);
    if (location) {
      entry.status = 302;
      // Like GitHub Pages: anyone may read it (so only the app's own rules keep it out).
      res.writeHead(302, { Location: location, 'Access-Control-Allow-Origin': '*' });
      return res.end();
    }
    if (url.pathname === prefix.slice(0, -1)) {
      entry.status = 301;
      res.writeHead(301, { Location: prefix });
      return res.end();
    }
    let rel = url.pathname.startsWith(prefix) ? decodeURIComponent(url.pathname.slice(prefix.length)) : null;
    if (rel === '') rel = 'index.html';
    const file = rel === null ? null : path.join(root, rel);
    if (!file || !file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      entry.status = 404;
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const body = fs.readFileSync(file);
    const ext = path.extname(file).slice(1).toLowerCase();
    entry.status = 200;
    entry.bytes = body.length;
    res.writeHead(200, {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'max-age=600',
      'Access-Control-Allow-Origin': '*',
    });
    if (req.method === 'HEAD') return res.end();
    const rate = slow && slow(entry);
    if (rate) trickle(req, res, body, rate);
    else res.end(body);
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });

  return {
    log,
    listen: () => new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve)),
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
    /** Serve another build folder (a deploy). */
    setRoot: (dir) => {
      root = path.resolve(dir);
    },
    /** No signal: drop every connection (open ones too). */
    setDown: (value) => {
      down = value;
      if (value) for (const s of sockets) s.destroy();
    },
    /** Answer requests for which `fn(entry)` is true with 404 (null: none). */
    setFail: (fn) => {
      fail = fn;
    },
    /** Answer requests for which `fn(entry)` returns a URL with a redirect there (null: none). */
    setRedirect: (fn) => {
      redirect = fn;
    },
    /** Send files for which `fn(entry)` returns a number at that many bytes a second (null: full speed). */
    setSlow: (fn) => {
      slow = fn;
    },
    setPhase: (name) => {
      phase = name;
    },
    /** Requests in a phase. */
    requests: (name) => log.filter((e) => e.phase === name),
  };
}

module.exports = { createServer, TYPES };
