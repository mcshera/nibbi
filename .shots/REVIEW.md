# Nibbi — design review (review-only, no files edited)

Reviewer: design-critic child · Fact source: `/Users/Matty/Oracle/design/variants5/reference-v4.png`
Audited: `.shots/v-*.png` (11 states) + `public/index.html`, `public/app.js`, `public/styles.css`, `public/nibbi.js` (read-only).
Measured with numpy on the PNGs where a number is given. Severity: **P0 broken · P1 hurts · P2 polish**.

## Overall

The bones are right: one character, one pill, paper, and the "UI appears only when needed" rule mostly holds. The
character is 24% of screen width vs 23% in the reference, sits at 49% vs 52% height, and the pill matches the reference
almost exactly. The biggest gaps are (a) the character itself — it is a flatter, wider bun sitting on an opaque gray
cloud instead of a tall fluffy blot over a faint watery smear; (b) a bottom vignette that turns the warm paper gray/muddy;
(c) the newest-first feed leaves stale, still-clickable action chips (including **"ship it"**) under the newest turn;
(d) streamed replies render raw markdown until `done`; (e) no `:focus-visible` anywhere and a token-by-token `aria-live`.

## Top 10 (prioritized)

### 1. P1 · Pool reads as a solid gray cloud, not a watery ink smear
- **Where:** `public/nibbi.js` fragment shader, lines 125–147 (`ap = min(... , 0.65)` line 137; `inkP = vec3(0.38,0.37,0.36)` line 144; `dpe = length(pp*vec2(1.0,3.6)) - 1.18*u_R` line 128). Visible in every `v-*.png`.
- **Why:** Measured luminance in the band just under the blob: reference mean **243.5 / min 208** (on 244 paper) vs built **223 / min 183**. The built pool is ~3× darker and has hard cauliflower lobes, so Nibbi looks like it sits on a cumulus cloud/snow. The reference pool is a barely-there wet halo that sells "ink on paper".
- **Fix:** cap `ap` at ~0.30 (not 0.65) and lift `inkP` to ~`vec3(0.58,0.57,0.56)`; flatten the ellipse (`vec2(1.0, 5.0)`) and widen it (`1.35*u_R`) so it reads as a thin puddle wider than the body; drop the `s1/s2` tuft amplitude on the pool by half (0.19→0.09, 0.11→0.05) so the edge is feathered, not lobed. Keep the `cs` center darkening — that is what the reference has.

### 2. P1 · Blob silhouette is too wide/flat vs the reference
- **Where:** `nibbi.js` line 99 `ysc = mix(1.08, 1.22, …)` (vertical squash) and lines 92–93 (`rr += 0.12*clamp(-sin(an))`, `rr -= 0.06*clamp(sin(an))` — fatter skirt, thinner crown).
- **Why:** Largest-dark-component bbox: reference **332×289 (aspect 1.15)**, built **685×482 @2x (aspect 1.42)**. Height is 24% of viewport vs 27% in the reference. The reference is a tall fluffy dome with a round crown; the built one is a hamburger bun. Eyes also sit higher (~45% of body height vs ~55% in the reference), so the face reads "peeking over a wall".
- **Fix:** `ysc = mix(0.98, 1.10, …)`, reduce the skirt bias `0.12→0.06` and crown thinning `0.06→0.02`; move the eye anchor down ~0.1R. Re-measure aspect; target 1.15–1.2.

### 3. P1 · Bottom vignette makes the paper gray and muddy (reference is uniform warm cream)
- **Where:** `styles.css` line 27–30 `body::before` second gradient `radial-gradient(140% 120% at 50% 100%, rgba(80,72,60,0.10) …)`.
- **Why:** Built paper: top-left RGB **(243,240,234)**, bottom-left **(234,231,223)** — a 9-point drop. Reference: **(247,244,240)** top and bottom (no gradient). The darkened lower third pulls the pill zone toward "wet cardboard" and fights the ink-on-paper premise. The reference paper is also slightly warmer/brighter than `--paper #f2efe8`.
- **Fix:** delete the bottom gradient (or cap at `rgba(80,72,60,0.03)`), keep the top highlight at ≤0.25. Nudge `--paper` to `#f5f2ec` and let `nibbi.paperDataURL()` grain carry the texture.

