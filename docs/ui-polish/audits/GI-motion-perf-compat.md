# G+I audit: motion, performance, compatibility

Auditor G+I, branch `ui/polish-system` at `7e183fb`, 2026-10-13. Letters: **G** = motion, **I** = performance + compatibility.

## 1. Scope and method

**Looked at.**
1. The classic look as built: `dist/client` (committed; built 19:35, i.e. before the refined TV sheet landed in `7e183fb`), served by my own server on port 8824 (stopped at the end) and driven by Playwright Chromium 156 on a Ryzen 9 5900X that was shared with seven other agents. Timings are noisy: medians of 2-3 runs, and I trust only relative comparisons.
2. Every transition, animation, keyframe, smooth scroll and `prefers-reduced-motion` rule in the six classic sheets and in `src/client/polish/{base,tv,phone}.css` (postcss scan: `motion-scan.txt`, `motion-scan-polish.mjs`).
3. The refined look is **not in `dist`**. I priced it by reading its sheets and by injecting the source `polish/tv.css` into the served page with `<html data-ui="polish">` [S]. (So `UI=polish` in the walk shows only `base.css` until someone builds.)
4. Every CSS feature and JS API newer than Chromium 68 in `src/client` and `src/shared` (`css-scan.txt`, `api-scan*.txt`), checked against what Vite 8.3.4 really builds.

**Evidence labels.** [M] measured by me, script in the scratch folder. [C] read in the code. [T] a tool's own table or source, run this session (esbuild 0.28.2 compat table, lightningcss 1.33.0, Vite's source, postcss). [S] simulation: the served CSS rewritten to drop what an old Chromium would drop, JS running in modern Chromium (it shows what the stylesheet leaves, not what a TV does). [R] **my memory of caniuse/MDN, NOT checked this session**: every Chromium version number below that is not marked [T], and the model-to-Chromium map (webOS 5 about 68, webOS 6 about 79, webOS 22 about 87, 23 about 94; Tizen 5.5 about 69, 6.0 about 76, 6.5 about 85, 7.0 about 94).

**Rigs.** "walk" = the screenshot walk's 44-title catalogue (489 DOM nodes on the TV home). "full" = a live-sized catalogue, 29 rows x 20 titles (the provider has 29 categories): 583 tiles, 5,370 DOM nodes, 6,612 layout objects, 3.9 k event listeners [M m1]. Pictures: stand-in JPEGs of TMDB's sizes (backdrop 218 KB, poster 95 KB; real TMDB w1280 measured 118-245 KB) or a 1x1 gif where the page's own cost was isolated. CPU slow-down = DevTools `Emulation.setCPUThrottlingRate` 4x / 6x: **an emulation, not a TV; I had no weak hardware.** "Per press" = main-thread ms per ArrowRight in a wide row (Chromium trace, RunTask, 8 presses).

**Not covered.** A real TV or old Chromium (all old-browser claims are [T]/[S]/[R]); video decode, hls.js, the server; Safari/Firefox; the phone beyond library scroll; accessibility beyond reduced motion (H).

