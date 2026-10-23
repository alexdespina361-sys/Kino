# Kino — Phone-to-TV Clean Web Player

A clean video player for any screen: a TV, a computer or a phone plays, and a phone can also be the remote of another screen. One Vite app: one
address, and each device becomes the screen or the remote (`/tv` always plays) and one Fastify server (`/api`, `/ws`, static UI), same origin.
Accounts with profiles keep what you watched on every phone, TV and browser; the whole site speaks English, Romanian and Italian.

```
phone ──WS──▶ server ──WS──▶ TV player ──▶ media (through the server's /api/proxy for the sites that need it)
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
| `DATABASE_URL` | – | Keep accounts, which phone goes with which TV, and what each TV was playing in Postgres. Without it they are kept in `DATA_DIR`. |
| `DATA_DIR` | `data` | Folder for the file `kino.json` that holds the same (git-ignored: it holds password hashes). `memory` keeps nothing. |
| `REGISTRATION` | `open` | `closed`: nobody new can make an account (once the people it is for have one). |
| `MAX_ACCOUNTS` | unlimited | A cap on accounts, for a small server. |
| `SIGNUPS_PER_HOUR` | `10` | How many accounts one address may make in an hour (a household or a school behind one address may want more). |
| `TRUST_PROXY` | `1` on Render, else off | How many proxies sit in front (a number, `true` or `false`), so the rate limits see the real address. |
| `LIBRARY` | on | `off` starts without the browsing library. |
| `TMDB_API_KEY` | built-in key of the Filmpire source | The library's TMDB key. Set your own; the built-in one is shared by everybody who runs this. TMDB's free licence is for non-commercial use and asks for a notice, which the phone's library shows (see [Library](#library)). |
| `EDGE_STREAM_PROXY_URL` | – | The separate video relay endpoint. For the signed Node relay use `https://YOUR-RELAY-HOST/api/proxy`; see [relay setup](STREAM_RELAY_SETUP.md). |
| `EDGE_STREAM_PROXY_KEY` | – | Server-side signing secret shared with the separate relay's `STREAM_RELAY_KEY`. Never expose it in browser code. |
| `PROXY_VIDEO` | `on` | `off`: this server never carries a film (`/api/proxy` passes subtitles and nothing else), so the host's bandwidth cannot go on one. |
| `DIRECT_STREAMING` | off | `true`: a source's own address is handed to the screen (unless there is a relay). Only for sources that let pages of other websites in; see below before you use it. |
| `FEEDBACK_ADMIN_TOKEN` | – | The team's token (24 characters or more) for reading and answering what people send with the **Feedback** button. Without it reports are kept and nobody can read them. Keep it secret; see [docs/feedback.md](docs/feedback.md). |
| `FEEDBACK_MAX_MB` | `150` | What the reports (their pictures, nearly all of it) may take up before the oldest closed ones make room. |
| `FEEDBACK_SENDS_PER_10_MIN` | `6` | How many reports one address may send in ten minutes. |

## What it does

**Accounts and profiles**
- Register and sign in with a **name and a password, and nothing else asked for**: both can be anything (the password as short as one
  character, or none at all; the name only has to be one nobody has taken, upper or lower case alike, and may be an email address if someone
  prefers). **An account with no password is open to anyone who types its name**, and the sign-up page says so. A password that is none,
  shorter than six characters, the name itself, one character over and over, or one of the first things anybody tries (`123456`,
  `password`, ...) is **asked about before the account is made**: a page in the form's place says what it means (no password: it can be shared
  very easily; a poor one: it is easy to guess) and offers "Change the password" (the form again, as it was left) or "I agree"; on a TV Back
  is "Change the password". It is a question and not a rule, the server takes any password (`src/client/account/password.ts`). Passwords are hashed with
  scrypt; the session is an `httpOnly` cookie that lasts 400 days (the longest a browser keeps one) and is renewed every time the app is
  used, so a signed-in browser stays signed in until the person signs out or the browser's data is cleared. The page also remembers who was
  signed in, so a screen does not look signed out while the server is slow to answer (a free host waking up). An account has up to **five
  profiles**, each with a name and one of **twelve avatars**; who is watching is asked on every new device, Netflix-style, and a profile
  is switched from the account page (the **You** place of the phone's bar, or the profile picture at its top, and the library's top corner on the TV). The TV makes,
  renames, re-pictures and removes profiles itself, with the remote's arrow keys: profile picture in the top corner (or **Settings** on the
  menu's **Profile** page) → **Manage profiles**; the "Who's watching?" page that follows a sign-in has the same tile for a new profile and the same button.
- **Watching is saved to the profile**, wherever it is watched: **Continue watching** (the place in every unfinished film or episode, and the
  next episode of a show once one is finished), **lists** (every profile has one called **Favourites**, and can make others and name them,
  up to twelve in all; a title can be in several), the watched marks on episode lists, and the profile's settings. Open the app
  on another phone, TV or browser, sign in, pick the profile, and it carries on from the same second.
