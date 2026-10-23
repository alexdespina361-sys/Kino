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
  A Back that leaves a layer open (a page that only steps back to the one before it) puts its entry back.
- **The guard.** One more entry under the layers, pushed at the first touch. At the bottom of the site a Back lands on the page the site was opened on
  with the guard gone: `ask()` shows the line, and a second Back is the browser's own and leaves, in a tab, a Custom Tab and an installed app alike. The
  guard comes back after 2.5 s or at the next touch, so a Back long after is a first Back again and not the answer to an old question.
- **Why only after a touch.** Chrome passes over the entries a page makes without a touch ("history manipulation intervention"), so a guard made at
  load would be skipped and Back would leave anyway. After the first touch the entry counts. A Back before it is the browser's own: nothing was
  done yet that could be lost.
- **Earlier visits.** After a reload, or when the browser brings the page back, the history holds entries the earlier load made. They carry another
  `visit` token and are gone through with `history.back()` on the way down; the current one is adopted as the guard.
- **`pressAgain(key)`** is a question for one Back (stopping a party for everyone, leaving it): the first says so, a second for the same thing within
  2.5 s is the answer. The line stands above the film's controls for these (`lifted`).

## What it does not do

- It never traps: the second Back always leaves (Google's policy on "back button hijacking" is about pages that do not let go). The guard adds no
  more than one press to leave.
- The full-screen button's prompt and the library's side menu are not layers (a Back that closes them would be one more thing to learn).
- A Back does not stop the TV from the phone remote, and does not undo a film's end: its place is kept either way.

## Tests

- `shared/backButton.test.ts`: a fake browser (entries, `popstate`, a clock, user activation) holds the layers, the guard, the question, the stale
  entries and `pressAgain`; each rule has a test that fails when it is switched off (a light mutation check: `scratchpad/mutate-back.mjs`, not kept).
- `role.test.ts`: `isHandHeld`.
- `e2e/android-back.spec.ts` on a touch context: the film, a title's page, the question and the second Back leaving; the question that runs out and
  the touch that ends it; a Back before the first touch; a reload; the paired phone (sheet, remote, the line, the question); a party guest; and a
  desktop that keeps its keys. `phone-to-tv.spec.ts` now holds that no *layer* entry is left (the guard may be). `phone-layout.spec.ts` holds that a title's
  page, closed with its Back button, leaves the place under it where it was. (A phone used as the screen has its party button on the profile's page, its
  bar of four places having no room for it: the party test here opens that page first.)

## Not checked

No real Android phone was at hand. Playwright's `goBack()` goes through the browser's history without the intervention above, so the rule about
entries made without a touch is in the unit tests (a fake browser that skips them) and nowhere else. The gesture navigation's swipe from the screen's
edge arrives as the same `popstate`.
