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

Under the visitors, the command also says how the server read the address of the request that asked, yours: *Your address, as the server reads it: …* (see "Where
the address is read from").

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

**Where the address is read from.** From the connection, through the proxies in front of the server: `TRUST_PROXY` says how many there are (1 on Render), and
Cloudflare's addresses and the ones inside a host's own network are passed over as well, so the visitor is the first address of `X-Forwarded-For`, read from the
right, that is none of those (`src/server/trust.ts`). It is the address the rate limits use too (sign-ups, wrong passwords, link polls, feedback). What a visitor
writes in that header comes first in the list and is never read, and `CF-Connecting-IP` is not used (anyone who reaches the host directly could write it). With no proxy
in front, it is the connection's own. **To see it work:** the stats end with *Your address, as the server reads it*, which must be your own public address (what a
"what is my IP" page says): if it is a Cloudflare address or the host's, the count and the limits are counting the wrong thing. Cloudflare's addresses
(https://www.cloudflare.com/ips) are listed in `trust.ts` as they were on 2026-11-01; they change rarely, and one that is missing is read as a visitor, as every one
was before this. Someone with a Cloudflare account of their own can send requests to the host from Cloudflare's machines and write the list as they please: what that
gets them is a say in a rate limit and a count, no more.

**Turning it off:** `VISITOR_COUNT=off` on the host (and restart): nobody is counted, the stats say so, and what was counted stays until it is deleted
(`drop table kino_visits` in the database, or the file `visits.json`).

## The owner's page

A page the owner opens in a browser (the owner, 18 Nov 2026: "a webpage that is hosted on github, where I can see: active users/guests, accounts
created, movies/content watched (minutes), feedback received", and "the base for future real time security"). The page is three files in
`owner-stats/` and holds no numbers: it asks the site, `GET /api/owner/stats?days=30`, every 30 seconds while it is looked at.

**What it shows**

- **Here now**: browsers that asked the site something in the last five minutes, how many of them brought a session (signed in) and how many did not
  (guests), and how many screens and phones are connected. Kept in memory only (`stats/live.ts`): a restart begins again. A browser is told from another
  by a hash of its address and its name with a secret made at the start of the server; nothing but the hash is held, for a quarter of an hour.
  Programs that say what they are, and browsers that send "Do Not Track" or "Global Privacy Control", are not among the people.
- **Accounts** and **Visitors**: the numbers of the command above.
- **Watched**: minutes of film played by signed-in profiles, all together, one number a day (kept with the visitors'). It is counted as a profile's
  progress comes in: how far a film's card moved on, when that is no more than the time that went by (a jump ahead is no watching), and never more than
  the time that went by on the server's clock. A guest's watching is kept on the guest's device and never reaches the server, so it is not in the number.
  Nothing is counted for the time before the key was set.
- **Feedback**: how many reports, how many are open, how many nobody has touched, and the ten newest: kind, area, how it stands and when it
  came. Never the heading or the words of a report, or who sent it: those are a person's own and the team's to read (`scripts/feedback.mjs`).
- **How the server answered** in each of the last 24 hours: answers, turned away (401, 403), told to wait (429), the server's own failures (500 and
  over). An hour that has far more of one of these than the usual hour (five times, and thirty at least) is named at the top of the page. It names
  nothing else and stops nothing by itself: it is where a person, or later a program, starts to look.

**The key.** `OWNER_STATS_TOKEN` on the server (24 characters at least; `openssl rand -base64 30` makes one). It reads this one answer and nothing
else: not the reports' words, not the team's side of anything, and it changes nothing. It is not the team's token and must not be the same one. Without
it the address is not there (404) and none of the above is counted. A wrong key is slowed like the team's: ten from one address close the door for a
quarter of an hour. The page keeps the key in the browser it was typed in (`localStorage`), and has a button that forgets it.

**The page somewhere else.** A browser lets a page of another site read the answer only if the server names that page's origin:
`OWNER_STATS_ORIGIN=https://<name>.github.io` (an origin: nothing after the name). One origin, exactly; no `*`. The key is what keeps the numbers, the
origin only says whose script may read them, so a GitHub page of somebody else cannot, even with the key, from a browser. The page itself is locked
down (`Content-Security-Policy`: its own script and style, and connections only), writes everything it shows as text, and sends no referrer.

**Putting it up on GitHub Pages** (three steps, the owner's: none is done until the owner says so)

1. On the box, in `/etc/kino-web.env`: `OWNER_STATS_TOKEN=...` and `OWNER_STATS_ORIGIN=https://<github-name>.github.io`, then restart `kino-web`.
2. In the repository's *Settings → Pages*, *Source: GitHub Actions*. Copy `owner-stats/pages-workflow.example.yml` to
   `.github/workflows/owner-stats-pages.yml` (it publishes the folder `owner-stats/` and nothing else) and run it from the *Actions* tab.
3. Open `https://<github-name>.github.io/<repository>/`, type the site and the key.

The repository is public, and so is the page: it is an empty frame until a key is typed. Nothing secret is in it.

**Not tried:** the page on GitHub Pages itself and the server's settings on the box (it is off there until the owner sets the key). Tried: the answer,
the key, the origin rule and the first question a browser asks (`OPTIONS`), in tests; what is counted as a person; the minutes, with clocks set wrong.
## The notice

The app has no privacy text of its own (nothing for the accounts, the history or the feedback either). The visit count has a notice, `public/privacy.html`, served
at `/privacy.html` in English, Romanian and Italian: it says only how visits are counted, and says that it is not the whole policy. It is not linked from the app;
link it from wherever a privacy text goes. Whether it is enough is the owner's call (and a lawyer's, if it matters); it says how this is built and is not a legal opinion.

## What this does not tell, and what was not tested

- **Nothing about the time before it was deployed.** The count starts at the first load after the deploy. Cloudflare's own *Analytics & Logs → Traffic* for
  `kino.24-7.ro` is the only place that has the earlier visits (unique visitors by address, as far back as the plan keeps).
- **Tried:** the counting rules, the day roll-over, the restart in the middle of a day, the table next to the accounts (in a PGlite database), the command against
  a real server process (file storage, `TRUST_PROXY=1`, headers sent by hand), that nothing written holds an address or a browser's name, and the address read
  through every chain that could be built by hand (the host alone, Cloudflare in front, two Cloudflare machines, a proxy inside the host, IPv6, a list a visitor wrote,
  a request sent straight to the host dressed as Cloudflare's), in tests and against that process.
- **Not tried before it was deployed:** the real thing behind Cloudflare and Render. *Your address* in the stats is for that: it must be your own.

## Where it is

`src/server/stats/visits.ts` (the counter and where it is kept), `summary.ts` (the numbers), `routes.ts` (the hook that counts and `/api/admin/stats`),
`live.ts` (who is here now, the answers by the hour), `owner.ts` (`/api/owner/stats`), `owner-stats/` (the page),
`AccountStore.usage()` in `src/server/accounts/store.ts` (the accounts' side, numbers and moments only), `scripts/feedback.mjs` (`stats`) and `scripts/stats.mjs`.
