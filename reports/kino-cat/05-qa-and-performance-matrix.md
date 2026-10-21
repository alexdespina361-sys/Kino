# 05 · QA and performance matrix

Everything below was run on **2026-10-21** (the final pass, at the head the branch ends on) on the author's machine unless it says otherwise. "Measured" means a number came out of a command listed here; "not tested" means exactly that. Where this report disagrees with an earlier version of itself, the earlier version was wrong or measured something that has since been fixed; ISSUE_LOG says which.

## Where it was run

| Item | Value |
|---|---|
| Machine | AMD Ryzen 9 5900X (12 cores / 24 threads), 32 GB, NVIDIA GeForce RTX 3090, Windows 11 Pro 10.0.26200 |
| Node / test tools | Node 24.15.0, Vitest 5.0.3, Vite 8.3.4, TypeScript 7.0.2, Playwright 1.64 |
| Browser | Chromium 156.0.8078.4 (Playwright's), headless |
| **Real GPU path** | `chromium.launch({ channel: "chromium", args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] })` → `ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 Direct3D11 vs_5_0 ps_5_0)`. The page ran at 129 Hz (the display's rate), not 60. |
| **Software GL path (worst case)** | the default headless Chromium, `--use-angle=swiftshader`: all drawing on the processor. Used on purpose as a stand-in for a weak TV's graphics; it is **not** a measurement of any real TV. |
| Server | the branch's own server (`CAT_COMPANION=on`) on localhost; library data from the test fixtures (`scripts/ui-walk/seed.mjs`) |

The real GPU is a very strong one. It says what the cat costs where the graphics are not the limit (and shows the timing probe does no harm there); it says nothing about a Fire Stick or a TV.

## Automated checks

| Check | Command | Result |
|---|---|---|
| Types | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | clean |
| Unit (cat engine, rig, GL, host, settings, i18n, server flag) | `node node_modules/vitest/vitest.mjs run src/client/cat src/client/i18n/cat.test.ts src/server/features.test.ts` | **124 passed in 8 files** (7.8 s) |
| End to end | `$env:pnpm_config_verify_deps_before_run='false'; node node_modules/@playwright/test/cli.js test e2e/cat.spec.ts --reporter=list` (set `E2E_PORT` to a free port) | **26 passed in 2.8 min** (the file rebuilds `dist/client` first) |
| Soak of the brain | `node node_modules/tsx/dist/cli.mjs scripts/cat/soak.mts 13 162 600` (7 variants of a bad afternoon: scroll, resize, menus, films, touch, route changes, hidden tab, 20/60 fps, reduced motion, quiet, names on the page; 10 virtual minutes each) | **1,050 sessions (150 seeds × 7 variants), 0 violations, 87 s.** The first run of the soak (50 seeds × 7) found 6 bad sessions, a settled cat with its tail off the screen: ISSUE_LOG #39, fixed in `fa5b509`; the same soak is clean at this head |
| Lifecycle | scratch script: 25 on/off cycles of the cat on the library page, then the panel | every cycle leaves exactly one cat and one canvas and nothing behind when off; JS heap 9.5 MB at the start, 9.8 MB after 25 cycles, 10.1 MB with the panel open (no growth worth the name); DOM nodes constant (677) |
| Mutation checks | switched `restSpot` off, then the engine's use of it; set the weight of "a title the library chose for the viewer" back to 1 | 4 resp. 1 tests failed in the first two, the new recommendation test failed in the third (so the tests can see the features); all reverted |
| Silhouette table | `node scripts/cat/extents.mjs --gpu=real --check` | the table the brain plans with (`engine/shape-table.ts`) is the one the pixels of the drawn cat give, for every clip and phase |

The 26 e2e tests map to the plan's scenarios as follows: 1–2 off by default, a host that does not offer it, no download when off · 3 library: the cat walks on the rows and is a layer the page's clicks go through (aria-hidden, no tab stop, the remote's focus untouched), corner button · 4 the remote opens the panel from the corner and Back puts it where it was · 5–7 "find me something" (a mood and a shelf; a mood with no shelf; a row the library made for the viewer, with its reason) · 8 a title's page sends the cat away and it comes back · 9–11 film: the cat rests in a corner under the controls; the layer is under the subtitles and the controls and over the picture (a 40 s film with a two-row line every 4 s: what is on top at a point of the words is the words, then the cat, then the picture) and the lines coming and going do not make it come and go; "no cat in films" · 12–13 a hand rests on the cat and it is stroked, a pointer that passes is not; a press on the cat takes nothing from the page, a press on the poster beside it opens it · 14 a page that only sits there is read about twice a second · 15 reduced motion · 16 settings only where the host offers a cat · 17–22 the detailed cat: drawn from a file fetched once; no WebGL; a mesh that is missing or broken; a file that does not come; a screen that cannot spare even the simple cat (no cat, no corner button, nothing left behind); a screen that cannot afford the detailed one · 23–26 the detail switch, coat and size, and the address overrides.

## Frame cost and frame rate

### Real GPU (RTX 3090 / D3D11), cat with the governor held off, `raf-rate` scratch script, 8 s each

| Size | no cat | simple cat | detailed cat |
|---|---|---|---|
| 1920×1080 | 129.8 fps (p95 gap 8.3 ms, worst 8.8) | 130.1 fps (8.1, 8.8) | 129.2 fps (8.5, 8.8) |
| 1280×720 | 129.3 fps (8.4, worst 10.7) | 129.1 fps (8.4, 8.9) | 129.3 fps (8.4, 8.7) |

The detailed cat (12 layers of fur at this size) is not measurable against no cat on this card. The worst gap with it was 8.8 ms: the timing read causes no hitch.

### Real GPU, the governor on (default budget 2 ms on a desktop user agent), 14 s per size, `cat-matrix` scratch script

| Size | art | quality | cost median / max (ms) | fps median / min | places · keep-outs · posters | JS heap (MB) |
|---|---|---|---|---|---|---|
| 1920×1080 | solid | full | 0.18 / 0.21 | 130 / 129 | 3 · 16 · 9 | 12.4 → 10.8 |
| 1366×768 | solid | full | 0.11 / 0.31 | 129 / 128 | 3 · 16 · 9 | 13.1 → 9.2 |
| 1280×720 | solid | full | 0.10 / 0.13 | 130 / 128 | 3 · 16 · 9 | 11.7 → 10.5 |
| 1024×768 (tablet) | solid | full | 0.21 / 0.34 | 131 / 129 | 4 · 28 · 11 | 11.7 → 13.3 |
| 844×390 (phone, landscape) | solid | full | 0.11 / 0.23 | 130 / 128 | 3 · 16 · 9 | 12.9 → 12.2 |
| 390×844 (phone, portrait) | solid | full | 0.29 / 0.36 | 130 / 129 | 5 · 30 · 14 | 13.1 → 11.4 |

Console problems: none. **What "cost" is, and why these numbers are lower than the first version of this report's (1.0–1.1 ms):** the host now charges the governor with the cat's own work only: its JavaScript (`think` 0.02 ms and `paint` 0.10 ms per frame on average at 1280×720) and what the card needed for the picture, found by asking the card twice, back to back, and taking the difference (0.25–0.4 ms). It no longer charges the page's own layout read after a focus move, or the card's reply time, which was most of the old figure (ISSUE_LOG #21, #25). The cat's JavaScript alone is therefore **≈ 0.12 ms per frame on this CPU** (the plan's budget: ≈ 2 ms on a desktop, ≈ 4 ms on a low-power device).

Browsing with the remote (a key press every 400 ms, 92 presses in 40 s, the page scrolling under the cat; `govscroll` scratch script):

| Size | what the governor did | highest smoothed cost | phases, mean / highest (ms) |
|---|---|---|---|
| 1920×1080 | stayed on solid/full | 0.56 ms | read 0.34 / 0.81 · think 0.02 / 0.07 · paint 0.10 / 0.20 · card 0.25 / 0.40 |
| 1280×720 | stayed on solid/full | 0.64 ms | read 0.28 / 0.86 · think 0.02 / 0.06 · paint 0.10 / 0.17 · card 0.38 / 0.50 |

(Before the governor was fixed, the same run fell to the lean picture in 1.2 s and never came back: ISSUE_LOG #25.)

The same screen with the **processor** made 2×, 4× and 6× slower (`Emulation.setCPUThrottlingRate`), 1280×720, 24 s, desktop user agent so the budget is 2 ms (a TV agent gets 4 ms):

| CPU slowed | what the governor did | cost at the end of the run | page |
|---|---|---|---|
| 2× | stayed on the detailed cat at full quality | 0.64 ms (0.2–0.6 at rest) | 128–133 fps |
| 4× | the same | 1.05 ms (0.4–1.1) | 124–133 fps |
| 6× | the same | 1.12 ms (0.6–1.3) | 127–133 fps |

The cat's JavaScript is a small part of a frame, so even a processor six times slower leaves it inside the budget; that is not a statement about a TV, whose graphics card, not its processor, is the likelier limit. The graphics path is exercised by the software GL runs below.

### Software GL (the worst case for a screen's graphics), governor held off

| Size | no cat | simple cat | detailed cat |
|---|---|---|---|
| 1920×1080 | 60.0 fps | 60.0 fps | **10.0 fps** (p95 gap 183 ms; worst 2.5 s, the shader compile of the first frames included) |
| 1280×720 | 60.0 fps | 60.0 fps | **21.8 fps** (p95 gap 67 ms; worst 1.4 s) |

The detailed cat on a processor that draws everything is heavier than in the first version of this report (17 and 31 fps): the fur has more layers now (3 to 12 by the cat's size on screen, 12 at these sizes; it was 1 to 5) and the shader more to do. That is what the governor is for. With it on, `gov-watch` (cost, fps and the art and quality in use, every second):

| Size | detailed cat → lean picture (half the frame rate, 3 fur layers) | → simple cat | page afterwards |
|---|---|---|---|
| 1920×1080 | after 9 s | after 18 s | 60 fps, cost 0.3 ms |
| 1280×720 | after 7 s | after 15 s | 60 fps, cost 0.3 ms |

The governor now asks the card what a picture costs 1.5 s after anything about it changed, three times 0.6 s apart, then every 5 s (so that it does not judge a fast machine by a moment of load, ISSUE_LOG #25): on a screen that draws on the processor the step-downs are 3–7 s later than they were (the first version: 5–6 s and 10–11 s), and the page is at 15–30 fps for the first 8–9 s. Under software GL the numbers the governor reads while the detailed cat is drawn (hundreds of ms) are the time the card takes to drain the queued frames, not the price of one; the decisions are right (the page is back at 60 fps), the milliseconds are not a per-frame cost. Device matrix on software GL, 14 s per size: the first 8–10 s are spent on the detailed cat, so the median over the run is 26–30 fps (minimum 12–21), every size ends on the lean picture or the simple cat, heap 10–13 MB. Four Chrome notices "GPU stall due to ReadPixels" are logged per page under software GL (a driver performance hint, not an error; none on the real GPU; the feedback diagnostics do not collect them).

## What the cat does to the page, measured

| Claim | How it was checked | Result |
|---|---|---|
| Off by default; nothing fetched | e2e 1 (the requests a library makes when the host offers the cat but the device did not ask: none for `/assets/host-*`, the cat's chunk), e2e 2 (a host that does not offer it gets no cat whatever the address says) | pass |
| Never covers the focused card or a heading or a button | `coverage` scratch script: opaque pixels of the cat's canvas inside the page's rectangles, sampled every 170 ms for 60 s, at 1280×720 (seeds 11 and 7) and 1920×1080 (seed 7); the soak's invariant "stood in a keep-out zone for > 2.8 s"; e2e 3, 8, 9, 10 | headings 0 and the focused card 0 at every sample of all three runs (349, 348 and 349 samples; 211, 159 and 161 of them resting); no violation in the soak | 
| Does not sit in front of the names under the cards | the same script, resting moments (rest / sleep / watch) | **1280×720 seed 7: 0 of 159 resting samples over a name; 1920×1080 seed 7: 0 of 161; 1280×720 seed 11 (the reviewer's worst case): 70 of 211 (33 %, the worst a quarter of the cat's own square; the brain knew: 75 of 211).** On that seed the cat rests on a line where the names run edge to edge and there is no better place on the page. The reviewer measured 71 of 157 (45 %) on this seed before the fixes: better, **not solved** (ISSUE_LOG #9) |
| A film plays on, undisturbed, and the subtitles are over the cat | e2e 9–11 (above); `film` scratch script: the real player, a routed two-line VTT (2.6 s on, 1.4 s off) for 40 s at 1280×720 | computed z-index of the cat's layer / the captions: 0 / auto (the cat is under the words); over the 40 s the cat stayed asleep in its corner, faded out 0 times and started a walk or a leap 0 times (before the fix: 7 fade-outs and 3 walks); the film stayed in state `playing`; no console problems. Not checked: the video's clock |
| Switching off removes everything | lifecycle script (above) and e2e 21 (a cat that is halted leaves nothing behind) | one cat, one canvas, nothing behind |
| A broken mesh/context never breaks the page | e2e 18–20 | falls back to the simple cat, no page error |
| The page is not read at the cat's frame rate | e2e 14: 9.8 reads a second at rest before (the cat's own nodes woke the page watcher), about 2 now | pass |

## Independent review

An independent read-only agent reviewed the branch at `c2abd52` (before the gait, governor, subtitle, extent and model work) and rated it. Its findings (3 P1, 5 P2, 7 P3, all with a reproduction) are the rows 22–31 and the open rows 37–38 of ISSUE_LOG; every P1 and P2 is fixed (re-checked by the measurements above). **A second review of the final head has not been done yet at the time of writing** (the plan asks for one at the end of the loop; if it was done, it is in the next paragraph).

## Scorecard (plan §10): my marks, the reviewer's marks at `c2abd52`, and why

The plan's gate is an average of 4 or more with no mark under 3, and says never to fake it. **Mine do not reach it, and the marks are the author's (the same hand that wrote the code): the reviewer's marks are the ones to trust, and they are from before most of the fixes.** A second review of the final head is in "Independent review" above if it has been done.

| # | Criterion | Reviewer at `c2abd52` | Mine now | Why |
|---|---|---|---|---|
| 1 | Identity / art cohesion | 3 | **4** | the ginger tabby reads as one furred cat in every posture and facing; the dark coats (tuxedo, grey) are plasticky at a closer look and the simple cat is another cat (ISSUE_LOG #11, #13) |
| 2 | Natural movement | 3 | **3** | gait, gallop, leap and settling are continuous functions with no foot slide (largest one-frame step 0.113 of the body) and read well on strips; the gallop and leap haunch and the scratch leg are not cat-like at a closer look (#36); **nobody has watched it move** |
| 3 | Behaviour variety | 3 | **4** | 18 clips and a dozen little scenes, cool-downs, a seeded rhythm; an unattended cat is asleep 40 % of the time (#12) |
| 4 | Spatial intelligence | 2 | **3** | leaps and walks on real shelves, never off the screen (soak invariant), 0 covering seconds of a name on two of three runs; 33 % on the worst row (#9, #10) |
| 5 | Contextual awareness | 3 | **4** | watches the focused card, sent away by pages and menus, rests under the controls and subtitles in a film, stretches when it ends |
| 6 | Useful recommendations | 2 | **3** | real titles on the page, the library's own reason, "Open it" and nothing played; a mood and shelf grammar, not free text |
| 7 | Non-intrusiveness | 2 | **3** | never over the controls, captions or the focused card in any run; the names residual (#9); the 0.6 s over a card whose focus came (#37) |
| 8 | Device and accessibility | 3 | **3** | reduced motion, aria, remote buttons, phone sizes, the governor; **no real device** (#8) |
| 9 | Performance and lifecycle | 2 | **3** | measured on this PC (0.1 ms of script a frame, full quality at 130 fps, 25 on/off cycles flat); on a processor-drawn screen the governor steps down; unknown on a TV |
| 10 | Reliability | 4 | **4** | 124 unit, 26 end to end, a soak of 1,000+ sessions with the invariants, mutation checks; every fallback has a test |
| | **Sum / average** | 27 / 2.7 | **34 / 3.4** | |

## Not tested (and why it matters)

- **No real TV, Fire TV Stick, Android phone, iPhone, iPad or Safari/WebKit.** Everything is Chromium 156 on one PC. TV browsers differ in WebGL support, shader precision and speed; the fall-backs and the governor exist because of that, but they have not been seen on those devices. The simple Canvas 2D cat is the safe bet there; the detailed cat's costs on a Fire Stick are **unknown** (its 12 fur layers are heavy on a processor-drawn GL, see above).
- **Only one real GPU**, and a very fast one. The software path is the only slow GPU path tried.
- **Motion was never watched by a person.** Poses, sheets, strips of consecutive frames and numbers were judged; how a hand-over between two clips feels at a TV's frame rate was not.
- **No hour-long real-time run in a browser**; the long runs are virtual time in the soak (hours of it) and 14–60 s runs in a browser. The lifecycle loop shows no leak over 25 cycles, not over a day.
- Screen readers: the cat is `aria-hidden` and out of the tab order by design (e2e 3); the panel was exercised with the keyboard, not with NVDA/VoiceOver/TalkBack.
- Romanian and Italian layouts of the settings rows were checked for text that does not fit by a unit guard (`cat.test.ts`) and a two-by-two layout, not by a native speaker.
- Browser zoom and a device pixel ratio above 1 on the cat's picture: a pixel ratio of 2 is what the two phone-size runs above and the phone pictures in `evidence/` were taken at (the cat is drawn at the device's ratio, up to the painter's own maximum, and is placed right); browser zoom at 80 / 125 / 200 % (the same as a different size in CSS pixels at a different ratio) was **not checked**.
