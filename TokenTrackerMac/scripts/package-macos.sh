#!/usr/bin/env bash
# ──────────────────────────────────────────────
# package-macos.sh — build the NATIVE macOS client (vendored upstream
# TokenTrackerBar SwiftUI app, XcodeGen manifest at TokenTrackerBar/).
#
#   bash scripts/package-macos.sh            # .app + dmg + zip into artifacts/
#
# Requires FULL Xcode (SwiftUI macros: SwiftUIMacros plugin ships only in Xcode;
# CLT's actool is also Xcode-only). Set DEVELOPER_DIR or `xcode-select` to it.
# EmbeddedServer payload comes from scripts/bundle-node.sh (run first).
# The legacy webview shell chain lives in package-macos-legacy.sh.
# ──────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAC_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$MAC_DIR")"
APP_NAME="TokenTracker-plus"
EXEC_NAME="TokenTrackerBar"
BUNDLE_ID="com.tokentrackerplus.mac"
ARTIFACTS_DIR="$MAC_DIR/artifacts"
BUILD_DIR="$MAC_DIR/build"

VERSION="$(node -p "JSON.parse(require('fs').readFileSync('$REPO_ROOT/package.json','utf8')).version")"
echo "[package] version = $VERSION"

# 1. Locate full Xcode (DEVELOPER_DIR wins, then xcode-select -p).
XC="${DEVELOPER_DIR:-}"
if [ -z "$XC" ]; then
  XC="$(xcode-select -p 2>/dev/null || true)"
  case "$XC" in
    *CommandLineTools*) echo "ERROR: active developer dir is CommandLineTools. Install full Xcode and either:" >&2
      echo "  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer   # or" >&2
      echo "  sudo xcode-select -s /Applications/Xcode.app" >&2
      exit 1 ;;
    "") echo "ERROR: no developer directory found — install Xcode" >&2; exit 1 ;;
  esac
fi
echo "[package] Xcode: $XC"
export DEVELOPER_DIR="$XC"
ACTOOL="$(xcrun -f actool 2>/dev/null || echo "$XC/usr/bin/actool")"

command -v swiftc >/dev/null 2>&1 || { echo "ERROR: swiftc not on PATH" >&2; exit 1; }

EMBED_DIR="$MAC_DIR/EmbeddedServer"
if [ ! -x "$EMBED_DIR/node-arm64" ] || [ ! -x "$EMBED_DIR/node-x64" ] \
   || [ ! -f "$EMBED_DIR/tokentracker/bin/tracker.js" ]; then
  echo "ERROR: EmbeddedServer missing or incomplete — run scripts/bundle-node.sh first" >&2
  exit 1
fi
if [ ! -f "$EMBED_DIR/tokentracker/dashboard/dist/pet.html" ]; then
  echo "ERROR: embedded dashboard has no pet.html — the EmbeddedServer tree is stale/non-PET" >&2
  exit 1
fi

APP_DIR="$BUILD_DIR/$APP_NAME.app"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"

# 2. Compile via xcodebuild against the XcodeGen project (upstream recipe).
#    Product = "TokenTracker Plus.app": widget appex in PlugIns/, Vortex bundle,
#    Assets.car, TT-Plus strings. Dual-arch: build per destination, lipo both
#    the main binary and the widget appex binary.
echo "[package] xcodebuild (XcodeGen project)..."
cd "$MAC_DIR/TokenTrackerBar"
xcodebuild -scheme TokenTrackerBar -configuration Release \
  -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath "$BUILD_DIR/derived" build 2>&1 | tail -3
PRODUCT_APP="$BUILD_DIR/derived/Build/Products/Release/TokenTracker Plus.app"
xcodebuild -scheme TokenTrackerBar -configuration Release \
  -destination 'platform=macOS,arch=x86_64' \
  -derivedDataPath "$BUILD_DIR/derived-x64" build 2>&1 | tail -3
PRODUCT_APP_X64="$BUILD_DIR/derived-x64/Build/Products/Release/TokenTracker Plus.app"
cd "$MAC_DIR"

