# 02 · Renderer comparison

The brief asks for the renderer to be chosen by measurement, not taste. Two renderers were built and measured behind one contract (`CatFrame` in, pixels out; see 03). The others were ruled out on constraints, **not** measured; the table says which is which.

## What the cat has to do (the constraints that decided it)

1. Look like an animal, not a sticker: a body with a front and a back, foreshortening, fur, an eye that has depth.
2. Move from rules, not from recordings: feet that do not slide when the cat walks 40 px or 400 px, a paw that reaches an arbitrary poster, a jump that lands on a shelf wherever the page put it, a head that turns to the focused card. Anything pre-rendered cannot adapt.
3. Run on a TV browser: no WebGL 2, no WebGPU, no video-with-alpha assumptions, little memory, a slow CPU. It must also be able to *not run* (the governor).
4. No third-party art, no new dependency, a small download that is fetched only when the cat is on.

## Options

| Option | Built? | Measured? | Verdict | Reason |
|---|---|---|---|---|
| Sprite sheets / pre-rendered frames (what a desktop pet usually ships) | no | no | rejected as shipped art from elsewhere; **possible as a tier made from our own renderer** (next row) | needs an art set that is licensed or commissioned; frames × directions × coats × sizes is megabytes; a foot cannot be made to stay put for any distance; it cannot point at a poster it has never seen |
| Sprites rendered from the detailed cat with our own renderer (the owner's idea: "the light website version") | no | no | **next**, for weak screens | the lab already draws any pose of the rig to a canvas, so an atlas of the poses and walk cycles is a build step and a small Canvas 2D painter; it would replace the cartoon fallback (ISSUE_LOG #13); cost to find out: how many frames per walk speed keep a foot from sliding, and the megabytes per coat |
| Video with an alpha channel | no | no | rejected | alpha video is not dependable across TV browsers; no interactivity; same art-set problem |
| Lottie / Rive / Spine runtimes | no | no | rejected | a runtime dependency and an authored asset, and a licence to read for each; the clips would still be fixed |
| A 3-D library (three.js, Babylon) | no | no | rejected | one skinned mesh and a few shaders are needed; a general engine is many times the size of the whole cat; not measured here |
| WebGPU | no | no | rejected | not in TV browsers |
| DOM/SVG with CSS transforms | no | no | rejected (inferred) | dozens of animated nodes per frame for a body with a tail and four legs; layout and style work on a slow CPU; no skinning |
| **Canvas 2D live rig ("simple", `classic` in the code)** | **yes** | **yes** | **kept as the fallback** | works everywhere; the rig (springs, two-bone legs, ten-joint tail) is the same one the detailed cat uses; it looks like a drawing |
| **WebGL1 skinned mesh ("detailed", `solid` in the code)** | **yes** | **yes** | **the default where WebGL is good enough** | reads as a body; every animation of the rig drives it; needs `WebGL1` and ≥ 112 vertex uniform vectors (32 bones); the renderer checks both, plus the mesh's header and the stamp of the rest pose it was made around, and reports "no" instead of throwing |

## How the detailed cat is made

(The first detailed cat was a body made here from signed-distance primitives, with shell fur; the owner asked for a better one, gave a reference picture and then a free model, and that cat was **removed**: the journal, entries 2, 11 and 22, tells how it was made and why it was replaced. What follows is the cat that is built now.)

- **The body** is a mesh made offline from "Fluffy Blue-Eyed Cat" by Meshy AI (CC BY 4.0; the owner's statement, credited in the app and in 06). `scripts/cat/model/build-meshy.mts` reads the GLB (which stays outside the repository), puts it in the rig's frame, joins the vertices the file split only to give each its own place in a texture, paints each vertex with the colour the texture has there (the eyes are taken out: the shader draws them so that they can blink), bakes how open to the room each vertex is, and skins every vertex to the 32 bones of our skeleton (the file's own weights are no use: its tail has five bones and the last carries the whole tip). Shipped as one binary (`cat.mesh`, 11,181 vertices, 272,179 bytes, 165 KB gzip, 148 KB brotli; 16-bit positions, 8-bit normals, delta-packed varint indices) and a small `model.ts` (the model's rest pose and a stamp; the renderer refuses a mesh made around another one).
- **The pose** (`render/gl/fit.ts`, `skeleton.ts`): the rig's pose is carried to the model as a change from the rig's rest to the model's rest (the body and the head keep their way along the cat, the legs are solved again for the model's own bone lengths, the tail keeps the model's own curve), and the skeleton turns it into 32 bone matrices: legs (three bones each) and tail (ten) are chains, the body and the head follow the rig's lines, the jaw is its own bone, driven by one lip-line function that both the offline build and the shader use so that what is skinned and what is painted agree.
- **The coat** is the colour its maker painted into the vertices (a pale ragdoll with grey points: the owner's reference), lit by how open to the room each point is, a rim light and a soft sheen. The other four coats (ginger, tuxedo, grey, calico) are painted over the light and dark of those colours by the fragment shader (tabby stripes that lean back down the flank; a white chest and socks; patches), and the eyes (pupils that widen with the cat's liveliness, blinks, a look about), the nose and the mouth are drawn by the shader too. No texture files. Five coats and three sizes are data (`render/gl/coats.ts`, `settings.ts`).
- **There is no fur shell any more** (the first cat had them: up to 12 extra passes); the model's own fur is in its geometry, so the picture is one pass, and the picture's cost no longer depends on a count of layers.
- **The canvas** is four body lengths wide and follows the cat (about 444 px square at 1080p), not the screen: the cost of the picture follows the cat's size, not the screen's (a full-screen layer would be ten times the pixels).
- **A real GPU draws it like the software driver does, to the eye**: the lab's sheets looked the same on the RTX 3090 (D3D11) and under SwiftShader (the pose sheet of the first solid cat differed by 0.48/255 on average and by more than 40/255 on 0.13 % of pixels, fur-edge noise; not measured again on the final model). The silhouette table is made from the real-GPU pictures.

## Measured (details in 05)

| | classic (Canvas 2D) | solid (WebGL1) |
|---|---|---|
| Cat's JavaScript per frame (Ryzen 9 5900X) | about 0.1 ms | about 0.16 ms (`think` 0.02 + `paint` 0.14) |
| What the page's frame rate does, real GPU (RTX 3090), 1080p/720p | no change (130 fps) | no change (129.6–130.0 fps), worst gap 9.1 ms |
| Governor's reading, real GPU | – | 0.14–0.33 ms of the 2 ms budget (its own JavaScript plus what the card needs for the picture); stays on the detailed cat even with the processor 6× slower (0.9–2.0 ms, 1.3 at the end) |
| Software GL, governor held off, 1080p / 720p | 60 / 60 fps (no change) | **59.6 / 60.0 fps** (the first cat, with its shell fur, gave 10 / 22; this one is a single pass of one mesh) |
| Software GL, governor on | – | still steps down, because the host reads 10–17 ms of drawing per frame: the lean picture at 3 s, the simple cat at 8–9 s, page at 60 fps. More cautious than this 24-thread PC needed (the drawing runs on other cores), right for a screen with fewer |
| Download | in the lazy chunk (below) | + 272 KB mesh (165 KB gzip), fetched once, only if WebGL works |
| Look | a drawing; one coat | a body from the owner's model; five coats |

The numbers are from the final pass (2026-10-21) for the cat made from the owner's model, and they replace the first cat's (0.5–0.65 ms of JavaScript, 17 / 31 and later 10 / 22 fps on software GL: up to 12 passes of shell fur): the host charges the governor with the cat's own work only, and the governor takes its time before it judges (ISSUE_LOG #21, #25, #32).

Lazy chunk `host-*.js` (engine, rig, classic painter, GL renderer, shader, panel, the hand): **140.3 KB raw, about 51 KB gzip**, plus a 4.9 KB stylesheet (1.7 KB gzip). The plan's budget "< 150 KB before art" is met (raw as well as gzipped, the raw one narrowly). What a page that never turns the cat on pays: **about +6.6 KB gzip** across the always-loaded files (the switch, the corner button, the loader, the texts in three languages, the model's credit), measured by comparing the build with main's from before the first cat; no dependency was added.

## Decision and conditions

The solid cat is chosen wherever the device offers WebGL1 with enough uniform vectors and the mesh arrives within 8 s; everything else, and everything the governor cannot keep within budget, gets the simple cat; and a screen that cannot spare even that gets none. The detailed cat can also be switched off in Settings or with `?catart=classic`.

**What would change this decision:** a real TV or Fire Stick on which the solid cat costs more than the 4 ms low-power budget with the lean picture (then the default on TVs becomes the simple cat until the shader is cut down), or on which the shell fur shows banding or fails to compile (the renderer already falls back on a failed compile). Neither has been seen: see "Not tested" in 05.
