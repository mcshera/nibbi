# Motion lab contract (experimental, not production)

All source is standalone ES modules. No dependencies. Serve repository root over local HTTP.

## motion.mjs
- export STYLES: array of {id, name, short, description}; exactly `elastic`, `liquid`, `mischief`.
- export ACTIONS: array of {id, label}; exactly `idle`, `hop`, `morph`, `hello`, `success`, `think`.
- export durationFor(style, action): seconds. idle loops; non-idle returns to neutral before duration.
- export sampleMotion(style, action, seconds, {intensity=1, reduced=false}={}): returns JSON-safe pose.
- export neutralPose(): fresh neutral pose.

Pose: {x:0, lift:0, sx:1, sy:1, rotate:0, lean:0, round:0, star:0, drop:0, satellite:0, trail:0, impact:0, eyeX:0, eyeY:0, blink:0, wide:1, happy:0, phase:'rest'}.
Units: x/lift/lean/eyeX/eyeY are normalized by base radius R. lift is positive up. rotate radians clockwise. Body and eye transform about planted foot at local (0,0.66R): scale sx/sy, rotate, then translate xR and -liftR. lean = crown horizontal bend in R units. Eye offsets are local before body transform. round/star/drop are 0..1 shape weights. satellite controls liquid beads 0..1; trail optional 0..1. impact 0..1 temporary landing marks, never a permanent shadow. Every scalar must be finite. neutralPose values above. idle should be quiet, not constant jumping. reduced=true gives spatially static neutral shape for every action/time, but may communicate through happy/wide (no flashing). No input mutation. Intensity range UI 0.5..1.5, API clamps 0..1.5.

## renderer.mjs
- export class InkRenderer { constructor(canvas, {force2D=false}={}); render(pose, {time=0, texture='flow', reduced=false}={}): void; resize():void; destroy():void; info(): {backend: 'webgl'|'canvas2d', ...} }
- Canvas determines CSS size. Renderer allocates backing pixels (DPR <= 2), fits character and highest jump (lift <= 1.1R) in bounds.
- One canvas only: may use offscreen GL + composite to 2D then registered eyes on visible canvas. Original public/nibbi.js shader/eyes look can be adapted into isolated file (attribution note), do NOT edit original.
- texture flow = continuous slow noise offsets; boil = deliberate stepped offsets. reduced freezes ALL autonomous movement incl texture/blink. Renderer driven only by passed time/pose (deterministic), no RAF/timers/events outside resize handled by parent.
- Preserve Nibbi ink-blot silhouette, oversized pip eyes/glints, monochrome paper-friendly art. Genuine shape weights round/star/drop + soft satellite beads, smooth bounded shape changes. Body and eyes use exact same anchor/scale/rotate/lean map. Renderer may use Canvas2D fallback with honest backend report if no GL.
- Expose geometry diagnostics through info if possible. No permanent shadow. A subtle landing ink mark is fine.

Parent builds index.html, lab.css, lab.mjs, browser smoke/visual checks and README/PLAN.md. Children own their assigned source and test files only. Other existing work is unmodified.