**Scratch** (mine, ephemeral): `C:\Users\Me\AppData\Local\Temp\claude\C--Users-Me-Desktop-WebPlayer\76a1c5e2-d0fd-4798-b844-5854cd44ef86\scratchpad\audit-GI\` with `m1-dom` ... `m18-failure`, `sim/*.png`, `m5*-out.txt`, `m16-out-*.txt`, `css-scan.txt`, `api-scan.txt`, `experiments*.json` (the injected CSS of each experiment).

## 2. Findings

P0* = P0 against the brief's floor (Chromium 68-76); if the real floor is 94+ it drops to P2 (declare it, test it): see Q1.

| ID | P | Look | Where | What | Why it matters | Fix idea | Verified |
|---|---|---|---|---|---|---|---|
| I01 | P0* | both | `vite.config.ts:11` (no `build.target`), `i18n/index.ts:78`, `controller/Scanner.tsx:88`, `main.tsx:1` | The shipped JS needs Chromium 85+ just to parse. Vite 8 defaults to `baseline-widely-available` = chrome111 / edge111 / firefox114 / safari16.4 (Vite `node.js:720-726`, `34520`), so ES2022 is left as written; the newest syntax in any chunk is `??=` (85) at two sites; `?.` (435 uses) and `??` (275) are 80. No legacy build, no polyfills. | On webOS 5 (68), Tizen 5.5 / 6.0 (69 / 76), webOS 6 (79) [R] the entry chunk is a SyntaxError: blank page, and the `?debug` panel (first import of that same chunk, `main.tsx:1`) dies with it, so a tester gets no diagnostics. The repo's own test UAs are Chrome 76 (`browser.test.ts`) and 94-120 (`role.test.ts`). | Decide the floor (Q1), set `build.target`, pin it in `vite-config.test.ts`; `chrome68` lowers `?.` / `??` / `??=` for about +3% gzip [T]. | [T] every shipped chunk through esbuild 0.28.2: lowest target without unsupported syntax = 85; default read in Vite's source; +3% gz [T `lower-cost`] |
| I02 | P0* | both | `tv.css:9` (+33 more `inset`), 13 `aspect-ratio`, 72 `:focus-visible`, 189 flex `gap`, `tv.css:13` `--em`, 0 `@supports` | The stylesheets assume Chromium about 88 and have **no fallback for any of it**. `inset` (34 uses, none preceded by top/right/bottom/left): `.tv { position: fixed; inset: 0 }` collapses on < 87 and every absolute `inset:0` layer with it: black screen. `aspect-ratio` (13 uses, 12 rules without a height or padding fallback): posters, stills and wide art collapse on < 88. `:focus-visible` (72 uses; the focus ring itself is `tv.css:98-110`; 3 selector lists drop whole, `tv.css:1390,1393`, `account.css:157`): no ring on < 86. Flex `gap` (189 declarations): spacing collapses on < 84. `--em: max(min(...))` invalid on < 79 makes `font-size: var(--em)` fall back to 16px. Logical shorthands (8 uses) lose their padding on < 87. | One missing feature turns a stated-target TV into a blank or unusable one, and there is no `@supports` to degrade gracefully. | After Q1: a longhand line before each `inset`; a padding-top ratio box for the 13 art slots; margins or a probe class for gap; or refuse politely below 88 with plain HTML from a classic script. | [S] `sim/L85-hd-home.png`, `L76-hd-home.png` (black), `L87-hd-home.png` (rows with names, no pictures); `inset` / `:is()` / logical = [T]; 88 / 86 / 84 / 79 = [R]; counts [C `fallbacks.mjs`] |
| I03 | P1 | both | `tv/Browse.tsx:951-958`, `tv/pages.ts:307-337` (`rowsOfPage`: no cap, no windowing) | The TV home mounts the **whole catalogue**: 583 tiles, 5,370 nodes (walk: 489, so no test or screenshot shows this). Every focus move re-composites the whole page: 134-176 ms of main thread per press at 1x (medians of four sessions; Layerize 64-85, Commit 20-26, IntersectionObserver 16-21, Script 12-16), about 660 ms at 4x, 850-910 ms at 6x; key to next frame 22 / 70 / 114 ms at 1 / 4 / 6x; a held key at 6x leaves 317 ms frame gaps. Walk catalogue: 7-10 ms per press. Opening the menu rail pays the same page-size toll (122 ms at 1x with every transition off, G04). | The D-pad is the product's main interaction; on a TV several times slower than this CPU every press waits 0.7-0.9 s and held keys queue [emulation only]. | Window the home in JS: mount the focused row +-2 and the visible columns +4, spacers keep scroll sizes. `content-visibility` gives the same -50% but is Chromium 85+ [R], a no-op on old TVs. | [M m1 m2 m5 m12]; CSS-injection experiments: first 8 rows only -51% (E13), 8 rows x 14 tiles -58% (E14), plus no fills and no transitions -70% (E15; -48% at 6x because React still renders hidden tiles, I09) |
| I04 | P1 | both | `main.tsx:26` (`<Suspense fallback={null}>`; no error boundary anywhere in `src/client`) | Any throw in render or in an effect, and any failed chunk fetch, leaves a **blank screen: no message, no retry**. Ran it: Tv chunk blocked, `#root` has 0 children, body text empty, "Failed to fetch dynamically imported module"; `Object.hasOwn` removed and one letter typed in the TV search, `#root` goes from 1 child to 0 ("Object.hasOwn is not a function"). | Nobody can open a console on a TV: every compat gap (I05) or flaky chunk fetch is a dead end. | An error boundary around `<Suspense>` in `main.tsx` (plain markup: name, one line, Retry reachable with OK, the `?debug` hint) and the same Retry when a `lazy(import())` rejects. | [M m18] ran it; `m18-chunk-failed.png`, `m18-hasown.png` |
| I05 | P1 | both | `shared/search.ts:33`, `tv/Captions.tsx:12`, `tv/Browse.tsx:772` | Three APIs newer than the JS floor (85) run unguarded in main flows: `Object.hasOwn` (93 [R]) in the TV search path (`spelledOut` <- `matchLocal` <- the search effect `Browse.tsx:565`): the first typed letter blanks the app on Chromium 85-92; `replaceChildren` (86 [R]) in `CueText`'s layout effect: the first subtitle cue unmounts the app mid-film on 85; `target.matches(":focus-visible")` (86 [R]) in the title page's focus handler: a SyntaxError, so the page stops following the remote. | These are the TVs that pass the parser (Tizen 6.5 about 85, webOS 22 about 87 [R]) and then break. | `Object.prototype.hasOwnProperty.call(ALIASES, key)`; `node.textContent = ""; node.append(...)`; `try { ... } catch { return true }` around the match. | [M m18] for `hasOwn` (ran it with the API removed); [C] for the other two; versions [R] |
| I06 | P1 | both | `tv/Browse.tsx:1399,1424,1456` (tile art = `backdrop ?? image`), `controller/Library.tsx:281,303`, `controller/Rows.tsx:115,179,211`, `server/library/filmpire.ts:7-9,185-186` | Tiles 192-288 px wide (TV) and cards about 160 px wide (phone) load the **w1280 backdrop** (TMDB: 118-245 KB; w300: 7-19 KB). First paint of the full TV home requests 98 pictures (582 `<img>`, all `loading=lazy`): about 15-20 MB; a decoded 1280x720 bitmap is 3.7 MB, so 100 would be about 370 MB if all were decoded at full size [arithmetic, not measured]. | Slow first paint on a TV's network and memory; the row looks empty until the pictures land. | Rewrite `/w1280/` to `/w300/` (or `/w500/` for 4K) for tile art and phone cards; keep w1280 for the banner `Backdrop` only. | [M m1] 98 image requests at first paint; sizes of three live TMDB URLs (`live-images.json`) |
| G01 | P2 | both | `tv.css:1109,1121` (`.tv-tile` transform + color .18s; `.tv-tile-art` box-shadow .18s); refined `polish/tv.css:183,186,255` | A focus move animates three properties on the tile (scale, text colour, ring + shadow). Removing the transitions cuts the press by 36-44% (three sessions; 133.8 to 84.4 ms in the last); keeping only the `transform` transition still saves 27% (97.8 ms); drawing the ring with `outline` instead of `box-shadow` changes nothing (96.8). One running animation is enough to force a full frame pipeline for 180 ms, so the saving needs the colour and shadow ones gone. | Held keys restart the animation each time; on a slow TV the animation is the lag. | Ring and colour switch instantly; only `transform: scale()` transitions (.18s). The refined sheet has the same three rules: same change. | [M m5, m5b, m5d] E4 / E16 / E18 (CSS injected into a copy of the page, median of 3) |
| G02 | P2 | both | `tv.css:924,1009,1051,1557` (`.tv-hero-bg`, `.tv-hero-text`, `.tv-detail-text`, `.tv-row`: `animation: ... both`) | Entry animations end with `fill-mode: both`, which keeps every element on its own compositing layer **forever** (`ActiveOpacityAnimation` / `ActiveTransformAnimation`). Full catalogue at 1080p: 42 layers, 27.7 Mpx drawn (viewport 2.07 Mpx); with `backwards`: 8 layers, 7.7 Mpx; about -10% per press at 1x on top. The `to` state of `tv-rise` / `tv-fade-in` is the resting style, so nothing visible changes. | GPU memory and raster time for nothing on a weak TV; every row owns a full-width layer. | `animation-fill-mode: backwards` on the four rules (never `both` or `forwards` for entry motion). | [M m4] `LayerTree.compositingReasons` at 1920x1080 with and without `fix-fill.css`; [M m5] E1; keyframes read [C] |
| G03 | P2 | both | `tv.css:2006-2014` (the only TV block), `controller.css` (none), `polish/*.css` (none) | Reduced motion is patchy. With `reduce` emulated, classic TV still animates 7 kinds of element (the `.tv-tile-art` ring x42, the rail's width and margins, account chip, corner button, rank numerals). The **refined look is worse, 14 kinds**: its rules out-rank the classic block (`:root[data-ui="polish"] .tv-tile` beats `.tv-tile` inside the media query), so the tile `transform`, the hero button and the sibling dimming (opacity .25s on top bar, banner and rows) come back. The classic phone has no block at all (`.lib-art` x44, `.lib-round` x44, `.btn`, pills move). JS `behavior: "smooth"` (`Browse.tsx:199,200,210,211,666-668,773`) never asks; shimmer (`tv.css:1189`) and caret (`1306`) are not covered. | Phones expose Reduce Motion, and so do desktop testers; those users still get lift, slide and shimmer. | One block per sheet (`animation: none; transition: none` on decorative motion); the refined one repeats it with the `:root[data-ui="polish"]` prefix; a tiny helper returns `"auto"` for `scrollTo` under reduce. | [M m17] CDP `Emulation.setEmulatedMedia`, refined sheet injected [S]; all rules scanned [C] |
| G04 | P2 | polish | `polish/tv.css:88-89` (`.tv-rail ~ * { transition: opacity .25s }`, open: `opacity: .32`), `:81-87` | Opening the menu dims the page by fading the **three sibling blocks** (top bar, banner, 29 rows): main thread per rail open 160 ms classic vs 223 ms refined at 1x (176 without the dimming, 122 with everything off), 579 vs 723 ms at 4x with the longest frame gap 150 vs 250 ms. The refined look also costs +10% per focus press (158 to 175 ms; Style 5.5 to 9.3 ms from longer selectors). | The remote opens the rail constantly; it must feel instant. | Dim with one overlay (a `::after` of the rail or the `.tv-menu-backdrop` pattern, `background: rgba(11,11,12,.68)`, opacity only) instead of making every sibling translucent. | [M m15, m16] refined sheet injected [S], medians of 3 (1x) and 2 (4x); the 122 ms floor is the page-size toll of I03 |
| G05 | P2 | both | `tv.css:981-985` (`.tv-hero` `transition: height .3s`, deep = 8em, about / actions `display:none`, title 3em to 2.4em), `Browse.tsx:661,666-668` | First row to second collapses the banner and scrolls the rows at once: the banner box eases 224 to 102 px (720p) over about 300 ms while its content **jumps at frame 0** (text and buttons vanish, title 31 px from the first frame) and `rows.scrollTo({behavior:"smooth"})` moves row 2 up 341 px (720p) / 512 px (1080p) in about 250 ms. A layout animation over a 5k-node page; Up reverses it. | The most frequent vertical move shows two overlapping motions and a pop, and drags layout every frame. | Snap the banner to its short state (no height transition, fade the removed lines) and let the rows' scroll be the only motion. (opinion on the look; numbers measured) | [M m13, m14] per-frame trajectories at 1280x720 and 1920x1080 |
| I07 | P2 | both | `controller.css:513` (`.lib-round { backdrop-filter: blur(4px) }`, the only one in the code) | The phone library draws a blurred disc on **every** card (580 with the full catalogue): 527 compositing layers (464 `BackdropFilter`); a 380 px scroll step costs 164 ms of main thread, 83 ms with the blur removed (-49%). | Janky scrolling on mid-range phones for a 4 px blur on a small button. | A solid `rgba(0,0,0,.55)` fill. | [M m10, m11] trace of 8 wheel steps, with and without `fix-backdrop.css` |
| I08 | P2 | both | `polish/polish.test.ts:9-23`, `vite-config.test.ts` | The guard covers only the refined sheets and its list is short: it misses `inset` (`polish/phone.css:210,212,214` use it), logical shorthands (`polish/tv.css:365,398`, `phone.css:196-215`; 87 [T]), flex `gap` (8 declarations in `polish/tv.css`, 15 in `phone.css`), `aspect-ratio`, `backdrop-filter`, `content-visibility`, `scrollbar-width`, `overflow-wrap: anywhere`, `paint-order`, and any JS or build target. Its comment "The classic look does not use these either" is false: classic has `:is()` (`tv.css:590-591`), `:has()` (`1186`), `text-wrap` (`276,422,491,997`), `container-type` (`controller.css:303`), 34 `inset`. `vite-config.test.ts` pins plugins, outDir, proxy only. | The next rule that passes the guard can still black-screen a TV. | Add the patterns, fix the comment, pin `build.target`, snapshot the classic counts so they can only go down. | [C] tests read; [M] `css-scan` counts |
| I09 | P2 | both | `tv/Browse.tsx:329-340,661,676,759-765,1395` | React work per press is flat at 12-16 ms (1x) however much CSS removes: hiding 20 of 29 rows and 6 of 20 tiles with `display:none` (E14) leaves Script at 13.9 ms, and at 6x it is 161 ms of the 471 ms that remain (34%). `setFocused` (200 ms debounce, new object each time) re-renders `Browse`, and `Tile` is not memoised (its props are fresh closures from `tile()`), so all 583 tiles re-render (inferred from code + the flat script time). | After the CSS fixes React is the largest remaining cost on a weak TV. | Windowing (I03) removes it; otherwise `memo(Tile)` with stable props (pass `pos` and handlers by id). | [M m5b, m5c] Script column; [C] the inference |
| G06 | P3 | both | `tv.css:50,542,631,650,735,754,756,981,1209,1229`; `controller.css:183,196` | Layout properties are animated: `bottom` (captions .25s, up-next card .3s), `height` (banner, `.hud-bar-track`, `.seek-track`), `width` / `margin-right` (rail, `.seek-thumb`), **`font-size`** (`.tv-caption` .15s: text re-layout every frame) and the up-next bar (`width` with a 1 s linear transition re-armed every second: continuous layout through the whole countdown). | Small each, but they run during playback, when the CPU is busiest. | `transform: translateY()` / `scaleX()` or opacity; caption size changes snap. | [C] scan of every rule; not measured during playback |
| G07 | P3 | both | `tv.css:1189` shimmer, `1306` caret, `styles.css:42` spinner | Three infinite animations. The shimmer animates `background-position` (a repaint every frame, never on the compositor) for as long as the library loads, which on a sleeping free Render instance is tens of seconds (the "waking up" line appears after 10 s); it is not in the reduced-motion block. | Constant paint on a weak TV exactly while the server is slow. | Static skeleton under reduce; animate an opacity pulse instead of the gradient. | [C]; cost not measured |
| G08 | P3 | polish | all sheets; `polish/tv.css:53-55`, `phone.css:112` | No vocabulary yet: classic uses 21 durations (.08 .1 .12 .15 .18 .2 .22 .24 .25 .3 .35 .4 .45 .5 .7 .9 1 1.4 1.8 2 4.5 s) and 5 easing styles (`ease`, `ease-out`, `linear`, `steps(1)`, one cubic-bezier). The refined sheets define `--t-fast .12s`, `--t-base .18s`, `--ease` but still write literals (`.25s`, `.2s` at `tv.css:88,97`; `.08s`, `.15s` on the phone), and A+D's draft (`A-visual-system.md:148`: fast .12, base **.15**, slow .30, enter .45, intro .90) disagrees with the refined sheet's base .18. | Inconsistent feel; nothing to retune. | Adopt 2b. | [C] full scans (`motion-scan*.txt`) |
| G09 | P3 | both | `Tv.tsx:1363-1364` (Browse is mounted only while no film plays, no account page is open and nothing is resolving), `tv.css:1557,924` | Each return from a film or from an account page remounts the library, so all 29 rows replay `tv-rise` (.45 s) and the backdrop its 1 s fade, off-screen rows included. | A flash of re-entry on every Back from playback, plus the layer cost (G02). | Animate entry only on the first mount (a flag on the root) or only the visible rows. | [C]; not recorded |
| I10 | P3 | both | `dist/client/index.html`, `app.ts:183-200` | Boot is a waterfall with no preload for the role chunk: index (464 KB raw / 142 gz / 120 br), then after it runs RoleSwitch (108 / 36), Tv (153 / 42) and Tv.css (67 / 13): about 240 KB gz before the TV home (2e). `index.html` preloads only the runtime chunk and the stylesheet. The local server does not compress; **live does** (Cloudflare edge: `content-encoding: br`, immutable caching). Localhost FCP 0.46 / 0.60 / 0.92 s at 1 / 4 / 6x; populated home 1.8 s at 6x. | Each extra round trip is real latency on a TV's Wi-Fi (not in these numbers). | `modulepreload` the Tv chunk on `/tv` only. | [M m6]; sizes [M `sizes.mjs`]; live headers [M curl on `kino-dvub.onrender.com`] |
| I11 | P3 | both | `Browse.tsx:1424,1456`, `Poster.tsx:17` (`loading="lazy" decoding="async"`) | With 582 lazy images the IntersectionObserver bookkeeping costs 16-21 ms of each press, and `loading=lazy` is ignored before Chromium 77 [R], where all about 580 pictures request at once. `decoding=async` is right, and the missing `width` / `height` are fine (art slots have fixed ratios; CLS 0). | Another page-size cost; windowing (I03) removes it. | Windowing; drop `lazy` on the first screenful. | [M m5] IO column; 77 [R] |

### 2a. Motion inventory (every rule, both looks)

Cost: C = compositor-safe (transform / opacity), P = paint (colour, shadow, background, stroke), L = layout. RM = covered by `prefers-reduced-motion` today.

| Group | Where | What | Duration, easing | Trigger | Cost | RM |
|---|---|---|---|---|---|---|
| Tile lift | `tv.css:1109,1121,681-682,1605`; refined `polish/tv.css:183,186,401,449` | transform + color; art box-shadow | .18s ease (refined: `--t-base` `--ease`) | focus, hover | C + P | transform yes (2012); shadow no; refined re-enables |
| Buttons, keys, chips | `tv.css:77,160,444,795,961,1024,1157,1322,1348,1401,1445,1490,1496,1516,1639,1693`, `friends.css:33`; refined `polish/tv.css:66,164,255,346-352,463` (adds box-shadow) | transform, background, color | .12-.15s ease (refined .18s) | focus, hover, press | C + P | partly (2012: action, hero-button, choice, swatch, switch-row) |
| Entry | `tv.css:924,1009,1039,1051,1557` | opacity + transform; `tv-arrive` animates `pointer-events` | .4-.45s ease `both`; backdrop 1s; arrive .5s linear | mount | C (pins a layer, G02) | yes (2007-2008) |
| Welcome | `tv.css:200-219` | opacity + transform | .9s cubic-bezier(.2,.8,.2,1), delays .3 / .7s; fade .7s | load | C | yes (2009) |
| Overlays, HUD, toasts | `tv.css:294,324-328,395,405,418,500,520-523,641,671,699,1545` | opacity, transform, visibility | .2-.4s ease; toasts .9 / 1.8 / 4.5s | show, hide | C | yes except `.tv-fail` (500), `.tv-fs-prompt` (294) |
| Layout-animating | `tv.css:50,542,631,650,735,754,756,981,1209,1229` | bottom, height, width, margin, font-size | .12-.3s; bar 1s linear | focus, state | L | banner only (2011) |
| Infinite | `tv.css:1189,1306`, `styles.css:42` | shimmer (background-position), caret blink, spinner | 1.4s linear, 1s steps(1), .9s linear | loop | P, P, C | spinner slowed (`styles.css:69`); others no |
| Smooth scroll (JS) | `Browse.tsx:199,200,210,211,666-668,773` | `scrollBy` / `scrollTo` smooth | browser's, about 250 ms | every focus move | main-thread scroll (only 1 composited scroller in 38 layers [M m4]; opinion: the `mask-image` rows are not composited) | no |
| Phone press, rows | `controller.css:34,175,222,286,482,496,513,525,549-580`, `friends.css:20` | transform, background, color, box-shadow | .08-.18s ease | press, focus | C + P | **no block** |
| Phone sheets, toasts | `controller.css:259,271,429` | fade-in, sheet-up, toast | .18s, .24s, 2s | open | C | no |
| Phone seek | `controller.css:183,196` | height, width | .1s | drag | L | no |
| Account pages | `account.css:22-176,189` | border, shadow, transform, page-in, toast | .12-.22s; toast 4.5s | focus, navigate | P + C | yes for page, toast, picture, avatar, switch, swatch (198-199) |
| Refined phone | `polish/phone.css:112,236` | `.btn` transform .08s + background .15s; toast 3.5s | `--p-ease` | press | C + P | no |

Keyframes (18, all classic): `spin` (`styles.css:44`), `tv-welcome-in` (`tv.css:219`), `tv-pop` (297), `hud-card-in` (425), `hud-toast` (527), `hud-rise` (645), `tv-fade` (701), `tv-fade-in` (927), `tv-rise` (1010), `tv-arrive` (1050), `tv-shimmer` (1191), `tv-blink` (1307), `tv-toast-life` (1548), `fade-in` (`controller.css:362`), `sheet-up` (363), `toast` (431), `page-in` (`account.css:90`), `account-toast` (190). Sixteen animate only `opacity` / `transform`; the exceptions are `tv-arrive` (`pointer-events`) and `tv-shimmer` (`background-position`, G07).

The refined sheets add **no keyframes and no reduced-motion block**; their 14 transition rules reuse the classic properties, add `box-shadow` to every button class (`polish/tv.css:255`) and add the rail dimming (G04).

### 2b. Recommended motion vocabulary (small, old-Chromium safe)

Only custom properties, `transition`, `transform`, `opacity` and `cubic-bezier()` (all Chromium 49+ [R]). Same shape as A+D's draft (`A-visual-system.md:148`); the one difference is `--dur-base` .18s (the tile lift's current value and the refined sheet's `--t-base`) instead of .15s: pick one, the cost does not depend on it (G01).

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | .12s | press and hover feedback on small controls |
| `--dur-base` | .18s | tile and button focus (`transform` only) |
| `--dur-slow` | .30s | panels, overlays, HUD, banner |
| `--dur-enter` | .45s | rows, title page, welcome parts; `backwards` fill only |
| `--dur-intro` | .90s | the welcome screen only |
| `--ease` | `cubic-bezier(.2,.8,.2,1)` | everything that moves into place; `linear` only for progress and shimmer |

Rules: (1) on TV, `transform` and `opacity` only for anything the remote can re-trigger; focus ring and colour change **instantly**; (2) at most two transitioning properties per element; (3) never `both` / `forwards` fills (G02); (4) no `bottom` / `height` / `width` / `font-size` transitions (G06); (5) entry motion on first mount only (G09); (6) **one reduced-motion block per sheet**, in the refined sheets with the `:root[data-ui="polish"]` prefix so it out-ranks the rules it silences, setting `animation: none`, `transition: none`, and a helper that turns JS `behavior: "smooth"` into `"auto"`; (7) infinite animations only while something is truly loading and `none` under reduce; (8) anything longer than .45s is not feedback.

### 2c. Compatibility table (what an old TV Chromium drops)

Floor today: **JS parse 85 [T], CSS about 88 [T]/[R], no `@supports`, no fallbacks.** "Below" = on Chromium older than the version.

| Feature | Chromium | Src | Where (uses) | Fallback | Below that version |
|---|---|---|---|---|---|
| `inset` | 87 | T | `tv.css:9,24,116,189,320,376,379,402,471,495,661,683,694,826,909,919,930,1036,1042,1123,1582,1607,1608`, `controller.css:252,357,369-371,497,514,530,542`, `account.css:66,89`; refined `polish/phone.css:210,212,214` (34 + 3) | none | black screen [S] |
| `aspect-ratio` | 88 | R | `tv.css:682,822,1117,1562`, `controller.css:305,356,374,492,496,529,541`, `account.css:76,132` (13) | none | art slots collapse [S] |
| `:focus-visible` | 86 | R | 72 uses (`tv.css` 46, `controller.css` 15, `account.css` 7); lists dropped whole: `tv.css:1390,1393`, `account.css:157` | none | no focus ring on the D-pad |
| `:is()` | 88 | T | `tv.css:590-591` | none | HUD icon labels vanish |
| `:has()` | 105 | R | `tv.css:1186` | none | one pressed-state rule lost |
| flex `gap` | 84 | R | 189 flex declarations (15 grid are fine) | none | spacing collapses |
| `min()` / `max()` / `clamp()` | 79 | R | 44, incl. `--em` at `tv.css:13` | none | `--em` invalid so 16px; widths dropped |
| logical shorthands | 87 | T | `tv.css:587,780,1474,1794,1869`, `controller.css:104,175,236`; refined `tv.css:365,398`, `phone.css:196-215` | none | padding dropped |
| `text-underline-offset` | 87 | T | `styles.css:91`, `account.css:48` | n/a | cosmetic |
| `overflow-wrap: anywhere` | 80 | R | 11 | n/a | long words may overflow |
| `text-wrap` | 114 | R | `tv.css:276,422,491,997` | n/a | ignored, harmless |
| `scrollbar-width` / `-color` | 121 | R | 10 | `::-webkit-scrollbar` twin | fine |
| `mask-image` | 120 | T | `tv.css:1097,1846` | `-webkit-` twin on the line above | fine |
| `paint-order` on HTML text | 123 | R | `tv.css:1573` | none | rank outline paints over the fill: cosmetic |
| `container-type` / `cqh` | 105 | R | `controller.css:303`, `captionCss.ts` | none | phone caption preview only |
| `backdrop-filter` | 76 | R | `controller.css:513` | none | phone only (I07) |
| `env()`, `prefers-reduced-motion` | 69, 74 | R | 9, 3 blocks | n/a | harmless |
| JS syntax `??=` | 85 | T | `i18n/index.ts:78`, `controller/Scanner.tsx:88` | none | SyntaxError: blank (I01) |
| `Object.hasOwn` | 93 | R | `shared/search.ts:33` | none | blank on first search letter (I05) |
| `Element.replaceChildren` | 86 | R | `tv/Captions.tsx:12` | none | blank at first subtitle (I05) |
| `matches(":focus-visible")` | 86 | R | `tv/Browse.tsx:772` | none | title page stops following focus |
| `Intl.RelativeTimeFormat` | 71 | R | `account/time.ts:19-23` (the `catch` fallback builds it again) | half | only if the floor drops below 85 |
| `Intl.DisplayNames`, `wakeLock`, `fetch keepalive` | 81, 84, 81 | R | `lang.ts:23`, `AccountPages.tsx:55`, `useWakeLock.ts:16`, `socket.ts:44` | try / catch or ignorable option | harmless |
| flat, `toggleAttribute`, `queueMicrotask`, `fromEntries`, `matchAll`, `\p{..}` | 64-73 | R | 11, `fit.ts:32`, `backButton.ts:71`, 2, 1, 9 | none | fine at 85 |

False positives of my scan: Zod `.union(...)` (`shared/account.ts:118,265`, `tv/prefs.ts:15`) is not `Set.prototype.union`.

### 2d. What the refined sheets must respect

Today they add no dependency beyond the classic ones except logical shorthands, `inset` on the phone, and the `:not(:focus-visible)` forms (86, as classic). To stay inside the brief's floor they must: write `top` / `right` / `bottom` / `left` (never `inset`); never write `aspect-ratio` without keeping the classic ratio box; not add flex `gap` where the classic rule has none; avoid logical properties, `content-visibility` and `backdrop-filter` (none of the three is guarded yet, I08) as well as `text-wrap`, `:is` / `:has` / `:where`, `color-mix`, `@layer` and `dvh` (guarded); animate only `transform` / `opacity`; and carry their own reduced-motion block with the polish prefix (G03).

### 2e. What loads per role (raw / gzip / brotli KB) [M `sizes.mjs`]

| Role | Chunks | Raw | Gzip | Brotli |
|---|---|---|---|---|
| TV `/tv` | index 464.0 / 142.3 / 119.5, RoleSwitch 108.1 / 35.8 / 30.9, Tv 152.8 / 41.5 / 35.7, Tv.css 66.9 / 13.2 / 11.6, index.css 14.8 / 3.9 / 3.4, runtime 0.6 | 807 | 237 | 201 |
| Phone `/` | index, RoleSwitch, Controller 114.3 / 29.6 / 25.7, Controller.css 29.1 / 5.9 / 5.3, index.css, runtime | 731 | 218 | 185 |
| On demand | hls.js 560.9 / 172.7 / 141.6 (first HLS play only; mp4 never), jsQR 126.9 / 45.3 / 25.6 (scanner opens) | | | |

## 3. Patterns

1. **No declared browser floor** (brief 68-76; `base.css` lists features that mean about 86; test UAs 94-120; build chrome111; real about 88): I01, I02, I05, I08.
2. **Cost scales with the size of the page, not of the change**: every state change on the 5k-node home pays Layerize / Commit / IntersectionObserver for all 583 tiles (focus move, rail open; the banner's height animation is layout over the same page, not timed): I03, I09, I11, G01, G02, G04, G05.
3. **Animation properties chosen for looks, not cost** (box-shadow, colour, height, bottom, width, font-size, `both` fills, the sibling dimming): G01, G02, G04, G05, G06, G07, G09.
4. **Reduced motion and the vocabulary are per-rule afterthoughts**, and the refined look re-enables what classic silenced: G03, G08.
5. **Full-size pictures and effects for small slots** (w1280 in 192 px tiles, a blur on 580 buttons): I06, I07.
6. **Failure is silent and total** (null Suspense fallback, no boundary, unguarded newer APIs): I04, I05, I01.
7. **Guards watch the new sheets only**; the classic ones, JS and the build are unguarded: I08.

## 4. Quick wins (each under an hour)

1. G02: `animation-fill-mode: backwards` on four rules (`tv.css:924,1009,1051,1557`): 42 to 8 layers, about -10% per press.
2. G01: tile focus keeps only the `transform` transition (classic `tv.css:1109,1121`, refined `polish/tv.css:183,186`): about -27% per press.
3. I07: replace `backdrop-filter` on `.lib-round` with a solid fill (`controller.css:513`): scroll step -49%.
4. G04: dim behind the open rail with one overlay instead of `.tv-rail ~ *`: -47 ms (1x) / -116 ms (4x) per open.
5. I04: an error boundary and a Retry in `main.tsx` (plain markup).
6. I05: three one-liners (`hasOwnProperty.call`, `textContent` + `append`, `try` around `matches`).
7. I08: add `inset`, logical shorthands, `aspect-ratio`, `backdrop-filter`, `content-visibility`, `gap` to `TOO_NEW`, fix the false comment, pin `build.target`.
8. G03: one reduced-motion block in `controller.css` and one per refined sheet (with the polish prefix), plus the smooth-scroll helper.
9. I06: tile art and phone cards ask for `/w300/` (or `/w500/`), the banner keeps `/w1280/`.
10. I01: once Q1 is answered, one line `build: { target: ... }` and its test (remember `dist` rides with the change).

## 5. Keep

- **CLS 0.0000** on the TV home and the phone library with every picture held back 1.2 s [M m9]: art slots have fixed boxes.
- **Browse unmounted during playback**: 74 elements, no animations, main thread 0.3-0.9% at 1x [M m7].
- **Code split by role and by need**: the phone never gets Tv, the TV never gets Controller; hls.js loads on the first HLS play only; jsQR only when the scanner opens [M m6].
- **No web fonts**: system stack (`styles.css:19`), no FOIT, no font requests.
- **`BANNER_DELAY_MS` = 200 ms** (`Browse.tsx:91`) and the `Backdrop` that preloads and decodes before cross-fading (`1334-1368`): the banner does not flash while the remote runs along a row.
- **The look of the focus**: ring plus lift (A+D keep it). Keep the look, change how it is animated (G01).
- **Immutable asset caching**, and the live edge serves brotli [M curl].
- **`-webkit-mask-image` and `::-webkit-scrollbar` twins** next to the new properties (`tv.css:1096-1100`).
- **The `?debug` ability probe** (`shared/debug.ts:94-113`: focus-visible, is(), inset, aspect-ratio, max(), flex-gap): the right tool for old TVs; extend it with `Object.hasOwn`, `replaceChildren`, `content-visibility`.
- **The existing reduced-motion blocks** (`tv.css:2006-2014`, `account.css:197`, `styles.css:69`) are the right shape; they only need completing.
- **The keyframes themselves**: sixteen of the 18 animate only `opacity` / `transform` (2a), so the motion language is compositor-friendly; the trouble is in the transitions around focus and in the fills (G01, G02).

## 6. Open questions for the owner

1. **What is the real browser floor?** Chromium 68 (webOS 5, Tizen 5.5), 76-79, 85-87, or 94+? It decides everything in I01 / I02: lower the build target and add per-rule fallbacks, or declare 88 and show a plain "this TV's browser is too old" page below it (support vs. refuse politely).
2. **Focus feel on TV:** keep the tile lift (transform only, about -27% instead of -37%) or snap the ring instantly? (taste; the cost is measured in G01)
3. **Depth of the home:** window the full 29 rows (nothing changes for the viewer) or cap the home at about 10 rows x 14 tiles with "More" (content change)?
4. **Tile picture size:** is w300 soft enough on a 4K TV to want w500? (taste)
5. **Menu rail:** keep the refined look's dimming of the page (measured cost: +47 ms per open at 1x, +116 ms at 4x, unless done with one overlay), or only the panel's shadow as in classic? (taste)

## 7. Seen on the way

- For A+D (`A-visual-system.md:185`): confirmed, the build lowers none of `inset` / `aspect-ratio` / `:is` / `:has` / `text-wrap`, and there is no `@supports` anywhere. One correction: Vite 8.3.4's default target is not "Chrome 87+" but chrome111 / safari16.4 (`node.js:720-726`), and `cssTarget` follows it, so CSS is only minified, never prefixed or lowered for old engines. Their `inset` count (23 in `tv.css`) matches mine (34 over all sheets). Line 189 (shimmer missing from reduced motion): confirmed [M m17]. Their `--dur-base .15s` vs the refined sheet's `.18s`: see G08.
- For everyone: the walk's 44-title catalogue hides every full-catalogue cost (7-10 ms vs 134-176 ms per press), and the 460 e2e tests will not notice them.
- For E: a held key at 6x leaves 317 ms frame gaps and key-to-frame 114 ms; coalescing key repeats while a move is pending would help more than any CSS. `arrived()` starts two smooth scrolls per press, one sideways and one vertical (`Browse.tsx:666-668`).
- For E / U1: `tv-arrive` animates `pointer-events: none` for .5 s on the title page (`tv.css:1050`); it relies on `pointer-events` animating as a discrete property (not tested here), and a first click in that half second goes to the library.
- For F: the phone library renders 580 buttons at once with no windowing either (`controller/Library.tsx`).
- For H: JS smooth scrolls ignore reduced motion (G03); the refined look's `:root[data-ui] ...` rules out-rank the classic reduced-motion block, so any a11y fix of that kind must carry the prefix.
- `dist/client` (19:35) predates the refined TV sheet (`7e183fb`, 20:27): anyone checking the refined look in a real build must build first; I did not (rule 2).
- For whoever owns the server: `server/library/filmpire.ts:5` carries a literal TMDB API key as the default of `process.env.TMDB_API_KEY`, and the repo is public (per the project notes); if it is the owner's own key it belongs in the environment only. I did not copy it here.
