# Kino — Phone-to-TV Clean Web Player

A clean video player for any screen: a TV, a computer or a phone plays, and a phone can also be the remote of another screen. One Vite app: one
address, and each device becomes the screen or the remote (`/tv` always plays) and one Fastify server (`/api`, `/ws`, static UI), same origin.
Accounts with profiles keep what you watched on every phone, TV and browser; the whole site speaks English, Romanian and Italian.

```
phone ──WS──▶ server ──WS──▶ TV player ──▶ media (directly, no proxy)
        (paste a link: the server finds the video, the TV plays it without the page)
```

## Run

```bash
pnpm install
pnpm dev          # Fastify :8787 (auto-restart) + Vite :5173, one terminal
```

- Screen: http://localhost:5173 on a screen without touch (or `/tv` anywhere) → opens straight into the library; **Connect a phone** in its
  menu shows a 6-digit code and a QR code
- Phone: scan the QR code with the **Scan** button (or the phone's own camera app), or type the code. Without a TV at hand, **Watch on this
  device** on the same page makes the phone the screen
- Real phone on the same Wi-Fi: use `http://<your-pc-ip>:5173` (allow Node through the Windows firewall)
- Camera scanning needs HTTPS or `localhost`; over plain `http://<ip>` the phone falls back to typing the code
- Restart the server after pulling changes (`pnpm dev` does it by itself). A page newer than the server shows
  "The server doesn't understand this app version" instead of working half-way.

Production, one process (`PORT` and `HOST` are optional, default `8787` and `0.0.0.0`):

```bash
pnpm build && pnpm start     # http://localhost:8787
```

`dist/client` (the built page) is committed, so a host can serve it without building; run `pnpm build` before committing a change to `src/client`.

### Settings (environment)

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT`, `HOST` | `8787`, `0.0.0.0` | Where the server listens (a host like Render sets `PORT` itself). |
| `DATABASE_URL` | – | Keep accounts, which phone goes with which TV, and what each TV was playing in Postgres. Without it they are kept in `DATA_DIR`. |
| `DATA_DIR` | `data` | Folder for the file `kino.json` that holds the same (git-ignored: it holds password hashes). `memory` keeps nothing. |
| `REGISTRATION` | `open` | `closed`: nobody new can make an account (once the people it is for have one). |
| `MAX_ACCOUNTS` | unlimited | A cap on accounts, for a small server. |
| `SIGNUPS_PER_HOUR` | `10` | How many accounts one address may make in an hour (a household or a school behind one address may want more). |
| `TRUST_PROXY` | `1` on Render, else off | How many proxies sit in front (a number, `true` or `false`), so the rate limits see the real address. |
| `LIBRARY` | on | `off` starts without the browsing library. |
| `TMDB_API_KEY` | built-in key of the Filmpire source | The library's TMDB key. Set your own; the built-in one is shared by everybody who runs this. |

## What it does

**Accounts and profiles**
- Register and sign in with a **name and a password, and nothing else asked for**: both can be anything (the password as short as one
  character, or none at all; the name only has to be one nobody has taken, upper or lower case alike, and may be an email address if someone
  prefers). **An account with no password is open to anyone who types its name**, and the sign-up page says so. Passwords are hashed with
  scrypt; the session is an `httpOnly` cookie that lasts 400 days (the longest a browser keeps one) and is renewed every time the app is
  used, so a signed-in browser stays signed in until the person signs out or the browser's data is cleared. The page also remembers who was
  signed in, so a screen does not look signed out while the server is slow to answer (a free host waking up). An account has up to **five
  profiles**, each with a name and one of **twelve avatars**; who is watching is asked on every new device, Netflix-style, and a profile
  is switched from the account page (the profile picture in the phone's top bar, and in the library's top corner on the TV). The TV makes,
  renames, re-pictures and removes profiles itself, with the remote's arrow keys: profile picture in the top corner (or the gear in the
  menu) → **Manage profiles**; the "Who's watching?" page that follows a sign-in has the same tile for a new profile and the same button.
- **Watching is saved to the profile**, wherever it is watched: **Continue watching** (the place in every unfinished film or episode, and the
  next episode of a show once one is finished), **lists** (every profile has one called **Favourites**, and can make others and name them,
  up to twelve in all; a title can be in several), the watched marks on episode lists, and the profile's settings. Open the app
  on another phone, TV or browser, sign in, pick the profile, and it carries on from the same second.
- **Ratings.** A film, a show or **one season of a show** can be given a score from 1 to 10, each with a word (1 *Appalling*, 5 *Average*, 8 *Very
  good*, 10 *Masterpiece*), and **a score is all it takes**: one tap on the phone (the *Your rating* line on a title's page, and under a show's season tabs a
  line for the season shown), or OK on a number on the TV (**Rate** on a title's page, with the remote already on 7). A note saying why is optional: typed
  on the phone (kept as it is typed), and on the TV with the keys of a page of its own. The rating also **writes down the watching behind it**, with no
  work from the person: *when it was rated*, *how much was watched* (**from 95% on it counts as all of it**, since the credits are often skipped; a
  show or a season is counted in episodes, "2 of 3 episodes watched") and *when it was finished* (or last watched). Watching it again later adds to that;
  rating it again changes the day it was rated only when the score changes. **My ratings** is a row on the phone's home screen with a page of its own
  (*See all*: newest first or highest first, with the notes and those facts, and the mean) and an entry in the TV's menu. Ratings are saved to the
  profile and synced like the lists (up to 500; a guest's stay on the device and are combined on sign-in). **Rate what I watch** in Settings (phone
  and TV) switches the whole thing off, every sign of it, and keeps what was rated.
- **Friends** are optional and **off until a profile turns them on** in its settings (phone and TV; they belong to an account, so a guest is told to sign in).
  Two profiles become friends with a code (`ABCD-2345`, good once and for a week) that one gives and the other types or opens as a link: the phone shows it
  with a QR code and a link to send, the TV with a QR code (up to 5 codes can be out at once; one can be taken back). A friend can **look at your lists and
  ratings** (a page for each friend), **be sent a title** (*Recommend to a friend* on a title's page, with a few words of why on the phone), **be invited to a
  watch party** (a button that joins on the phone; on the TV, pressing the invitation on the Friends page joins) and **hear what you watch** ("Sam is watching
  Alien", from a minute in, the last two weeks). Each of these has a switch of its own: *Friends can see my lists*, *…my ratings*, *Tell friends what I watch*,
  *Tell me what friends watch* (something is told only when one gives and the other gets), *Friends can send me titles and invitations*. They live in the
  profile's settings, so the server, not the screen, decides what a friend is shown or may send, from the other profile's synced settings; with friends off nothing is
  shared, sent or received, and the friends are kept for when it is turned on again. What friends sent shows as a row, a dot (phone) or a number on the menu (TV), and a
  line when it arrives; either friend can remove the other (the button asks twice). Friends: `/api/profiles/:id/friends…`.
- **Signed out, the device keeps the same things as a guest** (`localStorage`). Signing in **combines** them with the profile that is chosen:
  per item the newest copy wins, a removal is remembered for 45 days so another device cannot bring the item back, and nothing is counted
  twice. Whatever was watched while signed out is on the account afterwards.
- **Sync** runs when a profile is chosen, every 45 seconds, a few seconds after something changes, when the tab is shown again or the
  connection returns, and as the page closes. It sends only what changed since the last revision (`POST /api/profiles/:id/sync`), and a
  device that is offline keeps working and catches up.
- **Sign a TV in from the phone.** Typing a name and a password on a TV remote is a chore, so the TV's sign-in page shows a QR code and a short code
  (`ABCD-2345`). A phone that is already signed in opens it (the camera app, or Account → "Sign in another device" to scan or type the code), sees what is
  asking, and approves; the TV is signed in a moment later. The code works once and expires after five minutes, and nothing signs a TV in
  until a signed-in person says yes. A screen that is signed in itself can do the asking too (a computer with no phone at hand): its account
  page has **Sign in another device**: type the code the other screen shows, check who is asking, approve.
- The phone's account page: profiles, settings, devices (sign others out, and give a device a name of its own: "Living room"), password, delete account. The TV has its own: who's watching,
  **Manage profiles**, and the settings (language, colour, autoplay, ratings, friends). The subtitle languages, the devices, the password and deleting the
  account are on the phone's page only.
- **Settings per profile:** website language, accent colour (the red can be any of several colours), whether the next episode follows by
  itself, whether titles can be rated, friends and what they may do, and the subtitle languages (below).

**Phone**
- Pair by QR scan (camera) or by code; a QR link opened from the phone's camera app pairs by itself. A phone that already has a TV is asked
  what the other one is for: join the watch party, or control it instead (the first TV is not let go: it carries on as it was, on the phone's
  list, below). Nothing changes behind its back, except that scanning another TV's QR code moves a phone off a TV that is switched off
  (offline) at once, since there is nothing to ask about
- **My TVs.** A phone keeps the TVs it has connected to (up to eight, in the order it did): *My TVs* in its menu, and on its first screen once
  it controls none. A tap on one controls it, **with no code**; the one it leaves is not touched: it keeps playing, stays paired and
  is still on the list, with a dot for whether it is on. **Forget** lets a TV go (a TV with no phone left shows a new code, as after
  *Disconnect*, and stops what it was playing); the field below connects another TV with its code, scanned or typed (the list says when it is full), and the
  TV in use can be **named** there (shown on the list and on the other phones' lists; empty gives it its own name back). A phone only hears
  what the TV it controls is doing, and the menu's count of phones counts only those controlling that TV now. A TV's own **Disconnect**
  takes it off every phone's list, the ones that have moved on included. Authority comes only from a code, so "My TVs" never gives a
  phone a TV it did not connect to itself. The list is kept with the pairings (database or file), so it survives a restart
- A second phone joins the same TV with the QR code (and code) in the TV menu, scanned off the first phone's screen, or with the code and QR
  code the TV itself shows on its "Connected" page (**Connect a phone** in the TV's side menu): both are remotes, either can
  add TVs to the party, and the menu says how many are connected. The TV flashes "A phone is connected." when one joins. That code stays good
  while a phone keeps asking for it (opening the menu, or the TV's page being open); a phone that already has a TV and scans it is only offered
  to control that TV instead
- **The home screen** is the library's rows, **Continue watching** and the lists. A tap on a title in the library, a list or the search opens
  **its own page**, as the TV has one: its picture, **Play** (or **Resume**; for a show, the episode this profile is at), the list to keep it in,
  what it is about and, for a show, its seasons and episodes (a tap on one plays it). **Continue watching** is a row of big cards that snap one at a
  time with the next one showing at the edge: a tap picks one up where it stopped, the **+** on it puts the title in a list and the **×** takes it off the
  row. (One card per show and per profile. A guest's cards stay on the screen they were made on; signed in on both, the phone and the TV show the same ones.)
  The search lists what it finds one under another, and is still there (the words, the filter, the list, the place in it) after something is played and stopped
- **The box for pasting a link is off** on a new phone, since most of what is played comes from the library. The phone's menu has a switch that brings
  it back (kept on that phone); it is there whatever the switch says while the library has nothing to show, as the only way to start anything.
  Opening the phone page as `/?url=<link>` plays that link once connected (the hook for a share button)
- **Lists on the phone.** The round **+** on a title saves it in Favourites (and takes it out again), and so does holding the title (a line at
  the bottom says "Added to Favourites", the + being a corner away from the finger); once there
  is a second list it asks which lists the title is in, with **New list** there too. Each list with something in it is a row on the home screen,
  and **Manage lists** (at the end of the first row's heading) makes, renames, **reorders** (move up / down on the phone, left / right on the TV; the
  home screen follows the order) and deletes them. The first list can be renamed and emptied, never deleted.
- **Add it to the home screen** and the page opens as an app with no browser bar (`public/manifest.webmanifest`; on an iPhone that is the only
  way to lose the bar, since its browsers have no full screen for pages): Share → *Add to Home Screen* there, the browser's menu → *Install app*
  or *Add to Home screen* on Android
- Remote: play/pause, ±10 s, seek bar, audio/subtitle/speed/quality/source sheets, previous and next episode, episode list,
  subtitle style, full screen, stop, disconnect (volume is the TV's own). It confirms what the TV did ("Speed 1.5×") in a line at the bottom

**TV**
- Clean player with a fading HUD (title, clock, "ends at", seek bar with a time tooltip on hover, buffering spinner, big play/pause). Paused, the
  title steps out of the corner and is said once, large, on the left ("You're watching …"); a skip flashes on the side it went towards; and
  the Up Next card comes with 15 seconds left of an episode of more than 30 seconds. It counts down only for a profile that plays the next
  episode by itself, the count waits while the picture is held, and winding back takes the card away
- D-pad remote support: ←/→ seek 10 s, ↓ wakes the controls (even faded) and lands on Play, Enter presses. Among the controls the arrows walk
  the rows as they are laid out and stop at the ends; the bar waits a little longer while the remote rests on a button. Back closes a menu and
  hands the focus back to the button that opened it (the subtitle style is a page of the audio and subtitles menu, so Back goes one page back).
  Every screen before the video (the library, a title's page, the pairing code, the connected screen, the account pages, the "Press OK" page of a
  party link) is walked with the arrow keys: the first press only lands on a button, so a stray OK never presses one, and a page of columns keeps
  Up and Down to the column the remote is in (`src/client/tv/dpad.ts`)
- The controls are one line on any screen, in any language, with every button present (series, subtitles, sources, quality, party). The row
  measures itself (`src/client/tv/fit.ts`) and gives up only as much as it must, in this order: the room between the buttons, the labels of Watch
  party and Audio & subtitles, the episode names under Previous / Next, the labels of Previous / Next, the label of Episodes (each label becomes its
  icon, still named for screen readers and in its tooltip), then the size of the buttons. Only a phone held upright is too narrow for that, and its
  controls wrap on two lines
- Subtitles and audio like a streaming app: the language you chose is remembered. Tracks the file labels only with a code (`eng`) are
  named by their language. Subtitles are drawn by the page, so size, font, colour, opacity, background, edge, height and word spacing
  all work on any TV browser; change them from the TV's menu or the phone, with a live preview. A browser only lets a page go full screen
  (and play with sound) after a press on that page, so a screen goes full screen at its first key press or click, once, and is left alone after
  that. Leaving it (Esc, `F`, or the round button in the library's corner, beside the account button, which the arrow keys reach too) is
  remembered in that browser, so the next visit stays as it was; going in again with the button makes it open full screen once more
  (`src/client/shared/fullscreen.ts`). Safari is left out of the automatic part, as it takes no typed letters in a full-screen page. The phone's
  remote doesn't do it by itself (it is where codes get typed) but has the same button on its first screen and in its menu (*Full screen on this
  phone*). The phone's button for the TV's full screen works while the TV has had a press lately: the TV asks
  for an OK press when it hasn't. If the browser still refuses to start a video, a **Tap / press OK to play** button says so instead of a blank screen
- **TV browsers with a player of their own** (Hisense's *Hi Browser* on VIDAA is the one this was written for). A page cannot switch off what a
  TV's firmware does with a video, but it can avoid asking for it, so the page: never asks a Hisense browser for full screen (not at the
  first press, not by `F`, not from the phone, and the controls have no button for it), because that is what hands the picture to the
  firmware's player; keeps the `<video>` inline and without controls (`playsinline` and the vendor spellings of it, `controlslist`,
  no picture-in-picture, no remote playback, the native control layers hidden in CSS, any `controls` that something adds taken off at
  once, and a video that still goes full screen on its own is put back: `src/client/tv/nativePlayer.ts`); presses OK itself when a remote
  sends it as a key down and up with no typed Enter, which Chromium needs before a focused button counts it (`src/client/tv/okPress.ts`);
  and knows the vendors' extra remote keys (play, pause, stop, rewind, forward, back). **To find out what a TV browser does**, open
  `/tv?debug=1` on it: a small panel in the corner says what the browser is and what it can do, whether the TV's id was kept since the
  browser was closed (the last four characters, in storage and in the cookie), where the server keeps things and how long it has been up (a
  short time with `file` or `memory` is why a TV "lost its phone"), and, live, each key it sends and where the focus went, the
  clicks, the video's state and the page's errors. `?debug=0` turns it off. `?fullscreen=off` keeps any browser from being asked for full
  screen (`?fullscreen=on` undoes it); both are kept for the next visits
- **Subtitle languages.** The menu lists every language the video has. The ones a profile wants come first (a guest gets the website's
  language, English, Romanian and Italian), the rest sit under **More languages**. A signed-in profile can choose its own ordered list in
  Settings → Subtitle languages, and "Hide all other languages" if it never wants to scroll past them; **Show all languages** in the menu
  lifts that for one video, and the language that is on is never hidden
- Episodes: seasons and episodes, past and future, when the resolver supplies them; previous / next (`P` / `N`), an up-next card and autoplay of the
  next one (a profile can turn that off). The lists mark what was watched and how long is left, from the profile's saved progress
- **When a film ends** the TV shows an end card instead of the last frame: what it was, **Next episode** (when the Up Next card was turned
  down), **Back to the library**, **Watch again**, and up to five titles like it. Back leaves to the library. A guest in a party never sees it,
  since the host's screen decides what happens next
- **Mute** (`M`, or the speaker button among the controls) silences this screen only: it is not shared with the phone or the party and not
  remembered, and the volume itself stays the device's own
- Sources: a video can carry alternates; if the first stream fails the TV tries the next by itself, and either device can pick one. When none of
  them plays, a card takes the place of the controls: what it was and what went wrong, **Try again** (OK, from the first source) and **Back to
  the library** (Back)
- **A TV stays as it was left.** Quitting the browser, a power cut or a restart of the server does not unpair anything: a phone and its TV
  stay together until one of them lets go (*Disconnect*, on either), and nothing else does it. A TV that has a phone (or is in a party) and
  was in the middle of a video is put back on it when its page is opened again: the video is looked up again from the link it came
  from (the stream's own address may have expired), and it comes up **paused** at the place it had reached, so a press on the phone's play
  button, or on OK, carries on. That is kept for 30 days and needs a link that plays the video again (the library and a pasted link have
  one). It is not done after Stop, Back to the library or the end of the film, nor for a TV on its own (its own *Continue watching* has the
  place). The place is written down every 30 seconds it moves, and exactly when the TV goes away
- **The library is the front door.** The site opens straight into it, signed in or not (a guest's progress stays on that screen), so a screen can
  pick a film with no phone at all. A short welcome fades over it while it fills in, and takes no press. (Only a party link opens a "Press OK" page
  first, because that screen joins the moment it is pressed.) **Connect a phone** is one entry of its menu; once a phone is connected that page
  says so, with **Back to the library** and **Disconnect from phone** (unpairs the TV from every phone and shows a new code; the phone
  controlling it goes back to the code screen, one that had moved on to another TV just loses it from its list)
- **Sign in** is the button in the library's top corner (the profile picture once signed in); nobody is made to
- **Any device can be this screen.** The same page lays itself out for the size of the device: the TV's wide layout from about 900 px
  up, and below that (a phone, a tablet, a narrow window) a compact one with a thin menu, a smaller banner, titles that swipe along, a native
  search field (the phone's own keyboard) and as many columns as fit. Taps press everything, swipes scroll, the first touch on hidden controls only
  brings them up, and every page has a way out for a finger. A phone held sideways gives the banner less height. Volume stays the device's own
- Keeps the screen awake while playing; reconnects by itself, and notices a dead connection within about 25 s. After 10 s without the server
  the page says why that can be (*The server is waking up. A free server can take up to a minute…*): on the TV in its banner, on the phone's
  first screen in place of "Reaching the server…", and on the remote under the header. It is not said when the browser knows there is no
  network at all, which has its own line

**Server**
- Resolves a link to a playable stream: the generic resolver plus the site adapters in `src/server/resolvers/adapters/`
- Pairing codes are single-use and expire after 10 minutes. After 20 wrong codes in a minute (all phones counted together)
  pairing pauses until the minute is over, because the code is only six digits
- **Accounts, pairings and what each TV was playing are kept**: written to disk (or Postgres) a moment after every change and again when the
  server is told to stop. A restart (or a free host sleeping and waking) leaves every phone and TV paired as it was (a phone's list of TVs
  included), and a TV whose page is
  opened again is put back on its video (above); the TV's and the phone's own ids are also kept in a cookie next to the page's storage, so a
  browser that wipes one of the two when it closes still finds its way back. The server never lets a pair go by itself; one that nobody has
  used for more than a year (400 days) is cleared out when it starts, so the database does not fill with ghosts. The codes on screen are in
  memory only: a TV shows a new code after a restart. A server that was restarted while a TV played is told by the TV what it has on, as
  soon as the TV reconnects

### Languages

The language can be switched on the phone's connect screen and in Settings (phone and TV); a profile remembers its choice, a device remembers
the last one, and a first visit follows the browser. `src/client/i18n/` holds one dictionary per language: `en.ts` is the list of keys and `ro.ts` and `it.ts` must have every one
(the compiler and `i18n.test.ts` check, including the `{placeholders}` and the plural forms Romanian needs). Everything a person reads goes through
`t("some.key")`; what the player and the server say in English (an error code, "Subtitle 3") is put into words by `src/client/shared/words.ts`.
Titles and descriptions come from the library source and are not translated, but the names of its rows are: the places name them in English
("Trending Movies"), so `rowTitle` (`src/client/i18n/index.ts`) says the ones this app lists itself (Filmpire's categories, the Internet Archive's
collections) with a `category.*` word per row id, and any other row keeps the name its place gave it (`i18n.test.ts` fails when a source gains a row with no
name in every language). Adding a language is a new dictionary and a line in `UI_LANGUAGES`.

### One page, two roles

Every device opens the same address. A screen without touch (a TV, a monitor) or a TV browser (Fire TV, Tizen, webOS, Android TV)
becomes the player; a phone or tablet starts as the remote, and can be the player too. `/tv` is always the player, `/?role=remote` or
`/?role=tv` asks for one screen without remembering it, the `/?code=` and `/?url=` links made for the phone always open the remote, and a
`/?party=` link always opens a screen. A device that was guessed wrong has a way over: **Watch on this device** on the phone's connect page,
the TV menu of a connected phone, and a quiet "Use this screen as a remote" link on the TV's own pages; the choice is remembered on that
device. In the library's menu a **phone** (a touch screen under 600 px, not a TV browser) has **Use as a remote** where other screens have
**Connect a phone**: it is for controlling a TV, so the entry goes to the remote's page instead of showing a code for another phone. A tablet
keeps **Connect a phone**, since it can be somebody's screen. The rules are in `src/client/role.ts`. Each role is a chunk of its own (`src/client/main.tsx`), so a phone downloads the remote and a
TV the player, and the video library (hls.js) and the QR scanner load only when they are needed.

### Watch party

One TV plays and up to five more screens watch along, in step. A guest is anybody: a TV, a computer, or a phone that opened the link
(a phone that opens a party link is a screen of the party, not a remote). It works signed in or not; a screen is listed by the profile that
is watching on it, or else by its own name ("TV 3F2A"). Ways in:

- **From a TV:** menu → **Watch party** → *Start a party* (or the **Watch party** button in a film's controls, whose panel rests on **Done**, not
  on the button that ends the party). The screen shows a
  6-digit code, a QR code and the address, and the invitation as a **link with a Copy link button beside it** (a click, or OK from the remote: it says *Link copied*),
  to paste into somebody's chat; on another screen choose **Watch party → Join a party** and type the code with the remote's
  number keys (the on-screen pad works too).
- **From the phone that controls the TV:** its menu → **Watch party** shows the same code and QR code with the link and a **Copy link** button (and a **Share link** button where the browser can share), and
  lists who is in (the host's phone can send any guest away, or end the party). Typing the pairing code that another TV shows into the phone
  still works; a party's own code typed there is told apart from a wrong one (`ADD_PARTY_CODE`: the phone is told what the code is for, and it
  does not count against the limit).
- **From a phone with no TV:** the code of a party typed where a TV's code goes (the phone's first screen) is recognised, and the phone opens
  the party as a screen (`/?party=<code>`), the same as the link does. The server answers such a code with `PARTY_CODE`; other wrong
  codes are still "Invalid or expired code" and count against the pairing limit.
- **From a link:** `/?party=<code>` opened on any device shows a "Press OK or tap to start" page and joins on that press (the press is also
  what lets the browser play with sound, and it takes the page full screen like any first press).

The code lasts ten minutes (renewed while it is on screen), admits screens until the party is full, and wrong codes count against the same
limit as pairing. A TV with a phone connected can host a party but not join one. Everybody in a party can see who else is in it; the host (on the TV,
or on its phone) can remove a guest or end the party, and a guest can leave from its own bar.

**What the host decides:** what plays, a guest that joins mid-film starts at the host's place, pause, skipping, speed and stop. The host
reports its position, the server relays it, and each guest nudges its speed by a few percent when it drifts a fraction of a second, or jumps when it is
a second or more off (`src/client/tv/sync.ts`). **What stays each screen's own:** subtitles (language, delay, style) and the audio track,
from the guest's *Audio & subtitles* button; volume is the device's own.

**A phone as a guest** watches in either orientation. The guest's bar (Audio & subtitles, Mute, Watch party, Full screen, Leave) sits along the
top: held sideways it is one row, held upright "Watching along with …" has a line of its own and the buttons wrap under it. The guest's screen says
what it is waiting for: a spinner while the video loads, the reason in words when it can't be played (and the code underneath), and
**Tap or press OK to play** when the browser wants a press before it starts a video with sound (Brave's stricter setting and iPhones do; a TV
that hosts gets the same button). **Full screen** is on the waiting page and in the bar wherever the browser has a full screen for pages
(Android's Chrome and Brave do; an iPhone's browsers don't: add the page to the home screen there).

### Library

The phone's home screen (and "Change video") shows rows of titles to tap, like a streaming app. The server collects them from places that
offer video openly, keeps them for six hours, and serves the old list at once while it fetches a new one (or when the place is down).
A title is only a link: tapping it is the same as pasting it, so the existing resolver finds the video and the TV plays it.
The phone's search answers from the titles on the page at once and, from the second letter, adds what the library knows; when the library
cannot be asked it says so (keeping what the page had) and asks again every few seconds. A play that fails is said in a line at the bottom as
well as in the page's own status, which can be far above a library that is scrolled down.

- The default library source is Filmpire (`src/server/library/filmpire.ts`), presenting live categories (Trending Movies & Series, Popular Movies & Series, Top Rated, Animation & Anime, Action & Sci-Fi) and TMDB multi-search. Each title resolves directly to `https://filmpire.sc/watch/:id` (or `?s=1&e=1` for TV shows) which the built-in Filmpire resolver decrypts and plays automatically.
- An alternative source is the Internet Archive's film collections (`src/server/library/internet-archive.ts`).
- A new source is a `LibrarySource` (`id`, `name`, `load()` returning rows of `{ id, title, url, image?, year?, description? }`), passed to
  `buildApp({ librarySources })` from `src/server/index.ts`. Nothing here is specific to one site.
- **On the TV the library is the home page** (`B` returns to it from the connect and party pages): a compact banner for the title the remote is on
  (picture, year, a short description when the source has one, and Play / Resume / the list, named as it is) with rows of titles under it, the banner shrinking
  to a line once the remote moves down to the rows. The rows are **Continue watching**, **Because you watched …** (titles like the last one
  watched, from the source), a row for each of the **lists** with a title in it, then the library's own: the first ranked with big numbers (a "Top 10"), the others rows of pictures,
  and a row of **categories** after the third. Arrows walk the rows, Back leaves. **Choosing a title opens its page** (a big picture, the year,
  what it is about) with **Play** (or **Resume** / **Continue**) and **Add to Favourites** / **Remove from Favourites** (with several lists, **Add to a list**
  opens the lists, one button each, ticked for those the title is in); Back, the **Close** button (Up from the buttons, or Right past the last one)
  or a click beside it closes the page. **A show's page continues below its buttons** with its seasons (when there are several) and the episodes
  of the one that is shown, as cards with a picture, a line about the episode, its length and what this profile has done with it (watched, or
  how long is left, with a bar). **Play** says which episode it starts, *Play S1:E1*, or *Resume S2:E3* for a show part way through, and the
  page opens on that season with the remote on that episode; OK on any episode plays it, from where it was left if it was begun. With a mouse it is a click on the title (its name is the tooltip), on any row; **hovering a title
  shows a round button in its top corner** (a screen with a mouse only, not a touch screen): **+** puts the title in the profile's first list at once (once it is there the button turns into a filled **×**, and a click on that
  takes it out), and **×** on a title of **Continue watching**, or in a list's own row or page, takes it out of that, so a row of films can be filled or emptied by clicking down it;
  the second click of a double click goes through the page to the title under it instead of closing the page or pressing Play, for the half second
  the page takes to arrive. The banner's own buttons play or save the title it shows, without the page. The big banner picture fades in
  over the previous one once it has loaded, instead of switching. Playing from the library and pressing Back (twice if the controls were
  hidden) or letting it stop comes back to the same title. A title that will not play is said so. A TV that watches
  along has no library, since it can't choose what plays.
