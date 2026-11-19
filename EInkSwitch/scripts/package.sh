#!/bin/bash
set -euo pipefail

VERSION="0.6.0"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/.build/out/release-eink"
APP_DIR="$ROOT_DIR/.build/out/EInkSwitch.app"
DMG_PATH="$OUTPUT_DIR/EInkSwitch-$VERSION-arm64.dmg"
ZIP_PATH="$OUTPUT_DIR/EInkSwitch-$VERSION-arm64.zip"
SUMS_PATH="$OUTPUT_DIR/SHA256SUMS-$VERSION.txt"

"$ROOT_DIR/scripts/build-app.sh"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

STAGING_DIR="$OUTPUT_DIR/dmg-staging"
mkdir -p "$STAGING_DIR"
cp -R "$APP_DIR" "$STAGING_DIR/"
ln -s /Applications "$STAGING_DIR/Applications"
hdiutil create -volname "EInkSwitch $VERSION" -srcfolder "$STAGING_DIR" -ov -format UDZO "$DMG_PATH"
rm -rf "$STAGING_DIR"

ditto -c -k --keepParent "$APP_DIR" "$ZIP_PATH"
shasum -a 256 "$DMG_PATH" "$ZIP_PATH" | sed "s#  .*/#  #" > "$SUMS_PATH"

printf 'DMG=%s\nZIP=%s\nSUMS=%s\n' "$DMG_PATH" "$ZIP_PATH" "$SUMS_PATH"
