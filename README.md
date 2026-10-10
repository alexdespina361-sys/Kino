# Kino — Phone-to-TV Clean Web Player

Phone = remote control. TV = clean video player. One Vite app: one address, and each screen becomes the remote or the TV (`/tv` always plays) and one Fastify
server (`/api`, `/ws`, static UI), same origin.

```
phone ──WS──▶ server ──WS──▶ TV player ──▶ media (directly, no proxy)
        (paste a link: the server finds the video, the TV plays it without the page)
```

## Run

```bash
pnpm install
pnpm dev          # Fastify :8787 (auto-restart) + Vite :5173, one terminal
```

- TV: http://localhost:5173 on a screen without touch (or `/tv` anywhere) → shows a 6-digit code and a QR code
- Phone: scan the QR code with the **Scan** button (or the phone's own camera app), or type the code
- Real phone on the same Wi-Fi: use `http://<your-pc-ip>:5173` (allow Node through the Windows firewall)
- Camera scanning needs HTTPS or `localhost`; over plain `http://<ip>` the phone falls back to typing the code
- Restart the server after pulling changes (`pnpm dev` does it by itself). A page newer than the server shows
  "The server doesn't understand this app version" instead of working half-way.

Production, one process (`PORT` and `HOST` are optional, default `8787` and `0.0.0.0`):

```bash
pnpm build && pnpm start     # http://localhost:8787
```

## What it does

**Phone**
- Pair by QR scan (camera) or by code; a QR link opened from the phone's camera app pairs by itself and also switches TVs
- Paste a page or media link; recent links are listed and resume where they stopped. Opening the phone page as `/?url=<link>` plays that link
  once connected (the hook for a share button; there is no installable app manifest yet)
- Remote: play/pause, ±10 s, seek bar, audio/subtitle/speed/quality/source sheets, previous and next episode, episode list,
  subtitle style, full screen, stop, disconnect (volume is the TV's own). It confirms what the TV did ("Speed 1.5×") in a line at the bottom

**TV**
- Clean player with a fading HUD (title, clock, "ends at", seek bar with a time tooltip on hover, buffering spinner, big play/pause)
- D-pad remote support: ←/→ seek 10 s, ↓ wakes the controls and moves focus, Enter presses, Back closes menus. Every screen before
  the video (the first "Press OK" page, the pairing code, the connected screen, the library) is walked with the arrow keys: the first
  press only lands on a button, so a stray OK never presses one (`src/client/tv/dpad.ts`)
- The controls are sized to fit one row on any screen shape, with every button present (series, subtitles, sources, quality); long
  episode names are cut, and a row that still can't hold them wraps instead of running off the edge
- Subtitles and audio like a streaming app: the language you chose is remembered. Tracks the file labels only with a code (`eng`) are
  named by their language. Subtitles are drawn by the page, so size, font, colour, opacity, background, edge, height and word spacing
  all work on any TV browser; change them from the TV's menu or the phone, with a live preview. A browser only lets a page go full screen
  after a press on that page, so the phone's button works once the TV has had one: the TV asks for an OK press when it hasn't
- Episodes: seasons and episodes, past and future, when the resolver supplies them; previous / next (`P` / `N`), an up-next card and autoplay of the
  next one. The lists mark what was watched and how long is left (remembered in each device's own storage)
- Sources: a video can carry alternates; if the first stream fails the TV tries the next by itself, and either device can pick one
- While it waits for a video, two same-size buttons: **Browse library** and **Disconnect from phone** (unpairs the TV and shows a new code; the
  phone goes back to the code screen). The library button is also on the pairing screen, so a TV can pick a film with no phone at all
- Keeps the screen awake while playing; reconnects by itself, and notices a dead connection within about 25 s

**Server**
- Resolves a link to a playable stream: the generic resolver plus the site adapters in `src/server/resolvers/adapters/`
- Pairing codes are single-use and expire after 10 minutes. After 20 wrong codes in a minute (all phones counted together)
  pairing pauses until the minute is over, because the code is only six digits
- State is in memory: restarting the server forgets pairings, and the TV shows a new code

### One page, two roles

Every device opens the same address. A screen without touch (a TV, a monitor) or a TV browser (Fire TV, Tizen, webOS, Android TV)
becomes the player; a phone or tablet becomes the remote. `/tv` is always the player, `/?role=remote` or `/?role=tv` asks for one
screen without remembering it, and the `/?code=` and `/?url=` links made for the phone always open the remote. A screen that was guessed
wrong has a quiet "Use this screen as ..." link (on the TV's code screen, the phone's connect screen and its TV menu); the choice is
remembered on that device. The rules are in `src/client/role.ts`.

### Watching together

On the phone: TV menu → "Watch together on more TVs". Open the app on another TV, press OK, and type the code it shows (up to five
extra TVs). That TV now plays whatever the phone's TV plays, in step: the first TV reports its position, the server relays it, and each
other TV nudges its speed by a few percent when it drifts a fraction of a second, or jumps when it is a second or more off (`src/client/tv/sync.ts`).
Pausing, skipping and speed on the phone follow too, and a TV added mid-film starts at the same place. The extra TVs have no controls of
their own except Leave (Down, then OK on the remote); the phone's list can send any of them away. A TV's pairing code is single use, and
wrong codes count against the same limit as pairing.

### Library

The phone's home screen (and "Change video") shows rows of titles to tap, like a streaming app. The server collects them from places that
offer video openly, keeps them for six hours, and serves the old list at once while it fetches a new one (or when the place is down).
A title is only a link: tapping it is the same as pasting it, so the existing resolver finds the video and the TV plays it.

- The default library source is Filmpire (`src/server/library/filmpire.ts`), presenting live categories (Trending Movies & Series, Popular Movies & Series, Top Rated, Animation & Anime, Action & Sci-Fi) and TMDB multi-search. Each title resolves directly to `https://filmpire.sc/watch/:id` (or `?s=1&e=1` for TV shows) which the built-in Filmpire resolver decrypts and plays automatically.
- An alternative source is the Internet Archive's film collections (`src/server/library/internet-archive.ts`).
- A new source is a `LibrarySource` (`id`, `name`, `load()` returning rows of `{ id, title, url, image?, year?, description? }`), passed to
  `buildApp({ librarySources })` from `src/server/index.ts`. Nothing here is specific to one site.
- On the TV, **Browse library** (or `B`) opens a streaming-app layout: a banner for the title the remote is on (picture, year, a short
  description when the source has one) and rows of titles under it. Arrows walk the rows, OK plays, Back leaves; playing from the
  library and pressing Back (twice if the controls were hidden) or letting it stop comes back to the same title. A title that will not
  play is said so on the TV and leaves it in the library. A TV that watches along has no library, since it can't choose what plays.
- `LIBRARY=off` starts the server without a library (the e2e server does); `GET /api/library` is then empty and the phone shows nothing extra.

### Episode lists

The episode list shows what the resolver puts in `series.episodes` (`{ season, episode, title?, url }`, where `url`
is the episode's page link). A resolver that doesn't fill it gets no list; "next episode" is derived from it when
`series.next` isn't set. The server log's `resolve` line says `episodes: N` for a series, so `0` means the resolver
supplied none.

### Sources

`NormalizedMedia.alternates` is an optional list of `{ label?, stream, subtitles? }`: other streams of the same video, in the
order to try them (the main `stream` is always first). A resolver that finds several streams can fill it; the generic resolver
does for the extra streams a page declares. The TV and the phone show a Source picker when there is more than one.

## Test

```bash
pnpm test         # unit + WebSocket integration (vitest)
pnpm e2e          # real browsers: phone UI + TV page + local fixtures (playwright, builds first)
pnpm typecheck
pnpm fixtures     # optional: regenerate fixtures/ with ffmpeg (outputs are committed)
```

Tests never touch the internet; they use `fixtures/` (served at `/fixtures/`). The e2e suite covers pairing by
code and by QR link, camera scanning (Chromium's fake webcam shows a generated QR code), disconnect and switching TVs,
resume, the D-pad, HUD fading, subtitle memory and the episode lists.

Not covered by tests, because it needs real hardware: Fire TV / Android TV remotes, the wake lock, an iPhone's camera,
and installing the app to the home screen.

## Layout

```
src/shared/    protocol.ts (messages, commands, state), media.ts (NormalizedMedia, series helpers)
src/server/    sessions/registry.ts (devices, codes, controllers), websocket/hub.ts, resolvers/, app.ts
src/client/    controller/ (phone), tv/ (receiver, HUD, menu, PlayerEngine), shared/ (socket, format, logo, icons)
fixtures/      sample.mp4, hls/ (VP9, so Playwright's Chromium can decode them)
e2e/           Playwright specs and helpers
```
