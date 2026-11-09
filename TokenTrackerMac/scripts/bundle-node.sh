#!/usr/bin/env bash
# ──────────────────────────────────────────────
# bundle-node.sh (macOS counterpart of TokenTrackerWin/scripts/bundle-node.ps1)
#
# Downloads the pinned Node.js darwin-arm64 binary and bundles the tokentracker
# CLI source + built dashboard into TokenTrackerMac/EmbeddedServer/, so the .app
# is self-contained.
#
#   bash scripts/bundle-node.sh           (from TokenTrackerMac/, or any cwd)
#   ... --clean                           # wipe EmbeddedServer/ and exit
#
# The dashboard build inside this script runs with TOKENTRACKER_BUILD_PET=1 —
# never bundle a dist built without it (owner order 2026-10-31: stale-dist
# incidents 5+ times; 2026-10-27: a non-PET dist shipped a pet-less tree and the
# desktop pet rendered the server's 404 body).
# ──────────────────────────────────────────────
set -euo pipefail

# Keep this pinned version in sync with TokenTrackerWin/scripts/bundle-node.ps1.
EXPECTED_NODE_VERSION='22.22.2'
NODE_VERSION="${NODE_VERSION:-$EXPECTED_NODE_VERSION}"
# Universal payload: both architectures are embedded (node-arm64 / node-x64) and
# the shell picks one at runtime by machine arch.
NODE_ARCHS='darwin-arm64 darwin-x64'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAC_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$MAC_DIR")"
EMBED_DIR="$MAC_DIR/EmbeddedServer"

if [ "${1:-}" = "--clean" ]; then
  rm -rf "$EMBED_DIR"
  echo "Cleaned EmbeddedServer/"
  exit 0
fi

if [ "$NODE_VERSION" != "$EXPECTED_NODE_VERSION" ]; then
  echo "ERROR: Refusing to bundle Node v$NODE_VERSION; expected pinned v$EXPECTED_NODE_VERSION. Run npm test against the new Node first." >&2
  exit 1
fi

command -v npm >/dev/null 2>&1 || { echo "ERROR: npm not on PATH" >&2; exit 1; }

rm -rf "$EMBED_DIR"
mkdir -p "$EMBED_DIR"

# 1. PET dashboard build (fresh, never stale)
echo "[bundle-node] TOKENTRACKER_BUILD_PET=1 npm run dashboard:build"
TOKENTRACKER_BUILD_PET=1 npm --prefix "$REPO_ROOT" run dashboard:build
if [ ! -f "$REPO_ROOT/dashboard/dist/pet.html" ] || [ ! -f "$REPO_ROOT/dashboard/dist/quota.html" ]; then
  echo "ERROR: PET dashboard build did not emit pet.html/quota.html — refusing to bundle" >&2
  exit 1
fi

# 2. Download pinned Node.js for BOTH architectures (universal payload) with
#    SHASUMS256 verification + retries. The non-native binary is checksum-only
#    (it cannot exec here without Rosetta); the native one is also exec-verified.
NATIVE_SUFFIX="$(uname -m)"
case "$NATIVE_SUFFIX" in
  arm64) NATIVE_TAG='node-arm64'; NATIVE_DIST='darwin-arm64' ;;
  x86_64) NATIVE_TAG='node-x64'; NATIVE_DIST='darwin-x64' ;;
  *) echo "ERROR: unsupported host arch $NATIVE_SUFFIX" >&2; exit 1 ;;
esac

TMP="${NODE_CACHE_DIR:-$(mktemp -d /tmp/ttnode-${NODE_VERSION}.XXXXXX)}"
mkdir -p "$TMP"
max_attempts=4