- **Titles that do not play stop being offered.** A place lists far more than it can play, and only a try tells which. The server hears how every
  try at playing went (`library.played(link, outcome)`, from the WebSocket path only, not from `GET /api/resolve`, which anyone may ask): a place that
  says it has no video of a title takes it off the lists at once; a video that could not be reached just now is one strike, and a second strike
  from a separate try (two minutes or more after the first: a burst of failures at once is one) takes it off, and a title that plays is back
  for good. Left out means out of the rows and of "titles like this" for six hours (the library's own lifetime), then it is tried again; a title
  that a place said has no video is also out of the search, while one that only failed twice still turns up there (typing its name is asking
  for it). The memory is the server's, shared by everyone, and lost when it restarts. A screen
  that sees a try fail (the TV's notice, the phone's status line) asks for the lists again past the browser's memory, and a search is asked
  again with them, so the title is gone from what is on screen. Only the title's own link counts: a show whose first episode (what its tile plays)
  is missing is left out as a whole, one whose later episode is missing is not. Nothing here asks a place about a title ahead of time; the
  one thing known without trying is that a title with a release date in the future is not out yet, so it is never listed.
- **Menu, pages, categories, search (TV).** Pressing Left from the first title of any row (or the first tile of a grid) opens a menu down the
  left: **Search**, **Home**, **Movies**, **Series**, **My Lists**, **History**, **Watch party**, **Connect a phone**, **Settings**, and under them the
  **categories**, films and shows apart, four of each with **More…** opening the page of all of them. Right or Back returns to the titles (with a
  mouse, **resting the pointer on the strip opens the menu**, no button held, and leaving it shuts it), and
  choosing any entry (**My Lists**, **History**, a category…) closes the menu over the page it opens. **My Lists** is a button for each list over
  the titles in it, with **New list** (a name typed on the on-screen or real keyboard) and **Edit list** (rename, or delete after a question). **Movies**
  and **Series** are home pages of only that kind; a category opens as a grid of its titles. **Search** shows an on-screen keyboard (Space, Delete, and Clear for the whole box) beside the
  results (a physical keyboard types too, and Backspace deletes before it means Back) with **All / Movies / Series** filters. Titles already loaded
  answer at once; after a short pause the source's search (`GET /api/library/search?q=`) adds more, and a library whose rows could not be loaded
  can still be searched. **A search forgives the fingers** (`src/shared/search.ts`, on [MiniSearch](https://github.com/lucaong/MiniSearch)): every word of the
  search has to be in the title, but a word may be unfinished (`strang thi`), a letter off (`strager things`), have two letters swapped (`thigns`, and
  `teh office`: a word of three letters too, when another word of the search is longer), a title may
  be typed as one word (`spiderman`), without its accents or apostrophes, with its year (`dune 2021`; a number is not forgiven), or by a short name that starts the search
  (`lotr`, `got`, `hp`). The titles already on screen are matched this way on the TV and the phone; on the server the same ranking is applied to what the
  places answer, and when a place finds little (TMDB's search forgives nothing: "strager things" finds nothing there) it is asked again without each
  word (a slip in one leaves the rest to find the title: `better call sual`), and with a long word cut to its first letters or all but its last two
  (`gladiater`), six questions at most, and the titles that come back are kept only if they match what was typed. **A search lists the likeliest first** (`rankByQuery`):
  the title that is what was typed, then those that begin with it (`boon` is *Boon* and *The Boondocks* before *Baboon*; a leading The, punctuation and accents do not count), then those with a word that begins
  with it, then the rest, the order the places gave (the popular first) kept within each, whether a title came from the screen or from the library. TMDB is read up to three pages (sixty titles) when it has
  that many, so a short word brings a long list to scroll; only the first page is asked about at the video provider, and a title it already said has nothing to play stays out of the others. A search that cannot be reached says so (it asks again every few seconds) instead of saying nothing matches, and a title
  that is part way through says **Resume** on its page wherever it is shown, lists and search included. The menu and search only use the generic
  library endpoints, so they work with whichever `LibrarySource` is configured.
- `LIBRARY=off` starts the server without a library (the e2e server does); `GET /api/library` is then empty and the phone shows nothing extra.

### Episode lists

The episode list shows what the resolver puts in `series.episodes` (`{ season, episode, title?, url }`, where `url`
is the episode's page link). A resolver that doesn't fill it gets no list; "next episode" is derived from it when
`series.next` isn't set. The server log's `resolve` line says `episodes: N` for a series, so `0` means the resolver
supplied none. A show's page on the TV asks the library for the seasons that can be watched (`GET /api/library/seasons?url=`, empty when it
can't tell, and then not remembered) and for the episodes of one (`GET /api/library/episodes?url=&season=`, aired ones only, each with the link
that plays it). When the library source knows more (a picture, a line about the episode, its length: `GET /api/library/episodes`),
the TV lists each episode streaming-app style: season picker on the left, a picture with a progress bar, the name, the length and a
description for each, with watched marks. The phone's list is the same as cards, in one column. An episode the source gave no name is
called "Episode 3" in the language of the screen.

### Sources

`NormalizedMedia.alternates` is an optional list of `{ label?, stream, subtitles? }`: other streams of the same video, in the
order to try them (the main `stream` is always first). A resolver that finds several streams can fill it; the generic resolver
does for the extra streams a page declares. The TV and the phone show a Source picker when there is more than one.

## Hosting on Render

The server is one Node process that serves the page, the API and the sockets from one port, which is what a Render **Web Service** is.

1. New → Web Service → this repository. Build command `corepack enable && pnpm install --frozen-lockfile --prod=false && pnpm build`, start
   command `pnpm start`. Node comes from `.node-version`, and the pnpm version from `packageManager` in `package.json` (that is what
   `corepack enable` is for). `--prod=false` keeps the build tools (`vite`, `tsx`) installed even if you ever set `NODE_ENV=production` for
   the build. Under Advanced, set the health check path to `/api/health`.
2. Render sets `PORT` and `RENDER`, so the server listens where Render looks and trusts its proxy (the rate limits then see each visitor's own
   address, not Render's).
3. **Accounts need a database on the free plan.** A free instance's disk is wiped on every deploy and restart, and it goes to sleep after
   about 15 minutes without visitors (the first request afterwards takes up to a minute while it wakes). Make a free Postgres on **Neon** (or
   Supabase) and set `DATABASE_URL` to its connection string (on Supabase use the **pooler** string, "Connect" → "Session pooler" or
   "Transaction pooler": Render reaches the internet over IPv4 and Supabase's direct host is IPv6 only). Render's own free Postgres is deleted after 30 days, so it is a bad home for
   accounts. The server makes its table by itself (`kino_docs`); there is nothing to migrate. Started on Render without `DATABASE_URL`, it warns
   about this in its log. (Neon's free database wakes by itself when it is asked; Supabase has paused free projects after a week without
   use, and one that is paused has to be restored from its dashboard before the server can start.)
4. Set `TMDB_API_KEY` to your own key, and `REGISTRATION=closed` (or `MAX_ACCOUNTS`) once the people it is for have signed up.
5. Phones and TVs reach it over `https://<name>.onrender.com`, so camera scanning works. **Which phone goes with which TV is kept in the same
   database as the accounts**, so an instance that sleeps and wakes (or is restarted by a deploy) finds every pair as it was: the TV is
   "connected" again the moment its page reconnects, with no new code to scan, and a TV whose page is opened again is put back on the video
   it was on (paused, at its place). A code that is on a screen when the server restarts is not kept (the TV shows a new one). A pair
   nobody has used for more than a year is let go. Open `https://<name>.onrender.com/api/health` to see where a service keeps things:
   `"storage":"postgres"` is the good answer; `"file"` or `"memory"` on Render means **nothing** (accounts, sign-ins, pairs, what was
   playing) survives the instance sleeping, and `DATABASE_URL` is missing on that service (each service needs it, and two services must
   never share one database: each keeps its own copy in memory and would write over the other's). A keep-alive pinger that stops the
   sleep is not worth it on the free plan: its 750 instance hours a month are shared by all the services of an account, so two services
   kept awake all month would run out
   Watch parties and the codes live in the memory of **one service**: two services (two `onrender.com` names, even of the same repository)
   do not know each other's codes, so a phone on a different address than the TV answers "Invalid or expired code" however well the code is
   typed. Use the address the TV shows (the party page prints it) on every device, and delete a duplicate service.

Limits to know about: there is no password reset (no mail is sent, and a password can be anything, so a forgotten one means a new account),
an account with no password can be opened by anyone who types its name (give it one if that matters), and the sign-in rate limits are
per name and per address, so they are best-effort behind a shared proxy. A browser that wipes **all** of a site's data when it is closed
(a private window, some TV browsers) forgets which TV or phone it is, and no page can help that: the cookie that backs up the id goes
too. A TV that is paired when the server's disk is wiped (no database) is paired with nobody afterwards, and shows a new code.

## Test

```bash
pnpm test         # unit + WebSocket integration (vitest), accounts included (Postgres is tested with an in-process PGlite)
pnpm e2e          # real browsers: phone UI + TV page + local fixtures (playwright, builds first)
pnpm typecheck
pnpm fixtures     # optional: regenerate fixtures/ with ffmpeg (outputs are committed)
```

Tests never touch the internet; they use `fixtures/` (served at `/fixtures/`) and, for accounts, an in-memory store (`DATA_DIR=memory`) with
throwaway credentials from `e2e/testAccount.ts`. The e2e suite covers pairing by code and by QR link, camera scanning (Chromium's fake
webcam shows a generated QR code), disconnect and switching TVs, resume, the D-pad, HUD fading, subtitle memory and the episode lists, the
library and its menu, watch parties (from a TV, from a phone, from a link), a second phone and a phone that scans another TV, a phone with
several TVs (`e2e/several-tvs.spec.ts`), a server that is slow to answer (a page whose connections are never answered:
`sleepingServer` in `e2e/helpers.ts`, with the page's clock skipped ahead), the TV page on a
phone, a tablet and a phone held sideways, the end card and mute, full screen (at the first press, kept for the next visit, the buttons),
ratings (scores, notes, seasons and the facts kept with them, on the phone and the TV), friends (made with a code or a link, what a friend can see,
what is sent and told, on the phone and between two TVs: `e2e/friends.spec.ts`, `e2e/friends-tv.spec.ts`), and accounts: registering, profiles (on the phone, and made, renamed and removed on the TV), guest progress combined into an account, a second
device picking up where the first stopped, a TV signed in from a phone or from another screen, and the three languages. The pages in these
tests start as if full screen had been left on an earlier visit (`playwright.config.ts`), so a key press never takes one full screen by
itself; the tests of full screen start from nothing (`FIRST_VISIT` in `e2e/helpers.ts`). A Hisense browser is imitated by its user agent
(`e2e/hisense.spec.ts`), and a TV's OK key by a raw key down and up with no typed Enter.

Browsers that refuse a video until it has been pressed (Brave's strict setting, iPhones) are tested with a browser started with
`--autoplay-policy=user-gesture-required` (`strictBrowser` in `e2e/helpers.ts`). Playwright's own click lets go of the button within a few milliseconds,
a hand takes a tenth of a second or more, and anything that moves under the pointer on the press makes the click miss, so clicks on things that
move on focus use `clickAsAHand`. Not covered by tests, because it needs real hardware: Fire TV /
Android TV remotes, the wake lock, an iPhone's camera and browsers, and the home screen install itself (only that the manifest and its icons are served).

## Layout

```
src/shared/    protocol.ts (messages, commands, state), media.ts (NormalizedMedia, series helpers), account.ts (profiles, the merge), rating.ts (what a rating remembers of the watching),
               friends.ts (the friends' switches, what travels between them)
src/server/    sessions/ (registry: devices, codes, controllers; pairings: which phone goes with which TV, kept between restarts), websocket/hub.ts,
               resolvers/, accounts/ (store, routes, persistence, friends: codes, inboxes, what a friend may see), app.ts
src/client/    controller/ (phone), tv/ (receiver, HUD, menu, library, PlayerEngine), account/ (profile store, sync, shared account UI),
               friends/ (the state both screens share, what is new, the friends' pages of the TV), i18n/ (en, ro, it), shared/ (socket, format, words, logo, icons)
public/        copied as it is into the built page: the web app manifest and its icons
fixtures/      sample.mp4, long.mp4 (40 s, for Up Next), hls/ (VP9, so Playwright's Chromium can decode them)
e2e/           Playwright specs and helpers
```
