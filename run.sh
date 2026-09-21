#!/usr/bin/env sh
# ArcEngine game launcher for Linux/macOS.
# Usage: ./run.sh [port] [--no-open]

set -u
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
cd "$SCRIPT_DIR" || exit 1

if ! command -v node >/dev/null 2>&1; then
  printf '\n  [x] Node.js not found in PATH.\n'
  printf '      Install Node.js LTS from https://nodejs.org/ and try again.\n\n'
  exit 1
fi

PORT_ARG=
OPEN_ARG=
for arg in "$@"; do
  case "$arg" in
    *[!0-9]*|'') ;;
    *) PORT_ARG="--port=$arg" ;;
  esac
  [ "$arg" = "--no-open" ] && OPEN_ARG=--no-open
done

set --
[ -n "$PORT_ARG" ] && set -- "$@" "$PORT_ARG"
[ -n "$OPEN_ARG" ] && set -- "$@" "$OPEN_ARG"
exec node tools/dev-server.mjs "$@"
