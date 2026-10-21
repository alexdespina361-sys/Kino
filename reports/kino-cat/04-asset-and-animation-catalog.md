# 04 · Asset and animation catalog

## Assets

| Asset | What it is | Size | Provenance / licence |
|---|---|---|---|
| `src/client/cat/render/gl/cat.mesh` | the solid cat's body: 11,966 vertices, 16-bit positions, 8-bit normals, four skin bones and weights per vertex (32 bones), paint bytes (openness, fur length, position along the part), delta-packed varint triangle indices (`format.ts`, version 2), built **offline** from signed-distance primitives (`scripts/cat/model/{sdf,cat-model,rest,build}.mts`, surface nets, a symmetric lattice) | 343.5 KB raw, 218.3 KB gzip, 183.1 KB brotli | original; made in this repository by code; no scanned/downloaded/generated-by-model data |
| shader (`render/gl/shader.ts`) | all colour is procedural in the fragment shader: coat (4), tabby stripes, tuxedo/calico patches, eyes, nose, mouth interior, fur shells (3–12 layers of strands), strand highlight, rim light | in the lazy chunk | original code |
| `render/rig.ts` + `shapes.ts` | the skeleton: seven posture shapes, springs, 2-bone leg IK, 10-segment tail, head, jaw, ears, eyelids | in the lazy chunk | original code |
| classic cat (`render/draw.ts`) | the same rig drawn with Canvas 2D paths (ginger coat only) | in the lazy chunk | original code |

No image, video, font or sound files. Nothing from Furever Dock or any third party is in the repository (see 06).

## Clips (18) — `Clip` in `types.ts`

"Tested" names the unit tests; "e2e" the browser tests (05). Pictures: `evidence/` (copies of `.kino-cat/` sheets; regenerate with `node scripts/cat/glsheet.mjs <poses|scenes|faces|walk|run|film> out.png`).

| # | Clip | What the viewer sees | How it is built | Entered by | Tested |
|---|---|---|---|---|---|
| 1 | `stand` | four-square, breathing, blinking, ears flicking, tail swaying with a delay | `STAND` shape; breath, blink, ear and tail layers | rest (stand), arrival | engine "walks/rests", gl "every posture finite" |
| 2 | `walk` | a four-beat gait that does not slide: near hind, near front, far hind, far front; turns through a face-on moment (a half turn about the vertical on the solid cat), not a mirror snap | odometer-driven stride, 2-bone IK per leg, duty/lift from speed; `flip` spring | wander, hop route, come, watch | engine "faces the way it walks, not faster than a run" |
| 3 | `run` | the faster gait: when called from far (gap > 1.2 body lengths) and on the run-up to a jump | faster stride, more lift | come, run-up of a hop | same |
| 4 | `sit` | rump down, forelegs straight, tail curled round; settles with a spring | `SIT` shape, rear folds first | rest, groom, watch | engine "rest", gl postures |
| 5 | `loaf` | paws tucked under, breathing | `LOAF` shape | rest (tired), film paused | engine "film" tests |
| 6 | `curl` | curled nose-to-tail, tail over the nose; slow deep breathing, dreams (ear flick, forepaw jerk) | `CURL` shape; sleep layer | sleep, film playing | rig "dreams", engine film |
| 7 | `crouch` | gathers before a leap | `CROUCH` shape | jump take-off, wiggle | engine "jumping" |
| 8 | `jump` | gather → push → stretched flight (hind legs trail) → soft landing and settle | ballistic arc planned from gravity; clip progress shared 0–0.22 take-off, 0.22–0.8 flight, 0.8–1 landing | hop between shelves, pounce | engine jumping ×6 (arc, gravity, refusal, re-aim while airborne) |
| 9 | `stretch` | a long held stretch, front low and rump high (also the mid-air pose of a leap) | `STRETCH` shape | after sleep, end of a film, now and then | engine scenes |
| 10 | `yawn` | the jaw really opens (jaw bone, lip line, mouth interior), ears go back | jaw dyn + face | when tired | rig face numbers; lab faces sheet |
| 11 | `groom` | washes its face: head bows to a paw held at the cheek, paw goes up over the ear and back | groom dyn on the near forepaw and head | every 45–90 s; after a pounce | engine scenes |
| 12 | `pet` | leans into the hand, eyes closed, ears forward, purring shake, bunts one way then the other | `petted` flag + bunt sine | a hand rests on it | host hand ×3, engine "pet" |
| 13 | `point` | sits and reaches a paw toward a poster, looks at it | reach target + IK | "find me something" | engine "points", e2e 5 |
| 14 | `scratch` | sitting, near hind foot comes up to the ear (knee bends the other way, leg out toward the viewer), head bows to meet it, foot works at ~8.5 beats/s, eyes half shut | scratch dyn overlay on `SIT`; hind IK with a knee side | every 70–140 s (never for a quiet or reduced-motion viewer) | rig scratch ×2 |
| 15 | `knead` | loafing, forepaws take turns to reach, press, draw back; body rocks; purr | knead dyn, beat 1.3 Hz, far paw half a beat later | before it sleeps (50 %) | rig knead |
| 16 | `sniff` | front goes down, nose nearly to the floor, bobbing, eyes down | sniff dyn on neck/head + gaze override | after some walks | rig sniff |
| 17 | `stalk` | a creep: short low steps, back near the ground, eyes on a poster, pupils wide, tail tip quick | walk with stride 0.36, duty 0.8, lift 0.05; speed 0.4 L/s | prowl | rig stalk, engine "stalks a poster …" |
| 18 | `wiggle` | crouched, rump up and swaying (5.5 Hz) with the feet planted, then the pounce is the ordinary leap | wiggle dyn on hips/rump | after a stalk | rig wiggle |

Not clips but animations: **appearance** (fade in over 0.8 s with a little growth; out in 0.3 s), **turning** (the head leads, the body follows, from `facing`), **slow blink at the viewer** (1.2 s, only while it looks out of the screen), **double blink** (18 % of blinks), **independent ear flicks**, **breathing** (slower and deeper asleep), **tail** (10 segments, follow-through, tip flicks when hunting), **purr** (a 7 Hz pulse on the chest while petted or kneading), **gaze** (eyes first, then head, towards a focused poster, the pointer or the viewer), **ground shadow** (grows/shrinks with height).

Count against the plan's target "18–25 distinct polished base clips": **18 distinct clips + the layers above**, none a renamed loop. The plan also warns the number is not proof of quality; see 05 for what was and was not judged.

## Coats (4) and sizes (3)

| Coat | Notes |
|---|---|
| ginger (default) | orange tabby: irregular stripes that lean back down the flank, thin toward the belly, each with its own thickness and reach; white chest/chin |
| tuxedo | black with white chest, muzzle and paws |
| grey | grey tabby, same stripe system |
| calico | white with orange and black patches (procedural noise patches) |

Sizes: small 0.8×, normal 1×, large 1.35× (of the size the screen's width makes of it). The classic fallback cat has one coat; Settings shows the coat choice only while the detailed cat is on.

## Transitions and ground anchors (the plan's §5.3 metadata)

All clips share one skeleton, so there is no per-clip frame data to keep consistent: the foot anchor is the rig's ground line (`CatFrame.y`), the collision envelope is the engine's 1-body-length box, the facing flips about the body's middle, and every scene is a spring-eased overlay (`smooth`) that is entered and left softly. The unit test "keeps every number finite in every scene, however it is entered and left" (rig) and "keep every number finite and the body from being turned inside out, in every posture" (gl) are the transition guard. What no test can judge — whether a hand-off still looks off — is in `ANIMATION_BACKLOG.md` and `05`.
