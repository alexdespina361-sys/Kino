# RELEASE_CHECKLIST

**State (2026-10-21 night): the cat is on at the live site's host** (the owner set `CAT_COMPANION=on` after the second pull request, #29, was merged: `GET /api/features` says `{"cat":true}`), and every device is still off until its owner turns the cat on in Settings. Round 3 (`feat/kino-cat-3`: exactly two cats to choose from, a line in Settings that says what is really drawn and why, the cat that goes to the title it is asked to find and swats at it, the cat that goes with its row when the viewer scrolls it and hops back or away, and a pat and the zoomies of its own accord) was merged as PR #30 (main `19319ea`) and is live (the page serves its build). This branch (`feat/kino-cat-4`, on top of that main) is the follow-up to the owner's three messages about it: the sleeping pose drawn as a loaf, the fall of a cat that a flung page shakes off its shelf, and the carrying on of the page between two readings so that the cat rides its shelf without steps. Nothing is deployed from it until the owner merges it. No account on the live site was touched and nothing was submitted to it. Merged with `CAT_COMPANION` unset, the site behaves exactly as before: no screen fetches a byte of the cat.

## 1 · What would go out

| Part | Where | Size (gzip) | Loaded when |
|---|---|---|---|
| The switch, the corner button, the loader, the texts (en/ro/it) | the app's always-loaded files | + 6.9 KB over the whole app (measured against main after PR #27, at the end of round 3) | always (it is what lets the cat be asked for) |
| The cat (engine, rig, both painters, panel) | `assets/host-*.js` + `host-*.css` (lazy chunk) | 55.4 KB + 1.7 KB | only when the host offers it **and** the screen plays **and** the device asked for it |
| The detailed cat's body | `assets/cat-*.mesh` | 164.9 KB | only when the detailed cat is drawn, once |
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
| A broken file, mesh or graphics context never breaks the page | **pass** | e2e 23–25 |
| The cat never plays, pauses or seeks; never covers the controls, subtitles or the remote's focus in a film | **pass** (test asserts the player's state; the video's clock was not checked) | e2e 9–11 |
| The cost is held by a governor that reads the real cost | **pass on this PC; unknown on a TV** | 05, ISSUE_LOG #2, #21 |
| No copied code, art, sound or telemetry; Furever Dock never run | **pass** | 06 |
| The one third-party asset (the detailed cat's model, Meshy AI, CC BY 4.0) is credited where a person can read it, and only the derived mesh is in the repository | **pass** (credit in Settings → Cat companion in en/ro/it, and in 06; the GLB is not in the repository). The credit names the maker, the model's title, the licence and its address and the note that it was changed; it has no link to the model's page (ISSUE_LOG #57). The licence itself is the owner's statement; it was not verified on Meshy's site | 06, e2e settings tests |
| Independent review: no P0/P1 open | **pass**: the second review's one P1 (a scrolling grid renamed its shelves, ISSUE_LOG #51) and five smaller findings are fixed with tests; one P3 is open (#57, the credit's link) | 05, "Independent review" |
| **A person tried it on the real screen it is for** (a TV, a Fire Stick, a phone as screen, an iPhone, Safari) | **not done: blocks "enable for everyone", not "merge with the flag off"** | ISSUE_LOG #8 |
| **The owner has watched it and likes the cat** | **not done** | – |
| Romanian and Italian texts read by a native speaker | not done | 05, "Not tested" |

Go for "merge with `CAT_COMPANION` unset": yes, on the evidence above. Go for "set `CAT_COMPANION=on` in production": **no, until the two bold rows are done.**

## 4 · The decisions that are the owner's

1. Whether the cat is offered on the live site at all, and to whom (the flag is site-wide; it is the device's owner who turns it on).
2. The default of a TV: "quiet" on (the cat rests in one place). Taste: an unattended cat is asleep about 39 % of the time.
3. Whether there should be a one-time hint that a cat exists. Today it is found in Settings and by the corner button only; nothing announces it.
4. Whether the floor line under the last row may cover that row's names (ISSUE_LOG #9) or the cat should prefer a shelf with gaps.
5. Whether the phone should get a cat of its own (today: by design none).
6. Sound: none was built; any sound must default to off and never play over a film.
7. The model's licence: the owner says "Fluffy Blue-Eyed Cat" (Meshy AI) is CC BY 4.0; the credit is in the app. Before it goes to everybody, check on the page the model came from that the licence really is CC BY 4.0 for this model and that the credit as written is enough (the file itself carries no licence text), or say to take the detailed cat out (the simple cat does not use it). Also give the address of the model's page, for the credit to link to (ISSUE_LOG #57).
8. Whether the sprite version for weak screens (rendered from the detailed cat with our own renderer, replacing the cartoon fallback) is the next piece of work (`docs/cat-companion.md`, "Next").
9. How much the poster should do when the cat swats at it: today it rocks a few pixels and is put back (the page is not the cat's to change). A bigger reaction (a flip, a shake of the whole row) is a choice for after somebody has watched it (ISSUE_LOG #63).
10. Whether a quiet cat (a TV starts quiet) should swat at all when asked to find something: today it does, because the viewer asked, but it does not hop about on the way.

## 5 · Trying it on a real screen (about ten minutes)

1. Start the branch: `$env:CAT_COMPANION="on"; $env:PORT="8830"; pnpm start` in the branch's folder, or use a preview of the branch (`dist/client` is current in the last commit).
2. On the screen: open `/tv?cat=debug` (the debug view draws places to stand, keep-outs and posters, and a text block).
3. Let it run for a minute, then read the text block (or `window.__kinoCat.snapshot()` in a console): `art` (solid/classic), `quality` (full/low), `cost` (ms), `fps`. Send those four, and whether it stayed `full`.
4. Press OK on a poster, then Back: the cat is sent away and comes back. Start a film: it sleeps in a bottom corner, under the controls and the subtitles (they are drawn over it; it neither covers them nor leaves when they come).
5. Settings → Cat companion: choose each of the two cats and the size. When the white and grey cat is chosen and the screen draws the simple one, the page says why and has a "try again" button: send what it says.
6. Corner button → find me something → a mood: the cat should go to the title (hopping along its shelf if it has to), creep up on it, swat at it twice (the poster rocks) and point. Then scroll the row the cat is on with the wheel, a swipe or the remote: it should go with the posters and hop back or away.

## 6 · Rollback

- **Instant:** unset `CAT_COMPANION` (or set `off`) on the host and restart. Every screen loses its cat at its next load. Nothing is stored on the server.
- **One screen:** Settings → Cat companion → off, or `?cat=off`.
- **Code out:** revert the merge commit (`git revert -m 1 <merge>`) and rebuild `dist/client`; the last commit of the branch is the build, so it comes out with the rest.
- The device's `kino.cat` setting stays in its own storage and is harmless without the flag.

## 7 · After it is on (when it is)

- `GET /api/health` → `features.cat: true`.
- Watch the in-app feedback for "cat" reports; the Feedback button sends the page's diagnostics, which do not include the cat's.
- A governor that keeps stepping down on a kind of screen is a finding, not a failure: the screen is told to get the simple cat and then none.
