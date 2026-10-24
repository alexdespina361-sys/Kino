# Phone layout: research

What real phone apps and the platform guidelines do, boiled down to rules the Kino phone UI can be built and tested against.
Read this before `AUDIT.md` (what is wrong today) and `PLAN.md` (what is built). Rules here are numbered **R1..R15** and the plan cites them.

## How this was done, and what it cannot claim

* The built-in web search was **refused** ("search budget used up, shared by every agent"). I did not work around it (no search engines through the browser or curl). Everything below comes from pages I opened by address, so "what Netflix changed in 2024" is **not** covered; what the apps look like today is read off their store listings.
* Three kinds of reading, marked per source:
  * **[read]** the page text read in the built-in browser pane (verbatim, quotes are real).
  * **[extract]** the fetch tool's extract of the page: a small model's summary of the page, not verbatim. Good for the claim, not for a quotation. Where the extract admitted it saw only a page title, that source is marked **[memory]**.
  * **[shots]** the Play Store screenshots of an app, looked at one by one in the browser pane. They are **marketing images**, not a guaranteed picture of the live app. I use them only to see which patterns are common, never as a spec.
  * **[memory]** things I know but did not re-read today. Treated as a target to check, not as a rule to cite.
* No app was installed or run (an APK download is not mine to start, and there is no phone here). Nothing below is from using the real apps.

## Sources

