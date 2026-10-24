#!/usr/bin/env bash
# stack-audit.sh: token-cost audit of pi skill/extension/template stack.
# Re-runnable. Usage: stack-audit.sh [REPORT_DIR]
# Exits 1 if any NEW SKILL.md > 120 lines or template > 60 lines.
set -u
REPORT_DIR="${1:-$HOME/.pi/agent/skill-audit}"
PI="$HOME/.pi/agent"
AGENTS_SKILLS="$HOME/.agents/skills"
mkdir -p "$REPORT_DIR"
OUT="$REPORT_DIR/REPORT.md"
BUDGET_FAIL=0
# Grandfathered: pre-existing files exempt from the 120-line new-skill budget.
GRANDFATHERED="agent-routing code-review-orchestrator design-orchestrator security-orchestrator"
tok() { wc -c < "$1" | tr -d " "; }
lines() { wc -l < "$1" | tr -d " "; }
usage() { grep -rl "$1" "$PI/sessions" 2>/dev/null | wc -l | tr -d " "; }
is_grandfathered() {
  case " $GRANDFATHERED " in *" $1 "*) return 0;; *) return 1;; esac
}
{
echo "# Stack audit - $(date -u +%F)"
echo
echo "## Fixed session overhead (always loaded)"
echo
echo "| item | bytes |"
echo "|---|---|"
for f in "$PI/AGENTS.md" "$PI/pi-hermes-memory/MEMORY.md" "$PI/pi-hermes-memory/USER.md"; do
  [ -f "$f" ] && echo "| $(basename "$f") | $(tok "$f") |"
done
echo "| agents/ templates ($(ls "$PI"/agents/*.md 2>/dev/null | wc -l | tr -d " ") files) | $(cat "$PI"/agents/*.md 2>/dev/null | wc -c | tr -d " ") |"
echo "| extensions (todo-eta, state helpers) | n/a (extension-loaded) |"
echo
echo "## Trigger-loaded skills (SKILL.md body loads on trigger)"
echo
echo "| skill | lines | bytes | sessions hit | verdict |"
echo "|---|---|---|---|---|"
for d in "$PI"/skills/*/ "$AGENTS_SKILLS"/*/; do
  [ -d "$d" ] || continue
  n=$(basename "$d"); f="$d/SKILL.md"; [ -f "$f" ] || continue
  L=$(lines "$f"); B=$(tok "$f"); U=$(usage "$n")
  V=keep
  [ "$L" -gt 200 ] && V="keep-heavy: verify manual-only"
  [ "$U" = 0 ] && V="candidate: archive?"
  case "$n" in diagnose) V="STUBBED: use diagnosing-bugs";;
    grill-me|grill-with-docs) V="keep: 7-line stub, ~zero cost";;
    prototype|xias-prototype) V="keep: tiny, distinct branches";;
    code-review|ponytail) V="keep: non-overlapping (review vs simplicity-ladder)";;
    plannotator-compound) V="keep-heavy: manual-only, unique value";;
  esac
  echo "| $n | $L | $B | $U | $V |"
  case "$d" in
    "$PI"/skills/*)
      if ! is_grandfathered "$n" && [ "$L" -gt 120 ]; then
        echo "<!-- BUDGET-FAIL: $n SKILL.md $L lines > 120 -->"; BUDGET_FAIL=1
      fi;;
  esac
done
echo
echo "## Prompt templates (zero load until invoked)"
echo
echo "| template | lines |"
echo "|---|---|"
for f in "$PI"/agents/*.md "$PI"/templates/*.md; do
  [ -f "$f" ] || continue
  L=$(lines "$f"); echo "| $(basename "$f") | $L |"
  case "$f" in
    "$PI"/templates/*)
      if [ "$L" -gt 60 ]; then echo "<!-- BUDGET-FAIL: $(basename "$f") $L lines > 60 -->"; BUDGET_FAIL=1; fi;;
  esac
done
echo
echo "## Extensions"
echo
echo "| extension | role | verdict |"
echo "|---|---|---|"
echo "| todo-eta | task tracking and ETA | keep |"
echo "| herdr-agent-state | agent state | keep |"
echo "| orca-agent-status | agent status | keep |"
echo "| @pify/yolo | command safety and secret guard | keep |"
echo "| pi-rtk-optimizer | tool-output optimization | keep |"
} > "$OUT"
if [ "$BUDGET_FAIL" = 1 ]; then echo "BUDGET-FAIL: line budget exceeded, see $OUT"; exit 1; fi
echo "wrote $OUT"
