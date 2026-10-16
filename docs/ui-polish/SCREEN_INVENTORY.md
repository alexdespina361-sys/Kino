# Screen inventory

Every screen of the app, how the walk reaches it, and the pictures that show it. Pictures are in `.ui-polish/shots/<look>/<device>/<name>.png` (git-ignored; regenerate with `pnpm ui:walk`; there is one look now, so the folder is `polish`).
Devices: `tv-1280` (1280x720, everything, signed out), `tv-1920`, `tv-2560`, `tv-1440x900`, `tv-1366x768` (the main screens), `tv-1280-signed-in` / `tv-1920-signed-in` (friends, ratings, history, account, party, bell), `phone-390`, `phone-390-signed-in` (390x844).
The *routes between screens* (the graph, with the key that does each step and what Back does) come from the flow audits (`audits/U1-flows-tv.md`, `audits/U2-flows-phone.md`) and are summarised in `ISSUES.md`.

Who sees what: a **desktop browser without touch** and `/tv` get the TV UI; a **phone or tablet** gets the remote UI (`role.ts`). The TV UI is sized in `em` (1em = 1% of the screen width), so 1280 and 1920 are the same picture.

## TV UI (`/tv`, remote / keyboard / mouse)

| # | Screen | Reached by | Main things on it | Pictures (tv-1280 unless noted) |
|---|---|---|---|---|
| T01 | Welcome | first visit | wordmark, greeting, "Start watching" (goes full screen) | `01-welcome` |
| T02 | Home (hero + rows) | opens here; rail Home | hero (title, meta, Play/Resume, Add/Remove), rows: Continue watching, Favourites, own lists, My ratings, catalogue rows; rail; sign-in chip; full-screen button; corner +/x on tiles with a mouse | `02-home`, `03-home-scrolled`, `04-rail-open` |
| T03 | Movies / Series | rail | the same page filtered | `05-movies`, `06-series` |
| T04 | Categories | rail | category cards | `07-categories` |
| T05 | Search | rail | on-screen keyboard, filter chips (All / Movies / Series), results grid; typed text works on a keyboard | `08-search` |
| T06 | Lists (Favourites + own) | rail "My Lists" | list chips, tiles, new / edit list | `09-lists-favourites`, `10-list-weekend` |
| T07 | Title page: film | select a tile | eyebrow, title, year, synopsis, Play, Add to a list, Rate, Close | `11-detail-movie` |
| T08 | Title page: series | select a tile | as T07 plus seasons and episodes | `12-detail-series`, `12b-detail-series-episodes` |
| T09 | Rate | title page "Rate" | ten score keys, note, Done | `13-rate`, `14-rate-note` |
| T10 | List picker / editor | title page "Add to a list" | rows of lists, New list, name keyboard | `15-list-picker`, `16-list-edit` |
| T11 | Profile hub | rail Profile | cards: My ratings, History, Sign in / Friends, Settings | `17-profile-guest` (signed in: `s02-profile-hub`) |
| T12 | History / Ratings | profile hub | tiles with x / +, scores | `18-history`, `19-ratings` (signed in: `s11-ratings`, `s12-history`) |
| T13 | Settings / account panel | profile hub, account chip | language, playback, link box, look, friends switch, sign out, manage profiles, approve another screen | `20-settings` (signed in: `s13-account-panel`) |
| T14 | Sign in (code) / form | account chip | steps, code, QR, "use username and password instead" | `21-signin-code`, `22-signin-form`, signed in: `s00-signup-form` |
| T15 | Profiles (manage / add) / approve a screen | account panel | profile tiles, name keyboard, code field | `s14-manage-profiles`, `s15-profile-add`, `s16-approve-another-screen` |
| T16 | Connect a phone | rail | code, QR, steps, phone list | `23-connect` |
| T17 | Watch party: start / join / hosting / invite friends | rail | start or join cards, 6-digit keypad, hosting code/QR/link, friend invite | `24-party-start`, `25-party-join`, signed in: `s17-party-hosting`, `s18-party-invite-friends` |
| T18 | Friends: page / a friend / add / code / tag / settings | profile hub (signed in, friends on) | friend tiles, requests, add-a-friend cards, give a code, find by tag, privacy switches | `s03-friends-page`, `s04-friend-page`, `s05-add-friend`, `s06-friend-give-code`, `s07-friend-tag-page`, `s08-friend-settings` |
| T19 | Bell / a friend request | bell in the top-right corner | request list, accept / decline | `s09-bell-two-requests`, `s09b-friend-request`, `s10-bell-after`, `s01-home-with-bell-badge` |
| T20 | Player: HUD | Play | title, episode, clock, scrubber, play/pause, skip 10, speed/audio, party, full screen, stop | `26-player-hud` (+ `26b-player-hud-live` over a real frame), signed in: `s19-player-hud-signed-in` |
| T21 | Player: audio / subtitles / speed menu | HUD | list of tracks / speeds | `27-player-audio-menu` |
| T22 | Player: party panel | HUD | start / join a party over the film | `28-player-party-panel` |
| T23 | Player: picture only | HUD hidden | nothing | `29-player-clean` |
| T24 | Player: error / stuck / tap-to-play / toasts | (not walked: needs a failing video) | "this would not play", retry, change source | covered by e2e only |
| T25 | End card (next episode) | (not walked: needs playback to the end) | countdown, next / replay | covered by e2e only |

