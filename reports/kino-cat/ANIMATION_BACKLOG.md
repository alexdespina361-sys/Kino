# ANIMATION_BACKLOG

States, as the brief defines them: idea → specified → assets ready → implemented → integrated → unit tested → scenario tested → visual reviewed → **accepted**. "Accepted" is the owner's word, not mine: **nothing here is accepted yet.** "Visual reviewed" below means looked at on the lab's sheets and strips (`evidence/`) and on the real page by the author; the independent review is summarised at the end. There are no "assets" to be ready: the cat's body is one generated mesh and every animation is worked out in code from a skeleton, so there is no clip file that can drift out of step with another.

Unattended behaviour on the made-up library page (20 seeds × 30 min, no viewer input, default settings): asleep 42.6 %, sitting 14.5 %, walking 12.6 %, lying (loaf) 7.0 %, standing 6.9 %, little scenes 14.6 % (groom 3.6, stretch 3.2, knead 2.6, sniff 1.8, scratch 1.7, stalk 1.1, yawn 0.4, wiggle 0.2), leaps 1.6 % (48 a hour).

## The 18 clips

"Known flaws" are what was seen on a sheet or strip, or is plain from the code; "–" means none was found, not that none exists.

| # | Clip | State | Evidence | Known flaws | Next experiment |
|---|---|---|---|---|---|
| 1 | stand | visual reviewed | rig + gl tests; `poses.jpg` | the stripes on the lower legs read as bracelets | fade the leg stripes toward the paws |
| 2 | walk | visual reviewed | engine "faces the way it walks", rig gait tests; `walk-on-the-shelf-strip.jpg` | the turn is a half-turn about the vertical through a face-on moment; not judged at a TV's frame rates (the lean picture is capped at 30 fps); gait is a function of the ground covered, so a stance foot does not slide | watch it on a real TV |
| 3 | run | visual reviewed | engine "comes when called"; rig "gallops when it runs…" and "does not jump when it breaks into a run…"; `scripts/cat/glsheet.mjs run` | a gallop in pairs (the two hind paws land, then the two front, the body in the air between; the back gathers and stretches; the head reaches; the ears go back; the tail streams), eased into and out of; the largest one-frame step of any joint across every change of gait is 0.113 of the body. At 2–3 times the size the gathered haunch reads as a round pantaloon (ISSUE_LOG #36). Judged on a sheet and by numbers, **not watched in motion** | watch it on a real screen; a longer bounding gait for a very long run |
| 4 | sit | visual reviewed | rig, gl, engine; `poses.jpg` | – | – |
| 5 | loaf | visual reviewed | engine film tests; `poses.jpg` | – | – |
| 6 | curl (asleep) | visual reviewed | rig dreams; `poses.jpg` | the face of the curled cat is speckled by the fur shells | thinner shells on the face |
| 7 | crouch | scenario tested | engine jumping, rig | only ever seen inside the leap and the wiggle | – |
| 8 | jump | visual reviewed | engine ×6 (arc, gravity, refusal, re-aim); `stalk-wiggle-pounce-strip.jpg` | the haunch of the coming-down pose reads as a ball at 2–3 times the size (#36); judged on strips, not in motion at 60 fps | a pose-specific thigh that folds; watch it in motion |
| 9 | stretch | visual reviewed | engine scenes; `poses.jpg` | – | – |
| 10 | yawn | visual reviewed | rig face numbers; lab `faces` sheets | – | – |
| 11 | groom | visual reviewed | engine scenes; `little-scenes.jpg` | the cheek stripes read like lashes while the paw is at the face | fade the cheek stripes while the paw covers them |
| 12 | pet | scenario tested | host hand ×3, engine "pet" | the purr is a chest shake only (no sound, by design) | – |
| 13 | point | scenario tested | engine "points", e2e 5 | the reach is a two-bone leg towards a screen point; for a far poster it is a straight line (code) | an elbow lift for far reaches |
| 14 | scratch | visual reviewed | rig ×2; `little-scenes.jpg` | the raised hind leg is long and thin (#36) | a shorter, thicker raised leg |
| 15 | knead | visual reviewed | rig; `little-scenes.jpg` | – | – |
| 16 | sniff | visual reviewed | rig; `little-scenes.jpg` | – | – |
| 17 | stalk | visual reviewed | rig, engine "stalks a poster …"; strip | – | – |
| 18 | wiggle | visual reviewed | rig; strip | – | – |

Gait changes (walk, creeping walk, gallop, stop) are blends of two functions of the ground covered, never a switch: the largest one-frame step of any joint over a script of every change is 0.113 of the body (steady walking is 0.09; before, 0.26–0.40).

Layers that are not clips: appearance (fade + growth), turning (head leads, body follows), slow blink at the viewer, double blink, independent ear flicks, breathing (slower and deeper asleep), 10-segment tail with follow-through and a quick tip when hunting, purr shake, gaze (eyes, then head), ground shadow (grows and fades with height). State: implemented, integrated, unit tested (rig tests keep every number finite however a scene is entered or left); visual reviewed on stills only. **What no test can judge** is whether a hand-off between two clips *feels* right in motion at real frame rates on a TV; that needs a person to watch it.

## Not built (ideas, in no order)

| Idea | State | Why not yet |
|---|---|---|
| Paw at the focused poster (bat at it) | idea | needs a safe visual that does not look like the poster is being pushed |
| Peek over the top of a row from behind the cards | idea | needs the cat to be drawn behind a card (a z-order change in the page) |
| Contact shadow on the card the cat stands on, and a soft shadow on the poster behind it | idea | the ground shadow exists; a cast shadow is a second pass |
| Fur ruffling when petted or when it shakes itself | idea | a vertex-shader wind term; small |
| A longer bounding gait for a very long run | idea | the gallop (#3) is one beat and the page's distances are short (a shelf, a corner to a card) |
| Time-of-day rhythm (sleepier at night) | idea | the moods drift by themselves; tying them to the clock should be opt-in |
| Purr or other sound | idea | any sound must default to off and never play over a film; no audio files exist |
| More breeds or a long coat; a kitten | idea | needs another model (a new mesh and rig proportions) |
| A cat on the phone remote | idea | by design the cat lives on the screen that plays |

## Independent review

An independent read-only agent reviewed the branch at `c2abd52`, **before** the gait, the governor, the subtitle, the silhouette-table and the whole solid-cat work (ISSUE_LOG #20–#34): it scored 27/50 (identity 3, natural movement 3, variety 3, spatial 2, contextual 3, recommendations 2, non-intrusiveness 2, device and accessibility 3, performance and lifecycle 2, reliability 4) and gave "plastic and toy-like" as the first visual flaw of the cat it saw. Its movement findings, the gallop that was a quick walk and the paw that jumped at a change of gait, are fixed and measured (#20). It never saw the cat as it is now. A review of the final head is in 05 if it has been done; the marks of the author are in 05 too, and they are lower than the plan's gate.
