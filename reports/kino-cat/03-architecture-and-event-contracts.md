# 03 · Architecture and event contracts

```
 Kino's TV page (DOM)                       src/client/cat/
 ───────────────────                        ──────────────────────────────────────────────────────────────
 .tv-row / .tv-tile / hero / HUD   ──read──▶ host/page.ts   TvPage.read()  ─▶  World  (plain numbers)
 focus, pointer, video state                                                       │
                                                                                    ▼
 Settings / flags / kill switch ─▶ settings.ts, boot.ts           engine/engine.ts  CatEngine.update(world, dt) ─▶ CatFrame
                                                                    (mood + utility choice + acts + jumps, seeded RNG)  │
 viewer's hand (pet, panel, Back) ─▶ host/hand.ts, panel.tsx ─▶ events ─▶ engine                                    ▼
                                                                    render/rig.ts  CatRig.update(frame, dt, px) ─▶ Solved (joints, legs by 2-bone IK, tail)
                                                                           │                         │
                                                                           ▼                         ▼
                                                           render/draw.ts (Canvas 2D, "classic")   render/gl/* (WebGL1 skinned mesh + shell fur, "solid")
                                                                           ▲                         ▲
                                                           host/governor.ts: full → low (30 fps, classic) → off, from measured frame cost
```

## Boundaries (what may import what)

| Layer | Knows about | Does not know about |
|---|---|---|
| `engine/` (brain, motion, ledges, sim helpers) | `World` in, `CatFrame` out, the seeded RNG, virtual time | the browser, the DOM, the renderer |
| `render/` (rig, shapes, Canvas, GL) | `CatFrame`, pixel size | the page, the engine's decisions |
| `host/` (loop, page adapter, panel, hand, governor, effects, debug) | everything above, the DOM, `requestAnimationFrame` | Kino's React state (it reads the DOM, not component state) |
| `settings.ts`, `boot.ts`, `Chip.tsx`, `bus.ts` | Kino's first download | the cat's own code (it is a lazy chunk) |

Consequences, all used: the whole behaviour runs headless in a test or a soak from a seed (`sim.ts`, `scripts/cat/soak.mts`); the art can be swapped (classic ↔ solid is already two renderers behind one `CatFrame`); Kino's pages need no change except one corner button.

## The page → cat contract: `World` (types.ts)

`viewport`, `bodyLength` (px; everything is measured in body lengths so any screen size works), `surfaces` (walkable lines: `shelfTop`, `heroLedge`, `playerPerch`, `fallbackFloor`), `keepOut` (rectangles: words, buttons, focus, HUD, subtitles, toasts), `soft` (optional: the names and years under the cards, as wide as the words; see below), `targets` (posters, with the catalogue id and the surface under them), `focus`, `pointer`, `mode` (`browse` | `player` | `away`), `player` (`none`…`error`), `controlsUp`, `quiet`, `reducedMotion`.

The engine cuts every surface by the keep-outs (`computeLedges`, `HEIGHT = 1.02`, `MIN_LEDGE = 0.45` body lengths): the cat can only stand where its whole body (about one body length high) would not overlap a keep-out, and a stretch shorter than 0.45 body lengths is not a place at all. A shelf is therefore split into several standing places wherever a keep-out reaches it, and the cat hops between the pieces.

**Soft words (`World.soft`).** The names under the cards are not keep-outs (a cat that crossed a shelf could never get past them, and the shelf would be cut into nothing), but a cat that is about to settle for a while should not sit over them either. `restSpot(ledge, from, bodyLength, pose, soft)` (engine/ledges.ts) scans the shelf within 3.5 body lengths for the spot where the cat's body *in the posture it is about to take* (`POSE_BOX`: sit 0.72 body lengths high, loaf 0.46, curl 0.4, stand 1.02) covers the least of them; it is used when that covers at most half of what the cat's own place covers, never moves a cat that is not free to roam (quiet, reduced motion), and returns nothing when no place is better, so the cat then stays where it is. `rest`, `sleep` and the pause at the end of a `wander` use it. Measured: resting in front of a name 65 % → 6 % of the time on the sim page (05).

## The cat → renderer contract: `CatFrame`