| Source | How | What it gave |
|---|---|---|
| Material 3, [navigation bar guidelines](https://m3.material.io/components/navigation-bar/guidelines) | read | 3 to 5 destinations; bottom; icon + 1-2 word label always; filled icon when active; one active indicator; contrast 3:1; do not scroll/modify destinations; **do not swipe between destinations**; re-selecting the active one scrolls to top; preserve or reset state per destination (pick per product); may be covered temporarily by dialogs, sheets and the keyboard but "should not be permanently obstructed on any screen"; hide-on-scroll allowed but not with a screen reader on; only for compact and medium widths |
| Material 3, [navigation bar specs](https://m3.material.io/components/navigation-bar/specs) | read | the baseline bar is "no longer recommended" in favour of a shorter flexible bar; vertical items (icon above label) in compact windows, horizontal in medium. Exact dp heights are **not** on the page text I got ([memory]: baseline was 80 dp) |
| Material 3, [bottom sheets](https://m3.material.io/components/bottom-sheets/guidelines) | read | **modal sheet capped at 50% of the screen height at first**, can be pulled to full height; standard (non-modal) sheet "such as an audio player in a music app" lives beside the main UI; dismiss by item, scrim, swipe, or a close affordance, "display a close affordance in a full-screen modal bottom sheet"; drag handle optional but then a single-pointer alternative is required (tap cycles heights/closes); extend to the full width on mobile |
| Material 3, [app bars](https://m3.material.io/components/app-bars/guidelines) | read | app bars hold "1-2 essential actions"; **"avoid placing an overflow menu in the app bar when possible"**; search app bar: up to **two** trailing icons with an avatar, "don't use three icons and an avatar"; headline not truncated; the leading element is a logo or Back |
| Material 3, [carousel](https://m3.material.io/components/carousel/guidelines) | read | hero layout for a spotlight (movie, show) "with a sneak peek of what's next"; uncontained for text-heavy items; at compact widths "up to three items" at once; items must stay recognisable; "no more than two lines of text"; **on vertical pages a carousel needs a "Show all" way to a vertical list** (or an arrow on the header) |
| Material 3, [search](https://m3.material.io/components/search/guidelines) | read | if search is the primary action it can be **a standalone destination reached from the navigation bar**; full-screen layout on mobile; suggestions before typing; filter chips to narrow results |
| Material 3, [canonical examples](https://m3.material.io/foundations/layout/canonical-examples/overview) | read | feed / list-detail / supporting pane, each with compact, medium, expanded layouts (the plain /canonical-layouts address 404s; the site redirects here) |
| Material 3, [accessibility: designing](https://m3.material.io/foundations/designing/structure) | read | **touch targets at least 48 x 48 dp (about 9 mm), 7 to 10 mm recommended**, iOS uses 44, pointer targets 44; **8 dp between targets**; "important actions at the top or bottom of the screen" |
| Material 3, [type scale](https://m3.material.io/styles/typography/type-scale-tokens) | read | Major Second scale with **14 as the key base size**; "avoid changing the type size" when customising. Body large 16 / label sizes are [memory] (the page was cut off) |
| Android, [window size classes](https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes) | extract | width: compact < 600 dp (99.96% of phones in portrait), medium 600-840; height: **compact < 480 dp (99.78% of phones in landscape)**; width matters most because pages scroll vertically, height matters for landscape phones |
| Android, [navigation principles](https://developer.android.com/guide/navigation/principles) | extract | fixed start destination; Back pops the stack and from the start destination leaves the app; Up never leaves the app. The page says **nothing** about tabs; the "Back from another tab goes to the start tab, tab switches do not pile up the stack" practice came from the extract's memory of other pages, [memory] |
| Apple HIG, [tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) | read | navigation not actions; **keep the tab bar visible** except under a modal; few tabs, avoid overflow ("More") tabs; **don't disable or hide tab bar buttons, even when content is unavailable: explain why a section is empty**; labels, single words; badge only for critical info; "a tab bar with an attached accessory, like the **MiniPlayer in Music**" (the page is dated June 2026) |
| Apple HIG, [sheets](https://developer.apple.com/design/human-interface-guidelines/sheets) | read | one sheet at a time (close the first before showing the second); "for complex or prolonged flows consider alternatives to sheets"; medium detent is about half height; **grabber** also works with VoiceOver and a tap cycles detents; support swipe down to dismiss |
| Google, [Cast design checklist, sender](https://developers.google.com/cast/docs/design_checklist/sender) | extract | **mini controller**: a bar near the bottom of the app, shown while casting, "persists across all screens except the expanded controller", tap opens the **expanded controller** (title or artwork, seek bar with elapsed on the left and total on the right, relevant controls only); leaving the controller must not stop the cast; volume by hardware keys and/or a slider; "Stop Casting" on one sender does not touch the others |
| NN/g, [bottom sheets](https://www.nngroup.com/articles/bottom-sheet/) | extract | keep sheets for short interactions; **"don't show an e-commerce product-detail page in a sheet"**; support Back; **visible Close button** (a swipe or a grabber alone is easy to miss and hard for some people); **avoid stacking**; the claim that sheets improve reachability is "largely incorrect: the middle of the screen is easiest"; the article gives no height number |
| NN/g, [mobile navigation patterns](https://www.nngroup.com/articles/mobile-navigation-patterns/) | extract | tab bars persist, work with few options (more than 5 does not fit at a good target size), 4 to 5 can all be shown; hamburger menus hide options ("out of sight is out of mind") and suit browse-mostly sites. Dated 2015, no metrics |
| NN/g, [touch target size](https://www.nngroup.com/articles/touch-target-size/) | extract | **at least 1 cm x 1 cm**; about 2 mm between targets; small, crowded and mouse-made targets (carousel dots) fail |
| NN/g, [carousels](https://www.nngroup.com/articles/designing-effective-carousels/) | extract | people scroll past them; 5 or fewer frames; **bleed the next item off the edge**; no auto-advance on mobile; dots are a weak cue |
| W3C, [WCAG 2.2 SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | extract | pointer targets at least **24 x 24 CSS px** unless spaced out (24 px circle test), inline text, an equal alternative, or essential. The "44 px, 2.5.5 AAA" figure was **not** on that page ([memory]) |
| Smashing, [the thumb zone](https://www.smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users/) and UXmatters, [Hoober 2013](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php) | extract | 49% of 780 observed people used one hand and a thumb (36% cradled, 15% two hands); frequent actions in the easy zone. **Caveats**: 2013 data, phones up to a Galaxy Note 2, and Hoober himself asked in 2017 that readers "ignore" the reach drawings because people mostly touch the middle of the screen |
| Play Store listings of Netflix, Disney+, Prime Video, Crunchyroll, Plex, Jellyfin, YouTube Music, Tubi, Max | shots | see the table below. Max showed only part of its listing, Tubi only its header screens |

### What the store screenshots showed (patterns only)

| App | Bottom navigation | Home / browse | Title page | Other |
|---|---|---|---|---|
| Netflix | 4 labelled tabs: Home, Clips, Search, My Netflix (profile avatar) | top bar: title, cast, download, bell; a row of filter chips (Shows, Movies, Games, New & Hot); one big hero card with **Play + My List** buttons; rows of portrait posters with "See All" | (a sheet-like popup with thumbs "Not for me / I like this / Love this!") | My Netflix page: "My List" and "Moments You've Saved" rows |
| Disney+ | 4 icon tabs: Home, Search, Downloads, Profile | a hero; a **3-column grid of portrait posters** behind a round Back button | | |
| Prime Video | 5 icon tabs (Home, Prime, a round icon, Downloads, Search) | chips (Movies, TV Shows, Sports, Live TV); hero banner; "Trending now >" rows of portrait posters | hero image, Back and cast icons on it, **full-width Play button + a Download icon button, icon-and-label action row (Trailer, Watchlist, Like, Not for me)**, tabs Episodes / Details / Explore / Related, a season dropdown, episode rows with a still | search results as a 3-column poster grid |
| Crunchyroll | 5 labelled tabs: Home, My Lists, Browse, Simulcast, Account | Browse: **2-column grid of portrait posters** | close button on the image, **full-width "Start watching S1 E1" + a square bookmark button**, then "My Lists" and "Share" as icon-over-label | top bar: cast and search icons only |
| Plex | 5 labelled tabs: Home, Libraries, Live TV, On Demand, Discover | search, cast, avatar on top; chips (Trending, Activity, People); portrait rows | | |
| Jellyfin | none (a top app bar with cast, search, user and two tabs, Home / Favorites) | "My Media" cards, portrait rows | backdrop with a big Play, then an **icon-over-label action row (Trailer, Watched, Favorite, More)**, then Cast and crew and "More like this" rows | |
| YouTube Music | 4 labelled tabs | chips on top, rows of covers | | **a mini player strip sits directly above the tab bar** while something plays; it opens a full now-playing screen with the seek bar and a large play button |
| Tubi | (not visible in the header shots) | | full-bleed art with round Back and share buttons; a pill-shaped yellow primary button | rows of portrait posters bleeding off the edge |
| Max | (not visible) | top bar with a menu icon, logo, cast, bell, avatar (**five items**: the busiest I saw); hero carousel with dots and a row below it | | |

This is a small, unscientific sample; it agrees with the guidelines on the big points and nothing more is read into it.

## Rules the plan builds on

* **R1. A bottom bar of 4 to 5 labelled destinations is the shell** (M3: 3 to 5, icon + 1-2 word label; Apple: visible everywhere except under a modal; NN/g: persistent, fits 4 to 5 at a good target size; 6 of the 9 apps in the sample, with Jellyfin using a top bar and tabs, and Tubi and Max not showing theirs in the pictures I saw). No hamburger/drawer (NN/g: hidden options go unfound).
* **R2. Never disable or hide a destination; explain an empty one** (Apple). So a Remote tab with nothing playing shows what it is for and how to start something, not a greyed icon.
* **R3. A tab switch is not a push.** Re-selecting the current tab scrolls it to the top (M3); tabs keep their own state, no swiping between destinations (M3), and Back from another tab goes to the first tab, Back from the first asks before leaving (existing Kino rule, matches the Android practice [memory]).
* **R4. While something is playing, a mini remote sits directly above the bar** (Cast mini controller: persists on every screen except the full controller, tap opens it; Apple MiniPlayer accessory; YouTube Music) and opens the full remote ("expanded controller": title, seek bar with elapsed left / total right, large play, skip, relevant controls only).
* **R5. The top bar carries at most two trailing actions and the avatar; no overflow "..." menu** (M3 app bars, search app bar rule). Everything that used to sit behind "..." gets a real home (a TV chip, the Profile tab).
* **R6. Search is a destination, full screen on a phone, with filter chips** (M3 search; Netflix, Disney+, Prime, Crunchyroll all have a Search tab).
* **R7. Portrait posters, not wide stills, with the next item bleeding off the edge** (NN/g carousels; every app in the sample; M3 carousel: about three items at compact width, at most two lines of text). Every horizontal row has a way to the vertical list ("See all", M3 "Show all").
* **R8. A title is a page, not a sheet** (NN/g: do not show a product-detail page in a sheet; Apple: consider alternatives to sheets for prolonged flows). Layout from Prime/Crunchyroll/Jellyfin: picture on top with a Back button, **full-width primary button**, an icon-over-label action row, season picker, episode rows, related.
* **R9. A sheet is for a short choice.** At most **half the height at first** (M3: 50%, Apple: medium detent), a grabber **and** a visible Close (NN/g, M3), Back closes it (NN/g), one sheet at a time (Apple, NN/g). Taller content gets a page, not a taller sheet.
* **R10. Targets: at least 48 px in the bottom bar and on every control a thumb lands on, 44 px as the absolute floor, 8 px between neighbours** (M3 48 dp and 8 dp; Apple 44; NN/g 1 cm; WCAG 2.5.8 is only the 24 px legal floor).
* **R11. Type: body 16, secondary 14, nothing under 12** and labels that are not all-caps (M3's base is 14; [memory] for 16/12). Lines that matter (titles) are not truncated in headers (M3 app bars).
* **R12. Landscape phones (height < 480 dp) get a side rail, not a bottom bar** (Android height class "compact", M3: "medium width: bar or rail, decide by whether horizontal or vertical space is more important") and no stacked bars that eat the short height.
* **R13. Do not lean on the thumb-zone story.** The sources disagree with the folklore (NN/g: the middle is easiest, bottom sheets do not help reach; Hoober retracted his maps). The bottom bar is justified by convention and by M3/Apple, not by reach science; no control is moved only "for the thumb".
* **R14. A carousel does not auto-advance, dots are not the only cue** (NN/g), a hero is one static card.
* **R15. Gaps stay gaps.** The Cast checklist asks for a volume control while casting; Kino's protocol has no volume command (`src/shared/protocol.ts`), so it is **not** built and is listed as a gap (volume is on the TV's own remote).

## Patterns considered and left out

| Pattern | Why not |
|---|---|
| Netflix "Clips" / full-screen vertical feeds (M3 full-screen carousel) | there is no short-video source; scope |
| A Downloads tab | no downloads in Kino |
| Hamburger / modal drawer | R1; hides options |
| Swipe between tabs | M3 says no; would fight horizontal poster rows |
| Hide-the-bar-on-scroll | M3 allows it but not with a screen reader; the bar is only about 56 px and a persistent bar is simpler and safer to verify |
| Auto-advancing hero with dots | R14 |
| Pull-down "cast dialog" with volume slider | R15 (no volume command) |
| Making the phone a "cast button" in the top bar copy of Google Cast | Kino pairs by code or QR; the TV chip below plays the same role (shows connected/not, opens the TV sheet) without claiming to be Google Cast |
| Thumb-zone heat map as a design rule | R13 |

## Not checked (be careful quoting)

* Exact Material bar heights, the 16/12 px type sizes, Apple's 44 pt hit region and WCAG 2.5.5's 44 px AAA figure: [memory] or a fetch-tool recollection, not read on the page.
* Android's Back behaviour for bottom-bar tabs: the page read is silent; the plan relies on Kino's own written rule (`docs/android-back.md`) and the e2e specs for Back.
* Anything about how the apps behave (animations, gestures, density): only store pictures were seen.
