# Round 5 — five thoughtful versions

*Five versions of Nibbi built for the goal: "5 new visual versions for Nibbi — I want to make sure Nibbi is as thoughtful as possible."*

Open: `node design/character-lab/serve.mjs` → **http://127.0.0.1:4538/design/character-lab/round5/**. Overview: [`evidence/matrix.png`](evidence/matrix.png) · reduced-motion stills: [`evidence/matrix-reduced.png`](evidence/matrix-reduced.png) · per-version sheets: `evidence/sheet-<id>.png`. Independent review: [`REVIEW.md`](REVIEW.md).

## 1. The ask, and what it is really about

Rounds 1–4 asked what Nibbi is made of (style, technique, premise, toy). This round asks what Nibbi *does with its attention*. "Thoughtful" is read the way [`docs/PERSONALITY.md`](../../../docs/PERSONALITY.md) defines the character — "an observant, quietly opinionated ally", "notice specifics rather than announcing empathy", "comfortable with silence", "own the exact error" — and translated into things a body can do. The five faculties that came out of that reading are the five versions:

| faculty | what it means for a body | version |
|---|---|---|
| attention | looks before it moves; holds a gaze; checks in | **Regard** |
| deliberation | weighs both sides before settling; never snaps | **Keel** |
| memory | what just happened stays visible for a while | **Tide** |
| focus | attention has a location you can see | **Contour** |
| patience | turns toward you and stays; the least motion that still answers | **Pebble** |

Each version is one faculty pushed as far as a body can carry it, so the five can be compared on *how* they are thoughtful, not only on how they look. Four rules are shared by all five, because they fell out of every faculty at once:

1. **Eyes first, body second.** Every cue moves the eyes at once and the body 160–200 ms later. The pause is short enough not to stall (the personality doc says answer first) and long enough to read as noticing.
2. **The person is to the left.** Listen leans, looks or turns toward where the conversation sits beside a 24 px avatar. The harness measures it.
3. **No fidgeting.** Idle, listen and think breathe, blink and shift gaze; they never churn. Budgets are in the contract and measured.
4. **Error is owned.** The body looks at the failure first, then looks the person in the eye and stays there while it sags, tips or stains. It does not hide and it does not bounce back cheerfully.

## 2. The five versions

| | Version | Faculty | What it actually is | What it does that a thoughtless body would not |
|---|---|---|---|---|
| 01 | **Regard** (`regard`) | attention | today's fuzzy blot with a fixation/saccade gaze model (1–4 s fixations, 40 ms saccades), weighted upper lids, pupils that dilate with interest | fixes on the person and holds; looks up-left to recall then up-right to compose with lids half down; glances up from the work every five seconds; looks at the failure, then at you; looks at your finger before it reacts |
| 02 | **Keel** (`keel`) | deliberation | a rigid pendulum on a curved base (a roly-poly): one angle, a restoring torque from the low centre of mass, damping per moment; pupils counter-rotate so the gaze stays level | rocks left (recall), holds, rocks right (compose), holds; holds a lean toward the person against its own weight; is knocked nearly over by an error, stays, then rights itself and faces you; success is one push and a few decaying swings |
| 03 | **Tide** (`tide`) | memory | a 72 × 76 diffusion–evaporation field under a spring-posed wet body; the body deposits ink where it is, a second slower field takes marks | a listening lean leaves a lean-shaped stain; a hop leaves a ghost where it was; the error drip stays on the paper for half a minute; your finger writes a wet trail that soaks in; sleep dries the paper and sharpens the edge |
| 04 | **Contour** (`contour`) | focus | nested curves interpolated between the body outline and a small ellipse at a movable summit, drawn as paper-coloured cuts through solid ink; summit, ring count and spacing are the state | the summit slides toward the person and the lines tighten; think lifts it to the crown with eleven tight rings; work is a steady inward flow of lines; error breaks one contour on the failure's side until the eyes are back on you; a touch pulls the summit to your finger, then it eases back |
| 05 | **Pebble** (`pebble`) | patience | a lit matte stone with a faked three-axis head — yaw slides and foreshortens the eyes, pitch raises or lowers the face, roll tilts the stone — eased, never sprung, every turn ending in a hold | turns toward the person and holds for as long as they talk; think is face up and one slow turn from side to side over ten seconds; work looks down and up at you every six seconds; error turns away, then turns back; let go of it and it turns back to you before it rests |

