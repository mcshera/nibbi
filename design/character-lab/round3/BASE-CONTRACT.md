# Round 3 — raymarched techniques on the shared base

Round 3 keeps the technique the owner liked (a lit 3D object on the paper, raymarched in a WebGL fragment shader) and varies the **premise**. Every technique is one module built with `makeMount(spec)` from `design/character-lab/raymarch.mjs`, so it only has to describe its shape, materials and behaviour. The shell/test/sheet contract is the round-2 one (`TECH-CONTRACT.md`): `mount(host, opts) → { cue, step, setReduced, setEnergy, setTint, poke, destroy }`.

Read `techniques/bead.mjs` first — it is the complete reference (≈120 lines).

```js
import { makeMount } from '../../raymarch.mjs';
import { clamp, TAU } from '../../ink.mjs';
export const meta = { id, name, technique, tagline, look, motion, eyes, risks: [...], stills: { idle: 2, hello: .45, ... } };
export const mount = makeMount({
  id: 'marble',
  scene: `...GLSL...`,                       // see below
  uniformTypes: { u_body: '3f', u_swirl: 'f', u_gaze: '2f' },   // the base DECLARES these; do not redeclare them in the scene
  springs: { squash: [110, 12], lift: [70, 10], ... },          // [stiffness, damping] per state variable; critically damped ≈ c = 2*sqrt(k)
  initial: { squash: 1 },
  oneShot: { hello: 1.3, success: 1.9, error: 2.2, tap: .8 },   // seconds after which a one-shot returns to idle
  onCue(action, st, S) {},                                     // optional: impulses (S.squash.v -= 3), reset st.aux[...]
  onRelease(st, S) {},                                         // optional: pointer release impulse
  onPoke(kind, x, y, st, S) { return false; },                 // optional override of press/drag; return true to skip the default (default: st.pressed, st.drag/dragY in R units ≤ .3)
  targets(st, S, h) { /* set S[k].t for every spring from st.action, st.tA (s since cue), st.time, st.energy, st.pressed, st.drag, st.reduced; h.rand(i), h.noise(x) are deterministic */ },
  uniforms(S, st) { return { u_body: [x, lift, lean], u_swirl: v, u_gaze: [gx, gy] }; },   // numbers, [x,y] or [x,y,z]
  tilt: .5, steps: { hero: 72, small: 48 }, heroScale: .62,
});
```

## The scene (GLSL ES 1.0)

World units: R = 1. The paper is the plane y = 0; the character's contact point is the origin; the camera is orthographic, tilted `tilt` rad down toward −z, so +y is up on screen and +z is toward the viewer. Light comes from upper-left-front. Keep the object inside x ∈ [−1.6, 1.6], y ∈ [0, 2.9].

Provided helpers: `hash, hash3, vnoise, fbm, smin, smax, sdSphere, sdEll, sdBox, sdCapsule, sdTorus, sdCylinder, rot`. Provided uniforms: `u_time` (0 when reduced), `u_ink` (vec3 ink colour — tint replaces it), `u_paper`, `u_R`, `u_steps`.

Your scene must define exactly:

```glsl
vec2 map(vec3 p);            // (signed distance, material id) — the whole object; eyes included as their own material ids
vec3 material(float id, vec3 p, vec3 n, vec3 rd, vec3 light, float diff, float spec, float window, float fres); // colour for a hit
float paperInk(vec3 p);      // 0..1 extra ink stain on the paper at world p (rings, puddles, drips); return 0. if none
```

`material` receives Blinn-Phong pieces already computed: `diff` (n·l), `spec` (shininess 60), `window` (a soft reflected window highlight), `fres` (grazing term). The bead's wet ink is `u_ink*(0.55+0.45*diff) + 0.22*fres + 0.9*spec + 0.32*window*0.8`. Matte materials drop spec/window; glass adds strong `fres` and `window`; use `fbm` for volumetric or fuzzy effects.

## Rules

Same as round 2 (quiet idle ≤ .02 mean change over 2 s, every moment distinct at its still, one-shots return to idle, reduced converges to identical frames, touch changes the body, tint recolours the ink, stays inside the host, tiny R=12 still reads). Two eyes, no mouth, no limbs — made in the material of your premise. Cheap: ≤ ~72 march steps at hero, no nested loops over 4 iterations in `map`.

## Check

```sh
cd /Users/Matty/Documents/Nibbi
node design/character-lab/round3/tech.test.mjs <id>
node design/character-lab/round3/sheet2.mjs <id>      # → round3/evidence/sheet-<id>.png ; look at it
```
