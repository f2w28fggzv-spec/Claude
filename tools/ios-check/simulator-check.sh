#!/usr/bin/env bash
# CI's check of the iPhone app in the iOS simulator (.github/workflows/ios.yml runs it on the macOS runner):
#
#   tools/ios-check/simulator-check.sh <udid> <Debug App.app> <Release App.app> <out dir> <probe url> <iPad udid>
#
# <udid> is a booted iPhone simulator; <iPad udid> an iPad simulator, which this script boots when it gets to it.
# 1. Both bundles: Info.plist's keys, the web and pose files in public/ and none the app mustn't ship, and the privacy
#    manifests of the app, Capacitor and Cordova, wherever CocoaPods put them.
# 2. Installs the Debug build on the iPhone and launches it three times, each console (the app's stdout and stderr) in
#    <out>/console-<launch>.log:
#    - light, then dark appearance: waits for the fitee:ready marker, takes <out>/welcome-<appearance>.png, then
#      checks every fact the marker reports, the status bar text, one bridge, and that nothing logged an error;
#    - the self-test (-fiteeSelfTest, and -fiteeProbeURL <probe url> for the content rules' probe): waits for the
#      fitee:selftest and fitee:rules markers, then checks every step, that the rules blocked the probe, and a
#      fitee:dropped line for each call the bridge gate must drop (MediaPipe's own stderr lines are allowed here).
# 3. Installs the Release build on the iPhone and launches it once: it must keep running for 15 s, its screenshot
#    (<out>/release.png) mustn't be blank, and it must log nothing.
# 4. Boots the iPad, installs the same Debug build there and launches it once in the light appearance, as the light
#    launch: an iPhone-only app also runs on an iPad (in its iPhone compatibility mode), and the App Store offers it
#    there. Same checks, its screenshot in <out>/welcome-ipad.png and its console in <out>/console-ipad.log. Last, so
#    a second simulator runs only for this launch, and the iPad stays booted for the workflow's system log.
# Each problem prints one "::error::" line, and the run goes on to the next check; the exit status is 0 only when
# every check passed (1 otherwise, 2 for wrong arguments). The marker formats, the gate's probes and the launch
# arguments are in src/native/bridge.ts (the native contract).
#
# How the console gets out: in a Debug build Capacitor forwards every console.* call in the web view to its Console
# plugin, which prints "⚡️  [level] - message" to the app's standard output; the Swift markers are print() lines.
# That is stdout, not the system log, so each launch is read with `simctl launch --console-pty`: through a
# pseudo-terminal the app's output is line-buffered and arrives as printed (the workflow also sets
# SIMCTL_CHILD_NSUnbufferedIO). simctl runs as long as the app does, so its pid says whether the app is still up.
#
# bash 3.2: the macOS runner's bash is 3.2.57, so this script uses nothing newer: no associative arrays, mapfile or
# readarray, case-changing expansions such as ${x,,}, wait -n, coproc, namerefs, |& or &>>, no GNU-only tools such as
# timeout or sed -i, and no "$@" that may be empty under set -u (${1+"$@"} instead). Everything that parses (plists,
# the JSON markers, the PNG screenshots) is done in Node by tools/ios-check/check.cjs. tests/ios-check.test.ts runs
# this script against stub xcrun and plutil (tools/ios-check/stub/) and greps it for those constructs.
#
# READY_TIMEOUT (120 s), SELFTEST_TIMEOUT (300 s, more than the self-test's own step timeouts add up to),
# RELEASE_ALIVE_SECONDS (15), TERMINATE_SECONDS (30) and EXIT_SECONDS (10: see stop()), all whole seconds, and
# SETTLE_SECONDS (2: after a marker, for the first screen's entrance animation and the console's last lines) can be
# changed through the environment.
set -euo pipefail

if [ "$#" -ne 6 ]; then
  echo "Usage: $0 <udid> <Debug App.app> <Release App.app> <out dir> <probe url> <iPad udid>" >&2
  exit 2
fi
udid=$1
debug_app=$2
release_app=$3
out=$4
probe_url=$5
ipad_udid=$6
if [ "$ipad_udid" = "$udid" ]; then
  echo "$0: the iPad simulator must be another device than the iPhone simulator ($udid)" >&2
  exit 2
fi
here=$(cd "$(dirname "$0")" && pwd)
ready_timeout=${READY_TIMEOUT:-120}
selftest_timeout=${SELFTEST_TIMEOUT:-300}
alive_seconds=${RELEASE_ALIVE_SECONDS:-15}
terminate_seconds=${TERMINATE_SECONDS:-30}
exit_seconds=${EXIT_SECONDS:-10}
settle_seconds=${SETTLE_SECONDS:-2}
mkdir -p "$out"
status=0
app_pid=
bundle=
# The simulator the launch functions below act on: the iPhone, then the iPad for its launch.
device=$udid

