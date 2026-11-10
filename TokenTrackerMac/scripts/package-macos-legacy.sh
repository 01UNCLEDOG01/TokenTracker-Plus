#!/usr/bin/env bash
# ──────────────────────────────────────────────
# package-macos.sh — build TokenTracker-plus.app and the release artifacts.
#
#   bash scripts/package-macos.sh            # .app + dmg + zip into artifacts/
#
# Chain position (GATE_REGISTRY §4 mac row): bundle-node.sh FIRST (it builds the
# PET dashboard and refreshes EmbeddedServer/), then this script, then
# scripts/verify-macos-package.cjs. The .app is ad-hoc signed (no Apple developer
# identity) — the README documents the Gatekeeper first-launch gesture.
# ──────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAC_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$MAC_DIR")"
APP_NAME="TokenTracker-plus"
BUNDLE_ID="com.tokentrackerplus.mac"
ARTIFACTS_DIR="$MAC_DIR/artifacts"
BUILD_DIR="$MAC_DIR/build"
APP_DIR="$BUILD_DIR/$APP_NAME.app"

command -v swiftc >/dev/null 2>&1 || { echo "ERROR: swiftc not on PATH (install the Command Line Tools)" >&2; exit 1; }

VERSION="$(node -p "JSON.parse(require('fs').readFileSync('$REPO_ROOT/package.json','utf8')).version")"
echo "[package] version = $VERSION"

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

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"

# 1. Compile the shell directly into the bundle.
echo "[package] swiftc -> Contents/MacOS/$APP_NAME"
# Universal binary: one .app runs on Apple silicon and Intel Macs. The Swift
# driver takes a single -target per invocation, so build each slice then lipo.
mkdir -p "$BUILD_DIR"
swiftc -O -target arm64-apple-macos13.0 \
  -framework AppKit -framework WebKit -framework ServiceManagement \
  "$MAC_DIR"/Sources/*.swift \
  -o "$BUILD_DIR/TokenTracker-plus-arm64"
swiftc -O -target x86_64-apple-macos13.0 \
  -framework AppKit -framework WebKit -framework ServiceManagement \
  "$MAC_DIR"/Sources/*.swift \
  -o "$BUILD_DIR/TokenTracker-plus-x64"
lipo -create "$BUILD_DIR/TokenTracker-plus-arm64" "$BUILD_DIR/TokenTracker-plus-x64" \
  -output "$APP_DIR/Contents/MacOS/$APP_NAME"
lipo -info "$APP_DIR/Contents/MacOS/$APP_NAME"

# 2. Icon: app-icon.png -> iconset -> icns (sizes required by iconutil).
ICON_SRC="$REPO_ROOT/dashboard/public/app-icon.png"
ICONSET="$BUILD_DIR/AppIcon.iconset"
if [ -f "$ICON_SRC" ]; then
  rm -rf "$ICONSET" && mkdir -p "$ICONSET"
  for spec in "16 icon_16x16" "32 icon_16x16@2x" "32 icon_32x32" "64 icon_32x32@2x" \
              "128 icon_128x128" "256 icon_128x128@2x" "256 icon_256x256" \
              "512 icon_256x256@2x" "512 icon_512x512" "1024 icon_512x512@2x"; do
    size="${spec%% *}"; name="${spec#* }"
    sips -z "$size" "$size" "$ICON_SRC" --out "$ICONSET/$name.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP_DIR/Contents/Resources/AppIcon.icns"
else
  echo "WARN: app-icon.png missing — bundling without an icon"
fi

# 2b. Menu-bar cat frames (托盘图标风格 奔跑小猫) — NSImage(named: "catN").
for n in 0 1 2 3 4; do
  cp "BarSources/Assets.xcassets/RunnerCat${n}.imageset/cat${n}.png" \
     "$APP_DIR/Contents/Resources/cat${n}.png" 2>/dev/null || true
done
ls "$APP_DIR/Contents/Resources"/cat*.png >/dev/null 2>&1 || echo "WARN: cat frames missing"

# 3. Info.plist (version injected from package.json).
cat > "$APP_DIR/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundleName</key><string>TokenTracker Plus</string>
  <key>CFBundleDisplayName</key><string>TokenTracker Plus</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>LSUIElement</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.utilities</string>
  <key>NSHumanReadableCopyright</key><string>TokenTracker Plus fork — see LICENSE</string>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
</dict>
</plist>
PLIST

# 4. Embedded server payload.
cp -R "$EMBED_DIR" "$APP_DIR/Contents/Resources/EmbeddedServer"

# 5. Ad-hoc codesign (no developer identity; README documents first-launch).
codesign --force --deep --sign - "$APP_DIR" 2>&1 | grep -v "replacing existing signature" || true
codesign --verify --deep "$APP_DIR" && echo "[package] codesign OK (ad-hoc)"

# 6. Artifacts: dmg (drag-to-Applications layout) + zip.
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