### 4. P1 · Stale action chips from older turns stay live under the newest turn — including "ship it"
- **Where:** `app.js` `addActs()` line 155–160 (appends `.acts` into the turn; nothing removes them), `newTurn()` line 101–117 (prepends without touching earlier turns). Visible in `v-error.png`: below the error turn, the previous turn still shows **"show what's staged"** and **"ship it"** at full opacity.
- **Why:** Newest-first means the *old* chips sit in the natural reading path just below the new answer. One misclick sends `yes, ship it` (line 291) for a reply that is no longer the current context. Also breaks the "nothing on screen unless needed" rule.
- **Fix:** in `newTurn()`, for every existing `T` in `S.turns`: `T.nib.querySelector('.acts')?.remove()` (or add `.acts.stale { pointer-events:none; opacity:.35 }`). Put contextual actions only on the newest turn. See #5 for the broader fix.

### 5. P1 · Newest-first stacking has no visual hierarchy between "now" and "earlier"
- **Where:** `styles.css` `.turn` line 66 (uniform weight, 22px gap), `.feed` line 52. See `v-error.png`.
- **Why:** Within a turn the order is chronological (you → nibbi) but between turns it is reversed, so the eye reads: *new you → new nibbi → old you → old nibbi*. That is understandable **only if** the older turn looks older. Right now turn 2 and turn 1 have identical size, contrast and chips; the only boundary is whitespace. The user's old prompt bubble ("fix the bug…") visually looks like a follow-up question to the error.
- **Fix (recommended):** treat older turns as "memory" — `.turn:not(:first-child) { opacity:.55; font-size:.94em }` with `.turn:not(:first-child):hover { opacity:1 }`; collapse older `.nib .said` to its first paragraph + a "more" link (reuse the fold pattern); add a 1px `var(--line)` hairline + `earlier` caption (11px, `--ink-3`) before the first older turn. Alternative if you want zero dimming: keep only the newest turn under the character and move older turns behind a single "earlier · 1 turn" fold.

### 6. P1 · Streaming shows raw markdown, then snaps to formatted at `done`
- **Where:** `app.js` `setSaid()` line 139–144: `if (live) T.said.textContent = clean`. Visible in `v-speaking.png`: `Found it. Two files touched, tests still green. - \`session.ts\` — … - \`webapp.ts\` — …` runs as one inline line with literal backticks and hyphens; in `v-done.png` the same text becomes paragraphs + bullets + code spans, so the block reflows and grows ~2 lines.
- **Why:** The character is "speaking" — visible markup breaks the illusion and the reflow at the end reads as a glitch.
- **Fix:** render live too, throttled: `if (live) { if (!T.rafPending) { T.rafPending = requestAnimationFrame(() => { T.rafPending = 0; T.said.replaceChildren(renderMd(T.acc)); }); } }`. marked on ≤2 KB is sub-ms. If you must keep text mode while streaming, at least `white-space: pre-wrap` on `.said` in live mode so the newlines survive.

### 7. P1 · The "thinking" dot floats at the left margin, far from the character
- **Where:** `styles.css` line 74 `.nib .said:empty::after` (8px pulsing dot, inline at the start of `.said`). Visible in `v-thinking.png` at x≈326/1200, y≈270 — the character is centered at x=600.
- **Why:** It reads as a stray ink speck or a rendering bug. The character already has a `thinking` mood (eyes up-left, boil 13, `puffIdle 9`) — that is the right place for "thinking" to live.
- **Fix:** remove the pseudo-element dot while `body.busy` and the said is empty (the mood carries it); or if you want a textual cue, center it under Nibbi: `.nib .said:empty { text-align:center; min-height:1.5em }` and use a 3-dot ink drip that fades in after 600ms (avoid flashing on fast replies).

