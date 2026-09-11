# Pocket spring: Nibbi’s animation set

Implemented in the actual app. The installed Mac app was updated and reopened on 2026-09-05; see [the installation record](POCKET-INSTALLATION.md). The backend was not restarted or migrated. See [implementation acceptance](POCKET-SPRING-RESULTS.md) and [browser QA](POCKET-QA.md).

## The experience

Pocket spring is the chosen style: soft wind-up, elastic extension, a weighty little landing and a small after-wobble. Keep the fuzzy ink and low pip eyes. No liquid satellites, generic glossy blobs, limbs, mouths or constant jumping.

The animation library provides 24 deliberate moves:

- **Greetings:** hello, nod, bow, peek.
- **Bounces:** hop, boing, double-hop, triple-hop.
- **Shape play:** squish, stretch, puff, star, drop, pancake.
- **Delight:** wiggle, giggle, ta-da, proud.
- **Attention:** curious, think, listen.
- **Rest / reaction:** yawn, wake, oops.

## Play with Nibbi

There is no Tricks panel or animation chooser. Interact with the character itself:

- **Tap the middle:** hop. Two or three quick taps make a double or triple hop.
- **Tap a different spot:** the crown puffs, the sides peek or look curious, and the bottom squishes.
- **Hold, then release:** a small squeeze becomes a pancake, then springs into a boing.
- **Pull upward:** stretch. Release quickly for a boing, or slowly for a drop.
- **Push downward:** flatten, then puff on release. Drag sideways for a wiggle.
- **Stroke back and forth:** a few gentle mouse strokes make Nibbi giggle. Hover reactions are rare; idle stays quiet.
- **Keyboard:** focus Nibbi with Tab. Enter taps; hold Space to squeeze, then release. Escape cancels the motion, not the conversation. Alt+Space still belongs to voice.
- **Calm motion:** use the existing connection menu’s `motion` button. The saved choice OR the system reduced-motion preference disables spatial and texture motion. The system preference cannot be overridden.

Busy Nibbi gives a small nod instead of a big gesture. A first touch while asleep wakes Nibbi without immediately replacing the wake with a hop. Character gestures do not submit work, send chat, or tidy the conversation. The existing tidy command still works and can get a bow. Direct play outranks small incidental cues, so a soft cue may be skipped while a stronger action is active; it is not saved for a surprise later. Error feedback takes priority over play.

## App integration

Nibbi greets on entry, listens when the composer gets focus, thinks while you type, looks curious when an image is accepted, and nods when you send. Real success and game/work milestones get proud, ta-da, or star reactions. Rest gets a yawn; activity wakes Nibbi. Existing mood and speech hooks remain authoritative, including restrained error feedback and low-energy audio response. Cooldowns and priorities prevent repeated events from turning quiet idle into constant motion.

`public/pocket-motion.js` is the dependency-free classic-script motion library. `public/nibbi.js` owns the textured renderer. `public/lib/pocket-interactions.js` maps direct inputs and semantic app events to the moves. `public/app.js` owns the real activity/mood wiring and calm preference. The former shelf module and CSS are removed. Vite includes the new interaction module in the app bundle; existing text/backend logic is preserved.

The API adds `animate(id, options)`, `animations()`, `stopAnimation()`, `setMotionEnergy(value)`, `setTextureMode(mode)` and diagnostics under `state().motion`. The test harness uses a manual clock. Existing `setTarget`, `snapTarget`, moods, gaze, voice pulse, mirrors and tinted companions remain supported.

A renderer escape hatch is `?motion=legacy`; it is for comparison/rollback, not the selected design. The legacy renderer retains its old motion behavior and is not claimed to have the new motion/accessibility fixes. The marketing/site renderer is separate and is not automatically deployed by this change.

## Verification

Use the project environment from the repository root. Build before browser checks so the isolated fixture serves current assets.

```sh
npm run build
npm run typecheck
PATH="$HOME/.nibbi/bin:$PATH" npm test
node tools/pocket-verify.mjs
node tools/pocket-app-extras.mjs
npm run verify
```

Current interaction evidence belongs in `output/pocket-interactions/`. See [the acceptance record](POCKET-SPRING-RESULTS.md) for final run results and limits. `output/pocket-spring/` keeps the earlier renderer evidence and historical shelf screenshots; those screenshots do not describe the current UX. The optional `~/.nibbi/bin` PATH entry uses the installed ripgrep needed by sandbox tests. No deployment, service restart, or installed-app replacement is part of this implementation.