## Phone UI (`/`, touch)

| # | Screen | Reached by | Main things on it | Pictures (phone-390) |
|---|---|---|---|---|
| P01 | Pair | opening `/` with no TV | code field, Scan, steps | `p01-pair` |
| P02 | Home | after pairing | header (TV name + status, Sign in / avatar, bell, "..."), paste-a-link box, rows (Continue, Favourites, lists, My ratings), search, filter chips, catalogue rows | `p02-home`, `p02b-home-full`, signed in: `p20-home-signed-in`, `p20b-home-signed-in-full` |
| P03 | Search | search field on Home | results replace the rows | `p03-search` |
| P04 | Title sheet: film / series | tap a tile | poster, Play, My Lists, rating; series: seasons + episodes | `p04-title-sheet`, `p06-title-series` |
| P05 | List picker / lists sheet | title sheet, "Manage lists" | rows of lists, new list | `p05-list-picker`, signed in: `p32-lists-sheet` |
| P06 | "..." menu | header | this TV (My TVs, party, full screen, link box, disconnect), language... | `p07-menu`, `p15-menu-while-playing` |
| P07 | My TVs | menu | the TVs this phone keeps, rename, forget, add one | `p08-tvs-sheet` |
| P08 | Watch party sheet | menu | code, QR, link, members | `p09-party-sheet` |
| P09 | Account (guest / signed in hub) | Sign in / avatar | sign in form; hub: Profiles, Friends, Ratings, Devices, Security, Settings | `p10-account-guest`, signed in: `p24-account-hub` |
| P10 | Settings | account | switches (friends, playback...), subtitle languages, look | `p11-settings-guest-1of3..3of3`, signed in: `p23-settings-signed-in-1of4..4of4` |
| P11 | Friends: list / a friend / code | account hub | requests, add-friend patterns, own tag, copy | `p25-friends-page-1of2,2of2`, `p26-friend-page`, `p27-friend-code` |
| P12 | Bell | header | requests, accept / decline | `p21-bell-two-requests`, `p22-bell-after-one-answer` |
| P13 | Ratings sheet / Profiles / Devices / Security | account hub | sorted ratings; profile list; device list with rename; password + delete account | `p28-ratings-sheet`, `p29-profiles`, `p30-devices`, `p31-security` |
| P14 | Remote (playing) | Play | title, seek bar, skip, play/pause, speed, stop, full screen, change video | `p12-remote-playing` |
| P15 | Speed / tracks sheet | remote chips | list of speeds / tracks | `p14-speed-sheet` (tracks: only when the film has any: not in the test film) |
| P16 | TV offline / reconnecting / server waking up | (not walked) | status line, offline card | covered by e2e only |

## Not on the walk yet (candidates to add before the TV/phone polish waves)

* the TV player error / stuck / end card / toasts; the phone offline card and the "server is waking up" line;
* empty states: no history, no ratings, an empty list, no search results, library failing (needs the route mock to fail on purpose);
* a long title (3 lines) and a 1-character title in a tile, 100+ tiles in a row, a profile with a very long name;
* 320 px phone, 844x390 landscape phone, 3840x2160 TV (the audits take their own pictures there).
