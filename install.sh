#!/usr/bin/env bash
# pi-agent-setup installer: turn a vanilla pi install into the opinionated stack.
#
# One-liner:
#   curl -fsSL https://raw.githubusercontent.com/lrAlval/pi-agent-setup/main/install.sh | bash
#
# Contract (binding): strictly idempotent and deterministic.
#   - Detect-and-reuse every external tool; never reinstall what exists.
#     Upgrades happen only with --upgrade, resets only with --force.
#   - Content sync is checksum-driven against manifest.lock: only files whose
#     content differs are copied (temp-file-then-mv, atomic). Identical files
#     are left byte-for-byte untouched. A re-run with no drift reports
#     "up-to-date, 0 files changed" and writes nothing.
#   - Files the stack does not manage are never deleted; auth.json and
#     trust.json are excluded from sync unconditionally.
#   - One timestamped backup of a pre-existing ~/.pi/agent, on the first run
#     only. Re-runs never create another backup.
#   - flock-guarded: a second concurrent run exits cleanly with "already running".
#   - Vendored packages under pi/packages/ get one npm install when node_modules is missing.
#   - Fast path: when the manifest fingerprint is unchanged and verification
#     passes, prints "already installed (manifest <hash>), nothing to do".
#
# Exit codes: 0 ok (including already-installed), 1 error, 2 already running.
set -euo pipefail

REPO_URL="https://github.com/lrAlval/pi-agent-setup.git"
REPO_REF="main"
FORCE=0
UPGRADE=0
CHANGED=0
WARN=0

log()  { printf '%s\n' "$*"; }
ok()   { printf 'OK    %s\n' "$*"; }
skip() { printf 'SKIP  %s\n' "$*"; }
warn() { WARN=$((WARN+1)); printf 'WARN  %s\n' "$*"; }
die()  { printf 'ERROR %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    --upgrade) UPGRADE=1; shift ;;
    --repo) REPO_URL="$2"; shift 2 ;;
    --ref) REPO_REF="$2"; shift 2 ;;
    -h|--help)
      printf 'Usage: install.sh [--force] [--upgrade] [--repo URL] [--ref REF]\n'; exit 0 ;;
    *) die "unknown flag: $1" ;;
  esac
done

# --- OS detect ---------------------------------------------------------------
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH_NORM="amd64" ;;
  arm64|aarch64) ARCH_NORM="arm64" ;;
  *) die "unsupported arch: $ARCH" ;;
esac
case "$OS" in
  linux) OS_NORM="linux" ;;
  darwin) OS_NORM="darwin" ;;
  *) die "unsupported OS: $OS (Windows users: use install.ps1)" ;;
esac

PI_DIR="${HOME}/.pi/agent"
AGENTS_DIR="${HOME}/.agents"
FLAG_FILE="${HOME}/.pi/.pi-stack-installed"
LOCK_FILE="${HOME}/.pi/.pi-stack.lock"
BIN_DIR="${HOME}/.local/bin"

need() { command -v "$1" >/dev/null 2>&1 || die "required tool missing: $1 ($2)"; }
need curl "install curl first"
need git "install git first"
need sha256sum "install coreutils first"
need tar "install tar first"

mkdir -p "${HOME}/.pi" "$BIN_DIR"
case ":${PATH}:" in *":${BIN_DIR}:"*) ;; *)
  warn "${BIN_DIR} is not on PATH; add it (export PATH=\"\$HOME/.local/bin:\$PATH\")" ;;
esac

# --- lock --------------------------------------------------------------------
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  flock -n 9 || { log "already running (lock held at $LOCK_FILE)"; exit 2; }
else
  if ! mkdir "${LOCK_FILE}.d" 2>/dev/null; then
    log "already running (lock held at $LOCK_FILE.d)"; exit 2
  fi
  trap 'rmdir "${LOCK_FILE}.d" 2>/dev/null || true' EXIT
fi

# --- repo sources -------------------------------------------------------------
if [ -n "${PI_SETUP_REPO_DIR:-}" ]; then
  SRC="$PI_SETUP_REPO_DIR"
  [ -f "$SRC/manifest.lock" ] || die "PI_SETUP_REPO_DIR has no manifest.lock: $SRC"
  ok "repo sources: local dir $SRC"
else
  SRC="$(mktemp -d)/pi-agent-setup"
  log "cloning $REPO_URL@$REPO_REF ..."
  git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$SRC" \
    || die "clone failed; check network and repo URL"
  ok "repo sources: cloned $REPO_REF"
  trap 'rm -rf "$(dirname "$SRC")" 2>/dev/null || true' EXIT
fi
MANIFEST="$SRC/manifest.lock"
[ -f "$MANIFEST" ] || die "manifest.lock missing in sources"

