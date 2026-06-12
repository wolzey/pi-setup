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
  --exclude='memory.jsonl' \
  --exclude='figma-mcp-oauth.json' \
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

if [ -f "$DEST/lsp.json" ]; then
  if command -v npm >/dev/null 2>&1 && ! command -v typescript-language-server >/dev/null 2>&1; then
    npm install -g typescript typescript-language-server || true
  fi
  if command -v go >/dev/null 2>&1 && ! command -v gopls >/dev/null 2>&1; then
    go install golang.org/x/tools/gopls@latest || true
  fi
  if command -v gem >/dev/null 2>&1 && ! command -v ruby-lsp >/dev/null 2>&1; then
    gem install ruby-lsp --user-install || true
  fi
fi

echo "Pi setup applied to $DEST"
