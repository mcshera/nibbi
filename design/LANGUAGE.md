# Nibbi — design language

Read 2026-09-21 out of the shipped surface, not invented over it. Every rule below is either **observed** (the code already does this consistently — the rule just names it) or **proposed** (the code is inconsistent here — the rule picks the winner and says what it costs to adopt). Nothing is aspirational. Where a rule came from outside, the source is linked.

Companion file: **`public/tokens.css`** — the same system as custom properties, 127 of them, linked ahead of `styles.css` in `public/index.html` and therefore live. The drift register in §15 has been applied: every literal in `public/*.css` that the register named now reads a token.

**A caution this document earned.** Several claims in the first draft were read out of the CSS without checking what the running app actually renders, and three of them were wrong: the "missing" empty states exist, the "missing" pending states exist, and the touch-reachability gap was one control rather than several. Worse, a whole section of CSS — `.status`, `.project`, `.pmenu`, `.plabel`, 45 lines — described a shell that the workspace rail replaced and that nothing constructs any more; this document had been documenting it as live. Those entries are corrected below and the dead CSS is deleted. **Check a claim against the DOM before writing it down here.**

## Status

| layer | state | where |
|---|---|---|
| character | shipped, contracted | `design/character-lab/CONTRACT.md`, `public/nibbi.js` |
| motion / poses | shipped, contracted | `public/pocket-motion.js`, 24 poses, 8 moods |
| voice / copy | shipped, contracted | `docs/PERSONALITY.md` |
| sidebar shape | in lab | `design/sidebar-lab/` |
| **colour, type, space, shape, elevation** | **shipped, contracted** | this document + `public/tokens.css` |

That last row was the gap. Nibbi had a design language — legible in every file and genuinely good — but it lived as convention in 1,101 lines of CSS rather than as a system (1,050 now, after the dead shell came out). It was not visible as ugliness; it was visible as **drift**: the same intent rendered slightly differently depending on which file you were in when you wrote it.

Measured before and after applying §15:

| dimension | before | after | target |
|---|---|---|---|
| font-size literals | 20 distinct | **0** | tokens only |
| border-radius literals | 15 distinct | **1** (`30px`, the phone dock) | tokens only |
| hex colours | 45 distinct | **5** | see below |
| ink-veil alphas | 25 distinct | **1** (a zero-size shadow that draws nothing) | tokens only |
| z-index literals | 12 anonymous | **2** (both in a local stacking context, deliberately) | named rungs only |
| backdrop blur literals | 6 distinct | **0** | tokens only |
| custom properties declared | 16 | **127** | — |
| dead pre-rail CSS | 45 lines | **0** | — |

The five surviving hexes are all legitimate: `#151413`, `#383633` and `#5f5c57` as `var(--ink, …)` fallbacks (kept in step with the ramp), `#000` inside a `mask-image` gradient — a mask channel, not a colour — and `#fff` once on the QR code, which must be true white to scan.

Verified after the change: `npm run build` green, `npm run test:unit` 221/221, `npm run verify` — the contrast contract plus both fixture-backed browser regression suites pass.

---

## 1. Principles

These are read back out of the code and `docs/PERSONALITY.md`. They are the reason the rest of the document is shaped as it is.

1. **Ink on paper, and it has to be earned.** One material, monochrome by default. Colour appears only where a machine fact needs a machine colour — a diff line, a failure, a passing check. If a colour is decorative, it is wrong.
2. **The tenth message is the design target, not the first.** From `docs/IMPROVEMENT-PLAN.md`: the character yields to the conversation. Every surface that competes with reading loses.
3. **Quiet until it matters.** `.meta` is `opacity: 0` until hover; the whole feed drops to `.38` at rest and comes back on hover or focus; an agent's card stays closed until you point at it or pin it. The system withholds chrome and returns it on intent. This is the single most characteristic move in the codebase and it should be applied to anything new — with §12's rule attached, that withheld does not mean stranded.
4. **State is spoken, not signalled.** From the sidebar lab: *"Leave the status dots — Nibbi says attention in words."* Dots carry presence and rhythm; words carry meaning.
5. **Nothing animates to entertain.** Motion exists to explain where something came from (`arrive`), that work is live (`think`, `pulse`), or that a control took the press (`scale(.96)`). The character is the only element allowed expressive motion, and it is contracted separately.
6. **Every control is reachable by keyboard and 44px under a finger.** Already enforced at `≤640px` and `pointer: coarse`. Non-negotiable for new work.
7. **A surface that cannot verify its backdrop must carry contrast alone.** The glass budget at `public/styles.css:373` is the model: assume the worst backdrop, measure, and let the native material be a bonus.

---

## 2. Paper and ink — colour

### 2.1 The material

Two substances. **Paper** is warm, slightly yellow, never white. **Ink** is warm near-black, never `#000`.

| token | value | role | observed |
|---|---|---|---|
| `--paper` | `#f5f2ec` | the page | ✅ |
| `--paper-raised` | `#faf8f3` | menus, panels, cards — paper lifted off the page | merged from `#faf8f4` |
| `--paper-sunken` | `#fbfaf7` | diff bodies, file wells — paper pressed in | ✅ |
| `--paper-bar` | `#ece8e0` | the workspace sidebar; the only surface darker than the page | ✅ |
| `--ink` | `#151413` | primary text, filled controls, the character | ✅ |
| `--ink-2` | `#383633` | secondary text, body copy in dense surfaces | derived, §2.5 |
| `--ink-3` | `#5f5c57` | muted — labels, timestamps, counts | derived, §2.5 |
| `--ink-4` | `#8a857d` | faintest — step dots at rest, hunk headers, disabled marks | derived, §2.5 |
| `--ink-inverse` | `#f5f2ec` | text on filled ink (toast, hovered chip, ship segment) | merged from `#f5f2ea` and `#fff` |
| `--ink-terminal` | `#1b1a18` | code blocks and run logs — ink as a *surface*, not as text | ✅ |
| `--ink-terminal-fg` | `#ece8df` | paper on that surface | ✅ |
| `--ink-faint` | `#c9c4bb` | a dot at rest — presence without state | merged from `#cfcac1` |
| `--ink-scroll` | `#bcb7af` | scrollbar thumbs | ✅ |