check() {
  node "$here/check.cjs" "$@"
}

# A launch that is still running when the script ends (it was interrupted) is stopped with it.
# shellcheck disable=SC2329 # the EXIT trap runs it (shellcheck 0.11 loses track of that past the final exit)
cleanup() {
  if [ -n "$app_pid" ] && kill -0 "$app_pid" 2>/dev/null; then
    kill "$app_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# start <log> [argument...]: launches the installed app in the background, its console in <log>.
start() {
  local log=$1
  shift
  : >"$log"
  xcrun simctl launch --console-pty --terminate-running-process "$device" "$bundle" ${1+"$@"} >"$log" 2>&1 &
  app_pid=$!
}

running() {
  kill -0 "$app_pid" 2>/dev/null
}

# ends <pid> <seconds>: 0 once the process has ended, 1 if it still runs after <seconds> (bash 3.2 has no timeout).
ends() {
  local tick=0
  while kill -0 "$1" 2>/dev/null; do
    if [ "$tick" -ge $(($2 * 5)) ]; then
      return 1
    fi
    sleep 0.2
    tick=$((tick + 1))
  done
}

# stop: ends the app, every part bounded (a stuck simctl terminate once held a run up for almost 5 minutes):
# `simctl terminate` gets TERMINATE_SECONDS, then `simctl launch`, whose console session ends with the app, gets
# EXIT_SECONDS to end by itself. Either one still running then is killed with SIGKILL (simctl passes a SIGTERM on to
# the app and waits for it), with a warning; that can leave the app running in the simulator, which the next launch's
# --terminate-running-process ends.
stop() {
  local terminate
  xcrun simctl terminate "$device" "$bundle" >/dev/null 2>&1 &
  terminate=$!
  if ! ends "$terminate" "$terminate_seconds"; then
    kill -9 "$terminate" 2>/dev/null || true
    echo "::warning::simctl terminate didn't end within ${terminate_seconds} s, so it was stopped"
  fi
  wait "$terminate" 2>/dev/null || true
  if ! ends "$app_pid" "$exit_seconds"; then
    kill -9 "$app_pid" 2>/dev/null || true
    echo "::warning::simctl launch didn't end within ${exit_seconds} s of the app's termination, so it was stopped"
  fi
  wait "$app_pid" 2>/dev/null || true
}

# wait_for <log> <seconds> <marker>...: 0 once every marker is in the log, 1 if the app ends first, 2 after <seconds>
# (a whole number). Looks every 0.2 s.
wait_for() {
  local log=$1 ticks=$(($2 * 5)) tick=0 alive marker missing
  shift 2
  while :; do
    # Whether it runs is read before the log: an app that had ended had also written its last line.
    alive=yes
    running || alive=no
    missing=
    for marker in "$@"; do
      grep -q -- "$marker " "$log" || missing="$missing $marker"
    done
    if [ -z "$missing" ]; then
      return 0
    fi
    if [ "$alive" = no ]; then
      return 1
    fi
    if [ "$tick" -ge "$ticks" ]; then
      return 2
    fi
    sleep 0.2
    tick=$((tick + 1))
  done
}

# show <title> <log>: the console in a collapsed group, with workflow commands off, so no line of it can act as one.
show() {
  local token="fitee-console-$$-$RANDOM"
  echo "::group::$1"
  echo "::stop-commands::$token"
  cat "$2"
  echo
  echo "::$token::"
  echo "::endgroup::"
}

shot() {
  xcrun simctl io "$device" screenshot "$1" >/dev/null 2>&1
}

# launch_look <light|dark|ipad> <light|dark> <Title>: the Debug build in that appearance, up to its ready marker; its
# console in <out>/console-<name>.log, its screenshot <out>/welcome-<name>.png, judged as check.cjs's <name> launch.
launch_look() {
  local name=$1 look=$2 title=$3 log="$out/console-$1.log" result=0
  if ! xcrun simctl ui "$device" appearance "$look"; then
    echo "::error::$title launch: the simulator's appearance couldn't be set to $look"
    return 1
  fi
  start "$log"
  wait_for "$log" "$ready_timeout" fitee:ready || result=$?
  case $result in
    1) echo "::error::$title launch: the app ended before its fitee:ready marker" ;;
    2) echo "::error::$title launch: no fitee:ready marker after ${ready_timeout} s" ;;
  esac
  if [ "$result" -eq 0 ]; then
    sleep "$settle_seconds"
    if ! running; then
      echo "::error::$title launch: the app ended after its fitee:ready marker"
      result=1
    fi
    if shot "$out/welcome-$name.png"; then
      check screen "$out/welcome-$name.png" "welcome-$name.png" || true
    fi
  fi
  stop
  show "Console, $title launch" "$log"
  check launch "$log" "$name" "$out/info-debug.json" || result=1
  [ "$result" -eq 0 ]
}

