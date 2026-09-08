# Ink bubble character variants

Velvet pool is the selected Nibbi character and the app default. Five additional pooled-ink treatments are available alongside Wash and Dry. They share the approved body and whole-face movement and use the app's Pocket motion controller and existing character API.

| Character | App URL query |
| --- | --- |
| Wash | `?character=wash` |
| Pool | `?character=pool` |
| Velvet pool (default) | No character query, or `?character=pool-velvet` |
| Bloom pool | `?character=pool-bloom` |
| Tidal pool | `?character=pool-tide` |
| Speckled pool | `?character=pool-speckle` |
| Brush pool | `?character=pool-brush` |
| Dry | `?character=dry` |

Append the query to the running app's origin. Selection is URL-scoped and case-sensitive; it is not saved as a preference. An absent or unrecognized `character` selects Velvet pool. A recognized character selects Pocket motion even when `motion=legacy` is also present. Without a recognized character, `?motion=legacy` retains the legacy renderer and its original character.

Use `?gaze=left`, `?gaze=straight`, or `?gaze=right` for an initial face direction in the app preview. Both white eyes move around the bubble together as it turns. These can be combined with the character query. Missing or unknown gaze values keep normal behavior. Later app interactions may replace this initial direction through `lookAt` or `lookFree`.

For an isolated static app preview, append `&demo=1&nosw=1`. Demo uses scripted conversation replies but still attempts status and passive reporting requests; a static preview has no daemon. Use fixture responses when verifying those requests. `nosw=1` suppresses new service worker registration; use a fresh origin or browser context to avoid an already installed worker.

## Renderer integration

Load `public/pocket-motion.js` before `public/nibbi.js`, as the app already does. Provide two overlaid canvases with identical layout: `ink` for the body and `fx` for eyes and effects. The renderer owns canvas sizing and draws in viewport CSS coordinates.

```js
const nibbi = createNibbi({
  ink: document.querySelector('#ink'),
  fx: document.querySelector('#fx'),
  motion: 'pocket',
  character: 'pool-velvet', // Or any character ID listed above
});
nibbi.snapTarget({ x: innerWidth / 2, y: innerHeight / 2, r: 110 });
nibbi.setMood('listening');
nibbi.animate('hello');
nibbi.lookDirection(0, 0); // straight ahead; use -1 or 1 for left or right
// On teardown:
// nibbi.destroy();
```

Variant selection happens at creation. The same `setMood`, `pulse`, `animate`, `pointer`, target/layout, and interaction calls drive each treatment. Existing app controls already forward OS reduced-motion and the local calm setting through `setReducedMotion`; standalone callers should do the same. The Pocket library is required for these variants: the existing missing-library path uses the legacy character.

`lookDirection(x, y)` accepts normalized axes from -1 to 1 (positive is right/down) and keeps that direction until `lookAt` or `lookFree` replaces it. For ink bubbles, it projects the whole white eyes around the bubble surface with perspective: eye positions and apparent sizes change with the turn, and pupils and lids move with them across the fixed body. `state().gaze` reports the mode, requested direction, and current direction; `state().eyeCenters` reports the resulting eye positions. This API belongs to the Pocket renderer; the app guards optional gaze queries when using legacy.

`nibbi.state().character` identifies the selected treatment. The app now passes `pool-velvet` by default; standalone callers that omit `character` still receive the original Pocket character and `state().character === null`. The treatments are drawn procedurally into transparent canvases with WebGL and Canvas2D implementations; no generated image, extra script, or additional asset is required. The existing paper background comes from `nibbi.paperDataURL()`.

The named Pocket animations remain available. Bubble variants interpret the round, drop, and star shape fields as restrained rounding, stretch, and edge ripples so the character keeps one body. Existing character shape tricks are unchanged.

The source uses Velvet pool on ordinary app URLs, including the native shell’s `?app=1` URL. The same material is used for the main character, conversation mirrors, and small companions, with the approved whole-eye movement and bubble proportions. Installation evidence is recorded separately in `output/velvet-install/`.
