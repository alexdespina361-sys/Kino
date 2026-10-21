# ANIMATION_BACKLOG

States, as the brief defines them: idea → specified → assets ready → implemented → integrated → unit tested → scenario tested → visual reviewed → **accepted**. "Accepted" is the owner's word, not mine: **nothing here is accepted yet.** "Visual reviewed" below means looked at on the lab's sheets and strips (`evidence/`) and on the real page by the author; the independent review is summarised at the end. There are no "assets" to be ready for the motion: the cat's body is one mesh (derived from a free model, 04) and every animation is worked out in code from a skeleton, so there is no clip file that can drift out of step with another.

Unattended behaviour on the made-up library page (20 seeds × 30 min, no viewer input, default settings, the final engine): asleep 38.8 %, sitting 17.7 %, walking 12.4 %, standing 6.4 %, lying (loaf) 6.0 %, little scenes 14.2 % (groom 3.6, stretch 3.2, knead 2.6, sniff 2.0, scratch 1.6, peek 1.5, shift 0.7, wiggle 0.6, yawn 0.4), leaps 1.5 % (44 an hour), stalks 0.8 %; no rule broken in any of the 20. (`tap` needs a pointer that rests near the cat, `doze` a picture to doze in front of: neither happens unattended on a shelf.)

Round 3 added two things the cat chooses to do of its own accord, a **pat** (it goes up to a poster on its shelf, looks over the lip and pats it once or twice, and the poster gives a little) and the **zoomies** (a run and two or three leaps from shelf to shelf, then a pleased sit). In the soak (seeds 13–60 × 8 kinds × 600 virtual seconds) they were 251 and 91 of the 8,240 things the cat chose to do (3.0 % and 1.1 % of its choices; the unattended shares above were measured before them and have not been measured again). Neither happens for a quiet cat or one for a viewer who wants less motion.

## The 23 clips

"Known flaws" are what was seen on a sheet or strip, or is plain from the code or from the numbers below; "–" means none was found, not that none exists.

