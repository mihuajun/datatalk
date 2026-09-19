#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
NEXT_BIN="$PROJECT_DIR/node_modules/next/dist/bin/next"
REQUIRED_NODE_VERSION="$(tr -d '[:space:]' < "$PROJECT_DIR/.nvmrc")"

node_is_compatible() {
  local node_bin="$1"
  [ -x "$node_bin" ] || return 1
  "$node_bin" -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 5) ? 0 : 1)' >/dev/null 2>&1
}

NODE_BIN=""

if [ -n "${NODE_BIN_OVERRIDE:-}" ] && node_is_compatible "$NODE_BIN_OVERRIDE"; then
  NODE_BIN="$NODE_BIN_OVERRIDE"
fi

if [ -z "$NODE_BIN" ] && command -v node >/dev/null 2>&1 && node_is_compatible "$(command -v node)"; then
  NODE_BIN="$(command -v node)"
fi

if [ -z "$NODE_BIN" ] && [ -n "${NVM_BIN:-}" ] && node_is_compatible "$NVM_BIN/node"; then
  NODE_BIN="$NVM_BIN/node"
fi

if [ -z "$NODE_BIN" ]; then
  NVM_ROOT="${NVM_DIR:-$HOME/.nvm}"
  candidate="$NVM_ROOT/versions/node/$REQUIRED_NODE_VERSION/bin/node"
  if node_is_compatible "$candidate"; then
    NODE_BIN="$candidate"
  fi
fi

if [ -z "$NODE_BIN" ]; then
  NVM_ROOT="${NVM_DIR:-$HOME/.nvm}"
  while IFS= read -r candidate; do
    if node_is_compatible "$candidate"; then
      NODE_BIN="$candidate"
      break
    fi
  done < <(find "$NVM_ROOT/versions/node" -maxdepth 3 -type f -path '*/bin/node' -print 2>/dev/null | sort -r)
fi

if [ -z "$NODE_BIN" ]; then
  printf 'Node.js >=22.5.0 is required. Install or activate %s before starting the app.\n' "$REQUIRED_NODE_VERSION" >&2
  exit 1
fi

NEXT_PORT=""
EXPECT_PORT_VALUE=false
for argument in "$@"; do
  if [ "$EXPECT_PORT_VALUE" = true ]; then
    NEXT_PORT="$argument"
    EXPECT_PORT_VALUE=false
    continue
  fi

  case "$argument" in
    -p|--port)
      EXPECT_PORT_VALUE=true
      ;;
    --port=*)
      NEXT_PORT="${argument#--port=}"
      ;;
    -p[0-9]*)
      NEXT_PORT="${argument#-p}"
      ;;
  esac
done

if [ "$EXPECT_PORT_VALUE" = true ]; then
  printf 'Missing value for Next.js port option.\n' >&2
  exit 1
fi

if [ -n "$NEXT_PORT" ]; then
  case "$NEXT_PORT" in
    *[!0-9]*)
      printf 'Invalid Next.js port: %s\n' "$NEXT_PORT" >&2
      exit 1
      ;;
  esac
  if [ "$NEXT_PORT" -lt 1 ] || [ "$NEXT_PORT" -gt 65535 ]; then
    printf 'Invalid Next.js port: %s\n' "$NEXT_PORT" >&2
    exit 1
  fi
  export PORT="$NEXT_PORT"
fi

exec "$NODE_BIN" "$NEXT_BIN" "$@"
