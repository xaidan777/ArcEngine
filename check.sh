#!/usr/bin/env bash
# ==========================================================================
#  ArcEngine - code check: types (tsc via npx) and unit tests (node --test)
#  Linux / macOS counterpart of check.bat
#
#    ./check.sh            -> types and tests
#    ./check.sh --types    -> types only
#    ./check.sh --tests    -> tests only
# ==========================================================================
set -u
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
    echo
    echo "  [x] Node.js not found in PATH. Install it from https://nodejs.org/"
    echo
    exit 1
fi

exec node tools/check.mjs "$@"
