# ──────────────────────────────────────────────
# bundle-node.ps1  (Windows counterpart of TokenTrackerBar/scripts/bundle-node.sh)
#
# Downloads the pinned Node.js win-x64 binary and bundles the tokentracker CLI
# source + built dashboard into EmbeddedServer/, so the .exe is self-contained.
#
#   powershell -ExecutionPolicy Bypass -File scripts\bundle-node.ps1
#   ... -Clean       # wipe EmbeddedServer\ and exit
#
# Build the dashboard first, WITH the floating-pet entry (off by default so the
# macOS/web builds stay byte-identical):
#   $env:TOKENTRACKER_BUILD_PET = "1"; npm run dashboard:build   (from the repo root)
# ──────────────────────────────────────────────
param([switch]$Clean)

$ErrorActionPreference = 'Stop'

# Keep this pinned version in sync with TokenTrackerBar/scripts/bundle-node.sh.
$ExpectedNodeVersion = '22.22.2'
$NodeVersion = if ($env:NODE_VERSION) { $env:NODE_VERSION } else { $ExpectedNodeVersion }

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WinProjDir = Split-Path -Parent $ScriptDir
$RepoRoot  = Split-Path -Parent $WinProjDir
$EmbedDir  = Join-Path $WinProjDir 'EmbeddedServer'

if ($Clean) {
    if (Test-Path $EmbedDir) { Remove-Item -Recurse -Force $EmbedDir }
    Write-Host 'Cleaned EmbeddedServer\'
    exit 0
}

if ($NodeVersion -ne $ExpectedNodeVersion) {
    Write-Error "Refusing to bundle Node v$NodeVersion; expected pinned v$ExpectedNodeVersion. Run npm test against the new Node first."
}

if (Test-Path $EmbedDir) { Remove-Item -Recurse -Force $EmbedDir }
New-Item -ItemType Directory -Force -Path $EmbedDir | Out-Null

# Never bundle a stale dist (owner order 2026-10-31: stale-dist incidents 5+ times).
# This script builds the dashboard itself (PET forced on); verify also enforces the
# dist fingerprint as a second net. Keep this file ASCII-only: PowerShell 5.1 reads
# BOM-less .ps1 as ANSI/GBK and Chinese comments corrupt the parse.
$env:TOKENTRACKER_BUILD_PET = "1"
Push-Location $RepoRoot
try {
    Write-Host "[bundle-node] PET env before build: $env:TOKENTRACKER_BUILD_PET"
    # Reuse an existing build only when dashboard-fingerprint says the dist was made
    # from the current inputs AND the PET entry pages exist. The fingerprint covers
    # src/public/scripts plus the config and entry files, so a real change still
    # forces a rebuild; a second packaging run over unchanged sources does not pay
    # the ~27 s vite build again. TOKENTRACKER_FORCE_DASHBOARD_BUILD=1 opts out.
    $distDir = Join-Path $RepoRoot 'dashboard\dist'
    $fresh = $false
    if (($env:TOKENTRACKER_FORCE_DASHBOARD_BUILD -ne '1') -and
        (Test-Path (Join-Path $distDir 'pet.html')) -and
        (Test-Path (Join-Path $distDir 'quota.html'))) {
        $fingerprint = Join-Path $RepoRoot 'scripts\dashboard-fingerprint.cjs'
        & node $fingerprint --is-fresh $distDir | Out-Null
        $fresh = ($LASTEXITCODE -eq 0)
    }
    if ($fresh) {
        Write-Host '[bundle-node] dashboard/dist already matches current inputs (PET pages present) - skipping rebuild'
    } else {
        npm run dashboard:build
        if ($LASTEXITCODE -ne 0) { throw "dashboard build failed - refusing to bundle" }
    }
    Write-Host ("[bundle-node] pet.html emitted: " + (Test-Path (Join-Path $distDir 'pet.html')))
} finally { Pop-Location }