[ -d "$PRODUCT_APP" ] || { echo "ERROR: product app missing: $PRODUCT_APP" >&2; exit 1; }

# Assemble: arm64 product shell, lipo-merge main + appex binaries.
rm -rf "$APP_DIR"
ditto "$PRODUCT_APP" "$APP_DIR"
MAIN_ARM="$PRODUCT_APP/Contents/MacOS/TokenTracker Plus"
MAIN_X64="$PRODUCT_APP_X64/Contents/MacOS/TokenTracker Plus"
APEX_ARM="$PRODUCT_APP/Contents/PlugIns/TokenTrackerWidget.appex/Contents/MacOS/TokenTrackerWidget"
APEX_X64="$PRODUCT_APP_X64/Contents/PlugIns/TokenTrackerWidget.appex/Contents/MacOS/TokenTrackerWidget"
lipo -create "$MAIN_ARM" "$MAIN_X64" -output "$APP_DIR/Contents/MacOS/TokenTracker Plus"
if [ -f "$APEX_ARM" ] && [ -f "$APEX_X64" ]; then
  lipo -create "$APEX_ARM" "$APEX_X64" \
    -output "$APP_DIR/Contents/PlugIns/TokenTrackerWidget.appex/Contents/MacOS/TokenTrackerWidget"
fi
lipo -info "$APP_DIR/Contents/MacOS/TokenTracker Plus"

# Version from package.json (xcodegen emits 1.0 by default).
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$APP_DIR/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $VERSION" "$APP_DIR/Contents/Info.plist"

# 2b. Menu-bar cat frames (托盘图标风格 奔跑小猫) — NSImage(named: "catN").
for n in 0 1 2 3 4; do
  cp "BarSources/Package.swift" /dev/null 2>/dev/null || true
done
if [ -d "$MAC_DIR/TokenTrackerBar/TokenTrackerBar/Resources" ]; then
  for n in 0 1 2 3 4; do
    cp "$MAC_DIR/TokenTrackerBar/TokenTrackerBar/Resources/cat${n}.png" \
       "$APP_DIR/Contents/Resources/cat${n}.png" 2>/dev/null || true
  done
fi

# 3. Embedded server payload (same as the Windows shell).
cp -R "$EMBED_DIR" "$APP_DIR/Contents/Resources/EmbeddedServer"

# 4. Ad-hoc codesign — upstream ordering: sign the appex first, then the app.
#    NO --deep: it re-signs the appex and strips its entitlements, and pkd
#    rejects the widget at runtime.
APEX="$APP_DIR/Contents/PlugIns/TokenTrackerWidget.appex"
if [ -d "$APEX" ]; then
  codesign --force --sign - "$APEX" 2>&1 | grep -v replacing || true
  codesign --verify "$APEX" && echo "[package] appex signed"
fi
codesign --force --sign - "$APP_DIR" 2>&1 | grep -v replacing || true
codesign --verify "$APP_DIR" && echo "[package] codesign OK (ad-hoc)"

# 5. Artifacts: dmg (drag-to-Applications layout) + universal zip.
rm -rf "$ARTIFACTS_DIR" && mkdir -p "$ARTIFACTS_DIR"
STAGE="$(mktemp -d /tmp/ttp-dmg.XXXXXX)"
cp -R "$APP_DIR" "$STAGE/$APP_NAME.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "TokenTracker Plus $VERSION" -srcfolder "$STAGE" -ov -format UDZO \
  "$ARTIFACTS_DIR/TokenTracker-plus-$VERSION.dmg" >/dev/null
rm -rf "$STAGE"
cd "$BUILD_DIR"
zip -qry "$ARTIFACTS_DIR/TokenTracker-plus-macos-universal-$VERSION.zip" "$APP_NAME.app"
cd "$MAC_DIR"

echo
echo "──────────────────────────────────────────"
echo "Artifacts (size bytes / sha256):"
for f in "$ARTIFACTS_DIR"/*; do
  printf "%s\n  %s bytes  %s\n" "$(basename "$f")" "$(stat -f %z "$f")" "$(shasum -a 256 "$f" | awk '{print $1}')"
done
echo "──────────────────────────────────────────"
