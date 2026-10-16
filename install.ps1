#Requires -Version 5.1
<#
.SYNOPSIS
  pi-agent-setup installer (Windows twin of install.sh). WSL-first; best effort on native Windows.

.EXAMPLE
  irm https://raw.githubusercontent.com/lrAlval/pi-agent-setup/main/install.ps1 | iex

  With options (download first, then run):
  powershell -ExecutionPolicy Bypass -File install.ps1 -Force -Upgrade

Contract (mirrors install.sh): detect-and-reuse tools, checksum-driven sync
(Get-FileHash) with temp-then-move atomic writes, single backup via flag file,
symlink/junction replace only when wrong, named-mutex lock, fast-path manifest
fingerprint, -Force opt-in. Safe to re-run; second run should be all-SKIP.
#>
param(
  [switch]$Force,
  [switch]$Upgrade,
  [string]$RepoUrl = "https://github.com/lrAlval/pi-agent-setup.git",
  [string]$Ref = "main",
  [string]$RepoDir = $env:PI_SETUP_REPO_DIR
)

$ErrorActionPreference = "Stop"
$script:Changed = 0
$script:WarnCount = 0

function Log-Ok   { param([string]$m) Write-Host "OK    $m" }
function Log-Skip { param([string]$m) Write-Host "SKIP  $m" }
function Log-Warn { param([string]$m) $script:WarnCount++; Write-Host "WARN  $m" }
function Log-Info { param([string]$m) Write-Host $m }
function Fail     { param([string]$m) Write-Host "ERROR $m" -ForegroundColor Red; exit 1 }

$PiDir     = Join-Path $HOME ".pi\agent"
$AgentsDir = Join-Path $HOME ".agents"
$FlagFile  = Join-Path $HOME ".pi\.pi-stack-installed"
$BinDir    = Join-Path $HOME ".local\bin"
New-Item -ItemType Directory -Force -Path (Split-Path $FlagFile), $BinDir | Out-Null

