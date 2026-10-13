# Reference principles

What "good" looks like for a TV / phone / desktop streaming UI, boiled down to rules Kino can be tested against.
**Principles, not copies**: nothing here says "look like Netflix". Every rule ends in something that can be measured or checked
(by the drift scanner, a Playwright test, or a screenshot comparison).

Where a number comes from is marked: **[official]** read on the vendor's page in this session, **[article]** a published design article,
**[memory]** my own knowledge, not re-read today (treat as "check before relying"), **[Kino]** a decision for this product.

## 1. TV (10-foot, D-pad remote)

| # | Principle | Source | What it means for Kino | How it is checked |
|---|---|---|---|---|
| T1 | **Focus is the interface.** One focus language everywhere, never colour alone: scale (about 1.05-1.1), a ring, a brightness/contrast change. | [article](https://smashingmagazine.com/2025/09/designing-tv-principles-patterns-practical-guidance/): scale, background inversion, border, combined; high contrast between focused and not. WCAG 2.2 2.4.13 (AAA): ring at least 2 CSS px and 3:1 against the unfocused look [memory] | Today `.tv-btn:focus-visible` = 0.2em white outline + 1.08 scale. Strong; keep the idea, make tiles, chips, rows, rail items and menu rows use the *same* tokens. | drift scanner (every `[data-nav]` has a focus rule from the shared set), TV acceptance test (focus visible on every stop) |
| T2 | **Critical things stay in a safe margin; backgrounds bleed.** | [official] Android: 5% = 48 dp on left/right, 27 dp top/bottom of a 960x540 dp canvas, "don't clip background elements". [official] LG webOS: 20 px margin, selectable objects, text and logos inside. Apple: 80 pt sides / 60 pt top-bottom on 1920x1080 [memory/secondary] | Keep text and controls at least 2.5% from the left/right edge and 5% from top/bottom *at 1280, 1920, 3840*; the hero backdrop may run to the edge. | scanner: bounding box of every focusable and text node inside the inset on the TV walk sizes |
| T3 | **Type is large, simple and a small set.** Start about 24 px at 1080p; 5-6 sizes; medium weight or heavier on dark; no light/thin fonts. | [official] Android: light text on dark, avoid lightweight fonts, sans-serif; no numeric minimum on that page. [article] 24 px start, 5-6 sizes, "when in doubt, go larger". | Existing e2e guard: smallest visible text >= 1.15% of the page width (22 px at 1080p). Keep it and add: sizes come from a named scale; weights 500+ on the TV. | e2e guard (exists) + scanner (distinct font sizes / weights on TV) |
| T4 | **Each axis has one job**: vertical = between groups, horizontal = within a group. A persistent side rail, Back always one step out. Every screen has a defined first focus; the last position is remembered when you come back. | [article] one role per axis, side menu + Back shortcut. [official] Android: navigation at the side, no top action bars or pull-down menus, no swipe-only. | Kino's rail + rows already do this. Audit E checks every page for: first focus, reachable everywhere with D-pad only, Back = one step out, no focus traps. | TV acceptance test (D-pad walk), audit E |
| T5 | **Presses are the currency.** Every action costs a press; typing is the worst offender. Long-press for secondary actions. | [article] "hey there" = about 38 presses on a TV vs 9 on a phone; long-press for context. | Typing goes to the phone (already), search is on-screen/typed on keyboards; hold-to-list exists. Count presses to the 10 most common tasks (play next episode, add to list, change profile...) and cut any that are > 3. | audit E press-count table |
| T6 | **Dark room, quiet palette.** No large pure-white surfaces; colour (the accent) is for focus and the one primary action. | [article] muted palettes, bright colour sparingly for focus. | Surfaces stay on the existing near-black scale; accent only on primary + selected + focus accents. All six accents must pass contrast on the surfaces. | scanner contrast table for six accents |
| T7 | **Let the next item peek.** The last visible tile in a row is cut by the edge, signalling "more". | [article] | Rows already scroll; verify the cut tile shows at all sizes (no row ends exactly on the edge). | screenshots, TV test |
| T8 | **Motion is short and cheap**: focus moves in about 120-200 ms, only transform/opacity, nothing that re-lays-out the page; honour reduced-motion. | [memory] | Audit G lists every transition/animation; old TV browsers are slow, so no filters/blur on big areas. | audit G |

## 2. Phone (touch)

| # | Principle | Source | Kino |
|---|---|---|---|
| P1 | Touch targets are at least 44x44 CSS px (Apple), 48 dp (Material); the WCAG 2.2 *floor* is 24x24 (2.5.8, AA). | [memory] | Audit C measures every `button, a, [role=button]` on the phone walk; < 44 px is P1 unless inline text. |
| P2 | Respect the safe areas (`env(safe-area-inset-*)`) and the browser bars; no `100vh` traps. | [memory] | Check header/bottom bars on notch phones (emulate), fixed bars do not hide focused content (WCAG 2.4.11, AA). |
| P3 | Reflow: no horizontal scroll at 320 CSS px wide; text can grow 200% without loss. | WCAG 1.4.10 / 1.4.4 [memory] | Walk at 320 and 360 px; scanner flags any element wider than the viewport. |
| P4 | Primary actions in thumb reach, the destructive one never next to the common one; gestures (pull-down, hold, double-tap) always have a visible alternative. | [memory] | The phone sheet pull-down, hold-to-list and double-tap-skip need buttons too (most exist; audit H/C confirm). |

## 3. Desktop (mouse + keyboard)

| # | Principle | Kino |
|---|---|---|
| D1 | Hover may *reveal*, never be the only way (touch and keyboard parity). | Quick-add on hover has a keyboard path; audit C verifies. |
| D2 | A visible keyboard focus ring on every control: a two-layer ring (inner dark, outer light, or inner light + accent) reads on any surface. | Built with `box-shadow`/`outline` only (no `color-mix`, no `:has`, see the compatibility rule). |
| D3 | Wider screens get more columns, not bigger things; max content width so lines stay readable. | Browse grid column counts per breakpoint; the TV layout on a desktop browser keeps the `--em` scale. |

## 4. The visual system underneath (all three)

1. **One spacing scale** (4/8 based), **three radii** at most (small, medium, pill), **one elevation language**: on dark UIs a surface is "higher" by being slightly *lighter* plus a hairline border (`rgba(255,255,255,.06-.10)`), shadows only for overlays.
2. **One state language**: hover = a faint lightening, pressed = a bit more, selected = accent, focus = the ring. Same percentages in every component.
3. **One icon grid**: the existing 24-unit, stroke-2, round-cap family; icon-only buttons have an accessible name and (on pointer devices) a tooltip. Optical size: icon height = 1.0-1.25 x the text next to it.
4. **Hierarchy by size, weight and colour, not by boxes.** Fewer borders, more space.
5. **Designed states**: loading (skeleton, not a bare spinner where layout is known), empty (one sentence + one action), error (what happened + how to retry), offline.
6. **Contrast**: text 4.5:1 (3:1 for 24 px / 18.66 px bold), UI parts and focus rings 3:1 (WCAG 1.4.3 / 1.4.11 [memory]) - measured for all six accents, not just the default.
7. **Copy**: short, specific, verbs on buttons ("Add to list", not "OK"). All text lives in `i18n` (en/ro/it, key parity is a test).

## 5. Things I looked up and could not confirm

* Apple's own tvOS HIG page returned only its title through the fetch tool, so the 80/60 pt margins, the 29 pt minimum text and the 1.05-1.1 focus scale rest on a secondary summary and my memory. They match the other sources closely enough to use as a *target*, not as a rule to cite.
* Android's layout page gives no numeric minimum text size or target size; LG's old guideline defined font sizes in a PDF that was not read. So the "smallest text >= 1.15% of the width" guard that already exists in the tests stays the authority for TV text.

## Sources

* Android: [Build TV layouts](https://developer.android.com/training/tv/playback/compose/layouts) (overscan 48 dp / 27 dp, light-on-dark text, D-pad, side navigation)
* LG: [webOS TV overscan guide](https://webostv.developer.lge.com/develop/guides/overscan) (20 px safe margin)
* Smashing Magazine: [Designing for TV, part 2](https://smashingmagazine.com/2025/09/designing-tv-principles-patterns-practical-guidance/) (focus styles, one role per axis, type scale, peeking last item, press cost)
* W3C: [WCAG 2.2](https://www.w3.org/TR/WCAG22/) (2.4.7, 2.4.11, 2.4.13, 1.4.3, 1.4.10, 1.4.11, 2.5.8)
