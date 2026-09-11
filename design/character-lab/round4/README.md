# Nibbi character lab — round 4 (five new techniques)

Five kinds of motion technology the lab had not tried, each a toy — a falling-sand cellular automaton (`sand`), a Physarum slime-mould agent simulation (`slime`), a Voronoi mosaic of rigid tiles on springs (`shards`), a Verlet pom-pom of ink strands (`puff`) and a mechanical flip-dot board (`flipdot`) — driven by one clock and responsive to touch. Same nine moments, same three sizes, same round-2 API. Read [BRIEF-4.md](BRIEF-4.md). Round 2 (live techniques) is in `../round2/`, round 3 (raymarched objects, built in a parallel session) in `../round3/`, round 1 (authored vector options) one folder up.

```sh
cd /Users/Matty/Documents/Nibbi
node design/character-lab/serve.mjs            # → http://127.0.0.1:4538/design/character-lab/round4/
node design/character-lab/round4/tech.test.mjs         # headless contract checks for all five techniques (or pass ids)
node design/character-lab/round4/verify4.mjs           # shell checks + screenshots → evidence/
node design/character-lab/round4/sheet4.mjs sand       # one technique's sheet (add --reduced, --tint=#7a4b2a)
node design/character-lab/round4/sheet4.mjs sand slime shards puff flipdot --matrix   # the overview
```

Techniques follow [TECH-CONTRACT.md](TECH-CONTRACT.md): `mount(host, opts) → { cue, step, setReduced, setEnergy, setTint, poke, destroy }`, plus `meta.fun` (the toy behaviours each technique owns). No production files or app state are touched. Browser checks use local Chrome with software rendering; they are not device benchmarks.
