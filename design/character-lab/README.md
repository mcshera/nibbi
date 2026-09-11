# Nibbi character lab

**Round 5 (thoughtful — five versions built around attention, deliberation, memory, focus and patience) is in [`round5/`](round5/README.md).** Round 4 (five new motion technologies as toys) is in [`round4/`](round4/README.md); round 3 (raymarched premises around the bead) in [`round3/`](round3/README.md).

**Round 2 (live techniques — particles, soft body, wet-ink filters, brush painting, raymarched bead) is in [`round2/`](round2/README.md).** The owner did not like the five round-1 options below; round 2 changes the technique rather than the style.

Five working options for who Nibbi is and how Nibbi moves — each pairs a **material** with a **motion grammar** — shown side by side at hero, pill and 24 px sizes. **No production files or live app state are changed.** Read [BRIEF.md](BRIEF.md) for the goals, theme, reasoning and recommendation.

## Preview

```sh
cd /Users/Matty/Documents/Nibbi
node design/character-lab/serve.mjs
```

Open **http://127.0.0.1:4538/design/character-lab/** and press **Play the tour** (or `t`). Look at the **chat strip** (24 px avatars beside 14 px text) before the big stages. Keys `1`–`9` cue a moment, `space` pauses, `←`/`→` scrub while paused. Energy, speed, reduced motion, tinted fixer and loop are in the cue bar. Shortlisting is browser-local only. If the port is busy: `NIBBI_CHARACTER_PORT=4539 node design/character-lab/serve.mjs`.

| | Option | Material | Grammar |
|---|---|---|---|
| 01 | **Inkdrop** | wet ink from a nib, bleed halo, crown peak | wet weight: lean → pour → settle, landing ring soaks in |
| 02 | **Sumi stroke** | one brush stroke: wet head, dry-brush tail | redrawn, not moved: lift and re-lay each gesture |
| 03 | **Paper cutout** | torn black paper with fringe and a layer shadow | 12 fps stop-motion, replacement poses, hand jitter |
| 04 | **Sketch line** | pen contour with bottom-up hatching | drawn-on transitions with a subtle line boil |
| 05 | **Typesetter** | a blot set as type on a baseline | hard cuts; poses quote punctuation (, … ! * —) |

The current app character is linked from the masthead (`../motion-lab/baseline.html`) for reference.

## Evidence

- [`evidence/matrix.png`](evidence/matrix.png) — five options × nine moments at each option's declared signature still (`stillAt`), hero and 24 px. [`matrix-reduced.png`](evidence/matrix-reduced.png) — the same as static reduced-motion expressions.
- [`REVIEW.md`](REVIEW.md) — independent design review of the first version; BRIEF §9 lists what was fixed in response.
- `evidence/sheet-<id>.png` — one option, nine moments × five times, plus pill and chat-row sizes. `sheet-<id>-reduced.png` where present.
- `evidence/lab-desktop.png`, `lab-mobile.png`, `lab-reduced.png` — the lab itself.
- `evidence/browser-results.json` — geometry sweep, reduced-motion pixel identity, quiet-idle drift, legibility (pairwise still differences normalised to ink area, normal and reduced, 24 px and hero), control checks.

## Reproduce checks

Uses the repo's installed Node and Playwright with local Google Chrome (bundled Chromium in CI). No server needs to be running; the tools start a private loopback server on an ephemeral port.

```sh
node design/character-lab/options.test.mjs                 # contract checks for all five (or pass ids)
node design/character-lab/verify.mjs                       # browser checks + lab screenshots + results JSON
node design/character-lab/sheet.mjs inkdrop                # per-option sheet → evidence/sheet-inkdrop.png (add --reduced, --energy=1.5, --tint=#7a4b2a)
node design/character-lab/sheet.mjs inkdrop sumi cutout sketch glyph --matrix   # the overview matrix at each option's signature still (add --frac=.7 to force one fraction, --reduced)
```

## Files and limits

`actions.mjs` is the shared state vocabulary and sizes. `ink.mjs` holds deterministic Canvas2D helpers (noise, blob, fuzzy fill, eyes, brush, pen, hatch, torn edge, bleed ring). `options/<id>.mjs` are the five standalone modules following [CONTRACT.md](CONTRACT.md); `options/_template.mjs` is the starting shape. `lab.mjs` drives one clock and the deterministic `window.characterLab.seek()` API used by `verify.mjs`.

These are Canvas2D design prototypes, not the production WebGL renderer. Smooth sampled motion here does not establish real-device performance, Safari/WKWebView behaviour, or how the options feel next to a live conversation. The 1–5 scores in the brief are the author's reading of the sheets; the measured legibility rows come from `verify.mjs`. Neither is user research — the brief proposes a five-person naming test before any integration.
