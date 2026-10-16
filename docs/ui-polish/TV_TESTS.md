# TV acceptance tests

The TV is driven the way a remote drives it: arrow keys, OK (Enter) and Back (Escape). Everything below runs in Chromium at 1280x720 (and 1920x1080 for the pictures). There is one look (D18), so there is one pass. A browser is not a television: the last section is the short list the owner can run on a real set.

## 1. The keys walk (the automated part)

`scripts/ui-walk/tv-keys.mjs`, part `tv-keys` of the walk runner. For each screen below it starts a fresh guest, presses the keys from the library's first screen, and then checks **what the remote is on**: something is focused, it matches `:focus-visible` (it shows), and it is on the screen. A screen where one of those is not so is a FAIL: a remote has nothing to press there. It also takes a picture of the screen and writes what was focused into `focus.txt` beside the pictures.

```bash
node scripts/ui-walk/run.mjs --only=tv-keys                    # builds the client, walks every screen
node scripts/ui-walk/run.mjs --only=tv-keys --steps=keys-settings   # only the Settings routes
bash scripts/ui-walk/iter.sh polish tv-keys all                # the same on a private build (dist/client is left alone); the first word only names the folder
```

Key words: `L R U D` = the arrows, `OK` = Enter, `B` = Escape, a number repeats (`3R`). The routes are the ones in the `SCREENS` list of `tv-keys.mjs`: a route that no longer lands on something lit is a regression, and a layout that moves a control (the Settings page did, when it became three grouped columns) changes the keys of the routes below it, so the list is kept next to the layout it walks.

An arrow goes to what is nearest in that direction: Right of "Sign in" is the first colour, level with it; the language row is above the colours, the switches below.

| Screen | Keys from the library | The remote ends on |
|---|---|---|
| home | (none) | the first title |
| home-next-tile | `R` | the next title |
| home-banner | `U` | the banner's Resume |
| home-top | `2U` | the profile button in the corner (says "Sign in" for a guest) |
| rail | `L 2D` | Series, in the open menu |
| detail | `OK` | the title page's Play / Resume |
| detail-list | `OK R` | Add to a list |
| detail-series | `L 2D OK OK 2D` | an episode of a show |
| search | `L U OK 2D R` | a key of the search keyboard |
| rate | `OK 2R OK` | a score on the rating page |
| rate-low | `OK 2R OK 4L` | a lower score |
| profile | `2U OK` | Sign in (the profile page of a guest) |
| profile-settings | `2U OK R` | the page's Settings button, in its own corner |
| profile-card | `2U OK D` | the first card of the profile page (My ratings) |
| settings | `2U OK R OK` | Sign in, the first control of the Settings page |
| settings-colour | `2U OK R OK R` | the first colour (Red) |
| settings-colour-next | `2U OK R OK 2R` | the next colour (Blue) |
| settings-language | `2U OK R OK R U` | English (the chosen language, and the remote on it) |
| settings-playback | `2U OK R OK R U 3R` | the first switch of the third column (the next episode plays by itself) |
| settings-switch | `2U OK R OK R D` | a switch of the middle column (Rate what I watch) |
| settings-back | `2U OK R OK U` | Back, the pill in the page's corner |
| party | `L 5D OK` | Start a party |
| connect | `L 6D OK D` | Copy code |
| player | (a playable title: OK, OK, then `D` to show the controls) | the pause button of the controls |
| player-menu | (as player) `3R OK` | the chosen row of the speed menu (1×, Normal) |

25 screens; the pictures are `tv-1280-keys/keys-<screen>.png`. On 2026-10-16 all 25 pass.

## 2. The plan's list, and how each line is covered

