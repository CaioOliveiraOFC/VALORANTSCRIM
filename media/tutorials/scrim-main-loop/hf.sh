#!/usr/bin/env bash
set -euo pipefail
export HYPERFRAMES_NO_TELEMETRY=1
export HYPERFRAMES_HISTORY_ROOT="${HYPERFRAMES_HISTORY_ROOT:-/tmp/brasa-hyperframes-history}"
BRASA_PILOT_TOOL_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
export HYPERFRAMES_CACHE_DIR="${HYPERFRAMES_CACHE_DIR:-$BRASA_PILOT_TOOL_DIR/raw/cache}"
export HYPERFRAMES_EXTRACT_CACHE_DIR="${HYPERFRAMES_EXTRACT_CACHE_DIR:-$BRASA_PILOT_TOOL_DIR/raw/frame-cache}"
export XDG_STATE_HOME="${XDG_STATE_HOME:-$BRASA_PILOT_TOOL_DIR/raw/xdg-state}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$BRASA_PILOT_TOOL_DIR/raw/xdg-cache}"
export HYPERFRAMES_BROWSER_PATH="${HYPERFRAMES_BROWSER_PATH:-/usr/bin/chromium}"
export NODE_USE_ENV_PROXY=1
export NO_PROXY="127.0.0.1,localhost,${NO_PROXY:-}"
exec npm exec --cache "${BRASA_HYPERFRAMES_NPM_CACHE:-/tmp/brasa-hyperframes-npm-cache}" --yes --package=hyperframes@0.9.39 -- hyperframes "$@"
