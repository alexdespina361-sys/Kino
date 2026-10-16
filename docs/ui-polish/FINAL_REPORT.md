# Final report: the UI polish

Branch `ui/polish-system` (cut from `cde1d7f`, `main` merged in once), 2026-10-13 to 2026-10-17. Written for the owner and for whoever touches the interface next: what changed, what is better and how that was checked, what was left, and the rules that keep it that way.

**In one paragraph.** The site has **one** look now (no toggle). It is the refined one: a small set of sizes, surfaces, corners and one curve, a focus language that reads from the sofa on every surface, and lists and settings grouped by kind instead of ten alike buttons in a row. The profile left the TV's menu and became the corner button, whose page has Settings in its own corner; every page that fills the screen has the same quiet Back in the same place; codes can be copied; the search box is text with a caret; the player answers a mouse the way it answers a finger. No feature was added beyond the owner's list and its general ask that menus and lists work as well with a mouse and a keyboard as with a remote (the copy buttons, the caret keys, the mouse gestures and the arrows at a row's ends are that), and nothing changed in what plays or where it is looked up.

## 1. What changed

### The owner's list of 2026-10-16 (decisions D18 to D33 in [DECISIONS.md](DECISIONS.md))

| Asked for | Now | D |
|---|---|---|
| "update website looks with no toggle" | `<html data-ui="polish">` is in `index.html`; the Look chips, `?ui=`, the stored choice and the walk's `--ui` flag are gone; the older sheets stay underneath as the base layer | D18 |
| profile out of the sidebar; the corner profile opens a page with a settings button in an upper corner reachable by mouse, keyboard and remote | the menu has no profile line; the corner button opens the profile's page (ratings, friends, History) and that page has **Settings** (and, for a guest, **Sign in**) in its own corner; Settings is three columns (profile and account; appearance and sharing; playback), each group a name over one surface | D19 |
| group and format buttons and lists so that ten alike buttons in a row do not tire a reader | TV Settings: a language is three words in a row, a colour is dots, the rest are switches. Phone: the TV menu, Settings and the account's front page are cards by kind (places with a chevron; switches with what each does under the name; what takes something away, alone and last), with hairlines inside a card and space between cards | D19, D28 |
| the phone icon too narrow and tall | 13 × 18 with a 3 radius; the shut menu's lit box hugs its icon | D26 |
| "Connect a phone" too long for the panel; the name of the site hidden when the panel opens | the open menu is 10 px wider (27.8 em, room for the longest label in Romanian and Italian) and carries the wordmark in the same place and size, so the name never moves | D21, D24 |
| Back to library: weirdly high on one page, red on another, not on a third | one quiet pill in one corner, on the same right edge as the library's corner buttons, on every full-screen page; red is for what a page is for, and leaving it never is; Close on a title's page is the same pill | D20, D25 |
| the link code cannot be copied | a code is selectable text with a Copy button that says it copied (44 px beside a code) | D21, D32 |
| search: a mouse cannot place the caret; no ◀ ▶ for remote and keyboard; the keys wider than tall | a click puts the caret between letters; ◀ ▶ under the letters move it; Home, End and Delete on a keyboard; the keys are 1.1 : 1 | D22 |
| the video's progress dot cannot be dragged; double click ±10 s; hold for 2× | the dot is picked up and dragged; a double click on the left or right skips 10 s that way and goes on while clicks keep coming; the middle double click is full screen; a hold of 0.45 s plays at 2× until it is let go (not while paused, as a party's host, or when following) | D23 |
| "regulating sizes, shaders, shadows, focus effects, animations, colours" | seven TV sizes and six phone sizes, three corners each, solid surfaces that are higher by being lighter, one curve for everything that arrives, white-and-ring focus on the TV and an inset ring on the phone; blue and purple a little deeper so white words pass 4.5 : 1 | D12 to D17, D29, D30 |
| "naturalness and quality of assets" | late pictures fade in instead of popping; the home-screen icon fits Android's mask; a row that runs off the screen has arrows for a mouse | D27, D31 |

### Small things found on the way
A title in the profile editor that started 19 px off its fields; a main button that cannot be pressed yet (Save before there is a name) that looked like a dimmer red; the password eye with no ring when a keyboard is on it (UI-005); dead `.tv-panel` CSS and two unused text keys (D33 and the code).

