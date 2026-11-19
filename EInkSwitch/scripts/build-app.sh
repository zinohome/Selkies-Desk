#!/bin/bash
set -euo pipefail

VERSION="0.6.0"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/.build/out"
APP_DIR="$ROOT_DIR/.build/out/EInkSwitch.app"
EXECUTABLE="$BUILD_DIR/Products/Release/EInkSwitch"

swift build -c release --package-path "$ROOT_DIR"

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
cp "$EXECUTABLE" "$APP_DIR/Contents/MacOS/EInkSwitch"
cat > "$APP_DIR/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
  <key>CFBundleExecutable</key><string>EInkSwitch</string>
  <key>CFBundleIdentifier</key><string>so.sao.eink-switch</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>EInkSwitch</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSAppleEventsUsageDescription</key><string>用于读取和切换 macOS 辅助功能中的墨水屏效果。</string>
</dict>
</plist>
PLIST

codesign --force --sign - "$APP_DIR"
plutil -lint "$APP_DIR/Contents/Info.plist"
printf '%s\n' "$APP_DIR"
