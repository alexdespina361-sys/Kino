# ITERATION_JOURNAL

One entry per iteration of the branch `feat/kino-cat` (off main `5cf4704`, PR #27 merged). Every entry says what was wrong, what was done and what else was considered, what was seen, what was run and on what, what regressed or stayed open, the next experiment, and whether the reference research (01) played any part. "Seen" means seen on a sheet, a strip or a real page with the numbers in 05; nothing here is a claim about a real TV. Times are 2026-10-20 evening to 2026-10-21 early morning.

## 1 · The brain, a first drawn cat, and the page around it (`d9d2362`, `94f42cb`, `7ceec8e`, 23:40)

- **Root issue.** A cat has to live on a page that is not a game: it has to find where it can stand on rows of posters, stay out of words and buttons and the focused card, and be gone when a menu opens, without a line of the page's code knowing about it.
- **Technique.** A pure engine: `World` (numbers read from the page) in, one `CatFrame` out, a seeded random stream, virtual time. Standing places are computed by cutting the shelf lines with keep-out rectangles; leaps are ballistic arcs planned from gravity; choice is utility-based with cool-downs; every act has a deadline. A rig (springs, two-bone legs, a ten-segment tail) separate from the painter. A soak that throws bad afternoons at the brain and checks invariants. The page adapter reads the DOM (it does not touch Kino's React state) and the cat is a small canvas that follows the cat, in a lazy chunk, behind four gates that are all closed by default.
- **Considered, not done.** Sprite sheets and video (no art, cannot adapt: 02); a full-screen canvas (ten times the pixels, and it would sit over the page's clicks); reading Kino's components' state (a coupling the page does not need).
- **Seen.** A flat but readable cat walking along the shelves, leaping between rows, resting in a film's corner. The owner's verdict on it: a good start, **not the model they had in mind** (more realistic, more detailed, 2-D or 2.5-D is fine).
- **Run.** 12 e2e tests, unit tests for the settings, flag, governor, hand and picking; thousands of soaked sessions. Chromium, software GL.
- **Regressions / open.** Two liveness bugs found by an e2e repeat under load and fixed (ISSUE_LOG #1).
- **Next.** Replace the painting with a body.
- **Reference research.** High-level only: a companion rests most of the time, has a daily rhythm of mood, reacts to what the viewer does. No code, art, names or formats.

## 2 · A solid cat (`bc5c5e1`, `b934f89`, 00:37)

- **Root issue.** "Not what I envisioned." A drawing cannot show the weight, the foreshortening or the fur of an animal.
- **Technique.** Model offline, draw live. A signed-distance model of a tabby (`scripts/cat/model`) is meshed once into one 340 KB binary with ambient occlusion, a fur length and skin weights for 32 bones baked per vertex. In the browser a small WebGL1 renderer skins it from the **same rig** as before (so all the animation and every behaviour test stand), grows the fur as shells and paints the coat in the fragment shader from the rest-pose position (so every pose and every coat wears the same markings). The renderer checks the mesh header, the extensions and the uniform count and says "no" instead of throwing; the host falls back to the simple cat.
- **Considered, not done.** A bought or downloaded model or a rigged asset (licence, and no way to drive it from the rig); a general 3-D library (size); real fur geometry (cost); WebGL2 (TV browsers); image textures (files to ship and to get rights for).
- **Seen.** A cat with a body: a shaded orange tabby with a white bib and socks, whiskers, a face with eyes.
- **Run.** 3 new e2e tests (the solid cat is drawn and fetched once; no WebGL → simple cat; a broken mesh → simple cat), GL unit tests (finite numbers in every posture, the mesh checks). Software GL.
- **Regressions / open.** The first jaw was a painted line; the tail had rings; the sit was stiff (next entry).
- **Next.** Face and motion.
- **Reference research.** None.

## 3 · A mouth, a body that moves like a cat's (`929f72c`, `acda82b`, `8a02e5d`, `80c8bcd`, 00:59–01:14)

- **Root issue.** The solid cat stood and turned like a statue: no jaw, postures that snapped, a bamboo-ringed tail, a head on a long neck when sitting, hind legs bunched in the air.
- **Technique.** The jaw is its own bone, weighted by **one lip-line function shared by the offline build and the shader**, so the skinned mouth and the painted mouth agree; a yawn shows teeth, tongue and throat and the eyes squeeze shut. Front and rear of the body follow a posture with separate springs (a cat that lowers itself folds its rear first). Sit/loaf lay the tail down; sleeping curls the body with the tail round it; a jump gathers, goes all at once, stretches in the air with the hind legs trailing, and lands in a crouch. Tail angles are kept in one turn so a posture change does not swing the tail the long way round. Tail pieces joined hard instead of soft. Lab tools to judge motion frame by frame (`scripts/cat/record.mts`, `glsheet.mjs film`).
- **Considered, not done.** Pre-authored keyframe clips (they could not follow the page's geometry); morph targets for the mouth (more data than one bone).
- **Seen.** On pose sheets and leap strips: a yawn that opens, a sleeping curl, a leap with anticipation and a landing. Not judged in motion at 60 fps by a person.
- **Run.** Rig tests (finite numbers in every scene however entered or left); engine jumping ×6; GL posture tests. Software GL.
- **Regressions / open.** None new; see ANIMATION_BACKLOG for what is still judged on stills only.
- **Next.** Coats, sizes, more behaviour.
- **Reference research.** High-level only: anticipation and follow-through, "a tail that follows with a delay", eyes before head before body (listed in 01 as general animation practice).

## 4 · Four coats and three sizes (`bfd4a7b`, 01:14)

- **Root issue.** One orange cat is one cat; the owner may want theirs.
- **Technique.** A coat is colours plus how much of each marking the cat has; the shader paints markings from rest-pose position, so a tuxedo's belly, boots and blaze (with an edge, not a blend), a grey tabby's cooler stripes and a calico's patches (a different cap over each ear and eye) work in every pose. Dark fur takes little colour from the light, so dark coats get a cool sheen to show their form. Sizes 0.8/1/1.35 of the screen-derived body. Both are device settings, worn at once, also askable by URL for a look.
- **Considered, not done.** A colour picker (an accessible control for a TV remote is a lot of UI for one ornament); more breeds (a new mesh).
- **Seen.** `evidence/coat-*-views.jpg`. The tuxedo's belly patch is boxy (ISSUE_LOG #11).
- **Run.** e2e 18–19 (coat and size are worn at once, kept for the device, hidden for the simple cat; the address can ask), cat i18n test (every key in en/ro/it, plural forms).
- **Regressions.** The four coat names did not fit a single TV row in Romanian and Italian: laid out two by two (`.tv-segmented-grid`).
- **Next.** Behaviour variety.
- **Reference research.** None.

## 5 · Five scenes and a tabby's stripes (`1676b7f`, `719b666`, 01:31–01:35)

- **Root issue.** Thirteen clips was thin for a "living" cat; the flank's stripes were one stripe repeated fifteen times, a zebra's.
- **Technique.** Scenes are spring-eased overlays on a posture (so they enter and leave softly and work on both renderers): scratching (the hind foot reaches the ear, the knee bends the other way), kneading (paws take turns, the body rocks), sniffing, stalking (a creep: short low steps, pupils wide, tail tip quick), wiggling (rump up, feet planted); a slow blink at the viewer, dream twitches, bunting into a hand. The engine uses them (a poster a few lengths off on the same shelf is stalked, wiggled at and pounced on; it lands by it and sits as if it had meant to), never for a viewer who asked for quiet. Stripes lean back down the flank, thin toward the belly, each rib with its own thickness and length (shader only).
- **Considered, not done.** Any sound (it would have to default to off and never play over a film, and there are no audio files); more scenes than the five (the list of ideas is in ANIMATION_BACKLOG).
- **Seen.** `little-scenes.jpg`, `stalk-wiggle-pounce-strip.jpg`.
- **Run.** Rig tests per scene (the foot reaches the head in a scratch; paws take turns; a creep is slower and lower than a walk; the wiggle keeps feet still; a slow blink is long); engine tests (the afternoon contains every scene; a stalk is always stalk → wiggle → leap → sit on the same shelf; none of them in quiet).
- **Regressions / open.** Cheek stripes read like lashes while grooming (ISSUE_LOG #11).
- **Next.** Check the cost honestly.
- **Reference research.** None.

## 6 · The governor learns the truth (`69dcc86`, 01:52)

- **Root issue.** Found while measuring for 05: on software GL the page ran at **17 fps (1080p) / 31 fps (720p)** with the detailed cat while the governor was told it cost 0.5 ms. The timing call was `gl.finish()`, a flush in Chrome.
- **Technique.** A one-pixel `readPixels` every 30th frame, which makes a browser wait. The governor then sees the card's real time.
- **Considered, not done.** `EXT_disjoint_timer_query` (a GPU timer: not tried, and not something to count on in a TV browser); timing the draw call in JavaScript (the work is asynchronous: it measures nothing, which is what `finish()` did too); judging by `requestAnimationFrame` gaps alone (the governor gets the gap but only uses it to ignore frames that were waited for; a slow page does not say that the cat is the reason).
- **Seen / measured.** Software GL: lean picture after 5–6 s, simple cat after 10–11 s, page back at 60 fps. Real GPU (RTX 3090): the governor stays on the detailed cat at 1.0–1.1 ms, 130 fps, worst gap 8.9 ms: the probe causes no hitch. Slowing the CPU 4× and 6× on the real GPU walks the ladder down as it should.
- **Run.** e2e 16 ("a screen that cannot afford the detailed cat is given the simple one, and keeps it"), `raf-rate`, `gov-watch`, `cat-matrix` (05).
- **Regressions.** A one-time Chrome console notice "GPU stall due to ReadPixels" (ISSUE_LOG #15).
- **Next.** Look at the real page again.
- **Reference research.** None.

## 7 · Settling clear of the names under the cards (`c2abd52`, 02:14)

- **Root issue.** Real-page screenshots at phone sizes and on lower rows showed the resting cat sitting over "17 min left" and the next card's title; only the focused card was protected.
- **Technique.** The page tells the cat where the words are (`World.soft`, as wide as the words); a cat about to settle scans its shelf within 3.5 body lengths for the spot where its body, *in the posture it is about to take* (sit 0.72 body lengths high, loaf 0.46, curl 0.4), covers least, if that is at most half of what it covers now; draws are made in the same order as before so a page without words is the same cat (checked: identical checksums over 360,000 frames).
- **Considered, not done.** Making names keep-outs (a shelf would be cut to nothing and the cat could not cross it); choosing the *surface* by what it covers (changes where the cat lives; left open: ISSUE_LOG #9); name-aware hop landings (routing; #10).
- **Seen.** Real page: 0 covering seconds in a minute at 1280×720 and 844×390; 8 of 27 at 1920×1080, all on the floor line under the last row where the names run edge to edge.
- **Run.** 9 new unit tests; mutation check (switching `restSpot` off, or the engine's use of it, fails the tests); the bad afternoons with names on the page: 7 variants × 50 seeds × 600 s, 0 violations; e2e 20/20; unit 111/111.
- **Reference research.** None.

## 8 · A button for nothing, and a run that is a gallop (`c6e1865`, `8e5a1cb`, `9d980d1`, 02:40–02:52)

- **Root issue.** Two things found by reading and measuring, not by the owner. (a) When the governor ran out of ladder, or the cat's file never came, the host took the cat away but the corner's button stayed and opened a settings panel for a cat that was not there. (b) The backlog said "the gallop is a faster walk, not a bound"; measuring the largest one-frame step of any foot over a script of gait changes then showed that changing gait switched stride, duty and lift in one frame, so a paw jumped 0.26–0.40 of the body's length between two frames (a steady walk moves one 0.09).
- **Technique.** (a) `setCatGone`: one flag the button's hook reads, set when the host halts, when its file fails or when mounting throws. (b) Both gaits are pure functions of the ground covered (the odometer), so a stance foot stays fixed on the ground whatever the speed, and the weight of each gait is a spring (the creeping walk, and the gallop in at 5 Hz and out at 4 Hz): a change of gait is a blend, never a switch. The gallop itself: the paws land in pairs (the two hind, one a little after the other, then the two front, the body in the air between), each down for 30 % of the beat; the back gathers (arched, short) and stretches (long, flat); the head reaches out and the ears go back; the tail streams on a spring of its own because following the gallop's own spring whipped its tip 0.13–0.21 of the body in a frame.
- **Considered, not done.** A baked run cycle (the feet would slide on the ground whenever the speed was not the one it was made for); a longer bounding gait for a very long run (the one beat is enough for the distances the page has: a shelf, or from the corner to a card); judging transitions by eye on a strip (the pops were 1/60 s long: a strip hides exactly what a person would see).
- **Seen / measured.** Largest single-frame step of any joint over walk → run → walk → run → stand → walk → stalk → wiggle → walk: old 0.26–0.40 of the body, now 0.113 at most. The run sheet (`glsheet.mjs run`) shows the pairs landing and the body stretching; a gallop is a pattern I can judge on a strip but not feel in motion.
- **Run.** Two new rig tests that fail on the old rig ("gallops when it runs…": the pairs, the stretch, the tail streaming; "does not jump when it breaks into a run, slows to a walk, creeps up on something or stops…": no joint moves more than 0.2 of the body in a frame); two new e2e tests for the dead button, each failing without the fix; the full cat e2e (22 passed), tsc, 102 unit tests in `src/client/cat`.
- **Regressions / open.** None found. Not judged in real time by a person (ANIMATION_BACKLOG).
- **Next.** The long run of the real page (entry 9).
- **Reference research.** None.

## 9 · The governor counts the cat, not the card's reply (`118fb69`, 03:05)

- **Root issue.** A 12-minute run of the real page on the RTX 3090 (`cat-heap`: heap, nodes, listeners, art, quality and fps every 20 s) was flat where it should be (heap +0.016 MB a minute over the second half, 1387 nodes and 446 listeners at the start and at the end, no errors) but the governor stepped down to the lean 30 fps picture at about 150 s, while other jobs were using the machine, and never came back.
- **Technique.** Measured the read-back on its own (`probe`): 0.65 ms with nothing drawn, 0.67 ms after the whole cat. So of the 1.0–1.15 ms the governor read on a card that runs the page at 130 fps, nearly all was the card's reply time and the cat's own work on it was about 0.1 ms. A timed picture now asks the card twice, at once: for what it has been given, then with nothing left to do; the second answer is the reply time alone and the difference is `gpuMs`, what the cat cost the card. The host smooths it as it smoothed the wait.
- **Considered, not done.** Raising the budget (it would hide a misreading with a number); making the step back up easier (the reading was wrong, not the rule); `EXT_disjoint_timer_query` (still not tried, and not something to count on in a TV browser).
- **Measured.** Real GPU: 0.3–0.5 ms at ~130 fps; with vitest, a lab render and tsc running in a loop for three minutes the cat stayed at full quality at 121–132 fps (heap slope 0.07 MB a minute). Software GL, where the card really is the limit: unchanged, the lean picture after 5 s and the simple cat after 10 s, the page back at 60 fps.
- **Run.** The full cat e2e (22 passed) including "a screen that cannot afford the detailed cat is given the simple one, and keeps it"; tsc; 102 unit tests.
- **Regressions / open.** A real TV's reply time is unknown (05, "Not tested"): if it is long and the cat's work is small, the cat now stays; if the cat's work is long, the ladder still steps down.
- **Reference research.** None.

## 10 · An independent review, and what it found (`cb4d959`, `42abb20`, `8eb2d2b`, `8e173ad`, `ec44363`, 03:15–04:16)

- **Root issue.** Until now every claim in these reports was the author's. A reviewer given the branch and the plan, and none of my conclusions (a subagent, read-only, with its own scripts and pictures), scored the work **27/50 with 0 P0, 3 P1, 5 P2 and 7 P3**: "safe to merge default-off, not ready to switch on". Its three P1s were things I had written down as true and were not. The cat was drawn *over* the subtitles (`z-index: 1` against the captions' none; my test and report 05 said otherwise). In a subtitled film it faded out and back with nearly every line. And it covered names with its tail and its nose, because the brain planned with boxes much smaller than the cat it drew (sitting 0.72 body lengths high against 1.13 measured).
- **Technique.** Measure the cat the way the reviewer did, and plan with what is measured. (1) In a film the layer sits straight after the picture at `z-index: 0`, so everything the player draws after it is over the cat, and nothing in the player is a keep-out: the cat has nothing to flee from. (2) The cat's reach is *measured from the pixels it is drawn with*, per clip, per phase of the clip and per height band, into a table (`engine/shape-table.ts`) that a script writes (`extents.mjs --write`) and the same script proves (`--check` fails if any picture reaches further than the table says). Ledges, resting places, the keep-out check, the click box and the covers-a-name figure read it. (3) The governor is told only what the cat costs: the page's forced layout is not the cat's, nor is the card's reply time; the page is read at most a tenth of the time; the card is asked what a picture costs 1.5 s after a change and every 5 s after that, not at every 30th frame; the better picture comes back at 0.75 of the budget over 600 frames. (4) The cat's own layer no longer wakes the page watcher; halting is the whole teardown; the features call is asked again; a refused GL context is given back; a sleeping cat in a film is painted every 40 ms; the button says it opens a panel and the panel says what the cat found.
- **Considered, not done.** Raising the budget (it would hide a misreading with a number); making the captions soft keep-outs (the cat would still dodge each line); a larger invented box per pose (wrong again the next time the cat changes: the table cannot be wrong in the cat's favour any more, `--check` fails); `EXT_disjoint_timer_query` (not something to count on in a TV browser).
- **Seen / measured.** Told of the names, a resting cat hides 0.06 of a body-square of them, one that is not told 0.20 (the floor for a loaf on such a shelf is 0.16, so the test says that and no more). A film with a two-row line every 4 s and the controls up once: the cat is drawn the whole time and never comes or goes. The governor on the RTX 3090 with a key every 400 ms: full quality at both sizes (05).
- **Run.** Both film tests fail with the layer at `z-index: 2` (checked); a press on the cat against one beside it; a page that sits is read twice a second; the halt leaves nothing behind; the governor's give-back thresholds; the button's aria. All 25 end-to-end tests pass.
- **Regressions / open.** The focused card still has the cat over it for about 630 ms before it leaves (ISSUE_LOG #37); the two small chunks stay split (#38); the simple cat is still a different cat (#13).
- **Reference research.** None.

## 11 · A cat that looks like a cat (`e7398c2`, 04:48)

- **Root issue.** The owner's words again, "not what I envisioned … more realistic or more detailed, 2-D or 2.5-D is fine", and the reviewer's: plastic and toy-like, with a dark dotted halo. Entry 2's cat was a smooth shaded body with a fringe, stripes that repeated like a comb, a cartoon face and spindly legs.
- **Technique.** Hair, not a surface: fur shells in which every strand has its own length (in tufts), thins towards its tip, leans along a flow field (down the body, outward along the tail) and sags a little; the edge of the coat is a scatter of hairs; a light band follows the hair's direction, scaled by how light the coat is (the first version put the same shine on a tuxedo and blotched its black). Stripes that are irregular, split and fade into the belly, each stripe's edge a scatter of hairs. A cat's face: smaller almond eyes, a leather nose, a quiet mouth line, cheeks and brows, ears with an inner shape. Anatomy: a round haunch and a tapered thigh (softly skinned, because a hard weight made it crease in the gallop), thicker legs. The mesh is made from a scene of shapes (smooth-unioned ellipsoids and round cones) by surface nets in about a second (`scripts/cat/model`): 12 K vertices, 335 KB.
- **Considered, not done.** Image textures or fur cards (files to ship, and to own); real hair geometry (cost); a second, finer mesh for large screens (the budget is the point); a modelled or bought cat (licence, and nothing to drive it from the rig).
- **Seen.** The pose, view, scene, face and detail sheets, all four coats (`evidence/`). The owner has not seen this version.
- **Run.** The GL tests (finite numbers in every posture); the silhouette table made again and checked.
- **Regressions.** The tuxedo blotched (the first shine ignored the coat: fixed within the iteration); the haunch creased in a gallop (the weights were softened); the lean picture, with one layer of hair, was no fur at all (next entry).
- **Reference research.** None.

## 12 · A leap that looks like one, and a lean fur that is still fur (`fbea2c6`, 04:48)

- **Root issue.** On the new cat the air pose was a thin stretched body with tangled hind legs; and the lean picture (what a screen that must take the fur down a step is given) had one layer of hair, which with the new fur was none.
- **Technique.** A shape of its own for the air: the body as thick as a standing cat's, the forelegs reaching out, the hind legs trailing in a line with the foot carrying on from the shin (no part of a leg is stretched to get there); on the way down the hind legs come forward under the cat and the forelegs reach for the ground. The lean picture keeps three layers.
- **Seen.** "jump: air" and "jump: coming down" on the pose sheet. Not in motion.
- **Run.** Silhouette table made again (a coming-down leap is in it), rig tests.
- **Reference research.** None.

## 13 · A hole in the cat's far side (`adf16a9`, 04:56)

- **Root issue.** On a film strip of the cat facing left, a black round dot sat on the far haunch.
- **Technique.** Diagnosis by elimination. Not the shader's flow vector (a guard did not remove the dot); not the card (software GL drew it too); the normal, occlusion and bone views all showed it: so the mesh. An ASCII map of the mesh's triangles per side showed a patch on the far side with none. The mesher's lattice reached to z = -0.2 on the far side and the far haunch is at 0.19; the surface fell into the first layer of cells, where no quads are made. The lattice is now symmetric.
- **Considered, not done.** A shader patch that hides holes (it would hide the next one).
- **Seen.** Two left-facing cells now in the pose sheet, so the far side is looked at every time.
- **Run.** The silhouette table made again (25 lines moved) and checked; all 25 end-to-end tests.
- **Lesson.** A cat is not the same facing both ways in a picture: look at it facing both.
- **Reference research.** None.

## 14 · The pick uses what the library knows; the curl's back is a curve (`ec8d0e8`, `0da996b`, 05:02–05:09)

- **Root issue.** (a) The reviewer's lowest mark but one: the cat's pick knew nothing of the viewer ("a weighted-random poster already on screen"). (b) Looking at the face sheet at five times the size showed a flat shelf with a hard corner on the sleeping cat's back, in the pose seen most in a film.
- **Technique.** (a) The library already turns the viewer's history and ratings into rows ("Because you watched …", "Because you loved …"); a title on one is 2.5 times as likely to be the pick, and for "anything" the card gives that row's own words as the reason. Such a row is still not a shelf of a kind (someone in the mood for something scary is not offered a title for being on it). (b) A skinning audit on the processor (`stretch.mts`: the mesh worn on the bones of each pose and the edges that grow most; `profile.mts`: the back line and its sharpest bend): the shelf is where the chest, which the curl makes thick, meets the neck's base, which it leaves thin, and the skin between took its bone over too short a distance. Those pieces and the neck now share their skin over a wider stretch.
- **Considered, not done.** (a) A second opinion of the cat's own about the viewer's taste. (b) Changing the curl's numbers for the neck (tried: no change in the shelf); another spine bone (a new mesh and rig).
- **Seen / measured.** (a) With the boost off the new test counts 20 picks in 600 (a fair draw among thirty); with it, about 48. (b) The sharpest bend of the curled back line 0.243 → 0.149 of a body length; the other poses within a few thousandths; the pose, run and scene sheets as they were.
- **Run.** One new unit test and one new end-to-end test (it fails without the plumbing); the silhouette table made again.
- **Reference research.** None.

## 15 · A cat that has settled keeps its tail on the screen (`fa5b509`, 05:30)

- **Root issue.** The final soak failed in 6 of its 350 sessions on the invariant "not cut by the edge of the screen for more than 2 s": a loaf 62 px from the right edge of a 1366-px screen, its tail 25 px off it. Two causes, both mine: a window made smaller puts the cat down at the very end of a shelf, and that end is worked out for a cat on its feet, whose tail is short (lying down it reaches 1.2 body lengths); and the place for a long sleep was chosen for the curled-up cat, while its first seconds are spent lying out and treading.
- **Technique.** A cat that has settled (rest, sleep, a scene with no thing to look at) counts the two edges of the screen, less a twelfth of its length, as zones, as it counts the words: it turns round if that puts the tail on the screen, else steps aside as for any zone, else goes. The place for a sleep is chosen for the worst of the postures it goes through (`settledCost` takes a list: lying, treading, curled up).
- **Considered, not done.** Shortening every shelf by the longest posture's reach (a cat that is walking would never get to the end of a shelf); a special case in the soak's invariant (it would hide the defect).
- **Seen / measured.** A new engine test on a floor-only page (a cat at the end of the shelf, the window made smaller: it is turned round, with no hit on the edge zones) fails with the rule off (checked); a second test for the list of postures. The soak at this head: 150 seeds × 7 variants, 1,050 sessions of 10 virtual minutes, 0 violations (05).
- **Run.** 124 unit tests, the soak, all 26 end-to-end tests.
- **Reference research.** None.

## 16 · In a film the cat rests between the groups of the controls (`cfea260`, round 2)

- **Root issue.** Found by magnifying the film pictures for the evidence (ISSUE_LOG #40): at 1280×720 the cat's corner was behind the right group of the controls, so a waking cat's head was behind the fullscreen icon. The layer is under the controls, so it was never over a button, but a face in a button's icon is clutter.
- **Technique.** The perch is the stretch of the controls' row that has no button in it: the page reader takes the rectangles of the row's two groups (they are in the page whether the controls are up or not), and `perchesFor` (host/perch.ts) takes the widest gap between them, less the longest reach of the postures a film takes (loaf, curl, sit, knead, stretch, tail included) on both sides. Where the row leaves no such stretch (fewer than two groups, groups on two lines, a gap narrower than a third of the cat's length) the perches are the two corners as before.
- **Considered, not done.** Moving the cat above the controls' row (the film's picture is the viewer's, and captions live there); drawing the cat over the controls (it would cover buttons, which the plan forbids).
- **Seen / measured.** Three unit tests: the cat's silhouette (`shapeHits`) against each group in every posture a film takes, facing either way, at both ends of the perch; the corner fallback for each of the four reasons; `widestGap`. The mutant without the margin fails two of them (checked). The film end-to-end test now asserts the cat's body is between the groups, with the controls up or down. Pictures `film-1280x720-*-between-the-groups.jpg`: the head is in the clear in the paused state.
- **Run.** tsc, 116 cat unit tests, the two film end-to-end tests.
- **Reference research.** None.

## 17 · A cat that has to settle on a shelf of names goes to a shelf that has room (`b622077`, round 2)

- **Root issue.** ISSUE_LOG #9: on a row whose names run edge to edge the cat could rest over a name, because `settle` only looks along the shelf it is on, and when every place on that shelf would cover a name it stayed.
- **Technique.** When the best place of the cat's own shelf would still cover more than a tenth of a body's area of words, a cat that is free to roam (not quiet, not reduced motion) and has not just done it (a 12–25 s cool-down) goes with four chances in five to another shelf whose best place is a good deal cleaner (`cleanerPlace`: at most 0.4 of what the present place costs, and at most 0.04 of a body's square), by the ordinary route (walk, hop, leap), and settles there. The new random draws are made only when the shelf is untidy, so a page with no names, or a tidy one, plays out exactly as before.
- **Considered, not done.** Choosing the shelf for every rest (it would make the cat travel far more and change where it spends its time); hiding the names (the page is not the cat's to change).
- **Seen / measured.** Two engine tests on an uneven page (one row of names edge to edge, one with gaps): the share of resting time spent over a name falls from 24 % to 4 %, the row with no room is left, the other row gets more than 30 % of the resting; and a quiet cat, or one asked for less motion, makes no walk, run or jump at all. The first fails with the rule off.
- **Run.** The engine tests, tsc.
- **Reference research.** None.

## 18 · The cat's settings are one row, and the TV's settings page fits again (`f47af63`, round 2)

- **Root issue.** Found by running the existing TV and account end-to-end specs with the cat switched on for the first time: 11 friends specs failed, because the cat's inline settings group, offered once the host has the cat, made the TV's settings page taller than the screen and the tap-to-pause layer lay over the Back button. In production, with the cat not offered, nothing was wrong, which is why no earlier run saw it (even the default run: the specs ran with the cat off).
- **Technique.** The cat's settings are a row in the third column of the TV's settings page that opens a page of its own (`tv-cat-open`, `TvCatSettings`: what it does and how it looks in two columns, the page's own Back), the way Account and Friends already work. Strings in three languages.
- **Considered, not done.** Shrinking the group (it overflowed at 720 p with six lines in Romanian); making the page scroll (the TV's pages do not).
- **Seen / measured.** A new end-to-end test measures the settings page at four TV sizes (grid top at or below 0, its bottom inside the window, the Back button not covered); it fails on the old layout. The second batch of the TV, account and friends specs with the cat on: no failures (see 05).
- **Run.** The cat, account and friends end-to-end specs, tsc.
- **Reference research.** None.

## 19 · Dark coats are fur (round 2)

- **Root issue.** ISSUE_LOG #11: the tuxedo's white belly was a boxy band with a straight edge and the black fur took the light like plastic, a flat shape with one broad cool band of shine.
- **Technique.** In the fragment shader only (no model, no animation, no silhouette change): the tuxedo's boundary rises and falls along the flank and differs on the two sides (a sine of the length of the body and a low-frequency noise, signed by the side), and in the fur's layers it is a scatter of single hairs; the albedo of a dark hair is warmer and lighter towards its tip, strand by strand; the cool sheen on a dark coat is narrower, glitters per strand (each strand's own factor) and varies in patches the size of a hand.
- **Considered, not done.** A normal map for the lumps (the haunch and the shoulder are still smooth masses at three times the size: the next thing to try); a dark-coat-only extra shell layer (cost).
- **Seen / measured.** Before and after at three times the size, in four views on the real GPU (ANGLE on the RTX 3090), for the tuxedo and the grey tabby, and the ginger and the calico checked for a side effect (none visible: the stripes and the patches are as they were); the four pictures `coat-*-views.jpg` in the evidence folder were made again.
- **Run.** The lab renders only (the shader is not covered by a unit test; the software driver is checked with the end-to-end run).
- **Reference research.** None.

## 20 · The landing of a hop is chosen by what it covers (round 2)

- **Root issue.** Entry 17 left the real page unchanged: measured again against it (the page's own pixels against the names' text, by act and by surface) the cat still hid a name in 124 of 352 resting samples at seed 11 / 1280×720, and every one of the 33 samples over a tenth of a body-square was a sit on the floor of the screen after a hop. The TV's rows are all alike (names under every card), so there is no cleaner shelf to go to; the floor of the screen is the one place with the names right at its feet, and a hop to it lands at a chance place (a random fraction of the shelf) in the posture drawn first.
- **Technique.** The hop's plan chooses the pose and the length of the rest first, then the place: the posture is replaced, if its best place on that shelf would hide more than a tenth of a body-square, by one that would hide at most half as much (`cleanestPose`, used for a rest and for a stroll's pause as well); the place is the best one near the chosen (`settle` on the *target* ledge: `settling` and `spotFor` take a ledge now); and the route is made to that place, not to the random one. No new random draws (the three that the plan always made are made first), none at all for a viewer who asked for quiet.
- **Considered, not done.** Leaving the floor out of a hop's choices (it is the cat's home when nothing else is on the screen, and a good perch under the controls of a film); making the first seat, the seat by the focused card and the end of a pounce choose by what they cover (they carry a meaning of their own).
- **Seen / measured.** On the real page, 120 s at three sizes (ISSUE_LOG row 9 of the Fixed list): none of the resting samples is over a tenth of a body-square (33 of 352 before), worst overlap 191 px² (1,481 before). New test on the captured TV page (`tv-library.fixture.ts`, taken from the cat's own `?cat=debug` handle, `world()` is new and only there): 0.028 of the resting on its floor hides more than a tenth of a body-square, 0.095 with the landing left to chance (the mutant fails it, checked).
- **Run.** tsc, 119 cat unit tests.
- **Reference research.** None.

## What the later iterations should do first

1. A person should watch it on a real TV or Fire Stick with `?cat=debug` and report `art`, `quality`, `cost`, `fps` (05, "Not tested").
2. Judge motion at real frame rates (every entry above judged stills, strips and numbers; nobody has watched the cat move).
3. Decide ISSUE_LOG #10 (the seats that are not chosen by what they cover) and #13 (the simple cat is a different cat from the detailed one).
