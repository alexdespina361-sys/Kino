# Kino: design review of every screen (2026-10-13)

How it was made: a throwaway script walked a local copy of the app (made-up films, test accounts Ana/Ben/Cy on the TV, Dana/Eli/Fay on the phone) and took 119 pictures: TV 1280x720 and 1920x1080 (signed out and signed in) and a phone 390x844 (signed out and in). Three separate reviewers each opened every picture of their folder and scored it 1-10 for **clutter** (10 = clean and calm) and **placement** (10 = icons/buttons obvious and consistent). Nothing in the app was changed because of this review except one real bug (see the end). Scores are each reviewer's own scale: compare inside a table, not between tables.

Pictures: `scratchpad\l-shots\<tv-1280 | tv-1920 | tv-1280-signed-in | tv-1920-signed-in | phone-390 | phone-390-signed-in>\`.

Notes that apply to all TV pictures: the TV page is sized in `em` where 1em = 1% of the width, so 1920 is an exact 1.5x copy of 1280 (nothing re-flows, small text is proportionally just as small). About 14 pictures show no white focus ring: that is the capture (the CSS paints focus only for keyboard focus, my script clicked with a mouse), not a bug.

---------------------------------------------------------------------------------------------------

## TV, signed out (1280x720; 1920 is the same)

| Screen | Clutter | Placement | Why |
|---|---|---|---|
| 01 welcome | 10 | 8 | one centred wordmark and button; ring dark red here, white elsewhere |
| 02 home | 5 | 6 | banner repeats the row name; "Remove from Continue watching" is a hero button; ~10 corner x/+ glyphs; focused tile pokes left of the margin |
| 03 home scrolled | 4 | 5 | 14 corner buttons; rank numerals half hidden by posters; compact banner ~12px under the logo |
| 04 rail open | 4 | 7 | labels fine, but the dim fades out: "s Orchard", "eft", "ching" and the Remove button show beside the labels |
| 05 movies | 5 | 5 | same layout as Home with no "Movies" title; only a 5px red bar on an unlabelled icon says where you are |
| 06 series | 6 | 5 | as Movies |
| 07 categories | 8 | 6 | four identical burgundy cards in a top strip, 70% of the screen empty; 14px counts |
| 08 search | 6 | 7 | big keyboard + chips + 3-column results: dense but logical; red-outlined "All" chip reads as a second focus |
| 09 lists / favourites | 6 | 6 | five red x; tab row mixes lists with "+ New list" / "Edit list" in one chip style |
| 10 a list (empty) | 9 | 7 | title, tabs, one grey sentence; no button in the empty state |
| 11 title page (film) | 9 | 7 | eyebrow, title, synopsis, three buttons; "Close" is a 35px pill, unlike the 46px corner pills |
| 12 title page (show) | 8 | 7 | as 11 plus season chips; focused Play's ring touches "Add to a list" |
| 12b episodes | 7 | 6 | hero block still ~45% of the height; 14px blurbs; red-filled first row blurs "selected" and "focused" |
| 13 rate | 9 | 7 | one job (ten score keys, Done); disabled "Add a note" nearly invisible |
| 14 rate, note | 6 | 5 | the question is asked three times; 12-column keyboard of 32px keys |
| 15 list picker | 9 | 8 | four rows, outlined "New list", red Done |
| 16 list editor | 7 | 6 | label, field, 44x32px keys; disabled Save dark red on grey |
| 17 profile (guest) | 6 | 5 | banner repeats the focused card ("My ratings · average 8" twice), GUEST repeats "Guest", four random-colour cards |
| 18 history | 6 | 7 | eight tiles each with a dark x and a progress bar; tidy |
| 19 ratings | 6 | 6 | five + and one red x on six tiles; score as "8/10" caption (elsewhere a star badge) |
| 20 settings | 7 | 5 | tidy right column; left "Not signed in" wraps, no "Settings" title |
| 21 sign in by code | 7 | 7 | steps, code, QR, status, two buttons; code column off the page axis |
| 22 sign-in form | 9 | 8 | two fields, red Sign in, two escapes; no Back button (Escape works; "Use another device instead" leaves it) |
| 23 connect a phone | 7 | 5 | no title; steps left, code at x=480, button and link at x=640; red "Back to the library" |
| 24 party start | 9 | 7 | title, line, two equal cards, Back; the same two-people icon on both cards and the rail |
| 25 party join | 8 | 6 | six boxes and a keypad; the key at the bottom right is drawn x but is Back (aria-labelled), reads as "clear" |
| 26 player HUD | 7 | 6 | minimal, but the right cluster mixes labelled chips ("1x", "Watch party") with bare icons (volume, full screen, stop square) |
| 27 speed menu | 8 | 7 | "Playback speed" only; selected row red with a check |
| 28 party panel over a film | 8 | 5 | one sentence, one action, but a small grey "Start a party" with the icon after the label |
| 29 player, picture only | 10 | 10 | picture only |

Cleanest: 29, 01, 11 (15 and 22 close behind). Most cluttered: 03, 04, 02 (then 05 and 14).

## TV, signed in

| Screen | Clutter | Placement | Why |
|---|---|---|---|
| s00 sign-up form | 8 | 7 | one calm column; title and button both say "Create account"; no show-password eye on the TV |
| s01 home (bell badge) | 5 | 5 | hero, Top-10 numerals and a "+" on ~13 posters; a toast sits ~120px up and covers row 2 |
| s01 home | 6 | 6 | banner turns into Resume plus a 372px "Remove from Continue watching"; 7 corner glyphs |
| s02 profile hub | 7 | 4 | calm but untitled: the banner echoes "My ratings" (stats twice, "Ana" three times); 14px subtitles; lower 40% empty |
| s03 friends page | 4 | 3 | (the Play / + Favourites under a request was a bug, now fixed); banner repeats the tile; the "Your friends" row with Add a friend / settings is a 16px sliver at the bottom |
| s04 a friend's page | 6 | 5 | Back, two tabs and an action are identical pills; red x on Ben's titles misleads; "Favourites" under every tile |
| s05 add a friend | 8 | 7 | three clear cards; first two share an icon; "Your tag: Ana#1" small and grey |
| s06 give a code | 7 | 6 | "Copy code" chip ~32px high; text block, QR and buttons share no axis |
| s07 find by tag | 9 | 8 | one field, two buttons |
| s08 friend settings | 5 | 6 | 3-line grey paragraph, six toggles without group headings, state by colour only |
| s09 bell, two requests | 5 | 3 | toast covers the lower edge of "Open Friends" and "Back" and repeats row 1; rows look inert (no chevron) |
| s09b one request | 9 | 6 | one question, three equal buttons; no title; square avatar where the bell list uses round |
| s10 bell after answering | 7 | 6 | two short sections; wide rows with little text |
| s11 ratings | 8 | 5 | rating only a grey "9/10" caption; "+" on every tile; half the screen empty |
| s12 history | 7 | 5 | x on all 6 tiles; "Watched" under three tiles instead of a date |
| s13 account panel | 4 | 4 | 17 controls; right column runs from above the logo to ~25px from the bottom; subtitle hint under "Use friends" instead of Language; Sign out not set apart |
| s14 manage profiles | 9 | 8 | two tiles, a count, Done |
| s15 add a profile | 7 | 6 | title centred on screen, not over the form; Name ring identical to selected-avatar ring |
| s16 approve another screen | 9 | 7 | one field + Back; instruction given twice |
| s17 party hosting | 4 | 5 | 13 elements, three ways to join (address steps, QR, link); captions 13-15px |
| s18 invite friends | 9 | 7 | one row + Send/Cancel; unlabelled code; row has no avatar or online dot |
| s19 player HUD, signed in | 7 | 6 | clear hierarchy (47px pause); "10" in the skip icons ~9px |

Cleanest: s07, s14, s18. Most cluttered: s17, s13, s03. Worst placement: s03, s09 (3), s02, s13 (4).

## Phone, signed out (390x844)

| Screen | Clutter | Placement | Why |
|---|---|---|---|
| p01 pair | 8 | 7 | one red Scan, clear "or type" steps |
| p02 home | 6 | 6 | first ~200px under the header is the paste block with a dead-looking maroon Play; "Manage lists" ~26px tall |
| p02b home, whole page | 5 | 5 | Search at ~1,140px under every personal row; 14 round corner buttons in view, 8 identical "+" |
| p03 search | 4 | 4 | field jammed on the bottom edge, no result visible, personal rows still above it |
| p04 title sheet | 8 | 8 | one red Play, one grey "My Lists", folded rating row |
| p05 list picker | 8 | 7 | clear rows; but stacks a second sheet |
| p06 series sheet | 5 | 6 | two identical "Rate" rows around EPISODES; 36px season pills |
| p07 "..." menu | 3 | 4 | six jobs, three help paragraphs; one icon in four buttons; caption wraps; the paste-a-link switch drawn as a selected radio card |
| p08 My TVs | 4 | 5 | one TV gives a list, a rename form, help and an add form; Forget flush beside the TV in use |
| p09 watch party | 5 | 6 | good code/QR/link card, three help paragraphs; each member can carry three buttons |
| p10 account (guest) | 7 | 6 | clear form; "Create an account" a small grey link; Settings is a sun glyph |
| p11 settings (3 screens) | 4 | 6 | three screens for five switches, eight help paragraphs, 24 "+ language" chips |
| p12 remote, playing | 8 | 5 | calm, 86px pause; everything in the top 55% of the screen, Speed an orphan half-width card |
| p14 speed sheet | 8 | 7 | six 49px rows; half the screen for one tap |
| p15 menu while playing | 3 | 4 | same as p07; nothing adapts to playback |

## Phone, signed in

| Screen | Clutter | Placement | Why |
|---|---|---|---|
| p20 home | 6 | 5 | p02 plus bell (thin glyph, bright "2"), 36px avatar, 40px "...": uneven, all in the far corner |
| p20b home, whole page | 5 | 5 | Search still at ~950px; same corner-button mix |
| p21 bell, two requests | 7 | 6 | cards 112px for one line; the decline x is 35x32 and unlabelled, same glyph as the sheet's close |
| p22 bell, one left | 8 | 6 | no sign the first was accepted |
| p23 settings (3 screens) | 3 | 5 | seven friends switches in a flat run, no indent under "Use friends", then the 24-chip wall |
| p24 account hub | 8 | 6 | the best list in the app; "1" beside Friends means pending but is drawn like a total |
| p25 friends (2 screens) | 5 | 5 | four jobs, three add-friend patterns, own tag last |
| p26 a friend's page | 7 | 5 | half empty; title says "Friends" not "Eli"; red Remove friend as heavy as Ask to watch |
| p27 friend code | 5 | 5 | stacked code, Copy code, QR, clipped Copy link; two copy buttons |
| p28 ratings sheet | 9 | 8 | four rows, one rating format, sort chips |
| p29 profiles | 9 | 6 | clean but 75% empty; no Done |
| p30 devices | 9 | 5 | one card; the rename pencil is an 11px glyph in a ~28px target |
| p31 security | 8 | 6 | the no-password warning is plain grey help; disabled Save low contrast; Delete right under Save |
| p32 lists sheet | 9 | 7 | small sheet; 11px edit pencil |

Cleanest: p28 ratings sheet, p04 title sheet, p01 pair. Most cluttered: p07/p15 "..." menu, p23 signed-in settings, p08/p09 My TVs and Watch party.

---------------------------------------------------------------------------------------------------

## Icon and placement notes (merged)

- **Corner buttons on tiles.** Every tile carries a ~30px circle: dark x (take off Continue watching / History), solid red x (kept in a list), + (add). Up to 14 per screen on the TV; 8-14 on the phone's home. Red is also Play, selected, progress, the eyebrow caps and the star, so a red x reads as an error. Three reviewers called it the loudest thing on screen. (On the TV they only draw when a mouse is reported.)
- **x means five things:** close, remove from a list (red), remove from Continue / History (dark), clear on the keypad, and the key at the bottom right of the party keypad is actually "Back".
- **TV top-right corner:** bell, "Ana" pill, full screen: one family, same place on every library page, but gone on every full-screen flow, where the logo also moves (y 47 in the library, ~105 in flows) and flow titles sit at 12 different heights.
- **Rail (closed):** ten thin ~22px icons, unlabelled until it opens; Movies (film strip), Series (monitor), Categories (grid) need their words. The two-people icon is Watch party, but with friends on it reads as Friends, which actually live under the person icon; the person icon's green dot (attention) shares its colour with "phone connected" and "friend online".
- **Player HUD:** pause 47px, skips faint (~24px), the stop square is unlabelled beside full screen; chips and bare icons mixed.
- **Phone header:** the TV block (monitor, name, status) is plain text, not a button; the right side is Sign in (34px) or avatar 36 + bell 40 + "..." 40: all under 44px, uneven, in the corner farthest from the thumb. "..." is the only door to every TV function and has no label.
- **Phone targets under 44px:** Manage lists / See all ~26px, All/Movies/Series ~32px, chips 31-36px, decline x 35x32, edit pencils 11px glyphs. Fine: 86/64px transport, 46px rating scores, 54px switch rows.
- **Phone remote:** controls fill the top 55% of the screen and the bottom is empty (the thumb zone).
- **Sofa text (TV, 1em = 12.8px at 1280):** episode blurbs and card captions ~14px, key labels on 26px keys, QR captions ~13px, party blurbs 15px, the "10" in skip icons ~9px, row-3 captions ~2% from the bottom edge (overscan).
- **Contrast:** disabled "Add a note" and "Save" ~2:1; red caps on near-black ~4:1.

## Consistency (merged)

- **Ways out on the TV:** Close, Back, Back to the library (red on one page, grey on another), Done, Cancel, Take this code back, stop square, x.
- **Names:** "Friends" is a hub tile, the friends page and the privacy page; "Watch party" vs "watch together"; "Favourites" vs "My lists" vs "Manage lists"; "My ratings" vs "Your rating"; screen / device / phone / TV mixed on the phone's menu.
- **Three page patterns on the TV:** banner pages (red eyebrow repeats the row title), titled pages (Ratings, History), flows with a centred h1.
- **Selected vs focus:** selected is a red outline + dark red fill, the same red outline marks input focus and the chosen avatar; white fill is the real focus.
- **Ratings:** star badge (Home, search, history), "8/10" caption (ratings page), "average 8" without "/10" (profile).
- **Three keyboards** on the TV (63x50, 70x32, 44x32 keys) plus a keypad.
- **Phone:** top toast (account, friends) vs bottom toast (TV answers); segmented controls inset 300px on some pages and full width on others; code + QR side by side on one sheet, stacked on another.
- **One friend request** announces itself five ways: toast, bell number, green dot, "1 unread" tile, banner.

---------------------------------------------------------------------------------------------------

## Ranked refinements (merged; effort S/M/L, impact H/M/L)

Broken or misleading (as shown):
1. FIXED already (`a6af69c`): the banner on the Friends page offered Play and + Favourites for a friend request.
2. Rail open: banner words and the Remove button leak beside the labels (TV 04). Solid panel as wide as the pill, dim the rest. S / M-H
3. Toast over the bell page's Open Friends / Back buttons (TV s09; the toast ignores clicks, it is only drawn over them) and over row 2 of Home. Keep it near the bottom edge or under the header, skip it while the bell list already shows the item. S / M
4. TV account panel (s13): 17 controls from above the logo to ~25px from the bottom, hint under the wrong row. Split Account | Settings or tighten, move the hint. S-M / M
5. Phone "..." menu (p07/p15): a switch drawn as a selected radio card (offered mid-film), wrapped caption, six jobs. Split "this TV" from "this phone", link box only in Settings. M / H

Polish, ranked by impact for effort:
6. Calm the tile buttons: show + / x only on the hovered or focused tile (TV, mouse); give x one meaning (close), list membership a check/+ toggle, keypad key a Back arrow. TV S / H; phone M / M
7. Phone remote: bottom-anchor the transport and chips; Speed full width. S / H
8. 44px targets on the phone header and sheets: hit areas to 44 (visuals can stay), "Decline" labelled, 8-10px between tile buttons. S / H
9. Phone home: search up (header icon or sticky field), the ~200px paste block shrinks to one row, personal rows hide while searching and the results scroll into view. M / H
10. TV: name the pages (a small page title for Movies, Series, Search, Connect, Settings; real headers for the Profile and Friends pages with their buttons above the fold instead of echoing the focused tile). M / H
11. TV sofa-size text: raise the ~13-15px items to ~16-17px (one change fixes both sizes) and key heights to 40px+. S / H
12. TV home banner: drop the duplicate eyebrow, shorten "Remove from Continue watching" to "Remove" or long-press only, 24px under the logo. S-M / M-H
13. Phone Settings: split "Friends and privacy" (children indented, dimmed when friends are off) from subtitles; mark the three default languages selected instead of "+". M / H
14. Phone: the TV block becomes the menu button (name + status + chevron, 44px) and the unlabelled "..." goes. S / M
15. One keyboard component on the TV (keys >= 44px, same Space/Delete/Clear). M / M
16. Player HUD: right cluster all icons with tooltips or all labelled; "Start a party" primary with the icon first. S-M / M
17. Friends flow on the phone: own tag + Copy first, the three add methods behind one "Add friend", "Eli" as the title of his page, Remove friend into a header menu. M / M
18. Request cards: one row (avatar, "Eli#1 wants to be friends", Accept and a labelled 44px Decline). S / M
19. One vocabulary everywhere (list/lists, screen/device, "Watch party" vs "together"), one switch style, sentence case. S / M
20. Distinct icons: Party vs Friends on the rail (two-people twice), full screen (expand arrows) vs scan, a real gear for Settings. S-M / M
21. Selected vs focus on the TV: selected = fill + check or underline, outline = focus only. S / M
22. Flow pages on the TV: pin the h1 at one height and the logo in the same place as in the library; party hosting leads with QR + big code. M / M
23. Near-empty pages (phone p26, p29-p31; TV ratings): bottom-anchored actions or a real empty state, "Done" on Profiles. S / L

Quick wins (S effort, big calm): 6 (TV part), 7, 8, 11, 14.

## What I did not take from the reports (checked)

- "No way out of the party-join page for a mouse": there is one (the key at the bottom right of the keypad is Back, aria-labelled), it only looks like "clear".
- "About 14 pictures show no focus": my script clicked with a mouse; real remote focus is drawn.
- The "H" tile in the friends' pictures is the test picture, not a missing image; the fox avatars are all the same because the test accounts use one avatar.
- The film title "long" and the colour-bar picture are the test file.

## Fixed since (not part of the review itself)

`a6af69c` on `feat/remote-back`: the Friends page banner under a friend request no longer offers Play / + Favourites (a request has no buttons; pressing the tile opens the page that answers it). Unit test + the TV request test now looks at the banner; mutation-checked.