**Rule.** `#000` and `#fff` do not appear in Nibbi except inside the QR code (`.phonev .qr`, which must be true white to scan) and in the two `mask-image` gradients, where `#000` is a mask channel rather than a colour. There are no other exceptions.

### 2.2 The ink veil

Translucent ink over paper is how Nibbi builds every hover, well and hairline. There were **25 distinct alphas** of `rgba(21,20,19,…)`; they are now seven:

| token | alpha | role |
|---|---|---|
| `--veil-hairline` | `.10` | `--line`, every border |
| `--veil-well` | `.04` | a recessed field (`.rsum`, `.sin`) |
| `--veil-hover` | `.06` | the standard hover wash — the most-used value in the codebase (10×) |
| `--veil-press` | `.12` | active state |
| `--veil-edge` | `.16` | a border that must be seen (`.planr`, focused pill) |
| `--veil-strong` | `.22` | a border that must be *read* (review turn, playtest pill) |
| `--veil-solid` | `.92` | filled ink at rest under glass (toast, hovered chip, armed) |

Plus one outlier kept as its own token: `--veil-outline` (`.50`), the drawn ring on the composer's `+`, which is an outline rather than a wash.

The values between (`.03`, `.035`, `.045`, `.05`, `.055`, `.065`, `.07`, `.075`, `.08`, `.085`, `.09`, `.13`, `.14`, `.18`, `.20`) were 40-odd uses that each land within `.02` of one of the seven — except `.28`, a hovered button border, which moved `.06` to `--veil-strong` and is imperceptible at 1px. Merging them removed the whole class of "which grey was that".

### 2.2b Opaque beds

The veil is ink *over* a surface. On a control that already sits on a raised card, a second translucent layer reads as muddy rather than as pressed, so those states are opaque. This family was entirely undocumented and had drifted into eight near-identical warm greys across two files:

| token | value | role |
|---|---|---|
| `--bed` | `#fffdfa` | a control at rest on a card |
| `--bed-hover` | `#efebe4` | merged from `#e9e5dd` |
| `--bed-press` | `#e5dfd5` | merged from `#d9d4ca` |
| `--ink-bed-hover` | `#35322d` | the same two states on a filled-ink control; merged from `#39352f` |
| `--ink-bed-press` | `#080807` | |
| `--notice-bed` | `#efe8dc` | a warm bed for a notice or confirmation; merged from `#eee7dc` |
| `--field-edge` | `#c3beb4` | an input border, which must be seen on paper; merged from `#aaa49a` |
| `--selection` | `#ded5c6` | `::selection` |

**Rule.** Reach for a veil first. Use a bed only when the control sits on `--paper-raised` or on filled ink, where a veil would compound.

### 2.2c The paper wash

The veil is ink over paper. The other direction — translucent *paper* over paper — is how the bar lifts a control off its darker ground without a shadow, and it had seven alphas and no name for any of them (`.30`, `.38`, `.42`, `.55`, `.72`, `.78`, plus `.24`/`.46` in `platform.css`). Four steps, mirroring the veil:

| token | alpha | role |
|---|---|---|
| `--wash-faint` | `.28` | under glass, where the surface is already translucent |
| `--wash-rest` | `.42` | a control at rest on the bar |
| `--wash-field` | `.56` | an input on a card |
| `--wash-hover` | `.74` | either of those, hovered |

Three of the merges move more than the `.02` the veil merges stayed inside (`.38`, `.55`, `.78`), so they are worth a look by eye; none is more than `.04`.

**Rule.** White over *ink* is a different family and keeps its own values: the copy button on a code block, the toast's inner button, the lit-from-above vignette. Those are not washes and must not be tokenised as though they were.

The reply's own surface is a surface, not a wash, and is declared with the translucent paper: `--bubble-bg` (`.62`) and `--bubble-bg-quiet` (`.45`, an event that was not said to you). Both are now measured — see §2.5.

### 2.3 Semantic colour — the biggest drift in the system

Colour means *machine verdict*. There are exactly two verdicts, and they currently have **four reds and two greens** depending on which file you were editing:

| meaning | current values | used in |
|---|---|---|
| fail / removed | `#b5533d`, `#9a3f2c`, `#7a3a2e`, `#873f35`, `#743b2f`, `#65432c` | `styles.css` uses the first three, `project-workspace.css` and `margins.css` use `#873f35` |
| pass / added | `#2f6b3a`, `#365342` | `styles.css` vs `project-workspace.css` |

Proposed ramp — one per verdict, three roles each:

| token | value | role |
|---|---|---|
| `--fail-mark` | `#b5533d` | the dot, the bar, the fill — colour as object |
| `--fail-text` | `#9a3f2c` | failure text on paper |
| `--fail-quiet` | `#7a3a2e` | failure prose, longer than a phrase |
| `--fail-wash` | `rgba(181,83,61,.10)` | the background behind a removed line |
| `--fail-edge` | `rgba(181,83,61,.35)` | a failure border |
| `--pass-text` | `#2f6b3a` | success text, added lines |
| `--pass-wash` | `rgba(76,140,86,.10)` | the background behind an added line |
| `--pass-edge` | `rgba(76,140,86,.40)` | a success border |

`#873f35`, `#743b2f`, `#65432c`, `#365342` retire into these. The three that survive in `styles.css` are the ones with measured contrast behind them; the workspace variants were picked independently and are the ones to drop.

**Rule.** There is no warning colour and no info colour. A warning is a `--fail-edge` border with ink text (`.chip.warn`, `.planr .prwarn` already do this). Info is ink. Adding an amber or a blue would break principle 1.

