# Baseline: the classic look as it is today

Taken 2026-10-13 from branch `ui/polish-system` (commit `125b5f9`, which is `origin/main` `cde1d7f` plus the look switch). Nothing in the pictures is real content: a made-up catalogue of 32 films and 8 series with drawn posters (`scripts/ui-walk/lib.mjs`), test accounts that live in a throwaway server's memory.

**History.** This is the old look, as it was on 2026-10-13, before the refined layer: it is kept as the "before" of the work. Since 2026-10-16 the site has one look (D18), so the walk takes no `--ui` any more: `pnpm ui:walk -- --scan` (about 5 minutes, builds the client first) draws today's look into `.ui-polish/shots/polish/` and measures it into `.ui-polish/scan/polish/`, then `pnpm ui:drift`. The classic pictures (`.ui-polish/shots/classic/`, git-ignored) were taken with the switch that is gone.

## What the walk covers

| Device | Size | Role | Pictures |
|---|---|---|---|
| `tv-1280` | 1280x720 | TV, signed out | 30: every screen (welcome, home, rail, movies, series, categories, search, lists, title pages, rate, list picker, profile hub, history, ratings, settings, sign-in, connect, party, player HUD + menus) |
| `tv-1920` | 1920x1080 | TV, signed out | 11: the main screens |
| `tv-2560`, `tv-1440x900`, `tv-1366x768` | 2560x1440, 1440x900, 1366x768 | TV UI in a big / desktop / laptop window | 11 each: the main screens |
| `tv-1280-signed-in`, `tv-1920-signed-in` | 1280x720, 1920x1080 | TV, signed in with friends | 22 each: friends, ratings, history, account, profiles, party, bell, player |
| `phone-390` | 390x844 (x2 pixel ratio) | phone remote, signed out | 17: pair, home, search, sheets, menu, My TVs, party, account, settings, remote while playing |
| `phone-390-signed-in` | 390x844 | phone remote, signed in with friends | 18: home, bell, settings, hub, friends, ratings, profiles, devices, security, lists |

152 pictures + 1 "live" picture (the player HUD over a real film frame, for looking only), 154 scans, 32,127 measured elements. Every step of the walk worked (`0 failed`).
Full list of screens and what is not yet covered: `SCREEN_INVENTORY.md`.

## What is pinned, what still moves

The walk pins what changes by itself from one run to the next: random pairing / friend / sign-in codes and the TV's name (replaced by fixed text of the same shape), the pattern of the QR codes, the frame of the film (hidden in every picture except `*-live`), CSS animations (fast-forwarded), toasts (waited out). What still moves:

* `tv-*-signed-in/s03-friends-page`: the gradient of a friend-request tile comes from a random id (about 2-3% of the picture).
* `tv-1920-signed-in/s01-home` (and the same screen at 1280): **which element is focused when the home screen first shows is a race.** On a quiet machine nothing was focused (hero "Popular this week" with no ring); on a loaded machine the first "Continue watching" tile was (hero turns into "Resume"). Run three times in a row under load the result was the same each time; the very first, quiet run differed. This is a finding for the TV audit, not noise in the tool.
* the player HUD's time labels and the phone remote's position (about 0.1% of the picture).

## Proof that the classic look is untouched by the look switch

The same walk was run against a build of the old `main` (`cde1d7f`, before any of this work) and compared with the classic baseline above (`pnpm ui:compare`, tolerance 0.05% of the pixels): **156 pictures, 135 identical, 14 different, 3 missing, 4 new.** Every difference is explained:

| Pictures | Why |
|---|---|
| `tv-1280/20-settings`, `tv-1280-signed-in/s13-account-panel`, `tv-1920-signed-in/s13-account-panel`, `phone-390/p11-settings-guest-1of3`, `-2of3`, and `phone-390-signed-in/p23-settings-signed-in-*` (3 "missing" + 4 "new": the page is one part longer) | the new "Look" row in Settings: the only visible change to the classic look, on purpose |
| `s01-home` (1920 signed in) | the focus race described above |
| `s03-friends-page` (both sizes) | the random tile gradient |
| `26-player-hud` (1366x768, 1440x900), `04-rail-open` (1440x900, 1920), `p27-friend-code`, `p14-speed-sheet` | 0.06-0.10% of the pixels: timing noise (a time label, a fade) |

## What the pages use today (live-DOM scan; `drift/classic.md` has the full tables and the rule breaks)

| | TV / desktop screen | Phone |
|---|---|---|
| distinct type sizes | **31** (em) | **26** (px) |
| font weights | 5 (400, 600, 700, 800, 900) | |
| distinct corner radii (pill/circle counted once) | **15** | **7** |
| distinct surface colours | **31** | **21** |
| distinct text colours | 28 | |
| distinct shadows | 45 | |
| distinct transitions | 16 | |

Rule breaks found automatically (raw counts; the audits triage them): text under the floor 52 kinds, text contrast under 4.5:1 17 kinds, controls with no accessible name 17, phone controls under 44 px 81, TV text/controls inside the safe margin 558 (mostly the rail and the top bar: to be triaged), TV pages with nothing focused 19.
