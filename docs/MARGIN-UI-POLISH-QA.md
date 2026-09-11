# Margin polish QA

## Result

2026-09-06: **13/13 focused checks passed** against the actual built UI in Chrome. Command: `node tools/margin-polish-verify.mjs`.

- Evidence: `output/margin-polish/browser/results.json`.
- Run log: `output/margin-polish/browser-run.log`.
- Exact SHA-256 source, frontend-dist and daemon-dist pins are in `pins` and `endPins`. All pins stayed identical during the run.
- Browser closed. Temporary fixture directory removed. No page errors, console errors or attempted backend mutations.
- Final run started after both explicit BUILDREADY and DAEMONREADY. It replaces the first successful run evidence.

## Geometry and metadata

| Case | Rail CSS top | Settings card top |
| --- | --- | --- |
| Mac app query marker, 520×480 and 1180×480 | 48px | 104px |
| Mac Tauri marker, 520×480 | 48px | 104px |
| Mac browser, 520×480 / 1180×480 | 14px / 18px | 74px |
| Windows app query, 520×480 / 1180×480 | 14px / 18px | 74px |
| Ordinary iPhone platform, 390×844 | 14px | 74px |
| Canonical Mac app, 1180×713 | 150px | 150px |

`native-mac` is present only for Mac plus either app marker in the tested matrix. Both compact native sizes have actual rail bounds at 48px, card max-height 360px (`100dvh - 120px`) and card bottom at 464px. All cards fit horizontally. Every settings card can reach its scroll bottom, expose Advanced settings, close with Escape and close with its close button. The 520×480 native card scrolls 121px to its bottom.

A game project with no settings shows session prefix `12345678`, `opus · Brain override`, `Not reported` provider, and zero tokens, turns and costs. Explicit project model/provider win. A project with configured provider and blank model shows `Provider default`, not the global brain override.

## Visual review

Reviewed `native-query-520-settings.png` and `mobile-390-settings.png` directly. Native-sized settings have clear labels and readable full metadata. The close control is visible at the top. The short native card intentionally scrolls; lower preferences and advanced actions are below the initial fold but reachable. Mobile keeps its previous top spacing and shows the complete card with wrapped session/context values, without horizontal clipping. Disabled OS reduced-motion text is deliberately muted. No blocking readability issue found.

Additional screenshots include 1180×480 native settings and canonical 1180×713 desktop.

## Safety and limits

The harness starts its own temporary `testBackend`. It does not call a live backend. All API reads are deterministic fixture responses. Passive state/log posts are mocked. Every other write and every external request is blocked. Notification, speech and audio APIs are mocked. Only static built resources reach the temporary server. Backend fixture setup creates only temporary fixture data.

The fixture event stream ends without live events, so the displayed Brain row can say Offline; this is not evidence about the live connection. Platform and app markers are browser emulation, not OS certification. No traffic-light overlay was simulated and no native actions were taken. Parent's actual native screenshot is the OS evidence. Existing 18-check margin regression runs separately under parent ownership.

## Fresh regression follow-up

After the final focused pass, the existing margin regression passed **18/18**. Evidence: `output/margin-polish/regression/results.json`; log: `output/margin-polish/margin-regression.log`.

Then `npm run verify` passed (ordinary app verification and review verification). Log: `output/margin-polish/ordinary-verify.log`. These ran sequentially, with no source or existing-test edits. No further browser tests are planned.

## Independent native screenshot review

Reviewed parent-captured files in `output/margin-polish/`:

- `native-minimum-before.png`: traffic lights crowd and overlap the top of the project badge.
- `native-minimum-after.png`: project badge and settings glyph sit clearly below the traffic-light strip. No overlap remains. The same chat excerpt remains visible.
- `native-minimum-settings.png`: card fits inside the 520×480 native window with side and bottom margins. Header and close control are clear. Metadata is readable: Ready, eight-character session prefix, `opus · Brain override`, `Not reported`, and reported context metrics. Lower actions are intentionally below the initial fold; native scroll verification remains with parent.
- `native-canonical-settings.png`: desktop project rail and right glyph rail keep their established placement. Settings card fits vertically, with lower actions visible. Session and context wrap cleanly without clipped text.

No blocking traffic-light, card-fit or readability issue found. This was visual review only; no native actions, tests or source edits were performed by this worker. Parent owns final native scroll, close and window restoration checks.

### Native scroll follow-up

Reviewed `output/margin-polish/native-minimum-settings-scrolled.png`. At 520×480 the native card reaches its lower content: all five preference rows, permission status, and Advanced settings, Model & providers, and Tidy conversation are readable. The three action buttons fit on one row without clipping. Traffic lights remain clear, and the settings gear stays visible while the card header scrolls away. No scroll/readability blocker found.

Parent reports that native input required an explicit in-card wheel event location; no UI change was needed. Parent owns card closure and restoration. The OS clamps requested 713-point (and 714-point) height to 712 points; original position/width can be restored, but exact height restoration must not be claimed.

## Parent closure

Compact gear dismissal was visually confirmed in `native-minimum-dismissed.png`. Final `native-restored.png` confirms the card is closed, the chat and empty composer remain, and the original position/width are restored. macOS clamps height713→712 as recorded above. Backend14561 remains healthy and idle. Both polish workers are stopped.
