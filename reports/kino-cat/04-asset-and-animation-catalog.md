# 04 · Asset and animation catalog

## Assets

| Asset | What it is | Size | Provenance / licence |
|---|---|---|---|
| `src/client/cat/render/gl/cat.mesh` | the detailed cat's body: 11,181 vertices, 16-bit positions, 8-bit normals, four skin bones and weights per vertex (32 bones), the colour its maker painted into each vertex, a baked "how open to the room is this point" byte, delta-packed varint triangle indices (`format.ts`, version 3). Made **offline** by `scripts/cat/model/build-meshy.mts` (joins the vertices the file split for its texture, paints each vertex with the texture's colour there, takes the eyes out so the shader can blink them, bakes the openness, skins every vertex to our 32 bones) | 272,179 B raw, 164,907 B gzip, 147,812 B brotli; SHA-256 `998357d6…ef8e` | **derived from a third-party model**: "Fluffy Blue-Eyed Cat" by Meshy AI, **CC BY 4.0** (the owner's statement; credit shown in Settings → Cat companion and in 06). The GLB stays outside the repository; only this derived file and `model.ts` (the model's rest pose and a stamp the mesh is checked against) are in it |
| shader (`render/gl/shader.ts`) | the lighting (the vertex colour lit by its openness, a rim light, a soft fur sheen) and, for the four other coats, tabby stripes / tuxedo and calico patches painted over the light and dark of the model's colours; the eyes (blink, look about), nose and mouth are drawn by it | in the lazy chunk | original code |
| `render/rig.ts` + `shapes.ts` | the skeleton the engine drives: seven posture shapes, springs, two-bone leg IK, a ten-joint tail, head, jaw, ears, eyelids | in the lazy chunk | original code |
| `render/gl/fit.ts` + `skeleton.ts` | carries the rig's pose onto the model (the body and head keep their way along the cat, the legs are solved again for the model's own bone lengths, the tail keeps the model's own curve) and skins it with 32 bones | in the lazy chunk | original code |
| simple cat (`render/draw.ts`) | the same rig drawn with Canvas 2D paths (one coat) — the fallback for a device that cannot or should not run the detailed cat | in the lazy chunk | original code |

No image, video, font or sound files. The SDF cat that was here first (343.5 KB, fur shells, four coats) is **removed**; the Meshy model's own animations (it has a skeleton and a set of clips) are *not* used, and neither are its skin weights (its tail has five bones and the last carries the whole tip; `scripts/cat/model/meshy-skin.mts` skins the points to our skeleton instead): only its mesh and its colours are, and every motion below is the engine's. Nothing from Furever Dock or any other third party is in the repository (see 06).

## Clips (22) — `Clip` in `types.ts`

"Tested" names the unit tests; "e2e" the browser tests (05). Pictures: `evidence/` (copies of `.kino-cat/` sheets; regenerate with `node scripts/cat/glsheet.mjs <poses|scenes|faces|walk|run|film|…> out.png`).

| # | Clip | What the viewer sees | How it is built | Entered by | Tested |
|---|---|---|---|---|---|
| 1 | `stand` | four-square, breathing, blinking, ears flicking, tail swaying with a delay | `STAND` shape; breath, blink, ear and tail layers | rest (stand), arrival | engine "walks/rests", gl "every posture finite" |
| 2 | `walk` | a four-beat gait that does not slide, with a slight rock of the body; turns through a face-on moment (a half turn about the vertical), not a mirror snap | odometer-driven stride, 2-bone IK per leg, duty/lift from speed; a loaf that is asked to walk rises first | wander, hop route, come, watch | engine "faces the way it walks, not faster than a run"; rig walk rock |
| 3 | `run` | the faster gait, for a call from far (gap > 1.2 body lengths) and the run-up to a jump | faster stride, more lift | come, run-up of a hop | same |
| 4 | `sit` | rump down, forelegs straight, tail curled round; settles with a spring | `SIT` shape, rear folds first | rest, groom, watch | engine "rest", gl postures |
| 5 | `loaf` | paws tucked under, breathing | `LOAF` shape | rest (tired), film paused | engine "film" tests |
| 6 | `curl` | curled nose-to-tail, tail over the nose; slow deep breathing, dreams (ear flick, forepaw jerk) | `CURL` shape; sleep layer | sleep, film playing | rig "dreams", engine film |
| 7 | `crouch` | gathers before a leap | `CROUCH` shape | jump take-off, wiggle | engine "jumping" |
| 8 | `jump` | gather → push → stretched flight (hind legs trail) → soft landing and settle; the feet's reach is limited in speed and let go of as it falls, so a knee does not snap | ballistic arc planned from gravity; progress shared 0–0.22 take-off, 0.22–0.8 flight, 0.8–1 landing | hop between shelves, pounce | engine jumping ×6; rig "leaps without a joint snapping" at 0.9/1.3/1.8 s |
| 9 | `stretch` | a long held stretch, front low and rump high (also the mid-air pose of a leap), eased into from a curl and out of | `STRETCH` shape | after sleep, end of a film, now and then | engine scenes, rig stretch |
| 10 | `yawn` | the jaw really opens (jaw bone, lip line, mouth interior), ears go back, eased in and out | jaw dyn + face | when tired | rig yawn; lab faces sheet |
| 11 | `groom` | washes its face: head bows to a paw held at the cheek, the paw goes up over the ear and back and comes down gently; a cut-short wash does not snap | groom dyn on the near forepaw and head | every 45–90 s; after a pounce or a fright | rig wash, engine scenes |
| 12 | `pet` | leans into the hand, eyes closed, ears forward, purring shake, bunts one way then the other | `petted` flag + bunt sine | a hand rests on it | host hand ×3, engine "pet" |
| 13 | `point` | sits and reaches a paw toward a poster, looks at it | reach target + IK | "find me something" | engine "points", e2e |
| 14 | `scratch` | sitting, the near hind foot comes up to the ear (the knee folds the other way), head bows to meet it, the foot works at ~8.5 beats/s, eyes half shut | scratch dyn overlay on `SIT`; hind IK with a knee side; the fold is eased | every 70–140 s (never for a quiet or reduced-motion viewer) | rig scratch ×3 |
| 15 | `knead` | loafing, forepaws take turns to reach, press, draw back; the body rocks; purr | knead dyn, beat 1.3 Hz, far paw half a beat later | before it sleeps (50 %) | rig knead |
| 16 | `sniff` | the front goes down, nose nearly to the floor, bobbing, eyes down | sniff dyn on neck/head + gaze override | after some walks | rig sniff |
| 17 | `stalk` | a creep: short low steps, back near the ground, eyes on a poster, pupils wide, tail tip quick | walk with stride 0.36, duty 0.8, lift 0.05; 0.4 L/s | prowl | rig stalk, engine "stalks a poster …" |
| 18 | `wiggle` | crouched, rump up and swaying (5.5 Hz) with the feet planted; the pounce that follows is the ordinary leap | wiggle dyn on hips/rump | after a stalk | rig wiggle |
| 19 | `peek` | looks down over the edge of a shelf (at where it will land, or at a poster below): front lowered, head out over the edge | peek dyn on the front, gaze down | before a long drop; now and then | engine drop tests; rig "peeks over an edge" |
| 20 | `tap` | a forepaw bats at something (the pointer), repeated | the `point` reach, repeated | a slow pointer near it | engine pointer tests; rig "bats at the pointer" |
| 21 | `doze` | nodding off: a loaf, the head drops and jerks up again, eyes heavy | doze dyn on the head | before a long sleep | engine "loaf, doze, curl"; rig "nods off" |
| 22 | `shift` | a sleeper changes its position: half wakes, lifts its head, curls up again | one-shot inside a sleep | in the middle of a long sleep | engine "turns over in its sleep"; rig "turns in its sleep" |