- **Ratings.** A film, a show or **one season of a show** can be given a score from 1 to 10, each with a word (1 *Appalling*, 5 *Average*, 8 *Very
  good*, 10 *Masterpiece*), and **a score is all it takes**: one tap on the phone (the *Your rating* line on a title's page, and under a show's season tabs a
  line for the season shown), or OK on a number on the TV (**Rate** on a title's page, with the remote already on 7). A note saying why is optional: typed
  on the phone (kept as it is typed), and on the TV with the keys of a page of its own. The rating also **writes down the watching behind it**, with no
  work from the person: *when it was rated*, *how much was watched* (**from 95% on it counts as all of it**, since the credits are often skipped; a
  show or a season is counted in episodes, "2 of 3 episodes watched") and *when it was finished* (or last watched). Watching it again later adds to that;
  rating it again changes the day it was rated only when the score changes. **My ratings** is a row of the phone's **My Lists** place with a page of its own
  (*See all*: newest first or highest first, with the notes and those facts, and the mean; it is also a row of the phone's account page, which works with no TV paired too: a title opens from it without Play, and with
  nothing rated the page says what to do) and a place on
  the TV's **Profile** page. **A title that was rated shows its score** (a star and the number) in the corner of its picture wherever it is shown, in the rows, a
  grid, a search, Continue watching, the lists and what friends recommended, on the phone and the TV, so what was rated is seen while scrolling the library
  (a screen reader says it with the title; a season's score is the season's: the show shows none of its own). Ratings are saved to the
  profile and synced like the lists (up to 500, and past that the oldest, notes with them, fall away without a word; a guest's stay on the device and are combined on sign-in). **Rate what I watch** in Settings (phone
  and TV) switches the whole thing off, every sign of it, and keeps what was rated.
- **Friends** are optional and **off until a profile turns them on** in its settings (phone and TV; they belong to an account, so a guest is told to sign in).
  Two profiles become friends with a code (`ABCD-2345`, good once and for a week) that one gives and the other types or opens as a link: the phone shows it
  with a QR code, a **Copy code** button and a link to send (with a **Copy link** button of its own); the TV shows it with a QR code and the same **Copy code** button, which the remote or a mouse presses; where a browser will not copy, the code is selected instead, to be copied by hand. Up to 5 codes can be out at once (a sixth takes back the oldest, and the phone says so beside the button); one can be taken back. A friend can **look at your lists and
  ratings** (a page for each friend), **be sent a title** (*Recommend to a friend* on a title's page, with a few words of why on the phone; when the friend chosen has just stopped taking things the sheet says so and stays open, words and all, for somebody else), **be invited to a
  watch party** (a button that joins on the phone; on the TV, pressing the invitation on the Friends page joins) and **hear what you watch** ("Sam is watching
  Alien", from a minute in, the last two weeks). Each of these has a switch of its own: *Friends can see my lists*, *…my ratings*, *Tell friends what I watch*,
  *Tell me what friends watch* (something is told only when one gives and the other gets), *Friends can send me titles and invitations*, *Friends can see when I'm online*. They live in the
  profile's settings, so the server, not the screen, decides what a friend is shown or may send, from the other profile's synced settings; with friends off nothing is
  shared, sent or received, and the friends are kept for when it is turned on again (turning it on again **resumes sharing with them at once**, so a friend you
  mean to be rid of is removed first: with friends off, *Settings → Friends* on the phone lists the friends you still have, each with a button that removes them,
  and nothing has to be turned on for it). On the TV the friends are a place of the **Profile** page, on the phone a row of the account page. What friends sent shows as a row, a dot (phone) or a number on the menu's Profile line (TV), and a
  line when it arrives; either friend can remove the other (a red button of its own under their page, away from the buttons over their titles, which opens a window
  that asks first, with Cancel under the remote), which also takes back the codes the one who removed had out, so that a code the
  other was shown cannot bring them back. A friend's tile (and row, on the phone) shows the picture they chose, and a friend's page on the TV has a **Back** button
  of its own for a mouse (the remote's Back does the same). **Online**: a friend whose Kino page is open somewhere shows a green dot and *Online* (a page in front
  asks the server how its friends stand every half minute, which is what tells the server it is there: online means heard from in the last 90 seconds, and it is
  shown only while both profiles have friends and *Friends can see when I'm online* on, so that switch is the way to be seen as offline for a while, or always, and
  it also hides the others from you). When you tell what you watch and a friend hears it, **how far you got** shows on their page of your lists and ratings: the
  episode you are at and how far into it ("S2:E5 · 63%", or *Watched*), with a thin bar over the picture; a title left after a few seconds is not counted, and a
  friend who does not hear what you watch sees none of it. **Watching together**: an invitation to a watch party is worked out when a friend reads it, not when it is
  sent: it carries the host's code *as it is now* (a party's code lasts ten minutes and is renewed only while the host's screen shows it, so the one an invitation was
  sent with would be refused after a while) and says whether the party is still open. Pressing one that is not says *That party is not open any more*, and the
  invitation becomes **Ask to watch together** (a button on that friend's page too) when that friend takes things (*Friends can send me titles and invitations*, on
  unless they turned it off), whether or not they tell what they watch: they get *"Sam wants to watch
  together"* with a **Start a party** button, which starts a party on their screen (the TV, or the TV their phone controls) and invites the one who asked, which takes
  the request away. The server sends a request (`kind: "together"`, a newer one replaces an older, gone after 12 hours) only to a friend who takes things,
  and refuses an invitation to a party that is not open (`409 party_closed`). Friends: `/api/profiles/:id/friends…`.
  **Plan a watch together.** A friend who takes things (the rule for *Ask to watch together*: friends on, *Friends can send me titles and invitations* on) can be given a
  **day and time**: *Plan a watch together*, the button beside *Ask to watch together* on their page. On the phone it is a sheet with the phone's own date and time pickers and
  a few words to add; on the TV it is a page with a row of the next 7 days and a row of hours (15:00, then 18:00 to 22:00), where the arrow keys choose and OK sends (a TV has
  no keyboard to type a note with). It starts on 20:00 today, or on the next of 21:00 and 22:00 that is at least 5 minutes ahead, else on 20:00 tomorrow. The friend gets
  *"Sam proposes to watch together: Saturday at 20:00"* as a line, in the bell and on the Friends page (a row of its own on the TV, *Plans to watch together*) with **Accept** and **Decline**.
  A plan is an inbox item of its own kind (`kind: "plan"`; its time is `when`, one number of epoch milliseconds, because `at` is when an item was delivered), and each one who reads it
  reads it in their own time zone, as *today*, *tomorrow*, the name of the weekday for the six days after, else the date. The server takes a time from 5 minutes to 30 days ahead
  (`plan_soon`, `plan_far`), for one friend at a time, and keeps at most 3 plans waiting for an answer from one friend to another and 10 from one profile to all of its friends
  (`plan_full`; the same time sent again takes the place of the old plan and is not counted twice); a note is made fit to show, and a plan counts against the same rate limit as the
  other things sent. A **yes** keeps the plan on in both inboxes, read in the same words by both (*"Watching together with Sam"*), and tells the one who asked; a **no** takes it away from
  the one who said it and tells the other (*"Sam can't make it"*, kept 12 hours, and it can be sent away); a plan nobody answers goes at its time, and one that was said yes to stays
  for two hours after it. A plan that was sent cannot be taken back (the friend's no, or its time, ends it). **When the time comes** a page of either friend that is open says so, once: a
  note, and on the phone a banner on the home screen; the plan's line has a **Start a party** button (on the TV, OK on the plan's tile), which does what it does for a request to watch
  together: it starts a party on that friend's screen and invites the other. Starting a party for a friend from 30 minutes before a plan's time on **ends the plan** in both inboxes (the
  party is the plan; it also covers a phone whose clock runs fast). **Kino sends no push messages or emails, so nothing rings:** the note is shown only by a page of Kino that is open at the
  time (a page asks the server every 30 seconds and when it comes to the front, and sets a timer for the next moment a plan changes; a phone that slept says it when it wakes up), and the
  sheet that plans says so. Taking a friend off the friends takes the plans between them away. A page loaded before this version cannot read an inbox item of a kind it does not know:
  reload it once.
  **Why nothing of what a friend watches is shown** is said where one would look for it: when *Tell me what friends watch* is off for you, the page of friends has a
  row for it (a **Turn on** tile on the TV, a notice with a button to the settings on the phone; Back from those settings comes to the page of friends again) and a friend's page
  says *"To see what Sam is watching, turn on …"*; when it is on for you and the friend still shows nothing, their page says *"Sam isn't sharing what they watch"*
  (the server tells only whether a friend's activity is shown, not which of the two switches is off, so this is said once yours is on). What a friend is doing shows
  under their name when they share it: *Watching Alien* for 15 minutes after it was last seen, *Online* while their page is open.
  Things to know: *Friends can see my ratings* does nothing, and is not shown, while ratings themselves are switched off (they stay kept, and are seen by nobody).
  What friends send is made fit to show (no characters that turn text around or hide in it; a friend's picture is shown only if it is the address of some other
  web site, never a path, an address on this site or one that only a private network answers to, such as `localhost` or `192.168.x.x`), and an inbox holds the newest 100 things, at most 20 from one friend; the same title sent again while it is
  unread is not announced again. **Pictures are loaded by the browser of whoever looks, from wherever the sender says**, so the site that serves one can tell that
  somebody opened it, as with any picture on the web. **What you watch, when you tell it, includes the address of the video** (a link pasted on the phone is the
  address a friend would open): leave *Tell friends what I watch* off if you play links that carry a secret. The first profile of an account is named after
  its username, and a friend (or whoever is shown one of your codes) sees that name: with an empty or one-letter password, rename it. A TV left open from before a
  version that adds a setting needs a reload once (an older page does not know the new setting and cannot read the account's answer; newer pages leave such
  settings out instead).
  **Tags and requests.** Every profile has a **tag**, its name and a number (`Sam#2`: the lowest number that no other profile of that name has, whatever the capitals; it is kept
  when only the capitals of the name change). The Add a friend page shows yours (on the phone with a **Copy tag** button); typing somebody else's there and pressing **Find**
  shows who it is and a **Send request** button. Finding only **asks**: the other gets a line, a *Friend requests* row (a tile on the TV, whose window has **Accept** under the remote
  and **Decline**, and where Back leaves the request waiting) and a number on the badge, and nobody is a friend until they say yes, except that two who have asked each other are
  friends at once. A profile with friends off cannot be found by tag. A tag is looked up only when **Find** is pressed, so a half-typed one costs no wrong guess, and a
  wrong tag counts against the same limit as a wrong code (10 per 15 minutes for an account, 100 for an address). A request waits 30 days, a profile keeps the newest 30 it was sent,
  and 30 can be sent an hour. `GET /api/profiles/:id/friends/tags/:tag`, `POST …/friends/requests` (`{tag}`), `POST …/friends/requests/:from/accept`, `DELETE …/friends/requests/:from`.
  **The bell.** A profile with friends on has a small bell beside its picture, in the phone's header and in the corner of the TV's library (the first button of the corner for the remote:
  Up from the titles reaches it, Right goes on to the picture, and OK opens its list). A **number** on it is what waits for an answer from this profile, the same count the Profile
  line of the TV's menu carries (requests to be friends, invitations, requests to watch together, plans to answer, titles friends sent, and a plan whose time has come until its party starts); a **quiet dot** only says that a friend watched something since
  this device last opened the bell. The list shows up to 8 of what waits (requests first, then open invitations and plans whose time has come, requests to watch together and plans that ask, titles sent, and last the plans that are on or turned down and invitations that are over),
  with the buttons they have on the Friends page (on the TV a line does what the same tile of that page does, so a request opens its question, an invitation joins, a title opens its page),
  then up to 4 things friends watched lately, a line saying how many more wait on the Friends page, and an **Open Friends** button; Back from the Friends page it was opened from goes
  home, not to the account page it was never on. Opening the list is looking: it marks the inbox read and puts the dot out (when it was put out is kept per profile on each device, in
  `kino.bellSeen.<profile>`). The unread dot that the profile's picture used to carry moved to the bell. Nothing is added to the server for it: the bell reads the state that the Friends
  page already polls every 30 seconds.
  **Quiet while something plays.** A screen that is playing a film puts nothing over the picture for friends' news (requests, titles sent, what a friend watches) except an *invitation*, as a
  small note in the corner for 4.5 seconds (a screen with nothing playing shows the usual toast); all of it waits in the bell. A profile's switch *Show friends' news on screen*
  (`newsPopups`, on by default; on the phone's account page and on the TV's Friends page) turns even the note off, and the bell is never muted.
  **Chat.** Two friends can write to each other: a **Chat** button on the friend's page on the phone (a sheet over the page) and a **Chat** chip, last in the row of buttons of the friend's page,
  on the TV (a page of its own, with a **Write** button that opens the page where the message is typed with the keys of the page, as the note of a rating is; a hand-held screen types on its
  own keyboard instead, and Back goes back a page at a time). It is a first, small chat: plain text, one friend at a time, the newest message at the bottom.
  **Who can write:** only two current friends who both have friends on and *Friends can message me* on (a switch in the settings next to the others, and on the TV's page of what is shared;
  **on until it is turned off**). A friend whose switch is off is not written to (`403 chat_off`; the chat says *"Sam isn't taking messages"* and has no box), and a profile whose own switch is off
  is told in its chats that the friend can't answer. **What a message is:** at most 500 characters, trimmed, not empty, made fit to show like everything friends send (no characters that turn
  text around or hide in it), and shown as text only: a link cannot be pressed and nothing is previewed. A sender may send 20 messages a minute (`429 rate_limited`), a pair keeps the newest 200 and
  nothing older than 30 days, a message can be taken back by whoever wrote it (press it on the phone; *Take back last message* on the TV) and is then gone for both, and **ending a
  friendship deletes the chat** (so does deleting an account or a profile). A chat that has nothing left in it stays for a day as a revision and nothing else, so that a screen that has the chat open
  is told that the message it shows is gone. **How it arrives:** there is no push, no email and no socket. A chat that is open asks the server every 3 seconds with the revision it has (a chat that
  did not change is answered in a few bytes), and a page that is out of sight asks for nothing. A chat that is not open is told of quietly, by the refresh of friends that the page already makes (every
  30 seconds and when it comes to the front): *"2 new messages"* under the friend's name (phone) or on their tile (TV), a number on the **Chat** button and chip, a row in the bell (*"2 new messages
  from Sam"*, which opens the chat) and one count on the bell's number for each friend who wrote. The bell's few places go to what asks for an answer first (requests, invitations, plans);
  the rest of the messages are counted in the line that says how many more wait. **Never a popup, and nothing over a film.** A message counts as read when the chat is opened, and what a
  profile writes counts as having read everything before it. The count is a field of the friends answer (`chat`, there only when something waits); it is not in the inbox, so a page loaded before
  this version, which cannot read an inbox item of a kind it does not know, is not hurt by it (it only does not show chats until it is reloaded). **Mute** (on the chat) stops a friend's messages from
  being counted anywhere, without telling the friend; they are in the chat when it is opened. **Report** shows exactly what would be sent (the last 20 messages, with who wrote each) and sends
  nothing until *Send to the Kino team* is pressed; then it reaches the team as a feedback report (a problem, area friends, the messages in a file `chat.txt` with both names, not answerable: the
  friend is not told, and the team reads the part of a chat that somebody chose to send, never chats). **Messages are stored on the server as written, without encryption:** whoever runs the
  server can read them, so the settings line and the empty chat say *"don't send anything private"*. They are kept like friends and inboxes are (a document for each pair, `chat:…`, in the
  data folder or the database). Routes: `GET|POST /api/profiles/:id/friends/:fid/chat` (`?since=<rev>` on the GET), `DELETE …/chat/:n`, `PUT …/chat/mute`, `GET|POST …/chat/report`.
  **Not in this first chat:** groups, pictures, files, link previews, reactions, typing marks, read receipts, a chat in a party, push or email notifications, search, attachments.
- **Signed out, the device keeps the same things as a guest** (`localStorage`). Signing in **combines** them with the profile that is chosen:
  per item the newest copy wins, a removal is remembered for 45 days so another device cannot bring the item back, and nothing is counted
  twice. Whatever was watched while signed out is on the account afterwards.
- **Sync** runs when a profile is chosen, every 45 seconds, a few seconds after something changes, when the tab is shown again or the
  connection returns, and as the page closes. It sends only what changed since the last revision (`POST /api/profiles/:id/sync`), and a
  device that is offline keeps working and catches up.
- **Sign a TV in from the phone.** Typing a name and a password on a TV remote is a chore, so the TV's sign-in page shows a QR code and a short code
  (`ABCD-2345`). A phone that is already signed in opens it (the camera app, or Account → "Sign in another device" to scan or type the code), sees what is
  asking, and approves; the TV is signed in a moment later. The code works once and expires after five minutes (a TV that is still on the page
  asks for a second one; after ten minutes of nobody answering it stops asking, says the code ran out, and has a button for a new one), and nothing signs a TV in
  until a signed-in person says yes. A screen that is signed in itself can do the asking too (a computer with no phone at hand): its account
  page has **Sign in another device**: type the code the other screen shows, check who is asking, approve.
- The phone's account page: profiles, settings, devices (sign others out, and give a device a name of its own: "Living room"), password, delete account. The TV has its own: who's watching,
  **Manage profiles**, and the settings (language, colour, autoplay, what a tap on the picture does, ratings, friends). The subtitle languages, the devices, the password and deleting the
  account, and the box for pasting a link, are on the phone's page only.
- **Settings per profile:** website language, accent colour (the red can be any of several colours), whether the next episode follows by
  itself, whether a tap or click on the picture pauses it (below), whether titles can be rated, friends and what they may do, and the subtitle languages (below).
- **Feedback** is a button next to Settings (the phone's account page, the TV's profile page; a guest has it too, and a title that would not play has
  *Report this problem* on its card and on the phone's line that says so) that opens a form for **a problem**,
  **something to make better**, **a feature** or **anything else**: where in the app it is (a guess, and a list of 33 places), the words, a few questions that
  fit the kind, and **a picture of the screen** (captured by the page, or added, or a photo) that can be circled, arrowed, boxed, drawn on, written on or
  **covered where it is private**. What the page knows (device, last steps, errors, what was playing) goes along only as far as each switch is on, and
  the form shows the text. The team reads reports with a token, asks the sender when something is not clear and answers; the answer is in **Your
  messages** (no email: the report is kept by the browser under a key of its own, or by the account). Words are kept as a draft; Back goes a step back, then
  closes. How it is set up, read and judged, what is collected and left out, and what could not be tested: [docs/feedback.md](docs/feedback.md)
  (`src/client/feedback/`, `src/server/feedback/`, `scripts/feedback.mjs`, `e2e/feedback.spec.ts`)

**Phone**
- Pair by QR scan (camera) or by code; a QR link opened from the phone's camera app pairs by itself. A phone that already has a TV is asked
  what the other one is for: join the watch party, or control it instead (the first TV is not let go: it carries on as it was, on the phone's
  list, below). Nothing changes behind its back, except that scanning another TV's QR code moves a phone off a TV that is switched off
  (offline) at once, since there is nothing to ask about
- **My TVs.** A phone keeps the TVs it has connected to (up to eight, in the order it did): *My TVs* in the sheet that the TV's chip at the top opens, and on its first screen once
  it controls none. A tap on one controls it, **with no code**; the one it leaves is not touched: it keeps playing, stays paired and
  is still on the list, with a dot for whether it is on. **Forget** lets a TV go, after a question that names it (a TV with no phone left shows a new code, as after
  *Disconnect*, and stops what it was playing); the field below connects another TV with its code, scanned or typed (the list says when it is full), and the
  TV in use can be **named** there (shown on the list and on the other phones' lists; empty gives it its own name back). A phone only hears
  what the TV it controls is doing, and the menu's count of phones counts only those controlling that TV now. A TV's own **Disconnect**
  takes it off every phone's list, the ones that have moved on included. Authority comes only from a code, so "My TVs" never gives a
  phone a TV it did not connect to itself. The list is kept with the pairings (database or file), so it survives a restart
- A second phone joins the same TV with the QR code (and code) in the TV menu, scanned off the first phone's screen, or with the code and QR
  code the TV itself shows on its "Connected" page (**Connect a phone** in the TV's side menu): both are remotes, either can
  add TVs to the party, and the menu says how many are connected. The TV flashes "A phone is connected." when one joins. That code stays good
  while a phone keeps asking for it (opening the menu, or the TV's page being open); a phone that already has a TV and scans it is only offered
  to control that TV instead
- **The phone's shell** (`src/client/controller/shell/`, `docs/phone-layout/`). The TV is a **chip** at the top (its name, and how it is doing: connected, away, waking up); a tap on it opens a short sheet with
  the watch party, **My TVs**, the code for more phones, full screen on the phone and **Disconnect**. Four **places** are a bar at the foot: **Home**, **Search**, **My Lists** and **You** (the account). Each place is
  where its reader left it, a tap on the place you are in takes it to the top, and the phone's Back goes to Home from any of them (and from Home asks before leaving). While something plays it is a **line above
  the bar** on every place (the picture, the title, a play / pause button, a thin line of how far it is), and a tap on it opens the full remote. Held sideways, or on a tablet, the bar is a rail down the left and a
  sheet is a side sheet. Everything is read at 14 px or more (12 px for the four words of the bar), everything pressed is 44 px or more, and a sheet covers at most 70% of the height (78% of a short screen)
- **Home** is what to watch: the box for pasting a link (when it is on), what friends asked, **Continue watching** and the library's rows as upright posters, each row's heading ending in **See all**, a page of its
  own with the whole row as a grid that goes on as it is scrolled. A tap on a title in the library, a list or the search opens **its own page**, as the TV has one (the whole screen, a round way back over its picture): its
  picture, a full-width **Play** (or **Resume**; for a show, the episode this profile is at), the list to keep it in, a rating, what it is about and, for a show, its seasons and episodes (a tap on one plays it).
  **Continue watching** is a row of big cards that snap one at a time with the next one showing at the edge: a tap picks one up where it stopped, the **+** on it puts the title in a list and the **×** takes it off the
  row. (One card per show and per profile. A guest's cards stay on the screen they were made on; signed in on both, the phone and the TV show the same ones.) **Search** lists what it finds one under another, and is still
  there (the words, the filter, the list, the place in it) after something is played and stopped; before anything is typed it lists what is popular
- **The box for pasting a link is off** on a new phone, since most of what is played comes from the library. A switch in **Settings → Paste a link** brings it back (kept on that phone); it is there whatever the
  switch says while the library has nothing to show, as the only way to start anything.
  Opening the phone page as `/?url=<link>` plays that link once connected (the hook for a share button)
- **Lists on the phone.** The round **+** on a title saves it in Favourites (and takes it out again), and so does holding the title (a line at
  the bottom says "Added to Favourites", the + being a corner away from the finger); once there
  is a second list it asks which lists the title is in, with **New list** there too. Each list with something in it is a row of **My Lists**,
  and **Manage lists** (at the top of that place) makes, renames, **reorders** (move up / down on the phone, left / right on the TV; the
  rows follow the order) and deletes them. The first list can be renamed and emptied, never deleted.
- **Add it to the home screen** and the page opens as an app with no browser bar (`public/manifest.webmanifest`; on an iPhone that is the only
  way to lose the bar, since its browsers have no full screen for pages): Share → *Add to Home Screen* there, the browser's menu → *Install app*
  or *Add to Home screen* on Android
- Remote: play/pause, ±10 s, seek bar, audio/subtitle/speed/quality/source sheets, previous and next episode, episode list,
  subtitle style, full screen, stop, disconnect (volume is the TV's own). It confirms what the TV did ("Speed 1.5×") in a line at the bottom. **Change video** steps the remote aside to the places (the film plays on, as the line above the bar)

**TV**
- Clean player with a fading HUD (title, and for an episode its numbers and **its name** when the library or the source has one besides the number,
  clock, "ends at", seek bar with a time tooltip on hover, buffering spinner, a big play/pause button in the middle). Paused, the
  title steps out of the corner and is said once, large, on the left ("You're watching …", the episode's name under it); a skip flashes on the side it went towards; and
  the Up Next card comes with 15 seconds left of an episode of more than 30 seconds. It counts down only for a profile that plays the next
  episode by itself, the count waits while the picture is held, and winding back takes the card away
- **The picture under a hand or a mouse** (`src/client/tv/gestures.ts`). **A tap or a click on the picture only shows or hides the controls**; it does
  not pause. What pauses is the bar's button, the big one in the middle (about a seventh of the screen's width, shown while paused, and for a finger while
  the picture plays), and OK on a remote, which is a key and is not changed by any of this. A remote that points (an LG Magic Remote) clicks like a mouse,
  so the profile has a switch, **Tap or click the picture to pause and play** (Settings, phone and TV; off to begin with), that gives the old behaviour
  back: then a click pauses and plays, and a finger on controls that are away only brings them up. For a finger, besides: **double-tap the left or right
  side** of the picture (the left and the right two fifths of it) to skip 10 s back or forward, with no controls brought up and "+10s" flashed on that
  side; each further tap on the same side within 0.8 s skips again, and the flashes add up ("+30s"); **double-tap the middle**, or double-click with a
  mouse, for full screen; and **hold a finger on the picture**
  for 2× speed for as long as it is held (a pill at the top says so, with the corner title stepping aside for it; nobody is told it is a change of speed, and the
  speed goes back to what was chosen). A screen that leads a watch party with guests in it does not do the hold: its guests are told the speed that was chosen, and would fall behind
- D-pad remote support: ←/→ seek 10 s, ↓ wakes the controls (even faded) and lands on Play, Enter presses. Among the controls the arrows walk
  the rows as they are laid out and stop at the ends; the bar waits a little longer while the remote rests on a button. Back closes a menu and
  hands the focus back to the button that opened it (the subtitle style is a page of the audio and subtitles menu, so Back goes one page back).
  Every screen before the video (the library, a title's page, the pairing code, the connected screen, the account pages, the "Press OK" page of a
  party link) is walked with the arrow keys: the first press only lands on a button, so a stray OK never presses one, and a page of columns keeps
  Up and Down to the column the remote is in (`src/client/tv/dpad.ts`). **Back goes one step out of every one of them**, to the page it was opened from: out of
  a window on a window, out of the question inside an editor before a list or a profile is removed (that says no first, and leaves the page the next time), out of
  a sign-in that was opened from the settings and back to the settings, out of the code that is still on its way. A screen that watches a party along has nowhere to
  go back to, so Back lands on its **Leave** button and leaving stays a press of OK. The Close and Back buttons stay for those with a mouse
  (`e2e/remote-back.spec.ts` opens each of them and presses Back)
- **A phone's or a tablet's own Back** (the button, the swipe from the edge) goes back one page everywhere instead of leaving the site: out of a film to
  the library (or a show's page), out of a title's page and the pages of the profile, out of a sheet; the phone as a remote puts the remote away to the
  library, with a line that brings it back, and the film plays on. At the library the first Back asks (**Press Back again to leave**, a line that runs
  down 2.5 s) and a second one leaves; a Back that would stop a party for others asks first. Desktops and TVs keep Back as a key
  (`src/client/shared/backButton.ts`, `docs/android-back.md`, `e2e/android-back.spec.ts`)
- The controls are one line on any screen, in any language, with every button present (series, subtitles, sources, quality, party). The row
  measures itself (`src/client/tv/fit.ts`) and gives up only as much as it must, in this order: the room between the buttons, the labels of Watch
  party and Audio & subtitles, the episode names under Previous / Next, the labels of Previous / Next, the label of Episodes (each label becomes its
  icon, still named for screen readers and in its tooltip), then the size of the buttons. Only a phone held upright is too narrow for that, and its
  controls are two rows of buttons a thumb hits
- **Quality follows the connection** (`src/client/tv/engine.ts`; the profile's switch **Match the picture quality to the connection**, in Settings on the
  phone and on the TV, on unless turned off). A film starts with its first piece in the lowest quality, which arrives at once whatever the link (a piece
  is as long as the film's pieces are, 2 to 10 seconds), and hls.js then asks for each next piece in the best quality that the link carries, as it
  measures it: lower when the link cannot keep up (a weak or unsteady one, a phone on mobile data), higher again when it can. A change applies to the
  pieces still to come, after what is downloaded already, with no stop. The quality button says what the player has chosen ("Auto · 720p") and lists
  the film's qualities; one picked there stays, and applies from the next piece (what was downloaded beyond it is replaced, or a pick could take
  minutes to show). **A guest of a party has the button too:** its picture is its own download, so it can take a lower quality without anyone else's
  changing. Off, every film is in the highest quality there is, as before (a change of the switch applies from the next film). What it does not do:
  look at the machine, so a screen that cannot decode the quality its link carries is not stepped down
- Subtitles and audio like a streaming app: the language you chose is remembered. Tracks the file labels only with a code (`eng`) are
  named by their language. Subtitles are drawn by the page, so size, font, colour, opacity, background, edge, height and word spacing
  all work on any TV browser; change them from the TV's menu or the phone, with a live preview. A browser only lets a page go full screen
  (and play with sound) after a press on that page, so a screen goes full screen at its first key press or click, once, and is left alone after
  that. Leaving it (Esc, `F`, or the round button in the library's corner, beside the account button, which the arrow keys reach too) is
  remembered in that browser, so the next visit stays as it was; going in again with the button makes it open full screen once more
  (`src/client/shared/fullscreen.ts`). Safari is left out of the automatic part, as it takes no typed letters in a full-screen page. **A touch screen that
  goes full screen with a video on is turned sideways** (Android's Chrome; the page asks the browser to hold the landscape orientation) **and let go of
  when it stops** (full screen left, the video stopped, the film ended and its end card is up; Watch again turns it once more), so it turns back upright
  by itself; an iPhone, which has no full screen for pages and does not
  hold an orientation, and a computer are left alone. The phone's
  remote doesn't do it by itself (it is where codes get typed) but has the same button on its first screen and in its menu (*Full screen on this
  phone*). The phone's button for the TV's full screen works while the TV has had a press lately: the TV asks
  for an OK press when it hasn't. If the browser still refuses to start a video, a **Tap / press OK to play** button says so instead of a blank screen
- **TV browsers with a player of their own** (Hisense's *Hi Browser* on VIDAA is the one this was written for). A page cannot switch off what a
  TV's firmware does with a video, but it can avoid asking for it, so the page: never asks a Hisense browser for full screen (not at the
  first press, not by `F`, not from the phone, and the controls have no button for it), because that is what hands the picture to the
  firmware's player; keeps the `<video>` inline and without controls (`playsinline` and the vendor spellings of it, `controlslist`,
  no picture-in-picture, no remote playback, the native control layers hidden in CSS, any `controls` that something adds taken off at
  once, and a video that still goes full screen on its own is put back: `src/client/tv/nativePlayer.ts`); presses OK itself when a remote
  sends it as a key down and up with no typed Enter, which Chromium needs before a focused button counts it (`src/client/tv/okPress.ts`);
  and knows the vendors' extra remote keys (play, pause, stop, rewind, forward, back). **To find out what a TV browser does**, open
  `/tv?debug=1` on it: a small panel in the corner says what the browser is and what it can do, whether the TV's id was kept since the
  browser was closed (the last four characters, in storage and in the cookie), where the server keeps things and how long it has been up (a
  short time with `file` or `memory` is why a TV "lost its phone"), how many pieces of films the server gave from memory and how many it
  had to fetch, on a screen that watches a party along how its picture keeps with the host's (reports, jumps, speed changes, how far
  apart the two are now, and how far on it aims its jumps: what this screen has been found to take to land one), and, live, each key it
  sends and where the focus went, the clicks, the video's state and the page's errors.
  `?debug=0` turns it off. `?fullscreen=off` keeps any browser from being asked for full
  screen (`?fullscreen=on` undoes it); both are kept for the next visits
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
- Sources: a video can carry alternates; if the first stream fails the TV tries the next by itself, and either device can pick one. When none of
  them plays, a card takes the place of the controls: what it was and what went wrong, **Try again** (OK, from the first source) and **Back to
  the library** (Back)
- **A TV stays as it was left.** Quitting the browser, a power cut or a restart of the server does not unpair anything: a phone and its TV
  stay together until one of them lets go (*Disconnect*, on either), and nothing else does it. A TV that has a phone (or is in a party) and
  was in the middle of a video is put back on it when its page is opened again: the video is looked up again from the link it came
  from (the stream's own address may have expired), and it comes up **paused** at the place it had reached, so a press on the phone's play
  button, or on OK, carries on. That is kept for 30 days and needs a link that plays the video again (the library and a pasted link have
  one). It is not done after Stop, Back to the library or the end of the film, nor for a TV on its own (its own *Continue watching* has the
  place). The place is written down every 30 seconds it moves, and exactly when the TV goes away
- **The library is the front door.** The site opens straight into it, signed in or not (a guest's progress stays on that screen), so a screen can
  pick a film with no phone at all. A short welcome fades over it while it fills in, and takes no press, unless the first press would take the screen
  full screen (a browser that has a full screen to give, and was not left that way last time): then the welcome waits with a **Start watching**
  button, which is that press (any other key or click is too, and the page asks the browser for full screen once for it; Back lets the welcome go
  without it). (Only a party link opens a "Press OK" page first, because that screen joins the moment it is pressed.) **Connect a phone** is one entry of its menu; once a phone is connected that page
  says so, with **Back to the library** and **Disconnect from phone** (unpairs the TV from every phone and shows a new code; the phone
  controlling it goes back to the code screen, one that had moved on to another TV just loses it from its list)
- **Sign in** is the button in the library's top corner (the profile picture once signed in); nobody is made to
- **Any device can be this screen.** The same page lays itself out for the size of the device: the TV's wide layout from about 900 px
  up, and below that (a tablet, a phone held sideways, a narrow window) a compact one with a thin menu, a smaller banner, titles that swipe along, a native
  search field (the phone's own keyboard) and as many columns as fit. **A phone held upright** (under 600 px wide and at least 480 tall) has a layout of its own (`src/client/polish/tv-phone.css`, `docs/phone-layout/`): the menu is a bar of four places at the foot (Home, Search, Categories, My lists; the watch party and *Use this phone as the remote* are buttons of the profile's page), Movies / Series / Cartoons / Anime are buttons over the titles, titles are upright posters, a title's page is its picture, a full-width **Play** and its buttons in a row, the player's controls are rows of buttons a thumb hits, and its menus are sheets that leave the picture in view. Taps press everything, swipes scroll, a tap on the picture brings the controls
  up and the next puts them away (two taps on a side skip, a held finger plays at 2×: see above), and every page has a way out for a finger. A phone held sideways gives the banner less height. Volume stays the device's own
- Keeps the screen awake while playing; reconnects by itself, and notices a dead connection within about 25 s. After 10 s without the server
  the page says why that can be (*The server is waking up. A free server can take up to a minute…*): on the TV in its banner, on the phone's
  first screen in place of "Reaching the server…", and on the remote under the header. It is not said when the browser knows there is no
  network at all, which has its own line

**Server**
- Resolves a link to a playable stream: the generic resolver plus the site adapters in `src/server/resolvers/adapters/`
- The media proxy (`/api/proxy`, which the adapters' streams go through so that a site's referer and CORS rules do not stop the player) only
  connects to public addresses. The address is checked where a connection is made, not in the text of the link, so `localhost`, or a name
  anyone can point at a machine on the server's own network, is refused (403) like a number; every redirect is checked the same way.
  The pieces of a film that the screens of a party ask for a few seconds apart are fetched from the site once and handed to each of them
  (`src/server/segmentCache.ts`: only whole answers that say how long they are, at most 64 MB kept for 3 minutes), so five screens do not
  look like five viewers to the site; what the server sends on to the screens is still one copy each
- Pairing codes are single-use and expire after 10 minutes. The code is only six digits, so wrong ones are counted: after 20 in a minute
  from one address pairing pauses for that address until the minute is over, and after 100 in a minute from all addresses together it pauses
  for everybody (one visitor cannot stop the others, and guessing from many addresses at once is still slow)
- A connection may send a burst of 100 messages and then 30 a second (a TV reports about once a second, a phone sends a message per tap).
  Past the burst messages are dropped unread; one that goes on past twice the burst is closed (1008) and its page connects again
- **Accounts, pairings and what each TV was playing are kept**: written to disk (or Postgres) a moment after every change and again when the
  server is told to stop. A restart (or a free host sleeping and waking) leaves every phone and TV paired as it was (a phone's list of TVs
  included), and a TV whose page is
  opened again is put back on its video (above); the TV's and the phone's own ids are also kept in a cookie next to the page's storage, so a
  browser that wipes one of the two when it closes still finds its way back. The server never lets a pair go by itself; one that nobody has
  used for more than a year (400 days) is cleared out when it starts, so the database does not fill with ghosts. The codes on screen are in
  memory only: a TV shows a new code after a restart. A server that was restarted while a TV played is told by the TV what it has on, as
  soon as the TV reconnects

### Languages

The language can be switched on the phone's connect screen and in Settings (phone and TV); a profile remembers its choice, a device remembers
the last one, and a first visit follows the browser. `src/client/i18n/` holds one dictionary per language: `en.ts` is the list of keys and `ro.ts` and `it.ts` must have every one
(the compiler and `i18n.test.ts` check, including the `{placeholders}` and the plural forms Romanian needs). Everything a person reads goes through
`t("some.key")`; what the player and the server say in English (an error code, "Subtitle 3") is put into words by `src/client/shared/words.ts`.
Titles and descriptions come from the library source and are not translated, but the names of its rows are: the places name them in English
("Trending Movies"), so `rowTitle` (`src/client/i18n/index.ts`) says the ones this app lists itself (Filmpire's categories, the Internet Archive's
collections) with a `category.*` word per row id, and any other row keeps the name its place gave it (`i18n.test.ts` fails when a source gains a row with no
name in every language). Adding a language is a new dictionary and a line in `UI_LANGUAGES`.

### One page, two roles

Every device opens the same address. A screen without touch (a TV, a monitor) or a TV browser (Fire TV, Tizen, webOS, Android TV)
becomes the player; a phone or tablet starts as the remote, and can be the player too. `/tv` is always the player, `/?role=remote` or
`/?role=tv` asks for one screen without remembering it, the `/?code=` and `/?url=` links made for the phone always open the remote, and a
`/?party=` link always opens a screen. A device that was guessed wrong has a way over: **Watch on this device** on the phone's connect page,
the TV menu of a connected phone, and a quiet "Use this screen as a remote" link on the TV's own pages; the choice is remembered on that
device. In the library's menu a **phone** (a touch screen under 600 px, not a TV browser) has **Use as a remote** where other screens have
**Connect a phone**: it is for controlling a TV, so the entry goes to the remote's page instead of showing a code for another phone. A tablet
keeps **Connect a phone**, since it can be somebody's screen. The rules are in `src/client/role.ts`. Each role is a chunk of its own (`src/client/main.tsx`), so a phone downloads the remote and a
TV the player, and the video library (hls.js) and the QR scanner load only when they are needed.

### Watch party

One TV plays and up to five more screens watch along, in step. A guest is anybody: a TV, a computer, or a phone that opened the link
(a phone that opens a party link is a screen of the party, not a remote). It works signed in or not; a screen is listed by the profile that
is watching on it, or else by its own name ("TV 3F2A"). Ways in:

- **From a TV:** menu → **Watch party** → *Start a party* (or the **Watch party** button in a film's controls, whose panel rests on **Done**, not
  on the button that ends the party). The screen shows a
  6-digit code, a QR code and the address, and the invitation as a **link with a Copy link button beside it** (a click, or OK from the remote: it says *Link copied*),
  to paste into somebody's chat; on another screen choose **Watch party → Join a party** and type the code with the remote's
  number keys (the on-screen pad works too). With friends on, the party's page and the panel over a film both have **Invite friends**, which tells
  the friends chosen (a friend who is the only one is chosen already; Back from the list of friends goes back to the party). A party that has ended
  before a friend answers is not a dead end: the invitation turns into *Ask to watch together* (see Friends).
- **From the phone that controls the TV:** its menu → **Watch party** shows the same code and QR code with the link and a **Copy link** button (and a **Share link** button where the browser can share), and
  lists who is in (the host's phone can send any guest away, or end the party). Typing the pairing code that another TV shows into the phone
  still works; a party's own code typed there is told apart from a wrong one (`ADD_PARTY_CODE`: the phone is told what the code is for, and it
  does not count against the limit).
- **From a phone with no TV:** the code of a party typed where a TV's code goes (the phone's first screen) is recognised, and the phone opens
  the party as a screen (`/?party=<code>`), the same as the link does. The server answers such a code with `PARTY_CODE`; other wrong
  codes are still "Invalid or expired code" and count against the pairing limit.
- **From a link:** `/?party=<code>` opened on any device shows a "Press OK or tap to start" page and joins on that press (the press is also
  what lets the browser play with sound, and it takes the page full screen like any first press).

The code lasts ten minutes (renewed while it is on screen), admits screens until the party is full, and wrong codes count against the same
limit as pairing. A TV with a phone connected can host a party but not join one. Everybody in a party can see who else is in it; the host (on the TV,
or on its phone) can remove a guest or end the party, and a guest can leave from its own bar.

**What the host decides:** what plays, a guest that joins mid-film starts at the host's place, pause, skipping, speed and stop. The host
reports its position and the server relays it, saying how old it is by then (half of the host's round trip to the server plus half of the
guest's: every screen times the answers to its keepalive PINGs and sends the shortest of the last few along, and the server puts the sum
on the `TV_SYNC` as `lag`), so each guest aims at where the host is now, not where it was; guests used to sit behind it by about that
much. A guest does not take the last report at its word (a report held up on the way makes the host look behind, by a different amount each
time on a mobile network): it reads the host's place from the reports of the last twelve seconds, going by the least delayed of them, and
a report that is well behind the rest counts only when a second one, a little later, says the same (the host went back in the film). The
first report of a host that was told to play again is used for the place to start from and left out of that reading: the host's picture takes a
moment to start moving, so that report is ahead of the host's clock by that moment, and kept for twelve seconds it would have every guest play
ahead of the host and then slow down when it was forgotten.
From that place a guest nudges its speed by 6% when it is more than a quarter of a second off (and goes on until it is within 0.08 s, instead of
starting and stopping with every report), jumps ahead when it is a second or more behind, goes back in time only when the reports agree on it
(or when it is 8 s ahead, which no late report explains), shows the host's frame when paused (within 0.1 s; a host that only waits for data
is waited for where the guest is, unless that is 2 s away), and jumps to the host's place at once when the host starts again, if it has that
place (`src/client/tv/sync.ts`). A jump takes a moment to land (a few hundredths of a second on a computer, more on a TV, most when it starts a
picture that was paused) and the host plays on meanwhile, so a guest sent to where the host is would land behind it by that moment, and
stay there (inside what is not worth a nudge nothing puts it right). So a guest looks at how far from the host each kind of jump left it, once
its picture plays and the reads of the host agree, and aims the next jump of that kind further on by 60% of what it missed by (never by more than
0.25 s; it starts from what a desktop browser was measured to take, 0.07 s for a picture that was playing and 0.1 s for one that was paused).
A guest that is still waiting for data does not chase the host: it does not speed up on a thin buffer,
and it jumps only to a place it has already downloaded (after 15 s behind, anywhere), so a slow screen is not sent back and forth. The
waiting wheel does not show for a wait shorter than 0.4 s, so the jumps of a guest do not flash it. The screens of a party also download
only about 40 seconds ahead of their picture (see *What a watch party costs the server*). **What stays each screen's own:** subtitles (language, delay, style) and the audio track,
from the guest's *Audio & subtitles* button; the picture's quality, from the guest's quality button (see *Quality follows the connection*); volume is the device's own.

**Admins:** next to each guest's name the host (on the TV, or on its phone) has a **Make admin** button, which turns into **Remove admin**. An
admin guest gets a bar of its own under the guest's bar (jump back 10 seconds, play / pause, jump forward 10, the next episode where there is
one, stop) and the same keys on the remote (OK / Space, the arrows, `N`, `S`), and **Down** lands on Play. What it asks is done by the host's
screen, so every guest follows it as they follow the host, and **Stop** is for everyone, the admin's own screen included. Speed, the
episode and source pickers, and who is in stay the host's: the server only takes `PLAY`, `PAUSE`, `SEEK`, `SKIP`, `STOP` and `NEXT_EPISODE` from an
admin (`TV_PARTY_CMD`), and nothing at all while the host's screen is not there. Everyone in the party sees who is an admin. A guest stops being
one when it leaves, is sent away or the party ends, and is not one when it joins again.

**Adding someone from a party:** a screen that is signed in as a profile with friends on is listed with that profile, and everybody in the party whose
own profile has friends on gets a short **Add** button beside it (**Requested** while the request waits for a yes; nothing for yourself, a friend already, or a screen nobody is
signed in on). It sends the same request as typing a tag does (see Friends). The profile shown is the server's word, not the screen's: a signed-in screen asks for a single-use
proof of who it is (`POST /api/profiles/:id/screen`, good for two minutes) and sends it with `TV_PROFILE`, so a screen cannot pass for somebody else, and a profile that has
friends off is not shown at all.

**What a guest sees** is the picture's controls any screen has, not a lesser set: the title and the episode's name, *Watching along with Sam*
(and *Catching up* while the guest's picture is being brought to the host's), the time of day and when the film ends, the bar with the time
played and left (a bar to look at, not to click, unless the guest is an admin), and, while the film is held, whose doing that is on the card in
the middle: *Paused by Sam*, *Paused by you* (an admin's own), *Waiting for Sam* when the host's picture only ran out of data, or *Finished* when the film has played to its end. When somebody sets it
going again a line says *Sam resumed*. A tap on the picture (a phone held either way) shows the controls and the next tap puts them away. Who
held the film travels with the host's reports (`TV_SYNC.by`, `TV_SYNC.waiting`, `TV_SYNC.ended`); a pause that came from the host's own remote or phone is named after the host.

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
The phone's search answers from every title the phone has met at once and, from the second letter, adds what the library knows; when the library
cannot be asked it says so (keeping what the page had) and asks again every few seconds. A play that fails is said in a line at the bottom as
well as in the page's own status, which can be far above a library that is scrolled down.

- **The library goes on as it is scrolled** (`src/client/shared/feed.ts`, one store that the TV and the phone read; what was scrolled to is still there when a film is
  closed). The first rows are the source's own categories. When a page is scrolled near its end the next rows are asked for (`GET /api/library/rows?cursor=&kind=`, five at a time,
  at most sixty, none that shows nothing new), and a row that is scrolled sideways near its end brings its next twenty (`GET /api/library/more?row=&page=`) up to a hundred titles;
  a category's page goes on to three hundred. A page asks again after each answer while its end is still near (so a page that does not fill the screen fills it),
  shows empty tiles where the next ones will be, and says so when they could not be had, asking again after four seconds, then eight, up to half a minute. Whatever scrolls
  is enough: the remote, a wheel, a finger. A title is on a page once.
  **The rows come from small tables** (`src/server/library/shelves.ts`, a hundred further TMDB queries: nothing in them is a title, a person or a franchise):
  decades by the number of votes and by score, the classics and the best of every genre, hidden gems, cult classics, anime, miniseries, and the cinema of other countries.
  A window of dates sorted by the number of votes is what finds the titles that are old and not popular now, but were. The server remembers every title it has met in an
  index for the search, 30,000 at most, and nothing here asks the video provider about a title (titles that never play are still learned from failed plays and hidden).
  **Because you watched …** and **Because you loved …** are up to three rows of titles like the ones this profile watched last or gave 8 or more
  (`GET /api/library/similar`), none of them started or saved, at the top of Home on the TV and of the phone's library (one that has both a watched and a loved
  title in it is "loved"); the library knows which titles are alike, not what is liked, so there is nothing else to be a model of.
  TMDB's free licence asks for a notice, and the phone's credit line carries it where the titles are TMDB's.

- The default library source is Filmpire (`src/server/library/filmpire.ts`), presenting live categories (Trending Movies & Series, Popular Movies & Series, Top Rated, Animation & Anime, Action & Sci-Fi) and TMDB multi-search. Each title resolves directly to `https://filmpire.sc/watch/:id` (or `?s=1&e=1` for TV shows) which the built-in Filmpire resolver decrypts and plays automatically.
- An alternative source is the Internet Archive's film collections (`src/server/library/internet-archive.ts`).
- A new source is a `LibrarySource` (`id`, `name`, `load()` returning rows of `{ id, title, url, image?, year?, description? }`), passed to
  `buildApp({ librarySources })` from `src/server/index.ts`. Nothing here is specific to one site.
- **On the TV the library is the home page** (`B` returns to it from the connect and party pages): a compact banner for the title the remote is on
  (picture, year, a short description when the source has one, and Play / Resume / the list, named as it is) with rows of titles under it, the banner shrinking
  to a line once the remote moves down to the rows. The rows are **Continue watching**, **Because you watched …** (titles like the last one
  watched, from the source), a row for each of the **lists** with a title in it, then the library's own: the first ranked with big numbers (a "Top 10"), the others rows of pictures,
  and a row of **categories** after the third. Arrows walk the rows, Back leaves. **Choosing a title opens its page** (a big picture, the year,
  what it is about) with **Play** (or **Resume** / **Continue**) and **Add to Favourites** / **Remove from Favourites** (with several lists, **Add to a list**
  opens the lists, one button each, ticked for those the title is in); Back, the **Close** button (Up from the buttons, or Right past the last one)
  or a click beside it closes the page. **A show's page continues below its buttons** with its seasons (when there are several) and the episodes
  of the one that is shown, as cards with a picture, a line about the episode, its length and what this profile has done with it (watched, or
  how long is left, with a bar). **Play** says which episode it starts, *Play S1:E1*, or *Resume S2:E3* for a show part way through, and the
  page opens on that season with the remote on that episode; OK on any episode plays it, from where it was left if it was begun. With a mouse it is a click on the title (its name is the tooltip), on any row; **hovering a title
  shows a round button in its top corner** (a screen with a mouse only, not a touch screen): **+** puts the title in the profile's first list at once (once it is there the button turns into a filled **×**, and a click on that
  takes it out), and **×** on a title of **Continue watching**, or in a list's own row or page, takes it out of that, so a row of films can be filled or emptied by clicking down it;
  the second click of a double click goes through the page to the title under it instead of closing the page or pressing Play, for the half second
  the page takes to arrive. **A screen that can only move and click a mouse (an air mouse, a TV's pointer mode) scrolls by resting the pointer against the
  bottom or the top edge of the screen for a second** (`src/client/tv/edgeScroll.ts`, `EdgeScrollHint.tsx`): a ring fills beside the pointer, then the page goes, gently
  and then faster the longer it goes on; a key, a press, a finger or leaving the edge ends it (the pointer has to leave and come back before it counts
  again), and a wheel turned once ends it for good, since a screen that has one has no use for it. It is only a mouse, only a page that has somewhere to go that way,
  and not while a film is on the screen, over the menu or with a button held, so a remote, a wheel or a phone never meets it. The banner's own buttons play or save the title it shows, without the page. The big banner picture fades in
  over the previous one once it has loaded, instead of switching. Playing from the library and pressing Back (twice if the controls were
  hidden) or letting it stop comes back to the same title. A title that will not play is said so. A TV that watches
  along has no library, since it can't choose what plays.
- **Titles that do not play stop being offered.** A place lists far more than it can play, and only a try tells which. The server hears how every
  try at playing went (`library.played(link, outcome)`, from the WebSocket path only, not from `GET /api/resolve`, which anyone may ask): a place that
  says it has no video of a title takes it off the lists at once; a video that could not be reached just now is one strike, and a second strike
  from a separate try (two minutes or more after the first: a burst of failures at once is one) takes it off, and a title that plays is back
  for good. Left out means out of the rows and of "titles like this" for six hours (the library's own lifetime), then it is tried again; a title
  that a place said has no video is also out of the search, while one that only failed twice still turns up there (typing its name is asking
  for it). The memory is the server's, shared by everyone, and lost when it restarts. A screen
  that sees a try fail (the TV's notice, the phone's status line) asks for the lists again past the browser's memory, and a search is asked
  again with them, so the title is gone from what is on screen. Only the title's own link counts: a show whose first episode (what its tile plays)
  is missing is left out as a whole, one whose later episode is missing is not. Nothing here asks a place about a title ahead of time; the
  one thing known without trying is that a title with a release date in the future is not out yet, so it is never listed.
- **Menu, pages, categories, search (TV).** Pressing Left from the first title of any row (or the first tile of a grid) opens a menu down the
  left, nine lines: **Search**, **Home**, **Movies**, **Series**, **Categories**, **My Lists**, and, set apart, **Watch party**, **Connect a phone** and
  **Profile**. What belongs to whoever is watching is behind that last line, not in lines of its own: **Profile** is a page of one row of places, each
  saying how it stands: **My ratings** ("12 ratings · average 7.4"), **Friends** (a profile that is signed in and has friends on: "3 friends", "2 unread"),
  **History**, **Sign in** (for a guest) and **Settings**; Back from any of them returns to it with the remote on the place it left (found again by what it is: Friends coming or going moves the others; if the place the remote is on goes, it stands where that was), the banner above says how the place under the remote stands now, and its line in the menu carries the number of unread things
  from friends. **Categories** is one page of all of them, films first, then shows, each saying which it is and how many titles it has; a category opens as a
  grid, and Back returns to the list. Right or Back returns to the titles (with a
  mouse, **resting the pointer on the strip opens the menu**, no button held, and leaving it shuts it), and
  choosing any entry (**My Lists**, **Profile**, a category…) closes the menu over the page it opens. **My Lists** is a button for each list over
  the titles in it, with **New list** (a name typed on the on-screen or real keyboard) and **Edit list** (rename, or delete after a question). **Movies**
  and **Series** are home pages of only that kind (a library whose titles do not say which they are, as the Internet Archive's do not, says "No movies here" or "No series here" and leads Home, instead of "Nothing in the library yet"); a category opens as a grid of its titles. **Search** shows an on-screen keyboard (Space, Delete, and Clear for the whole box) beside the
  results (a physical keyboard types too, and Backspace deletes before it means Back) with **All / Movies / Series** filters. Titles already loaded
  answer at once; after a short pause the source's search (`GET /api/library/search?q=`) adds more, and a library whose rows could not be loaded
  can still be searched. **A search forgives the fingers** (`src/shared/search.ts`, on [MiniSearch](https://github.com/lucaong/MiniSearch)): every word of the
  search has to be in the title, but a word may be unfinished (`strang thi`), a letter off (`strager things`), have two letters swapped (`thigns`, and
  `teh office`: a word of three letters too, when another word of the search is longer), a title may
  be typed as one word (`spiderman`), without its accents or apostrophes, with its year (`dune 2021`; a number is not forgiven), or by a short name that starts the search
  (`lotr`, `got`, `hp`). **When a title has only some of the words** (a word that is no part of its name, as in `harry potter movie`, or one slip too many) it is one of
  the **closest matches**: listed after the titles that have every word, under a heading of their own, and alone under a line that says nothing matches exactly. A word of the search that
  says nothing about a title ("movie", "full", "watch") is left out of what the places are asked. Every title the TV or the phone has met (rows, pages, answers, titles like another)
  is matched this way, not only the ones on screen; on the server the same ranking is applied to what the
  places answer, and when a place finds little (TMDB's search forgives nothing: "strager things" finds nothing there) it is asked again without each
  word (a slip in one leaves the rest to find the title: `better call sual`), and with a long word cut to its first letters or all but its last two
  (`gladiater`), six questions at most, and the titles that come back are kept only if they match what was typed. **A search lists the likeliest first** (`rankByQuery`):
  the title that is what was typed, then those that begin with it (`boon` is *Boon* and *The Boondocks* before *Baboon*; a leading The, punctuation and accents do not count), then those with a word that begins
  with it, then the rest, the order the places gave (the popular first) kept within each, whether a title came from the screen or from the library. TMDB is read up to three pages (sixty titles) when it has
  that many, so a short word brings a long list to scroll; only the first page is asked about at the video provider, and a title it already said has nothing to play stays out of the others. A search that cannot be reached says so (it asks again every few seconds) instead of saying nothing matches, and a title
  that is part way through says **Resume** on its page wherever it is shown, lists and search included. The menu and search only use the generic
  library endpoints, so they work with whichever `LibrarySource` is configured.
- `LIBRARY=off` starts the server without a library (the e2e server does); `GET /api/library` is then empty and the phone shows nothing extra.

### Episode lists

The episode list shows what the resolver puts in `series.episodes` (`{ season, episode, title?, url }`, where `url`
is the episode's page link). A resolver that doesn't fill it gets no list; "next episode" is derived from it when
`series.next` isn't set. The server log's `resolve` line says `episodes: N` for a series, so `0` means the resolver
supplied none. A show's page on the TV asks the library for the seasons that can be watched (`GET /api/library/seasons?url=`, empty when it
can't tell, and then not remembered) and for the episodes of one (`GET /api/library/episodes?url=&season=`, aired ones only, each with the link
that plays it). When the library source knows more (a picture, a line about the episode, its length: `GET /api/library/episodes`),
the TV lists each episode streaming-app style: season picker on the left, a picture with a progress bar, the name, the length and a
description for each, with watched marks. The phone's list is the same as cards, in one column. An episode the source gave no name is
called "Episode 3" in the language of the screen.

### Sources

`NormalizedMedia.alternates` is an optional list of `{ label?, stream, subtitles? }`: other streams of the same video, in the
order to try them (the main `stream` is always first). A resolver that finds several streams can fill it; the generic resolver
does for the extra streams a page declares. The TV and the phone show a Source picker when there is more than one.

## The film and the host's bandwidth

For a few desktop viewers willing to install an extension, [Kino Direct Playback](extensions/kino-direct/README.md) is a verified alternative:
Kino keeps its HUD while the browser fetches the film directly, with no relay hosting or website video traffic. Install the extension per
playback browser and deploy the companion website update. Browsers without extension support can use the separate relay described below.

The pages, the library and the sync are small (a first visit is about 0.3 MB packed, a revisit a few hundred bytes, an idle screen about 20 KB an
hour). **The film is the bandwidth**: through `/api/proxy` an hour is about 0.4 GB in 360p, 1.2 GB in 720p and 2.4 GB in 1080p (a test film at
0.8, 2.6 and 5.3 Mbit/s), and a plan with 5 GB a month is gone in a few hours of 720p. Making the picture smaller only stretches that. What
works is that the film never comes through the server.

**Why the screen cannot just ask the film's own place.** The places that the library's sources get their films from turn away a page of another
website (they look at the `Origin` and at the `Referer`, and send no CORS headers), and want to see the address of their own player. A
browser cannot set arbitrary Origin or Referer headers. `DIRECT_STREAMING=true` therefore works only when the provider permits the browser's
requests. A failed external HLS stream now stays off the website proxy; there is no automatic website fallback. Native HLS browsers also
use a configured separate relay from the start.

**Use a separate relay whose IP the upstream accepts.** The existing Cloudflare Worker was reproduced returning upstream 403 blocks on
16 October 2026, including at the token endpoint. It is not a working solution for this provider. The Node relay obtains IP-bound tokens
on the same machine that downloads the media, signs all child links, and returns the CORS headers needed by the browser.

1. Deploy the separate Node service with `pnpm relay` and `STREAM_RELAY_KEY`, on a host verified to reach the upstream.
2. Set `EDGE_STREAM_PROXY_URL=https://YOUR-RELAY-HOST/api/proxy` and the matching `EDGE_STREAM_PROXY_KEY` on the website host.
3. Keep `PROXY_VIDEO=off`. Subtitles can still use the website; video uses the separate relay.

The [deployment and verification guide](STREAM_RELAY_SETUP.md) includes environment settings and a container definition. Kino's native HUD
remains in use; viewers need no extensions or local software.

To see that it works: open the Network tab on the TV page (the *Domain* column) while a film plays; every piece should come from your
separate relay address, none from the app's own. `/api/health` says the same from the server's side: `proxy.bytes` stays where it was,
`proxy.video` is `"off"`, and `proxy.refused` counts what was turned away. A host's own graph can lag by an hour (Render's is hourly).

The library adapters use the relay; generic pasted links retain their resolver's selected delivery path. The new Node relay accepts only
signed, unexpired links and refuses private destinations. Video bandwidth belongs to its separate host. A relay IP that the provider blocks
will still fail, so validate the upstream token, playlist and segment from the chosen host before deployment.

**When the server has to carry the film** (no relay, `PROXY_VIDEO` on): the player's own quality choice stops at 720p on a stream that comes
through `/api/proxy` (`proxiedQualityCap` in `src/client/tv/engine.ts`; a quality picked from the menu still goes higher), it keeps only
about 90 seconds ahead of the picture (48 MB) when one screen watches, and the next episode is fetched only in the last two minutes of
the one before. That halves what an hour costs (1.2 GB instead of 2.4 GB in the test above), which is a way to slow it down, not to stop it.

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
   about this in its log. (Neon's free database wakes by itself when it is asked; Supabase has paused free projects after a week without
   use, and one that is paused has to be restored from its dashboard before the server can start.)
4. Set `TMDB_API_KEY` to your own key, and `REGISTRATION=closed` (or `MAX_ACCOUNTS`) once the people it is for have signed up.
5. Phones and TVs reach it over `https://<name>.onrender.com`, so camera scanning works. **Which phone goes with which TV is kept in the same
   database as the accounts**, so an instance that sleeps and wakes (or is restarted by a deploy) finds every pair as it was: the TV is
   "connected" again the moment its page reconnects, with no new code to scan, and a TV whose page is opened again is put back on the video
   it was on (paused, at its place). A code that is on a screen when the server restarts is not kept (the TV shows a new one). A pair
   nobody has used for more than a year is let go. Open `https://<name>.onrender.com/api/health` to see where a service keeps things:
   `"storage":"postgres"` is the good answer; `"file"` or `"memory"` on Render means **nothing** (accounts, sign-ins, pairs, what was
   playing) survives the instance sleeping, and `DATABASE_URL` is missing on that service (each service needs it, and two services must
   never share one database: each keeps its own copy in memory and would write over the other's). A keep-alive pinger that stops the
   sleep is not worth it on the free plan: its 750 instance hours a month are shared by all the services of an account, so two services
   kept awake all month would run out
   Watch parties and the codes live in the memory of **one service**: two services (two `onrender.com` names, even of the same repository)
   do not know each other's codes, so a phone on a different address than the TV answers "Invalid or expired code" however well the code is
   typed. Use the address the TV shows (the party page prints it) on every device, and delete a duplicate service.
6. **What a watch party costs the server.** Every screen of a party gets its own copy of the film through `/api/proxy`, so the bandwidth grows
   with the number of screens whatever the cache does (check the monthly outbound traffic of your plan before a long film with a big party).
   What the cache saves is the other side: the server keeps the film's pieces that one screen fetched for a few minutes (64 MB, or
   `SEGMENT_CACHE_MB`), so the screens of a party ask the film's own site once for a piece, not once each. For that to work the screens of a
   party download only about 40 seconds ahead of their picture (a lone screen takes minutes in), which is what that memory holds. Open
   `/api/health`: `segments.hits` are the pieces the server gave from memory and `segments.misses` the ones it had to fetch; a party that
   watches together shows about as many hits as misses with two screens, and about twice as many with three. The same two numbers are on the
   `?debug` panel, next to how a guest's picture keeps with the host's. A screen on a weak link brings its own quality down (*Quality follows
   the connection*), so it asks the server for fewer bytes, not more.

### Other hosts

Anything that runs a Node process does (Northflank, Railway, Fly, a VPS):

- **Start with `pnpm start`.** `tsx`, which it runs, is a regular dependency, so a host that installs only the dependencies of a running app, or that
  removes the build tools after building (most buildpacks do), still has it: `tsx: not found` and a restart loop was the sign of it being missing. `dist/client`
  is committed, so there is nothing to build.
- **Node 24** (`.node-version`), pnpm from `packageManager` (`corepack enable`).
- **The port:** the server listens on `PORT` (default 8787) on `HOST` (default `0.0.0.0`). Declare that port as HTTP in the host, with WebSockets allowed
  (the page talks over `/ws`), and `/api/health` as the health check.
- **Set `TRUST_PROXY=1`** (the number of proxies in front of the server; it is on by itself only on Render). Without it every visitor looks like one address
  to the rate limits (10 sign-ups an hour, wrong codes, link polls) and they apply to everybody together (twenty wrong codes from anybody
  then pause pairing for all).
- `DATABASE_URL` as above, and **one running copy per database**: two copies (the old host and the new one) write over each other.

Limits to know about: there is no password reset (no mail is sent, and a password can be anything, so a forgotten one means a new account),
an account with no password can be opened by anyone who types its name (give it one if that matters), and the sign-in rate limits are
per name and per address, so they are best-effort behind a shared proxy. A browser that wipes **all** of a site's data when it is closed
(a private window, some TV browsers) forgets which TV or phone it is, and no page can help that: the cookie that backs up the id goes
too. A TV that is paired when the server's disk is wiped (no database) is paired with nobody afterwards, and shows a new code.

## Test

```bash
pnpm test         # unit + WebSocket integration (vitest), accounts included (Postgres is tested with an in-process PGlite)
pnpm e2e          # real browsers: phone UI + TV page + local fixtures (playwright, builds first)
pnpm typecheck
pnpm fixtures     # optional: regenerate fixtures/ with ffmpeg (outputs are committed)
```

Tests never touch the internet; they use `fixtures/` (served at `/fixtures/`) and, for accounts, an in-memory store (`DATA_DIR=memory`) with
throwaway credentials from `e2e/testAccount.ts`. The e2e suite covers pairing by code and by QR link, camera scanning (Chromium's fake
webcam shows a generated QR code), disconnect and switching TVs, resume, the D-pad and its Back key (one step out of every page, menu and window: `e2e/remote-back.spec.ts`), HUD fading, subtitle memory and the episode lists, the
library and its menu, watch parties (from a TV, from a phone, from a link), a second phone and a phone that scans another TV, a phone with
several TVs (`e2e/several-tvs.spec.ts`), a server that is slow to answer (a page whose connections are never answered:
`sleepingServer` in `e2e/helpers.ts`, with the page's clock skipped ahead), the TV page on a
phone, a tablet and a phone held sideways, a finger on the picture (taps, double taps, a hold, the big button, the landscape lock, the episode's name:
`e2e/player-touch.spec.ts`; the recognizer on its own in `src/client/tv/gestures.test.ts`), the end card and mute, full screen (at the first press, kept for the next visit, the buttons),
ratings (scores, notes, seasons and the facts kept with them, on the phone and the TV, and the score on a title's picture), the TV's menu and its Profile page (`e2e/profile-hub.spec.ts`, which also checks that what the page says fits its tiles in the three languages at four screen sizes), the Feedback button on a phone and on a TV (`e2e/feedback.spec.ts`: what is sent, the picture of the screen and its marks, what the team reads with its token, the answer that comes back), friends (made with a code or a link, what a friend can see,
what is sent and told, on the phone and between two TVs: `e2e/friends.spec.ts`, `e2e/friends-tv.spec.ts`; tags, requests and the Add button of a party, with the fit of its rows: `e2e/friend-tags.spec.ts`; the bell on the phone and the TV, with the fit of the header, the corner and the list: `e2e/bell.spec.ts`; the chat between two friends on the phone and the TV, what waits, the switch, mute, report and the fit in the longest words on the narrowest screens: `e2e/chat.spec.ts`), and accounts: registering, profiles (on the phone, and made, renamed and removed on the TV), guest progress combined into an account, a second
device picking up where the first stopped, a TV signed in from a phone or from another screen, and the three languages. The pages in these
tests start as if full screen had been left on an earlier visit (`playwright.config.ts`), so a key press never takes one full screen by
itself; the tests of full screen start from nothing (`FIRST_VISIT` in `e2e/helpers.ts`). A Hisense browser is imitated by its user agent
(`e2e/hisense.spec.ts`), and a TV's OK key by a raw key down and up with no typed Enter. Every device a test opens (`openDevice` and the others in `e2e/helpers.ts`) is closed when the test ends: the specs take `test` from there, which adds that clean-up, since Playwright does not close a device made with `browser.newContext()` and a run that left them all open ended with hundreds of browser processes.

Browsers that refuse a video until it has been pressed (Brave's strict setting, iPhones) are tested with a browser started with
`--autoplay-policy=user-gesture-required` (`strictBrowser` in `e2e/helpers.ts`). Playwright's own click lets go of the button within a few milliseconds,
a hand takes a tenth of a second or more, and anything that moves under the pointer on the press makes the click miss, so clicks on things that
move on focus use `clickAsAHand`. Not covered by tests, because it needs real hardware: Fire TV /
Android TV remotes, the wake lock, an iPhone's camera and browsers, and the home screen install itself (only that the manifest and its icons are served).

## Layout

```
src/shared/    protocol.ts (messages, commands, state), media.ts (NormalizedMedia, series helpers), account.ts (profiles, the merge), rating.ts (what a rating remembers of the watching),
               friends.ts (the friends' switches, what travels between them), chat.ts (the chat's limits and the rule for a message)
src/server/    sessions/ (registry: devices, codes, controllers; pairings: which phone goes with which TV, kept between restarts), websocket/hub.ts,
               resolvers/, accounts/ (store, routes, persistence, friends: codes, inboxes, what a friend may see, chat.ts and chatRoutes.ts: the chat between two friends), feedback/ (what people send with the Feedback button, and the team's side of it), app.ts
src/client/    controller/ (phone), tv/ (receiver, HUD, menu, library, PlayerEngine), account/ (profile store, sync, shared account UI),
               friends/ (the state both screens share, what is new, the friends' pages of the TV), chat/ (the chat of two friends: the phone's sheet, the TV's pages, what waits), feedback/ (the Feedback form, the picture of the screen and its marks),
               i18n/ (en, ro, it), shared/ (socket, format, words, logo, icons)
public/        copied as it is into the built page: the web app manifest and its icons
fixtures/      sample.mp4, long.mp4 (40 s, for Up Next), hls/ (VP9, so Playwright's Chromium can decode them)
e2e/           Playwright specs and helpers
```
