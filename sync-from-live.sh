#!/usr/bin/env bash
# sync-from-live.sh - vendor vetted changes from live ~/.pi/agent back into repo.
#
# Default dry-run. --apply writes. --check reports without writing or prompting.
# Exit codes: 0 ok, 1 error, 2 pending-unknowns.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="$ROOT/sync-classify.conf"
MANIFEST="$ROOT/manifest.lock"
PENDING_FILE="${SYNC_PENDING_FILE:-}"
if [ -z "$PENDING_FILE" ]; then
  PENDING_FILE="$(mktemp /tmp/sync-pending.XXXXXX)"
fi

APPLY=0; CHECK=0; YES=0; JSON=0; VERIFY=0; STRICT=0
CHANGED=0; PENDING=0; WARN=0
DECISIONS=()

log()  { printf '%s\n' "$*"; }
ok()   { printf 'OK    %s\n' "$*"; }
skip() { printf 'SKIP  %s\n' "$*"; }
warn() { WARN=$((WARN+1)); printf 'WARN  %s\n' "$*"; }
die()  { printf 'ERROR %s\n' "$*" >&2; exit 1; }
record() { DECISIONS+=("$1|$2|$3"); }

usage() { printf 'Usage: sync-from-live.sh [--apply] [--check] [--yes] [--json] [--verify] [--strict] [-h]\n'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --check) CHECK=1; shift ;;
    --yes) YES=1; shift ;;
    --json) JSON=1; shift ;;
    --verify) VERIFY=1; shift ;;
    --strict) STRICT=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown flag: $1" ;;
  esac
done

[ -f "$CONF" ] || die "missing $CONF"
[ -f "$MANIFEST" ] || die "missing $MANIFEST"
# shellcheck disable=SC1090
source "$CONF"

LIVE_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"
SKILLS_LIVE="${PI_AGENTS_SKILLS:-$HOME/.agents/skills}"
[ -d "$LIVE_DIR" ] || die "live dir missing: $LIVE_DIR"

match_list() { # $1=rel $2=base $3...=patterns; returns 0 on match
  local rel="$1" base="$2"; shift 2
  local pat
  for pat in "$@"; do
    [ -n "$pat" ] || continue
    case "$rel" in $pat) return 0 ;; esac
    case "$base" in $pat) return 0 ;; esac
  done
  return 1
}

is_runtime() { match_list "$1" "$2" "${RUNTIME_PATTERNS[@]:-}"; }
is_secret()  { match_list "$1" "$2" "${SECRET_PATTERNS[@]:-}"; }
is_skip()    { match_list "$1" "$2" "${SKIP_ALWAYS[@]:-}"; }
is_vendor()  { match_list "$1" "$2" "${VENDOR_ALWAYS[@]:-}"; }

apply_transforms() { # $1=tmpfile $2=dest-rel
  local tmp="$1" drel="$2"
  local spec glob rest pat rep
  for spec in "${TRANSFORMS[@]:-}"; do
    [ -n "$spec" ] || continue
    glob="${spec%%:*}"; rest="${spec#*:}"
    pat="${rest%%:*}"; rep="${rest#*:}"
    case "$drel" in $glob) ;;
    *) basename_match=0
       case "$(basename "$drel")" in $glob) basename_match=1 ;; esac
       [ "$basename_match" = 1 ] || continue ;;
    esac
    sed -i -E "s|$pat|$rep|g" "$tmp" || die "transform failed: $spec"
  done
}

