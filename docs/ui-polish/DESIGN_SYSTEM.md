# Design system, as built

This is what the site's one look is made of, written from the code (not from a wish). There is **one** look: `<html data-ui="polish">` is set in `index.html` and nothing changes it (D18). The older sheets (`styles.css`, `tv/tv.css`, `controller/*.css`, `account/account.css`, `friends.css`) are the base layer underneath, and the refined layer is `src/client/polish/{base,tv,phone}.css`, every rule of it under `:root[data-ui="polish"]`. A rule in the layer that has to win over an older one raises its own specificity; a tie is decided by order, and the layer loads last.

No second token system was added: the tokens are CSS custom properties in the files that use them (TV: top of `polish/tv.css`; phone: top of `polish/phone.css`; accents and the base surfaces: `styles.css`), and the accent list also exists once as data in `account/theme.ts` (the picker's dots), which `theme.test.ts` keeps in step with the CSS.

*The principles these numbers answer to are in [REFERENCE_PRINCIPLES.md](REFERENCE_PRINCIPLES.md); why each call was made is in [DECISIONS.md](DECISIONS.md); where each is used is in [COMPONENT_INVENTORY.md](COMPONENT_INVENTORY.md).*

## Rules that never bend

1. **Old TV browsers are the floor** (VIDAA, Tizen, webOS: Chromium 68 to 76). Not used anywhere in `polish/`: `@layer`, `@container`, `@property`, `color-mix()`, `oklch/lab/lch`, `light-dark()`, `dvh/svh/lvh`, `subgrid`, `:has()`, `:where()`, `:is()`, `text-wrap`, `container-type`; and also avoided: `padding-inline`, `aspect-ratio`. Keyframes are named `polish-…` (they are global). `polish/polish.test.ts` fails the build on any of these.
2. **Colour is never the only sign.** What is chosen has the accent as a tint *and* a ring; what the remote is on is lit *and* ringed; a switch's state is its knob's side as well as its fill.
3. **The accent is for what is chosen, what is primary, and where the remote is.** Leaving a page is never the accent's colour (D20). Taking something away is red words on a plain surface, not a red fill (a red fill is for what is chosen).
4. **A surface is higher by being lighter.** Shadows are for what floats (a menu, a sheet, the lift of a focused poster), never for a card on a page.
5. **One of each**: one curve, one focus language per device, one corner per kind of thing, six type sizes on the phone and seven on the TV.
6. **Nothing moves for someone who asked for less** (`prefers-reduced-motion`: transitions and, on the phone, animations drop to nothing).

## Colour

### The page and its surfaces

| Token | Value | Where | Words on it (contrast) |
|---|---|---|---|
| `--bg` | `#0b0b0c` | the page; the gap inside a focus ring | `--text-1` 18.1 : 1 |
| `--surf-1` (TV) | `#18181b` | a card, a menu, a panel | `--text-2` 10.8, `--text-3` 6.4 |
| `--surf-2` (TV) | `#232327` | a control on a card | `--text-3` 5.7 |
| `--surf-3` (TV) | `#313136` | a pressed or hovered row | |
| `--surf-4` (TV) | `#3f3f46` | a wide row the remote is on: lighter than any row beside it, still dark enough for its own small words | |
| `--fill-1/2/3` (TV) | white at 8 / 14 / 22 % | what lies over a picture or the film: quiet, hovered, pressed | |
| `--fill-track` (TV) | white at 28 % | the groove of anything that fills up or turns on | |
| `--surface` (phone) | `#17171a` | a card | |
| `--surface-2` (phone) | `#232328` | a control on a card | |
| `--surface-3` (phone) | `#2e2e34` | pressed; where the finger is | |
| `--overlay` (phone) | `#1c1c20` | a sheet; on a sheet the three surfaces above are one step lighter (`#25252a`, `#2e2e34`, `#3a3a42`) | |
| `--p-line` (phone) | white at 10 % | the hairline between the rows of one card | |

Surfaces on a page are **solid**, so that the page's glow does not tint some rows and not others; white at an alpha is only for what lies over a picture.

### Words

`--text-1` `#f5f5f7` (what is read), `--text-2` `#c9c9d1` (secondary), `--text-3` `#9b9ba3` (muted: a year, a count, a hint). `--p-label` `#d2d2d9` is the heading of a phone group: lighter than the words it heads, never louder than a heading of the page. Status: `--ok` `#46d369` (9.1 : 1 on a card), `--bad` `#ff6b6b` (6.4 : 1).

### Accents (a profile's own choice)

| Accent | Fill | Hover | Words on the fill | Ratio | Fill on the page | Notes |
|---|---|---|---|---|---|---|
| red (default) | `#e50914` | `#f6121d` | white | 4.8 | 4.1 | the brand |
| blue | `#2772e5` | `#3d85f0` | white | 4.5 | 4.3 | was `#2b7fff` (3.8 : 1), D29 |
| purple | `#8e54ea` | `#a06cf2` | white | 4.6 | 4.3 | was `#9b5cff` (3.9 : 1), D29 |
| green | `#1fb86a` | `#34d17f` | `#111` | 7.3 | 7.6 | |
| orange | `#ff8a1f` | `#ffa047` | `#111` | 8.0 | 8.3 | |
| pink | `#ff4f9a` | `#ff72b0` | `#111` | 6.2 | 6.4 | |

`--accent`, `--accent-hover`, `--accent-rgb` (for `rgb(var(--accent-rgb) / .2)` tints), `--accent-ink` and `--brand-gradient` are set per `data-accent` on `<html>`. `account/theme.test.ts` fails an accent whose words fall under 4.5 : 1, and one whose dot in the picker differs from the CSS. **Chosen** is `rgb(var(--accent-rgb) / 0.2)` with a 1.5 px ring of `--accent` (a TV row the remote is on is light with dark words, and keeps the accent ring inside it, so that "chosen and focused" is never mistaken for "chosen").

## Type

System UI stack (`system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`): a streaming screen gets its voice from weight and size, and loading a face would hold the first paint on a slow set. Weights in use: 400 (hints), 600 (rows, buttons, labels), 700 (headings), 800 (codes and the wordmark). Tracking is 0 except the title scale (−0.01 to −0.015 em) and the wordmark. Group headings are sentence case, not capitals (a capital label wraps into an orphan the moment it has a count in it).

**TV: seven sizes**, multiples of `--em` (1 % of the screen's width, `--em: max(min(1vw, 1.7778vh), 9px)`: a 16:9 box inside any window, so 1080p and 4K are the same picture; the smallest token is 1.3 % of the width, 25 px at 1080p, and a guard test keeps every visible word at or above 1.15 %).

| Token | × `--em` | At 1280 | At 1920 | For |
|---|---|---|---|---|
| `--fs-1` | 1.3 | 16.6 | 25.0 | a caption: a year, a count, the name under a poster |
| `--fs-2` | 1.5 | 19.2 | 28.8 | small text; a button in a crowded place |
| `--fs-3` | 1.7 | 21.8 | 32.6 | body: buttons, the menu, a row's title |
| `--fs-4` | 2.0 | 25.6 | 38.4 | a lead; a heading in a panel |
| `--fs-5` | 2.6 | 33.3 | 49.9 | a heading |
| `--fs-6` | 3.2 | 41.0 | 61.4 | a title |
| `--fs-7` | 4.2 | 53.8 | 80.6 | a title that is the whole page |

**Phone: six sizes** (handheld, not the TV's floor): `--p-fs-1` 13 (a count, a note under a field), `--p-fs-2` 14 (a chip, a line in a row), `--p-fs-3` 16 (body, and what stops a phone zooming into a field), `--p-fs-4` 18 (a heading of a sheet, a page or a row of pictures), `--p-fs-5` 24 (a title), `--p-fs-6` 32 (a code).

Truncation: a category's name is clipped to two lines (line-height 1.25 so that a bold g or y keeps its tail); a long word wraps rather than overflows (`overflow-wrap: anywhere`); a code never wraps (`white-space: nowrap`) and is selectable (`user-select: all`, `.copy-code-text`).

## Space

**TV** (all × `--em`): `--gutter` 7 (where the words start), `--edge` 2.6 (the least a thing is from the left edge), `--edge-r` 5 (the least a button is from the right edge: 5 %, inside what a set with overscan shows), `--page-r` 4 (the end of a row to the right edge), `--top` 2.9 (the top edge to the first line of the top bar and to a page's Back/Close), `--tile-gap` 1.3. Menu: `--rail-w` 7.2 shut, `--rail-w-open` 27.8 (the longest label, "Connect a phone", in all three languages, with room to spare).

**Phone**: a 16 px gutter (plus the safe area), 16 px between cards of one page, **28 px between the groups of Settings** (so the heading of the next is not taken for a line of the one before), 12 px inside a card's padding, rows at least 52 px (44 sideways), buttons 48 (44 where it is a small one beside a code, a tag or a friend's line), icon buttons 44. A target is at least 44 px (the drift scanner lists the few that are not, mostly inline text links).

## Corner

| | Token | Size | For |
|---|---|---|---|
| TV | `--r-1` | 0.45 em | keys, chips |
| | `--r-2` | 0.7 em | buttons, pictures, rows |
| | `--r-3` | 1.1 em | panels, the menu, a card |
| | (pill / circle) | 999px / 50 % | the Back pill, the corner buttons, switches, dots |
| Phone | `--p-r-1` | 8 px | a picture of an episode, a mini button |
| | `--p-r-2` | 12 px | controls, rows, cards, pictures |
| | `--p-r-3` | 22 px | what comes up from the edge: a sheet, a toast, a profile's card |

## Elevation

A card is told from the page by its tone, and from the next card by the space between them. Shadows float things: `--lift` (`0 .7em 1.8em rgba(0,0,0,.6)`) under a focused poster; the open menu throws a shadow onto what it covers (and what it covers dims to 32 %); a sheet has `0 -12px 40px rgba(0,0,0,.5)`.

## Focus, hover, pressed, chosen, disabled

| State | TV (remote and pointer) | Phone (finger, keyboard) |
|---|---|---|
| **Focus** (the remote or a key is on it) | A ring of `--ring` (0.2 em) in white with a gap of the page's own colour inside it (`--focus-ring`: reads on a bright poster and on black alike), a lift, and a scale of 1.05 to 1.06; a button goes white with dark words. A tile's ring is its picture's, not the tile's box. | `inset 0 0 0 2px #fff` on a row, on the surface one step lighter |
| **Hover** (a pointer) | `--fill-2`, and the words go to `--text-1`; a row of tiles shows its arrows | none (a finger has no hover) |
| **Pressed** (a mouse button down, a finger) | a scale of 0.96 on every control (`tv.css`, one rule for the family) | a row goes to `--surface-3`; a button scales to 0.97 |
| **Chosen** | the accent tint and ring (above); the rail's current page is a short accent bar at its edge | the same |
| **Disabled / not yet** | a button that cannot be pressed (Save before there is a name) is the grey surface with muted words, as on the phone; one that is only at its end (a list that cannot move earlier) stays, at 55 % opacity, so the remote does not lose its place (D33) | grey surface with muted words, not the accent at half strength (that is what a failure looks like) |
| **Focus while chosen** | light with dark words *and* the accent ring inside | |

Every `[data-nav]` control has a focus rule from this set; `scripts/ui-walk/tv-keys.mjs` walks 25 screens by key and fails any where nothing shows the focus (`TV_TESTS.md`).

## Motion

One curve: `--ease` (TV) = `--p-ease` (phone) = `cubic-bezier(.2, .8, .2, 1)` (starts quick, lands softly). Durations: `--t-fast` 0.12 s (a press), `--t-base` 0.18 s (focus, hover, colour), 0.25 s (the open menu dimming what it covers), 0.4 s (a row, the banner's and a title page's words arrive; a picture that arrives late fades in). Only `transform` and `opacity` move, nothing that re-lays-out the page, and no blur or filter on a large area (an old TV is slow). The player's controls and the banner's backdrop crossfade as before. A phone's sheet comes up and a page comes in on the same curve (D30). Nothing is decorative: nothing moves unless a thing arrived or a person did something.

## Pictures

A tile's picture sits on the colour made from its title (`hueOf`), with the first letter if there is none or it does not load. A picture that arrives after its tile was drawn fades in over 0.4 s (`img[data-late][data-in]`, set by `comesIn` in `shared/Poster.tsx`); one that was already there (kept a moment ago) is not hidden to be shown again (D31). The banner's backdrop is fetched and decoded first, and only then crossfades over the one before it. Sizes asked for: posters 500 px, backdrops 1280 px, stills 300 px (`server/library/filmpire.ts`).

The home-screen icons: `icon-192.png`, `icon-512.png` (a disc with transparent corners), `icon-maskable-512.png` (the same disc at 70 % of the side on the page's black, full to the edge, so that a launcher's own shape cuts it with no white plate round it), `apple-touch-icon.png` (180 px, the same composition), and the favicon is the same disc as an inline SVG.

## Icons

One family, `shared/icons.tsx`: a 24-unit grid, stroke 2, round caps and joins, `currentColor`, drawn at `1em` unless a place says otherwise; an icon-only button has an accessible name (and a tooltip for a pointer). The phone icon is 13 × 18 with a 3 radius (it was narrow and tall, D26); chevrons point the way a page goes.

## Layout recipes

* **TV page** = the wordmark at the top left (never moves, D24), one Back pill at the top right on the right edge, a heading, then the content on a grid of `--tile-gap` (Settings is three columns, each a group's name over one surface).
* **TV menu** = a strip of icons, shut; open, a 27.8 em panel that carries the wordmark in the same place and size, and dims the page.
* **Row** = a title, then tiles that run off the right edge (the next one peeks); a pointer gets an arrow at the side that has more (D27).
* **Phone list** = a card with hairlines between its rows; three kinds of card, told apart by the space between them and by what is at the end of the row: *places* (a chevron), *switches* (the words and what each does inside one row), and *what takes something away*, alone and last (D28).
* **Phone held sideways** (`orientation: landscape` and `max-height: 520px`): two columns, the same scale, targets stay 44 px tall; a sheet's options sit two to a row.

## What is not in the system on purpose

* Optical exceptions to the scale: the keyboard's keys (1.1 : 1), the rank numerals, the codes, the wordmark, thin bars.
* A third look, a light theme, a user-set text size: not asked for.
* Merging the older sheets under the refined one: hygiene that changes no pixel, so it waits.
