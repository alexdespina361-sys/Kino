# E: TV / 10-foot / D-pad (audit report)

Auditor E, 2026-10-13, branch `ui/polish-system`. **Classic** = `dist/client` (built 19:35, before the refined TV sheet). **Refined** = a copy of `.ui-polish/dist-iter` (built 20:47, includes 7e183fb) served from my scratch folder and switched with `UI=polish`. Scripts, logs, pictures: `C:\Users\Me\AppData\Local\Temp\claude\C--Users-Me-Desktop-WebPlayer\76a1c5e2-d0fd-4798-b844-5854cd44ef86\scratchpad\audit-E\` (`NN-*.mjs`, `*.log.txt`, `shots/`).

## 1 Scope and method

- Drove `/tv` with arrows, Enter and Escape only (Playwright, 260-300 ms between presses) on a throwaway server (memory DB, the walk's made-up catalogue): flows at 1280x720, measuring at 1920x1080, margins also at 2560x1440. `--em` is 1% of the width, so every percentage below is the same at 1280, 1920 and 2560 (checked on home, detail, connect).
- Arrow graph per screen (press each arrow once from every state, replay to reach the rest): home (66 states, 434 presses, all 66 focusables reached), movies, series, categories, category, search, lists, profile, ratings, history, settings, sign-in, form, connect, party, party join, title pages (film, show), rate, HUD (film, show with next), four player menus, end card, error card, signed-in picker and account panel. Back from the first state and from three presses in.
- Focus look: computed style of the focused element against an unfocused twin (outline, box-shadow, transform, fill, colour; em and px; contrast against `#0b0b0c`). Margins and text: every text run, icon and filled button against the 5% rule; size as % of width.
- The 12 tasks of the brief executed for real, key by key, with an end-state check (App. F); mouse measured in desktop Chromium (App. E); the oddity reproduced and explained (App. A).
- **Refined look**: 7e183fb and a066388 change only CSS (plus `import "../polish/tv.css"` in `Tv.tsx`), so every behaviour finding holds in both looks; I re-ran the race on the refined build and measured its focus looks, margins and text sizes (column "R:" in the table).
- Not covered: real TV engines (no Chromium 68-76 here, so E02 is read from the code, not reproduced); remote key codes; ring contrast for the other five accents (red measured); Friends and bell pages; typing with a TV's own keyboard; CPU cost on a weak TV.

## 2 Findings

