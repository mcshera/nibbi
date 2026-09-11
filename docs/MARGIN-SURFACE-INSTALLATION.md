# Installed surface polish

Presentation-only follow-up requested by the user. The warm paper cards are now opaque. Titles and Close controls stay outside the scrollable content. Metadata and preference states have clearer hierarchy. Primary action hover/pressed states remain opaque and readable. Existing action semantics and the original character are unchanged.

Fresh validation: frontend Vite build and UI TypeScript pass;85 unit tests,16 focused surface checks,18 margin regression checks,13 compact regression checks, and ordinary/review verification pass. Exact source/frontend pins and cleanup are recorded under `output/margin-surface/`. Independent visual review is in `MARGIN-SURFACE-QA.md`.

Only the existing native shell is refreshed after a visual empty-draft check and idle health. No backend restart, prompt/provider/account change, dependency install, migration or native binary replacement by this task. A separate approved backend activation changed14561→53164; its ordinary execution completed before this refresh. Its remaining response-quality work is separate.

Native visual/scroll/dismissal verification passed. At520×480 the title and Close remain visible after scrolling to the final actions; the header Close dismisses the card. Original50,29,1180×712 window geometry is restored exactly. See `output/margin-surface/INSTALLED.json` and the separate `native/` screenshot directory. Native keyboard/device/voice/OS-permission certification is not claimed. The earlier polish evidence is historical; this surface pass uses fresh results.
