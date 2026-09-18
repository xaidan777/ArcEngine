#!/usr/bin/env bash
# ==========================================================================
#  ArcEngine - build a game archive (Linux / macOS counterpart of build.bat)
#
#    ./build.sh                    -> dist/arcengine-<GAME_VERSION>.zip
#    ./build.sh --version=0.2.0    -> stamp a new version into the build
#    ./build.sh --no-zip           -> only produce the build/ folder
#    ./build.sh --force            -> build even if checks fail
# ==========================================================================
set -u
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
    echo
    echo "  [x] Node.js not found in PATH. Install it from https://nodejs.org/"
    echo
    exit 1
fi

exec node tools/build.mjs "$@"
