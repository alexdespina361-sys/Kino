# Audit brief (read this first, whichever audit you are)

Kino is a web app that turns a phone into the remote of a TV (or any screen with a browser) and also plays on the screen itself:
the TV page (`/tv`, D-pad / remote / mouse) and the phone page (`/`, touch) talk through the server. This program polishes the
front end. Your job is **one read-only audit**: find what is wrong, rough, missing or inconsistent, **prove it**, rank it.

The owner's words for the goal of the program: *fix bugs, improve layout, add missing buttons, optimise pathing, improve usage*, and make the
screens look consistent and refined. So an audit is not only "does it look nice": a dead end, a missing Back, a button that is not there, a
wrong label, a state that is lost on Back are all findings, and are worth more than a pixel nit.

## Rules

1. **Read-only on the product.** Do not edit anything under `src/`, `e2e/`, `dist/`, `scripts/`, `package.json`, `pnpm-lock.yaml`, `playwright.config.ts`, or any other doc.
   The only things you write: your report `docs/ui-polish/audits/<your-file>.md`, and scratch files in **your own folder** in the session scratchpad (given in your task).
2. **Do not** run `pnpm build` / `vite build`, `pnpm e2e` / `playwright test`, `pnpm install`, `git commit/checkout/stash/reset`, or anything that touches `dist/` or the git state.
   (`dist/client` is committed and served by the server; a build under another auditor's feet breaks their run.) Reading with `git log/show/diff` is fine.
3. Servers: you may start **your own** server on **your own port** (given in your task) and must stop it when you finish (`taskkill /PID <pid> /T /F` on Windows). Never use port 8810, 8811 or 8800-8809.
4. **Evidence beats opinion.** Every finding cites where (`file:line`, or a picture name, or a measured number and how you measured it). If it is a taste call say `(opinion)`. If you could not reproduce something say so; never invent a repro.
5. The app today has **two looks**: `classic` (what ships) and `polish` (not built yet). Your findings are about the classic look as it is now. For each finding say which look it belongs to:
   **both** = a bug, a missing affordance, a dead end, an accessibility failure, wrong behaviour or wrong text (fixed in both looks);
   **polish** = a purely visual refinement (classic stays as it is, on purpose, so the owner can switch back).
6. Constraints any proposed fix must respect (do not propose things that break them):
   * The TV page must work on old TV browsers (VIDAA / Tizen / webOS: Chromium about 68-76). So **no** `@layer`, `:has()`, `:is()`, `:where()`, `@container`, `color-mix()`, `dvh`, `text-wrap`, `inset`, `aspect-ratio` without fallback, `gap` for flexbox without fallback. A guard test fails the build if the polish stylesheet uses them.
   * The TV UI is sized in `em` from one scale (`--em` on `.tv`); keep it that way. Layouts compact under 900 px wide / 520 px tall.
   * Six accent colours exist (`data-accent` on `<html>`: red default `#e50914`, blue, purple, green, orange, pink): everything must work with all six. The brand red does not change.
   * Icons are one inline-SVG family (`src/client/shared/icons.tsx`, 24 grid, stroke 2, round caps). No icon library.
   * Plain CSS (no Tailwind, no CSS-in-JS). Texts live in `src/client/i18n/{en,ro,it}.ts` (key parity is a test).
   * Many `data-testid`s and class names are used by the 460+ e2e tests: fixes should be additive in the DOM.
7. Do not duplicate each other: stay in your area. If you see something clearly in another auditor's area, put it in a one-line "Seen on the way" list at the end.

## What exists on disk for you

* `.ui-polish/shots/classic/<device>/<name>.png`: ~170 pictures of every screen, classic look, made-up catalogue with drawn posters. Devices: `tv-1280` (1280x720, all screens, signed out), `tv-1920`, `tv-2560`, `tv-1440x900`, `tv-1366x768` (main screens), `tv-1280-signed-in`, `tv-1920-signed-in` (friends, ratings, history, account, party, bell), `phone-390` and `phone-390-signed-in` (390x844). The `Read` tool shows PNGs as images. `-live` pictures show a real film frame.
* `.ui-polish/scan/classic/<device>/<name>.json`: for each of those pictures, every meaningful element with its computed style (size, weight, colours, contrast, radius, padding, shadow, transition, position, accessible name...).
* `docs/ui-polish/drift/classic.md` (+ `.json`): the totals of those scans and the rule breaks found automatically. **Use it, then go beyond it**: it measures, it does not understand.
* `docs/ui-polish/REFERENCE_PRINCIPLES.md`: the rules of good TV / phone / desktop UI this program measures against.
* The code: `src/client/` (TV in `tv/`, phone in `controller/`, shared in `shared/`, accounts in `account/`, friends in `friends/`), styles: `styles.css`, `tv/tv.css`, `controller/controller.css`, `account/account.css`, `tv/friends.css`, `controller/friends.css`. Tests in `e2e/*.spec.ts` show what behaviour is promised.

## Running the app yourself (when you need to try something, not just read)

Start a throwaway server (accounts live in its memory; the library is a made-up catalogue served through route mocks, no network needed):

```powershell
$env:PORT = "<your port>"; $env:HOST = "127.0.0.1"; $env:ALLOW_PRIVATE_NETWORK = "1"; $env:LIBRARY = "off"; $env:DATA_DIR = "memory"; $env:SIGNUPS_PER_HOUR = "1000"
node node_modules/tsx/dist/cli.mjs src/server/index.ts     # run from the repo root, in the background; wait for http://127.0.0.1:<port>/api/health
```

Drive it with a script in your scratch folder, reusing the walk's helpers (made-up catalogue, devices, seeded storage):

```js
import { chromium, openContext, guestData, HD, FULL_HD, PHONE, wait, movies, series } from "file:///C:/Users/Me/Desktop/WebPlayer/scripts/ui-walk/lib.mjs";
// run with:  BASE=http://127.0.0.1:<port> node <your script>.mjs     (UI=polish would switch the look; not built yet)
const browser = await chromium.launch();
const context = await openContext(browser, HD, { seed: guestData({ /* progress, list, ratings ... see scripts/ui-walk/tv.mjs for a full seed */ }) });
const page = await context.newPage();
await page.goto("/tv");               // the TV: "/tv"; the phone: openContext(browser, PHONE, { phone: true }) then page.goto("/")
```

Look at `scripts/ui-walk/tv.mjs`, `tv-signed-in.mjs`, `phone.mjs` for how every screen is reached (they are the map of the app's screens, with the `data-testid`s).
Keys on the TV: arrows, Enter, Escape/Back (`page.keyboard.press`). A pointer at rest changes what the TV shows (hover rail, corner buttons): `page.mouse.move(width - 2, height - 2)` parks it away.
`first: true` in `openContext` shows the welcome screen; without it the device has "left full screen once" so the welcome goes by itself.

## Severity

| | meaning |
|---|---|
| **P0** | broken or unusable: a core task cannot be done, a crash, a lock-out (also an accessibility failure that locks someone out) |
| **P1** | clearly wrong or confusing in a main flow: a dead end, a missing Back/close, a lost state, a wrong label, text unreadable, a target too small to hit |
| **P2** | inconsistent or rough: same thing looks/acts differently in two places, off-scale spacing, weak hierarchy, minor a11y gaps |
| **P3** | nit or idea |

## Report format (`docs/ui-polish/audits/<your-file>.md`, at most ~400 lines)

1. **Scope and method**: what you looked at, how (read / measured / ran), what you did **not** cover.
2. **Findings** as a table, most severe first. Columns: `ID` (your letter + two digits, e.g. `E07`), `P`, `Look` (both / polish), `Where` (file:line, picture, screen), `What`, `Why it matters`, `Fix idea` (one line, within the constraints), `Verified` (how: "ran it", "measured X px", "read the code", "opinion").
3. **Patterns**: 3-8 root causes that explain many findings (e.g. "close buttons are drawn four different ways"), each with the IDs it explains. A pattern is where the cheapest fixes are.
4. **Quick wins**: at most 10, each under an hour of work.
5. **Keep**: what already works well and must not be lost by the polish.
6. **Open questions for the owner**: only real taste forks (maximum 5).
7. **Seen on the way** (other areas).

## Your final message

At most 20 lines: findings per severity, the 8 most important ones (ID + one line), the path of your report. Nothing else; the report is the deliverable.

---

# The audits

Each auditor does exactly the one named in the task. The area letters are the master plan's (A geometry, B icons, C controls, D typography, E TV / 10-foot,
F responsive, G motion, H accessibility, I performance / compatibility) plus **U** (user flows, pathing, missing buttons, behaviour bugs). A+D and B+C and G+I are paired.

## A+D: Visual system: geometry, type, colour, surfaces (report `A-visual-system.md`)

Read all six stylesheets and the drift report. Answer with numbers:
* **Type**: the distinct sizes in use on the TV (in em) and the phone (px); which are near-duplicates (within about 6%); the line heights, weights, letter-spacing, text transforms; where hierarchy is weak (title vs meta vs hint look alike) or too loud; text that is too long/short for its slot; ellipsis vs wrap decisions.
* **Spacing & geometry**: paddings, gaps, margins: on a scale or ad hoc? The rhythm of a page (header, hero, rows, footers); left/right alignment of edges across TV pages (does the title line up with the first tile?); header heights; inconsistent screen margins between pages; hard-coded px inside the em-based TV; breakpoint behaviour (the 900 px / 520 px compaction, and what happens just above/below).
* **Radii, borders, shadows, surfaces**: how many radii; how many surface greys (and near-duplicates); `rgba(255,255,255,x)` whites vs the `--surface` tokens; elevation language; focus/selected/hover looks per surface.
* **Colour**: the six accents against the surfaces; where the accent is used (primary, selected, progress, badges, errors?) and where red means two things (brand accent vs error/destructive: with the red default these collide).
* **Consistency of kinds**: cards, sheets, rows, chips, headers, toasts, empty states, loading states, error states: for each kind, list its variants across TV / phone / account / friends and which one should win.
* Propose a **token set derived from what is already dominant** (type scale, spacing scale, radii, elevation, surface colours, motion durations), mapping each existing value to its nearest token. This becomes `DESIGN_SYSTEM.md`, so be concrete: names, values, which existing values collapse into which.

## B+C: Icons and controls (report `B-icons-controls.md`)

Read `src/client/shared/icons.tsx` and every use of icons, glyph characters (`×`, `✕`, `▶`, `★`, `+`, `›`, emoji, `&times;`) and every control in TV, phone, account and friends code.
* **Icons**: sizes in context, optical alignment next to text, stroke weight, filled vs outline mixing, icons that are missing where a verb button would read better, glyph characters used where an icon exists, icon-only buttons with no accessible name, icons whose meaning is unclear. A table: icon → where → size → issue.
* **Controls**: inventory every kind (primary/secondary/ghost/danger buttons, icon buttons, close buttons, chips, tabs, segmented controls, toggles/switches, radio rows, inputs, code inputs, search fields, selects, sliders/seek bars, menus/sheets/modals, list rows, cards/tiles, badges). For each: where, variants, **states present and missing** (hover, focus, active/pressed, disabled, loading, selected, error), minimum sizes (24 / 44 px on phone; em on TV), and **the same function drawn differently in different places** (the close button is the classic suspect; also Back, Play, Add, Remove, Copy).
* Produce a **component inventory table** ready to become `COMPONENT_INVENTORY.md`: component → where used (file) → variants → states → issues → proposed single primitive.

## E: TV / 10-foot / D-pad (report `E-tv.md`)

Read `src/client/tv/**`, `role.ts`, and the TV e2e specs for what is promised. **Run it with the keyboard only** (arrows, Enter, Escape) and record, per screen:
first focus; where each arrow goes from each element (can everything be reached? any trap? any press that does nothing?); what Back/Escape does (one step out? to where?); what the focus looks like (compute the focused element's outline / box-shadow / transform against the unfocused one: size in em, contrast against what is behind it); whether focus is remembered when you come back; the number of presses for the 12 most common tasks (play the first film, resume, next episode, add to a list, rate, search, change language, pair a phone, switch profile, host a party, sign in, leave the player).
Also: safe margins at 1280 / 1920 / 2560; the smallest text on each screen (px and % of width); the HUD (auto-hide time, which keys do what while playing, what can be reached); overlays and menus (focus trap, Back); mouse use on a desktop browser (rail opens on rest, corner +/x, hover states, cursor).
**One known oddity to explain**: two baseline runs of the signed-in home screen showed different initial focus (the hero's Play button in one, the first "Continue watching" tile in the other). Find out whether focus is stolen when data arrives late, and what a user would experience.
Deliver a **screen graph** (which screen leads to which, with the key that does it, and what Back does) at the end of the report.

## F: Responsive and cross-device (report `F-responsive.md`)

Take your own pictures (script in your scratch folder) and measure overflow. Phone UI at 320, 360, 390, 430 wide (portrait) and 844x390 (landscape phone); tablet 768x1024 and 1024x768; the TV UI in desktop windows at 800x600, 1024x768, 1280x800, 1366x768, 1440x900, 1920x1080, 2560x1440, 3840x2160. Main screens only: pair, library, title sheet, remote, account/settings (phone); browse, detail, settings, player HUD, a form (TV). Find: horizontal scroll, clipped or overlapping text, controls pushed off screen, scroll containers that trap, sticky bars that cover content, tiny or huge things at the extremes, what happens just around the 900 px / 520 px compaction thresholds, on-screen-keyboard behaviour on the phone (viewport shrink while typing), safe-area insets, orientation change mid-use, and the **role decision** in edge cases (`role.ts`: iPad, desktop with touch, small desktop window, a phone asking for `/tv`).

## G+I: Motion, performance, compatibility (report `GI-motion-perf-compat.md`)

* **Motion**: every transition and animation in the CSS (and any in JS): property, duration, easing, trigger; which ones animate layout (width/height/top/left/margin) rather than transform/opacity; infinite animations; reduced-motion handling; what happens on focus move (scale + outline) and how costly it is; abrupt changes with no transition where one is expected. A table plus a recommended small motion vocabulary (durations, easings).
* **Performance**: sizes of `dist/client/assets/*` (js, css, per chunk) and what loads on each role; images (lazy/decoding/size attributes, aspect-ratio boxes, layout shift when posters arrive); how many DOM nodes the TV home has with a full catalogue; re-render hot spots on focus move (read `Browse.tsx`/`Tv.tsx`); fonts (which, how loaded); anything that would be slow on a weak TV CPU. You may measure in a browser (DOM node counts, `performance` entries, CPU-throttled focus moves).
* **Compatibility**: the build target (`vite.config.ts`), and every CSS/JS feature used in `src/client` that is newer than Chromium 68 / Tizen 5 / webOS 5 (list with file:line and a fallback or "must stay out of the polish CSS"); how the existing guard tests (`src/client/polish/polish.test.ts` and others) enforce it; gaps in them.

## H: Accessibility (report `H-accessibility.md`)

Follow the checklist of the `design:accessibility-review` skill (invoke it with the Skill tool if you have it) and WCAG 2.2 AA, applied to what Kino is (TV with D-pad, phone, desktop keyboard). Read all TSX for roles, names, states (`aria-checked/expanded/selected/current/pressed`), dialogs and sheets (`role=dialog`, `aria-modal`, focus trap and restore), live regions (toasts, status), headings and landmarks, `lang`, form labels and error association, `alt` text, keyboard operation of the phone UI, reduced motion. **Measure**: contrast of text and of focus rings against their surfaces **for all six accents** (script it; the tokens are in `styles.css`), muted text on every surface, accent-as-text on dark, the disabled look; target sizes; zoom to 200% and reflow at 320 px on the phone UI. If `@axe-core/playwright` is installed (`node_modules/@axe-core/playwright`), run it on the main screens of both roles and report what it finds (and what it cannot see: it cannot judge D-pad flows).

## U1: User flows, pathing, missing buttons: TV (report `U1-flows-tv.md`)

Task-based. For each task below find the shortest route, count the steps, then **run it** and note every dead end, missing button, unclear label, lost state, surprise, error path:
first visit → welcome → home; find a film by browsing / by search / by category; open a title; play; resume from Continue; next / previous episode and episode list while playing; audio, subtitles, speed; Favourites and your own lists (add, remove, rename, delete); rate and note; pair a phone (code and QR); switch TV / unpair; sign up / sign in / sign out; profiles (switch, add, edit, delete); friends (add, accept, view, settings); party (host, join, leave, invite); settings (language, playback, link box, look); leaving the player; Back from every page; the library failing / empty search / no history / no ratings / offline / slow network; full screen on and off.
**Missing buttons**: for every screen, ask "what would a user want to do here that has no visible control?" (Back, Close, Cancel, Undo, Remove, Home, Settings, Sign out, Retry, Clear, See all, Edit...) and say which exist. **Pathing**: is there more than one way to the same place, are they consistent, are there places you can enter but not leave. Deliver the list of **behaviour bugs** with exact repro steps, separately from design issues.

## U2: User flows, pathing, missing buttons: phone (report `U2-flows-phone.md`)

Same method for the phone: open the site → pair (code, QR scan, My TVs) → home; play a pasted link; browse / search → title sheet → play on the TV; the remote while playing (seek, skip, speed, tracks, stop, change video, full screen; note the layout: where the thumb is vs where the controls are); lists; rate; account (sign in / up, profiles, devices, security, friends, ratings, settings); party; My TVs (switch, forget); TV offline / connection lost / server waking up; the phone's Back (browser Back, the sheets' close buttons, swipe-down); first run vs returning; the home-screen install; language change; the bell.
Same deliverables: dead ends, missing buttons, lost state, behaviour bugs with exact repro steps (separate list), and a **screen graph** of the phone UI.