# 1. Obtain a checksum-verified Node.js win-x64 archive.
#
# 2026-11-13 measured on the owner's network: nodejs.org delivered ~75 KB/s (one
# packaging run spent 30 of its 36 minutes downloading), while
# cdn.npmmirror.com served the identical 35,656,052-byte archive in ~3 s with the
# same SHA-256 as the official SHASUMS256.txt entry. Mirrors are tried first;
# nodejs.org stays as the last-resort fallback.
#
# The cache is persistent. The previous version treated %TEMP% as throwaway and
# deleted it at the start of every run, so every packaging re-downloaded Node even
# though nothing had changed. A verified archive and its extracted node.exe now
# survive between runs (NODE_CACHE_DIR still overrides the location for CI).
$KnownSha256 = @{
    '22.22.2' = '7c93e9d92bf68c07182b471aa187e35ee6cd08ef0f24ab060dfff605fcc1c57c'
}
$zipName = "node-v$NodeVersion-win-x64.zip"
$zipMirrors = @(
    "https://cdn.npmmirror.com/binaries/node/v$NodeVersion/$zipName",
    "https://registry.npmmirror.com/-/binary/node/v$NodeVersion/$zipName",
    "https://nodejs.org/dist/v$NodeVersion/$zipName"
)
$sumsMirrors = @(
    "https://registry.npmmirror.com/-/binary/node/v$NodeVersion/SHASUMS256.txt",
    "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt"
)

# Invoke-WebRequest is dramatically slower and more failure-prone on large files
# while the progress bar is rendered (a well-known Windows PowerShell issue), which
# is what truncated the ~28MB Node archive and tripped the old checksum check.
$ProgressPreference = 'SilentlyContinue'

# Deliberately NOT under %LOCALAPPDATA%\TokenTracker: that folder holds the app's
# user data (WebView2 profiles). Build caches belong beside it, not inside it.
$cacheDir = $env:NODE_CACHE_DIR
if (-not $cacheDir) {
    $base = $env:LOCALAPPDATA
    if (-not $base) { $base = [System.IO.Path]::GetTempPath() }
    $cacheDir = Join-Path $base 'TokenTrackerBuildCache'
}
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
$zipPath = Join-Path $cacheDir $zipName
$sumsPath = Join-Path $cacheDir 'SHASUMS256.txt'
$stageDir = Join-Path $cacheDir "node-v$NodeVersion-win-x64"
$stageNode = Join-Path $stageDir 'node.exe'
$stageHashFile = Join-Path $stageDir '.node.exe.sha256'

function Get-Sha256([string]$Path) { (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToUpper() }

# Expected checksum: local table first (no network for a warm cache), overridable,
# otherwise fall back to the published checksum list. Bumping $ExpectedNodeVersion
# without adding its hash here still works as long as the checksum list is reachable.
$expectedHash = $env:NODE_EXPECTED_SHA256
if (-not $expectedHash) { $expectedHash = $KnownSha256[$NodeVersion] }
if (-not $expectedHash) {
    foreach ($url in $sumsMirrors) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $sumsPath -TimeoutSec 30
            break
        } catch { Write-Warning "SHASUMS256.txt fetch failed: $url" }
    }
    if (Test-Path $sumsPath) {
        $match = Select-String -Path $sumsPath -Pattern ([regex]::Escape($zipName)) | Select-Object -First 1
        if ($match) { $expectedHash = $match.Line.Split(' ')[0] }
    }
    if (-not $expectedHash) {
        Write-Error "No SHA-256 known for Node v$NodeVersion. Add it to `$KnownSha256 or set NODE_EXPECTED_SHA256."
    }
}
$expectedHash = $expectedHash.ToUpper()

$verified = $false
if (Test-Path $zipPath) {
    if ((Get-Sha256 $zipPath) -eq $expectedHash) {
        Write-Host "Using cached Node.js v$NodeVersion archive (SHA-256 verified)"
        $verified = $true
    } else {
        Write-Warning 'Cached Node archive failed verification; re-downloading'
        Remove-Item -Force $zipPath
    }
}

# Two attempts per mirror: a truncated transfer shows up as a checksum mismatch,
# so re-fetch instead of failing the whole release on one flaky connection.
$attemptsPerMirror = 2
foreach ($url in $zipMirrors) {
    if ($verified) { break }
    for ($attempt = 1; $attempt -le $attemptsPerMirror -and (-not $verified); $attempt++) {
        $partial = "$zipPath.partial"
        try {
            Write-Host "Downloading Node.js v$NodeVersion (win-x64) from $url (attempt $attempt/$attemptsPerMirror)"
            $started = Get-Date
            if (Test-Path $partial) { Remove-Item -Force $partial }
            # Mirrors answer in seconds when healthy, so a short timeout fails over
            # quickly. nodejs.org is the last resort and may legitimately crawl
            # (75 KB/s observed), so give it room rather than hanging forever.
            $timeout = if ($url -like '*nodejs.org*') { 900 } else { 240 }
            Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $partial -TimeoutSec $timeout
            $actual = Get-Sha256 $partial
            if ($actual -ne $expectedHash) {
                throw "Checksum mismatch (expected $expectedHash, got $actual)"
            }
            Move-Item -Force $partial $zipPath
            $elapsed = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
            Write-Host "Checksum verified (SHA-256) in $elapsed s"
            $verified = $true
        } catch {
            Write-Warning "Download failed: $($_.Exception.Message)"
            if (Test-Path $partial) { Remove-Item -Force $partial }
            if (-not $verified -and $attempt -lt $attemptsPerMirror) { Start-Sleep -Seconds ($attempt * 2) }
        }
    }
}
if (-not $verified) {
    Write-Error "Failed to obtain a valid Node.js v$NodeVersion archive from any mirror"
}