| # | Clip | State | Evidence | Known flaws | Next experiment |
|---|---|---|---|---|---|
| 1 | stand | visual reviewed | rig + gl tests; `poses.jpg` | small flaps of fur ("tuft shards") stand out of the chest and the flank in some lights | clip the shards in `build-meshy.mts`, or fold them into the body |
| 2 | walk | visual reviewed | engine "faces the way it walks", rig walk-rock and gait tests; `walk.jpg` | the turn is a half-turn about the vertical through a face-on moment; not judged at a TV's frame rates (the picture is capped at 30 fps on a weak device); a stance foot does not slide (gait is a function of the ground covered) | watch it on a real TV |
| 3 | run | visual reviewed | engine "comes when called"; rig "gallops when it runs…" and "does not jump when it breaks into a run…"; `run.jpg` | a gallop in pairs, eased in and out; judged on a sheet and by numbers, **not watched in motion** | watch it on a real screen; a longer bounding gait for a very long run |
| 4 | sit | visual reviewed | rig, gl, engine; `poses.jpg` | – | – |
| 5 | loaf | visual reviewed | engine film tests; `poses.jpg` | – | – |
| 6 | curl (asleep) | visual reviewed | rig dreams; `poses.jpg` | the face is mostly hidden under the tail and the paws (as with a real cat) | – |
| 7 | crouch | scenario tested | engine jumping, rig | only ever seen inside the leap and the wiggle | – |
| 8 | jump | visual reviewed | engine ×6; rig "leaps without a joint snapping" (0.9, 1.3 and 1.8 s at 60 fps); `scenes.jpg` | at 30 fps the far hind knee still steps 0.3 of the body at the landing (hidden behind the body; 0.2 is the bound the test keeps for the rest); judged on strips, not in motion at 60 fps | a pose-specific thigh that folds at the landing; watch it in motion |
| 9 | stretch | visual reviewed | engine scenes; rig stretch; `poses.jpg` | the tail goes from a curl to straight up in two frames at 30 fps (0.23 of the body) | ease the tail's own pose into it |
| 10 | yawn | visual reviewed | rig yawn; lab `faces` sheets | the open mouth is a flat dark-red cavity (the shader draws a tongue and two fangs, which hardly read at this size) | a deeper cavity with a visible tongue |
| 11 | groom | visual reviewed | rig wash; engine scenes; `scenes.jpg` | judged by the rig test's numbers (the paw is licked at the mouth, drawn up the cheek to the eye and the ear) more than by pictures: the close-ups on the `faces3` sheet are cut above the paw | a close-up with the paw in it |
| 12 | pet | scenario tested | host hand ×3, engine "pet" | the purr is a chest shake only (no sound, by design) | – |
| 13 | point | scenario tested | engine "points", e2e | the reach is a two-bone leg towards a screen point; for a far poster it is a straight line | an elbow lift for far reaches |
| 14 | scratch | visual reviewed | rig ×3; `scenes.jpg` | the raised hind leg reads as a long thin flap (a wing) beside the cheek, because the model's thigh is short; the foot steps 0.21 of the body at the entry at 30 fps | a shorter, thicker raised leg; slow the entry |
| 15 | knead | visual reviewed | rig; `scenes.jpg` | – | – |
| 16 | sniff | visual reviewed | rig; `scenes.jpg` | the head turns down quickly at the entry (read off the traces; no number kept for it) | slow the head's way in |
| 17 | stalk | visual reviewed | rig, engine "stalks a poster …"; `poses.jpg` | – | – |
| 18 | wiggle | visual reviewed | rig; `scenes.jpg` | – | – |
| 19 | peek | scenario tested | rig; engine drop tests (the head is down at a drop before a leap) | judged on a sheet only | – |
| 20 | tap | scenario tested | rig "bats at the pointer"; engine pointer tests | only seen on the made-up page, never with a real mouse | try it with a real mouse |
| 21 | doze | scenario tested | rig "nods off"; engine "loaf, doze, curl" | – | – |
| 22 | shift | scenario tested | rig "turns in its sleep"; engine "turns over in its sleep" | – | – |
| 23 | swat | scenario tested; strips looked at (round 3) | `render/swat.test.ts` (the beats; the contact at `SWAT_HIT`; finite and continuous at every phase), rig swat tests, engine tests of the journey, the pat, and a swat that is aimed again when the page moved the poster; e2e "goes to the title, creeps up on it and swats at it twice, and the poster gives under the paw" (it sees the poster's rock begin at the contact); a film strip of the real cat on the GPU (wiggle, then raised paw, swing, press, recoil) | the raised paw reads thin at the top of the swing (the model's forearm is thin, as with the scratch's leg, row 14); the simple (ginger) cat's paw is the cartoon's, and was not drawn at three times the size; **not watched in motion at a real frame rate** (ISSUE_LOG #63) | watch it on a real screen; a thicker forearm in the model build |

The hand: **carried** (04) is scenario tested (engine "picked up by a hand", rig ×3, host, e2e) and visual reviewed on the `carried` sheet (it hangs nearly upright, the head at the top, the hind legs and the tail below, the ears back); judged on stills, so how the swing reads in motion is not known. The **feelings** (tilt, think, startle, joy, droop) are visual reviewed (`poses.jpg`: look viewer, tilt, think, joy, startled, letdown); startled turns the head up to 0.3 rad in a frame, which is what a startle looks like.

Gait changes (walk, creeping walk, gallop, stop) are blends of two functions of the ground covered, never a switch. Every scene (a wash, a yawn, a stretch, a scratch, a get-up, a leap) has a test that no joint moves more than a fifth of the body in one frame, entering, leaving or being cut short (rig tests); the exceptions are measured and listed above.

Layers that are not clips: appearance (fade + growth), turning (head leads, body follows), slow blink at the viewer, double blink, independent ear flicks, breathing (slower and deeper asleep), 10-joint tail with follow-through and a quick tip when hunting, purr shake, gaze (eyes, then head), idle life (a weight shifted, a glance), ground shadow (grows and fades with height). State: implemented, integrated, unit tested (rig tests keep every number finite however a scene is entered or left); visual reviewed on stills only. **What no test can judge** is whether a hand-off between two clips *feels* right in motion at real frame rates on a TV; that needs a person to watch it.

## Cosmetic, on the mesh (not the motion)

- Tuft shards: thin flaps of fur that stand out of the model's chest, neck and flank (they come from the free model; they read as fur at a distance and as shards close up).
- The open mouth has no tongue or teeth; the eyes (drawn by the shader) are good from the front and from the 3/4 view and flat from the side.
- A few poses show a gap at a knee (the leg's two pieces separate by a few pixels at the extreme of a bend).

## Not built (ideas, in no order)

| Idea | State | Why not yet |
|---|---|---|
| **A sprite tier for weak devices**: render the detailed cat's poses and walk cycles to an atlas with our own renderer, draw that where WebGL is too dear (replacing the cartoon fallback) | idea (asked by the owner) | a build step and a painter; the governor already has the rung; see `docs/cat-companion.md` "Next" |
| Peek over the top of a row from behind the cards | idea | needs the cat to be drawn behind a card (a z-order change in the page) |
| Contact shadow on the card the cat stands on, and a soft shadow on the poster behind it | idea | the ground shadow exists; a cast shadow is a second pass |
| Fur ruffling when petted or when it shakes itself | idea | a vertex-shader wind term; small |
| A longer bounding gait for a very long run | idea | the gallop is one beat and the page's distances are short |
| Time-of-day rhythm (sleepier at night) | idea | the moods drift by themselves; tying them to the clock should be opt-in |
| Purr or other sound | idea | any sound must default to off and never play over a film; no audio files exist |
| More breeds or a long coat; a kitten | idea | needs another model (a new mesh and rig proportions) |
| A cat on the phone remote | idea | by design the cat lives on the screen that plays |

## Independent review

An independent read-only agent reviewed the branch at `c2abd52`, **before** the gait, the governor, the subtitle, the silhouette-table and the whole solid-cat work (ISSUE_LOG #20–#34), and long before the model of the final cat: it scored 27/50 (identity 3, natural movement 3, variety 3, spatial 2, contextual 3, recommendations 2, non-intrusiveness 2, device and accessibility 3, performance and lifecycle 2, reliability 4) and gave "plastic and toy-like" as the first visual flaw of the cat it saw. Its movement findings, the gallop that was a quick walk and the paw that jumped at a change of gait, are fixed and measured (#20). It never saw the cat as it is now. A review of the final head is in 05 if it has been done; the marks of the author are in 05 too, and they are lower than the plan's gate.

A second read-only review of the pushed head of the second pull request found one P1 (a scrolling grid renamed its shelves under the cat) and seven P3; all but one are fixed or settled, with tests: 05, "Independent review", and ISSUE_LOG #51–#57.
