# Nibbi character lab — round 2 (techniques)

Five live techniques — particle ink, soft body, wet-ink SVG filters, stamp-based brush painting, a raymarched ink bead — driven by one clock and responsive to touch. Read [BRIEF-2.md](BRIEF-2.md). Round 1 (authored vector options) is one folder up.

```sh
cd /Users/Matty/Documents/Nibbi
node design/character-lab/serve.mjs            # → http://127.0.0.1:4538/design/character-lab/round2/
node design/character-lab/round2/tech.test.mjs         # headless contract checks for all five techniques
node design/character-lab/round2/verify2.mjs           # shell checks + screenshots → evidence/
node design/character-lab/round2/sheet2.mjs bead       # one technique's sheet (add --reduced, --tint=#7a4b2a)
node design/character-lab/round2/sheet2.mjs particles softbody svgink brush bead --matrix   # the overview
```

Techniques follow [TECH-CONTRACT.md](TECH-CONTRACT.md): `mount(host, opts) → { cue, step, setReduced, setEnergy, setTint, poke, destroy }`. No production files or app state are touched. Browser checks use local Chrome with software WebGL; they are not device benchmarks.