# --- lock (named mutex) -------------------------------------------------------
$Mutex = New-Object System.Threading.Mutex($false, "Global\pi-agent-setup-install")
if (-not $Mutex.WaitOne(0)) { Log-Info "already running (mutex held)"; exit 2 }
try {

# --- repo sources -------------------------------------------------------------
if ($RepoDir -and (Test-Path (Join-Path $RepoDir "manifest.lock"))) {
  $Src = $RepoDir
  Log-Ok "repo sources: local dir $Src"
} else {
  $TmpRoot = Join-Path ([IO.Path]::GetTempPath()) ("pi-setup-" + [Guid]::NewGuid().ToString("N"))
  $Src = Join-Path $TmpRoot "pi-agent-setup"
  Log-Info "cloning $RepoUrl@$Ref ..."
  git clone --depth 1 --branch $Ref $RepoUrl $Src
  if ($LASTEXITCODE -ne 0) { Fail "clone failed; check network and repo URL" }
  Log-Ok "repo sources: cloned $Ref"
}
$Manifest = Join-Path $Src "manifest.lock"
if (-not (Test-Path $Manifest)) { Fail "manifest.lock missing in sources" }

function Manifest-Val {
  param([string]$Key)
  $line = Get-Content $Manifest | Where-Object { $_ -like "# $Key*" } | Select-Object -First 1
  if ($null -eq $line) { return "" }
  return ($line -replace "^# $Key\s*", "")
}
$ManifestSha = (Get-FileHash -Algorithm SHA256 $Manifest).Hash.ToLower()
$ManifestShort = $ManifestSha.Substring(0, 12)

# --- fast path ----------------------------------------------------------------
$FlagManifest = ""
if (Test-Path $FlagFile) {
  $m = Get-Content $FlagFile | Where-Object { $_ -like "manifest *" } | Select-Object -First 1
  if ($m) { $FlagManifest = ($m -split " ")[1] }
}
if ((-not $Force) -and ($FlagManifest -eq $ManifestSha)) {
  if ((Test-Path (Join-Path $PiDir "AGENTS.md")) -and (Test-Path (Join-Path $PiDir "settings.json")) `
      -and (Test-Path (Join-Path $AgentsDir "ux-ui-agent-skills")) -and (Get-Command pi -ErrorAction SilentlyContinue)) {
    Log-Info "already installed (manifest $ManifestShort), nothing to do"
    exit 0
  }
  Log-Warn "fingerprint matches but verification failed; continuing with full run"
}

# --- tools: detect, reuse, never reinstall -------------------------------------
if (Get-Command pi -ErrorAction SilentlyContinue) {
  Log-Skip "pi present, reusing"
} elseif ($env:PI_SETUP_SKIP_PI_INSTALL) {
  Log-Skip "pi missing but PI_SETUP_SKIP_PI_INSTALL=1 (test mode)"
} else {
  $pin = Manifest-Val "tool:pi"
  if ($pin -match "tarball:(\S+)") { $tarball = $Matches[1] } else { Fail "no pi tarball pinned" }
  $shasum = ""; if ($pin -match "shasum:(\S+)") { $shasum = $Matches[1] }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail "npm missing; install Node.js first, then re-run" }
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("pi-tgz-" + [Guid]::NewGuid().ToString("N") + ".tgz")
  Log-Info "pi missing; installing pinned @earendil-works/pi-coding-agent ..."
  Invoke-WebRequest -Uri $tarball -OutFile $tmp
  if ($shasum) {
    $actual = (Get-FileHash -Algorithm SHA256 $tmp).Hash.ToLower()
    if ($actual -ne $shasum.ToLower()) { Fail "pi tarball checksum mismatch; refusing to install" }
  }
  npm install -g $tmp
  if ($LASTEXITCODE -ne 0) { Fail "npm install of pi failed" }
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  Log-Ok "pi installed"
}
Log-Warn "stack is WSL-first on Windows; native shells use impeccable.cmd launcher (.agents/skills/impeccable/scripts/impeccable.cmd)"

function Install-Tool {
  param([string]$Name, [string]$Key, [string]$Binary)
  if (Get-Command $Name -ErrorAction SilentlyContinue) {
    if ($Upgrade) { Log-Warn "$Name present but -Upgrade tool reinstall is manual; reusing" }
    else { Log-Skip "$Name present, reusing" }
    return
  }
  $pin = Manifest-Val $Key
  $is64 = [Environment]::Is64BitOperatingSystem
  $arch = if ([IntPtr]::Size -eq 8) { "amd64" } else { "386" }
  if ($pin -match "windows-${arch}:(\S+)") { $asset = $Matches[1] } else { Fail "no $Name asset pinned for windows-$arch" }
  $sha = ($asset -split "sha256:")[1].Split(":")[0]
  $url = ($asset -split "\|")[-1]
  $tmpd = Join-Path ([IO.Path]::GetTempPath()) ("pi-tool-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $tmpd | Out-Null
  Log-Info "$Name missing; installing pinned version ..."
  $dl = Join-Path $tmpd "dl"
  Invoke-WebRequest -Uri $url -OutFile $dl
  $actual = (Get-FileHash -Algorithm SHA256 $dl).Hash.ToLower()
  if ($actual -ne $sha.ToLower()) { Fail "$Name checksum mismatch; refusing to install" }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if ($dl -like "*.zip") { [IO.Compression.ZipFile]::ExtractToDirectory($dl, $tmpd) }
  else { Fail "$Name archive format not supported by this installer (expected zip)" }
  $found = Get-ChildItem -Recurse -File $tmpd | Where-Object { $_.Name -eq $Binary -or $_.Name -eq "$Binary.exe" } | Select-Object -First 1
  if (-not $found) { Fail "$Name binary '$Binary' not found in archive" }
  $dest = Join-Path $BinDir "$Name.exe"
  $tmpDest = "$dest.tmp.$PID"
  Copy-Item $found.FullName $tmpDest -Force
  Move-Item $tmpDest $dest -Force
  Log-Ok "$Name installed to $dest"
}

Install-Tool fd "tool:fd" "fd"
Install-Tool treehouse "tool:treehouse" "treehouse"

# --- backup exactly once --------------------------------------------------------
$backupTaken = $false
if (Test-Path $FlagFile) { $backupTaken = (Get-Content $FlagFile | Where-Object { $_ -like "backup *" }).Count -gt 0 }
if ((Test-Path $PiDir) -and (-not $backupTaken)) {
  $ts = Get-Date -Format "yyyyMMdd-HHmmss"
  $bak = "$PiDir.bak-$ts"
  Copy-Item $PiDir $bak -Recurse -Force
  Add-Content $FlagFile "backup $bak"
  Log-Ok "backup: $bak"
} elseif (Test-Path $PiDir) {
  Log-Skip "backup already taken (flagged in $FlagFile)"
} else {
  Log-Skip "no pre-existing $PiDir, nothing to back up"
}

# --- checksum-driven sync (temp-then-move; never deletes) ------------------------
$beforeChanged = $script:Changed
function Dest-ForRel {
  param([string]$Rel)
  if ($Rel -like "pi/*") { return (Join-Path $PiDir (($Rel -replace "^pi/", "") -replace "/", "\")) }
  if ($Rel -like "memory/projects/*") { return (Join-Path $PiDir ("projects-memory\" + (($Rel -replace "^memory/projects/", "") -replace "/", "\"))) }
  if ($Rel -like "memory/*") { return (Join-Path $PiDir ("pi-hermes-memory\" + (($Rel -replace "^memory/", "") -replace "/", "\"))) }
  if ($Rel -like "skills/*") { return (Join-Path $AgentsDir (($Rel -replace "/", "\"))) }
  return ""
}
foreach ($line in (Get-Content $Manifest)) {
  if (($line -like "#*") -or ($line.Trim() -eq "")) { continue }
  $parts = $line -split "\s+"
  $sha = $parts[0]; $rel = $parts[1]
  if (($rel -notlike "pi/*") -and ($rel -notlike "memory/*") -and ($rel -notlike "skills/*")) { continue }
  if ($rel -eq "skills/xias-symlinks.txt") { continue }
  # Merge-managed below: the patch registry unions shipped and local entries.
  if ($rel -eq "pi/patches/patch-registry.json") { continue }
  $dest = Dest-ForRel $rel
  if ([string]::IsNullOrEmpty($dest)) { continue }
  $ok = $false
  if (Test-Path $dest -PathType Leaf) {
    $ok = ((Get-FileHash -Algorithm SHA256 $dest).Hash.ToLower() -eq $sha.ToLower())
  }
  if ($ok) { continue }
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  $tmpDest = "$dest.tmp.$PID"
  Copy-Item (Join-Path $Src ($rel -replace "/", "\")) $tmpDest -Force
  Move-Item $tmpDest $dest -Force
  $script:Changed++
  Log-Info "synced: $rel"
}
if ($script:Changed -eq $beforeChanged) { Log-Skip "content sync: up-to-date, 0 files changed" }
else { Log-Ok "content sync: $($script:Changed - $beforeChanged) files changed" }

# --- kit clone -------------------------------------------------------------------
$KitDir = Join-Path $AgentsDir "ux-ui-agent-skills"
$kitPin = Manifest-Val "kit:ux-ui-agent-skills"
$kitTag = ($kitPin -split "\s+")[0]
$kitUrl = ($kitPin -split "\s+")[1]
$validClone = $false
if (Test-Path (Join-Path $KitDir ".git")) {
  $remote = (git -C $KitDir remote get-url origin 2>$null)
  if ($remote -eq $kitUrl) { $validClone = $true }
}
if ($validClone) {
  if ($Upgrade) {
    git -C $KitDir pull --ff-only
    if ($LASTEXITCODE -ne 0) { Log-Warn "kit pull failed; keeping existing clone" }
    Log-Ok "kit: pulled latest (upgrade mode)"
  } else {
    Log-Skip "kit already cloned at $KitDir, reusing"
  }
} else {
  if ((Test-Path $KitDir) -and (-not (Test-Path (Join-Path $KitDir ".git")))) { Fail "$KitDir exists but is not the kit clone; move it aside first" }
  New-Item -ItemType Directory -Force -Path $AgentsDir | Out-Null
  git clone --depth 1 --branch $kitTag $kitUrl $KitDir
  if ($LASTEXITCODE -ne 0) { Fail "kit clone failed" }
  Log-Ok "kit: cloned $kitTag"
}

# --- xias symlinks (correct->SKIP, else create/replace) -----------------------------
$linksFile = Join-Path $Src "skills\xias-symlinks.txt"
if (Test-Path $linksFile) {
  $fixed = 0
  New-Item -ItemType Directory -Force -Path (Join-Path $AgentsDir "skills") | Out-Null
  foreach ($line in (Get-Content $linksFile)) {
    if (($line -like "#*") -or ($line.Trim() -eq "")) { continue }
    $parts = $line -split "\s+"
    $name = $parts[0]; $rel = $parts[1]
    $target = Join-Path $KitDir ($rel -replace "/", "\")
    $link = Join-Path $AgentsDir ("skills\" + $name)
    $current = $null
    $item = Get-Item $link -ErrorAction SilentlyContinue
    if ($item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      $current = $item.Target
      if (($null -eq $current) -and (Get-Command Get-SmbMapping -ErrorAction SilentlyContinue)) { $current = "" }
    }
    if ($current -eq $target) { continue }
    if (Test-Path $link) { Remove-Item $link -Force -Recurse }
    New-Item -ItemType SymbolicLink -Path $link -Target $target | Out-Null
    $fixed++
    Log-Info "symlink fixed: $name -> $target"
  }
  if ($fixed -eq 0) { Log-Skip "xias symlinks: all correct" } else { Log-Ok "xias symlinks: $fixed fixed" }
} else {
  Log-Warn "xias-symlinks.txt missing in sources; skipping symlink step"
}

# --- better-plan-mode -----------------------------------------------------------
# The plan-mode read-only policy, bashMode, and auto-implementation handoff ship
# inside the vendored pi/packages/better-plan-mode source; the historical
# fix-plan-mode*.mjs patch chain was retired because the fork carries it natively.

# --- vendored packages (pi/packages/*): install deps when missing -----------------
if (Test-Path (Join-Path $PiDir "packages")) {
  foreach ($d in (Get-ChildItem -Directory (Join-Path $PiDir "packages") -ErrorAction SilentlyContinue)) {
    if (-not (Test-Path (Join-Path $d.FullName "package.json"))) { continue }
    if ((Test-Path (Join-Path $d.FullName "node_modules")) -and (-not $Force) -and (-not $Upgrade)) {
      Log-Skip "package $($d.Name): node_modules present, reusing"; continue
    }
    if (Get-Command npm -ErrorAction SilentlyContinue) {
      Push-Location $d.FullName
      & npm install --omit=dev --no-audit --no-fund 2>$null
      $rc = $LASTEXITCODE
      Pop-Location
      if ($rc -eq 0) { Log-Ok "package $($d.Name): deps installed" }
      else { Log-Warn "package $($d.Name): npm install failed; its extension may not load" }
    } else {
      Log-Warn "package $($d.Name) needs deps but npm is missing; install Node.js then re-run"
    }
  }
}

# --- patch registry merge -------------------------------------------------------
# pi/patches/patch-registry.json is merge-managed: the checksum sync skips it and
# this step unions the shipped entries with any local-only entries by name (shipped
# wins on conflict), so a machine-specific patch entry survives an install.
$RegistryBase = Join-Path $Src "pi\patches\patch-registry.json"
$Registry = Join-Path $PiDir "patches\patch-registry.json"
if (Test-Path $RegistryBase) {
  if ((Test-Path $Registry) -and (Get-Command node -ErrorAction SilentlyContinue)) {
    $mergeOut = & node -e '
const fs = require("fs");
const [basePath, localPath] = process.argv.slice(1);
const base = JSON.parse(fs.readFileSync(basePath, "utf8"));
const local = JSON.parse(fs.readFileSync(localPath, "utf8"));
const names = new Set((base.entries || []).map((e) => e.name));
const extras = (local.entries || []).filter((e) => !names.has(e.name));
const merged = { ...base, versions: { ...(local.versions || {}), ...(base.versions || {}) }, entries: [...(base.entries || []), ...extras] };
const next = JSON.stringify(merged, null, 2) + "\n";
if (next === fs.readFileSync(localPath, "utf8")) {
  console.log("NOCHANGE");
} else {
  fs.writeFileSync(localPath + ".tmp", next);
  fs.renameSync(localPath + ".tmp", localPath);
  console.log("extras:" + extras.map((e) => e.name).join(","));
}
' $RegistryBase $Registry 2>&1
    if ($LASTEXITCODE -eq 0) {
      if ($mergeOut -eq "NOCHANGE") { Log-Skip "patch registry: shipped and local entries already merged" }
      elseif ($mergeOut -like "extras:*") { Log-Ok "patch registry: kept local entries ($($mergeOut.Substring(7)))" }
    } else {
      Log-Warn "patch registry merge failed: $mergeOut"
    }
  } else {
    New-Item -ItemType Directory -Force -Path (Split-Path $Registry) | Out-Null
    Copy-Item $RegistryBase $Registry -Force
    Log-Warn "patch registry: node missing, installed the shipped entries without merging local ones"
  }
}

# --- auth reminder ------------------------------------------------------------------
if (-not (Test-Path (Join-Path $PiDir "auth.json"))) {
  Log-Info "REMINDER: provider auth is a manual step - run pi and authenticate your providers."
} else {
  Log-Skip "auth.json exists, leaving it untouched"
}

# --- verify ---------------------------------------------------------------------------
if (-not (Test-Path (Join-Path $PiDir "AGENTS.md"))) { Fail "verify failed: AGENTS.md missing" }
if (-not (Test-Path (Join-Path $PiDir "settings.json"))) { Fail "verify failed: settings.json missing" }
if (-not (Test-Path (Join-Path $PiDir "OPINIONS.md"))) { Fail "verify failed: OPINIONS.md missing" }
if (-not (Test-Path $KitDir)) { Fail "verify failed: kit dir missing" }
if ($env:PI_SETUP_SKIP_PI_INSTALL) {
  Log-Ok "verify: required paths exist (pi run skipped in test mode)"
} else {
  if (-not (Get-Command pi -ErrorAction SilentlyContinue)) { Fail "verify failed: pi missing" }
  Log-Ok "verify: required paths exist, pi present"
}

# --- fingerprint ------------------------------------------------------------------------
if (Test-Path $FlagFile) {
  $content = Get-Content $FlagFile | Where-Object { $_ -notlike "manifest *" }
  @($content + "manifest $ManifestSha") | Set-Content $FlagFile
} else {
  Set-Content $FlagFile "manifest $ManifestSha"
}

Log-Info "done: manifest $ManifestShort, $($script:Changed) files changed, $($script:WarnCount) warnings"
Log-Info "re-run anytime; it is safe (second run should be all-SKIP)."

} finally {
  $Mutex.ReleaseMutex()
  $Mutex.Dispose()
}