### Underneath
* The refined layer is `src/client/polish/{base,tv,phone}.css`, every rule under `:root[data-ui="polish"]`, loaded last. `polish/polish.test.ts` fails the build on any CSS the oldest TV browsers (Chromium 68 to 76) do not know, and on a keyframe not named `polish-…`.
* The tokens are custom properties (TV: top of `polish/tv.css`; phone: top of `polish/phone.css`); no framework was added. [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) has every value and where it is used; [COMPONENT_INVENTORY.md](COMPONENT_INVENTORY.md) lists the families, how many places use each, and what is written twice.
* Tools that stay for the next round: the screenshot walk (`pnpm ui:walk`), the live-DOM scanner (`--scan`, then `pnpm ui:drift`), the pixel compare (`pnpm ui:compare`), and the keys walk (`tv-keys`, 25 screens: [TV_TESTS.md](TV_TESTS.md)).

## 2. The biggest visible improvements

1. **Settings fits, and reads.** The old signed-in Settings was taller than the screen (its first heading cut off, UI-001), and seventeen controls with nothing to tell one kind from another. It is three groups on one screen, with the language and the colour chosen the way a person thinks of them.
2. **Who is watching, and where Settings is.** The profile's page has the person's name and three cards (ratings, friends, History) and the Settings button at its top corner, instead of a line in the menu that did four jobs.
3. **The menu keeps its name.** The wordmark does not hide or jump when the menu opens; the menu is wide enough for every label; the shut menu's icons sit in even boxes.
4. **The focus is findable.** What the remote is on is lit white with dark words and a ring with a gap of the page's own colour; a picture gets the ring and the lift; a chosen thing keeps its accent ring inside the light. Blind juries put this focus language ahead of the old one while it was being shaped (25 / 7 / 8 in refined / old / tie once each kind of thing had its own treatment, 37 / 3 / 5 on whole screens); the last round was not a win (3 / 4 / 1, every verdict by a slight margin: the old look's larger button and thicker ring did a little better on Settings' main button and on the player menu's row), and those screens were not judged again ([DECISIONS.md](DECISIONS.md), D12). All six accents were measured for the ring.
5. **The search is a text box.** A caret, ◀ ▶, 1.1 : 1 keys, and the last row (◀ ▶ Space ⌫ ⊗) says what each does.
6. **The phone lists are cards by kind.** The TV menu sheet and the account's front page have three groups each instead of seven alike rows.

## 3. Before and after

"Before" is the walk of 2026-10-13 on the old look (the classic baseline, the site as it was when this started); "after" is the same walk today. Left is before, right is after.

| Screen | Picture |
|---|---|
| TV, library | [final/tv-home.jpg](final/tv-home.jpg) |
| TV, the menu open | [final/tv-menu.jpg](final/tv-menu.jpg) |
| TV, search | [final/tv-search.jpg](final/tv-search.jpg) |
| TV, the profile's page | [final/tv-profile.jpg](final/tv-profile.jpg) |
| TV, Settings | [final/tv-settings.jpg](final/tv-settings.jpg) |
| TV, connect a phone | [final/tv-connect.jpg](final/tv-connect.jpg) |
| Phone, the TV's menu | [final/phone-menu.jpg](final/phone-menu.jpg) |
| Phone, the account | [final/phone-account.jpg](final/phone-account.jpg) |

The pictures are not committed for the other ~170 screens (they are a walk away: `pnpm ui:walk`); the classic set stays on the owner's machine in `.ui-polish/shots/classic` (git-ignored).

## 4. What the pages use now

The live-DOM scanner measured every screen of the walk twice: on the old look on 2026-10-13 (152 screens, 32,127 elements) and now (180 screens, 37,166 elements: the walk has grown by the pages added since). Full tables: [drift/classic.md](drift/classic.md) and [drift/polish.md](drift/polish.md).

| Counted | Then | Now |
|---|---|---|
| TV: distinct type sizes | 31 | 21 |
| TV: distinct corner radii | 15 | 10 |
| TV: distinct text colours | 28 | 12 |
| TV: distinct surface colours | 31 | 28 |
| Phone: distinct type sizes | 26 | 15 |
| Phone: distinct surface colours | 21 | 27 |
| Text under its floor (TV 1.15 % of the width, phone 12 px) | 52 | 1 |
| Text with too little contrast | 17 | 0 |
| Phone controls under 44 px | 81 | 0 |
| TV text or controls inside the 5 % safe margin | 183 | 65 |
| Controls with no name | 17 | 22 |
| Text cut without an ellipsis; pages that scroll sideways; controls under 24 px | 0 | 0 |
| TV screens with nothing focused | 19 | 19 |

