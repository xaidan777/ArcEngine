#!/usr/bin/env sh
# ArcEngine build launcher for Linux/macOS.
# All arguments are passed to tools/build.mjs.

set -u
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
cd "$SCRIPT_DIR" || exit 1

if ! command -v node >/dev/null 2>&1; then
  printf '\n  [x] Node.js not found in PATH.\n'
  printf '      Install Node.js LTS from https://nodejs.org/ and try again.\n\n'
  exit 1
fi

exec node tools/build.mjs "$@"
