# Nibbi — Story Mode

A separate, playable direction for Nibbi: the quiet Oracle interface reimagined as an unfolding story guided by Codex.

The opening surface is deliberately empty: paper, Nibbi, and one prompt. There is no navigation, dashboard, progress rail, or status chrome. Nibbi carries the working state through expression and movement; a reading surface appears only after the agent has made something. Prompts still go to the existing Oracle gateway when it is available, with a local fallback for design review.

## Run

```bash
cd /Users/Matty/Documents/Nibbi/nibbi-story
npm start
```

The prototype opens at `http://127.0.0.1:4537`. Use `?demo=1` to force the local story response.

Character studies can be previewed without adding UI to the surface:

- `?look=mochi` — large, round, innocent eyes
- `?look=pip` — low, shy eyes with oversized pupils
- `?look=wisp` — small, lively, slightly mismatched eyes

The default face remains available as `?look=soft`.

## The product idea

- **Nothing competes with the first prompt** — no header or side UI.
- **Working is embodied by Nibbi**, not exposed as a technical log.
- **The interface arrives with the result**, when there is finally something worth reading.
- **Nibbi remains the emotional center**, reacting to listening, searching, working, and finding.

The original Nibbi folder and surface are unchanged.