fetch_and_verify() {  # $1=darwin dist tag, $2=dest binary name
  local dist="$1" dest="$2"
  local archive="node-v${NODE_VERSION}-${dist}.tar.gz"
  local url="https://nodejs.org/dist/v${NODE_VERSION}/${archive}"
  local sums="$TMP/SHASUMS256-${dist}.txt"
  local verified=0
  if [ -f "$TMP/$archive" ] && [ -f "$sums" ]; then
    expected_hash="$(grep -F "$archive" "$sums" | awk '{print $1}')"
    actual_hash="$(shasum -a 256 "$TMP/$archive" | awk '{print $1}')"
    if [ -n "$expected_hash" ] && [ "$expected_hash" = "$actual_hash" ]; then
      echo "Using cached Node.js v$NODE_VERSION $dist (checksum verified)"
      verified=1
    else
      rm -f "$TMP/$archive"
    fi
  fi
  for attempt in $(seq 1 $max_attempts); do
    [ "$verified" = "1" ] && break
    echo "Downloading Node.js v$NODE_VERSION ($dist)... (attempt $attempt/$max_attempts)"
    if curl -sSLo "$TMP/$archive" "$url" \
       && curl -sSLo "$sums" "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"; then
      expected_hash="$(grep -F "$archive" "$sums" | awk '{print $1}')"
      actual_hash="$(shasum -a 256 "$TMP/$archive" | awk '{print $1}')"
      if [ -n "$expected_hash" ] && [ "$expected_hash" = "$actual_hash" ]; then
        echo "Checksum verified (SHA-256): $dist"
        verified=1
        break
      fi
      echo "Checksum mismatch, retrying..."
      rm -f "$TMP/$archive"
    fi
    [ "$attempt" -lt "$max_attempts" ] && sleep $((attempt * 3))
  done
  if [ "$verified" != "1" ]; then
    echo "ERROR: Failed to obtain a valid Node.js v$NODE_VERSION $dist archive after $max_attempts attempts" >&2
    exit 1
  fi
  tar -xzf "$TMP/$archive" -C "$TMP"
  local bin="$TMP/node-v${NODE_VERSION}-${dist}/bin/node"
  if [ ! -x "$bin" ]; then
    echo "ERROR: node binary not found in $dist archive" >&2
    exit 1
  fi
  cp "$bin" "$EMBED_DIR/$dest"
  chmod +x "$EMBED_DIR/$dest"
}

fetch_and_verify 'darwin-arm64' 'node-arm64'
fetch_and_verify 'darwin-x64'  'node-x64'

bundled_version="$("$EMBED_DIR/$NATIVE_TAG" -p 'process.versions.node')"
if [ "$bundled_version" != "$EXPECTED_NODE_VERSION" ]; then
  echo "ERROR: Bundled Node drifted: expected v$EXPECTED_NODE_VERSION, got v$bundled_version" >&2
  exit 1
fi
echo "Node.js ready - v$bundled_version ($NATIVE_TAG exec-verified; both archs embedded)"

# 3. Bundle tokentracker source (mirror of the Windows script's layout)
TT_DIR="$EMBED_DIR/tokentracker"
mkdir -p "$TT_DIR/bin"
cp "$REPO_ROOT/bin/tracker.js" "$TT_DIR/bin/tracker.js"
cp -R "$REPO_ROOT/src" "$TT_DIR/src"
cp "$REPO_ROOT/package.json" "$TT_DIR/package.json"
# The lockfile pins transitive versions; without it `npm ci` resolves whatever
# is newest at build time (undici 8.11.0 shipped in 1.0.2 this way).
cp "$REPO_ROOT/package-lock.json" "$TT_DIR/package-lock.json"

if [ ! -d "$REPO_ROOT/dashboard/dist" ]; then
  echo "ERROR: dashboard/dist not found after dashboard build — refusing to bundle without dashboard assets" >&2
  exit 1
fi
mkdir -p "$TT_DIR/dashboard"
cp -R "$REPO_ROOT/dashboard/dist" "$TT_DIR/dashboard/dist"

# 4. Install production dependencies
echo "Installing production dependencies..."
(cd "$TT_DIR" && npm ci --omit=dev --no-optional --ignore-scripts >/dev/null)

# 5. Trim node_modules bloat
if [ -d "$TT_DIR/node_modules" ]; then
  # npm on macOS fills node_modules/.bin with symlinks (Windows ships real
  # files); nothing in the payload executes package binaries, so drop the dir
  # instead of teaching the no-symlinks verify gate about platform shims.
  rm -rf "$TT_DIR/node_modules/.bin"
  find "$TT_DIR/node_modules" -type f \( \
    -name '*.md' -o -name '*.txt' -o -name '*.map' -o -name '*.ts' -o -name '*.d.ts' \
    -o -name 'LICENSE*' -o -name 'LICENCE*' -o -name 'CHANGELOG*' -o -name 'CHANGES*' \
    -o -name 'HISTORY*' -o -name '.npmignore' -o -name '.eslintrc*' -o -name '.prettierrc*' \
    -o -name 'tsconfig.json' -o -name '.editorconfig' \) -delete 2>/dev/null || true
  find "$TT_DIR/node_modules" -type d \( \
    -name test -o -name tests -o -name __tests__ -o -name examples -o -name example \
    -o -name docs -o -name .github \) -prune -exec rm -rf {} + 2>/dev/null || true
  node "$REPO_ROOT/scripts/trim-embedded-deps.cjs" "$TT_DIR/node_modules"
fi

TOTAL_MB="$(du -sm "$EMBED_DIR" | awk '{print $1}')"
echo "Bundle complete: $EMBED_DIR (${TOTAL_MB} MB)"
