# Nibbi character lab — round 5 (thoughtful)

Five versions of Nibbi, each built around one faculty of a thoughtful companion — **Regard** (attention: a gaze model, eyes first and body second), **Keel** (deliberation: a rocking pendulum that weighs both sides and rights itself), **Tide** (memory: a diffusion field that keeps the last few seconds as a stain), **Contour** (focus: contour lines that gather around the point of attention) and **Pebble** (patience: a matte stone that turns toward you and stays). Same nine moments, same three sizes, same round-2/4 API, driven by one clock and responsive to touch. Read [BRIEF-5.md](BRIEF-5.md). Round 4 (toys) is in `../round4/`, round 3 (raymarched premises) in `../round3/`, round 2 (live techniques) in `../round2/`, round 1 (authored vector options) one folder up.

```sh
cd /Users/Matty/Documents/Nibbi
node design/character-lab/serve.mjs            # → http://127.0.0.1:4538/design/character-lab/round5/
node design/character-lab/round5/tech.test.mjs         # headless contract checks for all five versions (or pass ids)
node design/character-lab/round5/verify5.mjs           # shell checks + screenshots → evidence/
node design/character-lab/round5/sheet5.mjs regard     # one version's sheet (add --reduced, --tint=#7a4b2a)
node design/character-lab/round5/sheet5.mjs regard keel tide contour pebble --matrix   # the overview
```

In the lab, **type into the composer** (or press `/`): focusing it cues *listen* on every version, Enter cues *think* for a beat that scales with the length of what you typed, then the reply lands as *hello*. That sequence — listen, a beat, answer — is what this round is about.

Versions follow [TECH-CONTRACT.md](TECH-CONTRACT.md): `mount(host, opts) → { cue, step, setReduced, setEnergy, setTint, poke, destroy }`, plus `meta.faculty` and `meta.thoughtful` (what this body does that a thoughtless body would not). The harness adds three thoughtful measures to the round-4 checks: **attention** (the ink centroid at listen's still must sit ≥ 0.05R left of idle's — toward the person), **calm** (mean pixel change over 2 s: idle ≤ .02, listen ≤ .02, think ≤ .025, work ≤ .03) and **the beat** (ms until the first visible change after `cue('hello')`, reported not gated). No production files or app state are touched. Browser checks use local Chrome with software rendering; they are not device benchmarks.

## Evidence

- [`evidence/matrix.png`](evidence/matrix.png) — five versions × nine moments at each version's declared still, hero and 24 px. [`matrix-reduced.png`](evidence/matrix-reduced.png) — the same as static reduced-motion expressions.
- `evidence/sheet-<id>.png` — one version, nine moments × five times, plus pill and 24 px.
- `evidence/lab5-desktop.png`, `lab5-mobile.png`, `lab5-mobile-study.png`, `lab5-<moment>.png`, `lab5-beat-think.png`, `lab5-reduced.png` — the lab itself and the composer-driven beat. The lab clock is paused while each capture is taken.
- `evidence/browser-results.json` — shell checks. Per-version measures (attention shift, calm, beat, perf) are printed by `tech.test.mjs` and tabulated in the brief.
- [`REVIEW.md`](REVIEW.md) — independent design review of the first version of this round; the brief's §Fixes lists what changed in response.

## Files

`techniques/*.mjs` (five versions + `_template.mjs`), `TECH-CONTRACT.md`, `index.html` / `lab5.mjs` / `lab5.css` (shell, with the composer), `tech-test.html` + `tech.test.mjs` (headless contract checks with the thoughtful measures), `sheet5.html` + `sheet5.mjs` (sheets and the matrix), `verify5.mjs` (shell checks and screenshots), `evidence/`, `BRIEF-5.md`, `REVIEW.md`.
