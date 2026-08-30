#!/bin/sh
set -eu

workspace_root="/app/workspace"

mkdir -p "$workspace_root"
chown -R node:node "$workspace_root"

exec gosu node "$@"
