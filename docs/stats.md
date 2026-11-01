# The owner's stats

How many accounts there are, and how many people open the site, by day. Counts only: nothing here can tell who anyone is.

```
node scripts/stats.mjs                  the last 14 days
node scripts/stats.mjs --days 60        more days (up to 400)
node scripts/stats.mjs --json           the numbers as they are
```

It is the same command as `node scripts/feedback.mjs stats`, and it finds the site and the team's token the same way the feedback does
([docs/feedback.md](feedback.md): `KINO_URL` and `FEEDBACK_ADMIN_TOKEN`, or `.kino-feedback.json`). The server answers `GET /api/admin/stats?days=30`
to that token and to nothing else (no token set on the server, or one shorter than 24 characters: 404; a wrong one: 401, and ten wrong tries from one
address close the door for a quarter of an hour).

```
Accounts: 37 (52 profiles). Sign-ups are open, up to 500.
  made      today 2, last 7 days 9, last 30 days 37
  used      today 5, last 7 days 14, last 30 days 30
  devices   browser 31, tv 12, remote 4

Visitors (counted since 2026-11-02; nobody was counted before):
  people    today 12, last 7 days 61, last 30 days 150
  loads     today 30, last 7 days 120, last 30 days 340

       Day  New accounts  Accounts  Visitors   Loads
2026-11-02             3        37        12      30
```

## What the numbers are

- **All days are UTC days.** A day ends at 02:00 in Romania (03:00 in summer). "Last 7 days" is today and the six before it.
- **made** is accounts made in those days; **Accounts** in the table is how many there were by the end of each day. Accounts that were
  deleted are gone from the past as well: the table is what exists now, looked at day by day.
- **used** is accounts that have a device signed in which was used in those days. A device that signs out is not kept (neither is its last
  use), so a person who signed out and never came back is not counted as used, however recently they did. A device is written down at most once an hour.
- **devices** is the devices signed in now, by kind (`browser`, `tv`, `remote`).
- **people** is visitors, added up day by day: a person who comes on three days is three. It is **browsers, not human beings**: one
  person on a phone and on a TV is two, two people on one address with the same browser are one, and a phone that changes address in the
  middle of a day (mobile data to Wi-Fi) may be two. It is a good number to watch rise and fall, not one to quote to the unit.
- **loads** is the page loads that were counted (the phone's page `/` and the TV's `/tv`, with a page the browser already had counting too).

## How a visitor is counted, and what is kept

The server looks at a page load of `/` or `/tv` once it has been answered, and makes **a hash of the address it came from, the browser's name and the browser's
language, salted with a secret made for the day** (sha256, cut to 16 characters). The hash only tells a second load of the same day from a new visitor. At the end
of the day the hashes are deleted together with the salt (a second after midnight UTC while the server is running, otherwise as it starts or at the next
visit), so what was kept cannot be turned back into an address and cannot tell today's visitor from yesterday's. What stays is the number of the day.

Kept in the database (a table `kino_visits` next to the accounts' own; in a file `visits.json` in `DATA_DIR` where the accounts are in a file; nowhere
when the accounts are nowhere):

| Key | What it holds | How long |
| --- | --- | --- |
| `visits:2026-11-02` | `{ visitors: 12, loads: 30 }` | for good (a few bytes a day) |
| `seen:2026-11-02` | the day's salt and the hashes of its visitors | until the day is over |

The counter never stores the address, the browser's name or the language (they are only hashed), sets no cookie, puts nothing on the visitor's device and sends
nothing to another service. **Outside the counter, and not touched by it:** the server's ordinary request log (Fastify's, which has each request's address; the host
keeps it for a short while) and the records of Render and Cloudflare, which any site behind them has. A day stops adding new visitors at 20,000 (the loads go on
being counted), so a flood of made-up browsers cannot grow what is kept.

**Not counted:** anything that is not a person opening a page (files of the site, the API, a request that does not ask for a page, a page in a frame,
a prefetch), a path the site does not have, robots that say what they are (search engines, link previews, uptime checks, scripts), and **people whose browser
sends Do Not Track or Global Privacy Control**. A robot that calls itself a browser is counted; there is no telling it apart.

**Where the address is read from.** With a proxy in front (`TRUST_PROXY`, 1 on Render) the visitor is the address Cloudflare saw (`CF-Connecting-IP`), else the first
of `X-Forwarded-For`; with none, the connection's own. The stats say how many loads each kind of address was behind since the server started
(`address` line). **If a host's proxy hands the server its own address and not the visitor's, nearly all would be "the connection" and the counts would be too
low**: that line is how to see it.

**Turning it off:** `VISITOR_COUNT=off` on the host (and restart): nobody is counted, the stats say so, and what was counted stays until it is deleted
(`drop table kino_visits` in the database, or the file `visits.json`).

## The notice

The app has no privacy text of its own (nothing for the accounts, the history or the feedback either). The visit count has a notice, `public/privacy.html`, served
at `/privacy.html` in English, Romanian and Italian: it says only how visits are counted, and says that it is not the whole policy. It is not linked from the app;
link it from wherever a privacy text goes. Whether it is enough is the owner's call (and a lawyer's, if it matters); it says how this is built and is not a legal opinion.

## What this does not tell, and what was not tested

- **Nothing about the time before it was deployed.** The count starts at the first load after the deploy. Cloudflare's own *Analytics & Logs → Traffic* for
  `kino.24-7.ro` is the only place that has the earlier visits (unique visitors by address, as far back as the plan keeps).
- **Tried:** the counting rules, the day roll-over, the restart in the middle of a day, the table next to the accounts (in a PGlite database), the command against
  a real server process (file storage, `TRUST_PROXY=1`, headers sent by hand), and that nothing written holds an address or a browser's name.
- **Not tried:** the real thing behind Cloudflare and Render, and a real Postgres. The `address` line is for that: after the first deploy, open the
  site and run the command; if `from Cloudflare` or `from X-Forwarded-For` is not most of the loads, the counts are wrong and the reading of the address has to change.

## Where it is

`src/server/stats/visits.ts` (the counter and where it is kept), `summary.ts` (the numbers), `routes.ts` (the hook that counts and `/api/admin/stats`),
`AccountStore.usage()` in `src/server/accounts/store.ts` (the accounts' side, numbers and moments only), `scripts/feedback.mjs` (`stats`) and `scripts/stats.mjs`.