**Default.** A workspace notice with no kind is ink — `--ink-2` on `--notice-bed` — because "Confirm this build action below." is information, not a verdict; only `data-kind="error"` wears `--fail-text`. (`data-kind="success"` keeps `--pass-text` for now: "Saved." is not a verdict either, and that one is the owner's call.) A verdict wears one colour everywhere it is shown: Failed is `--fail-text` in the desktop queue and in the phone list alike.

### 2.4 Agent tint

The character accepts a tint (`u_tint`, `u_tintAmt` in `public/nibbi.js`) to render companion fixers as coloured ink. This is the **only** place chromatic colour is licensed, because it is identity, not status. Tints are assigned per fixer and carry no meaning beyond "which one".

**Rule.** A tint never appears outside the character. A fixer's colour must not leak into its card, its chip, or its text — those stay ink, and the card is identified by name.

### 2.5 Contrast contract — the derived ramp

The ramp is **computed, not picked**. `tools/contrast-verify.mjs` recomputes it from `public/tokens.css` on every `npm run verify` and fails if a step stops clearing its band, so it cannot drift back into hand-chosen values.

**Construction.** Constant OKLCH hue **78**, chroma **C = 0.024L − 0.002** (the relation the old values already followed), even lightness steps of **0.142**. `--ink` is pinned at `#151413` because it is the character's ink, not a text-only value; the other three are solved.

**Bands.** [APCA](https://www.myndex.com/APCA/) Lc, not WCAG 2 ratios — Nibbi is dark-warm ink on light-warm, often translucent paper, which is precisely where WCAG 2's ratio misreports. Lc 90 is the preferred body-text level, 75 the body-text minimum, 60 supporting text, 45 large or text-like marks, 30 the absolute floor.

| token | band | page | raised | sunken | bar | glass paper | glass pill/chip |
|---|---|---|---|---|---|---|---|
| `--ink` | 90 / 75 glass | 97 | 101 | 102 | 92 | 78 | 81 |
| `--ink-2` | 75 / 65 glass | 90 | 93 | 95 | 84 | 70 | 73 |
| `--ink-3` | 65 / 55 glass | 75 | 79 | 80 | 69 | 56 | 58 |
| `--ink-4` | 45 / 35 glass | 57 | 60 | 61 | 51 | 37 | 40 |

`tools/contrast-verify.mjs` measures ten surfaces: the four opaque papers, the three glass composites, and — added when the wash family was named — the reply bubble on paper, the reply bubble under glass, and the notice bed. The bubble was the one text-bearing surface nobody had measured, and it turns out to be the most legible in the app (Lc 102 on paper, Lc 94 under glass), which is right for the thing you are there to read.

The glass column runs **one band below** the opaque budget. That is the deal a deliberately translucent surface makes, and stating it is better than quietly failing the opaque budget, which is what was happening.

**What the rebuild found.**

1. **The old ramp was not a ramp.** Hue drifted 67.7 → 82.4 across the four values and the lightness steps were 0.150 / 0.188 / 0.088 — the gap between `--ink-3` and `--ink-4` was half the gap above it. Constant hue and even steps fix both.
2. **The bar fork was unnecessary, and also correct.** WCAG 2 said `#6f6b65` was 4.33:1 on `#ece8e0` and forked it to `#5f5b55`. The derived `--ink-3` is `#5f5c57` — within **0.003** OKLCH lightness of that fork. The fork had been the right value all along; the ramp had simply never adopted it. One value now serves page, raised paper and bar.
3. **The glass surface could not be fixed by ink at all.** At `--paper` alpha `.78` over a black desktop the composite is `rgb(191,189,184)`, where **pure black tops out at Lc 68** — the Lc 75 body-text band was unreachable by *any* colour. The old `#4f4b46` fork darkened the muted step while primary text sat at Lc 67, below body-text level, and the WCAG-based budget never noticed. **The fix was more paper, not darker ink:** `.86` is the lowest alpha at which the whole ramp clears, so `--paper`, `--pill-bg` and `--chip-bg` under `.glass` all moved to `.86`, and both ink forks retired.
4. **A stale figure in the old budget.** The comment at the glass block claimed `#151413` measured 13.4:1 over the composite. It is 9.8:1. Nothing was broken by it — the value passes either way — but it was the number the budget was being justified with.

**What visibly changed.** `--ink-2` moved 0.8% in lightness and `--ink-4` by one hex digit; both are invisible. `--ink-3` darkened 5.4% (`#6f6b65` → `#5f5c57`, 4.74:1 → 5.96:1 on paper) — every muted label, timestamp and count is slightly firmer, matching what the workspace bar already showed. And the desktop shell is less translucent at `.86` than at `.78`.

**Still open.** The glass budget is measured against a pure-black desktop wallpaper and deliberately ignores the native Liquid Glass tint, because the surface cannot verify the material is present. That is conservative by design; real backdrops read higher. If that assumption is ever relaxed, `.78` becomes viable again and `tools/contrast-verify.mjs` is where the new floor goes.

### 2.6 Dark

There is none, and that is currently correct: the character is ink on paper, and inverting it makes it a different creature. If it is ever wanted, it is a **separate material**, not an inverted palette — the character's shader, the paper grain and the glass budget all have to be redesigned together. Do not ship a `prefers-color-scheme` block that only swaps the token values.

---

## 3. Type

### 3.1 Families

| family | use |
|---|---|
| `Geist` (variable, 100–900) | everything |
| `Geist Mono` (variable) | machine text only: commands, paths, tool names, diffs, logs, run output, tails, cost figures |

**Rule.** Mono is a semantic, not a style. If the string came from a machine or must be typed back exactly, it is mono. Otherwise it is Geist, no exceptions.

### 3.2 Scale

20 sizes today, unevenly spaced. Proposed 10-step scale, chosen so that every existing literal moves ≤1px (except the heading cluster, noted):

| token | px | role | absorbs |
|---|---|---|---|
| `--type-micro` | 10.5 | uppercase labels, `.06em` tracking | 10 |
| `--type-meta` | 11.5 | counts, card metadata, tails | 11 |
| `--type-fine` | 12 | timestamps, step detail, mono detail | 12.5 |
| `--type-control` | 13 | chips, menu rows, buttons | 13.5 |
| `--type-body` | 14.5 | your message, card body, dense prose | 14, 15 |
| `--type-base` | 16 | root, phone reply | — |
| `--type-read` | 17 | Nibbi's reply — the one thing meant to be *read* | — |
| `--type-field` | 19 | the composer | 18 |
| `--type-title` | 21 | panel headings | 20, 22, 23 (Δ2 — check by eye) |
| `--type-display` | 26 | the one display size | — |

**Rule.** The reply is the largest text on screen that is not a heading. Nothing new may exceed `--type-read` without also being a heading.

### 3.3 Weight, tracking, numerics

- Weights used: 500 (mono emphasis, menu rows, the next milestone), 600 (headings, names, `.meta` buttons), inherit otherwise. **No 700.** Ink is dark enough that 600 reads as bold.
- Tracking: `-.035em` on `--type-title` only. `+.06em` with `text-transform: uppercase` on `--type-micro` only. Body text is never tracked.
- **`font-variant-numeric: tabular-nums` on every number that can change in place** — timers, counts, costs, percentages. Already applied in 8 places; this is a rule, not a habit. Any new count must carry it or it will jitter.

### 3.4 Fluid

Everything above is fixed px, and Nibbi runs on three surfaces: a browser window, a Tauri window over glass, and a paired phone. The only current response is a `≤640px` block that overrides six values by hand.

**Done, and smaller than it first looked.** Auditing the `≤640px` block showed it is almost entirely *layout* — safe-area insets, 44px targets, flex-wrap, the attachment row. Exactly **two** steps differed by viewport, and both are now fluid, interpolating between a 390px and a 1440px viewport with no step change at any width:

| token | 390px | 834px | 1440px |
|---|---|---|---|
| `--type-read` | 16px | 16.4px | 17px |
| `--type-field` | 17px | 17.85px | 19px |

Every other step stays fixed on purpose: they are small UI text, and shrinking those on a phone costs legibility for no layout gain. A full [Utopia](https://utopia.fyi/)-style scale across all ten steps would be change for its own sake here.

---

## 4. Space

### 4.1 Grid

**4px base, 2px half-step.** The real distribution already agrees: `8px` (79 uses), `6px` (56), `10px` (36), `12px` (35), `4px` (31), `2px` (26), `16px` (22).

| token | px | role |
|---|---|---|
| `--space-0` | 2 | hairline gaps, badge padding |
| `--space-1` | 4 | icon-to-label in dense rows |
| `--space-2` | 6 | chip gaps, tight stacks |
| `--space-3` | 8 | **the default gap** |
| `--space-4` | 10 | control padding |
| `--space-5` | 12 | card padding, comfortable gaps |
| `--space-6` | 16 | section padding |
| `--space-7` | 20 | page edges |
| `--space-8` | 24 | panel padding |
| `--space-9` | 32 | rare, large separation |

### 4.2 The odd values

`3, 5, 7, 9, 11, 14, 18, 22, 26, 28, 34, 36, 48` — 45 uses. Most are optical: a 7px dot centred against 13px text, `padding: 0 3px` on a 58px avatar. These are legitimate.

**Rule.** An off-grid value is allowed only for optical alignment of a round or irregular object, and must carry a comment saying so. The codebase already writes comments at exactly this standard (`styles.css` has 30+ explanatory comments); this just makes it required for one case.

### 4.3 Layout constants

| token | value | role |
|---|---|---|
| `--measure-feed` | `min(680px, 100vw - 48px)` | the conversation column |
| `--measure-wide` | `min(980px, 100vw - 48px)` | widened when a diff leads (`≥1400px`) |
| `--measure-dock` | `min(720px, 100vw - 56px)` | composer and chips |
| `--measure-panel` | `min(760px, 100vw - 28px)` | platform dialogs |
| `--measure-card` | `304px` | margin cards |
| `--measure-menu` | `248px` | the dock panel |
| `--sidebar-width` | `256px` | the docked bar; `--sidebar-width-narrow` is the drawer below 900px |
| `--pill-h` | `72px` → `60px` ≤640px | composer height |
| `--feed-top` | `40vh` | where the conversation starts under the character |
| `--feed-bottom` | `140px` | where it stops above the composer |

**Rule.** `--feed-bottom` is tracked by `.chips` and `.jump` via `calc()`. Anything new that sits above the composer must track it too — a fixed offset broke this once already (see the comment at the end of the `≤640px` block).

---

## 5. Shape

### 5.1 Radius ladder

15 radii today. Eight, with a meaning each:

| token | px | meaning | absorbs |
|---|---|---|---|
| `--r-bar` | 2 | progress bars, the steer dot | 3 |
| `--r-inline` | 6 | inline code, tiny badges, avatars in text | 4 |
| `--r-well` | 8 | a recessed strip inside a card | 9 |
| `--r-control` | 10 | menu rows, thumbnails, small wells | — |
| `--r-card` | 12 | code blocks, images, cards, diff bodies | — |
| `--r-panel` | 14 | the send squircle, margin cards, agent cards | — |
| `--r-surface` | 18 | palettes, dialogs, the dock panel | 16, 20 |
| `--r-pill` | 999 | anything that reads as a token or a lozenge | — |
| `--r-dock` | 40 / 30 | the composer only, responsive | — |

### 5.2 Shape vocabulary

Four shapes carry meaning, and they are not interchangeable:

| shape | means | examples |
|---|---|---|
| **circle** | a living thing or its state | the character, agent avatars, status dot, step dots, project dot, the `+` ring |
| **pill** (`999`) | a thing you can say or do — a token of language | chips, segments, the composer, the toast, state badges |
| **squircle** (`10–18`) | a surface that holds content | cards, menus, panels, code blocks |
| **bar** (`2`) | quantity | plan bars, progress |

**Rule.** Do not put a chip in a squircle or a card in a pill. This vocabulary is consistent across all four CSS files today and is one of the reasons the surface feels coherent.

### 5.3 The bubble

Nibbi's reply bubble is the signature: `border-radius: 18px` with `border-top-left-radius: 10px`, a 6px ink dot at `7px, 7px`, no avatar and no tail. Your message is the mirror: `18px 18px 6px 18px`, ink wash, no dot. This asymmetry is the whole speaker system — there is no name, no avatar and no colour doing that work.

**Rule.** Never add an avatar to the bubble. The dot *is* the avatar. When a steps fold is present the dot is suppressed, because the fold's own bullet occupies the same corner — one mark, not two. That rule is already enforced by `:has()` and must survive any refactor.

---

## 6. Elevation

### 6.1 The formula

Every shadow in the codebase, whether or not it was written deliberately, obeys the same shape: **warm ink, y-offset `n`, blur `≈2.5n`, spread `≈-0.6×blur`, alpha `.25–.34`**, plus a `0 1px 0 rgba(255,255,255,.7) inset` paper highlight on anything that reads as lifted paper. Naming it:

| token | value | used by |
|---|---|---|
| `--e-seated` | `0 1px 2px rgba(21,20,19,.12)` | the on-segment in a segmented control |
| `--e-raised` | `0 8px 24px -18px rgba(21,20,19,.25)` | the reply bubble |
| `--e-floating` | `0 10px 30px -12px rgba(21,20,19,.25)` | status menu, project menu, agent card |
| `--e-docked` | `0 12px 34px -18px rgba(21,20,19,.28)` | the composer, the dock panel, the palette |
| `--e-lifted` | `0 16px 36px -20px rgba(21,20,19,.28), 0 3px 8px -5px rgba(21,20,19,.14)` | margin cards, switch menu |
| `--e-dialog` | `0 20px 60px -24px rgba(21,20,19,.30)` | platform panels |
| `--e-highlight` | `0 1px 0 rgba(255,255,255,.7) inset` | additive, on every lifted paper surface |

⚠️ The toast is the one shadow using `rgba(0,0,0,.4)` instead of ink. It should be `--e-floating` at ink.

### 6.2 Blur ladder

| token | px | role |
|---|---|---|
| `--blur-scrim` | 3 | behind a modal backdrop |
| `--blur-light` | 10 | chips, jump — small floating tokens |
| `--blur-glass` | 14 | **the standard**: composer, menus, cards, palette |
| `--blur-heavy` | 16 | the Tauri glass shell |

`12px` and `18px` are one use each and fold into 14 and 16. Every blur is paired with `saturate(1.1)` — that pairing is what keeps the paper warm behind glass and should be part of the token.

### 6.3 Layers

Twelve numeric z-indexes with no names. Eight named layers, in order:

| token | z | occupant |
|---|---|---|
| `--z-vignette` | 0 | the lit-from-above wash on `body::before` |
| `--z-character` | 1–2 | `canvas#ink`, then `canvas#fx` |
| `--z-feed` | 3 | the conversation |
| `--z-perch` | 5 | chips, agents, jump — things that sit on the composer's shoulder |
| `--z-dock` | 6 | composer, status, project label |
| `--z-transient` | 7 | toasts |
| `--z-overlay` | 8 | palette, and the composer while its panel is open |
| `--z-sheet` | 9–12 | margin card, switch menu, sidebar backdrop, sidebar |

**Rule.** The comment at `.pill.dock-open` — *"an open panel paints over transient toasts (z 7) so every row stays clickable"* — is the kind of reasoning that has to be recoverable. Named layers make it recoverable; `z-index: 8` does not.

---

## 7. Motion

### 7.1 Tokens

| token | value | role |
|---|---|---|
| `--ease` | `cubic-bezier(.2,.7,.2,1)` | the only easing curve in the system |
| `--t1` | 120ms | colour, background, small state |
| `--t2` | 220ms | entrances, exits, hover reveals |
| `--t3` | 420ms | layout — the feed moving, the composer resizing |

Three durations, one curve, applied consistently across every file. **This is the strongest part of the existing system.** Leave it alone.

### 7.2 The three motions

| animation | what it says |
|---|---|
| `arrive` — `translateY(10px)` + fade, `--t3` | this is new, and it came from below |
| `leave` — `translateY(8px)` + fade, `--t2` | this is gone; faster than arriving |
| `pulse` / `think` — scale + opacity, 1.1–1.4s loop | work is happening right now |

**Rule.** New UI uses one of these three or it does not animate. A fourth animation needs a fourth thing to say.

### 7.3 Press feedback

`scale(1.05)` on hover, `scale(.96)` on active, `--t1`, `--ease`. On the send button only. Extend to any new primary action; never to secondary ones.

### 7.4 Reduced motion

Global kill switch at `styles.css:211` (`1ms !important` on everything), plus JS-side handling in `nibbi.js` and `pocket-motion.js` (`reduced=true` returns a *spatially static pose*, not a frozen frame). The character contract requires a reduced expression per action that is identical for every `t` — this is better than most shipped products and should be held to for anything new.

The kill switch also sets `animation-iteration-count: 1`: at 1ms an infinite `think` or `pulse` does not stand still, it flickers, so every loop now plays once and lands on its base frame. The same block applies under `body.calm`, which `syncMotionPreference` sets whenever the system asks for reduced motion or Calm motion is on — the in-app preference used to reach only the character.

### 7.5 Where to take motion next

The curve `cubic-bezier(.2,.7,.2,1)` was chosen once and never compared. [Easing Wizard](https://easingwizard.com/) generates and diffs spring-derived curves; [Devouring Details](https://devouringdetails.com/) is the closest published work to the standard `pocket-motion.js` already holds. Neither implies adopting a library — `pocket-motion.js` is analytic, dependency-free, and better than what a library would give.

One concrete gap: **numbers that change in place snap**. The GitHub build counts in `public/lib/github-ui.js`, fixer costs, plan percentages. [NumberFlow](https://number-flow.barvian.me/) is the reference implementation; verify it ships a framework-free build before adopting, or copy the technique — the animation is a masked digit column.

---

## 8. The character

Contracted in `design/character-lab/CONTRACT.md`. Summarised here because the rest of the language has to live beside it.

- **Material:** ink on cream paper, monochrome, WebGL raymarch with a Canvas2D fx pass. `tint` swaps the ink colour and nothing else. No gradient may read as glossy plastic.
- **Rig:** `x, lift, sx, sy, rotate, eyeX, eyeY, blink, wide, happy, phase`, foot-anchored, R units, lift positive up.
- **Sizes:** `hero`, `pill` (R≈26), `tiny` (R≈12). At pill and tiny, fine detail — halos, hatching, bristles, specks — drops and eyes stay legible.
- **Moods:** 8 (`idle, listening, thinking, working, speaking, happy, error, sleep`), each with breath rate, boil rate, lid position, gaze bias, blink gap and drip timing.
- **Poses:** 24 one-shots in 6 groups (Greetings, Bounces, Shape tricks, Delight, Attention, Rest/reaction), 1.25s–3.8s.

**Rule.** The character is the only element in Nibbi permitted personality in its motion. Everything else gets `arrive`, `leave`, `pulse`. This is what keeps it a character rather than a theme.

**Rule.** The character never blocks reading. `--feed-top: 40vh` exists to hold it above the conversation; at the tenth message it has already yielded.

---

## 9. Components

The parts vocabulary as it stands. A new surface should be assembled from these before a new one is invented.

| part | shape | type | elevation | rule |
|---|---|---|---|---|
| **bubble** | `18px`/`10px` TL, 6px ink dot | `--type-read` | `--e-raised` | never gets an avatar; a page-width block card at every length, so it never changes width mid-reply — your message is the one that shrink-wraps. The caret takes a line of its own under a trailing fence, quote, table or rule |
| **your message** | `18 18 6 18`, `--veil-hover` | `--type-body` | none | right-aligned, max 78% |
| **chip** | pill, `--veil-hairline` border | `--type-control` | none, `--blur-light` | hover inverts to solid ink; `.warn` takes `--fail-edge` |
| **step** | row, 7px dot | `--type-fine` | none | dot state: live=ink+pulse, done=`--ink-3` at `scale(.75)`, fail=`--fail-mark` |
| **steps fold** | one row | `--type-fine` | none | folds the whole list when complete and moves above it; a toggle (`— show` / `— hide`, `aria-expanded`) that stays in place while the list opens under it, so focus never leaves it. It changes attributes only (CSS picks the word): a text change re-pins the feed and moves it. An older transcript's summary-only row is a plain line |
| **composer (pill)** | `--r-dock` | `--type-field` | `--e-docked` + `--e-highlight` | `+` left, send squircle right; both drop to the last line when tall |
| **dock panel** | `--r-surface` | `--type-control` | `--e-docked` | rows are 44px minimum |
| **menu** (switch, dock) | `--r-surface` | `--type-fine`/`--type-control` | `--e-floating` | opens on hover *and* focus-within |
| **palette** | `--r-surface` | `--type-control`, mono for the command | `--e-docked` | command mono, argument mono muted, description right-aligned and truncated |
| **agent** | 58×46 avatar, tinted character | — | — | card on hover/focus/pinned, 260px, fixed-positioned on phones |
| **toast** | pill, solid ink | `--type-control` | `--e-floating` ⚠️ currently black | z below an open dock panel |
| **diff** | `--r-card` wells, mono | `--type-fine` | none | `--pass-*` added, `--fail-*` removed, per-file `<details>` |
| **plan review** | `--r-panel`, `--veil-edge` border | `--type-body` | none | state badge is `--type-micro` uppercase in a pill |
| **margin card** | `--r-panel`, `--measure-card` | `--type-fine` | `--e-lifted` | no ink fork: the derived ramp serves the bar (§2.5) |
| **notice bubble** | the bubble on `--notice-bed`, `--veil-strong` border, `--ink-3` dot | `--type-read` | `--e-raised` | something was unreachable, not judged |
| **platform panel** | `--r-surface`, `760px` | `--type-body` | `--e-dialog` | `::backdrop` is `--veil-edge` + `--blur-scrim` |
| **jump to latest** | pill | `--type-fine` | `--e-floating` | tracks `--feed-bottom` |
| **day divider** | rule + label | `--type-meta` | none | 40px hairlines either side |

### Missing parts

Checked against the running app rather than inferred from the CSS, which corrected two earlier entries here:

1. ~~No empty states.~~ **Wrong — the rail has them**, and they are well written: `No projects yet`, `Nothing is open`, `Nothing is queued`, `Nothing merged yet today`, `No plan written yet`. What is missing is only that they are ad-hoc strings rather than a shared part, so a new surface has nothing to reach for.
2. ~~No pending state.~~ **Wrong — loading states exist**, as text (`.project-loading`, `aria-busy`, `Loading…`). They are not skeletons, which is a stylistic choice rather than a gap.
3. ~~An inline error that is not a failure.~~ **Built.** `errorKind()` in `public/lib/text.js` separates a machine verdict from a machine being unreachable, and the notice bubble in §9 is what the second one wears. `--fail-*` is once again only ever a verdict.

---

## 10. Body states

Nibbi drives most of its UI from `body` attributes and classes. The full set, because it is not documented anywhere else:

| hook | set by | effect |
|---|---|---|
| `data-mode="talk"` | app | reveals the feed |
| `data-link="busy\|demo\|offline\|booting"` | gateway | it has a home again: the bar's foot says `Offline — nothing is reaching the gateway` while the link is down, and nothing while it is up |
| `.rest` | idle timer | feed drops to `.38` opacity, restores on hover |
| `.busy` | a turn running | composer border softens, send becomes a stop square |
| `.busy.steer-ready` | steerable turn + text in field | send returns as steer |
| `.glass` | Tauri shell only | translucent paper, darkened `--ink-3` |
| `.standalone` | PWA | safe-area insets on status and feed |
| `.playtest` | playtest mode | labelled border on the composer |
| `.link-fresh` | recent state change | same: set on `body`, styled by nothing since the status label went. Vestigial alongside `data-link` |
| `.calm` | `syncMotionPreference` (system reduced motion or Calm motion) | the reduced-motion kill switch of §7.4, so the in-app preference reaches the CSS and not only the character |
| `.project-view` | `openProjectSection` / `closeProjectView` | a section is a room: the feed, chips, jump, composer and fixers stand down (the composer stays mounted and `inert`, so a draft survives); the header `×` is the way back |
| `.has-agents` | `renderAgents` | the fixers are perched on the composer, so `--feed-bottom` rises 52px to keep the feed clear of them |

**Rule.** New state goes on `body` as an attribute when it has 3+ values, a class when it is binary. Never a JS-set inline style — `.glass` is applied by `app.js` precisely so browsers and the PWA are untouched, and that separation is what keeps the contrast budget honest.

---

## 11. Voice

Governed by `docs/PERSONALITY.md`, which is more thorough than most product voice guides. The UI-side obligations:

- **Chips come from meaning or from state, never from a regex.** This is the hardest-won rule in the project (`docs/IMPROVEMENT-PLAN.md` §A) and it is a design rule as much as a model rule: an action that appears must be an action that exists.
- **Labels are lowercase sentence case.** `new thread`, `jump to latest`, `plan first`. Uppercase appears only at `--type-micro` with tracking, for machine categories (`TOOL`, `EXECUTED`).
- **Numbers, not adjectives.** `4 files · +82 −14`, not "several changes".
- **A state line says one fact once.** A section tab's headline is its badge; the lines under it add only what the badge lacks, as lowercase fragments with no period (`2 in flight · 1 staged`, `nothing queued`), and nothing at all when it has nothing to add. A status shown on its own names its subject: `Notifications are blocked in system or browser settings`, not `Blocked in system or browser settings`.
- **A truncated string always carries a `title`.** Taken from the sidebar lab's reading of Cursor's live complaint about untitled truncated repo names.

---

## 12. Accessibility contract

Already met, and worth stating so it stays met:

| requirement | implementation |
|---|---|
| focus visible | `outline: var(--focus-ring)` (`2px solid var(--ink)`), `offset: 3px` (2px inside dense panels), on every interactive element; on ink (a toast's action, a code block's copy) `var(--focus-ring-inverse)`, the same ring in `--ink-inverse`, since the ink ring cannot be seen there; `tools/style-verify.mjs` fails any other ring |
| disabled | `opacity: var(--dim-disabled)` (`.45`), everywhere; a control that must not dim says `opacity: 1` and shows it another way (the outlined Settings badge) |
| touch targets | 44px minimum at `≤640px` and `pointer: coarse` |
| reduced motion | global 1ms override + per-surface + character-level static poses |
| screen reader | `.sr` clip pattern, `aria-expanded` on the `+`, `aria-pressed` on toggles, `aria-describedby` on the field |
| hover-only content | every hover reveal also fires on keyboard focus. The agent card opens on `:focus-visible` on the agent or inside the card (`:has(.card :focus-visible)`), so focus in its guide box keeps it open; not on `:focus-within`, which a click also satisfies, and which held an unpinned card open over the hero |
| colour alone | no state is carried by colour alone — dots also change size, borders also change weight |
| contrast | §2.5 |

**Closed.** `@media (hover: none)` used to cover `.meta` alone. Verified against a real touch context at 390px, the only control that was genuinely stranded was the code block's **copy button** — laid out, clickable, and painted at `opacity: 0`, which is worse than no button at all. It now stands down to `opacity: 1` when there is no hover. Agent cards were fine: tapping an agent toggles `.pinned`, which is a deliberate tap path, and revealing all eight cards on a phone would be worse.

**Rule.** A control may hide behind `:hover` only if it also has a tap path — a toggle, `:focus-within`, or a `hover: none` fallback. Laid out and invisible is the one state that is never acceptable.

---

## 13. Platforms

| surface | differences |
|---|---|
| **browser** | the baseline |
| **Tauri desktop** | `.glass` — translucent paper over Liquid Glass, `--ink-3` darkened to `#4f4b46`, `--blur-heavy`. The titlebar belongs to the traffic lights and an overlay title; do not put tabs there |
| **PWA** | `.standalone` — safe-area insets |
| **phone** | `≤640px`: shorter composer, 44px targets, thumbnails on their own row, fixed-position agent cards, status label hidden |

**Rule.** A feature ships on all four or states which one it is for. The phone is a paired device, not a smaller desktop — `docs/POCKET-*.md` treats it that way and the CSS should too.

---

## 14. Adding new UI — the checklist

1. Can it be assembled from §9? If yes, do that.
2. Does it need a colour? Almost certainly not. Ink, veil, or a `--fail-*`/`--pass-*` verdict.
3. Which of the four shapes (§5.2) is it?
4. Which elevation, and does it need `--e-highlight`?
5. Which named layer, and what does it need to sit above or below?
6. `arrive`, `pulse`, or nothing.
7. 44px at coarse pointer; focus ring; `:focus-within` for anything hover-revealed.
8. If it holds a changing number: `tabular-nums`.
9. If it sits above the composer: track `--feed-bottom`.
10. If it truncates: `title`.
11. Does it render correctly with `reduced-motion`, under `.glass`, and at 390px?

---

## 15. Drift register — applied

Everything found that was the same intent rendered two ways. **All 12 rows are applied.**

| # | drift | fix | status |
|---|---|---|---|
| 1 | four reds for one verdict: `#873f35` (workspace, margins), `#743b2f`, `#65432c` against `#9a3f2c`/`#7a3a2e`/`#b5533d` (chat) | collapsed to `--fail-mark` / `--fail-text` / `--fail-quiet` | ✅ |
| 2 | two greens for one verdict: `#365342` (workspace) vs `#2f6b3a` (chat) | collapsed to `--pass-text` | ✅ |
| 3 | raised paper `#faf8f3` in three places, `#faf8f4` in `margins.css` | `--paper-raised` | ✅ |
| 4 | inverse ink `#f5f2ec` in some places, `#f5f2ea` in three, `#fff` in three more | `--ink-inverse` | ✅ |
| 5 | toast shadow black, every other shadow ink | `--e-floating` | ✅ |
| 6 | `--ink-3` forked twice by hand (`#5f5b55`, `#4f4b46`) | ramp rebuilt on APCA: constant hue, even steps, **both forks retired**; the glass surface fixed with paper alpha `.86` rather than darker ink | ✅ §2.5 |
| 7 | 25 ink alphas where 7 would do | `--veil-*`, 25 → 1 | ✅ |
| 8 | 20 font sizes where 10 would do | `--type-*`, 20 → 0 literals | ✅ |
| 9 | 15 radii where 8 would do | `--r-*`, 15 → 1 literal | ✅ |
| 10 | 6 blurs where 4 would do | `--glass*`, 6 → 0 literals | ✅ |
| 11 | 12 anonymous z-indexes | `--z-*`, 8 named rungs; 2 local-context values left literal with a comment saying why | ✅ |
| 12 | `margins.css` wrote `220ms` literally instead of `--t2` | uses the token | ✅ |

Two families were found while applying the register and are now documented rather than left loose: the opaque interaction beds (§2.2b, eight near-identical warm greys across two files) and the elevation ladder's one horizontal shadow, `--e-rail`.

Round 2 (0.8.1) closed two more of the same kind. Builds showed `To push 0` and `Pull requests 0` on every project, GitHub or not: those two now hide as a group when no run delivers through GitHub (`github.mode` or `workflowMode` is `github`) and neither counts anything (a local merge on a GitHub-connected project is mode `local` and still to push), while `Needs attention` stays, because that is where a local project's failed builds are.

Three tokens joined the file, `--dim-disabled`, `--focus-ring` and `--focus-ring-inverse` (the same ring on ink, where the ink one cannot be seen), replacing six disabled opacities (`.35`, `.4`, `.42`, `.45`, `.45`, `.5`) and every hand-drawn ring (`--ink-2` in the workspace and `--margin-muted` on the card's scroller among them). `--track-micro` is adopted at its two exact sites. 28 `!important` flags are retired — 16 in `margins.css` and 11 in `project-workspace.css`, where the button resets sat at (0,1,1) and outranked every control's own class (they are under `:where()` now), and the palette's one, which a `max-width` does without. What remains is `[hidden]` and the reduced-motion kill switch (7 in `styles.css`, 3 in `margins.css`), and `tools/style-verify.mjs`, first in `npm run verify`, holds each file to that budget. Two things came back once the resets stopped winning: the section's `×` renders at its declared `--type-title` (21px, as the card's close does; it was 16), and a disabled Settings preference keeps full opacity with its outlined badge, as §12's shape-not-colour rule always asked.

## 16. References

Sources consulted for the recommendations above. Resource discovery via [designeer.xyz](https://designeer.xyz).

| topic | resource | what it settles |
|---|---|---|
| contrast model | [APCA](https://www.myndex.com/APCA/) | the right maths for dark-warm ink on light-warm translucent paper |
| ramp editing | [Huetone](https://huetone.ardov.me/) | builds `--ink-*` as one measured ramp instead of four picks and two patches |
| colour space | [OKLCH](https://oklch.com/) | perceptually even lightness steps; keeps glass alphas honest |
| fluid scale | [Utopia](https://utopia.fyi/) | one type+space scale across 390px→1440px, deletes most `≤640px` overrides |
| easing | [Easing Wizard](https://easingwizard.com/) | a comparison for `cubic-bezier(.2,.7,.2,1)`, which has never had one |
| interaction detail | [Devouring Details](https://devouringdetails.com/) | the published standard closest to `design/*-lab/` practice |
| numeric transitions | [NumberFlow](https://number-flow.barvian.me/) | the technique for build counts and costs |
| shader craft | [Book of Shaders](https://thebookofshaders.com/), [Paper Shaders](https://shaders.paper.design/) | reference for `character-lab/raymarch.mjs` |
| sound | [@web-kits/audio](https://audio.raphaelsalaja.com/), [soundcn](https://soundcn.xyz/) | voice and wake-word acknowledgement, currently silent |
| component comparison | [Component Gallery](https://component.gallery/) | the one-component-many-products method `sidebar-lab/references.md` already uses |
| chat surface patterns | [Prompt Kit](https://www.prompt-kit.com/) | a state taxonomy for streaming, tool calls and prompt input to check §9 against |

**Not adopted, deliberately.** The React + Tailwind component libraries that make up most of designeer.xyz's `/components` (shadcn, Magic UI, Aceternity, Cult, Kibo and ~100 others) do not apply: Nibbi is vanilla ES modules and hand-written CSS, and the parts vocabulary in §9 is better tuned to this product than anything installable. They are reading material, not dependencies.
