#!/usr/bin/env bash
# ==========================================================================
#  ArcEngine - local launch (Linux / macOS counterpart of run.bat)
#  Starts the no-cache dev server (tools/dev-server.mjs) and opens a browser.
#  Needs Node.js only - the kit itself has zero dependencies.
#
#    ./run.sh                   -> port 8080 (or the next free one), opens browser
#    ./run.sh 9000              -> port 9000
#    ./run.sh 9000 --no-open    -> do not open a browser
# ==========================================================================
set -u
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
    echo
    echo "  [x] Node.js not found in PATH."
    echo "      Install it from https://nodejs.org/ (LTS) and run this script again."
    echo
    exit 1
fi

args=()
for a in "$@"; do
    case "$a" in
        ''|*[!0-9]*) [ "$a" = "--no-open" ] && args+=("--no-open") ;;
        *) args+=("--port=$a") ;;
    esac
done

exec node tools/dev-server.mjs ${args[@]+"${args[@]}"}
