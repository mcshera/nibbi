# Nibbi character lab — round 3 (more like the bead)

Six raymarched premises on a shared WebGL base (`../raymarch.mjs`): the ink bead the owner liked, plus ink swirling inside a glass marble, an inkwell with a lid, a drop clinging to a pen nib, a velvet-matte soot ball, and a bead that splits into a colony. Read [BRIEF-3.md](BRIEF-3.md).

```sh
cd /Users/Matty/Documents/Nibbi
node design/character-lab/serve.mjs            # → http://127.0.0.1:4538/design/character-lab/round3/
node design/character-lab/round3/tech.test.mjs         # headless contract checks for all techniques
node design/character-lab/round3/verify2.mjs           # shell checks + screenshots → evidence/
node design/character-lab/round3/sheet2.mjs marble     # one technique's sheet (add --reduced, --tint=#7a4b2a)
node design/character-lab/round3/sheet2.mjs bead marble inkwell nibdrop velvet colony --matrix
```

Techniques are built with `makeMount(spec)` — see [BASE-CONTRACT.md](BASE-CONTRACT.md) and `techniques/bead.mjs` (reference). Browser checks use local Chrome with software WebGL; they are not device benchmarks. No production files or app state are touched.
