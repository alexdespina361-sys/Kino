# 00 · Integration map

Branch `feat/kino-cat` (off main `5cf4704`, PR #27 merged). Nothing is deployed. The cat is **off for everybody** until the host sets `CAT_COMPANION=on` **and** a screen's owner turns it on in Settings.

## How a screen gets a cat (four independent gates, all must be open)

| Gate | Where | Default | Kill switch |
|---|---|---|---|
| Host offers it | server env `CAT_COMPANION=on` → `GET /api/features` `{cat:true}` (also in `/api/health` `features.cat`) | off | unset the variable (next load of every screen) |
| Role | `bootCat(role)` runs only for the screen that plays (`role === "tv"`: TV, or a computer's browser) | the phone remote never has a cat | – |
| Device opt-in | Settings → "Cat companion" (`kino.cat` in localStorage: on / quiet / films / coat / size) | off | the switch itself, or the corner button |
| URL override (testing) | `?cat=on\|off\|debug`, `?catseed=N`, `?catbudget=ms`, `?catslow`, `?catart=classic\|solid`, `?catcoat=`, `?catsize=` | – | `?cat=off` |

Nothing of the cat is downloaded before all gates are open: `main.tsx` imports only `cat/boot.ts` (38 lines) and the settings module; the rest is a lazy chunk (`import("./host")`).

## Files outside the cat's own folders (17, +1078 / −2, of which the tests are +844)

| File | Change | Why |
|---|---|---|
| `src/client/main.tsx` | +3 | `bootCat(role)` after the diagnostics install |
| `src/client/role.ts` | +3 | exports `isTvAgent()` (the TV user-agent test the role code already had) so the cat can default to *quiet* on a real TV |
| `src/client/tv/Browse.tsx` | +6 −2 | the cat's corner button (`CatChip`) in the library's top bar, counted in the remote's top-row columns |
| `src/client/tv/Account.tsx` | +46 | Settings: switch, quiet, films, coat (4), size (3) as radiogroups |
| `src/client/polish/tv.css` | +3 | `.tv-segmented-grid` (two-by-two choice rows so a longer name is not cut in Romanian/Italian) |
| `src/client/i18n/{cat.en,cat.ro,cat.it}.ts`, `en/ro/it.ts` | +165 | all text in three languages (kept in files of their own, spread in) |
| `src/client/i18n/cat.test.ts` | +64 | every key in all three languages; plural forms; no stray English |
| `src/server/app.ts` | +7 | `CAT_COMPANION` → `/api/features`, `/api/health.features` (no-store) |
| `src/server/features.test.ts` | +47 | off by default, on by env, kill switch |
| `e2e/cat.spec.ts`, `e2e/pngjs.d.ts` | +733 | 26 browser tests (see 05) |
| `.gitignore` | +1 | `.kino-cat/` (local pictures, never committed) |

`dist/client` is tracked in this repo, so the branch ends with one separate commit that rebuilds it.

## What the cat reads from the page (read-only; nothing is written to the page except its own canvas and a `data-cat-pointed` attribute while it points)

| Kino element | Used as |
|---|---|
| `.tv-row` / `.tv-row-tiles` / `.tv-tile[data-entry]` | shelf tops the cat walks on (`computeLedges`), posters it looks at, points to and stalks; the card's own id is the catalogue id |
| `.tv-grid` (search, lists) | the same, for a grid page |
| `.tv-hero*`, `.tv-rail`, `.tv-browse-top`, `.tv-query`, `.tv-keys`, `.tv-filters`, `.tv-notice`, `.tv-rows-note`, `.tv-row-more`, `.tv-view-foot` | keep-out rectangles (words and buttons) |
| `.tv-row-title`, `.tv-view-title/meta/hint/empty`, `.tv-results-closest`, `.tv-hero-eyebrow` | keep-out rectangles sized to the text, not to the row |
| the element that has focus (`:focus` on a tile, hero button, action, choice, key, corner button, chip) | keep-out + "where the viewer looks": the cat never stands on the remote's focus |
| `[role=dialog]`, `[aria-modal]`, `.tv-menu-backdrop`, `.tv-detail`, `.tv-screen`, `.tv-welcome` | the cat is **away** while any is open |
| `main.tv[data-state]` + `video.tv-video` + `.tv-end` / `.tv-fail` | player mode (none / loading / playing / paused / ended / error) |
| `.hud-top`, `.hud-bottom`, `.hud-upnext`, `.hud-boost`, `.tv-caption`, `.tv-note`, `.hud-toast`, `.tv-toast` | **not read**: in a film the cat's layer is put straight after the `<video>` at `z-index: 0`, so every control, subtitle line and toast is drawn over it, and nothing in the player is a place to keep out of (the first version kept out of them and was chased off by every caption: ISSUE_LOG #22, #23). Only whether the controls are up is read (`main.tv[data-hud]`) |

Where the canvas lives: inside `.tv-browse` while browsing (so menus, toasts and the HUD paint above it), and straight after the `<video>` in a film (so every control and subtitle is drawn over it). `pointer-events: none` except a small hit box on the cat; it never takes the remote's focus and never changes the `tabindex` of anything on Kino's pages (its own panel is `tabIndex=-1` and is focused only when the viewer opens it from the corner button or by touching the cat).

## Not touched

Streaming, the proxy, HLS, search, pairing, parties, accounts, friends/chat, the phone remote, the feedback system, `/api/proxy`. The cat adds one server route (`/api/features`) and no database state.

## Bundle cost (measured on the build in `dist/client`)

| Piece | Raw | gzip | brotli | Loaded when |
|---|---|---|---|---|
| everything the app loads anyway, against main (boot + settings + chip + i18n in `index-*.js`, the corner button and Settings rows in `Tv-*.js`, a 14 KB `dpad` chunk and a 0.5 KB `bus` chunk that the cat's lazy chunk and the TV page now share, and the chunk reshuffle that follows) | + 12.3 KB | **+ 4.7 KB** | – | always (a few lines run) |
| of which `index-*.js` alone (237.2 → 240.6 KB raw) | + 3.4 KB | + 1.1 KB | + 0.9 KB | always |
| lazy chunk `host-*.js` (engine + rig + classic canvas cat + GL renderer + shader + panel) | 120.6 KB | 44.2 KB | 39.1 KB | only when all gates are open |
| `host-*.css` (the layer, the panel) | 4.4 KB | 1.5 KB | 1.3 KB | with the lazy chunk |
| `cat-*.mesh` (the solid cat's model, offline-built, skinned on the GPU; 11,966 vertices) | 343.5 KB | 218.3 KB | 183.1 KB | only when the solid cat is used (WebGL available), once |

Measured on the build in `dist/client` against `origin/main`'s (a throw-away script: gzip level 9, brotli quality 11). The entry stylesheet is byte for byte main's. The `dpad` and `bus` chunks are the reviewer's finding 13 (ISSUE_LOG #38): they exist because both the TV page and the cat's lazy chunk import them. Plan budget "< 150 KB before art": code 44.2 KB gzip, **met**; the model is the art. (KB here is 1,000 bytes; the figures are of the build of the branch's head, redone after the last source change.)
