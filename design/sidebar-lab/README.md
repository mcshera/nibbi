# Nibbi sidebar lab

Four left bars, the same four projects, the same nine moments, side by side. The first is the bar Nibbi ships today; the other three each answer one question — **what is the project control, and where do conversations sit relative to Builds, Issues and Plans?**

The ask, in the owner's words: *"chat is at the bottom when it should almost be a different tab on the projects bar like a dropdown."* Read [BRIEF.md](BRIEF.md) for the reasoning, the scorecard and the recommendation; [references.md](references.md) for what T3 Code, OpenCode, Claude Code desktop, Zed, Cursor and Warp do; [CONTRACT.md](CONTRACT.md) for what an option must satisfy.

**No production file is changed.** The lab serves the app's real `styles.css`, `margins.css` and `project-workspace.css` read-only, so every design renders on the real tokens and the `Today` baseline is the real bar rather than a drawing of it.

## Preview

```sh
cd /Users/Matty/Documents/Nibbi
node design/sidebar-lab/serve.mjs
```

Open **http://127.0.0.1:4540/design/sidebar-lab/**. Keys `1`–`9` cue a moment on every bar at once; the improvements and the environment toggles are under the bench. If the port is busy: `NIBBI_SIDEBAR_LAB_PORT=4541 node design/sidebar-lab/serve.mjs`.

| | Option | Pattern | The project control |
|---|---|---|---|
| 01 | **Today** | disclosure tree | a row you expand; records first, conversations last |
| 02 | **Scope** | header row + tab strip (T3 Code V2) | a switcher that opens a full-width dropdown; Chat is the first tab |
| 03 | **Peer** | disclosure tree, minimally changed | the same row; Chat becomes the first child, with its own dropdown |
| 04 | **Spine** | rail + column (OpenCode) | a 56px spine of project tiles beside that project's column |

## The nine moments

`1` home · `2` a thread · `3` switching · `4` builds open · `5` project card · `6` busy · `7` twelve projects · `8` collapsed · `9` phone drawer.

The improvements are separate from the layouts and can be turned on one at a time: a Chat tab in the workspace, New thread pinned to the top, a branch-and-attention summary line, the progress line moved to the foot, the gear on hover, keyboard shortcuts, drag to resize, row actions on hover, and attention reported as text rather than a dot.

## Evidence

- [`evidence/matrix.png`](evidence/matrix.png) — every option × every moment at 1180×760 and 390×844. [`matrix-improved.png`](evidence/matrix-improved.png) is the same with every improvement on.
- `evidence/sheet-<id>.png` — one option across all nine moments at both sizes.
- [`evidence/lab-desktop.png`](evidence/lab-desktop.png), [`lab-phone.png`](evidence/lab-phone.png), [`lab-improvements.png`](evidence/lab-improvements.png), [`lab-glass.png`](evidence/lab-glass.png) — the lab itself.
- `evidence/state-<id>.png` — all four bars at one moment.
- [`evidence/browser-results.json`](evidence/browser-results.json) — every gated check, plus the measured rows the scorecard is built from: clicks to a second conversation, clicks to another project's conversation, whether New thread is reachable without scrolling at four and twelve projects, conversations above the fold on a phone, where New thread falls in the focus order, which of twenty pinned app selectors survive, mount time at sixty projects, and the smallest contrast found.
- [`REVIEW.md`](REVIEW.md) — an independent review of the first version; BRIEF §9 lists what changed in response.

## Reproduce the checks

Uses the repo's own Node and Playwright with local Google Chrome (bundled Chromium in CI). No server needs to be running: each tool starts a private loopback server on an ephemeral port.

```sh
node design/sidebar-lab/options.test.mjs              # the contract, per option, in a browser
node design/sidebar-lab/verify.mjs                    # the sweep: 9 moments × 5 sizes, + evidence
node design/sidebar-lab/sheet.mjs _today scope peer spine --matrix
node design/sidebar-lab/sheet.mjs scope                # one option's sheet
node design/sidebar-lab/shot.mjs scope switch 1180x820 # one option, one moment, one size
```

## Files and limits

`fixture.mjs` is the model every bar renders — the same shape `syncMargins()` passes to the live bar, with a fixed clock so relative times are identical in every screenshot. `states.mjs` is the nine moments, the five sizes and the improvements. `chrome.mjs` holds the shared helpers, the app's glyphs, and the mock frame an option mounts into: paper, character, composer and the workspace. `options/<id>.mjs` are the designs, each following [CONTRACT.md](CONTRACT.md); `options/_template.mjs` is the skeleton to copy and `options/_today.mjs` is the baseline.

These are prototypes on real CSS, not the running app. Nothing here proves how the bar behaves against live data, how a conversation hydrates, how the real translucent window or the traffic lights look, how any of it feels under a finger, or that one layout makes anyone faster. Every check runs in Chrome: **Safari and WKWebView are not certified here**, and neither is the native Tauri shell. The scorecard's author rows are one reading of the sheets; only the rows marked *Measured* come from `verify.mjs`.
