#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${1:-$PWD}"
if ! command -v node >/dev/null || [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 22 ]; then echo "uix requires Node.js >=22. Install Node 22+ and retry." >&2; exit 1; fi
mkdir -p "$PROJECT/.uix"
(cd "$ROOT" && npm install --no-audit --no-fund)
if ! (cd "$ROOT" && npx playwright install chromium); then echo "Chromium download failed; check network, disk space, and permissions, then retry." >&2; exit 1; fi
node -e 'const p=require(process.argv[1]); if(!p.dependencies.playwright)process.exit(1)' "$ROOT/package.json"
printf 'node=%s\nchromium=installed\n' "$(node --version)" > "$PROJECT/.uix/ready"
echo "uix dependencies ready: $PROJECT/.uix/ready"