`x,y` (feet line under the body's middle), `facing`, `clip` (18 clips, see 04), `clipTime`, `progress` (one-shots), `odometer` (feet are driven by distance walked, so they do not slide), `vx,vy`, `grounded`, `look` / `viewer` (eyes), `reach` (pointing paw), `drowsy`, `energy`, `appear`, `petted`.

## Events (the plan's §4.5), with what is really wired

| Event | State |
|---|---|
| `cat.enable`, `cat.disable` | **wired** (mount, panel/chip, settings) |
| `cat.pet`, `cat.petEnd` | **wired** (a hand resting on the cat for a moment; the panel's pet button). A pointer that only passes over is not petting (e2e 10). |
| `cat.command` `sit` `sleep` `play` `away` `come` | **wired** (panel) |
| `cat.point` | **wired** ("find me something": the pick is pointed at, never opened) |
| `catalog.itemFocused` | **wired** (the page's focused poster; the cat watches it from a seat next to it) |
| `player.play` `pause` `resume` `ended` | **wired** (from `main.tv[data-state]` changes) |
| `player.error` | sent; the engine has no special act: the player mode `error` makes it sit for 20 s |
| `cat.call` | engine handles it (walks to a point); **no page caller yet** (the panel's "come" goes through `cat.command`) |
| `route.enter/leave`, `ui.modalOpened/Closed`, `viewport.resized`, `app.visibility`, `device.quality`, `player.enter/exitFullscreen`, `catalog.searchCompleted` | **declared in the union, not used**: the host reads the same facts straight from the DOM each tick instead (view name → `route`; modals → `mode: "away"`; `document.hidden` → loop pauses; the governor → quality; the pick uses the shelves on the page, not a search). Kept in the type so a future adapter has a place to plug into. |

## Decision model (engine.ts `choose`)

Utility choice with cool-downs, not a random timer: `rest` (1.0 + 0.8·sleepiness), `wander` (0.95·(0.4+energy)), `hop` to another shelf (0.8·(0.3+energy); cool-down 6–14 s; shelves visited long ago are more interesting), `groom` (45–90 s), `scratch` (70–140 s; never for a viewer who asked for quiet or less motion), `prowl` (poster 3.2–5.6 body lengths off on the same shelf: stalk, wiggle, pounce; 90–160 s), `stretch`, `yawn` (when tired), `sleep` (after 40 s idle, with a chance of kneading first), `watch` (a card has just got the focus). The same thing twice in a row is weighted ×0.35. Every act has a deadline (a 240 s watchdog at most), a cat riding a shelf that has no room for it leaves after 0.7 s, and a cat found where it should not be gets 1.6 s to move.

Moods (`sleepiness`, `energy`, `affection`, `curiosity`) drift and are nudged by events (pet +affection, focus +curiosity, call +energy). The random draws of every plan are made in a fixed order, so one seed is one cat (tested); a page that tells it of no words gets the cat it got before words existed (checked: 20 seeds × 600 s, 360,000 frames, identical checksum before and after the settling change).

In a film: `choosePlayer`: playing → loaf, then sleep (up to 600 s); paused/loading → loaf 12–18 s then sleep; ended/error → sit 20 s. The cat sits on the `playerPerch` (a corner of the picture, 0.7–3.6 body lengths in), which is outside the HUD and caption keep-outs by construction.

## Renderers

- **classic** (`render/draw.ts`): the rig drawn in Canvas 2D; ~⅒ of the solid cat's cost; ginger only. It is the fallback for no WebGL, a failed/missing mesh, a lost context, or a governor decision.
- **solid** (`render/gl/*`): WebGL1 only (no extensions required beyond what a TV browser has); one skinned mesh (`cat.mesh`, built offline from signed-distance primitives by `scripts/cat/model/*`, surface nets, 32 bones), shell fur, procedural painting in the fragment shader (coat, tabby stripes, tuxedo, calico, eyes, nose, mouth interior), whiskers as lines. No texture files.

## Lifecycle and safety

Everything the cat adds to the page is removed on `stop()` (canvas, panel host, debug view, listeners, `data-cat-pointed`); `bootCat` re-checks the settings on every change and on `storage` events, so switching the cat off removes it at once; the kill switch is the host's `CAT_COMPANION`. A failed chunk, mesh or context never breaks the page: the catch paths log a warning and the page carries on (e2e 14–16).

## Debug

`?cat=debug` shows a text block (act, queue, mode, surface, page name, places/keep-outs/posters, quality, ms per frame, fps, body px, art, mood, panel, player) and a map canvas (green = places to stand, red = keep-outs, orange = the names it would rather not sit in front of, blue = posters, yellow cross = feet). `window.__kinoCat.snapshot()` exists only in this mode (it also says how many names the cat knows of and how much of them its body covers just now).
