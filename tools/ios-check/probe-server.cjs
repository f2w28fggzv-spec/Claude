// A server on this machine for the self-test's content-rule probe (.github/workflows/ios.yml starts it before the
// simulator check): FiteeContentRules.probe fetches it from throwaway web views, with and without the app's content
// rules, so the probe never reaches another site.
//
//   node tools/ios-check/probe-server.cjs <port file>
//
// Listens on a free port on the loopback addresses only, 127.0.0.1 and, where there is one, ::1 (the probe's URL
// names localhost: since iOS 17 App Transport Security refuses plain HTTP to an IP address unless the app lists it,
// and localhost may resolve to either), writes the port to <port file> once listening, answers every request with a
// short text, and logs each one (the workflow keeps the log with the screenshots: with the rules the request must not
// arrive, without them it does).
'use strict';

const fs = require('node:fs');
const http = require('node:http');

const portFile = process.argv[2];
if (!portFile || process.argv.length !== 3) {
  console.error('Usage: node tools/ios-check/probe-server.cjs <port file>');
  process.exit(2);
}

function answer(req, res) {
  console.log(`${new Date().toISOString()} ${req.socket.remoteAddress} ${req.method} ${req.url} ${JSON.stringify(req.headers['user-agent'] ?? '')}`);
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end('fitee probe\n');
}

const v4 = http.createServer(answer);
v4.listen(0, '127.0.0.1', () => {
  const { port } = v4.address();
  const v6 = http.createServer(answer);
  const ready = (also) => {
    fs.writeFileSync(portFile, `${port}\n`);
    console.log(`Listening on http://127.0.0.1:${port}/${also}`);
  };
  v6.once('error', (err) => ready(` (not on ::1: ${err.code || err.message})`));
  v6.listen(port, '::1', () => ready(` and http://[::1]:${port}/`));
});
