# The phone's Back button: one page back, and a question before the site is left

Branch `fix/android-back`, on `main` after the subtitle aligner's update 2 (PR #22).

## What was asked

On an Android phone, Back while a film played left the site. It should go to the page before, as a back button does, everywhere, down to the
library, where a first Back says "press again" (or something more natural) so that nobody leaves by a slip of the thumb.

## What the site did before

The site is one page that changes by state, so the browser's history had a single entry for it, and every Back left it. The phone's remote had
one exception: a sheet or a page of the account put an entry on the history while it was open (`useBackToClose`), so Back closed it. A film, a
title's page and the library's pages had none.

## What it does now

Every Back goes back one page, as far as it can be said what "a page" is; the first Back at the library asks, the second leaves.

| Where | Back does |
|---|---|
| A film on a phone used as the screen (`/tv`) | the menu over it, then the countdown to the next episode, then leaves the film for the library (a show's page when it was chosen there) |
| A film that others watch | asks first: the host with guests ("Press Back again to stop it for everyone"), a guest ("...to leave the party") |
| A title's page, the lists, the profile and its pages | goes up one page, down to the library |
| The party's pages, the end card, the error card, the welcome | the same as the remote's Back key does there |
| The phone as a remote, a sheet over it | closes the sheet |
| The phone as a remote, a place of the bar other than Home (Search, My Lists, You) | goes to Home: the four places are not steps of the history (`controller/shell/useTabs.ts`), and each keeps how far it was scrolled |
| The phone as a remote, a title's page or a row's "See all" | goes back to the place it was opened from, scrolled where it was left |
| The phone as a remote, the remote | puts the remote away, to the library, with a line "playing on the TV" that brings it back. **The film is not stopped by a Back** (Stop is a button) |
| The library, the first Back | "Press Back again to leave", a line that runs down 2.5 s |
| The library, a second Back within the time | the browser's own Back: the site is left |

Desktops and TVs are unchanged (Back is a key there, and a button nobody presses by mistake): the guard and the screen role's layers exist only
where `isHandHeld` says so (`role.ts`: a touch screen, a coarse pointer, not a TV's browser; phones and tablets).

## How it works (`src/client/shared/backButton.ts`)

- **Layers.** Each thing that Back closes (a sheet, a page, a film) puts one history entry on while it is open, with `{ layers: n, visit }` in its
  state. A Back lands on the entry below, which tells the code that the layer on top was asked to close. A layer that closes some other way (its own
  button) takes its entry off again; one that closes and another opens in the same moment (the menu for the party) swaps in place with `replaceState`.
  A Back that leaves a layer open (a page that only steps back to the one before it) gets its entry back by going forward to where the Back took
  it from (see "Chrome's rule about entries" below).
- **The guard.** One more entry under the layers, pushed at the first touch. At the bottom of the site a Back lands on the page the site was opened on
  with the guard gone: `ask()` shows the line, and a second Back is the browser's own and leaves, in a tab, a Custom Tab and an installed app alike. The
  guard comes back after 2.5 s or at the next touch (by going forward to it), so a Back long after is a first Back again and not the answer to an old
  question.
- **Why only after a touch.** Chrome passes over the entries a page makes without a touch ("history manipulation intervention"), so a guard made at
  load would be skipped and Back would leave anyway. After the first touch the entry counts. A Back before it is the browser's own: nothing was
  done yet that could be lost.
- **Earlier visits.** After a reload, or when the browser brings the page back, the history holds entries the earlier load made. They carry another
  `visit` token and are gone through with `history.back()` on the way down; the current one is adopted as the guard.
- **`pressAgain(key)`** is a question for one Back (stopping a party for everyone, leaving it): the first says so, a second for the same thing within
  2.5 s is the answer. The line stands above the film's controls for these (`lifted`).

## Chrome's rule about entries (the second round: "Back takes me out of the website entirely")

A tester's phone (Chrome 156, Android 10) left the site on a Back from the account's pages. The first round had tested with Playwright's `goBack()`,
which walks the history one entry at a time and applies none of Chrome's rule about the entries a page makes, so it could not see this. The rule
(read in Chromium's source, then checked with Chrome's own Back: `chrome.tabs.goBack` from a tiny extension, the page watched through CDP only,
because a Playwright `evaluate`, a locator or a trace counts as a touch and lets go of everything the rule holds):

- An entry made with `pushState` while the person has not touched the page since their last Back (or since the page opened) is held against the page:
  the next Back passes over every entry the page made, and out of the site if nothing else is left. (A tap that makes an entry and lifts after it
  is fine: the lift lets go of it.)
- A touch is a finger lifted (`pointerup`), a click, or a key that is not Escape. An entry made in the touch's own events counts.
- `history.go()` from the page, forward or back, is never held against it and passes over nothing; `replaceState` makes no entry.

The code of the first round made entries in answer to a Back: the guard again when the question ran out, an entry again for a layer that stays after
a Back (a page that only steps back to the one before), the guard and the layers again after two Backs in a row. The Back after that one ran past
everything. Now (`honored`, `repay` in `backButton.ts`):

- **No entry is made unless the person has touched the page since their last Back.** `honored` is true from a touch (`counts`: `pointerup` that is
  not a mouse's, `click`, `keydown` that is not Escape or a modifier, trusted) until the next Back or Forward that the page did not ask for itself.
- **What a Back took and is still wanted is gone forward to, not made again.** The entries stay ahead of the person after a Back (until something is
  pushed), so the layer that stays, the guard after the question, and both after a Back that went past them are given back with `history.go(n)`. Only
  entries of the same kind are gone forward to (`reachGuarded`): entries made before the guard stood under them are not the ones it needs.
- **What cannot be had yet is owed to the next touch.** A layer that opens by itself after a Back (a sheet that comes up, a party that is offered) has
  no entry until the person touches the page; a Back in between closes it all the same, the entries under it being the guard's and the page's.
- **A layer without an entry never costs one.** `clear` takes off only the entries that are above the guard and the layers still open.

## What it does not do

- It never traps: the second Back always leaves (Google's policy on "back button hijacking" is about pages that do not let go). The guard adds no
  more than one press to leave.
- The full-screen button's prompt and the library's side menu are not layers (a Back that closes them would be one more thing to learn).
- A Back does not stop the TV from the phone remote, and does not undo a film's end: its place is kept either way.

## Tests

- `shared/backButton.test.ts`: a fake browser (entries, `popstate`, a clock, user activation) that keeps Chrome's rule about entries (an entry made
  since the last Back without a touch is passed over by the next Back, which leaves the site if nothing else is left; a touch lets go of them) holds the
  layers, the guard, the question, the stale entries, `pressAgain`, a Back that arrives late or never, and a hundred and fifty random walks of forty
  steps (touches, Backs, layers that open and close, the question that runs out). A walk fails when a Back leaves the site anywhere but at the question or
  before the first touch, or when, after a touch, the history does not hold the guard and one entry for each layer that is open. Each rule has a test
  that fails when it is switched off (a light mutation check, not kept); the code of the first round fails several of them, the walks among them.
- `role.test.ts`: `isHandHeld`.
- `e2e/android-back-real.spec.ts`: the Back that Chrome presses. A desktop Chromium that is dressed as the tester's phone (392 x 739, touch, Chrome 156 on
  Android 10) and has a tiny extension (`e2e/fixtures/back-extension`) that calls `chrome.tabs.goBack`, which keeps the rule; the page is looked at
  through CDP only, because a Playwright `evaluate`, a locator or a trace counts as a touch and lets go of everything the rule holds. Two paths: the
  account chip, the profile, the feedback sheet and three Backs (then the question that runs out, asks again and is answered), and the library's
  categories, a category, a title and Back through each of them. Both fail on the code of the first round, which leaves the site: the first at the
  Back after the question has run out (it should ask again), the second at the Back from the categories (it should go home).
- `e2e/android-back.spec.ts` on a touch context: the film, a title's page, the question and the second Back leaving; the question that runs out and
  the touch that ends it; a Back before the first touch; a reload; the paired phone (sheet, remote, the line, the question); a party guest; and a
  desktop that keeps its keys. `phone-to-tv.spec.ts` now holds that no *layer* entry is left (the guard may be). `phone-layout.spec.ts` holds that a title's
  page, closed with its Back button, leaves the place under it where it was. (A phone used as the screen has its party button on the profile's page, its
  bar of four places having no room for it: the party test here opens that page first.)

## Not checked

No real Android phone was at hand. Playwright's `goBack()` goes through the browser's history without the intervention above, so
`e2e/android-back.spec.ts` cannot see it; the rule is held by the unit tests (a fake browser that keeps it) and by `e2e/android-back-real.spec.ts`
(Chrome's own Back, pressed from an extension, on a desktop Chromium that is dressed as a phone). That Chrome is the desktop build: the Android build
shares the history code of the rule, but its Back button and the swipe from the screen's edge were not pressed, and they arrive as the same `popstate`.

Not seen at all: Safari on iOS (it gets the same layers and guard, and its own rules about history were not read), a Silk browser on a Fire TV, an
installed web app (a WebAPK) and a Custom Tab, where Back may also take the full-screen mode away first (that exit is not modelled). Two Backs pressed one
right after the other, faster than the site can give back an entry it needs (about 150 ms), go down as the history goes: each one is a Back, and the
second can reach the question at the bottom sooner than a person who pressed once would.
