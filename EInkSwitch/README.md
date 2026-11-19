# EInkSwitch

EInkSwitch is a standalone macOS menu bar app for switching the system-wide e-reader style display settings. It is independent of Selkies Desk.

## Behavior

- `⌘⌥E` or the menu bar item toggles between e-ink and normal mode.
- E-ink mode turns on **Increase Contrast**, **Differentiate Without Color**, and **Color Filters**, then selects the **Grayscale** filter.
- The first e-ink switch records all four values. Normal mode restores exactly that baseline.
- **Restore three defaults off** turns all three switches off and clears the saved baseline.
- The app drives System Settings through AppleScript. It does not call private APIs or bypass macOS permissions.

## Install

1. Open `EInkSwitch-*.dmg`.
2. Drag `EInkSwitch.app` to `Applications`.
3. Launch it. Its icon appears in the menu bar.
4. Approve Automation and Accessibility prompts when macOS asks for them.

If prompts do not appear, grant both permissions manually:

- System Settings → Privacy & Security → Automation → EInkSwitch → System Events.
- System Settings → Privacy & Security → Accessibility → EInkSwitch.

## Command line

```sh
/Applications/EInkSwitch.app/Contents/MacOS/EInkSwitch --status
/Applications/EInkSwitch.app/Contents/MacOS/EInkSwitch --eink
/Applications/EInkSwitch.app/Contents/MacOS/EInkSwitch --normal
/Applications/EInkSwitch.app/Contents/MacOS/EInkSwitch --defaults
```

The baseline is saved at `~/Library/Application Support/EInkSwitch/baseline.json`.

## Build and verify

```sh
swift run EInkCoreValidator
scripts/build-app.sh
scripts/package.sh
```

The validator checks state planning, baseline persistence, AppleScript generation, and baseline deletion. The scripts build an unsigned, ad-hoc signed arm64 app bundle and package it as DMG and ZIP.
