// Stand-ins for `xcrun simctl` and `plutil`, so tests/ios-check.test.ts can run tools/ios-check/simulator-check.sh
// on Linux. tools/ios-check/stub/xcrun and stub/plutil run this file; CI's real run never does.
//
// STUB_DIR, the scenario (the test writes it):
//   console-<launch>.txt  what a launch prints; <launch> is light, dark, selftest or release, told apart by the
//                         appearance set last, the -fiteeSelfTest argument and an installed app whose path ends in
//                         /release/App.app. "@sleep <seconds>" waits; "@exit <code>" ends the app there (a crash).
//                         Lines go out with \r\n, as through simctl's pseudo-terminal, a segment at a time.
//   screen-<launch>.png   what `simctl io <udid> screenshot <file>` writes during that launch (else screen.png).
// STUB_STATE, the stub's own state: appearance, installed, pid, launch, and calls.log (each call's arguments as a
// JSON array, one per line).
//
// plutil: `plutil -convert json -o - <file>` prints the file, which must hold JSON (the test writes Info.plist as JSON:
// the real plutil reads JSON property lists too); `plutil -lint <file>…` passes files that start with "<?xml" or hold
// JSON, as "<file>: OK".
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const [tool, ...args] = process.argv.slice(2);
const dir = process.env.STUB_DIR || '';
const state = process.env.STUB_STATE || '';

const stateFile = (name) => path.join(state, name);
const readState = (name, fallback = '') => (fs.existsSync(stateFile(name)) ? fs.readFileSync(stateFile(name), 'utf8').trim() : fallback);
const writeState = (name, value) => fs.writeFileSync(stateFile(name), `${value}\n`);
const fail = (message, code = 1) => {
  process.stderr.write(`stub ${tool}: ${message}\n`);
  process.exit(code);
};

function plutil() {
  if (args[0] === '-convert' && args.length === 5 && args[1] === 'json' && args[2] === '-o' && args[3] === '-') {
    let value;
    try {
      value = JSON.parse(fs.readFileSync(args[4], 'utf8'));
    } catch (err) {
      fail(`${args[4]}: ${err.message} (the stub reads JSON property lists only)`);
    }
    process.stdout.write(JSON.stringify(value));
    return;
  }
  if (args[0] === '-lint' && args.length > 1) {
    for (const file of args.slice(1)) {
      const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
      let ok = text !== undefined && text.trimStart().startsWith('<?xml');
      if (!ok && text !== undefined) {
        try {
          JSON.parse(text);
          ok = true;
        } catch {
          ok = false;
        }
      }
      if (!ok) fail(`${file}: Encountered unknown tag (stub)`);
      process.stdout.write(`${file}: OK\n`);
    }
    return;
  }
  fail(`unsupported arguments: ${args.join(' ')}`, 2);
}

function kill(pid) {
  try {
    process.kill(Number(pid), 'SIGTERM');
  } catch {
    // already gone
  }
}

function simctl() {
  const [command, ...rest] = args.slice(1);
  if (command === 'install' && rest.length === 2) {
    if (!fs.existsSync(rest[1])) fail(`An error was encountered processing the command: no app at ${rest[1]}`);
    writeState('installed', path.resolve(rest[1]));
    return;
  }
  if (command === 'ui' && rest.length === 3 && rest[1] === 'appearance') {
    if (!['light', 'dark'].includes(rest[2])) fail(`unknown appearance ${rest[2]}`);
    writeState('appearance', rest[2]);
    return;
  }
  if (command === 'terminate' && rest.length === 2) {
    const pid = readState('pid');
    if (pid) kill(pid);
    if (fs.existsSync(stateFile('pid'))) fs.rmSync(stateFile('pid'));
    return;
  }
  if (command === 'io' && rest.length === 3 && rest[1] === 'screenshot') {
    const launch = readState('launch');
    const picture = [path.join(dir, `screen-${launch}.png`), path.join(dir, 'screen.png')].find((f) => fs.existsSync(f));
    if (!picture) fail('no screenshot in the scenario');
    fs.copyFileSync(picture, rest[2]);
    return;
  }
  if (command === 'launch') {
    const options = [];
    while (rest[0] && rest[0].startsWith('--')) options.push(rest.shift());
    if (!options.includes('--console-pty')) fail('the check reads every launch through --console-pty', 2);
    const [, bundle, ...appArgs] = rest;
    if (!bundle) fail('launch without a bundle ID', 2);
    if (options.includes('--terminate-running-process') && readState('pid')) kill(readState('pid'));
    const installed = readState('installed');
    const launch = appArgs.includes('-fiteeSelfTest') ? 'selftest' : installed.endsWith(`${path.sep}release${path.sep}App.app`) ? 'release' : readState('appearance', 'light');
    writeState('pid', process.pid);
    writeState('launch', launch);
    process.on('SIGTERM', () => process.exit(0));
    const file = path.join(dir, `console-${launch}.txt`);
    const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\n$/, '').split('\n') : [];
    let buffer = '';
    const flush = () => {
      if (buffer) fs.writeSync(1, buffer);
      buffer = '';
    };
    void (async () => {
      for (const line of lines) {
        const pause = /^@sleep (\d+(?:\.\d+)?)$/.exec(line);
        const end = /^@exit (\d+)$/.exec(line);
        if (pause) {
          flush();
          await new Promise((resolve) => setTimeout(resolve, Number(pause[1]) * 1000));
        } else if (end) {
          flush();
          process.exit(Number(end[1]));
        } else buffer += `${line}\r\n`;
      }
      flush();
      // The app runs until it's terminated; a stub left behind by a broken test ends by itself.
      setTimeout(() => process.exit(0), 60_000);
    })();
    return;
  }
  fail(`unsupported simctl command: ${args.slice(1).join(' ')}`, 2);
}

if (state) fs.appendFileSync(stateFile('calls.log'), `${JSON.stringify([tool, ...args])}\n`);
if (tool === 'plutil') plutil();
else if (tool === 'xcrun' && args[0] === 'simctl') simctl();
else fail(`unsupported: ${[tool, ...args].join(' ')}`, 2);
