#!/usr/bin/env bash
# The web build stays byte for byte the same when the iPhone app's code changes.
#
#   tools/native-check/web-identity.sh <base-ref> <work-dir>
#
# Builds the web app (the app, sw.js and the landing page in about/) twice: from <base-ref>, in a
# detached git worktree under <work-dir> (removed at the end, pass or fail), and from this working
# tree as it is now (uncommitted changes included). Then compares the SHA-256 of every file, sorted
# by path: any difference, or a file only one side has, fails. Run it after any change to a file the
# web build shares with the native build (npm run build:native), with the pull request's base as
# <base-ref>, and quote its last line ("web build identical: N files ...") in the pull request.
#
# - The worktree gets a copy of public/mediapipe/ (git ignores it) before `npm ci`, so its postinstall
#   (scripts/fetch-assets.mjs) finds both pose models and downloads nothing, and both builds pack the
#   same pose files.
# - Both builds run `vite build --configLoader native`: Vite's default config loader writes a temporary
#   file into node_modules/.vite-temp/.
# - FITEE_LANDING_TEST_SIGNUP (a test-only switch of the landing page's build) is cleared, so both builds
#   are the plain ones.
#
# Leaves in <work-dir>: out-base/ and out-head/ (the two builds), base.sha256 and head.sha256 (the hash
# lists), and the logs of npm ci and both builds.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <base-ref> <work-dir>" >&2
  exit 2
fi
base_ref=$1
mkdir -p "$2"
work=$(cd "$2" && pwd)
repo=$(cd "$(dirname "$0")/../.." && pwd)
base=$(git -C "$repo" rev-parse --verify "$base_ref^{commit}")
tree="$work/base"
unset FITEE_LANDING_TEST_SIGNUP

if [ ! -d "$repo/public/mediapipe/models" ]; then
  echo "web-identity: $repo/public/mediapipe/ is missing (run npm install first)" >&2
  exit 1
fi

remove_tree() {
  git -C "$repo" worktree remove --force "$tree" >/dev/null 2>&1 || rm -rf "$tree"
  git -C "$repo" worktree prune
}
remove_tree
trap remove_tree EXIT

# Runs a step with its output in a log; on failure prints the log's end.
step() {
  local log=$1
  shift
  if ! "$@" >"$log" 2>&1; then
    echo "web-identity: failed: $* (log: $log)" >&2
    tail -n 40 "$log" >&2
    exit 1
  fi
}

hashes() {
  # Every file under $1 as "sha256  relative/path", sorted by path (byte order).
  (cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sed 's#  \./#  #')
}

git -C "$repo" worktree add --detach "$tree" "$base" >/dev/null 2>&1
cp -R "$repo/public/mediapipe" "$tree/public/mediapipe"
# Each bash -c script reads its paths as "$1" and "$2", passed after the _, so its single quotes are meant.
# shellcheck disable=SC2016
step "$work/npm-ci-base.log" bash -c 'cd "$1" && npm ci --no-audit --no-fund' _ "$tree"
# shellcheck disable=SC2016
step "$work/build-base.log" bash -c 'cd "$1" && npx vite build --configLoader native --outDir "$2" --emptyOutDir' _ "$tree" "$work/out-base"
# shellcheck disable=SC2016
step "$work/build-head.log" bash -c 'cd "$1" && npx vite build --configLoader native --outDir "$2" --emptyOutDir' _ "$repo" "$work/out-head"

hashes "$work/out-base" >"$work/base.sha256"
hashes "$work/out-head" >"$work/head.sha256"
files=$(wc -l <"$work/base.sha256" | tr -d ' ')
if ! diff -u "$work/base.sha256" "$work/head.sha256" >"$work/diff.txt"; then
  cat "$work/diff.txt"
  echo "web build differs from ${base_ref} (${base:0:7}): see $work/diff.txt" >&2
  exit 1
fi
if [ "$files" -eq 0 ]; then
  echo "web-identity: the builds are empty" >&2
  exit 1
fi
echo "web build identical: ${files} files (base ${base_ref} ${base:0:7}, this tree)"
