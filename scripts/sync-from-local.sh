#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${PI_AGENT_DIR:-$HOME/.pi/agent}"
DEST="$REPO_ROOT/agent"

mkdir -p "$DEST"
rsync -a --delete \
  --exclude='.env' \
  --exclude='auth.json' \
  --exclude='trust.json' \
  --exclude='memory.jsonl' \
  --exclude='figma-mcp-oauth.json' \
  --exclude='sessions/' \
  --exclude='pi-crash.log' \
  --exclude='*.log' \
  --exclude='node_modules/' \
  --exclude='git/' \
  --exclude='.DS_Store' \
  "$SRC/" "$DEST/"

if [ -f "$SRC/.env" ]; then
  awk -F= 'NF && $1 !~ /^#/ { print $1"=" }' "$SRC/.env" > "$DEST/.env.example"
fi

printf 'Synced Pi config from %s to %s\n' "$SRC" "$DEST"
