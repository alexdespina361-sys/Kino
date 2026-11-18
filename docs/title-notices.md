# Notices of new episodes, seasons and films

A profile is told when something new comes out of what it watches (the owner, 18 Nov 2026): a new episode or a new season of a show it has a card or a
rating of, and a new film of the series of films ("collection") one it watched belongs to. The bell lists them on every screen; the Android app (0.3.2 and
later) shows a notification that says only that there is something new.

Code: `src/shared/titleNotices.ts` (what a notice is), `src/server/titleNotices/` (`book.ts` decides and keeps, `source.ts` asks the movie database,
`followers.ts` reads who watches what from the accounts, `routes.ts`), `src/client/titleNotices/notices.ts` (what the bell shows).

## Rules

- **Only titles the library numbers** (a link `filmpire.sc/watch/<TMDB id>`): a pasted link, or a title from another place, is not followed.
- **What counts as watching**: a card of "Continue watching" (kept for what was finished too) or a rating; the 80 newest titles of a profile. A title only
  saved to a list is not watched.
- **Silent first sight**: the first time a profile is seen to watch a title it is told nothing. What is out by then is its starting point. A profile that
  turned the notices off is told nothing and gets no backlog when it turns them on again.
- **An episode is news a day and a half after the start of the day it aired** (`HOLD_MS`): TMDB dates an episode by the day in its own country, which
  begins up to a day before the episode is shown, and the places it plays from have it some hours later. The library lists an episode from its air date,
  so a notice never points at an episode the title's page does not list. An episode that aired waits its own day and a half (`waiting` in the show's
  document), whatever airs after it: a show with an episode every day tells of each one in turn.
- **A long first season is told of without numbers** (`ONE_SEASON_MAX`, 26): a show TMDB keeps as one season of hundreds of episodes is played in parts
  (`partsOf` in `library/filmpire.ts`), and its page numbers them otherwise. The notice says "A new episode is out".
- **The bell lists the six newest** and marks those as looked at (`POST …/seen {ids}`); one that is not listed yet stays news until it is.
- **A film is news once it can be watched at home** (a digital, physical or TV release in TMDB's release dates), as the library's own rule has it. A child's
  profile is told of the shows it watches, never of a film it has not seen.
- **One line for each title**, the newest news of it; 30 lines at most, kept a month.
- **A profile's phone is told three times a day at most** (`TELLS_PER_DAY`); the bell has every notice. Firebase is told the kind (`title`) and the
  profile, never the title.

## Cost

One question to TMDB for each title, for everybody who watches it, and only when something may have changed: a show that is over once a week, a running
one on the day its next episode is due and again when that episode is news, one with no date for its next episode once a day, a series of films once a week (daily
while a film of it is about to come out). Six titles a minute at most (`TITLES_PER_LOOK`, `LOOK_MS`), so a start with everything due takes a while and
hurts nobody. What is known is kept (`title-notices.json` in `DATA_DIR`, or the table `kino_title_notices`), so a restart asks about nothing again and
tells nobody twice.

## Switches

- A profile: Settings, "New episodes and films" (the `titleNotices` setting; the server reads it).
- The host: `TITLE_NOTICES=off` (and restart): nothing is looked for and the bell has none. `LIBRARY=off` does the same.
