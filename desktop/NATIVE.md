# Nibbi desktop — native macOS hooks (notifications + Dock badge)

The shell exposes the Tauri JS API globally (`withGlobalTauri: true`), so the web
surface calls `window.__TAURI__.*` directly. No npm package needed.
Always guard with `if (window.__TAURI__)` so the same surface still works in a plain browser.

## Capabilities registered (src-tauri/capabilities/default.json)

- `notification:default`  (plugin `tauri-plugin-notification = "2"`, registered in main.rs)
- `core:window:allow-set-badge-count`  (verified against src-tauri/gen/schemas/desktop-schema.json, tauri 2.11.5)

## Notifications

```js
const N = window.__TAURI__?.notification;

async function notify(title, body) {
  if (!N) return;                                    // browser fallback: do nothing / use web Notification
  let ok = await N.isPermissionGranted();
  if (!ok) ok = (await N.requestPermission()) === 'granted';
  if (ok) N.sendNotification({ title, body });       // sendNotification is sync (fire-and-forget)
}
notify('Nibbi', 'Oracle finished your task');
```

- `sendNotification` also accepts a plain string: `N.sendNotification('hello')`.
- Extra optional fields: `{ title, body, icon, sound, silent }`.
- macOS shows notifications only for a *bundled, installed* app (`Nibbi.app`), not for `tauri dev`.
  On first call macOS prompts the user for permission; the choice is stored under
  System Settings → Notifications → Nibbi.
- Notifications are delivered even when the window is hidden (close button hides the window).

## Dock badge

```js
const W = window.__TAURI__?.window;

async function setBadge(n) {
  if (!W) return;
  const win = W.getCurrentWindow();
  await win.setBadgeCount(n > 0 ? n : undefined);   // undefined / null clears the badge
}
setBadge(3);        // shows "3" on the Dock icon
setBadge(0);        // clears it
```

- macOS: `setBadgeCount(n)` sets the Dock tile badge (`NSApp.dockTile.badgeLabel`) — it is app-wide,
  not per-window, so calling it on the main window is correct.
- Pass `undefined`/`null` (not 0) to clear. In the JS API `0` also renders as no badge on macOS.
- A red badge only appears if the app is in the Dock (it is; Nibbi is a normal .app, not agent-only).
- `setBadgeLabel` (string badge) exists too on macOS behind `core:window:allow-set-badge-label`;
  it is NOT enabled in the capability — add it if you need text badges.

## Also useful (already covered by `core:default`)

```js
window.__TAURI__.event.listen('toggle-live', () => toggleMic());   // ⌥Space global shortcut
window.__TAURI__.window.getCurrentWindow().show();
```