All five keep the theme constants — ink on cream paper, two canonical eyes, no mouth, no limbs — and all five share the same drawn upper lid (half down is "considering", up is "interested"), so the lid is a through-line rather than a per-version trick.

### What each one looks like

**Regard** is today's Nibbi. The only visible change at rest is the lid and a pupil that opens a little when the person speaks. Everything else is timing: the eyes land first and the body follows. At 24 px the lean and the closed-lid sleep carry; the lid and dilation are gone. It is the least visually new version and the one with the most behaviour.

**Keel** is a wider, lower, heavier Nibbi with a crisp edge and a thin wet ring under it. Nothing is placed; everything is pushed, so every state is a tilt with lag. The still that sells it is error: knocked 25° over, eyes on the failure, and a second later upright and looking at you. The risk is the silhouette: a roly-poly is a toy, and round 4 was the toy round.

**Tide** is a soft-edged wet body inside a mottled halo of its own recent positions. At rest the halo is symmetric and reads as a glow; the memory shows when something happens — the ghost under a hop, the ring after a success, the drip after an error, the trail under your finger. It is the most conceptually thoughtful version and the one most at risk of reading as blur.

**Contour** is a solid ink body cut by cream contour lines that gather around one point. It is the only version whose *think* and *listen* stills are unmistakable without motion: the lines crowd at the crown, or slide toward the person. It is also the furthest from today's look — a woodcut or a fingerprint before it is Nibbi — and at 24 px the lines are gone.

**Pebble** is a matte river stone with a soft light on its upper left and a shadow on the paper. It moves the least of the five. State lives almost entirely in the eyes and the turn of the face, which makes it the calmest thing in the lab and the hardest to read in a chat row.

## 3. How to judge them

1. **Type in the composer.** Focus cues *listen* on all five; Enter cues *think* for a beat that scales with what you typed; the reply lands as *hello*. Does it listen while you type, take a beat, then answer — or does it twitch?
2. **Leave Think running for a minute.** Considering, or fidgeting?
3. **Error after Success.** Owned, or hidden? Does it come back to you?
4. **Squint at the chat strip.** 24 px beside text still decides. Can you tell it is paying attention?
5. **Reduced motion on.** Is a considered still left?

## 4. Measured

From `tech.test.mjs` (local Chrome, software rendering; not a device benchmark). *Attention* is the ink centroid at listen's still, in R, left of idle's (gate ≥ .05). *Calm* is the mean pixel change over 2 s (gates: idle .02, listen .02, think .025, work .03). *Beat* is the time until the first visible change after `cue('hello')`; it captures the eyes moving, which is the point — the body's own beat is a constant per version (Regard 180 ms, Keel 180, Tide 160, Contour 160, Pebble 200).

| | Regard | Keel | Tide | Contour | Pebble |
|---|---|---|---|---|---|
| attention shift (R, left) | .19 | .12 | .14 | .11 | .14 |
| calm · idle | .012 | .006 | .006 | .004 | .015 |
| calm · listen | .017 | .000 | .003 | .002 | .017 |
| calm · think | .002 | .020 | .018 | .019 | .017 |
| calm · work | .001 | .013 | .009 | .003 | .010 |
| beat to first visible change (ms) | 100 | 33 | 33 | 17 | 50 |
| hero step+draw (ms/frame) | .07 | .02 | .50 | .06 | .02 |

Reading the numbers: Keel's listen is perfectly still because a held lean is a fixed angle; Regard's listen moves the most because it blinks slowly and re-fixates. Every version's think sits under the .025 budget with Keel closest to it (a ±.08 rad rock). Tide is the only version above a tenth of a millisecond per frame (the field), and still an order of magnitude under budget.

## 5. First reading (author's, from the sheets and the lab — not a decision)

