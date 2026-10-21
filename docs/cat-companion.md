# The cat companion: an opt-in cat that lives on the TV's screen

Built in three rounds: `feat/kino-cat` (the first cat), `feat/kino-cat-2` (the detailed cat, PRs #28/#29) and `feat/kino-cat-3` (exactly two cats to choose from, the cat that goes to the title it is asked to find and swats at it, the cat that reacts when its row is scrolled, and a few more things it does of its own accord). **Off for everybody until the host sets `CAT_COMPANION=on` and a screen's owner turns it on.** The long reports (research, renderer choice, test matrix, risks, journal) are in `reports/kino-cat/`; this page is the short version for whoever works on the site.

## What was asked

An original animated cat for Kino, in the spirit of a desktop pet but for a streaming site: it walks on the objects of the page (the rows of posters), rests, sleeps, can be petted and called, finds a title on request, lounges in a film without covering the controls, the subtitles or the remote's focus, and never starts anything. The owner then asked for a more realistic, more detailed cat than the first, flat one (2-D or 2.5-D both fine), gave a reference picture (a fluffy blue-eyed bicolour ragdoll) and, in the end, a free model to build it from: **the detailed cat's body is made from "Fluffy Blue-Eyed Cat" by Meshy AI (CC BY 4.0, named in the cat's settings page and in `reports/kino-cat/06-risk-and-license-register.md`)**, with the skeleton, the animations, the eyes and the mouth written here. Furever Dock, a commercial desktop pet, was a research reference only: nothing of it is in the repository (`reports/kino-cat/01-reference-analysis.md`, `06-risk-and-license-register.md`).

## What it does

| Where | The cat |
|---|---|
| The library (`/tv`, a computer's browser, a phone used as the screen) | walks along the tops of the posters, leaps to other rows, sits, lies, sleeps, washes, stretches, yawns, scratches, kneads, sniffs, stalks a poster and pounces, goes up to a poster on its shelf and pats it (the poster gives a little), now and then has the zoomies (runs and leaps from shelf to shelf, then sits down, pleased with itself); looks at the card that has the remote's focus and sits by it; keeps out of words, buttons and that card, and settles, when the shelf has such a place, where its body does not cover the names under the cards |
| The viewer scrolls the row the cat stands on | the posters slide under it and it goes with them (it is on them); when they have carried it a good way (1.2 body lengths) it hops back to where it was, or, now and then (35 %), away to another row, and sits. A cat that is quiet, or for a viewer who wants less motion, only goes with the posters and does not hop. A page scrolled up and down, so that another shelf is where its feet are, makes it stand on that shelf (it does not leap off for nothing) |
| A title's page, a menu, a dialog over the library | is sent away and is back when they close |
| A film | rests at the foot of the picture, between the groups of the controls, in a layer under the controls, the subtitles and the toasts (it never covers one, and none of them makes it come or go); a device can say "no cat in films". It is nobody's to pick up there: the cat takes no hand, and a tap, a double-tap or a hold on that patch of the picture is the player's like anywhere else on it |
| The corner button (cat's head, beside the bell and the profile) | opens its panel: come here, pet, sit, sleep, play, go away, and **find me something**: the cat picks a title that is on the page, by the mood and the shelf names (en/ro/it); the poster glows and the cat **goes to it** (see "Finding a title" below): hops along the poster's own shelf, creeps up on it, swats at it with a paw (the poster rocks under the paw), points, and sits and glances at the viewer; "Open it" opens its page like OK on the poster; nothing is ever played |
| Settings → Cat companion (its own page, only where the host offers a cat) | on, quiet (it rests where it is: a TV starts with this on), films, **which cat: exactly two, the white and grey ragdoll (the detailed one, the default) and the ginger cartoon cat**, size; when the ragdoll was chosen and the screen can only give the simple version, a line that says what is drawn and why (the screen was too slow, no WebGL, the file did not come, the browser took the picture away) and a "try again" button; and the model's credit ("Fluffy Blue-Eyed Cat" by Meshy AI, CC BY 4.0) |
| A mouse resting on the cat | strokes it |
| A mouse pressed on the cat and moved (more than 8 px) | picks it up by the scruff: it hangs (paws dangling, tail down, a little swing), follows the hand and shows, as a soft ellipse on the shelf, where letting go would put it |
| The hand lets go | the cat falls to that shelf (or the nearest one it can reach), lands, and sits or washes. A hand that is lost (a window that loses focus, a tab that is hidden, a pointer that vanishes) lets it go too, and so does 2.5 s of silence |
| A press that only wobbles (a stroke), `prefers-reduced-motion`, quiet | lifts nothing; the cursor does not offer a grab or close on the cat |
| A second hand (a finger) while the mouse has the cat | changes nothing: the first hand keeps the cat until it lets go |
| `prefers-reduced-motion` | the cat only rests, in one place |

The phone as a *remote* has no cat. The cat lives on the screen that plays.

## Gates and the kill switch (all must be open)

| Gate | Default | How |
|---|---|---|
| The host offers it | off | environment variable `CAT_COMPANION=on` → `GET /api/features` `{cat:true}` (also `/api/health` `features.cat`). **Unset it and every screen loses its cat at its next load**; nothing is stored on the server |
| The screen's role | the screen that plays only | automatic |
| The device asks for it | off | Settings → Cat companion (`kino.cat` in the device's own storage), or `?cat=on` for one load |
| (testing) address | – | `?cat=on|off|debug`, `?catseed=N`, `?catbudget=ms`, `?catslow=ms`, `?catart=classic|solid`, `?catcoat=` (the settings offer the two cats; the address can still ask for the tuxedo, grey tabby and calico coats, to look at them), `?catsize=` |

Nothing of the cat is downloaded before the gates are open: the always-loaded part is the switch, the corner button, the loader and the texts (+6.6 KB gzip over the whole app: the scripts of `/tv` were 127.6 KB gzip on `main` after PR #27 and are 134.2 KB now); the cat is a lazy chunk (`host-*.js`, 51 KB gzip, plus a 1.7 KB stylesheet) and, for the detailed cat, one mesh file (`cat-*.mesh`, 165 KB gzip), fetched once.

## Two cats, one governor

- **Detailed cat** (WebGL1): a skinned model (`scripts/cat/model/build-meshy.mts` makes `cat.mesh` offline from the free Meshy AI model, which is *not* in the repository: 11,181 vertices, 32 bones, 165 KB gzip). The engine's pose (`rig.ts`: springs, two-bone legs, a ten-joint tail, a jaw, ears and eyelids) is fitted to the model by `render/gl/fit.ts` and skinned on the graphics card. The coat is the colours its maker painted into the vertices (a pale ragdoll with grey points) lit with how open to the room each point is; the other four coats are painted over the light and dark of it by the fragment shader (tabby stripes, tuxedo and calico patches), and the eyes (which blink and look about), the nose and the mouth are drawn by the shader too. Needs WebGL1 and enough uniform vectors; otherwise, or if the mesh does not come within 8 s, or the context is lost, the simple cat is drawn.
- **Ginger cat / simple cat** (Canvas 2D): the same skeleton drawn with paths, a cartoon in outline, about a tenth of the cost. Since round 3 it is a cat in its own right, the second choice in Settings (the owner liked it and asked to keep it), and it is also the fallback of the ragdoll: when the ragdoll was chosen and the screen cannot afford it, the same painter draws it in the ragdoll's colours (white and grey), so the choice is kept. The owner has asked for sprites of the detailed cat to take that place (see "Next").
- **What is really drawn** is reported by the host (`setCatShown` in `settings.ts`: `art` = solid / classic, `why` = slow / graphics / file / lost) and read by the settings page (`useCatShown`), which says so when the ragdoll was chosen and the simple version is on the screen, and offers "try again" (`retry` on the bus: the governor and the mesh load start afresh). This is why a phone that chose the new cat and showed the old one (the owner's report) is not left looking like a choice that did nothing.
- **Governor** (`host/governor.ts`): from the *measured* cost of a frame (the cat's JavaScript plus a one-pixel read-back that makes the browser wait for the card) it moves detailed → low (half the frame rate and one canvas pixel to a screen pixel) → simple cat → no cat, and gives nothing back for a long stretch. Budget 2 ms (a desktop), 4 ms (a TV's user agent).

## Finding a title (the journey)

"Find me something" picks the title (`host/assistant.ts`) and shows the card (`host/panel.tsx`); what the cat does then is the engine's, in this order:

1. **The page makes room.** The panel scrolls the library so that the poster is whole (`bringIntoView`, `host/effects.ts`), and, when the page's fixed furniture (the hero's text, the cat's own panel, the row labels) would leave the poster's shelf without a place to stand beside it, a little further, so that the shelf has one (`shelfRoom` in `host/index.ts`: the shelf must be at least one body length and a tenth below the lowest fixed zone; the poster must stay whole).
2. **The ask waits for the cat.** 650 ms later the host sends `cat.enable` + `cat.point(id)`. When the cat is mid-leap, or its shelf has just been scrolled off, the engine keeps the ask (`pendingPoint`, for up to 8 s) and starts the trip in the first frame the cat can set out, instead of dropping to a bare point from wherever it stands (this was the bug that made the journey vanish on the real page). The host sends it once more after 1.8 s if the cat shows no sign of having taken it.
3. **The trip.** `pointAt` looks for a place on the poster's own shelf where the paw lands on the poster (`swatSpots`: a poster lies below the feet line, and the paw's reach is `SWAT_REACH`, 0.62 body lengths), and if there is one plans `swatTrip`: hops or runs there (a leap to the shelf if it is on another), creeps up the last stretch (`CREEP`), looks at the poster, wiggles, swats twice (the first after `SWAT_FIRST`, the second after `SWAT_SECOND`), points, and sits. When the shelf has no such place (the furniture of the page leaves none), it comes to the nearest legal place (`nearTrip`) and only points, rather than swatting at the air.
4. **The poster gives.** The engine's `swat` clip has a contact moment (`SWAT_HIT`, 0.44 of the swing); the host sees the clip cross it and rocks the poster (`swatPoster`, `host/effects.ts`: a small shove away from the paw and a turn, with the Web Animations API, 560 and 640 ms; nothing at all for a viewer who wants less motion, and the poster is never altered after).
5. **The cat looks back at the viewer** (a short glance) from where it sits by the poster.

Nothing is ever played or opened by the cat.

The same swat is what the cat does of its own accord when it pats a poster on its shelf.

## When the page moves under the cat

- **A row scrolled sideways** (`rideRow`): described in the table above. The cat is carried by the posters that slide (the middle of how far those still on the shelf moved, so that a row that was made over is not taken for a scroll), eased in over a few frames, and hops back or away once carried `CARRIED_FAR` (1.2 body lengths), at most every `CARRIED_EVERY` (1.4 s). It never turns away from a poster it has been sent to (a pending point, a trip or a swat in the queue).
- **A page scrolled up or down** (`adoptShelfUnder`): when the shelf the cat stood on has left the page and another shelf is where its feet are (within a quarter of a body length: it is set on the new shelf in a frame, and that is kept under what its fastest movement covers in a frame at 60 fps), the cat is on that shelf; it does not leap off.
- **A window made smaller under a walking cat** can leave the place it was walking to off the screen: the walk's goal is held to the shelf, and a cat that is more than 0.4 body lengths outside its shelf runs back in (`hurry` in `walk`) instead of strolling, cut by the edge of the screen all the way (the long soak found 2.0 s of that).
- Anything else that takes the shelf away (a menu, a smaller window) is the older rule: leap to another shelf, or fade out and come back somewhere else.

## Try it

```powershell
cd C:\Users\Me\Desktop\WebPlayer\.claude\worktrees\kino-cat   # or the main folder after the merge
$env:CAT_COMPANION = "on"; $env:PORT = "8830"
pnpm start
```

Open `http://localhost:8830/tv?cat=on` (the cat for this load only; add `&catseed=7` for the same cat every time, `&cat=debug` instead of `cat=on` to see what it sees: green = places to stand, red = keep-outs, orange = names it would rather not sit in front of, blue = posters, and a text block with its act, quality, cost and fps; with `cat=debug` only, `window.__kinoCat` offers `snapshot()`, `send(event)`, `panel` and `world()`, the same page the cat reads, for a script or the console). To keep it: Settings → Cat companion. `dist/client` must be current (the last commit of the branch rebuilds it).

## Code map

- `src/client/cat/engine/`: the brain, no browser: `engine.ts` (acts, moods, choice, leaps), `ledges.ts` (where it can stand; leap planning; where to settle), `sim.ts` (a made-up page and bad afternoons for tests).
- `src/client/cat/render/`: `rig.ts` (springs, two-bone legs, tail, scenes), `swat.ts` (the swing of a paw at a poster, as a pure function of the clip's phase: raised, brought down through the line to the poster at `SWAT_HIT`, pressed, flicked back), `draw.ts` (the simple cat), `gl/` (skeleton, shader, coats, renderer, the mesh).
- `src/client/cat/host/`: `index.ts` (the loop; the find journey's host half: `shelfRoom`, `askToPoint`, the swat contact), `page.ts` (reads the DOM into a `World`), `governor.ts`, `render.ts`, `panel.tsx`, `assistant.ts` (find me something), `effects.ts` (scrolling a poster into view, the poster's rock under the paw), `hand.ts` (petting), `debug.ts`.
- `src/client/cat/{settings,boot,bus,Chip}`: the part that is in the first download.
- `scripts/cat/`: the lab (pose sheets, film strips, recordings, the soak) and the offline model build. Development tooling only.

## Tests

```powershell
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/vitest/vitest.mjs run src/client/cat src/client/i18n/cat.test.ts src/server/features.test.ts
$env:pnpm_config_verify_deps_before_run = "false"; $env:E2E_PORT = "8841"
node node_modules/@playwright/test/cli.js test e2e/cat.spec.ts --reporter=list
node node_modules/tsx/dist/cli.mjs scripts/cat/soak.mts 13 412 600
```

227 unit tests (9 files), 38 end-to-end tests, and a soak that puts the brain through 3,200 bad afternoons (400 seeds × 8 kinds, 10 minutes each: a window made smaller, a hand that carries the cat, menus, films, a hidden tab, rows of posters slid sideways under it, 20 and 60 fps) and checks that it is never stuck, never off the screen, never over a keep-out zone for long, never jumps farther than a cat can in a frame (the last run of it found nothing, about six minutes; it also prints what the cats chose to do, so a behaviour that never comes up shows). Every seed that ever found a fault is kept in the engine tests (`the afternoons that once found it out`). The e2e run rebuilds `dist/client` (a tracked folder); the last commit of the branch is the final build.

## Next

- **A sprite version for weak screens** (asked for by the owner): draw the detailed cat's poses and walk cycles to an atlas with our own renderer (the lab's `glsheet.mjs` already draws any pose to a canvas), ship it as one WebP and one JSON, and draw it with a small Canvas 2D painter where WebGL is too dear, in place of the cartoon fallback. The governor already has the rung for it. Not built.
- A pass on real screens (a TV, a Fire Stick, an Android phone, an iPhone, Safari) with `?cat=debug`: the cost of the detailed cat there is unknown.
- The cosmetic items in `reports/kino-cat/ANIMATION_BACKLOG.md` (flaps of fur on the model, the inside of the mouth, the scratching leg).
- The owner to check the model's licence on the page it came from (`reports/kino-cat/RELEASE_CHECKLIST.md`, §4).

## Not checked

No real TV, Fire TV Stick, Android phone, iPhone, iPad or Safari: everything ran in Chromium 156 on one PC (a real GPU, and a software driver as the worst case). The detailed cat's cost on a weak device is unknown; the simple cat and the governor exist for that. See `reports/kino-cat/05-qa-and-performance-matrix.md`.
