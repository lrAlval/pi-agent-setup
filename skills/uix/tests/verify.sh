#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/validate-feedback.mjs tests/fixtures/feedback.sample.json
if node scripts/validate-feedback.mjs tests/fixtures/feedback.invalid.json; then echo 'invalid feedback passed' >&2; exit 1; fi
node --check gates/runner.mjs
for f in gates/gate_*.mjs scripts/*.mjs; do node --check "$f"; done
bash -n scripts/install-deps.sh
node gates/runner.mjs --project tests/fixtures/golden --gate all --json --out /tmp/uix-golden-report.json > /tmp/uix-golden-report.json
node -e 'const r=require("/tmp/uix-golden-report.json");if(r.gates.length!==15||r.gates.some(g=>!g.passed))process.exit(1)'
if node gates/runner.mjs --project tests/fixtures/broken --gate all --json --out /tmp/uix-broken-report.json > /tmp/uix-broken-report.json; then echo 'broken fixture unexpectedly passed' >&2; exit 1; fi
node -e 'const r=require("/tmp/uix-broken-report.json");if(r.gates.filter(g=>!g.passed&&g.severity==="BLOCK").length<3)process.exit(1)'
printf 'uix tests passed\n'