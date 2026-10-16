# U2: User flows, pathing, missing buttons: phone

Auditor U2, 2026-10-13, branch `ui/polish-system` (4081a52 + working tree), own server on :8827. Product files were not touched; the server is stopped.

## 1. Scope and method

Every flow in the brief was run on a phone context, not only read: pair (code, QR scan with a fake webcam, My TVs, another TV's code), home, pasted and shared links (`?url=`, `?text=`), browse, search, title sheet, play on the TV, the remote (seek, +-10, speed, subtitles and audio, episodes, Up Next, Next episode, Stop, Change video, Full screen), lists (+, x, hold, Manage lists, picker), rating, account (sign up and in, profiles, devices, password, sign in another device, friends, bell, settings), watch party (host, second screen, admin, remove, end, guest phone), My TVs (switch, rename, forget), TV offline, lost connection, "server is waking up", Back (sheets, pages, root), first run against returning, language (ro, it), home-screen install (code and manifest only).

- Environment: Playwright 1.64 Chromium, 390x844 DPR 2 touch, Pixel 7 UA; the remote also at 360x740, 375x667, 430x932 and 844x390. A second context is the TV (1280x720). Mock catalogue of `scripts/ui-walk/lib.mjs` (first four movies play from `/fixtures/long.mp4`, the rest fail on purpose); series media injected with a second WebSocket (`LOAD`); QR from a Y4M fake webcam; pulls with CDP touch events; cuts and delays with a WebSocket proxy and `routeWebSocket`.
- Evidence (scratch, outside the repo): `C:\Users\Me\AppData\Local\Temp\claude\C--Users-Me-Desktop-WebPlayer\76a1c5e2-d0fd-4798-b844-5854cd44ef86\scratchpad\audit-U2\` holds about 35 scripts `f01..f33`, their logs `fNN.log` and about 150 pictures in `shots/`. "Verified" below cites them (f05, f24, ...).
- Not covered: a real phone (soft keyboard, safe areas, real long-press, Safari), a real camera, a real cold start of the free host (simulated with a WebSocket that never answers).
- Result: 0 P0, 6 P1, 10 P2, 9 P3 (25 findings), plus 6 suspected. The thumb-reach problem on the remote (U19) is the one the owner named; a one-rule fix was tried in the browser (section 2d).

## 2. Findings

Thumb zones below use the common one-hand model (bottom third easy, middle reachable, top third hard). That is an opinion about hands; the pixel numbers are measured.

### 2a. Behaviour bugs, dead ends, missing buttons (most severe first)

| ID | P | Look | Where | What | Why it matters | Fix idea | Verified |
|---|---|---|---|---|---|---|---|
| U01 | P1 | both | `controller/Controller.tsx:76` (`tv` null) -> `:484` `PairScreen`; `PairScreen.tsx:127-141` | A phone that is already paired shows "Connect to your TV" (Scan, 6-digit field, Connect, Watch on this device) until the server's first answer: from 395 ms to 1.9 s with the answer held 1.5 s; on a sleeping server the whole wait (16 s measured; the app itself says up to a minute), Scan and Connect dimmed, "Watch on this device" the only live button | Reopening the remote is the most frequent flow and it starts by saying the pairing is gone; on the free host that lasts a minute | Keep the last TV's name and a paired flag in localStorage; draw the home header "TV 0DD1 - Connecting..." and a library skeleton until the socket answers; show the pair form only when the server says "no TV" | ran it (f05, f24; f24-cold-12s.png) |
| U02 | P1 | both | `Controller.tsx:610-621` (status line only in the page, `sheet !== "link"`), `:348-351` (toast only for `failed`; `resolving` clears it) | Tap Play in a title sheet from deep in the library: the sheet closes and the phone shows nothing for as long as the lookup takes (about 5 s in the test). "Finding video..." is the page's status line, 653 px above the viewport; the code already moves failures to a bottom toast ("where the thumb is") but not the wait | After the only press of the main flow the phone looks idle: people tap again or walk to the TV; a lookup may take up to 40 s (`:66`) | While `resolve.phase === "resolving"` show a bottom pill "Finding video... Cancel" (same place as the failure toast, no timer) whenever the status line is out of view | ran it (f07 A: status top -653, toast null for 4 s, remote at 5.6 s) |
| U03 | P1 | both | `account/AccountScreen.tsx:93-94` (`setView("picker")` when `account.choosing`), `Controller.tsx:475` (`ChooseProfile` + `accountLayer`) | After signing in with 2+ profiles a left-aligned "Who's watching?" page with a back chevron (no Add profile, no Sign out) covers the real centred "Who's watching?" chooser. The chevron reveals the second one; the user picks twice, or presses Back once and meets a different screen | Two screens for one question at the moment of signing in, and a Back that reveals another screen | Do not open the account layer's picker while `account.choosing` (the chooser is already on screen), or close the layer when choosing starts | ran it (f10 5b, f11 A; f10-after-signin-two-profiles.png vs f11-choose-screen.png) |
| U04 | P1 | both | `controller/Remote.tsx:129-155` (transport only `disabled={!online}`), `:109` (`state === "error"`) | After a video fails the TV shows "Try again" and "Back to the library"; the phone shows the red message with the seek bar, Play, +-10 and Speed all live. Play, +-10 and a tap on the seek bar change nothing (phone and TV stay in error). Only Stop and Change video lead out | The phone is the only input in hand and the recovery the TV offers cannot be reached from it; three controls look alive and are dead | In the error state replace the transport row with a red "Try again" (re-send the link, or let the TV take PLAY in error as its own Try again) and dim seek and Speed | ran it (f19, f20 part 3; f19-error-remote.png vs f19-tv-error.png) |
| U05 | P2 | both | `Controller.tsx:297-307` (`send` vibrates 8 ms, ignores a closed socket), `:310-314` `stop`, `Remote.tsx:200,213,219` | While "Reconnecting..." Back10, Play, Forward10 and Full screen are dimmed but Speed, Stop, Change video and the menu stay live. Stop does nothing (no toast, the remote stays, still playing when the link returns); on Android the 8 ms tick says it worked | The "stop everything" button is dead on the flaky Wi-Fi where it is wanted | Dim Stop and Speed with the rest while `!online`, or toast "Not connected yet" when the socket `send` returns false | ran it (f09 A: Stop pressed during a cut, toast null, remote unchanged) |
| U06 | P2 | both | `Remote.tsx:80-83,206-210` (hint block inserted above `.actions`) | When the TV refuses full screen (every TV browser without a press on the TV), 0.8 s after the tap a 64 px hint appears above the button row and Stop / Full screen / Change video jump 80 px down; 8 s later they jump back | The row you just pressed moves under the thumb twice; a second tap lands on the banner | Say it in the state line under the title or as a toast, never as a block in the button stack | ran it with `requestFullscreen` refused on the TV (f21: top 400 -> 480 at 1.0 s; f21-fs-hint.png) |
| U07 | P2 | both | `Sheets.tsx:547` `tv-forget`, `Controller.tsx:521` `disconnect`, `Sheets.tsx:771,779` `party-remove` / `party-end`, `AccountScreen.tsx:246` `sign-out`, `Rows.tsx:79` `continue-remove` | Forget a TV, Disconnect, End party, Remove a member, Sign out and the x on a Continue card all act on the first tap, with no confirm and no Undo (deleting a list, profile, account or friend confirms inline). Forget is an 83x65 tile 6 px from the switch tile; forgetting the only TV drops the phone to the pair screen and needs the TV's code again; the 36x36 x sits on a carousel you drag, and the card stays gone after a reload | The cheap-to-lose things confirm, the connection-losing ones do not | The same inline confirm ("Forget TV 1E22? Yes / Cancel") for Forget, Disconnect and End party; an Undo toast (5 s) for the x on Continue | ran it (f13 6-7, f15 5, f17 1: no toast, no undo control, gone after reload) |
| U08 | P2 | both | `Controller.tsx:349` and `:618` `resolveFailure`, i18n `play.*` | A title from the app's own library that cannot be played says "Couldn't find a compatible video source. This website is currently unsupported." in the toast and the status line | "This website" is wrong when nothing was pasted | For library-origin failures: "This title can't be played right now. Try another." (en, ro, it) | ran it (f07 B) |
| U09 | P2 | both | `PairScreen.tsx:138-141`, `role.ts:73-76` | "Watch on this device" is one tap, no confirm: it stores the role and reloads, so the phone becomes a TV for good behind a "Welcome / Start watching" card with no way back; Back leaves the site; the way back is a 34x39 rail icon ("Use as a remote") after Start watching. During U01 it is the only live button | A returning user who taps the one live button loses the remote and cannot see how to get it back | Ask first ("Use this phone as the screen?") or open it as a one-time choice (`?role=tv`) that is not remembered; put "Use this screen as a remote" on the welcome card | ran it (f22, f30: role kept in localStorage, survives a reload; "Use as a remote" is 34x39 and works; f24-cold-12s.png) |
| U10 | P2 | both | `controller.css` (header scrolls away), `controller/Library.tsx` search | The header is not sticky (-884 px after a 900 px scroll: TV status, account and the menu with My TVs / Party / Disconnect are gone) and the search field sits 1,118 px down (1.3 screens) for a profile with Continue, two lists and ratings; nothing in the header opens search | Search is the main way through a large library, and the menu is the only way to other TVs | Sticky header; a search icon in it that scrolls to and focuses the field | measured (f06: header -884, search top 1118, library row 1232) |
| U11 | P2 | both | `account/AccountPages.tsx` Settings, `AccountScreen.tsx` hub, `Bell.tsx` | Friends is off by default; its switch ("Use friends") is 1,164 px down a Settings page about 1,700 px long, below Language, Colour, Look, Playback, Paste-a-link and Ratings. Until then the hub has no Friends row and the header no bell | A headline feature with no route to it for a new signed-in user (only a friend's invitation link offers "Turn on friends" in context, f32) | Move "Use friends" under Ratings; add a one-line "Friends: off - Turn on" row to the account hub | measured (f16: y 1164 of 1748) |
| U12 | P2 | both | `public/manifest.webmanifest`, `shared/launch.ts:11` ("from the phone's share sheet") | The manifest has no `share_target`, so the OS share sheet never lists Kino, although the page plays `/?url=` and `/?text=` (works: plays as soon as a TV exists, cleans the address, no replay on reload; an unpaired phone keeps the link and plays it after pairing, but the pair screen does not say so). No install hint, no service worker, icons without `purpose` | "Share a link to the TV" is the natural phone path and it is not reachable from other apps | Add `share_target` (GET, params `url`, `text`) for the installed app; a one-time "Add to home screen" hint; say "Your link plays after you connect" on the pair screen | ran the launch side (f25); manifest read; the share sheet needs a device |
| U13 | P3 | both | `PairScreen.tsx:132-136` | After a wrong code the field is cleared and focused (good) but "Invalid or expired code." stays while the next digits are typed | Reads as if the new attempt is already wrong | Clear `error` on the first change | ran it (f01) |
| U14 | P3 | both | `Sheets.tsx` ChoiceList (Speed, Source, Quality, Subtitles) | Picking leaves the sheet open (1.5x, Dutch subtitles); the user then closes it | One change costs a tap more than needed | Close on pick for single-choice lists, keep Subtitles open | ran it (f04) |
| U15 | P3 | both | i18n `link.*` | The approve page asks "Sign in this device?" about a TV while the user holds a phone ("Sign it in" / "That's not me") | "this device" is ambiguous | "Sign in the TV?" | ran it (f12) |
| U16 | P3 | both | `controller/backButton.ts` | Browser Back from Home, the Remote and the profile chooser leaves the site (history index 0); from a sheet or page it peels one layer. From the Remote that exits the page while the TV keeps playing | May be what people expect; Back never goes Remote -> Home | See open question 2 | ran it (f28: one Back from Home and from the Remote lands outside the site, TV still playing; f11 for the chooser) |
| U17 | P3 | both | `shared/protocol.ts` command list | There is no volume or mute command: the phone remote cannot change the page's volume | A remote without volume surprises some users, more so with several screens in a party | `SET_VOLUME` / `MUTE` for the page's video if the TV's own volume is not the plan | read the code |
| U18 | P3 | both | `shared/linkBox.ts`, menu `link-box-toggle`, Settings | The paste box is off on a first-run phone (library-first) and called "Paste-a-link box" in the menu and "Show the box for pasting a link on the home screen" in Settings | A new user cannot find "paste a link"; two names for one switch | One name; a hint under the library while the box is off | ran it (f01, f03, f11) |
| U24 | P3 | both | `friends/useRequests.ts:23` (toast only), `controller/Friends.tsx` | After "Send request" the sender gets a 4.5 s toast ("Request sent to Dana22105#1") and then the Friends page says "No friends yet" again: outgoing requests are listed nowhere and cannot be cancelled | The sender cannot tell whether the request is waiting or was lost | A "Waiting for Dana22105#1 - Cancel" row under Your friends | ran it (f29; f29-after-send.png) |

### 2b. Design issues (nothing behaves wrongly)

| ID | P | Look | Where | What | Why it matters | Fix idea | Verified |
|---|---|---|---|---|---|---|---|
| U19 | P1 | both | `controller/controller.css:2-13` `.phone`, `Remote.tsx:96-224` | The remote is a top-down stack: seek 21%, +-10 and Play/Pause 31%, Speed 42%, Stop / Full screen / Change video 51% of the height (390x844). It all ends at y 464; the lowest 380 px (45%) are empty, and the 86 px Pause is centred at 31%, the edge of the top third. 430x932: 468 px empty | The most used controls (Play/Pause, seek) are in or at the edge of the hardest zone and the whole easy zone is blank; worse on bigger phones | `.phone > .seek { margin-top: auto; }` docks seek, transport, chips and actions to the bottom (tested: Pause 31% -> 73%, Stop row 51% -> 92%, no scroll at 4 sizes). See 2d | measured (f02, f27; f02-remote-390x844.png, f27-dock-390x844.png) |
| U20 | P1 | both | `controller.css` `.icon-btn`, `.lib-pill`, `.lib-corner`; `AccountButton` | Main-flow targets under 44 px: avatar 36x36, Sign in pill 92x34, menu 40x40, Back and close 40x40, filter pills 46 / 74 / 66 x 32, + and x on every tile 36x36, search clear 29x37, bell Decline 35x32 (Accept 73x40), device rename row 296x29, friend tabs 95x34, subtitle-style chips 36 high, subtitle delay buttons 78x40 | Small and in the top corner: the header is hard to reach and hard to hit; the tile corners are the most mis-tapped spot on a carousel | Grow the hit area to 44 px (padding or an `::after` hit area) without growing the drawn shape | measured (f01, f06, f10, f16, f17, f31) |
| U21 | P2 | both | `Remote.tsx:114-118`, `.state-action` | Up Next "Cancel" ("Next episode in 14s") is a 69x30 text button in the top band (y 132-162), the farthest zone from the thumb, with a 15 s window | The one time-limited decision on the remote has its smallest target in its hardest place | Put a 50 px "Stay here" button in the bottom block for those 15 s; keep the countdown on top | measured (f04: 69x30) |
| U22 | P2 | polish | `controller/Sheet.tsx`, `.sheet` | A title opened from "Change video" or "My ratings" stacks a second sheet over the first: two grips, the first sheet's title and carousel peek above | Reads as a glitch | Dim or hide the lower sheet's header while another is above it | ran it (f19-title-over-link-sheet.png) |
| U23 | P3 | both | `.toast` (bottom, 2 s / 4.5 s) and `.account-toast` (top, 4.5 s) | Two toast systems in two places with two timings ("wants to be friends" at the top, "The TV is offline." at the bottom) | A bottom toast will cover the docked buttons if U19 is fixed | One toast, anchored above the docked block | ran it (f07, f16) |
| U25 | P3 | polish | `controller/Friends.tsx` friend-code card (`friend-code-card`) | The "Add a friend" sheet cuts its own question: "Gave you this code. Become frien..." (390 px; the full sentence is in the DOM) | The words the choice depends on are the ones hidden | Let the line wrap to two lines, or shorten it to "Wants to be friends" | ran it (f32-C-friends-on.png) |

### 2c. Exact repro steps for the behaviour bugs

Preconditions: phone paired to a TV unless stated. "Lab" says how the test made a slow or broken server; on a device the same effect comes from a cold host or bad Wi-Fi.

- U01: 1. Pair, close the tab. 2. Reopen the site. 3. "Connect to your TV" is shown (Scan and Connect dimmed once the host is slow) until the first answer; at 10 s "The server is waking up..." joins it. Lab: f05 holds the answer 1.5 s; f24 makes the WebSocket never answer.
- U02: 1. Home, scroll about 950 px to a library row. 2. Tap a title whose link takes a few seconds, tap Play. 3. The sheet closes and nothing on the phone changes for about 4 s (the remote appears at 5.6 s). Lab: a local page that answers after 4 s (f07).
- U03: 1. Create an account, Account > Manage profiles > Add profile > Save, Account > Sign out. 2. Sign in with the same account. 3. A "Who's watching?" page with a chevron is on top; tap the chevron and a second "Who's watching?" (Add profile, Sign out) appears (f10, f11).
- U04: 1. Play a title whose video file is missing. 2. Phone: red "This video can't be played on the TV."; TV: Try again / Back to the library. 3. Tap Play, +10, or the seek bar: nothing changes (f19, f20).
- U05: 1. Playing. 2. Cut the connection (airplane mode). 3. Header says "Reconnecting..."; Stop, Speed, Change video and the menu still look normal. 4. Tap Stop: nothing happens, no message (f09).
- U06: 1. Play on a TV whose browser refuses full screen. 2. Tap Full screen. 3. After 0.8 s the two-line hint appears and the button row moves down 80 px; at 8.8 s it moves back (f21).
- U07: Menu > My TVs > Forget: the row is gone at once (the only TV: back to the pair screen). Menu > Disconnect from this TV: same. Menu > Watch party > End party: ends, members dropped. Home > Continue watching > x: card gone, no toast, still gone after a reload (f13, f15, f17).
- U08: Tap a library title that cannot be resolved, Play: toast and status line say "This website is currently unsupported" (f07 B).
- U09: Pair screen > Watch on this device: the phone reloads into the TV UI behind "Welcome / Start watching"; Back leaves the site; a reload stays a TV; the way back is the 34x39 rail icon after Start watching (f22, f30).
- U10: Home with Continue, two lists and ratings: the search field is at y 1118; scroll 900 px and the header is gone (f06).
- U11: Signed in: no Friends row, no bell. Settings > scroll to y about 1,160 > Use friends: now Friends and the bell appear (f16).
- U13: Type a wrong code; type the next digit: the error stays (f01).
- U16: Play something, press the phone's Back: the page is left (about:blank in the test), the TV keeps playing; same from Home (f28).
- U24: Account > Friends > Find a friend by tag > Find > Send request: toast for 4.5 s, then "No friends yet" again (f29).
- U01 with U09: on a cold host the pair screen's only live button is "Watch on this device" (f24).

### 2d. Thumb reach on the remote (390x844, playing; f02, f27)

| Control | y (px) | Centre | From bottom | Zone now | After `.phone > .seek { margin-top: auto; }` (tested) |
|---|---|---|---|---|---|
| Header: TV status, Sign in / avatar, menu | 16-56 | 4% | 808 | hard (top corner) | unchanged |
| Up Next Cancel (when shown) | 132-162 | 17% | 697 | hard | unchanged (U21) |
| Seek bar (container with times) | 148-202 | 21% | 669 | hard | 62%, middle |
| Back 10 / Forward 10 (64 px) | 232-296 | 31% | 580 | top-third edge | 73%, easy |
| Play / Pause (86 px) | 221-307 | 31% | 580 | top-third edge | 73%, easy |
| Speed chip (175x59) | 325-384 | 42% | 490 | middle | 83% |
| Stop / Full screen / Change video (114x64) | 400-464 | 51% | 412 | middle | 92% |
| Empty | 464-844 | - | 380 px = 45% | the whole easy zone | the gap moves between title and seek (about 350 px) |

Other sizes, empty band now -> Pause position before and after: 360x740: 276 px (37%), 36% -> 69%; 375x667: 203 px (30%), 40% -> 68%; 430x932: 468 px (50%), 28% -> 75%. No page scroll at any of the four sizes after the rule. The series remote (390x844) ends at y 622 with 222 px empty (episode row, two chip rows): not tested docked. Side effects to handle with the fix: the full-screen hint then pushes Play/Pause up 80 px instead (569 -> 489, Stop stays at 748), so U06 must go with it; the bottom toast would cover the Stop row (U23); Stop would sit in the lowest-left corner (open question 1).

### 2e. Suspected, not reproduced

| ID | Where | What | Why unproven |
|---|---|---|---|
| S1 | `controller/Library.tsx` search input | No `enterkeyhint="search"` (attribute read: null), so the keyboard's action key may say "return" | Needs a phone keyboard |
| S2 | `controller/hold.ts` (HOLD_MS 480) | A 700 ms CDP touch hold did not open the list picker while a mouse hold did | Emulated touch; check on a phone |
| S3 | manifest, no service worker, no `beforeinstallprompt`, icons without `purpose: "maskable"` | Android may not offer install, or may letterbox the icon | Needs a device |
| S4 | `.toast` bottom-fixed, sheets | The soft keyboard may cover the toast and the sheet's lower buttons | Headless has no keyboard |
| S5 | `Controller.tsx` `lost` / `pair-notice` | The "pairing was lost" notice when the TV is released from the TV's side | Not triggered (Forget by the phone gives none, correctly) |
| S6 | `shared/fullscreen.ts` | "Full screen on this phone" on iOS Safari (no Fullscreen API) | No Safari |

### 2f. First run against returning

- First run (new phone, no TV): pair screen only (Sign in pill, corner full-screen icon, Scan, code field, Watch on this device, three language radios); after pairing the home is the TV header, "What do you want to watch?", All / Movies / Series and library rows: no paste box (U18), no Continue, lists or ratings (f01).
- Returning, paired: a flash or a long stretch of the pair screen (U01); then the paste box (if switched on), Continue, lists, ratings, and only then search and the library, 1.3 screens down (U10) (f05, f06).
- Returning, new phone, signed in: with 2+ profiles two choosers (U03); the account's Continue and lists appear once a profile is chosen; a first sign-up adopts what the phone had ("What you watched here is now saved to Dana.", f10).
- Sign out: immediate; the phone then shows no Continue and no lists (they live in the account) and nothing says so (f10 5).
- Language: radios on the pair screen and in Settings, instant, `html lang` follows; ro and it fit every main screen at 390 px (f11, f18).

### 2g. Dead ends and missing buttons at a glance

- No absolute dead end: every screen has a way out (X, Esc, pull down, Back, chevron). The near ones: U09 (the welcome card has only "Start watching"), U04 (an error remote with three dead controls), U01 (a pair screen whose only live button is U09's).
- Missing: Try again on the phone (U04); Undo (U07) and a pending-request row (U24); a search entry in the header (U10); a Friends entry before its switch (U11); "Use as a remote" on the welcome card (U09); a share target (U12); volume or mute (U17); a "Finding video... Cancel" in view (U02).
- Checked and present: browsing while playing (Change video), back to Home (Stop), another TV (menu > My TVs), the TV's name and state in the header, language on the first screen.

## 3. Patterns

- PA. Everything starts at the top and the layout never uses the bottom: a top-down stack with banners inserted into it (U19, U21, U06, U10).
- PB. In-flight and failed states are invisible or dead: no wait indicator in view, no feedback for a lost connection, controls that look live after a failure, the pair form while connecting, a sent request that vanishes (U01, U02, U04, U05, U08, U24).
- PC. Two policies for destructive actions: data loss confirms inline, connection loss and removals do not, and nothing has Undo (U07).
- PD. 36-40 px is the house size for header, corner and inline buttons (U20, U21).
- PE. Features sit behind switches and depth with no route: Friends, the bell, the paste box, search, My TVs behind the menu (U10, U11, U12, U18).
- PF. The same job twice: two "Who's watching?", two toast systems, two names for the link box (U03, U18, U23).

## 4. Quick wins (each under an hour)

1. U19: one rule `.phone > .seek { margin-top: auto; }` in `controller.css` (tested at 4 sizes); then check the series remote and 360x740 in both looks.
2. U06: move the full-screen hint into the state line or a toast (do with 1).
3. U03: do not set `view = "picker"` in `AccountScreen.tsx:93` while `account.choosing`.
4. U05: dim Stop, Speed and Change video while `!online`, or toast on a failed `send`.
5. U04: disable transport and seek in the error state; add "Try again".
6. U02: "Finding video... Cancel" pill while resolving and the status line is out of view (copy the failure toast's pattern at `Controller.tsx:348-351`).
7. U10: sticky header plus a search icon.
8. U20 and U21: 44 px hit areas for `.icon-btn`, `.lib-pill`, `.lib-corner` buttons and `.state-action`.
9. U11: move "Use friends" under Ratings in Settings.
10. U08: library-origin failure wording in en, ro, it.

Not a quick win: U01 (remembered TV and a skeleton, about half a day with tests) and U07 (a confirm and an Undo pattern, one component).

## 5. Keep

- Sheets close five ways (X, backdrop tap, Esc, pull down, Back) with exactly one history layer each; Back peels title over ratings, page over hub, friend over friends correctly (f06, f11, f16, f17).
- The remote's own clarity: 86 px Pause, 64 px +-10, a seek bar with a drag bubble, Stop in the danger colour, labelled state ("Playing on TV F989"), Up Next countdown with Next episode.
- The pair screen: scan or type, auto-connect at the sixth digit, a cleared and focused field after a wrong code, localised messages, four distinct camera messages (blocked, none, busy, failed); the QR connects in about 0.3 s (f14).
- Resilience: reconnect on foreground, backoff, the waking-up line at 10 s, the offline banner with "Connect another TV", the remote returning by itself (f08, f09).
- A second phone joins through the menu's code, QR or link (`?control=`), lands straight on the running remote, and the first phone's count goes to "2 connected" (f33).
- The failure toast near the thumb, and the first-run "library isn't reachable / Try again" card with the paste box still there (f07, f21).
- The subtitle sheets: language list, delay row (-0.5 s / Reset / +0.5 s) and "Subtitle style..." with a live preview and "Back to the default look" (f31).
- A friend's invitation link works for a signed-out phone ("Sign in to add this friend"), for friends switched off (one-tap "Turn on friends") and for friends on ("Add" / "Not now"), even on a phone with no TV (f32).
- Inline confirmation for deleting lists, profiles, accounts and friends; TV sign-in approval with a clear sentence and "That's not me" (f10, f12, f16).
- Home remembers scroll and the search across title sheets and Play -> Stop (f23); with the TV offline Play still answers in words ("The TV is offline.", f08).
- Shared links (`?url=`, `?text=`) play once a TV exists and are not replayed by a reload (f25); sign-in fields have the right keyboard attributes (autocomplete, autocapitalize off, enterKeyHint).
- Romanian and Italian fit on every main phone screen at 390 px, no clipping or sideways scroll found (f18).

## 6. Open questions for the owner

1. Remote composition: dock to the bottom as tested (a calm empty band in the middle), or dock and use the middle for the poster or episode still? And should Stop stay in the lowest-left corner, where an accidental tap is easiest, or move up or get a confirm?
2. Back on the Remote: leave the site (today), or step up to Home while the video keeps playing (one more history layer)?
3. Session-ending actions (Forget, Disconnect, End party, Remove, x on Continue): inline confirm like lists, or one tap plus an Undo toast?
4. Friends: keep it off by default behind Settings, or show a one-line card in the account hub after the first sign-in?
5. First run: library-first with no paste box (today), or show the box until the first successful play? (And is volume/mute meant to stay on the TV's own remote, U17?)

## 7. Seen on the way (other areas)

- F: landscape 844x390: the remote's button row (y 400-464) is below the fold (page 480 > 390) and a title sheet shows only the poster, Play at y 442 inside a 335 px sheet (f26).
- E/F: "Watch on this device" TV UI at phone size has targets of 27-39 px: hero Play 76x27, rail icons 34x39, tiles 99x108 (f22).
- U1: a phone opened with a party link gets the TV-role card "Ready when you are / Press OK or tap to start" (f15); "Press OK" reads oddly on a touch screen.
- U1: the TV's error screen offers "Try again" and "Back to the library" (good); the phone cannot press them (U04).
- A/D: Settings is one flat 1,700 px page (language, colour, look, playback, link box, ratings, friends, subtitle languages) and the Menu sheet scrolls (749 > 642) with the Disconnect note cut at the bottom (f13).
- B/C: the pair-screen header has a bare full-screen icon beside the Sign in pill, no visible label (f24-cold-12s.png).

## Appendix: screen graph of the phone UI

All screens are one page at `/`; layers (sheets, pages, scanner) push one history entry each, so Back closes the top layer; at the root Back leaves the site.

| Screen | Reached by | Controls -> where they lead | Back does |
|---|---|---|---|
| Pair screen | first visit; Forget of the last TV; Disconnect; TV released; U01 while connecting | Sign in pill -> Account (guest); corner full-screen icon; Scan -> Scanner; 6 digits -> auto-connect -> Home; Watch on this device -> TV UI on this phone (U09); en / ro / it radios | leaves the site |
| Scanner overlay | Scan (pair screen, My TVs, Party, Sign in another device) | X, Esc, Back close it; a read code connects and closes in about 0.3 s; errors in place | closes the overlay |
| Home | paired; Stop; TV back online | header: bell (friends on) -> Bell sheet, avatar or Sign in -> Account, three-dots button -> Menu sheet; paste box -> lookup -> Remote; Continue card -> Remote; card + -> list toggle or picker; x -> removes (U07); list, rating and library cards and search results -> Title sheet; hold a card -> picker; Manage lists -> Lists sheet; See all -> Ratings sheet | leaves the site |
| Home, TV offline | the TV closes or sleeps | banner + Connect another TV -> My TVs sheet; Play answers "The TV is offline." | leaves the site |
| Remote | a video is loaded on the TV | seek; -10 / Play-Pause / +10; Previous / Next episode; chips -> Episodes, Subtitles and audio (-> Subtitle style), Source, Speed, Quality sheets; Stop -> Home (immediate); Full screen; Change video -> Link sheet; Up Next Cancel | leaves the site (U16) |
| Menu sheet | the three-dots button on Home or Remote | code + QR for more phones; Watch party -> Party sheet; My TVs -> TVs sheet; Full screen on this phone; Paste-a-link box switch; Disconnect (immediate -> Pair screen) | closes the sheet |
| My TVs sheet | Menu; offline banner | row -> switch (closes); Forget (immediate); name field; code field or Scan -> adds a TV and closes | closes |
| Party sheet | Menu | opens a party on mount: code, link + Copy, QR; add a screen by code or Scan; Make admin, Remove, End party (immediate) | closes |
| Title sheet | any card or result | Play or Resume -> closes -> Remote; list button; Rate; for a show: seasons and episodes | closes; over Link or Ratings sheets Back peels one layer at a time |
| Link sheet (Change video) | Remote | paste box and the library; a tile -> Title sheet stacked on it (U22); Play closes both -> Remote | closes |
| Account hub | avatar or Sign in pill | guest: sign-in form, My ratings, Settings; signed in: Manage profiles, Who's watching? (2+ profiles), Sign in another device, Friends (if on), My ratings (sheet), Settings, Devices, Password & security (inline delete), Sign out (immediate) | chevron or Back: one level up; at the hub it closes |
| Profile chooser | sign-in with 2+ profiles; a new device | tile -> Home; Add profile; Sign out; U03 puts a second page on top | leaves the site |
| Approve page | `?link=` or Account > Sign in another device | Sign it in or That's not me -> done -> Close | chevron -> Link page |
| Friends, friend, bell | Account; bell | find by tag or code, requests, a friend's lists and ratings; Remove friend (inline confirm); bell: Accept, Decline, Open Friends | chevron or Back |
| Party guest phone | `?party=` link or QR | TV-role card "Ready when you are" -> OK -> watches along; "Use this screen as a remote" | leaves the site |
