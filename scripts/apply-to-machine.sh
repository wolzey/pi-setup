#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${PI_AGENT_DIR:-$HOME/.pi/agent}"

if ! command -v pi >/dev/null 2>&1; then
  if ! command -v bun >/dev/null 2>&1; then
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
  fi
  bun install -g @earendil-works/pi-coding-agent
fi

mkdir -p "$DEST"
rsync -a --delete \
  --exclude='.env' \
  --exclude='auth.json' \
  --exclude='trust.json' \
  --exclude='sessions/' \
  --exclude='pi-crash.log' \
  --exclude='*.log' \
  --exclude='node_modules/' \
  --exclude='git/' \
  --exclude='.DS_Store' \
  "$REPO_ROOT/agent/" "$DEST/"

if [ ! -f "$DEST/.env" ] && [ -f "$REPO_ROOT/agent/.env.example" ]; then
  cp "$REPO_ROOT/agent/.env.example" "$DEST/.env"
  echo "Created $DEST/.env from example; fill in secret values."
fi

if command -v pi >/dev/null 2>&1; then
  while IFS= read -r pkg; do
    [ -n "$pkg" ] || continue
    pi install "$pkg" || true
  done < <(python3 - <<'PY' "$DEST/settings.json"
import json, sys
with open(sys.argv[1]) as f:
    data=json.load(f)
for p in data.get('packages', []):
    print(p)
PY
)
fi

echo "Pi setup applied to $DEST"
