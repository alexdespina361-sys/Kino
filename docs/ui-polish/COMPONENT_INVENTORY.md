# Component inventory

What the interface is made of, by family: where it is written, how many places use it (a count of uses in the `.tsx` files, not of what is on a screen at once), which states it has, and what is repeated that could be one thing. The screens themselves are in [SCREEN_INVENTORY.md](SCREEN_INVENTORY.md); the values (sizes, colours, curves) are in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).

Three kinds of code draw the site: **shared** (`src/client/shared`, used by both), **TV** (`src/client/tv`, a screen driven by a remote, a keyboard or a mouse: sizes in `em` of the screen's width) and **phone** (`src/client/controller` and `account`: touch, sizes in px). A desktop browser with no touch gets the TV; a phone gets the remote.

## Shared

| Piece | File | Used | What it is |
|---|---|---|---|
| Icons | `shared/icons.tsx` | everywhere | one family: 24-unit grid, stroke 2, round caps, `currentColor` |
| `Logo` / wordmark | `shared/Logo.tsx` | TV top left, phone pair screen | the name and the disc; never moves on the TV (D24) |
| `Poster` | `shared/Poster.tsx` | phone lists, end card | a picture on the colour of the title's name, the first letter if there is none; `comesIn` fades a late picture in (D31) |
| `ScoreBadge` | `shared/ScoreBadge.tsx` | tiles, lists | the rating's star and number, over a picture |
| `QrCode` | `shared/QrCode.tsx` | pairing, friend invite, party link | an SVG QR code with a label |
| `CopyLink` / `CopyCode` | `shared/CopyLink.tsx` | link boxes, codes, tags | the text (selectable) and a Copy button that says it copied; a browser that refuses says so and selects it (D21) |
| `FullscreenToggle` | `shared/FullscreenToggle.tsx` | TV corner, phone menu | enter / leave full screen; `labels` adds the words (phone menu) |
| `RoleSwitch` | `shared/RoleSwitch.tsx` | phone menu | "Watch on this device" and back |

## TV

| Family | Classes / components | Uses | Variants | States it has | Notes |
|---|---|---|---|---|---|
| **Page** | `Screen` (`.tv-screen`, wordmark), `BackButton` (`.tv-action.tv-back`) | every full-screen page | `compact` | the remote lands on the first button or the one marked `data-autofocus`; Back = one step out | one Back pill, one place (D20) |
| **Page button** | `.tv-action` | 48 | primary (accent, 22), danger, `aria-disabled` (a list already at its end), start-aligned group | focus (light, dark words, ring), hover, pressed 0.96, disabled 40 % | the one button of a page |
| **Control button** | `.tv-btn` (+ `-icon`, `-label`, `-text`, `-sub`, `-red`, `-on`) | 25 (+10 icon) | icon-only (says its name when focused), with a label, on/off | focus, hover, pressed, on | the player's bar and menus |
| **Banner button** | `.tv-hero-button` | 5 | primary (accent) / secondary | focus, hover, pressed | the banner's Play / Resume and the list button |
| **Corner button** | `.tv-corner-button`, `.tv-account-chip`, `.tv-bell` | 3 | icon, icon + name, with a count | focus (lit + ring + 1.05), hover, pressed | the library's top right: full screen, bell, profile |
| **Big choice** | `.tv-party-choice` | 5 | | focus, hover, pressed | start / join a party |
| **Choices** | `.tv-choice` in `.tv-choices` | 12 | one of three words (languages), a score scope | focus, hover, **chosen** (accent tint + ring) | |
| **Colour** | `.tv-swatch` in `.tv-swatches` | 6 per page | the six accents | focus (ring + 1.22), **chosen** (tick + ring) | |
| **Switch** | `.tv-switch-row` + `.tv-switch` | 3 (many on a page) | label + knob | focus, hover, on (accent) / off (grey groove) | the phone's `.switch-row` is the same idea |
| **Score** | `.tv-score` | 10 per page | | focus, hover, **chosen** (accent fill) | the rating page |
| **Keyboard key** | `.tv-key` (+ `-wide`) | 9 | letters, ◀ ▶ ⌫ ⊗ Space | focus, pressed | 1.1 : 1 (D22); a caret search (`SearchField`) |
| **Menu (side)** | `.tv-rail`, `.tv-rail-item`, `.tv-rail-group` | 1 | shut (icons), open (27.8 em panel, dims the page) | focus (lit), current (accent bar), hover | carries the wordmark in the same place (D21) |
| **Menu (player)** | `.tv-menu`, `.tv-menu-col`, `.tv-opt` | 9 options | audio and subtitles, speed, quality, party | focus, **chosen** | opens on the chosen row; Back returns to the button that opened it |
| **Tile** | `.tv-tile` (+ `-wide`, `-ranked`, `-continue`, `-category`, `-person`, `-place`), `.tv-tile-art`, `.tv-tile-name`, `.tv-tile-year` | `Browse.tsx` (3 places) | wide picture, upright with a numeral, with a progress bar, a category, a person | focus (ring + lift + 1.05 on the picture), hover (the corner button appears), kept (accent corner) | picture on a colour, late pictures fade in |
| **Row** | `.tv-row`, `RowTiles`, `.tv-row-title`, `.tv-row-tiles` | 2 + the grid | scrolls sideways; `.tv-grid` wraps | arrows at the side that has more (pointer only) | D27 |
| **Episode** | `.tv-ep`, `EpisodeRow` | seasons page | now / new / started / watched | focus (light row, own small words), hover | |
| **Text** | `.tv-headline` (27) `-small` (20), `.tv-lead` (25), `.tv-hint` (12), `.tv-caption`, `.tv-notice` (`.is-problem`) | | | | sizes from `--fs-1..7` |
| **Field** | `.auth-field`, `.tv-field`, `.tv-link-input`, `.tv-query` | 4 + 2 + 2 + 2 | text, password (eye), search with a caret | focus, error line | typing is on the phone by design |
| **Code / QR** | `TvCode`, `.tv-code`, `.tv-link-code`, `.tv-qr` | 8 | pairing, sign-in, party | selectable, Copy | |
| **Feedback** | `.tv-toast`, `.spinner` (12), `.tv-qr-wait`, `.is-problem` | | | | a toast above everything for a moment |
| **Player** | `.hud-*` (`Hud.tsx`) | 1 | controls, progress bar with a draggable dot, up next, end card | focus, hover, pressed; the bar and the picture answer a mouse as a finger (D23) | |

## Phone

| Family | Classes / components | Uses | Variants | States | Notes |
|---|---|---|---|---|---|
| **Button** | `.btn` (68), `.btn-block` (38), `.btn-red` (19), `.btn-danger` (11), `.btn-sm` | | primary (accent), plain, danger (red words, red fill only while asking), small (44) | pressed 0.97, disabled (grey, not half accent), focus-visible | 48 px, 44 when small; leaving is never accent (D20) |
| **Icon button** | `.icon-btn` (5), `.round` (4, the remote's), `.state-action` | | | pressed, focus-visible | 44 px |
| **Chip / choice** | `.chip`, `.choice` (9) in `.choices`, `.cap-choice` (5), `.lib-pill`, `.season`, `.segmented` | | one of N | pressed, **chosen** (accent tint + ring) | sheets lay two options to a row sideways |
| **Colour** | `.swatches` (a card), `.swatch` | 6 | | pressed, **chosen** (white ring) | |
| **List (card)** | `.menu` (6) + `.menu-row` (4) (`.menu-icon`, `.menu-label`, chevron), `Rows` | | places (chevron), switches, a mix | pressed (`--surface-3`), focus-visible (inset ring) | one card, hairlines between rows, 52 px rows (44 sideways); D28 |
| **Switch row** | `Switch` → `.switch-row` + `.switch` (+ `.has-hint`) | | with the words of what it does inside the row | pressed, on / off | the words and the hint are inside the one button |
| **Rows of things** | `.friend-row`, `.inbox-item`, `.rating-item`, `.episode`, `.lib-card` / `.lib-art`, `.lib-result-*`, `.device-list li`, `.language-list li` | | | pressed, kept | each has its own markup; the shared part is the card tone and the 12 px corner |
| **Sheet** | `Sheet` (`.sheet`, `-grip`, `-head`, `-body`, `-section`) | ~20 | from the bottom (portrait), centred up to 520 to 780 px (wide) | opens on the curve, pulls down to close (a pull on a scrolled list scrolls the list), Escape | surfaces one step lighter than the page |
| **Page** | `Page` (`.page`, `-head`, `-body`, `-stack`), `Group` (title + help) | 9 | | slides in on the curve, Back | |
| **Card** | `.code-card` (`-top`, `-code`, `-title`), `.banner` (8), `.account-card`, `.friend-code-card`, `.your-tag` | | | | one Copy button per code, 44 px beside a code |
| **Field** | `.field`, `.auth-field` (6), `.code-input` (5), `.link-code-input`, `PasswordInput` (`.secret`) | | | focus ring, error (`.auth-error`, 13) | 16 px type so a phone does not zoom into it |
| **Remote** | `.now-playing`, `SeekBar`, `.round`, `.state-action`, `.chip` row | 1 | | pressed; the bar's dot drags | |
| **Feedback** | `.toast`, `.spinner` (16), `.badge`, `.muted` (73), `.auth-error` | | | | |

## Same thing, written more than once (candidates for one primitive)

None of these is a bug; each is a place where a change has to be made twice. They are listed so that the next change that touches one can merge it, and are **not** merged here because merging changes no pixel.

1. **TV buttons**: `.tv-action`, `.tv-btn`, `.tv-hero-button`, `.tv-corner-button` / `.tv-account-chip` are four class names for one idea (a button that lights white and lifts when the remote is on it). They share the focus tokens, the corner `--r-2` and the pressed scale; what differs is the size and where they live.
2. **Switch**: the TV's `.tv-switch-row` and the phone's `.switch-row` (same states, different units).
3. **Chosen** on a TV choice, a swatch, a score and a phone choice, chip and segment: one rule in the design system (accent tint + ring), five selectors.
4. **Phone buttons**: `.btn`, `.field-btn`, `.mini`, `.state-action`, `.round` differ in size only.
5. **Rows of things** on the phone: the card tone, corner and pressed colour are repeated per list.
6. **Old and refined sheets**: every rule of the refined layer overrides an older one; merging the two into one set of sheets changes no pixel (D18).

## States every interactive family is checked for

Focus (remote, key) · hover (pointer) · pressed · chosen · disabled · loading (a spinner, or the colour under a picture) · empty (one sentence and one action) · error (what happened and how to retry) · offline (the server is waking up; pairing lost; library failed). The keys walk (`scripts/ui-walk/tv-keys.mjs`) proves a remote has something lit on 23 TV screens; the drift scanner (`scripts/ui-walk/scan.mjs`) lists targets under 44 px, small text, and off-token sizes on the TV and the phone.
