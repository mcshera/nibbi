# Pocket spring implementation contract

User request: implement a ton of fun Pocket spring animations in the real Nibbi app. Pocket spring only, not a hybrid with liquid/oddball. Preserve fuzzy ink, low oversized pip eyes, no limbs/mouth/permanent shadow. Quiet idle. No deployment or service/account changes.

Ownership: kernel worker owns public/pocket-motion.js + tests/pocket-motion.test.mjs. Renderer worker owns public/nibbi.js only. Parent owns public/app.js, public/index.html, new public/lib/pocket-tricks.js + pocket.css, Vite/SW packaging, docs. QA worker owns tools/pocket-verify.mjs (new), test fixture HTML/JSON if needed. Many unrelated dirty changes exist: preserve them.

## Production motion library

Classic standalone script loaded BEFORE nibbi.js, UMD-style globalThis.NibbiPocketMotion. No dependencies / ES imports / new timers or DOM. Node tests may use vm or side-effect import. Exports:
- catalog: frozen array {id,label,group,duration,description}, exactly 24 IDs below. Durations seconds.
- neutral(): fresh pose.
- sample(id, seconds, {energy=1,reduced=false,compact=false}={}): pure analytic pose; unknown IDs neutral. Fixed duration with neutral tail. C1 continuity, deterministic regardless refresh. energy clamp0..1.5, compact attenuates travel/shape/rotation for small avatars, reduced static neutral spatial pose (static expression may differ by cue).
- ambient(mood, seconds, {energy=1,reduced=false,compact=false,speech=0}={}): small additive/multiplicative pose offset at rest, no spontaneous jumps or strong morphs. Distinct listening/thinking/working/speaking/sleep. Reduced spatially static incl texture/blink/eyes; static expression feedback useful.
- createDirector({seed=7}={}): {play(id,options={}), setMood(mood), update(dtSeconds,options={}), stop(), state()}. update options same as sample + hidden bool. Returns composed pose. It owns simulation/action elapsed, not wall time. Hidden calls do not advance; reduced cancels actions/queue and stays static. state() returns {action,phase,elapsed,duration,queue,mood,...} JSON-safe. play returns boolean admission; options {energy=1,priority=50,interrupt=false}. Bounded latest queue (<=1), coalesce duplicate cues, priority error/user above incidental celebration, smooth no-position-snap interruption / stop. Preserve scale area in transitions. Mood mapping triggers subtle entry gestures once, never every repeated mood call; happy = small varied positive response, error = immediate restrained oops, sleep = yawn then calm. User trick choices outrank incidental mood cues.

Pose contract same as motion-lab, only satellite/trail unused: {x:0,lift:0,sx:1,sy:1,rotate:0,lean:0,round:0,star:0,drop:0,satellite:0,trail:0,impact:0,eyeX:0,eyeY:0,blink:0,wide:1,happy:0,phase:'rest'}. x/lift/lean/eye offsets in base R units; lift positive up. Foot local(0,0.66R), crown bend x += lean*clamp((.66-y)/1.6,0,1.2); scale about foot, rotate clockwise, translate xR/-liftR. sx*sy=1, sx/sy in2/3..1.5, lift<=1.1, |x|<=.3, |rotate|<=.35, |lean|<=.35. Positive wide smoothly<=1.14 so whites stay separate. No liquid beads/oddball scoots.

24 actions:
Greetings: hello, nod, bow, peek.
Bounces: hop, boing, double-hop, triple-hop.
Shape tricks: squish, stretch, puff, star, drop, pancake.
Delight: wiggle, giggle, ta-da, proud.
Attention: curious, think, listen.
Rest/reaction: yawn, wake, oops.
Actions must differ meaningfully in choreography, not aliases with changed speed. Existing lab elastic math is a starting point, not a new dependency.

## Renderer integration

Preserve existing createNibbi public API and every call site. New Pocket spring is default when library present. Keep opts.motion='legacy' escape hatch if practical; missing library must not blank Nibbi. Preserve real WebGL textured shader; same body+eye transform incl morphology and registered face-safe bounds. Canvas2D fallback must match pose transform/shape even if simpler texture. Keep GL shader work scissored/bounded, avoid unnecessary fullscreen/offscreen readbacks. Shared mapped eyes + separate gaze/lids; cap combined mood/action eye widening safely. No disappearing eyes, clipped jumps or static permanent shadow.

New API in addition to existing:
- animate(id,options={}): director.play; bool result. UI may request interrupt:true/priority:80 for deliberate tricks.
- animations(): catalog (read-only descriptors).
- stopAnimation(): director.stop smooth settle (immediate spatial stop in reduced).
- setMotionEnergy(value): clamp0..1.5 (default1).
- setTextureMode('flow'|'boil'): slow continuous vs deliberately stepped ink (flow default).
- destroy(): cancel RAF/listeners and release GL resources, idempotent.
- opts.manual=true and api.advance(ms): deterministic test clock/manual render, no RAF; only test harness uses it. Production uses own RAF and visibility pause.
- state() preserves old fields and adds motion: {enabled,action,phase,elapsed,duration,queue,mood,pose,energy,texture,reduced}; bounds:{left,top,right,bottom}; particle count / diagnostics if practical. State reflects current rendered pose. A normalized map diagnostic / eyeCenters useful to QA.

Integrate existing hop/shake/splash/setMood with director; no old+new double impulses. Gate ALL motion/effects in reduced mode, clear ongoing particles, snap layout/fade changes and redraw correct ink+eyes at new positions. Pause hidden tab simulation; do not accumulate wall-clock expiry then resume jumping. Stable springs/damping and no shake feedback accumulation. Small/talk positions attenuate based on radius AND available top/side room; do not change base radius frame-by-frame. Dynamic mirror crop must contain full deformed body through all actions, with stable framing; companions get small same-style motion and tinted ink. Deformed hitTest follows character. Fallback+context-loss should remain usable. No API/state NaN.

## Parent app wiring

A compact accessible Tricks panel exposes all24 plus energy, stop, reduced indicator. Keep hero visible in mobile preview, no blocking chat on desktop. Character click varies through a small Pocket response pool. Existing mood/audio/state wiring uses new director. Add library to Vite static copies and offline shell. New UI only, no backend/account/network changes. Test current app through testBackend isolated fixture and Node/Vite project tools.

## Acceptance

24 catalog actions present, visually distinct, clickable in actual app. Pure math/scheduler regression tests incl refresh, queue, interruption, stop, area, limits, reduced policy. Browser verify hero/talk/mobile/mirror/companions/fallback, all actions, strongest poses, no eye overlap/clipping/page errors, safe idle, repeated triggers, reduced resize/fade, hidden/resume, existing application regressions. Build/typecheck plus current tests. Produce screenshots/contact sheet and user preview. Real GPU performance/Safari/Tauri only claim if actually measured. No live deployment required.
