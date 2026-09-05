# Interactive Pocket spring — current user correction

User: "get them implemented in the game, no tricks pannel needed, the animations should happen interactively". Replace the previous shelf-centric experience. Actual app: /Users/Matty/Documents/Nibbi. Preserve dirty/concurrent work, no backend edits or deploy. Keep existing 24-action Pocket library and production rig.

## Ownership
- Interaction worker ONLY: new public/lib/pocket-interactions.js and tests/pocket-interactions.test.mjs.
- Parent: public/app.js/index.html, remove old shelf module/CSS, general calm preference row, app event wiring and docs.
- QA worker ONLY: tools/pocket-verify.mjs, tools/pocket-app-extras.mjs, docs/POCKET-QA.md (adapt prior shelf tests). Preserve renderer harness tests and tools/pocket-harness.html. New test files under tools/output allowed.

## Runtime module API
Export installPocketInteractions({nibbi, canvas, getContext=()=>({busy:false,mode:'idle',mood:'idle'}), onInteract=()=>{}}). Return {event(name), setReducedMotion(bool), state(), destroy()}. event is semantic, NOT a selectable animation catalog. No panel, toast tutorial, menu, gesture buttons, backend calls or mood mutation. Parent calls event names greet/focus/typing/attach/send/success/milestone/tidy/wake; existing nibbi.setMood handles think/listen/yawn/oops naturally. Parent exposes nibbiApp.interactions only for diagnostics/test and calls event('greet') at final boot.

Module makes the existing FX canvas keyboard focusable and handles pointer input directly (canvas is full-window at z2, chat UI above it). Hit-test START against the deformed Nibbi; don't react to the empty background or other UI. Use pointer capture, one primary pointer, touch-action none on canvas only, cancel/blur/visibility/reduced/destroy clears timers+capture+combo. Do not set app target/layout or mood. Pointer remains free to drive native gaze. Keyboard Enter = tap; Space press/release = hold; Escape cancels, do not let character controls bubble into chat shortcuts. Keep Alt-Space voice shortcut. A small focus ring following body bounds is fine; no visible new control panel. Legacy renderer missing animate must not throw.

Interaction mapping (24 actions organically reachable across direct input + app events):
- center tap hop; two/three taps within ~550ms double-hop/triple-hop; explicit taps outrank previews. First greet uses hello.
- crown tap puff; left-side peek; right-side curious; lower/foot tap squish. Use normalized hit position and safe dead zones.
- press preview squish after ~160ms, long hold pancake after ~650ms; release long hold boing.
- upward pull stretch; fast upward release boing, slow upward release drop. Downward drag pancake, release puff. Horizontal drag wiggle. Motions scale thresholds to radius, not fixed device px. Do not repeatedly restart clips every pointermove.
- gentle back/forth mouse strokes over body (>=3 meaningful direction changes) giggle, cooldown ~2s; occasional hover-entry curious/peek, cooldown >=6s. No timers that randomly bounce at idle.
- event greet hello; focus listen (small); typing think (small, cooldown >=5s); attach curious; send nod; success rotates proud/ta-da/star; milestone ta-da/star; tidy bow; wake wake. Existing mood sleep->yawn and error->oops complete coverage. Busy direct interaction is a small nod, never starts large gestures or changes actual work state.

Use rate limits, bounded/coalesced previews, no deferred actions after cancel/reduced, no accidental legacy click/dblclick action duplication. Parent removes old FX click/dblclick/contextmenu handlers (double tap no longer tidies the conversation). Parent still owns pointermove gaze/activity handler. Return state diagnostics for tests (lastEvent,lastAction,holding/etc) but tests must use real DOM events for browser acceptance. Do not claim every action tested merely by calling event() manually; pure policy test can cover mapping, browser should cover real paths.

## Parent integration
Remove imports/install/UI/state/layout hooks for pocket-tricks/pocket.css and #st-tricks. Replace window.nibbiApp.tricks with interactions. Calm preference stays in existing connection menu as #st-motion, OS OR saved local preference; not a trick selector. Parent events at real composer focus/typing, image accepted, send, actual success/milestone, tidy, wake from sleep, greeting. Keep setMood and audio envelopes source of truth; no timers that announce success after errors or while hidden.

## Acceptance
No shelf/control catalog in actual app or built assets. Direct click/touch/hold/drag/flick/tickle + keyboard respond on Nibbi, blank background/UI don't. Natural game/app events respond without manual chooser; calm honors OS+local. Cancel/outside release/visibility/busy safe. Native npm build/typecheck/tests + old app regression and adapted current app browser checks. Existing 223 renderer check remains valid if rig/library unchanged. Actual desktop/mobile screenshots and input sequence evidence, not old shelf shots.
