# Session log: the cat's animation, 2026-10-23 to 2026-10-24

What was decided, in order, and what bit on the way, for whoever continues. The result of each blind review is in [QA.md](QA.md); where each source comes from is in [SOURCES.md](SOURCES.md).

## The brief

The owner called the detailed cat's animation "very unpleasant" and scored it 4 of 10 for naturalness, said the cat looks a bit off against the original model, and asked for the animation to be **made by tools, data or a better model** and not keyed by hand again. The standing plan: the Meshy cat stays canonical; nothing paid; every source in a ledger as ship-allowed, reference-only or rejected; a clip is "good" only if blind reviewers give it 4 or more for readability, anatomy and timing; paws planted, no skating; the player and the TV remote are not disturbed.

## Decisions

1. **Where the motion comes from.** A donor's hand-made animation is put on the cat's bones by what each bone does in the world (`retarget.mts`, `recipes/`): the Mesh2Motion fox for the walk, run and yawn, the Khronos Fox for the stand. Everything no donor does is a **posture told as constraints and solved for the bones** (`posegen.mts`, `acts.mts`). No bone's angle is typed in.
2. **What was looked at and not used.** MoCapAnything (arXiv 2604.28130, motion capture of any skeleton from video): its own reported joint error, about 23 degrees, is more than a leg chain takes. A search for a better cat model (Objaverse, Quaternius, Poly Pizza, Wikimedia, OpenGameArt): none came near the Meshy cat. Quaternius cats: too few bones to drive this cat's legs. Furever, a commercial cat app: never run, nothing of it used. The Sphynx cat of Sketchfab (CC BY, sign-in needed): the file never came, so nothing of it is used.
3. **Skinning.** Dual quaternions bulge at sharply bent shoulders, elbows and haunches; linear blending creases there. The player blends the two (`SKIN_LINEAR` 0.7). A sign bug in the dual-quaternion blend was found on the way and fixed.
4. **The clip file's sign convention** (`clipfile.ts`): the turns of a bone face the same way as the one before, and the first faces the way the bone's rest does, so that a fade from one clip into another does not flip the sign of a bone where the fade ends.
5. **Floor.** The whole cat is moved so that its lowest vertex is at the floor; a tail that would go through it is clamped (`tailFloor`); a gait's feet are planted (`plant.mts`), the steps staggered.
6. **Limits on each leg bone** (`normal`, `wide`, `free`): `normal` made the skin numbers clean and the pictures worse (round 9), because it kept a low cat on its feet. The low postures and the stretch use `wide`, the card climb `free`.
7. **Smoothing and thinning** (`smooth.mts`, `thin.mts`): a leg that is reached for each frame on its own flicks; each frame that leaves the line between its neighbours by more than `--smooth` degrees (3 by default) is pulled back. Frames that the player's own interpolation reproduces to within `--tol` degrees (0.5) are dropped.
8. **Mouth.** The jaw was a flat red patch ("red lipstick"); it is a shader now (`groom` once read as "horrifying" for the inflated body, the shards at the haunch, the sausage of an arm and that mouth; the body table and the mouth fixed those).
9. **Follow-through** (`follow.mts`): the hips, the back, the neck and the tail are each a spring that follows what the clip says, slower the further out they are, so a part leads and a part trails and nothing starts and stops like a lift. A clip told "where to be in `LEAD` seconds" (`ahead`) is not late at its end. `living()` in `acts.mts` lays a breath and a slow weight shift over a hold and plants every paw the clip does not move (a body that moves over a paw that was not told to stay makes the paw drift: measured 0.02 to 0.1 of a body length).
10. **The ledge climb** was redesigned from measurement, not from looking: the cat's belly is 0.24 of a body length deep, so a spine at the wall puts the front inside it. The probe (`climb-probe`) reported the first climb 0.27 inside; the keys now keep the belly to the wall as far as the corner, the forepaw on the lip, the hind legs scrabbling and then hooking over, and end at 0.083 (body) and 0.046 (legs).
11. **The card climb, from behind** (`scale`): the user's request ("when I say cat climbs, it doesn't mean only from the side"). A bound gait played by the distance climbed (the clip's `stride`), seen from behind. The renderer plays it (`director.ts`); the engine wiring is a separate branch (`feat/cat-scale-engine`, see below).

## Traps (each cost time once)

- `tsc -p . --noEmit` does not cover `scripts/`; the scripts are checked by `scripts/cat/anim` through `.kino-cat/tsconfig.scripts.json` (not tracked) and run with `node node_modules/tsx/dist/cli.mjs`.
- Importing a script from a scratch folder needs a `file:///` URL.
- A `Timing` in `between(a, b, t, timing)` is `[start seconds, duration seconds]`, not `[start, end]`.
- `hips.pitch` is the pelvis angle **minus** its rest angle (about -12 degrees), not the angle.
- The film strip does not draw a recording's first picture; the preview starts at the second.
- The sheet maker once shared one clock across the pictures of a sheet; clock-driven clips looked like "a plop and then a freeze" in round 3. Fixed.
- `--smooth` is a limit on **curvature**: a leg that really swings fast at 30 frames a second leaves the line between its neighbours by degrees, so a small limit would blunt a kneading paw or a lick. Do not lower it to make a clip thin better.
- A clip with a living hold moves 23 to 27 bones in every frame and cannot be thinned to a lower frame rate within half a degree: the file is about 320 KB, not the 240 KB it was before the holds lived.
- Judges are noisy by about a mark; compare two versions as an A/B pair, and do not read a mark out of a pair.
- The clip file is read by the shape table (`extents.mjs --write`) and shares the climb's marks with the cartoon painter: the engine's climb constants (`CLIMB_*`) may not change.

## Open

- **No elbow.** The first bone of each leg is the whole upper limb; the next two are short. A raised foreleg is a tube. Needs a re-rigged or re-skinned leg.
- **Low postures** (the hunting crouch, the peek, the wiggle) still read as a flat slab: a lower head, a higher rump and a visible fold are wanted.
- **Knead** snaps where a paw takes over (pictures 4 to 5 and 10 to 11, in both versions judged); the **stretch**'s front paws slide at the bottom; the **sit**'s rump dips through the floor for a frame at its end.
- **Nothing was seen on a real phone, Fire TV or Safari.** The rear-view climb is not played by the engine until `feat/cat-scale-engine` is merged.
- The fur looks as the model made it (flat white shards at some edges). Flat lighting would hide them; not done, because the owner's cat is the Meshy model as it is.
