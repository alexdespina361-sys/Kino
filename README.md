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
| `DATABASE_URL` | – | Keep accounts in Postgres. Without it they are kept in `DATA_DIR`. |
| `DATA_DIR` | `data` | Folder for the accounts file `kino.json` (git-ignored: it holds password hashes). `memory` keeps nothing. |
| `REGISTRATION` | `open` | `closed`: nobody new can make an account (once the people it is for have one). |
| `MAX_ACCOUNTS` | unlimited | A cap on accounts, for a small server. |
| `TRUST_PROXY` | `1` on Render, else off | How many proxies sit in front (a number, `true` or `false`), so the rate limits see the real address. |
| `LIBRARY` | on | `off` starts without the browsing library. |
| `TMDB_API_KEY` | built-in key of the Filmpire source | The library's TMDB key. Set your own; the built-in one is shared by everybody who runs this. |

## What it does

**Accounts and profiles**
- Register and sign in with an email and a password (hashed with scrypt; the session is an `httpOnly` cookie). An account has up to **five
  profiles**, each with a name and one of **twelve avatars**; who is watching is asked on every new device, Netflix-style, and a profile
  is switched from the account page (the profile picture in the phone's top bar, and in the TV's library menu).
- **Watching is saved to the profile**, wherever it is watched: **Continue watching** (the place in every unfinished film or episode, and the
  next episode of a show once one is finished), **My List**, the watched marks on episode lists, and the profile's settings. Open the app
  on another phone, TV or browser, sign in, pick the profile, and it carries on from the same second.
- **Signed out, the device keeps the same things as a guest** (`localStorage`). Signing in **combines** them with the profile that is chosen:
  per item the newest copy wins, a removal is remembered for 45 days so another device cannot bring the item back, and nothing is counted
  twice. Whatever was watched while signed out is on the account afterwards.
- **Sync** runs when a profile is chosen, every 45 seconds, a few seconds after something changes, when the tab is shown again or the
  connection returns, and as the page closes. It sends only what changed since the last revision (`POST /api/profiles/:id/sync`), and a
  device that is offline keeps working and catches up.
- **Sign a TV in from the phone.** Typing an email on a TV remote is a chore, so the TV's sign-in page shows a QR code and a short code
  (`ABCD-2345`). A phone that is already signed in opens it (the camera app, or Account → "Sign in a TV" to scan or type the code), sees what is
  asking, and approves; the TV is signed in a moment later. The code works once and expires after five minutes, and nothing signs a TV in
  until a signed-in person says yes. A screen that is signed in itself can do the asking too (a computer with no phone at hand): its account
  page has **Sign in a TV**: type the code the other screen shows, check who is asking, approve.
- The phone's account page: profiles, settings, devices (sign others out), password, delete account. The TV has its own: who's watching,
  profiles, settings.
- **Settings per profile:** website language, accent colour (the red can be any of several colours), whether the next episode follows by
  itself, and the subtitle languages (below).

**Phone**
- Pair by QR scan (camera) or by code; a QR link opened from the phone's camera app pairs by itself. A phone that already has a TV is asked
  what the other one is for: join the watch party, or be controlled instead (the first TV is let go). Nothing changes behind its back
