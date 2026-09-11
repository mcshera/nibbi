# Installed Pocket spring update

2026-09-05. The user authorized updating the installed Mac app after local implementation acceptance.

- Built the Tauri desktop shell from this checkout.
- Installed and reopened `~/Applications/Nibbi.app` (0.8.0).
- Preserved the previous app at `~/Applications/Nibbi.app.backup-20260905-161255`.
- Applied a local ad-hoc bundle signature. `codesign --verify --deep --strict` passed. This is not a notarized distribution build.
- Confirmed the native window opens with the new interface and retained chat history.
- The local backend serves the built interactive assets, with no Tricks panel. Backend PID remained unchanged; no backend restart, migration, account change, or state reset was performed.
- Current unit tests: 49/49. Ordinary desktop/phone and review regression checks passed. Existing concurrent review/input safety changes were retained.

Evidence: `output/pocket-install/20260905-161255/INSTALL.json`, build/signature/test logs and the installed-window screenshot. This is a native launch/visual smoke check, not full WKWebView, physical-device or live-voice certification.

The native app loads its interface from the existing local server. Future UI-only updates also require refreshing/reopening the native window so it loads the latest built assets.
