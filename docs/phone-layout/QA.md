# Phone layout: QA and hand-over

Branch `feat/phone-layout`, on `origin/main` `91bd180` (which had not moved at the last check). The research, the audit and the plan are `RESEARCH.md`, `AUDIT.md` and `PLAN.md` in this folder; this file says what was built, what was checked and how, what the numbers are, and what is **not** known.

## Verdict

**Built, and checked as far as a desktop browser can check it. Not yet seen or touched on a real phone.**

The remote (path A) and the phone used as the screen when it is held upright (path B) are laid out as phone apps: four labelled places on a bar at the foot, the TV as one chip at the top, what plays as a line above the bar, a title as a page of its own, posters upright in rows with "See all", sheets that stop at 70% of the height, the player's buttons in rows. Against the build on `origin/main`, measured by the same walk at six sizes:

- the smallest text is **14 px** (13 before; 12 px only for the bar's four words);
- the smallest thing to press is **44 px** (38 on the remote and 24 on the phone used as the screen before);
- no sheet covers more than **70%** of a tall screen (86% before; 78% of a 568 px one);
- nothing slides sideways and no text is cut off on the remote, at any of the six sizes;
- on a 320 x 568 screen the first title of the home page starts at **29%** of the height (67% before), and the page is 2.7 screens long (3.9);
- the big screen's pictures are the old build's, pixel for pixel (50 of 52; the other two differ only in what is random in every run), and every spec file the branch touches passes (554 tests).

Two things are **not done**: the phone used as the screen when it is **held sideways, or is a tablet, is as it was** (a 24 px speed button, 106 of 145 targets under 44 px at 844x390), and **nothing ran on a real phone** (last section).

## What was checked, and how

Everything ran in Chromium (Playwright) with touch emulation, on the made-up catalogue. Nothing ran on a real phone (see the last section).

| Check | How | Result |
|---|---|---|
| Types | `tsc --noEmit` | clean |
| Unit tests | vitest: `polish.test.ts` (the guard for what old TV browsers parse), `i18n.test.ts` (en, ro and it have the same keys), `browseNav.test.ts`, `ChatPhone.test.ts` | 4 files, 90 tests, pass |
| e2e on the last build | every spec file the branch touches (16), on a private build with its own server, five runs side by side | **554 tests pass**: features 141, tv-screens 125, player-touch 42, cat 43, accounts 37, handheld 28, phone-to-tv 25, phone-layout 25 (2 are new), friends 24, library-feed 22, several-tvs 14, friend-tags 8, android-back 7, pointer-focus 6, bell 5, remote-back 2. Two tests failed on the first pass, see below |
| Walks | `scripts/ui-walk/run.mjs`: both paths, a picture and a scan (every element's box and style) of every screen | six sizes (320x568, 360x800, 390x844, 412x915, 844x390, 768x1024): 26 steps of the remote and 12 of the phone used as the screen at each, every step worked. Romanian and Italian at 320: the same 3 of the remote's 26 steps fail as before the branch (they wait for an English word), the 12 of the other path work. The big screen's keys: 25 of 25 routes |
| axe-core | WCAG 2.0/2.1 A and AA rules on 127 screens of the old build and 139 of the new (320 and 390 wide, a guest and signed in, both paths) | screens with nothing found 43 -> 93; `aria-input-field-name` 4 screens -> 0; `label-content-name-mismatch` 884 nodes -> 161; `color-contrast` 2 -> 2 (the `5s` of "Up next", in the old build too); no rule that was not there before. (The walk writes "TV XXXX" over the TV's random code in the words and leaves the real one in the name, so every picture shows one more mismatch on the chip; a probe of the real page found none, and these counts leave it out.) |
| Keyboard | a spec for the order and the rings, and two new ones: what Tab and Shift+Tab reach is clear of both bars, at 320 and 390 | pass; the two new ones fail on the build without the margin (see the accessibility review) |
| Reduced motion | computed animation and transition of the sheet, its backdrop, the page, the bar's places, with the preference on and off | on: 0.00001 s everywhere; off: 0.24 s (sheet), 0.18 s (backdrop), 0.22 s (page) |
| Accessibility tree | roles and names dumped from the live page: the chip, the bar, the TV's sheet, a title's page | in the review below |
| Contrast | computed from the tokens, for the six accents | in the review below |
| Words | pictures of both paths at 320 in Romanian and Italian, and `phone-layout.spec.ts`, which fails if a word of the bar is cut | the bar's four words fit ("Listele mele", "Le mie liste"); nothing is cut. (The made-up library's row names stay English: they come from the library, not the app.) |
| The big screen | its own pages walked on the old build and the new one | next section |
| A fresh pair of eyes | one subagent that saw 18 pairs of pictures with no labels | the last section but two |

**The two tests that failed on the first pass** (both pass now; neither is a regression):

1. `features`: "a search lists what it finds ... and is still there after something is played and stopped". It measured where a result was, clicked it, and compared after coming back. The click had scrolled the page by 9 px: the room kept for the bars (below) brings a control near a bar clear of it, for a click's scroll as for a key's. The test now brings the result into view before it measures where to come back to. (A finger's tap scrolls nothing.)
2. `phone-to-tv`: "a wrong pairing code is rejected with a clear message": no message in 8 s, once, while five runs shared the machine. It passes alone and when its file is run again (25 of 25). The pairing screen and the server are not touched by the branch.

**One change came out of the checks**: the keyboard probe found that a poster reached by Tab had its lower quarter behind the bar (8 of 60 stops at 390 and at 320), and that something reached by Shift+Tab sat under the TV's bar (9 of 50). `shell.css` now gives what the tab's panel holds a `scroll-margin` the size of the bars (and of what plays above the bar): 0 of 110 stops are behind a bar now at both widths, and a spec holds it.

## Before and after, in numbers

**How they were taken.** `scripts/ui-walk/run.mjs --scan` walks the app on the made-up catalogue and, for every picture, records every element's computed style and box. "Before" is the build of `origin/main` (`91bd180`), "after" is this branch's last build; the same script walked both at the same six sizes. Only the screens **both** walks have are compared (16 to 21 per size for the remote, 10 for the phone used as the screen), so a screen that exists only in the new layout cannot flatter it. "Smallest target" is the smaller side of the larger of a control's drawing and its `::before/::after` hit area (a 32 px "+" with a 44 px hit area counts as 44). Nothing is a real device: see the last section.

```
node node_modules/vite/bin/vite.js build --outDir .ui-polish/dist-after --emptyOutDir        # a private build of this branch
$env:SCAN_OUT='.ui-polish/scan/after'; $env:CLIENT_DIR='.ui-polish/dist-after'
node scripts/ui-walk/run.mjs --only=phone,phone-tv --no-build --scan --size=390x844 --out=.ui-polish/shots/after --port=8811   # once per --size
node scripts/ui-walk/phone-compare.mjs .ui-polish/scan/before phone-390 .ui-polish/scan/after phone-390x844                     # the tables below
node scripts/ui-walk/phone-numbers.mjs .ui-polish/scan/after phone-390x844 --detail                                              # per screen: sheet cover, first title, page length
```

(`.ui-polish/scan/before` is the same walk on a build of `origin/main`; `docs/phone-layout/AUDIT.md` has its command.)

### The remote (path A), held upright, a guest

| Size | Smallest text | Text boxes under 14 px | Smallest target | Targets under 44 px | Tallest sheet | First title starts at | Home is |
|---|---|---|---|---|---|---|---|
| 320x568 | 13 -> **12** (14 without the bar's four words) | 44 -> **12** (the bar's words) | 38 -> **44** px | 6 of 182 -> **0** of 187 | 86% -> **78%** | 67% -> **29%** of the height | 3.9 -> **2.7** screens long |
| 360x800 | 13 -> 12 (14) | 68 -> 12 | 44 -> 44 | 0 -> 0 | 86% -> **70%** | 41% -> **20%** | 2.7 -> 2.0 |
| 390x844 | 13 -> 12 (14) | 65 -> 12 | 44 -> 44 | 0 -> 0 | 86% -> **70%** | 39% -> **19%** | 2.6 -> 1.95 |
| 412x915 | 13 -> 12 (14) | 68 -> 12 | 39 -> **44** | 2 of 183 -> **0** of 193 | 86% -> **70%** | 36% -> **18%** | 2.4 -> 1.8 |

Signed in (bell, account hub, friends, ratings, profiles, devices, lists), same screens: text boxes under 14 px 33 -> 4 at 320 and 46 -> 8 at 390 (the bar's words again); smallest target 38 -> 44 px at 320 (the accent swatches of Settings) and 44 -> 44 at the others; no target under 44 px at any size; tallest sheet 86% -> 78% at 320, 68% -> 69% at 390 (the ratings sheet, which was inside the budget already). **Sideways scroll: on 0 screens, before and after, at every size and in both paths. Text cut off: 0 before and after on the remote.**

What the smallest text now is: **14 px everywhere except the bar's four words, which are 12 px at weight 600** (the one place the plan allows it; Romanian and Italian fit at 320: `phone-layout.spec.ts` checks it).

### The remote, held sideways (844x390) and on a tablet (768x1024)

The bar becomes a rail down the left edge (72 px wide), the page is a column of at most 720 px, and a sheet is a **side sheet** 440 px wide, the full height of the screen.

| Size | Smallest text | Text boxes under 14 px | Targets under 44 px | Most of the screen a sheet covers (area) | First title starts at | Home is |
|---|---|---|---|---|---|---|
| 844x390 | 13 -> 12 (the rail's words) | 47 -> 12 | 0 -> 0 | 91% -> **52%** for every sheet but one; the subtitle-style sheet is still 91% (it shows a sample line, which needs the width) | 54% -> 42% | 5.1 -> 4.3 screens long |
| 768x1024 | 13 -> 12 | 73 -> 12 | 2 of 233 -> 0 of 222 | 58% -> 47% | 32% -> 16% | 2.1 -> 1.6 |

### The phone used as the screen (path B), held upright

The TV's own page on a phone: before, the TV's rail of ten unnamed icons and TV-sized tiles; now a bar of four labelled places, section buttons over the titles, upright posters, and the player's controls in rows.

| Size | Smallest text (without the bar's words) | Text boxes under 14 px | Smallest target | Targets under 44 px | Text cut off | First title starts at |
|---|---|---|---|---|---|---|
| 320x568 | 12.5 -> **14** | 66 -> 20 (all the bar's words) | 24 -> **44** px | 100 of 134 -> **0** of 108 | 5 -> **0** | 42% -> **25%** |
| 360x800 | 12.5 -> 14 | 104 -> 20 | 24 -> 44 | 107 of 151 -> 0 of 126 | 2 -> 0 | 30% -> 18% |
| 390x844 | 12.5 -> 14 | 108 -> 20 | 24 -> 44 | 107 of 153 -> 0 of 129 | 1 -> 0 | 28% -> 17% |
| 412x915 | 12.5 -> 14 | 112 -> 20 | 24 -> 44 | 107 of 159 -> 0 of 130 | 1 -> 0 | 26% -> 16% |

More, bigger tiles do not mean more tiles: the first screen of the home page holds **fewer whole tiles** than before (6 against 12 at 390), because a poster is 112 px wide where a TV tile was about 130 x 73. That is on purpose (a thumb and a name that can be read), but it is fewer titles at a glance.

### The phone used as the screen, held sideways or on a tablet: **not changed**

At 844x390 and 768x1024 the pictures and the numbers are the same as before: the TV's own layout, 12.5 px smallest text, a **24 px** speed button in the player, **106 of 145** targets under 44 px at 844x390 (108 of 198 at 768x1024). The plan said the rail's items would be 44 px there; that was **not built** (ten 44 px items do not fit in 390 px, so it needs a design, not a stylesheet line). It is the first thing left to do (see the end).

### Menus and sheets

Share of the screen's height a sheet covers (the one that covers most, at 390x844 unless noted):

| Sheet | Before | After |
|---|---|---|
| A film's page | 60% (a sheet) | a **page** of its own |
| A series' page | 86% (a sheet) | a **page** of its own |
| The TV's menu (the chip) | 86% | **68%** (70% with the code unfolded) |
| My TVs | 69% | 70% |
| Watch party | 86% | 70% |
| Choose a list | 60% | **34%** |
| Playback speed | 50% | 50% |
| Audio and subtitles | 64% | 64% |
| Subtitle style | 86% | 70% |
| The remote's account, bell, ratings (signed in) | 68% | 69% (inside the budget already) |
| At 320x568, the tallest | 86% | 78% (the cap on a screen under 640 px tall) |
| Sideways (844x390), the tallest by area | 91% | 52% (91% for the subtitle-style sheet) |
| **Path B**'s audio menu | 44% (a centred box, 94% wide) | 50% (a bottom sheet, full width, 44 px Close, 48 px rows) |

The plan's rule was "at most 70% of a tall screen, 78% of a short one"; `phone-layout.spec.ts` holds it at 320 and 390. (Path B's menus are not shorter than the centred box they replace; they are anchored where the thumb is, with rows and a Close button a thumb hits.)

## The big screen is unchanged

Three ways of knowing:

1. **By construction.** The branch's rules for the TV's page are in `polish/tv-phone.css`, all inside one block, `@media (max-width: 599px) and (min-height: 480px)` (a phone held upright): nothing at 1280x720, or on any TV or desktop window, reads it. The rest is `controller/*` and `polish/shell.css` and `phone.css`, which are loaded only with the phone's own page. `polish.test.ts` holds every sheet to what old TV browsers parse (every rule starts `:root[data-ui="polish"]`, no `@layer`, `:has`, `color-mix` and the like) and it passes.
2. **By picture.** The big screen's walks (`tv-hd` and `tv-in-hd`: 52 pictures at 1280x720: welcome, home, the rail shut and open, movies, series, categories, search, lists, the profile, history, ratings, the player's controls, its audio menu, the party panel, the friends' page, a party being hosted ...) were taken on the old build and on the new one one after the other and compared pixel by pixel (`scripts/ui-walk/compare.mjs`): **50 of 52 identical.** The other two (the friends' page, a party being hosted) differ in what is random in every run: the colour of a made-up friend's request card, and the party's code, its link and its QR (looked at side by side: nothing else moved). Two walks of the *old* build against each other differ in the same two pictures (1.6% and 1.4% of the pixels). The same comparison was run once more at the very end, on the build that is committed (`dist/client`): the same 50 of 52, the same two.
3. **By key.** The TV's own keys (`--only=tv-keys`, 25 routes: every page, menu and the player, with the arrow keys and Back) all work, and `tv-screens` (125 tests), `handheld`, `pointer-focus`, `several-tvs` and `cat` pass.

One thing that looked like a difference and is not. A first comparison, against pictures of the old build taken an hour earlier, showed 14 pictures changed: the rail's icons drawn 10 px further left on every page reached by choosing from the open rail. **The old build, walked again at that hour, drew them there too** (the same 9 pictures differ from its own earlier ones), so it is the walk or the machine and not the branch; walked one after the other, old and new agree. I did not chase why.

## The e2e specs that were edited, and why

The new layout moved some things: where a control is (a place of the bar, a page instead of a sheet), and a few things a phone no longer draws. The specs that name those things were edited; **no assertion was loosened to make a test pass**. `e2e/helpers.ts` has the helpers the edits use (`place(page, "home" | "search" | "list" | "you")` taps a place of the bar, `heldUpright`, `pressMenuLine`, `openProfilePage`).

| Kind of edit | Where | Why |
|---|---|---|
| **Only a different way to the same place** (`place(...)`, `title-back` for the title's close, `pressMenuLine` for the party line, the pairing code behind `control-open`) | `accounts`, `android-back`, `bell`, `features`, `friend-tags`, `friends`, `handheld`, `library-feed`, `phone-to-tv`, `player-touch`, `pointer-focus`, `several-tvs`, `tv-screens` | Lists, search and the account are places of the bar now; a title is a page with a Back button; on a phone used as the screen the party button is a row of the profile's page (a bar of six does not fit); the code and the QR are folded under a row of the TV's sheet until wanted. The same assertions follow. |
| **The expectation moved with the design** | `features`: library posters across 2 -> 3 (2 on the narrowest), the five filters are one row that scrolls sideways (first on the screen, last reachable by scrolling it, the page itself no wider than the screen) instead of "all five on the screen"; Resume/Remove are checked on the title's page (a phone held upright has no banner for them); "Change video" steps aside with the mini remote instead of opening the link sheet; the paste-box switch is only in Settings | Each is a thing the plan changed on purpose (`PLAN.md`), and each new expectation checks the same promise (reachable, on the screen, not cut off) in the new shape. |
| `bell`: the header's boxes are the chip, the bell and the account button | The TV's name and the button that opens its menu are one chip now. | The test still proves that nothing in the header overlaps at 320. |
| `pointer-focus`: "a tap on a small screen, then the page's Close tapped" | Held upright there is no banner that says which title the remote is on, and a finger is shown no ring. The test now says: the remote **is** on the tapped title, no ring for a finger, and the first key (ArrowRight) lights the next title. | This is the one place where the direction of an assertion flipped (a ring after a finger, before; none, now). It only applies to a phone used as the screen held upright; the TV and desktop assertions are as they were. |
| `tv-screens`: "a phone-sized screen puts the controls in rows of thumb-sized buttons" | Rewritten for the player's two rows (every control at least 44 px, nothing off the side). | The old one measured a single row. |
| `features`: "a search lists what it finds ... and is still there after something is played and stopped" | It brings the result into view (`scrollIntoViewIfNeeded`) before it measures where to come back to; the check after coming back is as strict as it was (under 4 px). | The room kept for the bars (shell.css) brings a control near a bar clear of it, and Playwright's click scrolls like a key does (9 px here); a finger's tap scrolls nothing. |
| **New**: `e2e/phone-layout.spec.ts` (25 tests) | The remote's four places and its chip; a title as a page and its Back; sheets at most 70% / 78%; the keyboard's order and rings; **what Tab and Shift+Tab reach is clear of both bars** (320 and 390); the phone used as the screen's bar, sections, pages and menus; words that fit in English, Romanian and Italian; all with the numbers (text 14 px, targets 44 px, nothing sideways). | The layout's own promises, in numbers, so that the next change cannot quietly undo them. The focus test was run against the build without the margin and fails there, at both sizes. |

## Accessibility review

**Standard:** WCAG 2.1 AA (and 2.2's 2.4.11, focus not obscured, because the bars lie over the page) | **Date:** 2026-10-24 | **Looked at:** both paths held upright at 320 and 390 px wide, a guest and signed in (139 screens by axe-core); the keyboard by script; the roles and names of the live page; contrast by arithmetic from the tokens. **Not looked at:** a screen reader being used, a real phone, the system's font size (see the last section).

### Summary

**Open: 8** | Critical 0 | Major 1 | Minor 7. **Fixed while building and checking: 4** (the table lists them as "fixed").

### Findings

#### Perceivable
| # | Issue | WCAG | Severity | Recommendation |
|---|---|---|---|---|
| 1 | The "Up next" countdown's `5s` is red on the card (#e50914 on #17171a, 3.73:1). In the old build too; it is on the phone used as the screen and on the TV | 1.4.3 | Minor | The lighter text colour for the number; keep the red for the bar |
| 2 | The small words of a row held under a finger (pressed fill) are 4.08:1 for a moment. A row lifted by a hand's hover was 4.15-4.23:1 in the phone-as-screen menus: **fixed** (the lighter grey a focused row has, `tv-phone.css`); the mouse hover on the remote's rows is unchanged | 1.4.3 | Minor | The same lighter grey for the pressed state |

Passes: the accents as a ring or a line (4.10:1 or more on the page, 3.73:1 on a card, for all six: 3:1 is asked); words on a button in the accent (4.54:1 or more); the bar's words (6.16:1 on the bar); the open place is not told by colour alone (a pill behind its icon, a whiter word, `aria-current`); the made-up poster art has its title in text next to it.

#### Operable
| # | Issue | WCAG | Severity | Recommendation |
|---|---|---|---|---|
| 3 | The phone used as the screen held **sideways or on a tablet** is as it was: 106 of 145 targets under 44 px at 844x390 (the smallest, the player's speed button, is 24 px: it meets 2.2's 24 px minimum, not the 44 px this work set) | 2.5.5 (2.5.8) | **Major** | Design the sideways rail: ten 44 px items do not fit 390 px, so it is a design and not a stylesheet line |
| 4 | In the phone-as-screen player the first row reads back 10 - Play - forward 10 on the screen, and Play - back 10 - forward 10 in the markup (a CSS `order`; the TV's keys and the cat read the markup). Tab and the screen disagree on that one row; the arrow keys follow the picture (the TV's keys are geometry) | 2.4.3 | Minor | Move the markup when nothing else reads it |
| 5 | A poster reached by Tab had its lower quarter behind the bar (8 of 60 stops), and a control reached by Shift+Tab sat under the TV's bar (9 of 50): **fixed**, 0 of 110 at 320 and at 390, and a spec holds it | 2.4.11 | fixed | (done: `scroll-margin` on the panel's controls) |

Passes: every control of the remote is reached by Tab in the order it is seen (the TV, the account, the box for a link, the filters, the rows, then the four places); a key shows a ring on every one of them (a finger shows none: `:focus-visible`); a sheet takes the focus in, keeps it inside and gives it back to what opened it, and a page takes it in; Back, Escape and the swipe-down close one layer at a time; the player's touch gestures (double tap, hold) have buttons that do the same (skip, the speed sheet); every target is 44 px or more on both paths held upright (the scan counts a hit area drawn past the picture); nothing is timed except the next-episode countdown, which has Cancel and Watch now.

#### Understandable
| # | Issue | WCAG | Severity | Recommendation |
|---|---|---|---|---|
| 6 | The box for a link has its words only as a placeholder (they go when typing starts); the field has an `aria-label` | 3.3.2 | Minor | A label that stays (in the old build too) |
| 7 | Two navigation models: the remote's bar is Home / Search / My Lists / You, the phone-as-screen's is Home / Search / Categories / My Lists | 3.2.3 | Minor | Left on purpose: they are two screens with two jobs; worth one look when a phone can be both |

#### Robust
| # | Issue | WCAG | Severity | Recommendation |
|---|---|---|---|---|
| 8 | Cards are named "Resume The Glass Orchard" / "Open Harvest Moon Motel" while the picture also prints "1 h 20 min left": the printed words are not all in the name (axe `label-content-name-mismatch`: 161 nodes on 44 screens; 884 on 78 before) | 2.5.3 | Minor | Put the card's note in its name ("Resume The Glass Orchard, 1 h 20 min left") |
| 9 | The TV's sheet holds a second `nav` landmark with no name next to "Main navigation" | 1.3.1 | Minor | Name it |
| 10 | The TV chip's name did not begin with its words, and the speed and audio choices were lists with no name (axe, 4 screens): **fixed** (the chip says "TV 4F2A TV connected, TV menu": the words that are on it first; each list has its label) | 2.5.3, 4.1.2 | fixed | (done) |

### Color Contrast Check

| Element | Foreground | Background | Ratio | Required | Pass? |
|---|---|---|---|---|---|
| Words on a button in the accent (red, blue, purple) | #fff | #e50914, #2772e5, #8e54ea | 4.79, 4.54, 4.56 | 4.5:1 | yes |
| The same on green, orange, pink | #111 | #1fb86a, #ff8a1f, #ff4f9a | 7.30, 8.01, 6.15 | 4.5:1 | yes |
| The accent as a ring or line, on the page | the six accents | #0b0b0c | 4.10 (red), 4.33, 4.32, 7.61, 8.34, 6.41 | 3:1 | yes |
| The accent as a ring or line, on a card | the six accents | #17171a | 3.73 (red), 3.94, 3.92, 6.92, 7.59, 5.82 | 3:1 | yes |
| The bar's words | #9b9ba3 (muted) | #1c1c20 | 6.16 | 4.5:1 | yes |
| Muted text on the page, on a card, on a raised card | #9b9ba3 | #0b0b0c, #17171a, #232328 | 7.13, 6.48, 5.67 | 4.5:1 | yes |
| Muted text on a sheet's row, and on its raised row | #9b9ba3 | #25252a, #2e2e34 | 5.53, 4.89 | 4.5:1 | yes |
| The open place's icon | #f5f5f7 | its accent tint (30% over the bar) | 8.8 to 12.4 | 3:1 | yes |
| "Up next" `5s` | #e50914 | #17171a | 3.73 | 4.5:1 | **no** (finding 1) |
| A sheet's row's small words while it is pressed | #9b9ba3 | #3a3a42 | 4.08 | 4.5:1 | **no** (finding 2) |

### Keyboard Navigation (the remote, held upright, a keyboard attached)

| Element | Tab order | Enter / Space | Escape | Arrow keys |
|---|---|---|---|---|
| The TV chip | 1st | opens the TV's sheet | - | not used |
| Account or Sign in | 2nd | opens the account | - | not used |
| The box for a link, Paste | 3rd, 4th | Enter plays the link; Paste reads the clipboard | - | not used |
| Filters (All, Movies, ...) | one stop each | picks | - | not used |
| A poster, and its "+" | two stops, the poster first | opens its page / puts it in a list | - | not used |
| The four places | the last four (Shift+Tab from the end: You, My Lists, Search, Home) | goes there; the one it is on says `aria-current` | - | not used |
| A title's page | focus goes in (Back first), stays in | Play, lists, rating | closes it | not used |
| A sheet | focus goes in, wraps inside, goes back to what opened it | picks a row | closes it | not used |
| The phone used as the screen | the TV's own D-pad: the arrow keys move between tiles by where they are on the screen, Enter picks, Back/Escape goes back | | | the TV's |

### Screen Reader (the accessibility tree of the live page; nobody listened)

| Element | Announced as (role, name) | Issue |
|---|---|---|
| The TV chip | button "TV 4F2A TV connected, TV menu" | none |
| The bar | navigation "Main navigation": buttons Home, Search, My Lists, You; the open one `aria-current="page"` | none |
| The TV's sheet | dialog "TV 4F2A", heading level 2, button "Close", "Connected", a navigation (Watch party, My TVs), buttons | the navigation has no name (finding 9) |
| A title's page | dialog "Shelf 1 film 1", button "Back", heading level 2, "2000 · Movie", button "Play", button "Add to Favourites", region "Your rating" | none |
| A card | button "Resume The Glass Orchard" | the time left is printed, not in the name (finding 8) |
| Speed, audio and the other choices | listbox with its name; each row an option | none (they had no name) |
| The mini remote | button "Open the remote: <title>", button Pause / Play | none |

### Priority Fixes

1. **The phone used as the screen held sideways or on a tablet** (finding 3): affects anyone with a phone on its side or a tablet, who press targets of 24 px.
2. **The card's name carries its note** (8) and **the countdown's colour** (1): one line each, for voice control and low vision.
3. **A visible label on the box for a link** (6), **a name for the second navigation** (9), **the pressed state's grey** (2).

## Design critique

**What was critiqued:** the final build, in the pictures of the walk (the remote at 390 x 844 and 320 x 568: home, search, My Lists, You, a film's page, a series' page, the TV's sheet, speed, audio, subtitle style, the full remote, the mini remote; the phone used as the screen at 390 x 844 and 320 x 568: home, search, a film's page, the profile, the player, its menus, "Up next"). **Stage:** refinement, a candidate for a hand test. Words from the blind reviewer are in the section after this one.

### Overall impression
It reads as a phone app now, and not as the TV in a column: one bar of four places, the TV as a single chip, posters standing upright with the next one peeking, a title as a page with a full-width red Play. The biggest opportunity is the two places that are correct but plain: the title's page (half of it is empty below the synopsis) and the phone-as-screen's player (its buttons take a third of a small screen while they are up).

### Usability
| Finding | Severity | Recommendation |
|---|---|---|
| The phone used as the screen, held sideways or on a tablet, is the TV's layout still: small rail icons, a 24 px speed button | Critical (for that shape) | Design its rail and rows (the first thing in "what is left") |
| The player's controls on the phone used as the screen: the transport row, two rows of buttons and the three bare icons (sound, full screen, stop) cover a quarter to a third of a 568 px screen while they are up; the three icons have no words | Moderate | Words (or a long-press label) for the three; fold "Source" and "Watch party" into one "More" when the screen is short |
| Two bars of navigation (remote and screen) with different fourth places | Moderate | Look at it again when one phone is both |
| A title's page has Play in the first screen and then empty space: a title has only a year and a kind to show | Minor | Nothing to add until the catalogue has more (cast, "more like this") |
| A series' page puts the show's rating and a season's rating, both rows, before the first episode | Minor | The episodes first, the ratings after them |
| Search on the phone used as the screen is one grey line before you type ("Type a title to search"); the remote lists what is popular | Minor | The same list on both |
| The "+" and the "x" on a card's art are 32-36 px drawn (44 px hit area): they crowd the card's corner | Minor | Fine for a thumb; look at them on real artwork |

### Visual hierarchy
- **What draws the eye first:** the TV chip (white name, green dot) on the remote's home, then the first card's picture: right, since "is it connected" and "what was I watching" are the two questions. On a title's page: the red Play, the only saturated thing on the screen.
- **Reading flow:** top bar, the link box, Continue watching, the filters, the rows: one column, one eye path; a row's head (18 px bold) and its "See all" (grey, on the right) are clearly a pair.
- **Emphasis:** the accent is spent in three places: Play, the open place of the bar (a pill), a chosen filter (a ring). Nothing else is red but a progress line and a score star.

### Consistency
| Element | Issue | Recommendation |
|---|---|---|
| "My lists" on the bar and "My Lists" on the button | **fixed** (a capital L: bar, README, docs) | - |
| Back: a round button on a picture (a title's page), a chevron in the bar (the remote) | each fits its place | keep |
| Filters: the remote's and the phone-as-screen's sections look the same (44 px pills, a ring on the chosen) | consistent | - |
| Corners: 8, 12 and 22 px from three tokens; the sheet's top corners are the largest | consistent | - |
| Type: 12 (the bar's four words), 14, 16, 18, 24, 32 | consistent; no 13 left | the tokens are in px (see "what is left") |

### Accessibility
Contrast, targets and the keyboard: the review above. Readable at 320 px with no cut word in English, Romanian and Italian.

### What works well
- The bar and the chip: every place is one tap from every other, and the TV is always one tap away.
- Posters in rows with the next one peeking: that is the sign that a row scrolls, and it needs no arrow.
- Sheets that leave the page they were opened from in view (70% at most), and a title and an account that are pages and not sheets.
- The player's controls in rows a thumb can find, with Play in the middle of the skips.
- Nothing slides sideways, nothing is cut off, at any of the six sizes.

### Priority Recommendations
1. **Design the phone used as the screen held sideways and on a tablet.** It is the one shape still as it was.
2. **The phone-as-screen player: words for the three bare icons, and a shorter block.** It is the screen people will look at most.
3. **A hand test on a real phone with a notch and a soft keyboard**, before anything else is polished: what a desktop browser cannot show is the part most likely to be wrong.

## Design system notes (as built)

**Tokens** (`polish/phone.css`, `shell.css`, `tv-phone.css`; colours, radii and the eased curve are the app's own, not new):

| Token | Value | For |
|---|---|---|
| `--bar-h`, `--top-h`, `--mini-h` | 56 px | the bar at the foot, the top bar, what plays above the bar |
| `--tap` | 48 px (44 px on the phone used as the screen) | what a thumb lands on; 44 px is the floor everywhere |
| `--rail-w` | 72 px | the bar as a rail on a screen on its side (the remote) |
| `--pad` | 16 px (20 px sideways) | the page's side margin |
| `--poster-w` | fluid, 88 to 132 px (a third of the width less the next poster's peek); 120 px sideways | an upright poster (2:3) |
| `--shell-bottom`, `--mini-room` | the bar and the safe area; what plays above it | the page's foot padding, the toast's place, the room kept for focus |
| `--p-fs-0 .. 6` | 12, 14, 14, 16, 18, 24, 32 px | 12 only for the bar's four words; 16 for body (it stops a phone zooming into a field) |
| `--p-r-1 .. 3` | 8, 12, 22 px | small things, controls and cards, what rises from the edge |
| layers | top bar 20, link status 15, bar 30 | |
| motion | sheet 0.24 s, backdrop 0.18 s, page 0.22 s, `cubic-bezier(.2,.8,.2,1)` | all collapse under reduced motion |

**Components built** (plain React and CSS, no library): `TabBar` (a bar of four, a rail sideways; `nav`, `aria-current`), `TvChip` (one button: the TV's name over how it is doing; its name starts with those words), `MiniRemote` (what plays, above the bar; opens the full remote), `Page` (a title or a row, over the whole screen, with Back), `RowPage` ("See all": a grid that loads more), `Sheet` (70% of a tall screen, 78% of a short one, a side sheet sideways; a named list for choices), the upright poster `Card`, the filter chips, the phone-as-screen's bar and section buttons (`Browse.tsx`, `Rail.tsx`) and the player's rows (`tv-phone.css`). Their states are listed in `PLAN.md`; the specs and the pictures cover default, open (`aria-current`), pressed and keyboard focus (a ring, only for a key).

**Copy** (`design:ux-copy`): sentence case, a verb first, one word for one thing. The names on the bar are Home, Search, My Lists, You (Acasă, Caută, Listele mele, Tu; Home, Cerca, Le mie liste, Tu); "See all" (Vezi toate, Vedi tutto); the chip says what the TV is doing in words, never by a colour alone. `i18n.test.ts` keeps en, ro and it equal. "My Lists" has a capital L because the TV's rail and the title's button already say so.

**Where the system is thin** (a system audit, honestly): there is no shared button component (each screen has its class); the phone's type tokens are in px and not rem; the same names (`--tap`, `--rail-w`) mean two things on the remote and on the phone used as the screen; and two navigation models.

## A fresh pair of eyes: the blind review

One fresh subagent was given **18 pairs of unlabeled pictures** (the remote: home, search, a film's page, a series' page, the TV's menu, the account, playing, speed, and a 320 px home and film page; the phone used as the screen: home, search, a film's page, the profile, the player, its audio menu, and a 320 px home and player). Which side was the old layout and which the new was random per pair and kept in a private file until the answers were in; the reviewer saw only the pictures (no code, no docs, no program), scored each side 1-10 on five things, and listed the ten worst problems of the better design.

| | Readability | Tap ease | Room | Structure | Phone-app feel |
|---|---|---|---|---|---|
| New layout (mean of 18) | 8.4 | 8.0 | 6.7 | 8.2 | 7.9 |
| Old layout (mean of 18) | 6.8 | 5.4 | 5.0 | 5.4 | 4.9 |

**The new layout was preferred in 16 pairs, equal in 2 (the signed-out account page, the speed sheet), the old one in 0.** Scores are subjective and good to about plus or minus 1; the reviewer said so too, and said what a still picture cannot show (real hit areas, gestures, the soft keyboard, safe areas, screen readers, real artwork).

The reviewer's ten worst problems of the new design, and what became of each:

| # | Problem named | What happened |
|---|---|---|
| 1 | The player's controls on the phone used as the screen cover a quarter to a third of a small screen; the Play circle was left of the skip buttons | **Fixed in part**: the first row now reads back 10 - Play - forward 10 (Play in the middle). The block's height and the unlabeled icons in the second row are left (see below). |
| 2 | Two navigation models (Home / Search / My Lists / You on the remote; Home / Search / Categories / My Lists on the phone used as the screen) | Left on purpose. |
| 3 | Small round "+" and "x" buttons on artwork | Left: drawn 32-36 px, hit areas 44 px (the scan counts them), the "x" has a name ("Remove from Continue watching"). |
| 4 | A series' page puts the episodes last, with two rating rows before them | Left. |
| 5 | A title's page: Play in the upper half, half the page empty | Left: the title carries only a year and a kind, so there is nothing more to put there. |
| 6 | The remote while playing: thin seek bar, Stop as heavy as Full screen, no volume | Left (no volume in the protocol, R15). |
| 7 | The TV chip's sheet holds a lot | Left. |
| 8 | A header on every screen, a "Sign in" pill above the sign-in form, the chip loses its chevron at 320 | Left. |
| 9 | Search is thin (one grey line on the phone used as the screen) | Left. |
| 10 | Duplicated labels, and "My lists" on the bar vs "My Lists" on the button | **The capital L was fixed** (bar, README, docs); the posters in the made-up catalogue print their title in the art, real artwork will not. |

## What is left, and what I would do first

Left **on purpose** (a choice, not an oversight; each can be vetoed):

- You are "You" (the fourth place) and the profile picture stays in the top bar as well; the TV chip replaces the "..." menu; the box for a link stays on Home (not moved to Search); there is no hero card; "Change video" folds the remote away instead of opening a sheet; on the phone used as the screen the sections (Movies, Series, Cartoons, Anime) are buttons over the titles and no longer items of the rail.
- A title's page has half a page of nothing under the synopsis: a title has only a year and a kind to show.
- **No volume** (R15): the protocol has none.
- **No filter chips on search results** (R6): the library cannot tell a cartoon from an anime in a result.
- **A sheet's first height is not 50%** (R9): 70% of a tall screen, 78% of a short one. At 320 x 568 six speeds do not fit in 284 px, and a sheet that scrolls to show them is worse than a taller one.

**Not done**, in the order I would do it:

1. **The phone used as the screen held sideways, and on a tablet** (the biggest hole). Its pictures and numbers are the old ones: 12.5 px smallest text, a 24 px speed button, 106 of 145 targets under 44 px at 844x390 (108 of 198 at 768x1024). The plan promised 44 px rail items there; ten of them do not fit 390 px, so it needs a design (two columns of icons? the bottom bar at a lower height?), not a stylesheet line.
2. **A hand test on real phones** (an Android in Chrome, an iPhone in Safari): the bars with a notch and a home bar, a soft keyboard with the fixed bar, the feel of the sheet's pull and the player's gestures.
3. **The phone-as-screen player**: its controls cover a quarter to a third of a small screen while they are up, and three of them (sound, full screen, stop) are bare icons. Words for them, and a shorter block (fold "Source" and "Watch party" into one "More").
4. **Cards named with their note** ("Resume The Glass Orchard, 1 h 20 min left": 161 axe nodes), the `5s` of "Up next" in the lighter text colour, a pressed row's grey, a visible label for the box for a link, a name for the TV's second `nav`: small, one line each.
5. The subtitle-style sheet is still 91% of the screen's area sideways (it shows a sample line, which needs the width); a series' page has two rating rows before the first episode; search on the phone used as the screen has an empty state of one grey line; the two navigation models.
6. The type tokens in `rem` (they are px), and the same names (`--tap`, `--rail-w`) meaning two things on the two paths.
7. Three small notes of the simplify pass, none of them behaviour: the poster tile is not memoised, which key closes first when a title's page lies over a sheet (Escape), and a table in the D-pad's code that mirrors the CSS's list of controls.

## What was NOT verified

Said plainly, because everything above is from a desktop browser:

- **No real phone.** Nothing ran on an Android phone, an iPhone, in Samsung Internet or in Safari, and nothing ran on a Fire TV (Silk or an APK's WebView) or any TV browser. Everything was Chromium under Playwright, with a phone's size, a touch screen and a phone's user agent. Firefox and WebKit were not run.
- **Safe areas are always 0 there.** The notch, the home bar and rounded corners (`env(safe-area-inset-*)`, `viewport-fit=cover`) were never exercised: the bar pads by the bottom inset and the top bar by the top one, and that is untested.
- **The soft keyboard and the fixed bar.** Whether the bar rides up over the keyboard, or hides under it, depends on the browser; not tried. Nor was the browser's own bar folding away as the page scrolls.
- **Touch as a hand feels it**: latency, momentum, the sheet's pull to close, the player's tap, double tap and hold were driven by scripts (and pass); how they feel was not judged.
- **Hit areas** are judged by the scan's box (and the hit area some buttons draw past their picture), not by a finger.
- **Screen readers**: the roles and names were read from the browser's own tree. Nobody used TalkBack, VoiceOver or NVDA.
- **The system's font size, text spacing and zoom beyond the 320 px reflow**: the phone's type is in px; whether a large system font breaks a layout was not tried.
- **Real artwork and a real library.** The pictures are made-up (flat colours with a title printed in them); real posters and a library of thousands of titles and a slow network could change how legible the "+", the score and the badges are, and how "See all" pages in.
- **The cat companion** was checked by its own 43 tests only (they pass on the new shell); nobody looked at it on the new pages.
- **Two shapes** of the phone used as the screen are not built (sideways, tablet): there is nothing to verify there.
- **The Android Back button** was driven as `history.back()` in the e2e (`android-back`, `remote-back`), not with the system's gesture or button.
- **The reviewer's scores** (above) come from pictures alone, and are good to about plus or minus 1.