- A second phone joins the same TV with the QR code (and code) in the TV menu, scanned off the first phone's screen, or with the code and QR
  code the TV itself shows on its "Connected" page (**Connect a phone** in the TV's side menu): both are remotes, either can
  add TVs to the party, and the menu says how many are connected. The TV flashes "A phone is connected." when one joins. That code stays good
  while a phone keeps asking for it (opening the menu, or the TV's page being open); a phone that already has a TV and scans it is only offered
  to control that TV instead
- Paste a page or media link, or tap a title from **Continue watching**, **My List** or the library. Opening the phone page as `/?url=<link>` plays that link
  once connected (the hook for a share button)
- **Add it to the home screen** and the page opens as an app with no browser bar (`public/manifest.webmanifest`; on an iPhone that is the only
  way to lose the bar, since its browsers have no full screen for pages): Share → *Add to Home Screen* there, the browser's menu → *Install app*
  or *Add to Home screen* on Android
- Remote: play/pause, ±10 s, seek bar, audio/subtitle/speed/quality/source sheets, previous and next episode, episode list,
  subtitle style, full screen, stop, disconnect (volume is the TV's own). It confirms what the TV did ("Speed 1.5×") in a line at the bottom

**TV**
- Clean player with a fading HUD (title, clock, "ends at", seek bar with a time tooltip on hover, buffering spinner, big play/pause). Paused, the
  title steps out of the corner and is said once, large, on the left ("You're watching …"); a skip flashes on the side it went towards; and
  the Up Next card counts down only for a profile that plays the next episode by itself
- D-pad remote support: ←/→ seek 10 s, ↓ wakes the controls and moves focus, Enter presses, Back closes menus. Every screen before
  the video (the library, a title's page, the pairing code, the connected screen, the account pages, the "Press OK" page of a party link) is walked
  with the arrow keys: the first press only lands on a button, so a stray OK never presses one (`src/client/tv/dpad.ts`)
- The controls are sized to fit one row on any screen shape, with every button present (series, subtitles, sources, quality); long
  episode names are cut, and a row that still can't hold them wraps instead of running off the edge
- Subtitles and audio like a streaming app: the language you chose is remembered. Tracks the file labels only with a code (`eng`) are
  named by their language. Subtitles are drawn by the page, so size, font, colour, opacity, background, edge, height and word spacing
  all work on any TV browser; change them from the TV's menu or the phone, with a live preview. A browser only lets a page go full screen
  (and play with sound) after a press on that page, so the TV goes full screen with the first title chosen on it, or the party joined with a press,
  and is left alone after that (Esc or the button leaves it for good); the phone's button works while the TV has had a press lately: the TV asks
  for an OK press when it hasn't. If the browser still refuses to start a video, a **Tap / press OK to play** button says so instead of a blank screen
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
- Sources: a video can carry alternates; if the first stream fails the TV tries the next by itself, and either device can pick one
- **The library is the front door.** The site opens straight into it, signed in or not (a guest's progress stays on that screen), so a screen can
  pick a film with no phone at all. A short welcome fades over it while it fills in, and takes no press. (Only a party link opens a "Press OK" page
  first, because that screen joins the moment it is pressed.) **Connect a phone** is one entry of its menu; once a phone is connected that page
  says so, with **Back to the library** and **Disconnect from phone** (unpairs the TV and shows a new code; the phone goes back to the code screen)
- **Sign in** is the button in the library's top corner (the profile picture once signed in); nobody is made to
- **Any device can be this screen.** The same page lays itself out for the size of the device: the TV's wide layout from about 900 px
  up, and below that (a phone, a tablet, a narrow window) a compact one with a thin menu, a smaller banner, titles that swipe along, a native
  search field (the phone's own keyboard) and as many columns as fit. Taps press everything, swipes scroll, the first touch on hidden controls only
  brings them up, and every page has a way out for a finger. A phone held sideways gives the banner less height. Volume stays the device's own
- Keeps the screen awake while playing; reconnects by itself, and notices a dead connection within about 25 s

**Server**
- Resolves a link to a playable stream: the generic resolver plus the site adapters in `src/server/resolvers/adapters/`
- Pairing codes are single-use and expire after 10 minutes. After 20 wrong codes in a minute (all phones counted together)
  pairing pauses until the minute is over, because the code is only six digits
- Pairings and what is playing are in memory: restarting the server forgets them, and the TV shows a new code. **Accounts are not**: they are
  written to disk (or Postgres) a moment after every change and again when the server is told to stop

### Languages

The language can be switched on the phone's connect screen and in Settings (phone and TV); a profile remembers its choice, a device remembers
the last one, and a first visit follows the browser. `src/client/i18n/` holds one dictionary per language: `en.ts` is the list of keys and `ro.ts` and `it.ts` must have every one
(the compiler and `i18n.test.ts` check, including the `{placeholders}` and the plural forms Romanian needs). Everything a person reads goes through
`t("some.key")`; what the player and the server say in English (an error code, "Subtitle 3") is put into words by `src/client/shared/words.ts`.
Titles and descriptions come from the library source and are not translated. Adding a language is a new dictionary and a line in `UI_LANGUAGES`.

### One page, two roles

Every device opens the same address. A screen without touch (a TV, a monitor) or a TV browser (Fire TV, Tizen, webOS, Android TV)
becomes the player; a phone or tablet starts as the remote, and can be the player too. `/tv` is always the player, `/?role=remote` or
`/?role=tv` asks for one screen without remembering it, the `/?code=` and `/?url=` links made for the phone always open the remote, and a
`/?party=` link always opens a screen. A device that was guessed wrong has a way over: **Watch on this device** on the phone's connect page,
the TV menu of a connected phone, and a quiet "Use this screen as a remote" link on the TV's own pages; the choice is remembered on that
device. The rules are in `src/client/role.ts`. Each role is a chunk of its own (`src/client/main.tsx`), so a phone downloads the remote and a
TV the player, and the video library (hls.js) and the QR scanner load only when they are needed.

### Watch party

One TV plays and up to five more screens watch along, in step. A guest is anybody: a TV, a computer, or a phone that opened the link
(a phone that opens a party link is a screen of the party, not a remote). It works signed in or not; a screen is listed by the profile that
is watching on it, or else by its own name ("TV 3F2A"). Ways in:

- **From a TV:** menu → **Watch party** → *Start a party* (or the **Watch party** button in a film's controls). The screen shows a
  6-digit code, a QR code and the address; on another screen choose **Watch party → Join a party** and type the code with the remote's
  number keys (the on-screen pad works too).
- **From the phone that controls the TV:** its menu → **Watch party** shows the same code and QR code with a **Share link** button, and
  lists who is in (the host's phone can send any guest away). Typing the pairing code that another TV shows into the phone still works.
- **From a link:** `/?party=<code>` opened on any device shows a "Press OK or tap to start" page and joins on that press (the press is also
  what lets the browser play with sound and go full screen).

The code lasts ten minutes (renewed while it is on screen), admits screens until the party is full, and wrong codes count against the same
limit as pairing. A TV with a phone connected can host a party but not join one. Everybody in a party can see who else is in it; the host can remove
a guest or end the party, and a guest can leave from its own bar.

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

- The default library source is Filmpire (`src/server/library/filmpire.ts`), presenting live categories (Trending Movies & Series, Popular Movies & Series, Top Rated, Animation & Anime, Action & Sci-Fi) and TMDB multi-search. Each title resolves directly to `https://filmpire.sc/watch/:id` (or `?s=1&e=1` for TV shows) which the built-in Filmpire resolver decrypts and plays automatically.
- An alternative source is the Internet Archive's film collections (`src/server/library/internet-archive.ts`).
- A new source is a `LibrarySource` (`id`, `name`, `load()` returning rows of `{ id, title, url, image?, year?, description? }`), passed to
  `buildApp({ librarySources })` from `src/server/index.ts`. Nothing here is specific to one site.
- **On the TV the library is the home page** (`B` returns to it from the connect and party pages): a compact banner for the title the remote is on
  (picture, year, a short description when the source has one, and Play / Resume / My List) with rows of titles under it, the banner shrinking
  to a line once the remote moves down to the rows. The rows are **Continue watching**, **Because you watched …** (titles like the last one
  watched, from the source), **My List**, then the library's own: the first ranked with big numbers (a "Top 10"), the others rows of pictures,
  and a row of **categories** after the third. Arrows walk the rows, Back leaves. **Choosing a title opens its page** (a big picture, the year,
  what it is about) with **Play** (or **Resume** / **Continue**) and **Add to My List** / **Remove from My List**; Back, the cross or a click
  beside it closes the page. With a mouse it is a click on the title (hovering shows nothing; the title's name is the tooltip), on any row; the
  second click of a double click goes through the page to the title under it instead of closing the page or pressing Play, for the half second
  the page takes to arrive. The banner's own buttons play or save the title it shows, without the page. The big banner picture fades in
  over the previous one once it has loaded, instead of switching. Playing from the library and pressing Back (twice if the controls were
  hidden) or letting it stop comes back to the same title. A title that will not play is said so and stays in the library. A TV that watches
  along has no library, since it can't choose what plays.
- **Menu, pages, categories, search (TV).** Pressing Left from the first title of any row (or the first tile of a grid) opens a menu down the
  left: **Search**, **Home**, **Movies**, **Series**, **My List**, **History**, **Watch party**, **Connect a phone**, **Settings**, and under them the
  **categories**, films and shows apart, four of each with **More…** opening the page of all of them. Right or Back returns to the titles, and
  choosing any entry (**My List**, **History**, a category…) closes the menu over the page it opens. **Movies**
  and **Series** are home pages of only that kind; a category opens as a grid of its titles. **Search** shows an on-screen keyboard beside the
  results (a physical keyboard types too, and Backspace deletes before it means Back) with **All / Movies / Series** filters. Titles already loaded
  answer at once; after a short pause the source's search (`GET /api/library/search?q=`) adds more, and a library whose rows could not be loaded
  can still be searched. The menu and search only use the generic library endpoints, so they work with whichever `LibrarySource` is configured.
- `LIBRARY=off` starts the server without a library (the e2e server does); `GET /api/library` is then empty and the phone shows nothing extra.

### Episode lists

The episode list shows what the resolver puts in `series.episodes` (`{ season, episode, title?, url }`, where `url`
is the episode's page link). A resolver that doesn't fill it gets no list; "next episode" is derived from it when
`series.next` isn't set. The server log's `resolve` line says `episodes: N` for a series, so `0` means the resolver
supplied none. When the library source knows more (a picture, a line about the episode, its length: `GET /api/library/episodes`),
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
   about this in its log.
4. Set `TMDB_API_KEY` to your own key, and `REGISTRATION=closed` (or `MAX_ACCOUNTS`) once the people it is for have signed up.
5. Phones and TVs reach it over `https://<name>.onrender.com`, so camera scanning works. Pairings live in memory: if the instance sleeps or
   restarts, the TV shows a new code and the phone reconnects to it (accounts, progress and lists are not lost).

Limits to know about: there is no password reset or email check (no mail is sent), and the sign-in rate limits are per address, so they
are best-effort behind a shared proxy.

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
library and its menu, watch parties (from a TV, from a phone, from a link), a second phone and a phone that scans another TV, the TV page on a
phone, a tablet and a phone held sideways, the end card and mute, and accounts: registering, profiles, guest progress combined into an
account, a second device picking up where the first stopped, a TV signed in from a phone or from another screen, and the three languages.

Browsers that refuse a video until it has been pressed (Brave's strict setting, iPhones) are tested with a browser started with
`--autoplay-policy=user-gesture-required` (`strictBrowser` in `e2e/helpers.ts`). Playwright's own click lets go of the button within a few milliseconds,
a hand takes a tenth of a second or more, and anything that moves under the pointer on the press makes the click miss, so clicks on things that
move on focus use `clickAsAHand`. Not covered by tests, because it needs real hardware: Fire TV /
Android TV remotes, the wake lock, an iPhone's camera and browsers, and the home screen install itself (only that the manifest and its icons are served).

## Layout

```
src/shared/    protocol.ts (messages, commands, state), media.ts (NormalizedMedia, series helpers), account.ts (profiles, the merge)
src/server/    sessions/registry.ts (devices, codes, controllers), websocket/hub.ts, resolvers/, accounts/ (store, routes, persistence), app.ts
src/client/    controller/ (phone), tv/ (receiver, HUD, menu, library, PlayerEngine), account/ (profile store, sync, shared account UI),
               i18n/ (en, ro, it), shared/ (socket, format, words, logo, icons)
public/        copied as it is into the built page: the web app manifest and its icons
fixtures/      sample.mp4, hls/ (VP9, so Playwright's Chromium can decode them)
e2e/           Playwright specs and helpers
```
