#!/usr/bin/env bash
set -Eeuo pipefail
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
mkdir -p .workbuddy-local
if [ ! -f .workbuddy-local/studio.yaml ]; then
  cat > .workbuddy-local/studio.yaml <<'YAML'
database:
  url: "sqlite:.workbuddy-local/studio.sqlite"
reportEditLock:
  enabled: true
resourceCenter:
  enabled: false
YAML
fi
export STUDIO_CONFIG_PATH="$PROJECT_DIR/.workbuddy-local/studio.yaml"
export WORKSPACE_STORAGE_ROOT="$PROJECT_DIR/.workbuddy-local/workspace"
export AUTO_START_AGENT_RUNTIME=false
export STUDIO_DIST_DIR=.next-workbuddy
export STUDIO_WORKBUDDY_CONFIG_PATH="$PROJECT_DIR/config/config.local.yaml"
exec bash scripts/run-next.sh dev --hostname 127.0.0.1 --port "${STUDIO_LOCAL_PORT:-3010}"
