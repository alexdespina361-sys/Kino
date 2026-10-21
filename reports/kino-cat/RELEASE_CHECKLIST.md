# RELEASE_CHECKLIST

**State: not released. Nothing has been deployed, no environment variable has been set anywhere, no account on the live site was touched.** The branch is `feat/kino-cat` (off `main` after PR #27). Merged with `CAT_COMPANION` unset, the site behaves exactly as it does today: `GET /api/features` says `{"cat":false}`, no screen fetches a byte of the cat, and the only visible difference in the code is a switch that is never shown.

## 1 · What would go out

| Part | Where | Size (gzip) | Loaded when |
|---|---|---|---|
| The switch, the corner button, the loader, the texts (en/ro/it) | the app's always-loaded files | + 4.7 KB over the whole app (measured against main) | always (it is what lets the cat be asked for) |
| The cat (engine, rig, both painters, panel) | `assets/host-*.js` + `host-*.css` (lazy chunk) | 44.2 KB + 1.5 KB | only when the host offers it **and** the screen plays **and** the device asked for it |
| The detailed cat's body | `assets/cat-*.mesh` | 218.3 KB | only when the detailed cat is drawn, once |
| Server | `/api/features`, `/api/health` `features.cat`, env `CAT_COMPANION` | – | – |

No new dependency (`package.json` and the lockfile are not in the diff). Final figures after the last build are in 00.

## 2 · Gates, in the order they must pass

1. The host sets `CAT_COMPANION=on` (**the owner's decision, not made**).
2. The screen is the one that plays (role `tv`, which includes a computer's browser); the phone as a remote never has a cat.
3. The device turns it on in Settings → Cat companion (a TV starts with "quiet" on: the cat only rests).
4. Not `prefers-reduced-motion` (then it only rests, in one place).

## 3 · Go / no-go

| Gate | Status | Evidence |
|---|---|---|
| Types, unit, end-to-end, soak pass | **pass** | 05, "Automated checks" |
| Off by default; nothing fetched while off | **pass** | e2e 1–2 |
| Kill switch: unset `CAT_COMPANION` → next load of every screen has no cat | **pass** (a screen that is already open keeps it until it reloads: R13) | e2e 2 |
| A broken file, mesh or graphics context never breaks the page | **pass** | e2e 14–16 |
| The cat never plays, pauses or seeks; never covers the controls, subtitles or the remote's focus in a film | **pass** (test asserts the player's state; the video's clock was not checked) | e2e 8 |
| The cost is held by a governor that reads the real cost | **pass on this PC; unknown on a TV** | 05, ISSUE_LOG #2, #21 |
| No copied code, art, sound or telemetry; Furever Dock never run | **pass** | 06 |
| Independent review: no P0/P1 open | see ANIMATION_BACKLOG and 05, "Independent review" | – |
| **A person tried it on the real screen it is for** (a TV, a Fire Stick, a phone as screen, an iPhone, Safari) | **not done: blocks "enable for everyone", not "merge with the flag off"** | ISSUE_LOG #8 |
| **The owner has watched it and likes the cat** | **not done** | – |
| Romanian and Italian texts read by a native speaker | not done | 05, "Not tested" |

Go for "merge with `CAT_COMPANION` unset": yes, on the evidence above. Go for "set `CAT_COMPANION=on` in production": **no, until the two bold rows are done.**

## 4 · The decisions that are the owner's

1. Whether the cat is offered on the live site at all, and to whom (the flag is site-wide; it is the device's owner who turns it on).
2. The default of a TV: "quiet" on (the cat rests in one place). Taste: an unattended cat is asleep about 40 % of the time.
3. Whether there should be a one-time hint that a cat exists. Today it is found in Settings and by the corner button only; nothing announces it.
4. Whether the floor line under the last row may cover that row's names (ISSUE_LOG #9) or the cat should prefer a shelf with gaps.
5. Whether the phone should get a cat of its own (today: by design none).
6. Sound: none was built; any sound must default to off and never play over a film.

## 5 · Trying it on a real screen (about ten minutes)

1. Start the branch: `$env:CAT_COMPANION="on"; $env:PORT="8830"; pnpm start` in the branch's folder, or use a preview of the branch (`dist/client` is current in the last commit).
2. On the screen: open `/tv?cat=debug` (the debug view draws places to stand, keep-outs and posters, and a text block).
3. Let it run for a minute, then read the text block (or `window.__kinoCat.snapshot()` in a console): `art` (solid/classic), `quality` (full/low), `cost` (ms), `fps`. Send those four, and whether it stayed `full`.
4. Press OK on a poster, then Back: the cat is sent away and comes back. Start a film: it sleeps in a bottom corner, under the controls and the subtitles (they are drawn over it; it neither covers them nor leaves when they come).
5. Settings → Cat companion: try the coat, the size and "detailed cat" off.

## 6 · Rollback

- **Instant:** unset `CAT_COMPANION` (or set `off`) on the host and restart. Every screen loses its cat at its next load. Nothing is stored on the server.
- **One screen:** Settings → Cat companion → off, or `?cat=off`.
- **Code out:** revert the merge commit (`git revert -m 1 <merge>`) and rebuild `dist/client`; the last commit of the branch is the build, so it comes out with the rest.
- The device's `kino.cat` setting stays in its own storage and is harmless without the flag.

## 7 · After it is on (when it is)

- `GET /api/health` → `features.cat: true`.
- Watch the in-app feedback for "cat" reports; the Feedback button sends the page's diagnostics, which do not include the cat's.
- A governor that keeps stepping down on a kind of screen is a finding, not a failure: the screen is told to get the simple cat and then none.
