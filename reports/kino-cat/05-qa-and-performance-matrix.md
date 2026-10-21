# 05 · QA and performance matrix

Everything below was run on **2026-10-21** on the final head of the branch (the detailed cat made from the owner's free model, the animation round, the hand and the page's objects), on the author's machine unless it says otherwise. "Measured" means a number came out of a command listed here; "not tested" means exactly that. This report replaces the one written for the first cat (a body built from signed-distance shapes with shell fur: 124 unit tests, 26 end-to-end, 10–22 fps on a processor-drawn screen): where the two disagree, the older one measured a cat that is no longer in the app.

## Where it was run

| Item | Value |
|---|---|
| Machine | AMD Ryzen 9 5900X (12 cores / 24 threads), 32 GB, NVIDIA GeForce RTX 3090, Windows 11 Pro 10.0.26200 |
| Node / test tools | Node 24.15.0, Vitest 5.0.3, Vite 8.3.4, TypeScript 7.0.2, Playwright 1.64 |
| Browser | Chromium 156.0.8078.4 (Playwright's), headless |
| **Real GPU path** | `chromium.launch({ channel: "chromium", args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] })` → `ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 Direct3D11 vs_5_0 ps_5_0)`. The page ran at 130 Hz (the display's rate), not 60. |
| **Software GL path (worst case)** | the default headless Chromium, `--use-angle=swiftshader`: all drawing on the processor. Used on purpose as a stand-in for a weak TV's graphics; it is **not** a measurement of any real TV, and on this 24-thread PC the drawing threads are cores that a TV does not have. |
| Server | the branch's own server (`CAT_COMPANION=on`) on localhost; library data from the test fixtures (`scripts/ui-walk/seed.mjs`) |

The real GPU is a very strong one. It says what the cat costs where the graphics are not the limit (and shows the timing probe does no harm there); it says nothing about a Fire Stick or a TV.

## Automated checks

| Check | Command | Result |
|---|---|---|
| Types | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | clean |
| Unit (cat engine, rig, GL, host, settings, i18n, server flag) | `node node_modules/vitest/vitest.mjs run src/client/cat src/client/i18n/cat.test.ts src/server/features.test.ts` | **191 passed in 8 files** |
| End to end | `$env:pnpm_config_verify_deps_before_run='false'; node node_modules/@playwright/test/cli.js test e2e/cat.spec.ts --reporter=list` (set `E2E_PORT` to a free port) | **31 passed in about 3.2 min** (the file rebuilds `dist/client` first) |
| Soak of the brain | `node node_modules/tsx/dist/cli.mjs scripts/cat/soak.mts 13 412 600` (7 variants of a bad afternoon: scroll, resize, menus, films, touch and the hand, route changes, hidden tab, 20/60 fps, reduced motion, quiet, names on the page; 10 virtual minutes each) | **2,800 sessions (400 seeds × 7 variants), 0 violations, 288 s**, run again after the last change to the engine (the carry rule). The first soak of this project (50 seeds × 7) had found 6 bad sessions, a settled cat with its tail off the screen (ISSUE_LOG #39, fixed) |
| Lifecycle | scratch script: 25 on/off cycles of the cat on the library page, then the panel | every cycle leaves exactly one cat and one canvas and nothing behind when off; JS heap 9.3 MB at the start, 10.1 MB after 25 cycles, 10.5 MB with the panel open (no growth worth the name); DOM nodes constant (678). Four Chrome notices "GPU stall due to ReadPixels" are logged (the default headless browser draws on the processor; a driver hint, not an error) |
| Mutation checks | the tests' own sensitivity: switched `restSpot` off, then the engine's use of it; set the weight of "a title the library chose for the viewer" back to 1; and, for the carry rule, forced the fraction of the hand's travel that lets the cat hang to 0 and to 1 | each change made the tests that guard the rule fail (4 and 1; the recommendation test; the new carry test, both times); all reverted |
| Silhouette table | `node scripts/cat/extents.mjs --gpu=real --check` | the table the brain plans with (`engine/shape-table.ts`) is the one the pixels of the drawn cat give, for every clip and phase |

The 31 e2e tests map to the plan's scenarios as follows: 1–2 off by default, a host that does not offer it, no download when off · 3 library: the cat walks on the rows and is a layer the page's clicks go through (aria-hidden, no tab stop, the remote's focus untouched), corner button · 4 the remote opens the panel from the corner and Back puts it where it was · 5–7 "find me something" (a mood and a shelf; a mood with no shelf; a row the library made for the viewer, with its reason) · 8 a title's page sends the cat away and it comes back · 9–11 film: the cat rests at the foot of the picture between the groups of the controls; the layer is under the subtitles and the controls and over the picture (a 40 s film with a two-row line every 4 s: what is on top at a point of the words is the words, then the cat, then the picture) and the lines coming and going do not make it come and go; "no cat in films" · 12–13 a hand rests on the cat and it is stroked, a pointer that passes is not; a press on the cat takes nothing from the page, a press on the poster beside it opens it · 14 a page that only sits there is read about twice a second · 15 reduced motion · 16–19 the hand: it takes the cat by the scruff, marks the shelf it would be put down on and puts it there; a press that only wobbles is a stroke; reduced motion and quiet are not lifted; a hand that is lost lets it go · 20–21 settings only where the host offers a cat (with its credit line for the model), and the cat's pages of the settings fit a TV's screen · 22–27 the detailed cat: drawn from a file fetched once; no WebGL; a mesh that is missing or broken; a file that does not come; a screen that cannot spare even the simple cat (no cat, no corner button, nothing left behind); a screen that cannot afford the detailed one · 28–31 the detail switch, coat and size, and the address overrides.

Three of the 31 were wrong on their first run of this round and each told something: two still expected the old default coat (the tests now name the coat they count pixels of, and the settings test expects the new default, the ragdoll), and one was a real bug, a cat carried down to a lower shelf was held up by the middle all the way (ISSUE_LOG #48, fixed, with a unit test of its own).

## Frame cost and frame rate

### Real GPU (RTX 3090 / D3D11), cat with the governor held off, `raf-rate` scratch script, 8 s each

| Size | no cat | simple cat | detailed cat |
|---|---|---|---|
| 1920×1080 | 129.8 fps (p95 gap 8.4 ms, worst 12.0) | 130.0 fps (8.4, 9.0) | 129.6 fps (8.4, 9.1) |
| 1280×720 | 129.8 fps (8.4, worst 8.8) | 130.0 fps (8.3, 8.8) | 130.0 fps (8.2, 8.7) |

The detailed cat (one pass of an 11,181-vertex skinned mesh, no fur shells) is not measurable against no cat on this card. The worst gap with it was 9.1 ms: the timing read causes no hitch.

### Real GPU, the governor on (default budget 2 ms on a desktop user agent), 14 s per size, `cat-matrix` scratch script

| Size | art | quality | cost median / max (ms) | fps median / min | places · keep-outs · posters | JS heap (MB) |
|---|---|---|---|---|---|---|
| 1920×1080 | solid | full | 0.33 / 0.37 | 131 / 128 | 3 · 16 · 9 | 11.8 → 12.0 |
| 1366×768 | solid | full | 0.17 / 0.21 | 131 / 129 | 3 · 16 · 9 | 12.7 → 12.2 |
| 1280×720 | solid | full | 0.28 / 0.47 | 130 / 129 | 3 · 16 · 9 | 12.2 → 11.3 |
| 1024×768 (tablet) | solid | full | 0.33 / 0.47 | 130 / 127 | 4 · 28 · 11 | 9.9 → 11.9 |
| 844×390 (phone, landscape) | solid | full | 0.14 / 0.22 | 131 / 129 | 3 · 16 · 9 | 12.9 → 10.8 |
| 390×844 (phone, portrait) | solid | full | 0.14 / 0.19 | 130 / 127 | 5 · 30 · 14 | 11.9 → 15.2 |

Console problems: none. **What "cost" is:** the host charges the governor with the cat's own work only: its JavaScript (`think` 0.02 ms and `paint` 0.14 ms per frame on average at 1280×720, so **≈ 0.16 ms per frame on this CPU**) and what the card needed for the picture, found by asking the card twice, back to back, and taking the difference. It does not charge the page's own layout read after a focus move, or the card's reply time (ISSUE_LOG #21, #25). The plan's budget is ≈ 2 ms on a desktop and ≈ 4 ms on a low-power device.

Browsing with the remote (a key press every 400 ms, 92 presses in 40 s, the page scrolling under the cat; `govscroll` scratch script):

| Size | what the governor did | highest smoothed cost | phases, mean / highest (ms) |
|---|---|---|---|
| 1920×1080 | stayed on solid/full | 0.29 ms | read 0.34 / 0.79 · think 0.02 / 0.08 · paint 0.14 / 0.28 · card 0.02 / 0.10 |
| 1280×720 | stayed on solid/full | 0.82 ms | read 0.31 / 0.77 · think 0.02 / 0.07 · paint 0.14 / 0.22 · card 0.11 / 0.60 |

The same screen with the **processor** made 2×, 4× and 6× slower (`Emulation.setCPUThrottlingRate`), 1280×720, 24 s, desktop user agent so the budget is 2 ms (a TV agent gets 4 ms):

| CPU slowed | what the governor did | cost (range over the run, at the end) | page |
|---|---|---|---|
| 2× | stayed on the detailed cat at full quality | 0.22–0.58 ms, 0.31 at the end | 127–132 fps |
| 4× | the same | 0.77–1.23 ms, 0.97 at the end | 125–132 fps |
| 6× | the same (the first seconds, while it walks, touch 2.0 ms and the governor, which judges the smoothed cost over seconds, did not step down) | 0.85–2.01 ms, 1.33 at the end | 116–133 fps |

The cat's JavaScript is a small part of a frame, so even a processor six times slower leaves it near the budget; that is not a statement about a TV, whose graphics card, not its processor, is the likelier limit. The graphics path is exercised by the software GL runs below.

### Software GL (the worst case for a screen's graphics), governor held off

| Size | no cat | simple cat | detailed cat |
|---|---|---|---|
| 1920×1080 | 60.0 fps | 60.0 fps | **59.6 fps** (p95 gap 16.7 ms; worst 66.6 ms, the first frames and the shader compile) |
| 1280×720 | 60.0 fps | 60.0 fps | **60.0 fps** (p95 gap 16.7 ms; worst 16.8 ms) |

(The first cat, with up to 12 passes of shell fur, ran at 10 and 22 fps in the same test. The present one is a single pass.) **That the page keeps 60 fps here is only half the story**: the drawing of the cat is done by the software renderer's own threads, which on this PC are other cores. With the governor on, the host measures what one frame of the detailed cat takes to draw (`gov-watch`: cost, fps, and the art and quality in use, every second):

| Size | detailed cat → lean picture (half the frame rate, DPR 1) | → simple cat | page afterwards |
|---|---|---|---|
| 1920×1080 | after 3 s (the card needs 10–17 ms a frame: a quarter to nine tenths of a frame at 60 fps) | after 9 s | 60 fps, cost 0.3 ms |
| 1280×720 | after 3 s (11–14 ms a frame) | after 8 s | 60 fps, cost 0.3 ms |

So **on a screen whose graphics are the processor the governor still gives up the detailed cat, in 8–9 s**, which is the behaviour the plan asks for (a cost above the budget is a reason to step down) but also **more cautious than this particular PC needed**; on a machine with fewer cores than this one the decision is the right one. The page is at 30 fps for about the first 5 s after the step to the lean picture. Device matrix on software GL, 14 s per size (`cat-matrix`): every size ends on the simple cat (`classic`), median 59.8–60.0 fps (minimum 30.0, during the lean-picture seconds), JS heap 11–14 MB. Four Chrome notices "GPU stall due to ReadPixels" are logged per page under software GL (a driver performance hint, not an error; none on the real GPU; the feedback diagnostics do not collect them).

## What the cat does to the page, measured

| Claim | How it was checked | Result |
|---|---|---|
| Off by default; nothing fetched | e2e 1 (the requests a library makes when the host offers the cat but the device did not ask: none for `/assets/host-*`, the cat's chunk), e2e 2 (a host that does not offer it gets no cat whatever the address says) | pass |
| Never covers the focused card or a heading or a button | `coverage` scratch script: opaque pixels of the cat's canvas inside the page's rectangles, sampled every 170 ms for 60 s, at 1280×720 (seeds 7 and 11) and 1920×1080 (seed 7); the soak's invariant "stood in a keep-out zone for > 2.8 s"; e2e 3, 8, 9, 10 | headings 0 and the focused card 0 at every sample of all three runs (348, 348 and 348 samples; 205, 204 and 198 of them resting); no violation in the soak |
| Does not sit in front of the names under the cards | the same script, resting moments (rest / sleep / watch), a name counting from 30 px² of the cat over it | **1280×720 seed 7: 0 of 205 resting samples over a name; 1920×1080 seed 7: 0 of 204; 1280×720 seed 11 (the worst case a reviewer found): 105 of 198 (53 %), the worst one 863 px², a sixth of the cat's own square, and only 2 samples over a tenth of it** (the brain knew: it believed 105 of 198). On that seed the cat rests on the floor of the page and on the second row, where the names run edge to edge and there is no better place. The first cat measured 70 of 211 (33 %, the worst a quarter of the square) on this seed: the new cat is wider and its tail longer, and **this one is worse, not better** (ISSUE_LOG #50, open; #9 was the first cat's) |
| A film plays on, undisturbed, and the subtitles are over the cat | e2e 9–11 (above); `film` scratch script: the real player, a routed two-line VTT (2.6 s on, 1.4 s off) for 40 s at 1280×720 | computed z-index of the cat's layer / the captions: 0 / auto (the cat is under the words); over the 40 s the cat went to the perch at the foot of the picture within a second, rested as a loaf, dozed and slept curled, faded out 0 times and started a walk or a leap 0 times while the controls were hidden; the film stayed in state `playing`; no console problems. Not checked: the video's clock |
| Switching off removes everything | lifecycle script (above) and e2e 26 (a cat that is halted leaves nothing behind) | one cat, one canvas, nothing behind |
| A broken mesh/context never breaks the page | e2e 23–25 | falls back to the simple cat, no page error |
| The hand does not take what the page needs | e2e 12, 13, 16–19 | a press that only wobbles lifts nothing; the poster beside the cat still opens; reduced motion and quiet are not lifted; a lost pointer puts the cat down on a shelf |
| The page is not read at the cat's frame rate | e2e 14 (about 2 reads a second when the page only sits there) | pass |

## Independent review

An independent read-only agent reviewed the first cat's branch at `c2abd52` (before the gait, governor, subtitle, extent and model work) and rated it. Its findings (3 P1, 5 P2, 7 P3, all with a reproduction) are rows 22–31 and the open rows 37–38 of ISSUE_LOG; every P1 and P2 was fixed and re-checked. A second review of this head was asked for and is described below if it has come back; **nothing in this report is based on it unless it says so.**

## Scorecard (plan §10): my marks, the reviewer's marks at `c2abd52`, and why

The plan's gate is an average of 4 or more with no mark under 3, and says never to fake it. **Mine do not reach it, and the marks are the author's (the same hand that wrote the code): treat them as the least trustworthy numbers in this report.** The reviewer's column is from before most of the fixes and from the first cat.

| # | Criterion | Reviewer at `c2abd52` | Mine now | Why |
|---|---|---|---|---|
| 1 | Identity / art cohesion | 3 | **4** | one furred cat, from the owner's reference (a pale ragdoll with grey points and blue eyes), in every posture and facing; at close range the mesh has flaws (thin shards on the belly and legs, a flat tuxedo belly patch: ISSUE_LOG #11), and the simple cat is another cat (#13) |
| 2 | Natural movement | 3 | **3** | 22 clips with a walk that rocks, a wash that reaches the face, a yawn, a stretch, a scratch that folds, a leap with no snapping joint, an idle life; the numbers are good (no foot slide; largest one-frame step 0.113 of the body); **nobody has watched it move**, and the gallop and leap haunch are not cat-like at a closer look (#36) |
| 3 | Behaviour variety | 3 | **4** | 22 clips, a dozen little scenes, the page's own objects (peek, tap a resting pointer, doze through a film), a seeded rhythm; an unattended cat is asleep about 39 % of the time (#12) |
| 4 | Spatial intelligence | 2 | **3** | leaps and walks on real shelves, never off the screen (soak invariant), carried to a shelf and put down on it; 0 samples over a name on two of three runs, 53 % on the worst row (#50, #10) |
| 5 | Contextual awareness | 3 | **4** | watches the focused card, sent away by pages and menus, rests under the controls and subtitles in a film, stretches when it ends |
| 6 | Useful recommendations | 2 | **3** | real titles on the page, the library's own reason, "Open it" and nothing played; a mood and shelf grammar, not free text |
| 7 | Non-intrusiveness | 2 | **3** | never over the controls, captions or the focused card in any run; the names residual (#50); the 0.6 s over a card whose focus came (#37) |
| 8 | Device and accessibility | 3 | **3** | reduced motion, aria, remote buttons, phone sizes, the governor; **no real device** (#8) |
| 9 | Performance and lifecycle | 2 | **3** | measured on this PC (0.16 ms of script a frame, 0.14–0.33 ms of card, full quality at 130 fps, 25 on/off cycles flat, 51 KB of gzip for the code, 165 KB for the mesh, only for those who turn it on); on a processor-drawn screen the governor steps down to the simple cat in 8–9 s; unknown on a TV |
| 10 | Reliability | 4 | **4** | 191 unit, 31 end to end, a soak of 2,800 sessions with the invariants, mutation checks; every fallback has a test |
| | **Sum / average** | 27 / 2.7 | **34 / 3.4** | |

The sum is the same as at the first checkpoint, and that is not a coincidence to be proud of: the first cat's marks were already generous on the look (4), and this round spent its effort on what the owner asked for (a better cat and better motion) where the evidence I have is stills and numbers, not a person watching.

## Not tested (and why it matters)

- **No real TV, Fire TV Stick, Android phone, iPhone, iPad or Safari/WebKit.** Everything is Chromium 156 on one PC. TV browsers differ in WebGL support, shader precision and speed; the fall-backs and the governor exist because of that, but they have not been seen on those devices. The simple Canvas 2D cat is the safe bet there; the detailed cat's cost on a Fire Stick is **unknown**.
- **Only one real GPU**, and a very fast one. The software path is the only slow GPU path tried, and it is drawn by many threads here.
- **Motion was never watched by a person.** Poses, sheets, strips of consecutive frames and numbers were judged; how a hand-over between two clips feels at a TV's frame rate was not. The same is true of the hand: the pick-up, the swing and the put-down were judged by their numbers and by tests, not by feel.
- **The licence of the model is the owner's statement** (CC BY 4.0 for "Fluffy Blue-Eyed Cat" by Meshy AI); I did not verify it on the maker's site, and the file carries no licence metadata. The model file itself is not in the repository; the credit is shown in Settings → Cat companion and recorded in 06.
- **No hour-long real-time run in a browser**; the long runs are virtual time in the soak (hours of it) and 14–60 s runs in a browser. The lifecycle loop shows no leak over 25 cycles, not over a day.
- Screen readers: the cat is `aria-hidden` and out of the tab order by design (e2e 3); the panel was exercised with the keyboard, not with NVDA/VoiceOver/TalkBack.
- Romanian and Italian layouts of the settings rows were checked for text that does not fit by a unit guard (`cat.test.ts`) and a two-by-two layout, not by a native speaker.
- Browser zoom and a device pixel ratio above 1 on the cat's picture: a pixel ratio of 2 is what the two phone-size runs above and the phone pictures in `evidence/` were taken at; browser zoom at 80 / 125 / 200 % was **not checked**.
- The sprite version for light devices (a picture of the cat from the model's own animations, for a screen that cannot draw it) is **not built**: the simple cat is a different, cartoon cat. ISSUE_LOG #13.