| Check (master plan, section 17) | Automated | By picture or measurement | Status |
|---|---|---|---|
| Focus is always visible | keys walk: `:focus-visible` on all 25 screens | blind focus jury (`focus1`, pictures from this walk) | passes; one weakness found and fixed (T-1: chosen **and** focused looked like chosen: now light with the accent ring) |
| Focus order is intuitive; movement matches the layout | `e2e/tv-screens.spec.ts` (rows, banner, title page, seasons and episodes), `e2e/remote-back.spec.ts` | keys-walk pictures, one per key route | covered |
| Focus never disappears | keys walk (after each route); the drift scan lists any picture with nothing focusable focused | | **open**: pages that wait (Connect a phone, a party waiting for a code) have nothing focused until a first arrow key, which then lands on the first control (audit E05) |
| Focused cards do not clip | keys walk: the focused control is on the screen | the pictures, by eye (the ring and the lift of a tile on the last row, the first and the last tile of a row) | covered by eye; no automatic check of clipping by a parent |
| Focused cards stay distinguishable on bright artwork | | the walk's drawn posters include bright ones; the ring is white with a page-coloured gap, so it separates from any picture | covered by design; confirm on a real set |
| Scrolling keeps focus comfortably in view | keys walk (`on screen`) | `e2e` "a row scrolls along...", "the page stays put" | covered |
| The user can tell where they are without a pointer | | rail accent bar plus light item; title page; focus jury | covered |
| Destructive actions are not too easy to trigger | `e2e` (a list is deleted only after a question; a profile too) | | **open**: "Remove from Continue watching" is one press, with no undo (U07; owner question) |
| Dialogs have predictable entry and exit focus | `e2e/tv-screens.spec.ts` (menu close button, Back one step out), `e2e/remote-back.spec.ts` | | covered |
| Large screens do not become sparse | | 1920 and 2560 pictures (`--em` is 1% of the width, so everything scales); drift scan | covered |
| Text is readable from a distance | a guard test keeps the small text of the TV above its floor | the type scale (`--fs-1..7`) and the drift scan's smallest text per screen | covered |
| Nothing important sits close to the screen edge | | drift scan: text and controls inside 2.5% of the left or right edge or 5% of the top or bottom are listed (rows that scroll past the edge are not); controls keep 5% in from the right (`--edge-r`) | covered; check overscan on a real set |
| The mouse reaches what the remote reaches | `e2e/mouse-rows.spec.ts` (an arrow at each end of a row that runs off the screen), `e2e/player-touch.spec.ts` (click, double click, hold, the dot dragged) | | covered |

## 3. What these tests found so far

| # | Finding | Where | Fix |
|---|---|---|---|
| T-1 | A chosen option the remote is on (the language the TV already speaks, a chosen score) looked almost like the same option unfocused: tint and a slightly heavier ring. | refined layer | the remote's light (white, dark words) always wins; the accent ring of "chosen" stays inside it |
| T-2 | The caption of the control the remote is on (a player icon button says its name while focused) was drawn exactly over the elapsed or remaining time: with the remote on Play, the elapsed time could not be read. | TV player | the caption is drawn above the progress row (`tv/tv.css`, `.hud-controls ... ::after`) |
| T-3 | Pages that wait have nothing focused (E05); the welcome's button is drawn as chosen but is not focused (E19). | | behaviour, not styling: E19 fixed, E05 still open (see the table above) |
| T-4 | After Settings became three grouped columns the old keys of the walk landed on other controls (Right of "Sign in" is a colour, not the language). | `tv-keys.mjs` | the routes were renamed and three added (`settings-colour-next`, `settings-playback`), so each column has a landing |
| T-5 | The profile editor's title was centred on the page while its fields started a hand's width to the left of that: a title nearly, but not, over the field it names. | TV, New / Edit profile | the title is in the form's own grid, over the fields |

## 4. On a real television (manual, about fifteen minutes)

Browser automation proves the logic and the look in Chromium; it does not prove a particular set's browser, remote or overscan. On the Hisense (and, when there is one, a Fire TV stick or a Samsung/LG set):

1. Open the TV address (`/tv`); the library shows under a short welcome that goes by itself. Is anything cut off at the edges? (If yes, switch the set's picture mode to a "Direct" / "Just scan" / "Full pixel" mode and look again.)
2. With the remote only: move through the menu, a row, a title page and back (Back = one step out). Does the highlight ever vanish?
3. From the first row press Up twice: the profile button in the corner is lit. OK opens the profile's page; Right goes to its Settings button; OK opens the three columns of settings. Does Back go one step out each time (settings, profile page, library)? Is anything of the Settings page cut off at the bottom?
4. Open the side menu (Left from the first title): the name KINO stays where it was and the panel does not cut "Connect a phone" off; try the language set to Italian and to Romanian.
5. Sit at the sofa: can you read the smallest text (a title's year and length, the player's clock) without leaning forward?
6. Open a title, press OK twice to play: do the controls show on a press, and is the time readable while the remote is on Play?
7. Choose a language and a colour: is the chosen one clear, and the one the remote is on clear, when they are the same one?
8. Open the search keyboard: is the key under the remote easy to follow when you move fast? Type a word, press the ◀ key under the letters: does the caret move between the letters, and does a letter typed next go there?
9. Pair a phone: the code and the QR are readable from the sofa, and the phone scans it. The code can be selected, and Copy says it copied.
10. On a slow connection the pictures of titles come in late: they should fade in (an old set may show them at once, which is fine).
11. If the set has an air mouse (or you use a computer on the TV): the arrows at the end of a row, a click on a picture to pause and play, a double click on the left or right half to skip ten seconds, the dot of the progress bar dragged.
12. Anything that looks different on the set from the pictures in this folder: write it down with the screen.