vendor_file() { # $1=src-abs $2=dest-rel $3=reason
  local src="$1" drel="$2" reason="$3"
  local dest="$ROOT/$drel"
  local tmp
  tmp="$(mktemp)"
  cp "$src" "$tmp"
  apply_transforms "$tmp" "$drel"
  if [ -f "$dest" ] && cmp -s "$tmp" "$dest"; then
    rm -f "$tmp"
    [ "$JSON" = 1 ] || skip "$drel identical"
    record "skip" "$drel" "identical"
    return 0
  fi
  if [ -f "$dest" ] && [ "$dest" -nt "$src" ]; then
    rm -f "$tmp"
    if [ "$APPLY" = 0 ] || [ "$CHECK" = 1 ]; then
      [ "$JSON" = 1 ] || log "WOULD-SYNC-NEWER $drel (repo-newer, skipping)"
      record "repo-newer" "$drel" "repo-newer-dry-run"
      return 0
    fi
    warn "REPO-NEWER $drel skipped (dest newer than src)"
    record "repo-newer" "$drel" "repo-newer"
    return 0
  fi
  if [ "$APPLY" = 0 ] || [ "$CHECK" = 1 ]; then
    rm -f "$tmp"
    CHANGED=$((CHANGED+1))
    [ "$JSON" = 1 ] || log "WOULD vendor $drel ($reason)"
    record "vendor" "$drel" "$reason-dry-run"
    return 0
  fi
  mkdir -p "$(dirname "$dest")"
  cp "$tmp" "$dest.tmp.$$"
  mv "$dest.tmp.$$" "$dest"
  rm -f "$tmp"
  CHANGED=$((CHANGED+1))
  [ "$JSON" = 1 ] || ok "vendored $drel"
  record "vendor" "$drel" "$reason"
}

handle_unknown() { # $1=rel $2=src-abs
  local rel="$1" src="$2" base ans
  base="$(basename "$rel")"
  if [ "$HAVE_STOCK" = 1 ]; then
    if grep -qxF "$base" "$STOCK_LIST" 2>/dev/null || grep -q "/$base$" "$STOCK_LIST" 2>/dev/null; then
      [ "$JSON" = 1 ] || skip "$rel stock-owned"
      record "skip" "$rel" "stock"
      return 0
    fi

  fi
  if [ "$YES" = 1 ] || [ "$CHECK" = 1 ]; then
    PENDING=$((PENDING+1))
    record "pending" "$rel" "unknown"
    [ "$JSON" = 1 ] || log "PENDING $rel (unknown)"
    if [ "$YES" = 1 ]; then
      printf '%s\n' "$rel" >> "$PENDING_FILE"
    fi
    return 0
  fi
  printf 'Unknown file: %s [v]endor/[s]kip-once/[a]lways-skip-to-conf/sec[r]et? ' "$rel"
  read -r ans || ans="s"
  case "$ans" in
    v|V) vendor_file "$src" "$rel" "unknown-vendored" ;;
    a|A)
      printf "\n# added by sync-from-live.sh\nSKIP_ALWAYS+=(%q)\n" "$rel" >> "$CONF"
      SKIP_ALWAYS+=("$rel")
      [ "$JSON" = 1 ] || skip "$rel always-skip"
      record "skip" "$rel" "always-skip-to-conf" ;;
    r|R) die "secret file declared by operator: $rel (aborting)" ;;
    *) [ "$JSON" = 1 ] || skip "$rel skip-once"
       record "skip" "$rel" "skip-once" ;;
  esac
}

classify_one() { # $1=src-abs $2=rel
  local src="$1" rel="$2" base
  base="$(basename "$rel")"
  if is_runtime "$rel" "$base"; then
    [ "$JSON" = 1 ] || skip "$rel runtime"
    record "skip" "$rel" "runtime"
    return 0
  fi
  if is_secret "$rel" "$base"; then
    if [ "$STRICT" = 1 ]; then
      record "secret" "$rel" "secret"
      die "secret file refusing to vendor, aborting: $rel"
    fi
    warn "SECRET $rel skipped (use --strict to abort)"
    record "skip" "$rel" "secret"
    return 0
  fi
  if is_skip "$rel" "$base"; then
    [ "$JSON" = 1 ] || skip "$rel skip-list"
    record "skip" "$rel" "skip-list"
    return 0
  fi
  if is_vendor "$rel" "$base"; then
    vendor_file "$src" "$rel" "vendor-list"
    return 0
  fi
  handle_unknown "$rel" "$src"
}

