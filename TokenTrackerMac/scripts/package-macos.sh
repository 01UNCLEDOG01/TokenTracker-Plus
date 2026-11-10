#!/usr/bin/env bash
# ──────────────────────────────────────────────
# package-macos.sh — build the NATIVE macOS client (vendored upstream
# TokenTrackerBar SwiftUI app, SwiftPM manifest at BarSources/Package.swift).
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

# 2. Compile via xcodebuild against the SwiftPM manifest (handles SwiftUI macros
#    and the Vortex-less dependency graph; no XcodeGen/pbxproj needed).
echo "[package] xcodebuild (SwiftPM manifest)..."
cd "$MAC_DIR/BarSources"
xcodebuild -scheme TokenTrackerBar -configuration Release \
  -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath "$BUILD_DIR/derived" build 2>&1 | tail -3
BUILT_BIN="$BUILD_DIR/derived/Build/Products/Release/TokenTrackerBar"
# Universal: build the x86_64 slice too and lipo (single dmg for both archs).
xcodebuild -scheme TokenTrackerBar -configuration Release \
  -destination 'platform=macOS,arch=x86_64' \
  -derivedDataPath "$BUILD_DIR/derived-x64" build 2>&1 | tail -3
BUILT_BIN_X64="$BUILD_DIR/derived-x64/Build/Products/Release/TokenTrackerBar"
if [ ! -f "$BUILT_BIN_X64" ]; then
  echo "WARN: x86_64 slice missing — shipping arm64-only" >&2
  cp "$BUILT_BIN" "$APP_DIR/Contents/MacOS/$EXEC_NAME"
else
  lipo -create "$BUILT_BIN" "$BUILT_BIN_X64" -output "$APP_DIR/Contents/MacOS/$EXEC_NAME"
  lipo -info "$APP_DIR/Contents/MacOS/$EXEC_NAME"
fi
if [ ! -f "$BUILT_BIN" ]; then
  echo "ERROR: built binary not found at $BUILT_BIN" >&2
  exit 1
fi
lipo -info "$BUILT_BIN" || true
cp "$BUILT_BIN" "$APP_DIR/Contents/MacOS/$EXEC_NAME"
cd "$MAC_DIR"

# 3. Asset catalog -> Assets.car (actool with full Xcode), plus the loose
#    imageset PNGs: NSImage(named:) also resolves loose bundle files by name.
echo "[package] actool Assets.xcassets -> Assets.car"
"$ACTOOL" --compile "$APP_DIR/Contents/Resources" \
  --platform macosx --minimum-deployment-target 12.0 \
  BarSources/Resources/Assets.xcassets >/dev/null
[ -f "$APP_DIR/Contents/Resources/Assets.car" ] && echo "[package] Assets.car OK"
# Loose copies: NSImage(named:) resolves bundle files by basename too — belt and
# suspenders in case a catalog member fails to compile.
ASSETS_ROOT="$MAC_DIR/BarSources/Resources/Assets.xcassets" \
OUT_DIR="$APP_DIR/Contents/Resources" \
python3 - <<'PY'
import json, os, shutil, sys
src_root = os.environ.get('ASSETS_ROOT')
out = os.environ.get('OUT_DIR')
count = 0
for name in sorted(os.listdir(src_root)):
    iset = os.path.join(src_root, name)
    if not name.endswith('.imageset') or not os.path.isdir(iset):
        continue
    contents = json.load(open(os.path.join(iset, 'Contents.json')))
    # prefer universal non-retina png, else first image
    chosen = None
    for image in contents.get('images', []):
        if image.get('scale') in (None, '1x') and image.get('filename'):
            chosen = image['filename']; break
    if not chosen:
        for image in contents.get('images', []):
            if image.get('filename'):
                chosen = image['filename']; break
    if not chosen:
        continue
    ext = os.path.splitext(chosen)[1].lower()
    if ext not in ('.png', '.svg', '.pdf'):
        continue
    dest = os.path.join(out, name[:-len('.imageset')] + ('.png' if ext == '.png' else ext))
    shutil.copyfile(os.path.join(iset, chosen), dest)
    count += 1
print(f'[package] loose imageset copies: {count}')
PY

# Runtime resources the app reads from Bundle.main.
cp BarSources/Resources/BotFrames.json "$APP_DIR/Contents/Resources/BotFrames.json"
cp -R BarSources/Resources/PetSprites "$APP_DIR/Contents/Resources/PetSprites"
cp BarSources/Resources/AppIcon.icns "$APP_DIR/Contents/Resources/AppIcon.icns"

# 4. Info.plist (LSUIElement menu-bar app, version injected from package.json).
cat > "$APP_DIR/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>${EXEC_NAME}</string>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundleName</key><string>TokenTracker Plus</string>
  <key>CFBundleDisplayName</key><string>TokenTracker Plus</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.utilities</string>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
</dict>
</plist>
PLIST

# 5. Embedded server payload (same as the Windows shell).
cp -R "$EMBED_DIR" "$APP_DIR/Contents/Resources/EmbeddedServer"

# 6. Ad-hoc codesign.
codesign --force --deep --sign - "$APP_DIR" 2>&1 | grep -v "replacing existing signature" || true
codesign --verify --deep "$APP_DIR" && echo "[package] codesign OK (ad-hoc)"

# 7. Artifacts: dmg (drag-to-Applications layout) + universal zip.
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
