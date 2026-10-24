# Phone layout: the plan

Read `RESEARCH.md` (rules **R1..R15**) and `AUDIT.md` (findings **A1..A10** for the remote, **B1..B9** for the phone used as the screen) first.
This is what gets built, screen by screen, in the order it is built. It was reviewed against the research and against the user's own words before any code was written; the review and what it changed are at the end.

## What the user asked for, in their words

> "... it's just the TV version weirdly sized for the phone, instead of changing layout fully, improving phone responsiveness, ease of access and readability. Like stuff can be too small, cause it tries to fit on a vertical phone, menus cover too much of the screen, etc. A big update would be to make stuff more vertical [oriented], over keeping the TV horizontal version everywhere."

Read as five jobs, each with a number it is checked by (the numbers are in `AUDIT.md`, the after-numbers will be in `QA.md`):

| Job | Meaning here | Checked by |
|---|---|---|
| **Change the layout fully** | a phone app's shell (bottom bar, destinations, a title is a page, a mini remote), not the TV's page in a column | screenshots before/after; tab bar present on every remote screen |
| **Too small** | text 14 px or more (12 px only for the labels under the bar's icons); every control a thumb lands on 44 px or more (48 px in the bar and on primary buttons) | `phone-numbers.mjs`: smallest text, smallest target, at six sizes |
| **Menus cover too much** | sheets at most 70% of the height in portrait, a side sheet (half the width) sideways, a title is a page | sheet cover per screen |
| **More vertical** | portrait posters (2:3) not wide stills; a vertical list wherever a row is long ("See all"); everything above the fold is titles, not a form | first title's position, titles in view |
| **Ease of access** | one tap to Home / Search / My lists / You from anywhere; Back always goes one step; the remote one tap away while something plays | e2e: Back chain, reachability at 320 |

**Not in the brief, so not done:** a re-skin. The palette, the six accents, the wordmark, the type and the 12 px corners stay: the before/after should read as "the same app, laid out like a phone app". No new dependency, no volume control (the protocol has none: R15), no downloads tab, no short-video feed.

## One idea per path

* **The remote** (path A): `Controller.tsx` keeps every line of its state and socket handling. What changes is what it draws: the one long column becomes **four destinations with a bottom bar** (Home, Search, My lists, You), the header becomes a **TV chip** and at most two actions, the playing title becomes a **mini remote above the bar** that opens the full remote, a title becomes a **page**, and sheets get shorter.
* **The phone as the screen** (path B): the TV page stays the TV page (the cat companion and the D-pad depend on its markup, `src/client/cat/**` is not touched), and on a narrow screen it is **re-laid out by stylesheet**: the rail becomes a bottom bar, the hero goes, tiles are posters, the title page and the player's controls are restacked for a thumb. A few lines of markup are added only where CSS cannot do it (the section chips, two rows in the profile).

Layout is decided by **media queries**, not by guessing the device, so every size is testable: compact = width under 600 and height at least 480 (a phone upright); everything else (a phone on its side, a tablet) gets the rail.

## The shell (path A)

```
 portrait, compact (320-599 wide)                   sideways / tablet (a rail)
 ┌──────────────────────────────────┐              ┌────┬─────────────────────────────────┐
 │ [▭ TV 4F2A      ]      🔔  (You) │ top bar 56   │ ⌂  │ [▭ TV 4F2A ]            🔔  (You) │
 │   ● TV connected                 │              │Home│                                   │
 ├──────────────────────────────────┤              │ 🔍 │   content                         │
 │                                  │              │Search                                   │
 │   the tab's content              │              │ ≡  │                                   │
 │   (scrolls with the page)        │              │Lists│                                  │
 │                                  │              │ ☺  │                                   │
 ├──────────────────────────────────┤              │You │ ┌───────────────────────────────┐ │
 │ ▮ The Glass Orchard      ❚❚      │ mini remote  │    │ │ mini remote                   │ │
 │ ─── Playing on TV 4F2A ──────    │ 56           └────┴─┴───────────────────────────────┴─┘
 ├──────────────────────────────────┤
 │  ⌂        🔍        ≡        ☺   │ bar 56 + safe area
 │ Home    Search   My lists    You  │
 └──────────────────────────────────┘
```

* **Top bar (A3, R5):** a **TV chip** on the left (the TV's icon, its name in 16 px, how it is doing in 14 px under it; a tap opens the TV sheet and replaces the "..." button). On the right: the bell (only when friends are on) and the profile picture, or "Sign in" for a guest. Never more than the chip, one action and the picture. `data-testid`s stay: `tv-name`, `tv-online`, `party-count`, `menu` (the chip), `bell-button`, `account-button`.
* **Bar (R1, R2, R3, R10):** four destinations, icon over a 12 px label, each 80 px or wider and 56 px tall (48 px at least), always present on the four tabs (also with the server waking or the TV away; a tab with nothing in it says why and what to do). The active one is the accent (a tinted pill behind its icon and the label in the accent colour, so it is not told by colour alone); `aria-current="page"`.
* **State of a tab (R3):** each tab keeps its scroll position; a tap on the tab you are on scrolls it to the top; a tab switch is not a step in the history. **Back** from a tab other than Home goes to Home; from Home it asks "press again to leave" as it does today (`useBackWhile`, same layer machinery as sheets, so a sheet or a page opened later is closed first).
* **Mini remote (R4):** shown on every tab and every page of the shell while something plays (or is loading) and the full remote is not open: a poster thumbnail, the title, the state ("Playing on TV 4F2A", "Paused", "Buffering…"), a play/pause button (44 px), and a 2 px progress line along its top edge. A tap on it (not on the button) opens the full remote. `data-testid="playing-bar"` stays on that tappable part.
* **The full remote** replaces the shell (no bar, no mini remote), as it replaces the library today; its header is a Back chevron and the same TV chip. Back (the phone's own, or the chevron) returns to the tab you were on. A film that starts, here or on the TV, opens it as it does now.
* **Scrolling:** the page scrolls (not an inner box), so the browser's own bar still folds away; the top bar is sticky, the bottom bar and the mini remote are fixed, and the content has room for both (`--shell-bottom`).
* **Widths (R12):** under 600 wide and at least 480 tall: the bar. Anything else: the bar becomes a **72 px rail** on the left (icon over label, 64 px per item), the top bar spans the rest, the mini remote sits at the foot of the content area. On a tablet the content is a column up to 720 px, not 490.

### Home (A1, A2, A4)

```
 ┌──────────────────────────────────┐
 │ [▭ TV 4F2A ● TV connected] 🔔 (m)│
 │ ┌────────────────────────┐ ┌────┐│ link bar: one row, 48 px (A2)
 │ │ 🔗 Paste a video link  │ │Paste││   a "Play on TV 4F2A" button appears under it only
 │ └────────────────────────┘ └────┘│   when something is typed (the label says where it plays)
 │ Maya asked to watch together  [..]│ banners from friends, only if there are any
 │ Continue watching                │
 │ ┌─────────────────┐ ┌───────────┐│ wide cards 16:9, 232 px, the next one peeks (R7, R14)
 │ │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │ │ ▓▓▓▓▓▓▓▓▓ ││ progress along the foot, "1 h 5 min left"
 │ │ ═══════░░░░░░░░ │ │ ══░░░░░░░ ││
 │ └─────────────────┘ └───────────┘│
 │ The Glass Orchard   Copper Sky    │
 │ 1 h 5 min left      17 min left   │
 │ (All)(Movies)(Series)(Cartoons)(An│ chips, 44 px, scroll sideways
 │ Popular this week        See all ›│
 │ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌──   │ posters 2:3, 112 px wide: three and a bit
 │ │    │ │    │ │    │ │    │ │     │ (+) in the corner stays (hold = list too)
 │ │    │ │    │ │    │ │    │ │     │
 │ └────┘ └────┘ └────┘ └────┘ └──   │
 │ Long Harbour  Paper Moons  Salt…  │ 14 px, two lines at most
 ├──────────────────────────────────┤
 │ ▮ …mini remote when playing…     │
 │  ⌂ Home   🔍   ≡ My lists   ☺ You │
 └──────────────────────────────────┘
```

* Gone from Home: the 24 px question, the three-line help, the *disabled* Play button, the lists and the ratings (they are **My lists**), the search field (it is **Search**). `phone.homeTitle` stays as a visually hidden `h1` (a screen reader still hears what the page is).
* The link bar keeps `url-input`, `paste`, `play-url`, `resolve-status`; the field and Paste share a row; the Play button shows once there is text (so nothing disabled is on screen).
* Rows are `Library`'s, in **browse** mode (the feed, "Because you watched …", the filter chips); the chips sit directly over the rows they filter. Each row's heading has **See all ›**, which opens a **row page** (below).
* Posters use the library's portrait picture (`image`) first and the wide one (`backdrop`) only when there is none; "Continue watching" keeps wide stills because the progress bar belongs on one.

### Search (A1, R6)

```
 ┌──────────────────────────────────┐
 │ [▭ TV 4F2A ● TV connected] 🔔 (m)│
 │ ┌────────────────────────────┐   │
 │ │ 🔍 Search movies & shows…  ✕│   │ field 52 px, 16 px type (no iPhone zoom), autofocus off
 │ └────────────────────────────┘   │
 │                                  │
 │ nothing typed:                   │      typed:
 │ Popular right now                │      Results for “glass”
 │ ┌──┐ The Glass Orchard      (+)  │      ┌─────┐ The Glass Orchard      (+)
 │ │▓▓│ 2023 · Movie               │      │▓▓▓▓▓│ 2023 · Movie
 │ └──┘                            │      └─────┘
 │ ┌──┐ Copper Sky             (+)  │      Closest matches
 │ …                                │      …
 └──────────────────────────────────┘
```

* The field and the results are `Library`'s **search** mode (same local-then-server search, same "closest" list); what was typed is kept when you leave the tab (module state that exists already).
* Before anything is typed there is **a list worth tapping** (R6: suggestions): the first row of the feed as a vertical list, not a blank page and a hint.
* Filter chips on search results are **not** built: the library's items say movie or series, never cartoon or anime, so four chips would be wrong for two of them. (A deviation from R6, stated again in `QA.md`.)

### My lists (A1)

```
 │ My lists                Manage lists│ 24 px heading + 44 px link
 │ Favourites                 See all ›│
 │ ┌────┐ ┌────┐ ┌────┐ ┌──           │ the same poster rows as Home
 │ Weekend                    See all ›│
 │ …                                   │
 │ My ratings                 See all ›│ (when rating is on and something is rated)
 │ ┌────┐ ┌────┐ …  (score under each) │
 │ ─ empty ─                           │
 │            ≡                        │ R2: the tab is never greyed out; it explains itself
 │      Nothing saved yet              │
 │ Tap + on a title to keep it here.   │ (rows.myListEmpty, as today)
 │   [ Find something to watch ]       │ → goes to Home
```

`ListRows` and `RatingsRow` are reused unchanged inside it (`lists-manage`, `ratings-all`, the `list-*` and `rating-*` ids stay); only the empty state is new.

### You (A1, A8)

The account hub **as a tab** instead of a page you open: the same card (picture, name, email), the same groups (switch/manage profiles, friends, ratings, settings, feedback, sign a TV in, devices, security) and the sign-out button; a guest sees the pitch, the form and settings. Every sub-page (settings, friends, a friend, profiles, devices, security) is still a full-screen `Page` with its own Back, laid over the shell, so those pages, their ids and their Back chain are untouched. The picture or "Sign in" in the top bar goes to this tab. `account-screen`, `account-card`, `menu-*`, `sign-out` stay. Only the hub's own Back button goes (there is nowhere to go back to: it is a tab).

### A title is a page (A5, R8)

```
 ┌──────────────────────────────────┐
 │ (‹)                              │ round back button over the picture, 44 px
 │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │ picture, 16:9 (the wide one; the poster when there is none),
 │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │ fading into the page
 │ Harbour Lights                   │ 24 px
 │ 2019 · Series                    │ 14 px
 │ ┌──────────────────────────────┐ │
 │ │ ▶  Play S1:E1                │ │ full width, 52 px, the accent (R8)
 │ └──────────────────────────────┘ │
 │  ＋          ☆          ↗        │ icon over label, 72 px tall: My lists · Rate · Recommend
 │ A port town's night shift, told  │
 │ one ship at a time.              │ 16 px, whole text (a long one scrolls with the page)
 │ Episodes                         │
 │ (Season 1)(Season 2)(Season 3)   │ chips 44 px
 │ ┌───┬────────────────────┬────┐  │
 │ │ ▓ │ 1  Pilot           │ 38m│  │ rows with a still, a title, minutes, a progress line
 │ …                                │
 └──────────────────────────────────┘     (no bar: a page, like the account's)
```

`TitleSheet`'s content (play, list, recommend, rating box, description, seasons and episodes, all their ids) moves unchanged into a new `TitlePage` shell; `data-testid="title-sheet"` stays on the page, the back button is `title-back`. Sideways: the picture on the left, the rest scrolls on the right. A title opened from the account or the bell (a friend's, a rating) opens the same page over it, as it does now.

### The full remote (A10, R4)

```
 ┌──────────────────────────────────┐
 │ (⌄)          [▭ TV 4F2A ● connected]│ back (collapse) + the TV chip
 │          ┌────────────┐          │
 │          │  ▓▓▓▓▓▓▓▓  │          │ art, 2:3, about 55% of the width
 │          │  ▓▓▓▓▓▓▓▓  │          │ (hidden when the screen is under 720 px tall)
 │          └────────────┘          │
 │ S1:E3 · Season 1, Episode 3      │
 │ The Glass Orchard                │ 24 px, two lines
 │ Playing on TV 4F2A               │
 │ ───────●────────────  0:01 -0:38 │
 │      (⟲10)    ( ❚❚ )   (10⟳)     │ 64 / 88 / 64 px (as today)
 │  [⏮ Previous]  [Next ⏭]          │ (series)
 │ [Subtitles  English] [Speed  1×] │ chips, 14 px under 16 px values
 │ [Episodes · 12]      [Source …]  │
 │ [■ Stop]  [⛶ Full screen]  [🔗 Change video] │
 └──────────────────────────────────┘
```

What is in the remote does not change (it was fine); it gets a header, the art that fills the blank middle, 14 px secondary text, and **Change video** now collapses the remote to the shell instead of opening a sheet that holds the whole home page (pasting and picking happen on Home, with the mini remote still in view).

### Sheets (A3, A6, R9)

* **One policy:** at most **70%** of the screen height (`max-height: min(70vh, calc(100% - 8px))`, was 86%), a grabber and a visible Close as now, Back closes, one at a time (they already replace each other). Sideways (the rail layout) a sheet is a **side sheet**: the right 440 px (or 55% on a narrow screen), full height, so the page is still beside it.
* **The "..." menu becomes the TV sheet**, opened by the chip, short: the QR card is no longer the first thing in it. Rows: *Control with more phones* (the card, one tap to open it in place), *Watch party*, *My TVs*, *Full screen on this phone*, *Disconnect*. The paste-box switch lives in Settings only (it was in both). The footnote under Disconnect stays as the row's own hint.
* **Subtitle style** and the watch-party sheet keep their content (long, scrolling, inside 70%); **the title** and **the account's hub** are no longer sheets.
* Speed, quality, source, lists, list picker, bell, ratings: as now, inside the new cap.

### "See all" (R7)

A row's heading ends in **See all ›**: a full-screen page with that row's titles in a 3-column grid (2 columns at 320), loading more as it nears the end (the feed's own paging), a Back chevron, `row-page`. For My lists it is the list's own page. A poster in the grid is the same tile (open, hold or + for a list). New component `RowPage`; nothing else changes about rows.

## Path B: the TV page on a phone (B1-B9)

Everything is a stylesheet (`polish/tv-phone.css`) under `@media (max-width: 599px)` except two small additions marked *(markup)*. The guard `polish.test.ts` applies to it; nothing above 599 px wide changes by construction (proved by `compare.mjs` on the TV and desktop walk).

```
 ┌──────────────────────────────────┐
 │ kino                    (You)  ⛶ │ top bar 56: wordmark, profile chip, full screen (44 px)
 │ (All)(Movies)(Series)(Cartoons)… │ section chips, 44 px  (markup)
 │ Continue watching                │
 │ ┌───────────┐ ┌───────────┐ ┌─── │ wide cards, 14 px names
 │ Popular this week                │
 │ ┌────┐ ┌────┐ ┌────┐ ┌────┐     │ posters 2:3, 112 px, title 14 px
 │ …                                │
 ├──────────────────────────────────┤
 │  ⌂ Home   🔍 Search  ▦ Browse  ≡ My lists │ the rail as a bottom bar, 4 items, 56 px, labels shown
 └──────────────────────────────────┘
```

* **B1:** the rail becomes a bottom bar of four labelled items (Home, Search, Categories, My lists). Movies, series, cartoons and anime are the **chips** under the top bar on every library view *(markup in `Browse.tsx`, same `tv-filters`/`tv-choice` classes the TV's own chips have, so keys and the cat see nothing new)*. *Watch party* and *Use this phone as the remote* become two rows on the profile page *(markup)*, since a bar of six would not fit a phone.
* **B2, B3:** the hero (the focused title's text, the Resume and Remove buttons) is hidden on a phone: a tap on a card does what the hero's button did. Tiles are 112 px posters, names 14 px.
* **B4:** search is a field at the top, 16 px type, the rail's bar below.
* **B5:** a title page is a picture banner, the title, a full-width 52 px Play, the secondary buttons in a row, the synopsis, then seasons and episodes; Close is a round 44 px button over the picture.
* **B6:** the player: the seek bar and the two times on top, then **two rows** of controls: play (56 px) / back 10 / forward 10 on the first with the speed, "Audio & subtitles" and full screen, and the party and stop buttons on the second, all 44 px or more, 14 px labels. Gestures (tap, double-tap, hold) are untouched.
* **B7:** the speed / audio and subtitles / episodes menus are **bottom sheets** (70% at most) with a 44 px Close.
* **B8, B9:** no text cut off at 320 (names wrap to two lines); the profile page is one column.
* Sideways (600-899 wide, under 480 tall) the TV's own rail stays, its items are 44 px, the hero is a single line, the player's rows are the TV's.

## Design system notes (`design:design-system`)

**Tokens** (`:root[data-ui="polish"]`, in `polish/shell.css`): `--bar-h: 56px`, `--top-h: 56px`, `--mini-h: 56px`, `--tap: 48px` (44 px is the floor), `--shell-bottom` (the bar, the mini remote, the safe area; the page's bottom padding and the toast's offset), `--poster-w: 112px` (2:3; 104 px at 320, 128 px from 412), `--wide-w: 232px` (16:9). The type tokens: `--p-fs-1` goes from **13 px to 14 px** (this one line lifts most of the 45 to 78 small text boxes per size), a new `--p-fs-0: 12px` only for the bar's labels. Colours, radii and the eased curve are the existing ones (`--surface`, `--surface-2`, `--p-line`, `--p-r-1..3`, `--p-ease`, the accent).

**Components** (all new ones are plain React + CSS, no library):

| Component | States | Notes |
|---|---|---|
| `TabBar` | default, active, pressed, keyboard-focus, with a count | `nav` landmark, buttons with `aria-current`; ids `tab-home`, `tab-search`, `tab-list`, `tab-you` |
| `TvChip` | connected (green dot), reconnecting, TV away (red dot), server waking | one button; the dot is also in the words, never colour only |
| `MiniRemote` | playing, paused, loading/buffering, error ("Couldn't play") | the progress line is `aria-hidden`; play/pause has a name |
| `Poster tile` | default, in a list (check), with a score, with progress, pressed, held | the existing `Card` / `Tile`, a different picture and width |
| `Chips` (`lib-pill`) | default, selected (accent tint and ring, as now) | 44 px, scroll sideways, no wrapping onto a second row |
| `TitlePage`, `RowPage` | loading (the grey tile), empty, failed | `Page`'s focus handling and Back (`useBackToClose`) |
| `Sheet` | one size | the 70% cap; side sheet sideways |

**Accessibility (`design:accessibility-review`, to be re-run on the build):** every icon button has a name (the chip: "TV 4F2A TV connected, TV menu": the words that are on it first, as WCAG 2.5.3 asks, then what it opens); the bar and the rail are one `nav` with `aria-label`; tab content has one visually-hidden `h1`; focus order is the visual order (top bar, content, mini remote, bar) and a page or sheet traps focus as they do now; targets 44-48 px with 8 px gaps; motion respects `prefers-reduced-motion` (the existing block covers `.phone-ui *`); contrast of the active tab label is checked against the six accents; text is 14 px or more except the four tab labels (12 px, 600 weight); nothing relies on hover.

**Copy (`design:ux-copy`):** sentence case, verbs first, the same word for the same thing. New strings (en / ro / it; `i18n.test.ts` keeps the keys equal):

| Key | en | ro | it |
|---|---|---|---|
| `tabs.label` | Main navigation | Navigare principală | Navigazione principale |
| `tabs.home` | Home | Acasă | Home |
| `tabs.search` | Search | Caută | Cerca |
| `tabs.list` | My Lists *(was "My lists": the TV's rail and the title page's button already say "My Lists", the blind review noticed the two)* | Listele mele | Le mie liste |
| `tabs.you` | You | Tu | Tu |
| `remote.open` | Open the remote | Deschide telecomanda | Apri il telecomando |
| `search.popular` | Popular right now | Populare acum | Popolari adesso |
| `rows.seeAll` | See all | Vezi toate | Vedi tutto |
| `lists.emptyTitle` | Nothing saved yet | Nimic salvat încă | Ancora niente di salvato |
| `lists.browse` | Find something to watch | Caută ceva de văzut | Trova qualcosa da guardare |

Labels are checked at 320 px (four labels share 320 px: 80 px each, "Listele mele" and "Le mie liste" at 12 px are the longest; if one is cut the label becomes "Liste"). Existing strings are reused wherever the thing is the same (`play.paste`, `play.on`, `library.*`, `rows.*`, `common.back`, `phone.tvMenu`, `tv.home`, `tv.search`, `tv.categories`, `party.rail`, `tv.useRemote`).

## What the tests see (kept ids, and the ones that move)

Kept: `tv-name`, `tv-online`, `party-count`, `menu`, `account-button`, `bell-button`, `playing-bar`, `url-input`, `paste`, `play-url`, `resolve-status`, `library*`, `filter-*`, `continue-*`, `list-*`, `rating*`, `title-play`, `title-list`, `title-episode`, `rate-title`, `account-screen`, `account-card`, `menu-*`, `sign-out`, every sheet's id, `page-back` on every sub-page.

Move, with the spec edits that go with them (listed in `QA.md`): `library-search-input` is on the Search tab (12 uses: `tab-search` first), `change-video` collapses the remote instead of opening `link-sheet` (3), a title's close is `title-back` (a few), the hub's own `page-back` is gone (about 8 of 15), the paste-box switch is only in Settings, and `control-code` is behind the "Control with more phones" row.

## Slices (one commit each, the app works after each)

| # | Slice | Done when |
|---|---|---|
| S0 | type floor: `--p-fs-1` 14 px | unit/guard tests, screenshots at 320 show no overflow |
| S1 | shell: tokens, `TopBar` + `TvChip`, `TabBar`, tabs (Home = what it is now minus Lists/Ratings, Search, My lists, You), per-tab scroll, Back | e2e Back chain; no horizontal overflow 320/360/390; bar reachable |
| S2 | mini remote and the full remote as a shell replacement (art, header) | remote-back / android-back specs |
| S3 | Home and My lists content: link bar, portrait posters, row heads, `RowPage` | first title in the top third |
| S4 | Search tab: browse/search modes of `Library`, the suggestions list | search specs |
| S5 | title page | title specs |
| S6 | sheets: 70% cap, TV sheet, side sheets | cover numbers |
| S7 | rail layout (sideways, tablet) | numbers at 844x390 and 768x1024 |
| S8 | path B: bar, chips, posters, title page | TV walk unchanged; phone-tv numbers |
| S9 | path B: player and menus | player-touch spec, numbers |
| S10 | strings en/ro/it, a11y and critique passes, `QA.md` | checked at 320 in all three |

If the work stops early it stops on a boundary of this table, and the README of what is left goes in `QA.md`.

## Review: the plan against the research, and against the user's words

**Rules.** R1 bar of four labelled tabs: yes (A: Home, Search, My lists, You; B: Home, Search, Categories, My lists). R2 never hidden or disabled: the bar is always there, My lists explains itself when empty, Search lists titles before you type. R3 tab state: scroll kept per tab, tap on the current one goes to the top, tabs do not pile up history, Back goes to Home. R4 mini remote: yes, above the bar on every tab. R5 no "..." menu: gone, replaced by the chip; top bar has the chip, one action, the picture. R6 search as a destination with suggestions: yes; **filter chips on results: not built** (the library cannot tell cartoon from anime in a result). R7 portrait posters with the next one showing and "See all": yes (continue-watching keeps wide stills, for its progress bar). R8 a title is a page: yes, with a full-width Play and an icon-over-label row. R9 sheets: the 70% cap, grabber and Close, Back, one at a time; **the 50% first height is not met** (a sheet of six speeds must scroll on a 568 px phone at 50%; shorter content instead). R10 targets: 48 px bar and primary buttons, 44 px elsewhere, 8 px gaps. R11 type: 14 px body-secondary, 16 px body, 12 px only for the four bar labels. R12 sideways: a rail and side sheets. R13 no thumb-zone claims: the bar is at the bottom by convention and the plan says nothing about reach. R14 no auto-advancing hero: there is no hero. R15 no volume: not built, listed as a gap.

**The user's words.** "Layout, not weirdly sized": the shell and the title page change the structure, not only the sizes. "Too small": the floor numbers above. "Menus cover too much": 86% to at most 70% (side sheet sideways), the biggest of them (a title, the account hub) are not sheets any more. "More vertical": posters in portrait, a vertical "See all" for every row, one column of destinations instead of a long scroll with search at its bottom. "Ease of access": four destinations one tap away, the remote one tap away, a TV chip in place of an overflow menu.

**What the review changed (v1 of this plan was different in six places):**
1. v1 gave the remote a fifth tab. Changed to a mini remote (R4) and a full remote you open: a tab with nothing to show most of the time breaks R2, and the remote is a state of the app, not a place.
2. v1 kept the account hub as an overlay and added a "You" tab that opened it. Changed to the hub **being** the tab: two ways to the same screen were one too many.
3. v1 put the filter chips on Search (R6). Dropped: they would have been wrong for cartoons and anime.
4. v1 capped sheets at 50% (R9). Changed to 70%: at 320 x 568 a six-row choice cannot fit in 284 px, and a sheet that scrolls to show six speeds is worse than a taller one; the content of sheets was compacted instead, and the biggest ones stopped being sheets.
5. v1 gave path B a "More" tab with a menu. Changed to four tabs plus section chips, and two rows on the profile page: "More" is the overflow tab the research says to avoid.
6. v1 changed the phone-as-screen layout with a class set from `thisIsPhone()`. Changed to a plain width query: it can be tested at any size, a narrow desktop window gets the same layout, and the TV page above 599 px is unchanged by construction.

**Open choices the user may veto** (also in the final report): "You" as the fourth tab's name and the profile picture staying in the top bar as well; the TV chip replacing "..."; the paste-a-link bar staying on Home (not moved to Search); no hero card; "Change video" collapsing the remote; section chips replacing the Movies / Series / Cartoons / Anime rail items on a phone used as the screen.
