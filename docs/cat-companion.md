# The cat companion: an opt-in cat that lives on the TV's screen

Branch `feat/kino-cat`, off `main` after PR #27. **Off for everybody until the host sets `CAT_COMPANION=on` and a screen's owner turns it on.** The long reports (research, renderer choice, test matrix, risks, journal) are in `reports/kino-cat/`; this page is the short version for whoever works on the site.

## What was asked

An original animated cat for Kino, in the spirit of a desktop pet but for a streaming site: it walks on the objects of the page (the rows of posters), rests, sleeps, can be petted and called, finds a title on request, lounges in a film without covering the controls, the subtitles or the remote's focus, and never starts anything. The owner then asked for a more realistic, more detailed cat than the first, flat one (2-D or 2.5-D both fine), gave a reference picture (a fluffy blue-eyed bicolour ragdoll) and, in the end, a free model to build it from: **the detailed cat's body is made from "Fluffy Blue-Eyed Cat" by Meshy AI (CC BY 4.0, named in the cat's settings page and in `reports/kino-cat/06-risk-and-license-register.md`)**, with the skeleton, the animations, the eyes and the mouth written here. Furever Dock, a commercial desktop pet, was a research reference only: nothing of it is in the repository (`reports/kino-cat/01-reference-analysis.md`, `06-risk-and-license-register.md`).

## What it does

| Where | The cat |
|---|---|
| The library (`/tv`, a computer's browser, a phone used as the screen) | walks along the tops of the posters, leaps to other rows, sits, lies, sleeps, washes, stretches, yawns, scratches, kneads, sniffs, stalks a poster and pounces; looks at the card that has the remote's focus and sits by it; keeps out of words, buttons and that card, and settles, when the shelf has such a place, where its body does not cover the names under the cards |
| A title's page, a menu, a dialog over the library | is sent away and is back when they close |
| A film | rests at the foot of the picture, between the groups of the controls, in a layer under the controls, the subtitles and the toasts (it never covers one, and none of them makes it come or go); a device can say "no cat in films". It is nobody's to pick up there: the cat takes no hand, and a tap, a double-tap or a hold on that patch of the picture is the player's like anywhere else on it |
| The corner button (cat's head, beside the bell and the profile) | opens its panel: come here, pet, sit, sleep, play, go away, and **find me something**: the cat picks a title that is on the page, by the mood and the shelf names (en/ro/it), the poster glows and the cat points at it; "Open it" opens its page like OK on the poster; nothing is ever played |
| Settings → Cat companion (its own page, only where the host offers a cat) | on, quiet (it rests where it is: a TV starts with this on), films, detailed cat, coat (ragdoll, which is the default, ginger tabby, tuxedo, grey tabby, calico), size; and the model's credit ("Fluffy Blue-Eyed Cat" by Meshy AI, CC BY 4.0) |
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
| (testing) address | – | `?cat=on|off|debug`, `?catseed=N`, `?catbudget=ms`, `?catslow=ms`, `?catart=classic|solid`, `?catcoat=`, `?catsize=` |

Nothing of the cat is downloaded before the gates are open: the always-loaded part is the switch, the corner button, the loader and the texts (+6.6 KB gzip over the whole app: the scripts of `/tv` were 127.6 KB gzip on `main` after PR #27 and are 134.2 KB now); the cat is a lazy chunk (`host-*.js`, 51 KB gzip, plus a 1.7 KB stylesheet) and, for the detailed cat, one mesh file (`cat-*.mesh`, 165 KB gzip), fetched once.

## Two cats, one governor

- **Detailed cat** (WebGL1): a skinned model (`scripts/cat/model/build-meshy.mts` makes `cat.mesh` offline from the free Meshy AI model, which is *not* in the repository: 11,181 vertices, 32 bones, 165 KB gzip). The engine's pose (`rig.ts`: springs, two-bone legs, a ten-joint tail, a jaw, ears and eyelids) is fitted to the model by `render/gl/fit.ts` and skinned on the graphics card. The coat is the colours its maker painted into the vertices (a pale ragdoll with grey points) lit with how open to the room each point is; the other four coats are painted over the light and dark of it by the fragment shader (tabby stripes, tuxedo and calico patches), and the eyes (which blink and look about), the nose and the mouth are drawn by the shader too. Needs WebGL1 and enough uniform vectors; otherwise, or if the mesh does not come within 8 s, or the context is lost, the simple cat is drawn.
- **Simple cat** (Canvas 2D): the same skeleton drawn with paths, one coat, a cartoon in outline, about a tenth of the cost. It is the fallback, not the cat the owner asked for (ISSUE_LOG #13). The owner has asked for sprites of the detailed cat to take its place (see "Next").
- **Governor** (`host/governor.ts`): from the *measured* cost of a frame (the cat's JavaScript plus a one-pixel read-back that makes the browser wait for the card) it moves detailed → low (half the frame rate and one canvas pixel to a screen pixel) → simple cat → no cat, and gives nothing back for a long stretch. Budget 2 ms (a desktop), 4 ms (a TV's user agent).

## Try it

```powershell
cd C:\Users\Me\Desktop\WebPlayer\.claude\worktrees\kino-cat   # or the main folder after the merge
$env:CAT_COMPANION = "on"; $env:PORT = "8830"
pnpm start
```

Open `http://localhost:8830/tv?cat=on` (the cat for this load only; add `&catseed=7` for the same cat every time, `&cat=debug` instead of `cat=on` to see what it sees: green = places to stand, red = keep-outs, orange = names it would rather not sit in front of, blue = posters, and a text block with its act, quality, cost and fps; with `cat=debug` only, `window.__kinoCat` offers `snapshot()`, `send(event)`, `panel` and `world()`, the same page the cat reads, for a script or the console). To keep it: Settings → Cat companion. `dist/client` must be current (the last commit of the branch rebuilds it).

## Code map

- `src/client/cat/engine/`: the brain, no browser: `engine.ts` (acts, moods, choice, leaps), `ledges.ts` (where it can stand; leap planning; where to settle), `sim.ts` (a made-up page and bad afternoons for tests).
- `src/client/cat/render/`: `rig.ts` (springs, two-bone legs, tail, scenes), `draw.ts` (the simple cat), `gl/` (skeleton, shader, coats, renderer, the mesh).
- `src/client/cat/host/`: `index.ts` (the loop), `page.ts` (reads the DOM into a `World`), `governor.ts`, `render.ts`, `panel.tsx`, `assistant.ts` (find me something), `hand.ts` (petting), `debug.ts`.
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

195 unit tests (8 files), 34 end-to-end tests, and a soak that puts the brain through 2,800 bad afternoons (400 seeds × 7 kinds, 10 minutes each: a window made smaller, a hand that carries the cat, menus, films, a hidden tab, 20 and 60 fps) and checks that it is never stuck, never off the screen, never over a keep-out zone for long (the last run of it found nothing, about five minutes). The e2e run rebuilds `dist/client` (a tracked folder); the last commit of the branch is the final build.

## Next

- **A sprite version for weak screens** (asked for by the owner): draw the detailed cat's poses and walk cycles to an atlas with our own renderer (the lab's `glsheet.mjs` already draws any pose to a canvas), ship it as one WebP and one JSON, and draw it with a small Canvas 2D painter where WebGL is too dear, in place of the cartoon fallback. The governor already has the rung for it. Not built.
- A pass on real screens (a TV, a Fire Stick, an Android phone, an iPhone, Safari) with `?cat=debug`: the cost of the detailed cat there is unknown.
- The cosmetic items in `reports/kino-cat/ANIMATION_BACKLOG.md` (flaps of fur on the model, the inside of the mouth, the scratching leg).
- The owner to check the model's licence on the page it came from (`reports/kino-cat/RELEASE_CHECKLIST.md`, §4).

## Not checked

No real TV, Fire TV Stick, Android phone, iPhone, iPad or Safari: everything ran in Chromium 156 on one PC (a real GPU, and a software driver as the worst case). The detailed cat's cost on a weak device is unknown; the simple cat and the governor exist for that. See `reports/kino-cat/05-qa-and-performance-matrix.md`.
