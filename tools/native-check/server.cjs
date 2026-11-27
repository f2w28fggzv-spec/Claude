// The Chromium check's stand-in for the iPhone app's own scheme handler (capacitor://localhost, Capacitor's
// WebViewAssetHandler.swift), serving one build folder (dist-native/) at the root of http://127.0.0.1:<port>:
//   - the app's files, with the content types iOS gives them (wasm as application/wasm, .task as octet-stream) and
//     "Cache-Control: no-cache", as Capacitor's handler sends;
//   - Range requests answered 206 as Capacitor's handler answers them: one range "bytes=<from>-<to>", the end
//     optional (WebViewAssetHandler.swift:71-89), with Accept-Ranges, Content-Range and Content-Length;
//   - /__files__/<name>: a saved set's file from the fake native side (FakeNative.file(), tests/fixtures/
//     fakeNative.ts), what its videoUrl() points at in place of capacitor://localhost/_capacitor_file_/…, with the
//     "Content-Security-Policy: sandbox; frame-ancestors 'none'" Capacitor 8.6.3 adds to that route;
//   - /__blank.html: an empty page of the same origin that runs none of the app's code, where the check writes
//     localStorage before a launch (on the app's own page every write would go through its copy writer) and makes
//     the videos it needs in the browser.
// It logs every request. Nothing here is part of the app.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

/** What iOS's UTType gives for each extension the app has (WebViewAssetHandler.mimeTypeForExtension). */
const TYPES = {
  html: 'text/html',
  js: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  txt: 'text/plain',
  woff2: 'font/woff2',
  svg: 'image/svg+xml',
  png: 'image/png',
  webp: 'image/webp',
  wasm: 'application/wasm',
  task: 'application/octet-stream',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

const BLANK = '<!doctype html><html lang="en"><meta charset="utf-8"><title>native-check: blank</title><body></body></html>\n';

/**
 * Answers a request for `body` (a Buffer), with a Range header as Capacitor's handler reads it: "bytes=<from>-<to>",
 * <to> defaulting to the last byte. An unreadable or unsatisfiable range is answered 416 (Capacitor would read past
 * the end; nothing the app sends does that).
 */
function send(req, res, body, type, extra, entry) {
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', ...extra };
  const range = req.headers.range;
  if (range !== undefined) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    const from = m && m[1] !== '' ? Number(m[1]) : 0;
    const to = m && m[2] !== '' ? Math.min(Number(m[2]), body.length - 1) : body.length - 1;
    if (!m || from > to || from >= body.length) {
      entry.status = 416;
      res.writeHead(416, { 'Content-Range': `bytes */${body.length}`, 'Cache-Control': 'no-cache' });
      return res.end();
    }
    const part = body.subarray(from, to + 1);
    entry.status = 206;
    entry.bytes = part.length;
    entry.range = `${from}-${to}`;
    res.writeHead(206, { ...headers, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${from}-${to}/${body.length}`, 'Content-Length': part.length });
    return res.end(req.method === 'HEAD' ? undefined : part);
  }
  entry.status = 200;
  entry.bytes = body.length;
  res.writeHead(200, { ...headers, 'Content-Length': body.length });
  res.end(req.method === 'HEAD' ? undefined : body);
}

/**
 * The server. `files(name)` gives a saved set's bytes for /__files__/<name> (undefined: 404); setRoot() picks the
 * build folder; requests() lists what was asked for, by phase (setPhase()).
 */
function createServer({ port, files }) {
  let root = '';
  let phase = 'start';
  const log = [];
  const sockets = new Set();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const entry = { phase, method: req.method, path: url.pathname, query: url.search, range: '', status: 0, bytes: 0 };
    log.push(entry);
    const notFound = () => {
      entry.status = 404;
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache' });
      res.end('Not found');
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      entry.status = 405;
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end();
    }
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      return notFound();
    }
    if (rel === '/__blank.html') return send(req, res, Buffer.from(BLANK), 'text/html', {}, entry);
    if (rel.startsWith('/__files__/')) {
      const name = rel.slice('/__files__/'.length);
      const body = files(name);
      if (!body) return notFound();
      const ext = path.extname(name).slice(1).toLowerCase();
      return send(req, res, body, TYPES[ext] ?? 'application/octet-stream', { 'Content-Security-Policy': "sandbox; frame-ancestors 'none'" }, entry);
    }
    // Like Capacitor's handler: "/" is the app's index.html, and a path with ".." is never served.
    if (rel === '/' || rel === '') rel = '/index.html';
    if (rel.split('/').includes('..')) return notFound();
    const file = path.join(root, rel);
    if (!root || !file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return notFound();
    const ext = path.extname(file).slice(1).toLowerCase();
    return send(req, res, fs.readFileSync(file), TYPES[ext] ?? 'application/octet-stream', {}, entry);
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
    setRoot: (dir) => {
      root = path.resolve(dir);
    },
    setPhase: (name) => {
      phase = name;
    },
    /** Requests in a phase (all without one). */
    requests: (name) => (name === undefined ? log : log.filter((e) => e.phase === name)),
  };
}

module.exports = { createServer, TYPES };
