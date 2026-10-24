# The cat's animation

How the detailed (WebGL) cat's clips are made, what is checked about them and where the files live. Nothing here runs in the app: the app only plays `src/client/cat/render/gl/cat.clips`. The tools are in `scripts/cat/anim/`.

## The rule

The first clips were keyed by hand and a person looking at them called the cat's motion a 4 out of 10 ("very unpleasant"). Since then **no bone's angle is typed in**. A clip is either

1. **a donor's motion put on the cat's bones**: the hand-made animations of a real animator (the Mesh2Motion fox and the Khronos Fox, licences in [SOURCES.md](SOURCES.md)), moved by what each bone does in the world, then given a cat's style, kept on the floor and with the paws planted; or
2. **a posture told as constraints and solved for the bones** (`posegen.mts`, `acts.mts`): how high and how tilted the hips are, how the back, the neck and the tail bend, where each paw's sole is to be. The bones' turns are found by a few steps of least squares, with limits on each leg bone so that a leg cannot wind itself into a knot, and the cat is kept on the floor and out of the wall by the shape of its mesh. Change a number and the bones follow.

Then every clip goes through the numbers (`qa.mts`: does the body hold together, is the cat on the floor, does a bone jump, does a loop close) and then through **blind eyes**: a reviewer who is told nothing about the clip but its length sees twelve numbered pictures and says what it is, what is wrong with the body and the motion, and gives marks. The numbers say which clips are not fit to be shown; only the blind review says whether one is any good (see [QA.md](QA.md)).

## The stages (`scripts/cat/anim/build.mts`)

| Stage | File | What it does |
|---|---|---|
| read a donor | `donor.mts`, `../glb/glb.mts` | a donor's skeleton and animations from its `.glb`, in its own world |
| retarget | `retarget.mts`, `chain.mts`, `recipes/*.mts` | the cat's bones are made to do what the donor's do, by what each does in the world, not by the numbers in its joints |
| feet | `feet.mts`, `lock.mts` | a leg is judged by its paw: the paws are put where the donor's are, and the paws of a gait are planted so they do not skate |
| style | `style.mts` | what makes a fox's motion a cat's: more hip rise, more back and neck, a tail that moves |
| floor | `plant.mts`, `ground.mts`, `floor.mts`, `gait.mts`, `flight.mts` | the whole cat is moved so the lowest part of the mesh is at the floor; a gait's stride is measured; a leap's flight is left to the engine |
| generate | `posegen.mts`, `ik.mts`, `acts.mts` | the clips no donor has (sit, lie, curl, stretch, groom, point, tap, knead, climb, ...), as postures solved for the bones |
| smooth and thin | `smooth.mts`, `thin.mts` | a bone solved frame by frame is smoothed; frames the player's own interpolation reproduces are dropped |
| pack | `pack.mts`, `finish.mts`, `src/client/cat/render/gl/clipfile.ts` | one `cat.clips` file, about 328 KB (328,064 bytes; the test allows 340 KiB; a clip that lives in its holds moves 23 to 27 bones every frame and does not thin) |
| check | `qa.mts`, `integrity.mts`, `behaviour.mts` | the numbers (below), and the clips played in the order the engine plays them |

## Commands

Windows, from the repository root; the donors must be in `C:\Users\Me\tools\cat-workbench\donors` (not in the repository).

```powershell
# build every clip into the file the app plays
node node_modules/tsx/dist/cli.mjs scripts/cat/anim/build.mts --out=src/client/cat/render/gl/cat.clips

# one clip, no thinning, to look at (--thin=off keeps every frame; --tol=<degrees> is how far thinning may move a bone, 0.5 if not told; --smooth=<degrees> how far a leg may leave the line between its neighbours, 3)
node node_modules/tsx/dist/cli.mjs scripts/cat/anim/build.mts --out=.kino-cat/x.clips --thin=off --only=groom

# the numbers
node node_modules/tsx/dist/cli.mjs scripts/cat/anim/qa.mts src/client/cat/render/gl/cat.clips

# a sheet of 12 pictures through a clip; --blind=1 numbers the pictures and does not name the clip
node scripts/cat/glsheet.mjs clip .kino-cat/sheet.png --clip=groom --n=12 --blind=1 --clips=.kino-cat/x.clips

# after any change to a clip: the engine plans with how far the drawn cat reaches in each posture
# (measured from pictures of the settled cat, a few seconds of work; --check says whether any picture reaches farther than the table;
#  --profile=sit,groom prints the bands of a clip; --clips=<file> measures a file that is not the one in the app)
node scripts/cat/extents.mjs --write
node scripts/cat/extents.mjs --check

# the pictures that table is made from, as a sheet (--label is the start of the picture's name; --cellw=560 for a posture with a long tail)
node scripts/cat/glsheet.mjs extents .kino-cat/extents-sit.png --label=sit --cols=4 --cellw=560
```

`.kino-cat/` is not tracked. A full build takes about 40 s.

An experiment that is not in the app: `CAT_ELBOW=1` makes `build-meshy.mts` add an elbow bone to each foreleg (36 bones); the clips are then built with `build.mts --mesh=<that mesh>` and checked with `qa.mts --mesh=<that mesh>`. It was judged and not shipped (QA.md, round 14).

## The numbers (`qa.mts`)

| Column | Meaning | Healthy |
|---|---|---|
| stretch99 | how much longer the triangles' edges got (the 99th percentile: a few tufts may stretch, a limb must not) | about 3.2 or under |
| area1 | how small the triangles got (the 1st percentile of the ratio to rest: a collapse) | not near 0 |
| flip | the share of triangles that face the other way than at rest (turned inside out) | 0.03 or under |
| volume | what the mesh encloses against what it enclosed at rest, lowest to highest | about 0.9 to 1.2 |
| sink / float | how far (in body lengths) the cat's lowest part is under, or over, the floor at worst | 0 |
| hazard | the most points at one frame carried by two bones turned a half turn or more apart (their blend depends on the last digit of a weight), as a share | low; the climbs are the exceptions, see QA.md |
| pop | the biggest turn of any bone between two frames, degrees | small |
| seam | for a loop, the turn at the join | 0 |

## What is not here

- the Meshy model, the donors and the large renders: `C:\Users\Me\tools\cat-workbench\`
- a real phone, a Fire TV or Safari: none of this was seen on one (see QA.md)
- the engine's use of the clips (when the cat sits, climbs, scales): `src/client/cat/engine/`, `src/client/cat/render/gl/director.ts`