### 8. P1 · Accessibility: no `:focus-visible`, `aria-live` fires on every token, low-contrast meta text
- **Where:** `styles.css` — no `:focus-visible` rule anywhere (chips line 115, `.pill .send` line 139, `.pill .ico` line 144, `.status .row` line 45, `.steps .fold` line 101 is a `<div>` with `onclick`, not a button). `index.html` line 27 `<section id="feed" aria-live="polite">`. `styles.css` line 6 `--ink-4 #a9a49b` used for the fold line ("5 steps · 8s — show", 13px), `.step .n/.t`, `.meta` (11.5px) → **2.16:1** on paper; placeholder `#a39e95` → **2.32:1**. `--ink-3` step labels are 4.61:1 (OK).
- **Why:** Keyboard users cannot see where they are among chips/send/mic; screen readers get re-announced the whole growing reply on every delta (`textContent` replaced each token); the fold/meta text is below AA (4.5:1) and is the only way to open the step log.
- **Fix:** add `:where(.chip,.send,.ico,.status .row,.fold):focus-visible { outline:2px solid var(--ink); outline-offset:3px }`; make `.fold` a `<button>`; move `aria-live` off the feed onto a visually-hidden `<div id="sr" aria-live="polite">` that gets `stripMd(result.text)` once at `done` (and "nibbi is working" once on first tool); set `aria-busy="true"` on the turn while streaming. Lift `--ink-4` to `#8a857c` (≈3.2:1, fine for the 7px dots/dividers) and set fold/meta text to `--ink-3` at 12.5px.

### 9. P2 · Idle screen is not "nothing else": `demo brain` label pinned top-right; mic showing in idle
- **Where:** `styles.css` line 39 keeps `.status .label` expanded whenever `data-link` is `demo | offline | booting` (so it is permanently on in demo, and on for every boot). `v-idle.png`, `v-focus.png`, both phone shots show `○ demo brain` in the corner. Mic (`.pill .ico`, line 144–145) is visible in `v-idle.png` although the spec says it appears on focus — either the automation's cursor is over the pill or `:hover` is too eager.
- **Why:** The reference has nothing but blob + pill. A persistent text label in the corner is the first thing that breaks the "empty paper" feeling, and the 6px dot on its own is invisible enough that hover discovery is unlikely.
- **Fix:** show the label for 2.5s after any `setLink()` change then collapse to the dot (`body.link-fresh .status .label`, toggled by a timer in `setLink`); for `offline`, let the *character* carry it (droop/sleep mood + one chip "wake the gateway") instead of corner text. Remove `.pill:hover .ico` reveal and keep only `:focus-within` + `.listening`, so idle really is idle.

