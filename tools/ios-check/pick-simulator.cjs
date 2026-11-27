// Prints the UDID of an available simulator with the given name (default
// "iPhone 17") on the newest iOS runtime that has one. Reads the output of
// `xcrun simctl list devices available --json` on stdin.
const name = process.argv[2] || 'iPhone 17';
const { devices } = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
const version = (runtime) => (runtime.match(/SimRuntime\.iOS-([\d-]+)$/)?.[1] ?? '').split('-').map(Number);
const newestFirst = (a, b) => {
  const [x, y] = [version(a), version(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((y[i] ?? 0) !== (x[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return 0;
};
for (const runtime of Object.keys(devices).filter((r) => /SimRuntime\.iOS-/.test(r)).sort(newestFirst)) {
  const device = devices[runtime].find((d) => d.name === name && d.isAvailable !== false);
  if (device) {
    console.error(`${name}: ${runtime.replace(/^.*SimRuntime\./, '')} (${device.udid})`);
    console.log(device.udid);
    process.exit(0);
  }
}
console.error(`No available "${name}" simulator. Available: ${[...new Set(Object.values(devices).flat().map((d) => d.name))].join(', ')}`);
process.exit(1);
