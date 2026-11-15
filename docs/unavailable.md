# What nobody could play

The films and episodes that the library lists and that no source had a video of. The screens mark them **Not available yet**, and the team has a list of them, the most asked
for first, to look for sources with.

```
node scripts/unavailable.mjs            what the screens mark now
node scripts/unavailable.mjs --all      every one kept (also what found nothing only once, or not for two weeks)
node scripts/unavailable.mjs --json     the list as it is
```

It is the same command as `node scripts/feedback.mjs unavailable`, and it finds the site and the team's token the same way the feedback does
([docs/feedback.md](feedback.md): `KINO_URL` and `FEEDBACK_ADMIN_TOKEN`, or `.kino-feedback.json`). The server answers `GET /api/admin/unavailable` (`?all=1` for every one)
to that token and to nothing else, as it does the stats ([docs/stats.md](stats.md)).

```
Kino on https://kino4tv.com, at 2026-11-15 15:00 UTC: 2 marked "Not available yet" on the screens, 3 kept in all.

Times  Last        First       What, and its link
    4  2026-11-15  2026-11-14  Pokémon S25E06
                                 https://filmpire.sc/watch/60572?s=25&e=6
    2  2026-11-12  2026-11-10  A Quiet Film (film)
                                 https://filmpire.sc/watch/77
```

## The rules (src/server/library/unavailable.ts)

- **What counts.** A Play, from a phone or from the TV, whose look-up found nothing: every source answered and none had it (`unsupported`). (The look-up ahead of the
  next episode is the resolver's own and does not count.) A source that could not be reached (`temporary_failure`) never counts. The plain `/api/resolve` route, which anyone may ask, counts for nothing.
- **Marked after two occasions.** One "nothing" can be a source that was slow just then, or having a bad afternoon, so a title is marked only once two separate
  occasions found nothing, at least 6 hours apart, with no video found in between. Try again and the screen's second look are the same occasion as the Play.
  `--all` shows the ones that found nothing only once too.
- **A label, nothing more.** Play still looks the title up as always: a source that has it now plays it, and that one found video takes the mark away for good. Nothing
  is ever asked of a source to keep this list.
- **How long.** The mark is shown for two weeks after the last occasion; the record is forgotten after two months that nobody met it. At most 3000 are kept (the
  one met the longest ago goes first).
- **What is kept.** Only the library's own links (a film, or an episode of a show it lists), never a pasted link, and never who pressed Play: the title, its season and
  episode, the link, how many occasions and when. It lives next to the accounts (the table `kino_unavailable` in Postgres, `unavailable.json` in a data folder), so a
  restart or a deploy keeps it.

## Where the screens show it

- A show's page, on the TV and on the phone: the episode says **Not available yet** and its picture is dimmed. It is still a button: pressing it plays it if a source
  has it now.
- A film's page: a line says that no source had it the last times it was tried, and that you can try again. On the TV it is above the buttons (the page stands on its
  foot there), on a phone under them: either way, Play does not move when the answer comes.
- The phone's episode list while something plays.

The screens ask `GET /api/library/unavailable?url=<any link of the title>` (never kept by a browser), once for each title page that is opened, and again after a minute.