# --- Phase 1 baseline: stock file list from tool:pi pin ----------------------
TMPDIR="$(mktemp -d)"
baseline_from_local() {
  local npmroot=""
  if command -v npm >/dev/null 2>&1; then
    npmroot="$(npm root -g 2>/dev/null || true)"
  fi
  if [ -n "$npmroot" ] && [ -d "$npmroot/@earendil-works/pi-coding-agent" ]; then
    if find "$npmroot/@earendil-works/pi-coding-agent" -type f | sed "s|^$npmroot/@earendil-works/pi-coding-agent/||" > "$STOCK_LIST" 2>/dev/null; then
      HAVE_STOCK=1
      [ "$JSON" = 1 ] || ok "baseline: stock list from local pi install ($(wc -l < "$STOCK_LIST") entries)"
      return 0
    fi
  fi
  return 1
}
trap 'rm -rf "$TMPDIR" 2>/dev/null || true' EXIT
STOCK_LIST="$TMPDIR/stock.txt"
HAVE_STOCK=0
: > "$STOCK_LIST"
PI_LINE="$(grep -m1 '^# tool:pi ' "$MANIFEST" || true)"
if [ -n "$PI_LINE" ]; then
  TARBALL="$(printf '%s' "$PI_LINE" | sed -n 's/.*tarball:\([^ ]*\).*/\1/p')"
  SHASUM="$(printf '%s' "$PI_LINE" | sed -n 's/.*shasum:\([^ ]*\).*/\1/p')"
  if [ -n "$TARBALL" ] && [ -n "$SHASUM" ]; then
    TGZ="$TMPDIR/pi.tgz"
    if curl -fsSL "$TARBALL" -o "$TGZ" 2>/dev/null; then
      if printf '%s  %s\n' "$SHASUM" "$TGZ" | sha256sum -c - >/dev/null 2>&1; then
        if tar -tzf "$TGZ" > "$STOCK_LIST" 2>/dev/null; then
          HAVE_STOCK=1
          [ "$JSON" = 1 ] || ok "baseline: stock list ($(wc -l < "$STOCK_LIST") entries)"
        else
          warn "baseline: tar list failed, trying local pi install"
          baseline_from_local || warn "baseline: local fallback failed, continuing without baseline"
        fi
      else
        warn "baseline: shasum mismatch, trying local pi install"
        baseline_from_local || warn "baseline: local fallback failed, continuing without baseline"
      fi
    else
      warn "baseline: offline (curl failed), trying local pi install"
      baseline_from_local || warn "baseline: local fallback failed, continuing without baseline"
    fi
  else
    warn "baseline: tool:pi pin unparseable, continuing without baseline"
  fi
else
  warn "baseline: no tool:pi pin, continuing without baseline"
fi

# --- Phase 2+3: live files ----------------------------------------------------
if [ "$JSON" = 0 ]; then
  if [ "$CHECK" = 1 ]; then log "check mode: no writes"; elif [ "$APPLY" = 0 ]; then log "dry-run: no writes (use --apply)"; fi
fi
while IFS= read -r f; do
  [ -n "$f" ] || continue
  rel="${f#$LIVE_DIR/}"
  classify_one "$f" "$rel"
done < <(find "$LIVE_DIR" -type f -not -path '*/node_modules/*' | sort)

