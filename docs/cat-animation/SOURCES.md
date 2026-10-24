# Where the cat's animation comes from

The machine-readable ledger is [`source_registry.json`](source_registry.json); this is the same thing to read. A source that is not here is not used.

- **ship-allowed**: its licence lets what is derived from it go into the app, and what the licence asks for is done where the app shows it.
- **reference-only**: looked at, measured or learned from; nothing of it is in the app.
- **rejected**: not used; the reason is given so that the search is not repeated.

| Source | Licence | Status | What it did |
|---|---|---|---|
| "Fluffy Blue-Eyed Cat (all animations)", Meshy AI | CC BY 4.0 (the owner's statement, 2026-10-21; Meshy's page was not checked) | ship-allowed | the cat's mesh, rest pose and colours (`cat.mesh`, `model.ts`). Its own clips are not shipped; its own walk was only traced to see how the body rocks. Named on the cat's settings page |
| Mesh2Motion fox animations (`fox-animations.glb`) | CC0 1.0 (assets), MIT (program) | ship-allowed | **walk, run, yawn**: the fox's joint turns put on the cat's bones, given a cat's style, planted on the floor, thinned |
| Fox of the glTF Sample Assets (Khronos) | model CC0 (PixelMannen); rigging and animation CC BY 4.0 (tomkranis); glTF conversion CC BY 4.0 (AsoboStudio, scurest) | ship-allowed | **stand**: the "Survey" animation, put on the cat's bones. Named on the cat's settings page ("changed to fit") |
| Quaternius cats (2022, 2023) | CC0 1.0 | reference-only | looked at as a donor of a cat's gait; one bone for each leg and 4 to 16 bones in all is too crude to drive this cat's legs |
| Mesh2Motion fox-cat rig variation, sit and idle sources | CC0 1.0 | reference-only | inspected, not used |
| "Sphynx cat rigged animated (10 anims)", Sketchfab | CC BY | reference-only | not used: it needs a sign-in to download and the file is not in the workbench. If it comes it gets its own entry, with its attribution, before any of it is used |
| Search for a better canonical cat (Objaverse 50 of 798,759 scanned, Quaternius, Poly Pizza, Poly Haven, Wikimedia Commons, OpenGameArt) | CC0 or CC BY only were kept | rejected | none came near the Meshy cat (the best two scored 4 of 5 on a clay render and are low-poly) |
| MoCapAnything, arXiv 2604.28130 | – | rejected | its reported joint error (about 23 degrees) is more than a cat's leg chain can take |
| Furever (a commercial cat app) | – | rejected | never run; no asset, code or telemetry of it is used |
| Blender 4.5 | GPL-3.0-or-later | reference-only (a tool) | reads and exports the cat's rig (`scripts/cat/anim/blender/export_rig_fbx.py`); nothing of it is in the app |

Every other clip (sit, loaf, doze, curl, shift, crouch, wiggle, stretch, jump, climb, scale, stalk, groom, point, tap, pet, knead, sniff, swat, peek) is made in this repository by `scripts/cat/anim/`: postures told as numbers and solved for the cat's own bones. No data of any source above is in them, except the stalk, which is laid on the walk's stride (so it is the Mesh2Motion fox's too, CC0).

## Where the files are

Big files stay out of the repository, in `C:\Users\Me\tools\cat-workbench\`: `canonical\` (the Meshy file and its checksum), `donors\` (the fox files and the Quaternius cats, with their licence texts), `blend\` (the 30-bone mesh and clips from before the rig was changed), `mocap-v2\` (the rig as an FBX).

## What the app shows

The cat's settings page names the Meshy model and the fox's animation, with the licence and the note that they were changed to fit (`cat.settings.credit`, en / ro / it). The wider register is `reports/kino-cat/06-risk-and-license-register.md`.
