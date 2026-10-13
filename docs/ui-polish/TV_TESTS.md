# TV acceptance tests

The TV is driven the way a remote drives it: arrow keys, OK (Enter) and Back (Escape). Everything below runs in Chromium at 1280x720 (and 1920x1080 for the pictures), once per look (`classic`, `polish`). A browser is not a television: the last section is the short list the owner can run on a real set.

## 1. The keys walk (the automated part)

`scripts/ui-walk/tv-keys.mjs`, part `tv-keys` of the walk runner. For each screen below it starts a fresh guest, presses the keys from the library's first screen, and then checks **what the remote is on**: something is focused, it matches `:focus-visible` (it shows), and it is on the screen. A screen where one of those is not so is a FAIL: a remote has nothing to press there. It also takes a picture of the screen and writes what was focused into `focus.txt` beside the pictures.

```bash
bash scripts/ui-walk/iter.sh polish tv-keys all      # build to a private folder, walk every screen, refined look
bash scripts/ui-walk/iter.sh classic tv-keys all .ui-polish/iter/classic
```

Key words: `L R U D` = the arrows, `OK` = Enter, `B` = Escape, a number repeats (`3R`). Both looks reach the same control on all 20 screens (the colour screen lands on a different swatch: the refined settings page is laid out differently; both are a colour).

| Screen | Keys from the library | The remote ends on |
|---|---|---|
| home | (none) | the first title |
| home-next-tile | `R` | the next title |
| home-banner | `U` | the banner's Resume |
| home-top | `2U` | the account chip (top bar) |
| rail | `L 2D` | Series, in the open menu |
| detail | `OK` | the title page's Play / Resume |
| detail-list | `OK R` | Add to a list |
| detail-series | `L 2D OK OK 2D` | an episode of a show |
| search | `L U OK 2D R` | a key of the search keyboard |
| rate | `OK 2R OK` | a score on the rating page |
| rate-low | `OK 2R OK 4L` | a lower score |
| profile | `L 7D OK` | the first card of the profile hub |
| settings | `L 7D OK 3R OK` | Sign in |
| settings-language | `... R 3U L` | English (chosen, and the remote on it) |
| settings-colour | `... R 2U` | a colour swatch |
| settings-switch | `... R 5D` | a switch row (Rate what I watch) |
| party | `L 5D OK` | Start a party |
| connect | `L 6D OK D` | Back to the library |
| player | (a playable title: OK, OK, then `D` to show the controls) | the pause button of the controls |
| player-menu | (as player) `3R OK` | the chosen row of the speed menu (1×, Normal) |

## 2. The plan's list, and how each line is covered

| Check (master plan, section 17) | Automated | By picture or measurement | Status |
|---|---|---|---|
| Focus is always visible | keys walk: `:focus-visible` on all 18 screens | blind focus jury (`focus1`, pictures from this walk) | refined and classic pass; one refined weakness found and fixed (chosen **and** focused looked like chosen: now light with the accent ring) |
| Focus order is intuitive; movement matches the layout | `e2e/tv-screens.spec.ts` (rows, banner, title page, seasons and episodes), `e2e/remote-back.spec.ts` | keys-walk pictures, one per key route | covered |
| Focus never disappears | keys walk (after each route); the drift scan lists any picture with nothing focusable focused | | **open, both looks**: pages that wait (Connect a phone, a party waiting for a code) have nothing focused until a first arrow key (audit E05) |
| Focused cards do not clip | keys walk: the focused control is on the screen | the pictures, by eye (the ring and the lift of a tile on the last row, the first and the last tile of a row) | covered by eye; no automatic check of clipping by a parent |
| Focused cards stay distinguishable on bright artwork | | the walk's drawn posters include bright ones; the ring is white with a page-coloured gap, so it separates from any picture | covered by design; confirm on a real set |
| Scrolling keeps focus comfortably in view | keys walk (`on screen`) | `e2e` "a row scrolls along...", "the page stays put" | covered |
| The user can tell where they are without a pointer | | rail accent bar plus light item; title page; focus jury | covered |
| Destructive actions are not too easy to trigger | `e2e` (a list is deleted only after a question) | | **open**: "Remove from Continue watching" is one press, with no undo (U07; owner question) |
| Dialogs have predictable entry and exit focus | `e2e/tv-screens.spec.ts` (menu close button, Back one step out), `e2e/remote-back.spec.ts` | | covered |
| Large screens do not become sparse | | 1920 and 2560 pictures (`--em` is 1% of the width, so everything scales); drift scan | covered |
| Text is readable from a distance | a guard test keeps the small text of the TV above its floor | the refined type scale (`--fs-1..7`) and the drift scan's smallest text per screen | covered |
| Nothing important sits close to the screen edge | | drift scan: text and controls inside 2.5% of the left or right edge or 5% of the top or bottom are listed (rows that scroll past the edge are not); the refined look keeps controls 5% in from the right (`--edge-r`) | covered; check overscan on a real set |

## 3. What these tests found so far

| # | Finding | Where | Fix |
|---|---|---|---|
| T-1 | A chosen option the remote is on (the language the TV already speaks, a chosen score) looked almost like the same option unfocused: tint and a slightly heavier ring. | refined only | the remote's light (white, dark words) always wins; the accent ring of "chosen" stays inside it |
| T-2 | The caption of the control the remote is on (a player icon button says its name while focused) was drawn exactly over the elapsed or remaining time: with the remote on Play, the elapsed time could not be read. | both looks | the caption is drawn above the progress row (`tv/tv.css`, `.hud-controls ... ::after`) |
| T-3 | Pages that wait have nothing focused (E05); the welcome's button is drawn as chosen but is not focused (E19). | both looks | in the both-looks bug batch (behaviour, not styling) |

## 4. On a real television (manual, about ten minutes)

Browser automation proves the logic and the look in Chromium; it does not prove a particular set's browser, remote or overscan. On the Hisense (and, when there is one, a Fire TV stick or a Samsung/LG set):

1. Open the TV address (`/tv`); the library shows under a short welcome that goes by itself. Is anything cut off at the edges? (If yes, switch the set's picture mode to a "Direct" / "Just scan" / "Full pixel" mode and look again.)
2. With the remote only: move through the menu, a row, a title page and back (Back = one step out). Does the highlight ever vanish?
3. Settings > Look: switch Classic and Refined; the screen changes at once, and the choice is still there after a restart.
4. Sit at the sofa: can you read the smallest text (a title's year and length, the player's clock) without leaning forward?
5. Open a title, press OK twice to play: do the controls show on a press, and is the time readable while the remote is on Play?
6. Choose a language and a colour: is the chosen one clear, and the one the remote is on clear, when they are the same one?
7. Open the search keyboard: is the key under the remote easy to follow when you move fast?
8. Pair a phone: the code and the QR are readable from the sofa, and the phone scans it.
9. Anything that looks different on the set from the pictures in this folder: write it down with the screen and the look.
