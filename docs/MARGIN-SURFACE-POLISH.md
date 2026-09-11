# Margin surface polish

User request: polish Nibbi further. This is a presentation-only follow-up, not a new behavior or backend pass.

## Scope

- Opaque warm paper cards, so conversation text does not bleed through.
- Persistent title and Close button outside a keyboard-focusable `.margin-card-scroll` region. Scrollable content includes existing keyed controls and inline errors.
- Clearer metadata hierarchy, readable preference state badges, and quiet hover/pressed feedback without new motion.
- Primary action hover/pressed states keep opaque dark fills and readable text. Ship still requires explicit confirmation; no action semantics change.

Parent owns `public/margins.css` and `public/lib/margin-ui.js` presentation only. Preserve app.js, metadata helper, Pocket code, backend, vault and the separate character lab. No new panel or redesign of the selected5c2/5c1/5c3 direction. Existing native-Mac-only compact clearance and reduced-motion authority stay intact.

QA worker owns only new `tools/margin-surface-verify.mjs` and `docs/MARGIN-SURFACE-QA.md`. It serves actual dist UI statically and intercepts APIs with fixtures, without importing or building the concurrently changing daemon. Wait for one explicit START after source/build freeze. Later ordinary fixture regressions/native refresh coordinate with backend owner. No live mutations or restart by this task.

Evidence lives in `output/margin-surface/`; initial source snapshots are in `before/`. No commit, dependency installation or native binary replacement.

## Verification status

Frontend build, UI typecheck and85 unit tests pass. Focused surface checks16/16, existing margin regressions18/18, compact regressions13/13 and ordinary/review verification pass. Independent visual review passes; no frontend changes remain planned. Current source/frontend hashes are recorded with the reports.

The separate approved backend activation changed PID14561→53164 at2026-09-07T01:34:41Z. This UI task did not restart it. The owner released the native hold after ordinary-chat execution completed. Native shell refresh and live visual/scroll/header-close checks passed; original window geometry restored exactly. See MARGIN-SURFACE-INSTALLATION.md. This is a new user-requested polish task, not a reopening of the earlier completed `improve` goal; no new persistent goal was started.