Also: **carried** (not a clip but a flag of the frame): a hand has it by the scruff — it hangs (forepaws dangling, hind legs trailing, tail down, a slow swing), follows the hand at a limited speed, is let go when the hand is lost, and falls to the shelf under the shadow it was shown (engine "picked up by a hand", rig "hangs by the scruff", "tips over and rights itself", "swings under the hand", host `hand.ts` tests, e2e). **Feelings** (`Emote`, laid over any clip): *tilt* (a quizzical look at whoever is there), *think* (a look away and up), *startle* (a flinch: ears flat, eyes wide; the pointer dashing close to it), *joy* (ears up, tail up and quivering: a title was found), *droop* (a letdown: nothing was found).

Not clips but animations: **appearance** (fade in over 0.8 s with a little growth; out in 0.3 s), **turning** (the head leads, the body follows), **slow blink at the viewer** (only while it looks out of the screen), **double blink**, **independent ear flicks**, **breathing** (slower and deeper asleep), **tail** (ten joints, follow-through; the tip flicks when hunting; the tail's shape keeps the model's own curve), **purr** (a 7 Hz pulse on the chest while petted or kneading), **gaze** (eyes first, then head, towards a focused poster, the pointer or the viewer), **ground shadow** (grows and shrinks with height), **idle life** (a shifted weight, a glance, a slow tail now and then, so that no rest is a freeze).

Count against the plan's target "18–25 distinct polished base clips": **22 distinct clips + the hand + five feelings + the layers above**, none a renamed loop. The plan also warns the number is not proof of quality; see 05 for what was and was not judged, and `ANIMATION_BACKLOG.md` for what still looks off.

## Coats (5) and sizes (3)

| Coat | Notes |
|---|---|
| ragdoll (default) | the model's own colours: a pale cat with grey points (mask, ears, tail), blue eyes — the owner's reference |
| ginger | orange tabby painted over the model's light and dark: irregular stripes that lean back down the flank; white chest/chin |
| tuxedo | black with a white chest, muzzle and paws |
| grey | grey tabby, same stripe system |
| calico | white with orange and black patches (procedural noise patches) |

Sizes: small 0.8×, normal 1×, large 1.35× (of the size the screen's width makes of it). The simple fallback cat has one coat; Settings shows the coat choice only while the detailed cat is on.

## Transitions and ground anchors (the plan's §5.3 metadata)

All clips share one skeleton, so there is no per-clip frame data to keep consistent: the foot anchor is the rig's ground line (`CatFrame.y`), the collision envelope is the engine's 1-body-length box (`engine/shape-table.ts` holds the measured silhouette; `scripts/cat/extents.mjs --check` fails if the model's reach grows past it), the facing flips about the body's middle, and every scene is a spring-eased overlay (`smooth`) that is entered and left softly. The unit tests "keeps every number finite in every scene, however it is entered and left" (rig), "leaps without a joint snapping" (rig; per-frame steps of the toes, hocks, head and tail tip) and "keep every number finite and the body from being turned inside out, in every posture" (gl) are the transition guard. What no test can judge — whether a hand-off still looks off — is in `ANIMATION_BACKLOG.md` and `05`.
