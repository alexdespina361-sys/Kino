# U1: User flows, pathing, missing buttons: TV

Auditor U1, 2026-10-13, branch `ui/polish-system` (a066388 + working tree), own server on :8826 (memory store, `LIBRARY=off`). Product files were not touched; the server is stopped.

## 1. Scope and method

Every flow in the brief was run on the TV page, not only read: first visit and welcome, home, browse / search / category, title page, play, resume from Continue, next and previous episode, episode list, audio / subtitles / speed, Favourites and own lists (add, remove, rename, move, delete), rate and note, pair a phone (code and QR page), unpair, sign up / in / out (code page, username form, empty password, approval from another TV), profiles (switch, add, edit, delete, forced chooser), friends (add by code and tag, accept, decline, view, ratings, ask to watch, remove, settings, recommend), watch party (host, join by pad, join by link, wrong link, guest page, end), settings (language, colour, look, playback, ratings, friends), leaving the player, Back from every page, library failing / empty / kind-empty, empty search, no history, no ratings, server away, slow lookup, hanging video, error card, end card, Up Next, full screen on and off (corner button, `f`, HUD button, first press, welcome).

- Method: keyboard only (arrows, Enter, Escape, Backspace, `f` `c` `n` `p`) at 1280x720; the editors also at 800x450 (compact); the mouse only for the corner, rail and tile buttons. A harness (`h.mjs`) prints after every key who has focus (testid, zone, row/col, label) and which screens are on, so each step below is an observed focus, not a guess. Guest and signed-in profiles; up to three accounts and TV pages at once for friends, approval and party.
- Environment: Playwright 1.64 Chromium (headless); the made-up catalogue of `scripts/ui-walk/lib.mjs` (32 films, 8 series; the first four films play `fixtures/long.mp4`, the rest fail on purpose); series, end and error cards by injecting `LOAD` from a paired phone's second socket; "server away" with a WebSocket proxy (as the e2e `serverDown`), a hanging video with `page.route`, a lookup that never ends with `page.routeWebSocket` (drops `TV_RESOLVING {active:false}` and the `LOAD`).
- Evidence (scratch, outside the repo): `C:\Users\Me\AppData\Local\Temp\claude\C--Users-Me-Desktop-WebPlayer\76a1c5e2-d0fd-4798-b844-5854cd44ef86\scratchpad\audit-U1\` holds about 50 scripts `p01..p48`, the logs of the last run in `logs/` and about 180 pictures in `shots/`. "Verified" cites them (p28, p36, EM1-..., ...).
- Not covered: a real TV (remote key codes, the system keyboard, Back on Tizen / webOS / VIDAA, a real panel), a real provider (resolver titles, audio-track and quality menus, episode chains after the first transition: the fixtures have none), real network loss (headless `setOffline` leaves the open socket up, so it was simulated), the party invite picker with a second friend's TV, QR scanning (U2 has it).
- Result: 0 P0, 2 P1, 9 P2, 9 P3 (20 findings: T01-T12 behaviour bugs, dead ends and missing buttons; T13-T20 design issues), plus 6 suspected (S1-S6). Section 2d is the per-screen "missing buttons" analysis, 2e the pathing analysis with press counts.

## 2. Findings

### 2a. Behaviour bugs, dead ends, missing buttons (most severe first)

| ID | P | Look | Where | What | Why it matters | Fix idea | Verified |
|---|---|---|---|---|---|---|---|
| T01 | P1 | both | `tv/Tv.tsx:1003-1008` (`playEpisode` -> `socketRef.current?.send`, nothing is kept pending), `:704-708` (the wait screen only follows a server message), banner `tv-banner` | While the server is away (banner "Reconnecting...", after 10-13 s "The server is waking up. A free server can take up to a minute; this carries on by itself.") Play and Resume do nothing visible: no spinner, no toast, the title page stays. When the server returns the press is not replayed: 9 s later the title page is still there and nothing plays | A cold start of the free host is a normal state of this product and Play is the first thing anyone presses; the TV looks frozen and the press is lost without a word | Show "Finding your video..." (with Cancel) at once and send the request when the socket opens; at the least a toast "Waiting for the server..." and a replay on open | ran it (p28; SD1-waking.png, SD2-play-while-down.png) |
| T02 | P1 | both | `tv/Tv.tsx:725` (`profileStore.playbackStarted` when `LOAD` arrives), `shared/progress.ts:76-79` (no playback yet: a card at position 0, moved to the front) | A video that is found but never plays (dead stream, or Cancel on the 10 s "taking longer than usual" card) leaves a Continue card first in the row: position 0, no time left. After a reload it is the first focus and the hero ("A broken one") | Continue is the first thing the home shows; each failed title sits in front of real progress and re-tries the same dead link on Resume; with titles that sometimes never play (the roadmap's own premise) the row fills with them | Write the card on the first `playing` (or after `STARTED_S` = 15 s), or drop a position-0 card when the load ends in error or Cancel (an e2e that expects "at once" needs a change) | ran it (p25b: 404 stream -> card at 0 min first, hero after reload; p43b: fresh profile, Cancel on the stuck card at 10 s -> a new "Continue watching" row holding one card, position 0) |
| T03 | P2 | both | `account/Lists.tsx:32-33,110-126`, `account/Profiles.tsx:87-88,163-181` (`confirming` state; the question unmounts, nothing refocuses "Delete") | "Delete list" / "Delete profile" asks with Cancel focused (good). Cancel or Back closes the question but focus drops to the page (nothing focused): the next arrow lands on the name field at the top and Delete is 7 presses (list, 1280x720) or 4 (profile) away again | After the one question the user has to find the place again; the unfriend page does restore focus (to "Remove friend") | After `setConfirming(false)` focus the Delete button (`ref` + effect) | ran it (p10f, p13b) |
| T04 | P2 | both | `tv/Friends.tsx:38` (`takers.length === 1` preselects), `FriendPickerTv` | "Recommend to a friend" with exactly one friend opens with that friend ticked and focused; the natural first press (OK on the focused friend) un-ticks him and disables Send, and the next Down lands on Cancel | The one-friend case is the common one for a new user; the first press undoes the helpful default | Tick nobody and focus the friend, or keep him ticked and focus Send | ran it (p19: `tv-friend-pick` true -> false, `tv-friend-send` disabled) |
| T05 | P2 | both | `tv/pages.ts:337-340` (`empty` text only), EM1-ratings-empty.png, EM2-history-empty.png | "My ratings" and "History" with nothing in them are one line of grey text: no button, no focus (Down does nothing, Up goes to the account chip). "No movies here" and "Nothing in the library yet" do offer Home / Try again | The first visit of every new profile to these pages ends on a blank page with no next step | An empty-state button ("Find something to watch" -> Home) as the first focus | ran it (p36, p38) |
| T06 | P2 | both | `tv/RateOverlay.tsx:114-127` (`remove()` on press) | "Remove rating" deletes the score and the written note at once and puts focus back on the scores; no confirm, no Undo (stored ratings `[]`, note gone). It sits next to "Done" | A note is typed with the on-screen keys; one stray OK deletes it | Inline confirm when a note exists, or keep the note until Done | ran it (p11b) |
| T07 | P2 | both | `tv/Party.tsx:229,500` (`tv-party-end`), `tv/Idle.tsx:283` (`tv-disconnect`), `tv/Account.tsx:414` (`tv-sign-out`), home hero `tv-hero-remove` | End party (host page and in-player panel), Disconnect from phone, Sign out and Remove from Continue all act on the first OK: no confirm, no Undo, no toast (`toasts: []`, card gone). Deleting a list, a profile or a friend asks first | End party drops every guest's picture at once; two policies for destructive actions (the phone has the same, U07) | One inline confirm for End party; an Undo toast (5 s) for Remove from Continue; Sign out / Disconnect may stay one press (open question 4) | ran it (p20, p21, p23, p14, p42) |
| T08 | P2 | both | `tv/Hud.tsx:436-445` (always `FullscreenIcon`, label `hud.fullscreen`), `shared/FullscreenToggle.tsx` (swaps), i18n `hud.fullscreen` "Fullscreen" vs `remote.fullscreen` "Full screen", `tv/Tv.tsx:1120` (idle: returns before the `fullscreen` action) | In the player the full-screen button says "Fullscreen" with the enter icon whether the page is full screen or not (label unchanged at `full = true` and `false`); the corner button on the library pages swaps to "Exit full screen"; the TV spells the word two ways; `f` does nothing on the library pages | A toggle that does not show its state; one word spelt two ways | Use `FullscreenToggle` in the HUD; one spelling ("Full screen") in en / ro / it; let `f` work on the library pages | ran it (p31) |
| T09 | P2 | both | `tv/Friends.tsx` `AddFriendTv` + tag page, friends page (`tv/pages.ts`) | After "Send request" the only trace is a toast ("Request sent to Cyjuh#1"); the Friends page lists no waiting request, so a sender can neither see nor cancel one | A request to a mistyped tag stays out there; the phone has the same gap (U24) | A "Waiting for Cyjuh#1 - Cancel" tile under Your friends | ran it (p18) |
| T10 | P3 | both | `tv/Hud.tsx:203-210` (no `data-nav`), `tv/tv.css:654` (permanent white ring on "Watch now"), `tv/Tv.tsx:1113-1117,1147-1152,1171-1176` | Up Next ("Next episode in 15 s"): "Watch now" carries a white ring while nothing is focused, and neither button can be reached with the arrows (Down goes to Pause). OK = Watch now and Back = Cancel work only while no control is focused: with Pause focused OK pauses and the first Back only drops the focus | The ring says "focused" when nothing is; a viewer who walks down to "Cancel" pauses the film instead | Make the two buttons `data-nav` (the first arrow lands on Watch now), or drop the ring and print the key hint | ran it (p09b: outline solid 3px white while unfocused; Down -> Pause; Enter -> paused) |
| T11 | P3 | both | `tv/Browse.tsx` bell page and request overlay (~1263-1281) | Bell -> a request -> Accept (or Decline): the whole bell closes and focus returns to the bell chip; two waiting requests cost bell -> request -> answer, twice | A batch costs one round trip per item | Return to the bell page after an answer (it already lists the rest) | ran it (p16b: "2 waiting" -> Accept -> closed, "1 waiting") |
| T12 | P3 | both | `tv/Account.tsx:430-470` radio rows, `tv/dpad.ts` (geometric pick) | Settings is one geometric grid: from "Play the next episode automatically" Up lands on "Refined" (the last look radio), then "Green", then "Română", not on the selected radios; Right at the end of the look row jumps to "Orange" in the colour row and the next OK applies it (accent changed) | A TV user expects to land on the selected radio; one stray Right + OK changes the colour | Land on the selected radio when entering a group (`data-autofocus`); stop Right at the end of a group | ran it (p22b) |

### 2b. Design issues (nothing behaves wrongly)

| ID | P | Look | Where | What | Why it matters | Fix idea | Verified |
|---|---|---|---|---|---|---|---|
| T13 | P2 | both | typing: `account/Lists.tsx` (list name), `tv/RateOverlay.tsx:137-175` (note), search: the page's own on-screen keys; `account/AuthForm.tsx` (username, password), `account/Profiles.tsx` (profile name), `tv/Friends.tsx` `TypeCode` / `TypeTag`: a native `<input>`; party join: a digit pad (`pad-0..9`); at 800x450 the keys are hidden (CP1-list-editor.png) | Sign-in form, profile name, friend code and friend tag need a system keyboard; lists, notes and search have their own keys; the party code has a pad, the friend code (8 characters) has none | On a TV browser with no or a poor system keyboard those four cannot be finished (sign-in has the code page as an alternative, the others have none); the same job feels different in each place (the real-TV part is S3) | One on-screen keys component for every TV text field (names, tags, passwords), the digit pad for codes; the native input stays for a connected keyboard | ran it (p12, p13, p18, p20; CP1) |
| T14 | P2 | both | `tv/Tv.tsx:1366-1367` (`onAccount`: signed in -> panel, guest -> sign-in code page; `onSettings` from Profile -> Settings) | A guest (the default state of a new TV) reaches Settings (language, colour, look, autoplay) only through Profile -> Settings: 13 presses from the first Home tile (Left, 7 Down, OK, 3 Right, OK); signed in it is 3 (Up, Up, OK on the chip). The same corner chip says "Sign in" for a guest and opens the code page, not Settings | The person who needs Settings first has the longest route; one chip, two destinations | A gear beside the chip (or the chip opens the Profile hub for a guest); Settings in the rail | measured (p45: 13 presses; p13: 3) |
| T15 | P3 | both | `tv/Idle.tsx:280` (comment: "the first press only lands on a button"), `Screen` without `focus`: Connect, paired page, sign-in code page, approve confirm | These pages open with nothing focused: the first arrow or OK only lands on a button ("Back to the library", "Use a username and password instead", "Sign it in"), the second acts (approve needs two Enters). Deliberate: OK never presses what you have not seen focused | The first OK feels dead, and on the sign-in page it lands on a secondary action | First focus on the primary action where nothing is risky (Connect, sign-in code page); keep the landing rule for the approval | ran it (p07 N4, p12, p39) |
| T16 | P3 | both | `tv/Idle.tsx:226-241` (`stuck` after `SLOW_AFTER_MS` = 10 s), `tv/Tv.tsx:1123-1127` | "Finding your video..." is a bare spinner for 10 s, then "This is taking longer than usual." and Cancel appear. Back cancels at any moment (tried at 3 s) but nothing says so; same for a video that will not start (OK or Back cancel; card at 10.3 s) | Ten seconds of a screen with no visible way out | Print "Back to cancel" under the spinner from the start | ran it (p43, p44; ST-stream-13s.png) |
| T17 | P3 | both | Back handling on Home (p32b) | Back on Home opens the rail, Back again closes it, and so on: from no page does Back leave Kino | A user who wants out needs the TV's Home button (opinion: many TV apps ask "press Back again to exit") | After the second Back show "Press Back again to leave" and leave on the third (`history.back()` / blank page) | ran it (p32b: Home, rail, Home) |
| T18 | P3 | both | Home rows (`tv/Browse.tsx`), `rail-categories` | A Home row has no "See all": rows end on a normal tile (8-12 tiles on the mock home); the full list of a row is Categories -> the category (5 presses to the grid, then a pick); Favourites and own lists are My Lists (6) | A row is a teaser with no door to the rest | A last "See all" tile that opens the category page | ran it (p04, p48) |
| T19 | P3 | both | `tv/Hud.tsx` control bar, `tv/keys.ts` (`m`) | The player has Mute but no volume (the TV's own remote does volume; the phone remote has none either, U17) | A PC browser or a party room has no volume step on screen | (opinion) leave it, or volume on a key | read the code, p05 |
| T20 | P3 | polish | `account/Lists.tsx:122`, `account/Profiles.tsx:177` (`buttonClass("danger")`), CP2-list-editor-bottom.png | At 800x450 the focused "Delete list" / "Delete profile" is a white bar from edge to edge and its ring is cut by the viewport (ring spans -7..807 px of 800) | The one clipped focus ring is on the destructive button | Inset the ring or pad the compact page by the ring width | measured (CP2) |

### 2c. Exact repro steps for the behaviour bugs

Preconditions: 1280x720, guest or signed in as noted, library loaded, welcome gone. "Lab" says how the test made the condition; on a device the same effect comes from a cold host, a dead provider or bad Wi-Fi.

- T01: 1. Open `/tv`, wait for Home. 2. Make the server unreachable (lab: a WebSocket proxy that never answers); the banner reads "Reconnecting..." and, from 10-13 s, "The server is waking up...". 3. OK on the first Continue tile (title page), OK on "Resume" (or "Play"). 4. Nothing changes (SD2-play-while-down.png). 5. Let the server answer again; 9 s later the title page is still open, nothing plays, the press is gone.
- T02: 1. Home with a Continue row. 2. Start a title that is found but cannot play (lab: `LOAD` with a missing .mp4) or press Cancel on the 10 s "taking longer than usual" card. 3. Error card "This video can't be played on the TV." -> Back to the library. 4. The Continue row starts with the failed title at 0 min, ahead of the real ones; reload: it is the first focus and the hero.
- T03: 1. Rail > My Lists > Edit list (an own list). 2. Down x7 to "Delete list", OK. 3. Cancel is focused: OK (or Back). 4. Nothing is focused; Down lands on the name field. Same in Settings > Manage profiles > a profile, Down x4 to Delete.
- T04: 1. Two signed-in accounts, friends. 2. Title page > "Recommend to a friend". 3. The friend is ticked and focused; OK: un-ticked, Send disabled.
- T05: 1. Profile > My ratings (or History) on a profile with none. 2. One line of text; Down: nothing; Up: the chip.
- T06: 1. Title page > Rate > a score > Add a note > type > OK. 2. Focus "Remove rating", OK. 3. Score and note are gone, no question.
- T07: 1. Rail > Watch party > Start a party > "End party" (OK): the party ends, guests are dropped (PP5, PP6). 2. Settings > Sign out: signed out at once. 3. Home hero > "Remove from Continue watching": gone, no toast.
- T08: 1. Play a title, Down to the full-screen button, OK: the page goes full screen, the label still says "Fullscreen". 2. On Home press `f`: nothing.
- T09: 1. Profile > Friends > Add a friend > Find a friend by tag > type a tag > Find > Send request. 2. Toast, then the Friends page with no waiting entry.
- T10: 1. An episode with a next one; at the last 15 s "Up Next". 2. Down: Pause is focused; OK: the film pauses.
- T11: 1. Two waiting requests. 2. Up x2 to the bell, OK, OK on a request, Accept: the bell closes; label "1 waiting".
- T12: 1. Settings as a guest. 2. Right from "Sign in" lands on the autoplay switch; Up x3: Refined, Green, Română.

### 2d. Missing buttons, per screen ("what would a user want here?")

| Screen | Exists | Missing or weak |
|---|---|---|
| Welcome | Start watching (OK or any key); Back = not now (S1) | no language choice (it follows the browser) |
| Home | rail (Left / Back), account chip, bell (friends on), full-screen corner, hero Play / Resume + Remove from Continue, tile corner +/x (mouse) | Settings for a guest (T14), "See all" on a row (T18), any way to leave (T17) |
| Rail | Search, Home, Movies, Series, Categories, My Lists, Watch party, Connect a phone / "Phone connected", Profile | Settings, Friends and Sign out are only inside Profile (guest: 9 presses to the hub) |
| Title page | Play / Resume, Add to Favourites (picker with 2+ lists), Rate, Recommend (friends on), Remove from Continue, Close, Back | nothing important |
| Search | keys + space / delete / clear, All / Movies / Series chips, results, Back, text remembered | nothing important |
| Movies, Series, Categories | rows / grid, Back; kind-empty "No movies here" + Home | sort / filter (idea) |
| My Lists | Favourites + own lists as chips, New list, Edit list, tiles | no Remove-from-list on a tile for the remote (title page > "Remove from Favourites": 3 presses) |
| List editor | name + keys, Save, Cancel, Move left / right, Delete (not for the first list), Back | nothing missing (focus after Cancel: T03) |
| Profile hub | My ratings, (Friends), History, Settings, Sign in | Sign out and Switch profile (signed-in panel only) |
| Ratings, History | tiles, Back | empty-state action (T05), clear history, remove one history entry |
| Rate | seasons scope, scores 1-10, Add / Edit note, Remove rating, Done, Back | Undo for Remove (T06) |
| Settings panel | account block (Switch profile, Manage profiles, Sign in another device, Sign out, Back), language, colour, look, autoplay, tap to pause, ratings, friends | the link-box switch (phone-only by design), a Back at the top (Back key and a button at the foot of the left column exist) |
| Sign in | code page (QR + code, "Use a username and password instead", Back); form (Sign in, Create an account, Use another device); empty-password warning page | show password (the phone has the eye), nothing else |
| Approve | Sign it in, That's not me, Back; "Done" | nothing |
| Who's watching | profiles, Add profile, Manage profiles, Back (not in the forced picker), Sign out | nothing (forced picker: Back does nothing, Sign out is the way out) |
| Profile editor | name, avatars, Save, Cancel, Delete (not for the only profile) | focus after Cancel (T03); no on-screen keys (T13) |
| Friends | friend tiles, Add a friend (code / type a code / tag), Friends settings, Back chain; friend page: Lists / Ratings, Ask to watch together, Remove friend (confirm page) | waiting requests (T09) |
| Bell | request list, Open Friends, Back; request: Accept, Decline, Back | stay in the bell after an answer (T11) |
| Connect / paired | code + QR, Back to the library, Use this screen as a remote; paired: Back to the library, Disconnect from phone | nothing |
| Party | start page (Start, Join, Back); host (Copy link, Invite friends, members with Make admin / Remove, Back to the library, End party); join pad; guest (Full screen, Stop watching along) | End party confirm (T07) |
| Resolving | Back at once, Cancel after 10 s | a visible way out before 10 s (T16) |
| Player HUD | Pause, -10, +10, Previous / Next episode, Episodes, Audio & subtitles, Speed, Watch party, Mute, Full screen, Stop | volume (T19), a state-showing full-screen button (T08) |
| Up Next, End card, Error card | Watch now / Cancel; Next episode, Back to the library, Watch again; Try again, Back to the library | focusable Up Next buttons (T10) |

### 2e. Pathing

Back, from the pages that matter (all run in p32b / p17c / p30 / p44 / p46; focus lands on the tile, chip or button you came from unless noted):

| From | Back goes to | Then |
|---|---|---|
| Search, Movies, Series, Categories, My Lists, Watch party, Connect, Profile | Home (first tile) | Back opens the rail, Back closes it: never leaves (T17) |
| My ratings, History, Settings (Profile hub) | Profile hub (the tile you came from) | Home, then the rail |
| A category | Categories (that category), then Home | the rail |
| Title page (from rows, search, a friend's ratings) | the tile it was opened from | - |
| Friend page | Friends (that friend), Profile (Friends tile), Home | 3 Backs |
| List editor / its question | Cancel / "No" (T03: focus lost) | - |
| Rate page, note editor | Title page (Rate button) / Rate page, note kept | - |
| Unfriend page | Cancel (focus back on "Remove friend") | - |
| Player, HUD hidden | shows the HUD, keeps playing | HUD visible: leaves to the library, focus on the tile that was played; with a control focused: first Back drops the focus |
| Up Next | Cancel (the countdown stops) | only while no control is focused (T10) |
| Resolving, stuck video | cancels at once (OK also, for a stuck video) | - |
| Player menus | closes; focus back on the button that opened it; Subtitle style -> Audio & subtitles | - |
| Forced "Who's watching?" | does nothing (choose or Sign out) | - |
| Party link screen "Press OK or tap to start" | does nothing (OK starts; a wrong code says "That party is not open any more.") | - |
| Party guest page | focuses "Stop watching along", leaving stays an OK | - |

More than one way to the same place:
- Settings: Profile -> Settings (everyone, 13 presses as a guest) and the chip (signed in only, 3). Sign in: the guest chip, Profile -> Sign in and Settings -> Sign in all end on the same code page (consistent).
- Full screen: corner button, HUD button, `f` (player only), the first key press, the welcome button, the phone's button. Three different labels and two spellings (T08).
- Lists: rail My Lists, the title page's list button, the tile corner x (mouse), Favourites as a Home row.
- Party: rail Watch party, the HUD chip, the phone, a `?party=` link. Friends: Profile, the bell, Recommend on a title, the party invite. Next episode: Up Next OK, HUD button, `n`, Episodes, end card.
- Leave the player: Back (twice), Stop, `s`, end card / error card buttons.

Enter but cannot leave: none absolute. Near ones: the forced "Who's watching?" (Back dead, Sign out is the exit), the party link screen (Back dead until OK), the paired page (first press only lands), Home (never leaves, T17).

Press counts (guest, 1280x720, from the first Home tile; measured in p03b, p04, p05, p07, p20, p30, p45):

| Task | Presses |
|---|---|
| Play the first title / resume the first Continue card | 2 (OK, OK) |
| Add to Favourites / rate it 9 | 3 (OK, Right, OK) / 7 |
| Open Search / Movies / Categories / My Lists | 3 / 3 / 5 / 6 |
| Connect a phone / Watch party start page / Profile hub | 8 / 7 / 9 |
| Settings as a guest / signed in via the chip | 13 / 3 |
| Subtitles from the HUD / with `c` | 7 (Down, 5 Right, OK) / 1 |
| Next episode: Up Next / HUD (episode 1, no Previous button) / `n` | 1 / 5 (Down, 3 Right, OK) / 1 |

### 2f. Suspected, not reproduced

| ID | Where | What | Why unproven |
|---|---|---|---|
| S1 | `tv/Idle.tsx:148-156` (Back = "not now") against `shared/fullscreen.ts:120-128` (any trusted key but Escape enters full screen) | On a TV whose remote sends Backspace / GoBack for Back, the first-run welcome may go full screen instead of "not now" (headless counted Escape as a press too: Escape, ArrowRight and Enter all ended full screen, p15) | Needs the real remote's key codes |
| S2 | `shared/progress.ts:35,68` (`nameOf` uses `media.title`), `shared/media.ts:83` (the hint has no title) | The Continue card and the HUD take the resolver's title: with the mock "Salt and Ember" became "long" after one play (p35). A real provider's page title may differ from the library's name the same way | Needs a real provider |
| S3 | `account/AuthForm.tsx`, `account/Profiles.tsx`, `tv/Friends.tsx` (native inputs) | Sign-in form, profile name, friend code and tag may be impossible on a TV browser with no system keyboard | Needs a real TV |
| S4 | `tv/Episodes.tsx`, audio and quality menus | Audio-track and quality menus, and the chain of episodes after the first transition: the fixtures have no tracks, and the resolver fixture returns no series info | Fixture limit |
| S5 | `tv/Party.tsx` invite picker | "Invite friends" end to end (host invites, the friend's TV accepts) | Needed a second signed-in TV of a friend; the page opens |
| S6 | `tv/Tv.tsx` banner logic | A real offline (airplane mode): the banner was produced by a socket proxy, and a real TV may fire `offline` events first | Headless `setOffline` leaves the socket open |

## 3. Patterns

- PA. The TV acts before the world has answered: it sends into a closed socket and forgets (T01), and it files the Continue card when the video is handed over, not when it plays (T02).
- PB. Focus is dropped or wasted at the moment a page changes state: after a confirm (T03), on an empty page (T05), on pages whose first press only lands (T15), on radios that are not where you left (T12).
- PC. Two policies for destructive and session-ending actions: data loss asks, the rest is one press with no Undo (T06, T07).
- PD. Controls that do not show or reach their state: the HUD full-screen button, Up Next's ring, the radio rows (T08, T10, T12).
- PE. One job, two methods: typing (keys, pad, native input), Settings (chip or Profile) (T13, T14).
- PF. Waiting and empty states with no visible next step: empty Ratings and History, the first 10 s of "Finding", a sent request that vanishes (T05, T16, T09).

## 4. Quick wins (each under an hour)

1. T03: refocus "Delete" after Cancel / Back in `Lists.tsx` and `Profiles.tsx` (a `ref` and one effect each).
2. T04: tick nobody in the one-friend picker, or focus Send.
3. T05: an empty-state button as the first focus on Ratings and History.
4. T08: `FullscreenToggle` in the HUD, one spelling in en / ro / it, `f` on the library pages.
5. T01: a toast "Waiting for the server..." when the send finds the socket closed; replay on open if there is time.
6. T10: `data-nav` on the Up Next buttons (or print "OK: watch now - Back: cancel").
7. T11: return to the bell page after Accept / Decline.
8. T06: inline confirm on "Remove rating" when a note exists.
9. T16: "Back to cancel" under the resolving spinner.
10. T07: inline confirm on "End party" (the same pattern as the list question).

Not quick: T02 (move the Continue write to the first `playing` and adapt the e2e), T13 (one keys component for every field), T09 (a pending-request tile).

## 5. Keep

- Back is layered and predictable: every page peels one layer and puts focus back where you came from (tile, chip, category, friend); Home's Back opens the rail; Back at a hidden HUD shows it (p32b, p17c, p46).
- The player: Back / OK / arrows, Up Next with a countdown, an end card (Next episode, Back to the library, Watch again), an error card (Try again, Back to the library), a stuck card at 10 s with Cancel (OK or Back cancel), subtitles with delay and a style page, `c` for captions, "Previous / Next episode" with names (p05, p09b, p25b, p30, p43).
- Waiting is honest on the library pages: "Reconnecting..." then "The server is waking up. A free server can take up to a minute; this carries on by itself.", and the library keeps answering keys (p28).
- Library failure states each have a way on: "The library isn't reachable right now" + Try again, "No movies here" + Home, "Nothing in the library yet" + Try again (p38).
- Lists: one editor for create, rename, move and delete, duplicate names handled, delete asks first with Cancel focused and Back = "No" (LD4-clash.png, p10g).
- Dangerous pages default to the safe choice: unfriend (Cancel focused, focus back on "Remove friend" after), sign-in approval ("Sign it in" after landing, a clear sentence, "That's not me") (p17c, p39).
- Sign-in: the code page first (QR + code), the username form as the alternative, a warning page before an empty password; a forced "Who's watching?" after signing in with 2+ profiles; Manage profiles with Add, Edit, Delete (p12, p13, p14).
- Friends: the bell label "Notifications, 2 waiting", request pages with Accept / Decline / Back, friend pages with Lists / Ratings tabs and "Ask to watch together", a toast for each answer (p16b, p17c).
- Party: a host page with the code, the link and Copy, "Waiting for the others...", a digit pad for joining, a guest page whose Back points at "Stop watching along", a wrong link says "That party is not open any more." (p20, p41, p47).
- Rate: starts at 7, the note button is disabled until a score exists, Back in the note editor leaves the earlier note alone, a live word ("Great") (p11b).
- The corner full-screen button swaps its label to "Exit full screen" and the choice is remembered; the mouse paths (rail on rest, corner +/x) work (p31, p33b).
- Short routes for the main tasks: 2 presses to play or resume, 3 to favourite, 7 to rate (p45).

## 6. Open questions for the owner

1. T02: should a title that never played appear in Continue at all (write the card on the first `playing`), or stay and be marked "didn't play"?
2. T17: Back on Home: keep the rail toggle forever, or "press Back again to leave" (and navigate away on the third)?
3. T13: one on-screen keyboard for every TV field (even passwords), or native inputs wherever the TV has a system keyboard?
4. T07 (and U2's question 3): session-ending actions (End party, Sign out, Disconnect, Remove from Continue): inline confirm like lists, or one press plus an Undo toast, the same rule on TV and phone?
5. T14: should a guest get a Settings entry beside the chip, or should the chip open the Profile hub?

## 7. Seen on the way (other areas)

- H: the rail's party badge is an unlabelled `<i className="tv-rail-badge">`, so the item's accessible name reads "Watch party2" (`tv/Rail.tsx`, p20).
- E / F: at 800x450 the list and profile editors lose the on-screen keys and show only the native input (CP1-list-editor.png); the focused Delete button runs edge to edge (T20).
- A / D: "Remove from Continue watching" sits beside Play on the home hero (SD1-waking.png) but wraps to a second row on the title page (SL2-finding-slow.png, LF3-confirm-up.png): one action, two layouts.
- U2: the same gaps exist on the phone: a sent friend request is invisible (U24 = T09) and session-ending actions are one tap (U07 = T07).
- G / I: the server log of the whole run has no warn or error lines; the only console error was the 404 of the deliberately missing video.

## Appendix: screen graph of the TV UI

One page at `/tv`; screens swap in place and the browser history is not used, so Back is the app's own (`useBack` / `useBackFirst`). "Remembered" = view, query, focus and open title are restored on return.

| Screen | Reached by | Controls -> where they lead | Back does |
|---|---|---|---|
| Welcome | first visit on a screen that is not full screen | Start watching / any key -> full screen + Home; fades by itself when full screen was left once | Home without full screen (S1) |
| Home | start; Back from any library page | hero Play / Resume -> Resolving; Remove from Continue; tile -> Title page; Left -> Rail; Up -> hero -> chip / bell / full-screen toggle | opens the rail, again closes it (T17) |
| Rail | Left or Back on Home; pointer at rest | Search, Home, Movies, Series, Categories, My Lists, Watch party, Connect a phone, Profile; Right closes | closes |
| Title page | tile, search result, friend's rating | Play / Resume -> Resolving; Add to Favourites -> picker; Rate -> Rate; Recommend -> Friend picker; Remove from Continue; Close; a show: seasons and episodes | closes; focus back on the tile |
| Search | rail | keys, space, delete, clear, All / Movies / Series, results -> Title page | Home (text remembered) |
| Movies / Series / Categories / category | rail; a category tile | rows or grid -> Title page; a category tile -> category page | up one level, then Home |
| My Lists | rail | chips, New list / Edit list -> List editor; tile -> Title page | Home |
| List editor | New list / Edit list | name + keys, Save, Cancel, Move, Delete -> question (Cancel focused) | Cancel; in the question "No" (T03) |
| Profile hub | rail | My ratings, (Friends), History, Settings, Sign in | Home |
| Ratings, History | Profile hub | tiles -> Title page | Profile hub |
| Rate / Note editor | Title page | scores, seasons scope, Add note -> Note editor, Remove rating (T06), Done | Title page / Rate page |
| Settings panel | chip (signed in); Profile -> Settings | account block, language, colour, look, autoplay, tap to pause, ratings, friends; Sign out | previous page |
| Sign in | guest chip; Profile -> Sign in; Settings -> Sign in | code page -> "Use a username and password instead" -> form (Sign in, Create an account, Use another device) -> warning page (empty password) -> forced picker (2+ profiles) | previous page |
| Approve | Settings panel -> Sign in another device | code field -> confirm (Sign it in / That's not me) -> Done -> Settings panel | previous page |
| Who's watching / Manage / Editor | Settings panel; after sign-in | profile -> Home; Add profile; Manage profiles; editor Save, Cancel, Delete -> question; Sign out | up one level (forced picker: nothing) |
| Friends / friend page | Profile -> Friends; bell | friend tiles, Add a friend (give a code, type a code, find by tag), Friends settings; friend: Lists / Ratings, Ask to watch together, Remove friend -> confirm page | up one level (3 Backs to Home) |
| Bell, request | bell chip | request -> Accept / Decline / Back; Open Friends | closes (T11) |
| Connect, paired | rail | code + QR, Back to the library, Use this screen as a remote; paired: Back to the library, Disconnect from phone | Home |
| Party | rail; HUD chip | start page (Start, Join, Back) -> host page (Copy link, Invite friends, members, Back to the library, End party) or join pad -> guest page (Full screen, Stop watching along) | Home (host's party goes on); guest: focuses the leave button |
| Party link screen | `/tv?party=CODE` | OK -> guest page, or Home with "That party is not open any more." | nothing |
| Resolving | Play / Resume | Cancel after 10 s | cancels at once |
| Player | a video loads | HUD: Pause, -10, +10, Previous / Next episode, Episodes, Audio & subtitles (-> Subtitle style), Speed, Watch party, Mute, Full screen, Stop; OK pause; Up Next card; End card; Error card; stuck card | HUD hidden: shows it; visible: leaves to the library (focus on the played tile) |