# --- Skills ------------------------------------------------------------------
for dir in "${SKILL_SOURCES[@]:-}"; do
  [ -n "$dir" ] || continue
  src="$SKILLS_LIVE/$dir/SKILL.md"
  if [ ! -f "$src" ]; then
    [ "$JSON" = 1 ] || skip "skills/$dir/SKILL.md missing in live"
    record "skip" "skills/$dir/SKILL.md" "missing-live"
    continue
  fi
  dest="$ROOT/skills/$dir/SKILL.md"
  if [ -f "$dest" ] && cmp -s "$src" "$dest"; then
    [ "$JSON" = 1 ] || skip "skills/$dir/SKILL.md identical"
    record "skip" "skills/$dir/SKILL.md" "identical"
    continue
  fi
  if [ -f "$dest" ] && [ "$dest" -nt "$src" ]; then
    if [ "$APPLY" = 0 ] || [ "$CHECK" = 1 ]; then
      [ "$JSON" = 1 ] || log "WOULD-SYNC-NEWER skills/$dir/SKILL.md (repo-newer, skipping)"
      record "repo-newer" "skills/$dir/SKILL.md" "repo-newer-dry-run"
      continue
    fi
    warn "REPO-NEWER skills/$dir/SKILL.md skipped (dest newer than src)"
    record "repo-newer" "skills/$dir/SKILL.md" "repo-newer"
    continue
  fi
  if [ "$APPLY" = 0 ] || [ "$CHECK" = 1 ]; then
    CHANGED=$((CHANGED+1))
    [ "$JSON" = 1 ] || log "WOULD vendor skills/$dir/SKILL.md"
    record "vendor" "skills/$dir/SKILL.md" "skill-dry-run"
    continue
  fi
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest.tmp.$$"
  mv "$dest.tmp.$$" "$dest"

  CHANGED=$((CHANGED+1))
  [ "$JSON" = 1 ] || ok "vendored skills/$dir/SKILL.md"
  record "vendor" "skills/$dir/SKILL.md" "skill"
done

# --- Deletions: review only, never delete -------------------------------------
while IFS= read -r line; do
  case "$line" in '#'*) continue ;; '') continue ;; esac
  path="$(printf '%s' "$line" | awk '{print $2}')"
  case "$path" in extensions/*|agents/*|themes/*|config/*|scripts/*|templates/*|patches/*) ;;
    *) continue ;;
  esac
  live_rel="$path"
  if [ ! -e "$LIVE_DIR/$live_rel" ]; then
    [ "$JSON" = 1 ] || log "REVIEW-DELETE $path (absent in live, not deleting)"
    record "review-delete" "$path" "absent-live"
  fi
done < "$MANIFEST"

# --- Phase 4: regen manifest + lint -------------------------------------------
if [ "$APPLY" = 1 ] && [ "$CHANGED" -gt 0 ]; then
  head -n 6 "$MANIFEST" > "$TMPDIR/manifest.new"
  (cd "$ROOT" && find extensions agents skills themes config scripts templates patches memory -type f | grep -v 'skills/xias-symlinks.txt' | grep -v '\.pi-target' | sort | xargs sha256sum | sed 's| \./|  |') >> "$TMPDIR/manifest.new"
  mv "$TMPDIR/manifest.new" "$MANIFEST"
  bash -n "$ROOT/install.sh" || die "install.sh lint failed after regen"
  [ "$JSON" = 1 ] || ok "manifest.lock regenerated"
fi

if [ "$VERIFY" = 1 ]; then
  while IFS= read -r line; do
    case "$line" in '#'*) continue ;; '') continue ;; esac
    sum="$(printf '%s' "$line" | awk '{print $1}')"
    path="$(printf '%s' "$line" | awk '{print $2}')"
    [ -n "$sum" ] && [ -n "$path" ] || continue
    if [ ! -f "$ROOT/$path" ]; then die "verify: missing $path"; fi
    actual="$(sha256sum "$ROOT/$path" | awk '{print $1}')"
    [ "$actual" = "$sum" ] || die "verify: checksum mismatch $path"
  done < "$MANIFEST"
  [ "$JSON" = 1 ] || ok "verify passed"
fi

# --- Output -------------------------------------------------------------------
if [ "$JSON" = 1 ]; then
  dec_json=""
  d=""
  for d in "${DECISIONS[@]:-}"; do
    esc="$(printf '%s' "$d" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    if [ -n "$dec_json" ]; then dec_json="$dec_json, "; fi
    dec_json="$dec_json\"$esc\""
  done
  printf '{"changed": %s, "pending": %s, "decisions": [%s]}\n' "$CHANGED" "$PENDING" "$dec_json"
else
  log "changed=$CHANGED pending=$PENDING"
  if [ "$PENDING" -gt 0 ]; then log "pending list: $PENDING_FILE"; fi
fi

if [ "$PENDING" -gt 0 ]; then exit 2; fi
exit 0