What did not get better, or is left, and why:

* **The TV's shadows read 45, now 60, and the phone's surface colours 21, now 27.** The shadow figure is how the scanner counts (it counts pixel values, so one ring at two screen sizes is two values: the old look's tile ring alone is five values in its report). The phone figure is real: the cards add a tone for a card on a sheet and for a lifted button, which a later round can merge into the three surfaces.
* **Controls with no name: 17 text boxes and the row arrow, listed once for each of the five screen sizes.** The 17 are the same text boxes as before, named by their placeholder, which the scanner does not count. The arrow is the mouse-only button at a row's end, hidden from keyboards and screen readers on purpose because the titles themselves are reached in order (D27).
* **The one small text** is the sample line of the subtitle-size preview, small on purpose.
* **65 inside the safe margin** (183 before; each size and place is counted once): the rail's boxes, which begin 1.8 % from the left (the icon sits a little further in); the top bar's corner buttons, the bell's count and the Back or Close pill, which stand 4.7 % from the top (the right edge is 5.0 %); the mouse arrow at a row's end, 1.4 % from the right edge; and pages that are scrolled to their end (the season pills and the pause button near the bottom edge). On a set that crops more than 2 to 3 %, this is the list to check first ([TV_TESTS.md](TV_TESTS.md)).
* **19 screens with nothing focused, and 5 with no key-reachable control,** are the same pictures as before: the pages that wait (the sign-in code, Connect a phone) and the walk's pictures of the player, where the controls are up from a mouse move or hidden. The keys walk reaches the player and every other screen by keys (section 7).

## 5. Tools used

| Tool | For |
|---|---|
| Playwright (the e2e suite, the screenshot walk, ad hoc scripts) | every check of behaviour and look |
| `pixelmatch` + `pngjs` | `pnpm ui:compare`: what differs between two walks |
| The live-DOM scanner and drift report | what the pages really use, and where they break the rules |
| `@axe-core/playwright` | an automatic accessibility check of 26 TV screens and the phone's (audit H) |
| Eight read-only audits and two flow audits, a blind jury | the 191-issue backlog ([ISSUES.md](ISSUES.md)), and the focus and phone-scale calls (D12, D16, D17) |
| The `frontend-design` skill | a direction for the one look so that it does not come out generic |
| A Claude Opus subagent, as the judge | a read-only review of the finished diff by a reader who had not written it: nine problems, one of them a real regression, all fixed (section 7) |
| Pillow | the before / after pictures |

## 6. Tools looked at and left out

Storybook (a second build for a plain-CSS app with a handful of context-dependent components); Tailwind or a token framework (the plan said no new one, and the custom properties exist); a dev-only lab page (planned, then not built: the walk shows every screen in its states); Figma and the other design connectors (they need the owner's authorisation, [REGISTRATION_BLOCKERS.md](REGISTRATION_BLOCKERS.md)); visual-regression services (they upload screenshots and need an account: the local compare does the job); Context7 (not installed, and nothing needed it). Codex was tried for the outside review and did not work out: `gpt-6.1-sol` was refused for this login (HTTP 400) and `gpt-5.6-sol` stopped on the ChatGPT usage limit; the owner had said to skip it if it took long, so the Claude Opus judge did the review instead.

## 7. How it was checked

On the final tree, after the fixes of the review below:

| Check | Result |
|---|---|
| `tsc --noEmit` (the client, the server and the tests) | clean |
| Unit tests (`vitest run`) | 76 files, 1,481 tests, all pass |
| End-to-end suite (Playwright, Chromium, one worker) | 530 tests: 527 passed in the full run (22 minutes); the 3 that failed are explained below and passed when their groups were run again (19 of 19) |
| The keys walk (a remote's arrow keys and OK only, 25 screens) | all 25 steps worked |
| The live-DOM scan of the screenshot walk (every screen, measured) | the TV at five sizes, signed in and out, the keys walk and the phone: 180 screens, 37,166 elements, no failed step; the totals are in section 4 |

**Tests changed or added.** The older specs follow the interface where it moved (no profile line in the menu: the corner button opens the profile's page and Settings is its button; Back in the corner; the Copy buttons in the keyboard's order; the speed sheet is tested on a 390 × 420 phone, because a window wider than tall counts as held sideways). New: `e2e/tv-corner.spec.ts` (the one Back pill, the wordmark that stays, copyable codes, the open menu in three languages, the search keys, a server without accounts), `e2e/mouse-rows.spec.ts` (the arrows at a row's ends), the mouse part of `e2e/player-touch.spec.ts` (double click, hold, dragging the dot), `src/client/tv/gestures.test.ts`, `src/client/tv/librarySearch.test.ts` (caret edits, emoji), `src/client/polish/polish.test.ts` (the guard of rules 1 and 2 below) and `src/client/account/theme.test.ts` (the words on every accent pass 4.5 : 1). Two tests were wrong rather than the code: the banner test measured the rows during their 0.4 s entrance (it now waits for them to arrive), and a player test passed on the controls' own timer (now it cannot).

**The independent review.** Codex was tried first and could not be used (section 6), so a Claude Opus subagent read the finished diff, read-only, and reported nine problems. All nine were real. Each is fixed and has a test that fails without the fix (the old code was put back to see it fail):

| # | What was wrong | Now |
|---|---|---|
| 1 | The row the remote is on was scrolled to by the box round its titles, not the row: the first row's name slid out of view as soon as the library opened, and each row's name after a Down. My own pictures had lacked that name for days. | scrolls to the row itself; a test looks at the name of the focused row once the page has stopped moving |
| 2 | With reduced motion asked for, the refined 0.4 s rise of the rows and the banner's words beat the older 0.01 s rule for it. | the reduced-motion block says 0.01 s again for them, and a picture that arrives late is simply there |
| 3 | In search, a click above or below a letter, or in the box's padding, put the caret at the end. | the caret goes where the click is along the line, whatever is under it |
| 4 | A server without accounts left the TV no way to Settings: the corner button was drawn only once accounts were found. | drawn for that case too, as "Profile"; its page has Settings alone (D34) |
| 5 | A drag of the dot never ended if the screen stopped steering the film in the middle of it (an admin taken away), or if the browser refused the bar the pointer. | it ends at the pointer's release anywhere, and when steering stops |
| 6 | On "phone connected" Disconnect, which lets go of every phone, could be the first thing the remote's first press landed on, while the code was on its way. | the Back pill stands before it in page order (D35) |
| 7 | An emoji typed on a narrow screen's own keyboard could be cut in half by the caret keys or Delete, which broke the search request and left "searching" on. | edits step over a whole character; the request cannot throw outside its chain |
| 8 | The single-click player test waited long enough for the controls to put themselves away, so it passed whether or not the click did. | it waits 1.5 s, and counts the toast once |
| 9 | With reduced motion asked for, the phone's toast was faded out by its own animation in a hundredth of a second: never seen. | no animation for it in that case |

**Failures of the full runs.** The first full run had two, both understood. The banner test (the second row ended 7.7 px under the screen's edge): it measured the entrance, and had passed in the first place only because of the scroll bug in row 1 above; on the settled page the second row ends inside the screen. And `phone-to-tv.spec.ts`, "openPairedPhone" waiting for the phone's "TV connected" line: a pairing step that fails now and then under load and passes alone (it did before this work). The final run had three, none of which came back when their groups were run again (19 of 19). Two are tests of the mouse on the player (`player-touch.spec.ts`: a single click, and a drag of the dot) that failed in their helper, before any step of their own: the film had stopped itself a moment after it started ("paused" at 0.4 s and at 1.0 s), so the controls never went away. The third is a Chromium worker that crashed (exit code 3221226505) in the ultrawide screen test. I found no cause for the first two: the engine that starts and stops a film (`engine.ts`) is untouched by this work, and the same helper passed in the six other tests that use it in that run. They are flakes to watch, not proof that nothing is wrong.

**What this does not show.** It is Chromium on a desktop, with the TV's size and the phone's. Overscan, a real set's browser and remote, and how the pictures' fade looks on an old chip are the owner's to look at ([TV_TESTS.md](TV_TESTS.md), section 4).

## 8. What is not done

* **The older backlog.** [ISSUES.md](ISSUES.md) was written on 2026-10-14 and is the record. The look and layout items that the one look covers are done (a status "open (classic only; polish: …)" is fixed). The behaviour items of its "both-looks bug batch" were not worked on, and not re-checked, in this round; the P0 ones among them are the first thing to do next: UI-002 (the banner's buttons wrap on `/tv` on a phone), UI-004 (home's first focus rides down when the profile rows arrive late), UI-006 (focus on the phone's account pages and the QR scanner), UI-007 and UI-008 (the browser floor is not declared: the shipped JS parses from about Chromium 85). UI-005 (the password eye's ring) and UI-001, UI-003 and UI-035 are fixed.
* **Nothing was run on a real television.** Overscan, a given set's browser and remote, and VIDAA / Tizen / webOS / Fire TV are the owner's to check: [TV_TESTS.md](TV_TESTS.md), section 4, is a fifteen-minute list.
* **The older sheets are still underneath the refined layer** (`styles.css`, `tv/tv.css`, `controller/*.css`). Merging them into one set changes no pixel and was left for a quiet day; [COMPONENT_INVENTORY.md](COMPONENT_INVENTORY.md) lists the families written twice.
* **A page that waits has nothing focused until a first arrow key** (Connect a phone; a party waiting for a code): the first key lands on the first control (audit E05).
* **The live site** (kino.24-7.ro) is reviewed by a model with the owner's remaining credits after this is merged and deployed, not before.

## 9. On a real television

The short list is [TV_TESTS.md](TV_TESTS.md), section 4. The ones most likely to differ from the pictures: overscan at the edges (the controls keep 5 % in from the right and the top), the profile button, Settings and Back reached by the remote only, the menu's width in Italian and Romanian, the smallest text from the sofa, and the pictures' fade on an old set.

## 10. Rules that future changes must keep

1. **Old TV browsers are the floor.** Nothing in `polish/` that `polish.test.ts` bans (`@layer`, `@container`, `@property`, `color-mix()`, `oklch/lab/lch`, `light-dark()`, `dvh/svh/lvh`, `subgrid`, `:has()`, `:where()`, `:is()`, `text-wrap`, `container-type`), and no `padding-inline` or `aspect-ratio`; keyframes are named `polish-…`. A browser drops a whole rule for a part it does not know.
2. **Everything in the layer starts with `:root[data-ui="polish"]`; phone rules also say `.phone-ui`.** The TV and the phone share one bundle: a phone rule without `.phone-ui` reaches the TV.
3. **No new size, corner, grey or time without a token.** Seven TV sizes (`--fs-1..7`), six phone sizes (`--p-fs-1..6`), three corners each, one curve (`--ease`, `--p-ease`), `--t-fast` and `--t-base`. A value off the scale needs a reason written next to it (the keys, the numerals, the codes and the wordmark are the only ones).
4. **Colour is never the only sign.** Chosen = the accent as a tint and a ring; the remote's place = lit and ringed; a switch = its knob's side and its fill. The accent is for what is chosen, what is primary, and where the remote is; leaving a page is never the accent's colour, and taking something away is red words on a plain surface.
5. **One focus language per device.** Every `[data-nav]` control needs a focus rule from the shared set; run the keys walk after adding a screen.
6. **A surface is higher by being lighter, and solid.** Shadows are for what floats. White at an alpha is only for what lies over a picture.
7. **One curve, and only `transform` and `opacity` move.** Nothing animates layout, nothing blurs a large area, and `prefers-reduced-motion` stops all of it.
8. **The wordmark never moves, and one Back pill stands in one corner.** Use `Screen` and `BackButton` for a page that fills the screen, and put the pill before the page's other controls in the code too: the remote's first press lands on the first control in page order, and it must never be one that lets go of something (D35).
9. **Targets are 44 px on the phone (48 for a main button); the TV's smallest word is 1.15 % of the width.** The guard tests say so.
10. **Every accent is checked.** White or `#111` words on the fill pass 4.5 : 1 (`theme.test.ts`); a new accent is added in `styles.css` and `account/theme.ts` together.
11. **`dist/client` is committed.** A change to the client or to `shared/` needs `vite build` before the commit, and the dist goes in its own commit.

## 11. To run it again

```bash
node scripts/ui-walk/run.mjs --scan        # every screen, measured (about 15 minutes); pictures in .ui-polish/shots/polish
node scripts/ui-walk/drift.mjs             # the drift report into docs/ui-polish/drift
node scripts/ui-walk/run.mjs --only=tv-keys   # a remote's walk of 25 screens
node ./node_modules/@playwright/test/cli.js test e2e/<file>.spec.ts   # a spec; the whole suite is about twenty minutes
```