# launch_ipad: the Debug build on the iPad simulator, booted first (bootstatus -b boots a device that isn't, then
# waits until it has finished booting).
launch_ipad() {
  device=$ipad_udid
  if ! xcrun simctl bootstatus "$device" -b >"$out/ipad-boot.log" 2>&1; then
    echo "::error::iPad launch: the iPad simulator ($device) couldn't be booted ($out/ipad-boot.log)"
    device=$udid
    return 1
  fi
  if ! xcrun simctl install "$device" "$debug_app"; then
    echo "::error::iPad launch: the Debug build couldn't be installed in the iPad simulator"
    device=$udid
    return 1
  fi
  local result=0
  launch_look ipad light iPad || result=1
  device=$udid
  [ "$result" -eq 0 ]
}

# launch_selftest: the Debug build with the self-test and the content rules' probe.
launch_selftest() {
  local log="$out/console-selftest.log" result=0
  start "$log" -fiteeSelfTest -fiteeProbeURL "$probe_url"
  wait_for "$log" "$selftest_timeout" fitee:selftest fitee:rules || result=$?
  case $result in
    1) echo "::error::Self-test launch: the app ended before the fitee:selftest and fitee:rules markers" ;;
    2) echo "::error::Self-test launch: no fitee:selftest and fitee:rules markers after ${selftest_timeout} s" ;;
  esac
  if [ "$result" -eq 0 ]; then
    sleep "$settle_seconds"
    if ! running; then
      echo "::error::Self-test launch: the app ended after the self-test"
      result=1
    fi
  fi
  stop
  show "Console, self-test" "$log"
  check launch "$log" selftest "$out/info-debug.json" "$probe_url" || result=1
  [ "$result" -eq 0 ]
}

# launch_release: the Release build keeps running, shows a page and logs nothing.
launch_release() {
  local log="$out/console-release.log" waited=0 result=0
  xcrun simctl ui "$device" appearance light >/dev/null 2>&1 || true
  start "$log"
  while [ "$waited" -lt "$alive_seconds" ]; do
    sleep 1
    waited=$((waited + 1))
    if ! running; then
      echo "::error::Release launch: the app ended within ${waited} s; it must keep running for ${alive_seconds} s"
      result=1
      break
    fi
  done
  if [ "$result" -eq 0 ]; then
    if shot "$out/release.png"; then
      check screen "$out/release.png" release.png --require || result=1
    else
      echo "::error::Release launch: the simulator took no screenshot"
      result=1
    fi
  fi
  stop
  show "Console, Release build" "$log"
  check release "$log" || result=1
  [ "$result" -eq 0 ]
}

# The rules probe fetches a server on this machine, never another site.
probe_status=0
check probe-url "$probe_url" || probe_status=$?
if [ "$probe_status" -eq 2 ]; then
  exit 2
fi
if [ "$probe_status" -ne 0 ]; then
  status=1
fi

check bundle "$debug_app" Debug "$out/info-debug.json" || status=1
check bundle "$release_app" Release "$out/info-release.json" || status=1
if ! bundle=$(check bundle-id "$out/info-debug.json"); then
  echo "::error::The Debug build's bundle ID can't be read, so it can't be launched"
  exit 1
fi
release_bundle=$(check bundle-id "$out/info-release.json" 2>/dev/null || true)
if [ -n "$release_bundle" ] && [ "$release_bundle" != "$bundle" ]; then
  echo "::error::The Release build's bundle ID ($release_bundle) isn't the Debug build's ($bundle): the app has one bundle ID (capacitor.config.ts)"
  status=1
fi

if ! xcrun simctl install "$udid" "$debug_app"; then
  echo "::error::The Debug build couldn't be installed in the simulator"
  exit 1
fi
launch_look light light Light || status=1
launch_look dark dark Dark || status=1
launch_selftest || status=1

debug_bundle=$bundle
if xcrun simctl install "$udid" "$release_app"; then
  if [ -n "$release_bundle" ]; then
    bundle=$release_bundle
  fi
  launch_release || status=1
else
  echo "::error::The Release build couldn't be installed in the simulator"
  status=1
fi

bundle=$debug_bundle
launch_ipad || status=1
exit "$status"