| ID | P | Look | Where | What | Why it matters | Fix idea | Verified |
|---|---|---|---|---|---|---|---|
| E01 | P1 | both | `Browse.tsx:509-514` (first focus, once), `:654-677`, `:902` | When the library answers before the profile sync (here forced with a 1.5 s delay on the sync; on loopback both land together and the screen is fine), the rows "Continue watching" and "Favourites" appear above the tile that was focused: focus stays on that DOM node, now row 2 at y=1143 of 1080 (off-screen), the banner keeps the old title, no ring is visible anywhere; Up jumps to Favourites, Down skips three rows, OK opens the off-screen title. This is the baseline oddity (App. A). | A returning user's first screen is dead and OK opens a film they cannot see. Likely after sign-in, a profile switch, a cold cache, a phone changing lists (inference from the request order, not measured on Render). | Until the first key or pointer event, re-run the first-focus effect when the rows above the focused tile change (a `touched` ref); or hold the first focus up to 400 ms for the profile rows. | ran it: sync held back 1.5 s = broken every time (`03` on both builds; `04` reloaded that state 9 times per build with the same result); profile first, and the unforced loopback race (6 runs) = fine; R: same (ran it) |
| E02 | P1 if the floor is real (not reproduced) | both | `tv.css` (48 `:focus-visible` rules, 1 plain `:focus`), `Browse.tsx:772` `matches(":focus-visible")` unguarded, `polish/base.css:6` | Every focus look is a `:focus-visible` rule, and `:focus-visible` ships in Chromium 86; the brief's floor is Chromium 68-76. On such an engine each rule is dropped (no ring, scale or white fill anywhere) and `matches()` throws on every focus inside the title page. | A D-pad UI with no visible focus is a lock-out (P0 on that TV). The debug panel probes it (`shared/debug.ts:98`), but `polish.test.ts:9-23` bans `@layer`, `:has()`, `:is()`, `text-wrap` and more, not `:focus-visible`, and `polish/base.css:6` lists it among what the oldest TVs understand. | Settle the floor (Q1). If below 86: a tiny script sets `data-kbd` on `<html>` after the first key and the looks also hang on `[data-kbd] :focus`; wrap `matches` in try/catch now. | read the code; not reproduced; R: same dependency (`polish/tv.css:70`) |
| E03 | P2 | both | `Hud.tsx:313-430`, `Tv.tsx:1131-1189` | The HUD is one row of 8 (film) to 12 (show with next) controls: Stop = Down + 7 Right (film) or Down + 11 Right (show), Next episode = Down + 4 Right; the seek bar has no focus. Left/Right seek 10 s only while NO control has focus; after one Down the same keys walk the buttons until Back or Up blurs. | The commonest keys change meaning without a sign: one stray Down and Right no longer seeks. | Print a one-line key hint while a control has focus; fold Mute, Full screen and Stop into one "More"; keep Left/Right seeking until OK is pressed on a control. | ran it (HUD graphs, film 9 states and show 13); R: same keys |
| E04 | P2 | both | `Hud.tsx:192-210`, `tv.css:654`, `14-upnext` | Up Next (last 15 s, needs a next episode): "Watch now" wears a static white ring (`outline: 0.2em solid #fff`) that looks like focus while real focus is nowhere (or on the HUD). Both are ordinary buttons, but the arrows only walk the HUD row, so neither can be focused by arrows. With nothing focused OK starts the next episode, Back closes the card (a second Back leaves); the card names neither key. It sits 3.2% from the right edge (x881-1239 of 1280). | Down then Right walks the HUD row below the card, so a person aiming at Cancel sees a second ring appear on Play or Back 10 s while the card keeps its own. | Take focus onto the card while it shows (Left/Right, OK acts) and drop the static ring; or print "OK Watch now / Back Cancel" (en/ro/it). | ran it (`14-upnext`: Down = HUD Play, Right = Back 10 s, Up = nothing focused, OK = next episode, Back = card gone, Back = leaves); R: card restyled, keys same (read) |
| E05 | P2 | both | `Idle.tsx`, `Account.tsx` (`data-nav`, no autofocus) | Pages that wait for something (pairing code, sign-in code) open with nothing focused; the first key only wakes focus: OK on the sign-in page focuses "Use a username and password" without pressing it. | First-run flows: the first press looks dead. | `data-autofocus` on the first button of each waiting page. | ran it (screen-signin, screen-connect; tasks.log "OK>(nothing focused) OK>tv-signin-email"); R: same |
| E06 | P2 | both | `Browse.tsx:797-801`, banner actions | A returning user's first screen: Up, Right, OK removes the first card from Continue watching at once (4 to 3 tiles; no confirm, no toast, no undo). "Remove from Continue watching" is the button beside Resume. | A silent destructive action one press from the primary. | Move it to the title page, or a 5 s "Removed. Undo" toast. | ran it (`27-remove`); R: same |
| E07 | P2 | both | `Account.tsx`, settings graph | Settings and the account panel: the first Right from the left column (Sign in / Switch profile, Back) lands on the Autoplay switch mid-page, not on the first control; Language needs Right, Up x3, OK (5), plus 13 presses to reach Settings: change language = 18. | The first thing a new owner changes is 18 presses away; the first move lands mid-page. | Right from the left column lands on the first row (Language). | ran it (18 presses, `lang=ro`); R: same |
| E08 | P2 | both | `browseNav.ts` `stepFrom`/`into` | Column memory is lost through a short row: from row 3 col 2-9 Up lands on the two-tile "Weekend" row (col 1), Down returns to col 1. | A person deep in a 12-tile row loses their place after peeking up. | Keep an intended column during vertical moves (reset by Left/Right). | ran it (home graph) |
| E09 | P2 | both | `Browse.tsx:91,902` (`BANNER_DELAY_MS` 200, `key={shown.entry.id}`) | Right, then Up within about 190 ms: focus lands on the banner's Play, then the banner re-keys and focus drops to the page; the next arrow goes to the remembered tile. | Quick presses (under 200 ms) lose focus on the main screen. | Keep the action buttons outside the keyed block (only the text re-keys). | ran it (`02-hero-remount`: fails at 150-190 ms, fine at 230 ms) |
| E10 | P2 (opinion) | both | `Browse.tsx:625,630` | Back on Home toggles menu and tiles for ever; it never leaves ("home is as far back as it goes"). | On Tizen, webOS and Silk, Back at the root is the way out; here only the Home key (Q2). | A third Back passes through to the platform, after a "Press Back again to leave" line. | ran it for tile to menu (`11-player-extras`: Back lands on the tile, Back again on rail-home); menu back to tiles read from `:625` (no Back path on Home is left unhandled) |
| E11 | P2 | both | `Tv.tsx:1131-1151,1212-1215` | Leaving the player takes 1 Back (HUD up, nothing focused) or 2 (HUD hidden: the first only wakes it; or a control focused: the first blurs it); Stop = 9 presses. After a film started from the phone, Back lands on the paired "waiting" page (`Idle.tsx:247-257`, the Connect page's paired variant) with nothing focused, not on the library. | The main exit costs a variable number of presses, with no hint. | "Press Back again to leave" line after the first; the library (not the waiting page) after a phone-started film (opinion). | ran it (`hud.log.txt`, 3 cases; `14-upnext`) |
| E12 | P2 | polish | `tv.css:98-183,590,1390`; App. B | No single focus language: 7 ring widths (0.078-0.391 em), 8 scales (1.00-1.22), four families (white fill + accent ring; white ring on a translucent fill in the HUD; white ring + 1.1 on pictures; dark-red tint + white ring on menu rows). Rail items and keys: fill only. `tv-party-choice` and `tv-score` get 1 px rings (0.078 em) at 1280, HUD icon buttons 5 px. Accent ring vs page 4.1:1, white 19.7:1. | Same state, different cue per surface; the thinnest rings sit on the choices that matter. | One ring token (white, page-coloured gap) and two lifts. | measured (31 control kinds, `focus-looks-table.txt`); R: one language: pictures a 0.20 em white ring over a 0.10 em page-coloured gap, scale 1.06; controls white fill + lift shadow, scale 1.04 (chips 1.05); HUD Play ring as pictures, 1.08 |
| E13 | P2 | polish | App. C | Margins (5% rule): rail icons 2.0% from the left; chip and full-screen T3.2% R4.4%; HUD title, Play, clock L/R 3.2% and T/B 3.9%; Up Next R3.2%; captions of a peeking row 0.5-3.9% from the bottom; 25 of 46 boxes on home. Full-screen pages are inside 5%. | A TV with overscan on cuts the rail icons and corner buttons (frequency: opinion). | One edge token per axis. | measured at 1920 (same % at 1280 and 2560); R: 16 boxes outside (was 25): top 5.2% and rail 3.4% are better, the right edge of the corner buttons 2.6% is worse (was 4.4%), captions B1.7% |
| E14 | P2 | polish | `tv.css:841` (`.tv-ep-meta` 1.15em), `:844-849` (`.tv-ep-about` 1.1em), `:1134` (`.tv-tile-year` 1.25em), `:1163` (`.score-badge`), `:1612` (`.tv-category-count` 1.1em), `.tv-btn-sub` (`:581`) | Text under the project's own floor: category count 21.1 px at 1080p (1.10% w), episode synopsis 21.1 (1.10%), score badge 22.1 (1.15%), episode meta 22.1 (1.15%), HUD sub-line 23.0 (1.20%), tile year 24.0 (1.25%); the "10" inside the skip icons sits in a 17 px box (0.9% w, `27-remove`). | Meta lines are what a sofa reads worst. | Floor of 1.3% (refined `--fs-1`). | measured; R: smallest text 25.0 px (1.30%) |
| E15 | P2 | polish | `tv.css:1135,1144-1187`; `21-mouse` | Mouse: hover on a tile only turns the title white (189,189,196 to 255): no scale, no ring, and hover does not move focus, so the banner never previews the title under the pointer. The +/x corner is a 31 px `<span>` (2.4% w) drawn on all 53 tiles at once for any hover + fine pointer. | A desktop user cannot see which tile is under the pointer; 53 permanent buttons are noise (on pointer-remote TVs too: opinion). | `.tv-tile:hover` ring + lift; show the corner on tile hover or focus only. | measured; R: unchanged (read `polish/tv.css:189-215`) |
| E16 | P3 | both | `Rail.tsx` `onPointerEnter` | The rail opens on any pointer contact (no dwell): a pointer grazing the left 6% opens a 27% panel (346 px at 1280) over the first tile column (267 px overlap) in 30-300 ms; shuts at once on leave. | The pointer cannot cross the left edge without covering content. | About 200 ms dwell before opening. | measured; R: panel is opaque and dims the page (read) |
| E17 | P3 | both | `RateOverlay.tsx`; rate graph | OK on a score saves it but the overlay stays open (Down + OK on Done or Back: +1-2 presses); Left/Right from Done jump to 5 and 10. | Two extra presses on every rating; odd jumps. | Close after OK with a toast; Done's Left/Right to its neighbours. | ran it (rate-9 = 7 presses, overlay still up) |
| E18 | P3 | both | `browseNav.ts`; search graph | On-screen keyboard: "har" = 14 presses, plus 3 to get there and 2 to open (19). Up from Space goes to 5, from Delete to 7 (geometry). A real keyboard types directly. | Slow but expected on a TV. | Letter-jump with hold; Space under the middle keys. | ran it (19 presses) |
| E19 | P3 | both | `Idle.tsx` welcome; `15`,`16` | First-run Welcome: the button is drawn focused (white fill, accent ring, 1.06) but `:focus-visible` is false and `activeElement` is the first tile behind; arrows do nothing; OK or Back dismiss. | A static style standing in for focus; breaks if a second control joins. | Focus the button for real. | ran it |
| E20 | P3 | both | `Tv.tsx:1328,1363` | Back from the account panel or sign-in opened with the top chip lands on the remembered tile, not on the chip (the library re-mounts); from Profile > Settings it returns to the Settings tile. | Small loss of place; the chip is two Ups away from the tile. | Remember the opener. | ran it (`28-chip-back`: guest sign-in page, Back lands on the tile it came from, rows:0:0 and rows:0:2; signed in, the panel opens on "Manage profiles", Back lands on tile rows:0:2; `25-return`: Profile > Settings > Back lands on the Settings tile) |
| E21 | P3 (opinion) | both | `Tv.tsx:1183-1189` | Seeking is 10 s per press (Left/Right, no bigger step); the seek bar is mouse-only. | A 2-hour film is long to cross from the sofa (key repeat helps; Q5). | Up/Down while no control is focused = 60 s. | ran it (3.4 to 13.6 s per press) |

## 3 Patterns

1. **Focus is placed once, by an effect, and never revisited**: E01, E05, E08, E09, E20. Late rows, a re-keyed banner and a re-mounted page all leave focus where the DOM dropped it.
2. **A look standing in for focus, and no focus language**: E04, E19 (static rings), E12, E15.
3. **The player's keys are modal and the controls are one flat row**: E03, E04, E11, E21.
4. **Edges and text floors are set per component, not per page**: E13, E14 (the refined sheet moves both to tokens).
5. **The mouse is a second-class guest**: E15, E16.
6. **Back means different things**: E10, E11, E20 (leave, blur, close, one level up).
7. **Destructive beside primary, no undo**: E06.
8. **Focus depends on a pseudo-class the stated floor lacks**: E02.

## 4 Quick wins

1. E02: try/catch around `matches(":focus-visible")` (`Browse.tsx:772`), 5 min, whatever the floor.
2. E01: `touched` ref; re-run `focusAt(CONTENT)` when `homeRows` changes before the first input (about 25 lines).
3. E09: take the banner's buttons out of the `key={shown.entry.id}` block.
4. E05: `data-autofocus` on the first button of the pairing and sign-in pages.
5. E04: delete `tv.css:654`; add "OK Watch now / Back Cancel" (en, ro, it).
6. E07: Right from the left column targets Language.
7. E08: intended column kept through short rows (`stepFrom`).
8. E06: "Removed. Undo" toast for 5 s.
9. E17: close the rating after OK with a toast.
10. E15: `.tv-tile:hover` ring and lift inside `(hover: hover) and (pointer: fine)`.

## 5 Keep

- Arrow geometry is predictable: all 66 focusables of Home are reachable, 35 boundary no-ops, no trap, pairs mostly reversible; first focus is right on content pages, forms, picker, title page, end and error cards.
- Focus is remembered by id: title page and back (home, movies, series, lists, category, ratings), rail Right returns to the remembered tile, Back from a show's episode returns to the show's page, one step out per Back (category to categories, ratings and history to profile).
- Menus are modal with Close and Back, and give focus back to the HUD button that opened them. The hidden HUD drops control focus and the cursor; timing 2.5 s (7.5 s with a control focused) is sane and sticky while paused.
- Press counts of the main flows are low: 2 to play or resume, 3 to add to Favourites, Resume continues at the saved position (the video was at 21 s of 40 a moment after OK, `19-resume`).
- `--em` gives the same proportions at 1280, 1920 and 2560; end, error, connect, party, sign-in and settings screens are all inside 5%, with text of 1.5% or more (except the QR caption at 1.30% and the party hint at 1.40%).

## 6 Open questions for the owner

1. What is the real browser floor of the TV page: Chromium 68-76 (the brief) or 86 and up? It decides whether E02 needs a `:focus` fallback.
2. Back on Home: keep the loop (the menu is the next step), or let a third Back leave?
3. Remove from Continue watching: stay in the banner beside Resume (with Undo), or only on the title page?
4. Mouse: should hover move focus (the banner previews the hovered title), or stay CSS-only?
5. Seek: ten seconds only, or Up/Down for a minute and hold-to-accelerate?

## 7 Seen on the way

- GI: the classic `tv.css` uses `:is()` (590-591), `:has()` (1186), `text-wrap` (276, 422, 491), `inset` (many) and `aspect-ratio` (682, 822) although `polish.test.ts:8` says the classic look uses none of the banned things: that test reads only `src/client/polish/*.css`. Also E02 (`:focus-visible` is not on its list).
- A+D: hero eyebrow accent red on `#0b0b0c` is 4.1:1; the accent focus ring is 4.1:1 too.
- B+C: "leave" is drawn five ways (title-page X, "Back", "Back to the library", "Done", menu "Close"); the +/x corner is a `<span>`, not a button.
- H: Up Next buttons are tabindex 0 but unreachable; `audio-subtitles-modal` is reused for the speed and episodes menus; the welcome button is not the active element.
- F/A: the refined sheet measures edges as 5% of height (top 5.2%), so the right edge is 2.6% of width (50 px at 1920).
- U1: Remove has no undo (E06); an unresolvable Resume URL (seed `films.example`) returns to the library after about a second.
- G: tile focus is a 0.18 s transform and shadow on 50+ tiles; not measured on a weak CPU.

## A. The oddity: why two baselines differed

- The pair at 1920: `classic` showed the banner "Popular this week / The Long Harbour" with a red Play and no ring; `main-classic` showed "Continue watching / The Glass Orchard" with the first tile ringed.
- Cause: first focus goes to the first tile of the first row once the library arrives (`Browse.tsx:509-514`). The profile sync lands later and inserts the profile's rows above. React keeps the focused node (key `${zone}-${entry.id}`), so focus rides down to row 2 and `arrived()` never re-runs.
- Timeline (`03-oddity`, A): `GET /api/library` answered at +108 ms, `POST /sync` at +1614 ms. t=250-1200 ms: focus on The Long Harbour, banner as above. t=2200 ms: rows "Continue watching", "Favourites" inserted, focus now `rows:2:0` at y=1143 (viewport 1080, off-screen), banner stale, `deep=false`.
- Order matters: profile first, or the loopback race (6/6 here, the walk saw the broken state once at 1920), gives the consistent screen. On a real network the cacheable library GET normally beats a database POST, so the broken state is the usual one on a cold cache, after sign-in, a profile switch or a phone changing lists (inference, not measured on Render).
- Experience in the broken state: a Play button that looks selected and no ring; 1.5 s later the Popular row jumps down under "Continue watching". Up jumps to Favourites (row 1, banner changes), Down lands on row 3 "The Long Night" (skips three rows), Right goes to Paper Moons in an off-screen row, Left to the menu (banner stale), OK opens The Long Harbour, not the visible first tile. One or two presses recover. A Right pressed in the first 1.5 s ends on an off-screen Paper Moons; two Downs end consistent.
- Refined build: identical (ran it). The signed-in cold start with two profiles shows the picker first; after choosing, the home was consistent.

## B. Focus looks (classic at 1280, em = 12.8 px; ring vs page `#0b0b0c`)

| Control | Ring | Scale | Fill / text |
|---|---|---|---|
| Tile, category tile | 0.20 em (2.56 px) white on the art, 25.6 px shadow | 1.10 | title 189 to 255 |
| Banner and page buttons (`tv-hero-button`, `tv-action`, `tv-choice`) | 0.234 em (3 px) accent, offset 0.234 em | 1.06 | white fill, black text |
| Chip, corner, title-page close | 0.156 em (2 px) accent, offset 0.156 em | 1.06 | white fill |
| Switch row | 0.234 em accent | 1.03 | white fill |
| Party choice, rating score | 0.078 em (1 px) accent | 1.05, 1.12 | white fill |
| Rail item | none | 1.00 | white fill, black text |
| Search and pad keys | none | 1.08 | white fill |
| HUD `tv-btn` | 0.234 em white, offset 0.078 em | 1.08 | white .14 to .30 |
| HUD icon buttons, Play, Stop | 0.391 em (5 px) white, offset 0.234 em | 1.08 | Play: white fill |
| Menu rows (`tv-opt`, `tv-ep`) | 0.234 / 0.156 em white | 1.00 | white .06 to 25% accent tint |
| Accent swatch | 0.156 em white, offset 0.391 em | 1.22 | |
| Profile tile | 0.30 em white on the picture | picture 1.10 | |
| Text input | 0.28 em accent at 50% | 1.00 | |
| **Refined (measured)** | pictures and HUD Play: a 0.20 em white ring (3.84 px out) over a 0.10 em page-coloured gap; every other control: no ring, a lift shadow only | pictures 1.06; controls 1.04 (chips 1.05); HUD Play 1.08 | controls white fill, near-black text |

White ring on the page 19.7:1; accent red ring 4.1:1 (above the 3:1 non-text minimum; not measured on posters or for the other five accents). Text on fill: black on white 21:1.

## C. Safe margins and smallest text (classic; identical % at 1280, 1920, 2560)

| Element | Margin from the edge |
|---|---|
| Rail icons | L 2.0% |
| Account chip, full-screen button | T 3.2%, R 4.4% (chip R 8.9%) |
| Title-page Close | T 4.2%, R 4.4% |
| Tile captions of the peeking last row | B 0.5-3.9% |
| HUD title, Play, prev/next, clock, "Ends at" | L/R 3.2%, T/B 3.9% |
| Up Next card | R 3.2% |
| Connect, party, join, sign-in, form, settings, end card, error card | inside 5% (0 boxes outside) |

Boxes outside the 5% frame at 1920: home 25, rail 26, detail 26, rate 26, movies 22, search, categories, lists, profile 15 each, HUD 10-14. Refined at 1920: home 16 (rail L3.4%, full-screen R2.6% T5.2%, caption B1.7%), settings and connect 0.

| Screen | Smallest text at 1920 (% of width) |
|---|---|
| Home, detail, movies | score badge 22.1 px (1.15%), tile year 24.0 (1.25%), eyebrow and tile name 25.0 (1.30%) |
| Categories, profile | category count 21.1 px (1.10%) |
| Search | keys 26.9 (1.40%), chip 28.8 |
| Connect, party, join | QR caption 25.0 (1.30%), party small 26.9 (1.40%), hint 28.8 (1.50%) |
| Sign-in (code page) | 33.8 (1.76%) |
| Sign-in form, settings, end card, error card | 28.8 (1.50%) |
| HUD, show | "Ends at" and speed/party labels 25.0 (1.30%), badge 24.5 (1.28%), sub-line 23.0 (1.20%) |
| Episodes menu, tracks menu | synopsis 21.1 (1.10%), meta 22.1 (1.15%); tracks detail 24.5 (1.28%) |

Refined at 1920: smallest 25.0 px (1.30%) on tiles, badge and category count; settings 28.8-32.6 px.

## D. The HUD, menus, overlays, traps

- **Timing**: HUD hides 2.5 s after the last key or pointer move, 7.5 s while a control has focus (measured 7.2 s); never while paused, loading, failed or a menu is open; hiding drops focus and hides the cursor.
- **HUD hidden**: Up shows it; Down shows it and focuses Play; Left/Right seek 10 s with a toast and show it; OK or Space pauses (pause card); Back shows it (a second leaves); M mute, C subtitles, F full screen. **A control focused**: arrows walk the row (no wrap; Up or Back blurs), OK presses.
- **Up Next / cards**: Up Next as E04; end card first focus "Back to the library" (Right: "Watch again"), Back leaves; error card "Try again", "Back to the library", Back leaves.
- **Menus** (all modal; arrows cannot leave; Back closes and returns focus to the HUD button): Speed (7 rows, first = current speed, Close above the first); Audio and subtitles (8 buttons, first = current track, delay and style on the right, style is a sub-page that Back returns from); Episodes (4, first = playing episode); Party (2, "Start a party", Close). Other overlays (title page 5 buttons, list picker, rate, picker, panel): modal, Back closes, focus returns to the opener.
- **Traps**: none unintended. The forced profile picker ignores Back by design (Sign out is on it). **Unreachable by arrows**: Up Next buttons, the seek bar, the +/x corners (mouse), the Welcome button (styled, not focused).

## E. Mouse (desktop Chromium, 1280 and 1920)

- Rail: closed 76.8 px wide (6.0%), icons 47x52 at x=15; opens 30 ms after the pointer enters (136 px), full 346 px (27%) after 300 ms, 518 px at 1920; covers 267 px of the first tile column; shuts at once on leave; hover does not move focus.
- Tiles: hover colour only; a click opens the title page (focus on Play). Corner +/x: 31 px (46.5 px at 1920), icon 16.9 px, 53 visible at once; hover turns it white at 1.14x.
- Hover on buttons: banner Play (229,9,20) to (246,18,29); chip and full-screen .12 to .22; HUD buttons .14 to .26; no scale; cursor `pointer` throughout.
- Player: HUD shows on pointer move and hides 2.5 s later with `cursor: none`; one click on the picture toggles the HUD (no pause: tap-to-pause is off by default); the seek bar has a 33 px hit area (track 7 to 10.2 px on hover), a time tip, and a click seeks (75% = 30 s of 40).

## F. Press counts (keyboard, from the first tile of Home, classic 1280; 300 ms between presses)

| Task | Route | Presses |
|---|---|---|
| Play the first film | new TV: OK (page), OK (Play); or Up, OK. A guest with history: 3 Down first | 2 (5) |
| Resume | OK, OK (Resume), or Up, OK; starts at the saved position (`19-resume`, a playable film) | 2 |
| Next episode | Up Next card (last 15 s): OK; or from the HUD: Down, 4 Right, OK (counted from the HUD graph of a show with a next episode) | 1 or 6 |
| Add to a list | one list: OK, Right, OK (or Up, Right, OK); three lists: 3 Down, OK, Right, OK, OK (picker stays open) | 3 / 7 |
| Rate (9 of 10) | OK, 2 Right, OK, 2 Right, OK (overlay stays open; Back +1) | 7 (8) |
| Search "har", open first result | L, U, OK; 14 to type; Right, OK | 19 |
| Change language | L, 7 Down, OK, 3 Right, OK (Settings, 13); Right, Up x3, OK | 18 |
| Pair a phone | L, 6 Down, OK (nothing focused on the page) | 8 |
| Switch profile (signed in, 2) | Up, Up, OK (panel), OK (picker), Right, OK | 6 |
| Host a party | L, 5 Down, OK (page), OK (Start) | 8 |
| Sign in | phone-code page: Up, Up, OK; username form: + OK (only wakes focus onto the button), OK; then type, Down, Down, OK to submit | 3 / 5 (+3 after typing; the scripted run had a no-op Down in it: 6) |
| Leave the player | HUD up, nothing focused: Back; HUD hidden or a control focused: Back x2; Stop button: Down, 7 Right, OK | 1 / 2 / 9 |

## G. Screen graph (key, then what Back does)

- **WELCOME** (first run): OK or Back -> HOME; arrows ignored.
- **HOME**: Left from col 0 -> RAIL; Up -> banner (Play, list, rate, Remove) -> Up -> top bar (bell, account chip, full screen); OK on a tile -> TITLE PAGE (a category tile -> CATEGORY); banner Play -> PLAYER. Back: tile, banner or top bar -> RAIL; RAIL -> tiles (loops, never leaves: E10).
- **RAIL** (Search, Home, Movies, Series, Categories, My Lists, Watch party, Connect a phone, Profile): OK -> that page; Right -> remembered tile; Back -> tiles.
- **MOVIES, SERIES, MY LISTS**: OK -> TITLE PAGE; Back -> HOME. **CATEGORIES**: OK -> CATEGORY: Back -> CATEGORIES -> HOME. **SEARCH**: 6-column keyboard left, results right; OK types or opens; Back -> HOME (Backspace deletes).
- **TITLE PAGE**: Play or an episode -> PLAYER; Add to list -> toggle, or LIST PICKER (OK toggles, New list -> editor, Done or Back -> page); Rate -> RATE (10 scores from 7 + Done; OK saves, stays; Back -> page on Rate); Close or Back -> where it opened (same tile).
- **PROFILE**: My ratings, History, Sign in, Settings (Friends signed in): OK -> page; Back -> HOME; RATINGS and HISTORY: Back -> PROFILE.
- **SETTINGS = ACCOUNT PANEL**: left column (Sign in | Switch profile, Manage profiles, Sign in another device, Sign out | Back) and language, accent, look, switches; Back -> PROFILE (Settings tile), or HOME tile when opened by the chip (E20).
- **SIGN-IN** (code): "Use a username and password" -> FORM (email, password, Sign in, Create account, Use another device); Back -> where it came from. **PROFILE PICKER** (cold start with 2+, or Switch profile): OK profile -> HOME; Back stays when forced, else -> panel.
- **CONNECT** (code + QR, nothing focused): Back -> HOME. **PARTY** (start or join pad): Back -> HOME (pad -> PARTY).
- **PLAYER**: HUD -> menus (Episodes, Audio and subtitles -> Caption style, Speed, Party), Back -> HUD; Up Next (OK next, Back dismiss); END and ERROR cards (Back -> library). Back from the player: HUD blur -> TITLE PAGE of the show, or the library tile, or the paired "waiting" page after a phone-started film (E11).
