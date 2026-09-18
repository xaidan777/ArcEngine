#!/usr/bin/env bash
# ==========================================================================
#  ArcEngine - editor launch (Linux / macOS counterpart of editor.bat)
#  Starts the editor server (_utils/editor/server.mjs) and opens a browser.
#  Needs Node.js only - the kit itself has zero dependencies.
#
#    ./editor.sh                   -> port 8090 (or the next free one), opens browser
#    ./editor.sh 9100              -> port 9100
#    ./editor.sh 9100 --no-open    -> do not open a browser
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

exec node _utils/editor/server.mjs ${args[@]+"${args[@]}"}
