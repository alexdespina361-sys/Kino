# scripts/cat: the cat lab

Development tooling for the cat companion (`docs/cat-companion.md`). **Nothing here is part of the app or of its build**; the app never imports it. Each file says what it does and how to run it in its first lines. Run the `.mts` files with `node node_modules/tsx/dist/cli.mjs <file>`, the `.mjs` ones with `node`.

## Looking at the cat (Chromium through Playwright)

| File | What for |
|---|---|
| `glsheet.mjs` | pictures of the detailed cat: `views`, `poses`, `scenes`, `faces`, `walk`, `run`, `carried`, and `film` (strips of a recording). `--gpu=real` draws on the machine's graphics card, `--coat=` picks a coat, `--scale=`, `--cols=` |
| `sheet.mjs` | the same for the simple (Canvas 2D) cat: `poses`, `carried`, `walk`, `run`, `jump`, and `climb` / `climb-walk` (the reach for a lip and the haul up, from the air and from under the lip) |
| `browser-lab.mjs` | real-Chromium measurements on the TV's library, from a build you point it at (`scroll`: what the rows do for each kind of scroll and what the cat does; `places`: how an unattended cat spends its time on the real page). Starts its own server |
| `extents.mjs` | measures how far the drawn cat reaches in each posture and writes or checks `src/client/cat/engine/shape-table.ts`; **run `--write` after any change to the model or to an animation, and `--check` to verify** (the unit tests and the engine plan with that table) |

## Recordings and the brain

| File | What for |
|---|---|
| `record.mts` | records what the behaviour engine does for a seed on the made-up page, as JSON (`glsheet.mjs film` draws it) |
| `clip-film.mts` | the same for clips played one after another, to look at one animation alone |
| `behaviour.mts` | how the cat spends its time over many seeds (the share on each kind of place and each act, the stays on the foot of the screen, the hops, what it chooses), on the TV's library as the cat reads it or on the simulator's page, with or without a viewer; with `--temperament=a,b` one table for each, and what differs from the first |
| `soak.mts` | the soak: `soak.mts 13 412 600` puts the brain through 400 seeds × 7 kinds of bad afternoon, 10 virtual minutes each, and exits 1 if a rule is broken (never stuck, never off the screen, never over a keep-out for long, no impossible jump) |
| `bundle.mjs` | bundles a TypeScript entry for the browser with Vite (used by the sheets) |

## Making the detailed cat's mesh (offline)

The detailed cat is made from "Fluffy Blue-Eyed Cat" by Meshy AI (CC BY 4.0, `reports/kino-cat/06-risk-and-license-register.md`). **The model file is not in the repository** and is not needed to run the app: `src/client/cat/render/gl/cat.mesh` and `model.ts` are what comes out of it.

| File | What for |
|---|---|
| `model/build-meshy.mts MODEL.glb` | the build: writes `cat.mesh` and `model.ts` from the model (then run `extents.mjs --write`, and the unit tests: the mesh carries a stamp of the rest pose it was made around) |
| `model/meshy-rest.mts`, `meshy-skin.mts`, `write-model.mts` | the skeleton the model is fitted to, and which bones carry which point |
| `model/*.mts` (the others), `glb/*.mts` | probes and viewers used while the model was being fitted (poses, knees, colours, slivers, the tail's curve), and a small `.glb` reader and software renderer; `glb/anim-trace.mts` traces the model's own walk, which the walk's rock was written from |