manifest_val() { # $1 = key prefix after '# ', e.g. 'tool:fd' -> rest of line
  grep -m1 "^# $1" "$MANIFEST" | sed "s/^# $1 *//" || true
}
MANIFEST_SHA="$(sha256sum "$MANIFEST" | awk '{print $1}')"
MANIFEST_SHORT="$(printf '%s' "$MANIFEST_SHA" | cut -c1-12)"

# Repo layout maps onto live paths: pi/ -> ~/.pi/agent/,
# memory/ -> ~/.pi/agent/pi-hermes-memory/ (projects/ -> projects-memory/),
# skills/ -> ~/.agents/skills/.
dest_for_rel() { # $1 = manifest relpath -> prints live destination
  case "$1" in
    pi/*) printf '%s' "$PI_DIR/${1#pi/}" ;;
    memory/projects/*) printf '%s' "$PI_DIR/projects-memory/${1#memory/projects/}" ;;
    memory/*) printf '%s' "$PI_DIR/pi-hermes-memory/${1#memory/}" ;;
    skills/*) printf '%s' "$AGENTS_DIR/skills/${1#skills/}" ;;
  esac
}

# --- fast path ---------------------------------------------------------------
# Fingerprint match plus a full checksum verification (read-only, no writes).
# Any drift falls through to the full run, which repairs exactly what changed.
verify_installed() {
  local line sha rel dest
  while IFS= read -r line; do
    case "$line" in \#*|"") continue ;; esac
    sha="$(printf '%s' "$line" | awk '{print $1}')"
    rel="$(printf '%s' "$line" | awk '{print $2}')"
    case "$rel" in pi/*|memory/*|skills/*) ;; *) continue ;; esac
    [ "$rel" = "skills/xias-symlinks.txt" ] && continue
    dest="$(dest_for_rel "$rel")"
    [ -n "$dest" ] || continue
    if [ -f "$dest" ]; then
      echo "$sha  $dest" | sha256sum -c - >/dev/null 2>&1 || return 1
    else
      return 1
    fi
  done < "$MANIFEST"
  [ -d "$AGENTS_DIR/ux-ui-agent-skills" ] || return 1
  command -v pi >/dev/null 2>&1 || return 1
  return 0
}
flag_manifest=""
[ -f "$FLAG_FILE" ] && flag_manifest="$(grep -m1 '^manifest ' "$FLAG_FILE" | awk '{print $2}' || true)"
if [ "$FORCE" -eq 0 ] && [ "$flag_manifest" = "$MANIFEST_SHA" ]; then
  if verify_installed; then
    log "already installed (manifest $MANIFEST_SHORT), nothing to do"
    exit 0
  fi
  warn "fingerprint matches but verification failed; continuing with full run"
fi

# --- tools: detect, reuse, never reinstall ------------------------------------
if command -v pi >/dev/null 2>&1; then
  skip "pi present ($(pi --version 2>/dev/null || echo unknown)), reusing"
elif [ -n "${PI_SETUP_SKIP_PI_INSTALL:-}" ]; then
  skip "pi missing but PI_SETUP_SKIP_PI_INSTALL=1 (test mode)"
else
  PI_PIN="$(manifest_val 'tool:pi')"
  PI_TARBALL="$(printf '%s' "$PI_PIN" | sed -n 's/.*tarball:\([^ ]*\).*/\1/p')"
  PI_SHASUM="$(printf '%s' "$PI_PIN" | sed -n 's/.*shasum:\([^ ]*\).*/\1/p')"
  need npm "install Node.js (which provides npm) first, then re-run"
  TMPD="$(mktemp -d)"
  TARBALL="$TMPD/pi.tgz"
  log "pi missing; installing pinned @earendil-works/pi-coding-agent ..."
  curl -fsSL --max-time 120 -o "$TARBALL" "$PI_TARBALL" || die "pi tarball download failed"
  if [ -n "$PI_SHASUM" ]; then
    echo "$PI_SHASUM  $TARBALL" | sha256sum -c - \
      || die "pi tarball checksum mismatch; refusing to install"
  fi
  npm install -g "$TARBALL" || die "npm install of pi failed"
  rm -rf "$TMPD"
  command -v pi >/dev/null 2>&1 || die "pi still missing after install"
  ok "pi installed ($(pi --version 2>/dev/null || echo unknown))"
fi

install_tool_from_tarball() { # $1=name $2=manifest-key $3=binary-in-archive
  local name="$1" key="$2" bin="$3"
  if command -v "$name" >/dev/null 2>&1; then
    if [ "$UPGRADE" -eq 1 ]; then
      warn "$name present but --upgrade tool reinstall is manual; reusing $(command -v "$name")"
    else
      skip "$name present ($(command -v "$name")), reusing"
    fi
    return 0
  fi
  local pin asset sha url
  pin="$(manifest_val "$key")"
  asset="$(printf '%s' "$pin" | sed -n 's/.*'"$OS_NORM"'-'"$ARCH_NORM"':\([^ ]*\).*/\1/p')"
  [ -n "$asset" ] || die "no $name asset pinned for $OS_NORM-$ARCH_NORM"
  sha="$(printf '%s' "$asset" | sed 's/|.*//;s/.*sha256://')"
  url="$(printf '%s' "$asset" | sed 's/.*|//')"
  local tmpd
  tmpd="$(mktemp -d)"
  log "$name missing; installing pinned version ..."
  curl -fsSL --max-time 120 -o "$tmpd/dl" "$url" || die "$name download failed"
  echo "$sha  $tmpd/dl" | sha256sum -c - || die "$name checksum mismatch; refusing to install"
  tar -xzf "$tmpd/dl" -C "$tmpd" || die "$name extract failed"
  local found
  found="$(find "$tmpd" -name "$bin" -type f | head -n1)"
  [ -n "$found" ] || die "$name binary '$bin' not found in archive"
  cp "$found" "$BIN_DIR/$name.tmp.$$"
  chmod +x "$BIN_DIR/$name.tmp.$$"
  mv "$BIN_DIR/$name.tmp.$$" "$BIN_DIR/$name"
  rm -rf "$tmpd"
  ok "$name installed to $BIN_DIR/$name"
}

install_tool_from_tarball fd "tool:fd" fd
install_tool_from_tarball treehouse "tool:treehouse" treehouse

# --- backup exactly once ------------------------------------------------------
backup_taken=0
[ -f "$FLAG_FILE" ] && backup_taken="$(grep -c '^backup ' "$FLAG_FILE" || true)"
if [ -d "$PI_DIR" ] && [ "$backup_taken" -eq 0 ]; then
  TS="$(date +%Y%m%d-%H%M%S)"
  cp -a "$PI_DIR" "${PI_DIR}.bak-${TS}" || die "backup failed"
  printf 'backup %s\n' "${PI_DIR}.bak-${TS}" >> "$FLAG_FILE"
  ok "backup: ${PI_DIR}.bak-${TS}"
elif [ -d "$PI_DIR" ]; then
  skip "backup already taken (flagged in $FLAG_FILE)"
else
  skip "no pre-existing $PI_DIR, nothing to back up"
fi

# --- checksum-driven sync ------------------------------------------------------
# Copies only files whose sha256 differs (temp-then-mv). Never deletes.
# auth.json / trust.json are excluded unconditionally (not in manifest).
# (dest_for_rel is defined above, next to the fast path.)
sync_from_manifest() {
  local line sha rel dest tmpf
  while IFS= read -r line; do
    case "$line" in \#*|"") continue ;; esac
    sha="$(printf '%s' "$line" | awk '{print $1}')"
    rel="$(printf '%s' "$line" | awk '{print $2}')"
    case "$rel" in pi/*|memory/*|skills/*) ;; *) continue ;; esac
    [ "$rel" = "skills/xias-symlinks.txt" ] && continue
    dest="$(dest_for_rel "$rel")"
    [ -n "$dest" ] || continue
    if [ -f "$dest" ] && echo "$sha  $dest" | sha256sum -c - >/dev/null 2>&1; then
      continue
    fi
    mkdir -p "$(dirname "$dest")"
    tmpf="$dest.tmp.$$"
    cp "$SRC/$rel" "$tmpf" || die "copy failed: $rel"
    mv "$tmpf" "$dest" || die "move failed: $rel"
    CHANGED=$((CHANGED+1))
    log "synced: $rel"
  done < "$MANIFEST"
}

BEFORE_CHANGED=$CHANGED
sync_from_manifest
if [ "$CHANGED" -eq "$BEFORE_CHANGED" ]; then
  skip "content sync: up-to-date, 0 files changed"
else
  ok "content sync: $((CHANGED-BEFORE_CHANGED)) files changed"
fi

# --- kit clone (skip if already valid) -----------------------------------------
KIT_DIR="$AGENTS_DIR/ux-ui-agent-skills"
KIT_PIN="$(manifest_val 'kit:ux-ui-agent-skills')"
KIT_TAG="$(printf '%s' "$KIT_PIN" | awk '{print $1}')"
KIT_URL="$(printf '%s' "$KIT_PIN" | awk '{print $2}')"
if [ -d "$KIT_DIR/.git" ] && [ "$(git -C "$KIT_DIR" remote get-url origin 2>/dev/null || true)" = "$KIT_URL" ]; then
  if [ "$UPGRADE" -eq 1 ]; then
    git -C "$KIT_DIR" pull --ff-only || warn "kit pull failed; keeping existing clone"
    ok "kit: pulled latest (upgrade mode)"
  else
    skip "kit already cloned at $KIT_DIR, reusing"
  fi
else
  [ -e "$KIT_DIR" ] && [ ! -d "$KIT_DIR/.git" ] && die "$KIT_DIR exists but is not the kit clone; move it aside first"
  mkdir -p "$AGENTS_DIR"
  git clone --depth 1 --branch "$KIT_TAG" "$KIT_URL" "$KIT_DIR" || die "kit clone failed"
  ok "kit: cloned $KIT_TAG"
fi

# --- xias symlinks (deterministic: correct->SKIP, else create/replace) ---------
if [ -f "$SRC/skills/xias-symlinks.txt" ]; then
  fixed=0
  while IFS= read -r line; do
    case "$line" in \#*|"") continue ;; esac
    name="$(printf '%s' "$line" | awk '{print $1}')"
    rel="$(printf '%s' "$line" | awk '{print $2}')"
    # Manifest stores '.claude/skills/<n>' relative to the kit root.
    target="$KIT_DIR/$rel"
    if [ -L "$AGENTS_DIR/skills/$name" ] && [ "$(readlink "$AGENTS_DIR/skills/$name")" = "$target" ]; then
      continue
    fi
    mkdir -p "$AGENTS_DIR/skills"
    ln -sfn "$target" "$AGENTS_DIR/skills/$name"
    fixed=$((fixed+1))
    log "symlink fixed: $name -> $target"
  done < "$SRC/skills/xias-symlinks.txt"
  if [ "$fixed" -eq 0 ]; then skip "xias symlinks: all correct"; else ok "xias symlinks: $fixed fixed"; fi
else
  warn "xias-symlinks.txt missing in sources; skipping symlink step"
fi

# --- vendored packages (pi/packages/*): install deps when missing -----------------
# pi-eta is peer-only (no install needed); packages with real dependencies
# (pi-observability-plugin) get one npm install. Skipped when node_modules exists.
if [ -d "$PI_DIR/packages" ]; then
  for PKG in "$PI_DIR"/packages/*/; do
    [ -f "${PKG}package.json" ] || continue
    name="$(basename "$PKG")"
    if [ -d "${PKG}node_modules" ] && [ "$FORCE" -eq 0 ] && [ "$UPGRADE" -eq 0 ]; then
      skip "package $name: node_modules present, reusing"
    elif command -v npm >/dev/null 2>&1; then
      if (cd "$PKG" && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1); then
        ok "package $name: deps installed"
      else
        warn "package $name: npm install failed; its extension may not load"
      fi
    else
      warn "package $name needs deps but npm is missing; install Node.js then re-run"
    fi
  done
fi

# --- better-plan-mode -----------------------------------------------------------
# The plan-mode read-only policy, bashMode, and auto-implementation handoff ship
# inside the vendored pi/packages/better-plan-mode source; no install-time patch
# is needed. The historical fix-plan-mode*.mjs patch chain was retired because
# the fork carries those changes natively.

# --- auth reminder ---------------------------------------------------------------
if [ ! -f "$PI_DIR/auth.json" ]; then
  log "REMINDER: provider auth is a manual step - run pi and authenticate your providers."
else
  skip "auth.json exists, leaving it untouched"
fi

# --- verify ----------------------------------------------------------------------
[ -f "$PI_DIR/AGENTS.md" ] || die "verify failed: $PI_DIR/AGENTS.md missing"
[ -f "$PI_DIR/settings.json" ] || die "verify failed: $PI_DIR/settings.json missing"
[ -f "$PI_DIR/OPINIONS.md" ] || die "verify failed: $PI_DIR/OPINIONS.md missing"
[ -d "$KIT_DIR" ] || die "verify failed: kit dir missing"
if [ -z "${PI_SETUP_SKIP_PI_INSTALL:-}" ]; then
  command -v pi >/dev/null 2>&1 || die "verify failed: pi missing"
  pi --version >/dev/null 2>&1 || warn "pi --version failed; check your pi install"
  ok "verify: required paths exist, pi runs"
else
  ok "verify: required paths exist (pi run skipped in test mode)"
fi

# --- fingerprint -------------------------------------------------------------------
if ! grep -q "^manifest " "$FLAG_FILE" 2>/dev/null; then
  printf 'manifest %s\n' "$MANIFEST_SHA" >> "$FLAG_FILE"
else
  sed -i "s/^manifest .*/manifest $MANIFEST_SHA/" "$FLAG_FILE"
fi

log "done: manifest $MANIFEST_SHORT, $CHANGED files changed, $WARN warnings"
log "re-run anytime; it is safe (second run should be all-SKIP)."