- **Most thoughtful in motion**: Regard. The gaze lands, holds, and the body follows; the check-in glance during work and the look-you-in-the-eye after an error are the two behaviours people will notice without being told.
- **Most thoughtful in a still**: Contour. Listen and think are unmistakable in one frame at hero size; nothing else in five rounds makes "where is its attention" visible without motion.
- **Calmest**: Pebble, then Keel. Pebble is the version you could live beside for hours; it is also the one that says least in a chat row.
- **Most conceptually new**: Tide. Memory on the paper is an idea no other round has; at rest it reads as a glow, which is the wrong first impression.
- **Most at odds with the round**: Keel. Its weighing is the best *think* metaphor here, but its silhouette is a toy and its rocking is a bounce family the owner has seen twice already.
- **Most "Nibbi"**: Regard, then Tide (same body), then Keel (same profile, heavier). Contour and Pebble change the material.

## 6. Recommendation

**Pick: Regard.** One reason: thoughtfulness turned out to be behaviour, not material — the gaze model, the beat, the check-in, the owned error — and Regard is those behaviours on today's body, so it costs the least to integrate (the production rig already has eyeX/eyeY/blink fields; it needs lid, dilation, named gaze places and the beat) and keeps the character the owner already has.

**What would overturn it:** show five people the *listen*, *think*, *work* and *error* stills from `evidence/matrix.png` at hero and 24 px, for Regard, and ask them to name the moment. If fewer than three of the four are named at hero, take **Contour** — the only version whose attention is legible in a still — and bring Regard's gaze rules with it. If the owner wants a *new look* rather than new behaviour, that is also Contour; Pebble if the new look must be the quietest thing on the screen.

Two things I would not do: ship Keel's silhouette (a roly-poly is a toy before it is a companion), or ship Tide's resting halo without first making it asymmetric — a symmetric glow says "glow", and only an off-centre stain says "was just there".

## 7. Considered and not built

- **Shade** (interiority: the body still, its cast shadow leaning and stretching with the thinking): a beautiful idea that needed a light source with a story, and a shadow that reads as a second creature is worse than no shadow.
- **Breath** (pace as the whole message: held for listen, long for think, a sigh for error): a grammar, not a version; it is folded into all five as the idle/sleep breath and Regard's held blink.
- **Ledger / marks** (a tally, a tick, an underline beside the body): round 1's Typesetter already covers marks, and marks are a panel in disguise.
- **Ink level as attention**: a progress bar in disguise, as round 1's review said of Sketch.

## 8. What this round proves — and does not

Proves: five versions exist, each passes `tech.test.mjs` — mount at 3 sizes, nine moments render and differ from idle at their stills, one-shots return to idle within 4 s, reduced motion converges to pixel-identical frames with distinct think/listen/success stills, touch changes the body, tint recolours, destroy cleans up, and the three thoughtful measures above — and the shell check `verify5.mjs` (all mounted at hero/pill/tiny, cued, the composer drives listen → think → reply, no page errors, mobile 390 px without overflow).

Does not prove: that anyone reads these bodies as thoughtful. The measures are proxies (a centroid, a pixel budget, a timer); the naming test in §6 is the real test. Also not proved: feel on a touchscreen, real-device performance, Safari/WKWebView behaviour, or how any of these sits beside a real conversation for an hour. Nothing is integrated with the app; the production character (Pocket spring) is unchanged. The character lab is not tracked by Git and is not on GitHub.

## 9. Fixes after review

See [`REVIEW.md`](REVIEW.md). This section lists what changed in response once the review has been run.

## 10. Next steps

1. **Run the naming test** (§6) on Regard's four stills before tuning anything.
2. **Tune Regard for a day in the lab**: the lid weights, the check-in interval, the beat, with real text in the chat strip.
3. **If Contour**: decide the ring count at rest (five reads as calm; eight reads as a target) and whether the lines survive at pill size.
4. **Integrate through the existing route**: named gaze places and the beat as `pocket-motion.js` director rules; lid and dilation as two new eye fields on the SDF renderer; keep `?motion=legacy` as the escape hatch. Real-device and reduced-motion QA before any install.