### 10. P2 · Talk-mode character is small; progress rows are quiet-but-right, fold line is too quiet; phone chip placement inconsistent
- **Where:** `app.js` line 40 `r = r0 * 0.56` (talk radius); `styles.css` `.steps` line 90–104; `.chips` line 114 + phone `@media` line 161–166; `v-phone-talk.png`.
- **Why:** At 0.56× the eyes are ~14px @1x, so the moods that are supposed to *be* the status (thinking/error) barely register — in `v-error.png` the angry eyes are readable but small. The live step rows (13px, `--ink-3`, 7px dots, `×2` counter, trailing seconds) are the right volume — keep them. The folded line at `--ink-4`/13px is under-readable (see #8). On phone, "go on / show me" chips float above the pill while desktop puts reply actions under the reply — two homes for "what next".
- **Fix:** talk radius `0.66`, and clamp `cy` so the bottom of the pool clears the first `.you` bubble by ≥14px. Give `.steps.folded .fold` `--ink-3` and make the "show" verb a real link-styled span. Use one home for follow-ups: reply-specific `.acts` under the newest reply; generic `after` chips only when no `.acts` exist (already true — line 278) **and** render them inside that same `.acts` slot rather than the fixed bottom `.chips` bar, so the bar is reserved for idle/focus suggestions.

## Copy audit (short)
- Tone is right: lowercase chips (`what's new?`, `start a playtest`, `what were we doing?`, `go on`, `show me`, `try again`, `how to re-login`, `show what's staged`, `ship it`, `yes`, `not now`), toasts (`stopped watching`, `heard nothing`, `nibbi is still working — one thing at a time`), menu (`tidy the table (esc)`). Placeholder matches the reference exactly. No he/him/his anywhere in `index.html`, `app.js`, `styles.css` — clean.
- `app.js` line 202 demo error: `error: the gateway threw its ink pot — \`OAuth session expired…\`. Run \`claude setup-token\` and I'll try again.` — the whimsy works, but the leading `error:` prefix is machine-voice. Prefer `I spilled the ink pot — the gateway's OAuth session expired. Run \`claude setup-token\` and I'll try again.`
- `app.js` line 258 real errors: `'error: ' + err.message` → users will see `error: HTTP 502` / `error: Failed to fetch`. Map the common ones to character lines (`the gateway isn't answering` / `I lost the thread — try again?`) and keep the raw message in the `.meta` row.
- `app.js` line 213 `Hi. I'm nibbi — Oracle's face on the table.` — good. Line 217 `(demo brain — the real Oracle gateway isn't reachable right now)` — fine, but consider dropping the parenthetical to the status menu.
- `app.js` line 226 toast `one thing at a time` and line 284 `in Terminal: claude setup-token → then restart the gateway` — fine.

## Also noticed (not in the top 10)
- **Destructive Escape / double-click.** `app.js` line 387: Escape with empty input in talk mode calls `tidy()`, which wipes `S.turns` and the DOM with no undo; dblclick on the character (line 62) does the same. Habitual "Esc Esc" after clearing a draft nukes the conversation. Offer a 6s toast with `undo` (keep the detached nodes in memory) or make tidy fade/hide rather than destroy.
- `v-tidy.png`: after Escape the suggestion chips reappear (`showChips('idle')`, line 168) even though the input is not focused — contradicts "chips only on focus". Two specks also drift above the head; fine as ambient, but they read as dirt on a "clean table".
- `.meta` (time · cost · copy · ask again) is hover-only (line 106–107) → unreachable on touch. Show it on the newest turn at low opacity, or on tap.
- `body { user-select:none }` line 22 plus `.feed { user-select:text }` is fine, but code blocks in replies have no copy affordance; the `copy` in `.meta` copies the whole reply only.
- Phone: `.pill { bottom:18px }` (line 163) with `viewport-fit=cover` — add `calc(18px + env(safe-area-inset-bottom))` or the pill kisses the home indicator.
- `#status .menu` is `role="menu"` with `<div class="row">` children (index.html lines 17–25) — either use `menuitem` roles or drop the role.
- `.step .l` is `white-space:nowrap; text-overflow:ellipsis` — fixer rows (`fixer · <60 chars> → status`, line 306) will truncate on phone; consider wrapping to 2 lines there.
- Reduced motion: `nibbi.js` handles it well (frozen boil, no spatter/drips/hop lift). CSS forces 1ms transitions — fine.

## What is working (keep)
- Pill geometry, shadow, 40px radius, black 52px send, ▣ stop swap while busy — matches the reference and feels intentional.
- Chips only on focus, hide while typing (`v-typing.png` is clean), reappear after reply.
- Live step rows: right size, right color, `×2` collapsing of repeats, trailing durations only when >1.5s — good restraint.
- Mismatched cartoon eyes and mood system (thinking gaze up-left, error squint, happy squint) — the reference's charm is there; just make them bigger in talk mode.
- Markdown styling in the final reply (`v-done.png`) — code chips, bullets, spacing are clean.