# Extraction is cached too: expanding 35MB (~87MB of files) costs tens of seconds
# on every run, and a cached node.exe is only trusted when its sidecar hash matches.
function Expand-NodeArchive {
    if (Test-Path $stageDir) { Remove-Item -Recurse -Force $stageDir }
    Expand-Archive -Path $zipPath -DestinationPath $cacheDir -Force
    if (-not (Test-Path $stageNode)) { Write-Error "node.exe not found in archive" }
    Set-Content -Path $stageHashFile -Value (Get-Sha256 $stageNode) -Encoding ASCII
}

if ((Test-Path $stageNode) -and (Test-Path $stageHashFile)) {
    $recordedHash = (Get-Content -Raw $stageHashFile).Trim().ToUpper()
    if ($recordedHash -ne (Get-Sha256 $stageNode)) {
        Write-Warning 'Extracted node.exe failed verification; re-extracting'
        Expand-NodeArchive
    } else {
        Write-Host 'Using cached extracted node.exe'
    }
} else {
    Expand-NodeArchive
}

Copy-Item $stageNode (Join-Path $EmbedDir 'node.exe')

$bundledVersion = (& (Join-Path $EmbedDir 'node.exe') -p 'process.versions.node').Trim()
if ($bundledVersion -ne $ExpectedNodeVersion) {
    Write-Error "Bundled Node drifted: expected v$ExpectedNodeVersion, got v$bundledVersion"
}
Write-Host "Node.js ready - v$bundledVersion"

# 2. Bundle tokentracker source
$ttDir = Join-Path $EmbedDir 'tokentracker'
New-Item -ItemType Directory -Force -Path (Join-Path $ttDir 'bin') | Out-Null
Copy-Item (Join-Path $RepoRoot 'bin\tracker.js') (Join-Path $ttDir 'bin\')
Copy-Item (Join-Path $RepoRoot 'src') (Join-Path $ttDir 'src') -Recurse
Copy-Item (Join-Path $RepoRoot 'package.json') $ttDir
# The lockfile pins transitive versions; without it `npm install` resolves
# whatever is newest at build time (undici 8.11.0 shipped in 1.0.2 this way).
Copy-Item (Join-Path $RepoRoot 'package-lock.json') $ttDir

$dashDist = Join-Path $RepoRoot 'dashboard\dist'
if (Test-Path $dashDist) {
    New-Item -ItemType Directory -Force -Path (Join-Path $ttDir 'dashboard') | Out-Null
    Copy-Item $dashDist (Join-Path $ttDir 'dashboard\dist') -Recurse
} else {
    throw "dashboard\dist not found after dashboard build - refusing to bundle without dashboard assets"
}

# 3. Install production dependencies
Write-Host 'Installing production dependencies...'
Push-Location $ttDir
try {
    & npm ci --omit=dev --no-optional --ignore-scripts | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}

# 4. Trim node_modules bloat
$nm = Join-Path $ttDir 'node_modules'
if (Test-Path $nm) {
    Get-ChildItem $nm -Recurse -File -Include `
        '*.md','*.txt','*.map','*.ts','*.d.ts','LICENSE*','LICENCE*', `
        'CHANGELOG*','CHANGES*','HISTORY*','.npmignore','.eslintrc*', `
        '.prettierrc*','tsconfig.json','.editorconfig' `
        -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem $nm -Recurse -Directory -Include `
        'test','tests','__tests__','examples','example','docs','.github' `
        -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    # Package-specific trims (unused WASM builds) shared with macOS and Linux.
    & node (Join-Path $RepoRoot 'scripts\trim-embedded-deps.cjs') $nm
    if ($LASTEXITCODE -ne 0) { throw "trim-embedded-deps failed with exit code $LASTEXITCODE" }
}

$total = [math]::Round((Get-ChildItem $EmbedDir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Host "Bundle complete: $EmbedDir ($total MB)"
