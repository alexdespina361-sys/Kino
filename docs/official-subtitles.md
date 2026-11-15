# Kino Official subtitles

For every film and episode of the library, one subtitle file in each language the site makes them in (English and Romanian for now), the best the site
has. Over time each title the screens have played gets one. The screens list it first of its language, as **English · Kino Official** or
**Română · Kino Official**, and turn it on before any other file of that language. A choice the viewer made before still wins: a viewer who picked
another file by its name gets that file again.

## How one is made

1. **The text is a subtitle site's file.** Only the files of the Romanian subtitle sites (which the server keeps) and of OpenSubtitles (which it
   fetches through its proxy) are used. The captions a video's own player lists come from the video's servers, and the server never fetches from
   those to make one.
2. **The times come from a screen.** Every screen that shows subtitles times them to the film's sound with the subtitle aligner
   ([docs/subtitle-sync.md](subtitle-sync.md)). A file counts once a screen has placed at least 90 % of its lines, and 60 % of them by the words it
   heard (the voice detector alone can be seconds off over music). Then the screen sends the server its times for that file: only times, line by
   line, together with where the file itself starts each line. The server then fetches the file itself and takes the text from it, never from the
   screen. It checks that the file is the one the screen read: the same number of lines, each starting where the screen says. It also checks that
   the file was listed for that title in the past 12 hours. A line the screen did not place is moved by as much as the placed lines on either side
   of it.
3. **The text is tidied** (`src/server/subtitles/clean.ts`, rules version 1). The rules leave out:
   - credits and advertising in the first 3 and the last 5 minutes;
   - any line naming a subtitle site or team, wherever it is.

   They also write:
   - Romanian with ș and ț (comma below), and mend Romanian files written in the wrong code page (ª/º/þ/ã for Ș/ș/ț/ă);
   - English "l" read from pictures as "I";
   - speakers' dashes as "- ";
   - no space before a comma or a question mark.

   They take out markup other than italics, bold and underline, and make one line of a line said twice in a row. The file's own text is kept next
   to every line that was changed.
4. **A better one replaces it.** A later screen's times replace the kept file only when they placed clearly more of the file (3 points more of
   the lines, or of the lines placed by words). A file the team has been over is never replaced.

Each screen then aligns a Kino Official file as it aligns any other. So a film of another cut, with a logo more or a few seconds less at the start,
is put right on that screen too. The first screen that plays a new Kino Official file times it from the start, because it has no timing shared by
other screens yet. After that, the screens share its timing as they do for any file.

## What it cannot do, and why

- **No alignment without a viewer.** The times come only from the screens of people who watch the film. The website's server, and the Oracle box,
  never download a film's sound to align subtitles themselves: that would mean fetching whole films from the video sites, which the site does not
  do. A title nobody has watched with subtitles on has no Kino Official file yet.
- **Wording and speakers are the team's.** Grammar, an awkward sentence, or a line given to the wrong speaker cannot be fixed for certain from the
  text alone: a rule that guessed would be wrong as often as right. The team corrects those (below), by hand or with a language model.
- **Fewer for some titles.** Where the video's own player lists captions, the screens show them first when no listed file names a release
  (WEB, BluRay, DVD). Those captions are never made into a Kino Official file. Such titles get one only from a viewer who picks a subtitle site's
  file.
- **One cut.** Each file keeps the length of the film it was timed on (`duration`). On another cut, the screen's own aligner moves the lines.
- **Room.** At most 800 are kept, in the accounts' Postgres (the free Supabase plan, 500 MB shared with the accounts and the shared timings; a film's
  file is some tens of kilobytes). When there are more, the ones changed longest ago go first, but never one the team has been over.

## The team's side

```
node scripts/official.mjs                                  the list, newest first: language, words share, lines, what was tidied, what it was made from
node scripts/official.mjs show <id>                        saves .official/<id>.srt to correct, and .official/<id>.json with what the file first said
node scripts/official.mjs put <id> .official/<id>.srt --note "read through"     sends the corrected words back
node scripts/official.mjs remove <id> --yes                the next screen that times the file well makes it again
```

`node scripts/official.mjs` is the same as `node scripts/feedback.mjs official`. It finds the site and the team's token the same way the feedback
does ([docs/feedback.md](feedback.md)). Correct the words line for line in the `.srt`: no line added or taken away. The times stay as they are
unless `--times` is given. Once sent, the file is the team's: no screen replaces it. `.official/` is ignored by git, because subtitle text never goes
into this public repository.

A pass with a language model works the same way: `show`, give it the `.srt` with the instruction to fix the spelling, grammar and speakers' dashes
line for line without adding, joining or splitting lines, check what comes back, and `put` it.

## Where it lives

- `src/shared/official.ts`: what a screen sends, and when a file is timed well enough.
- `src/server/subtitles/official.ts`: the store (table `kino_official` in Postgres, `official/` in a data folder), the offers, the lists the screens
  are sent. `src/server/app.ts` adds the tracks to every Play's answer (`withOfficial`) and remembers the tracks a Play listed (`heard`).
- `src/server/subtitles/officialRoutes.ts`:
  - `GET /api/subtitles/official/<id>-<version>.vtt`: kept by a browser for good, because a new version has a new link;
  - `POST /api/official/offer`: 20 an hour from one address;
  - the team's `GET/PUT/DELETE /api/admin/official[/<id>]`.
- `src/client/subsync/official.ts` and `session.ts` (`offerOfficial`): when a screen offers a file. It offers once, and once more as the film
  closes if a good deal more was placed. `src/client/tv/officialOffer.ts` sends it. The debug panel says `offered for Kino Official`.
- `/api/health` says how many there are (`official`).
