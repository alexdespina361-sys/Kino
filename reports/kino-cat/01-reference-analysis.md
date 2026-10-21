# 01 · Reference analysis (Furever Dock 2.0.3)

**Scope, on purpose small.** The plan says: do not run the installer, do not make reverse engineering a prerequisite, stop when it has diminishing value. Everything below was read **without executing, installing, importing or unpacking** anything. Labels: **observed** (read directly), **inferred** (reasoned from observed facts), **unverified** (could not be checked, do not rely on it).

## What was inspected, and how

| Source | Method | Date |
|---|---|---|
| The installer file the owner left on the Desktop | read-only file metadata: `Get-Item`, `Get-FileHash`, `Get-AuthenticodeSignature`, first four bytes, `VersionInfo`. Never started, never opened by another program, never uploaded anywhere. | 2026-10-20 |
| `https://www.fureverdock.com/` (official site) | read in the built-in browser pane (text and screenshots); nothing downloaded | 2026-10-20 |
| `github.com/Miiiiiya93/fureverDock2-assets` | one public page view through a summarising fetch (second-hand, partial listing) | 2026-10-21 |
| `github.com/CarbonNeuron/react-shimeji` | one public page view through a summarising fetch (second-hand) | 2026-10-21 |

## Installer — observed

| Field | Value |
|---|---|
| File | `desktop-release_2.0.3_windows_Furever_Dock_2.0.3_x64-prod-setup.exe` |
| Size | 184,719,824 bytes (176.2 MiB) |
| SHA-256 | `21415B08CA885D2F5C8CD47DA222405A0909F40414804ED8DE0CB4543B9AC5B4` |
| First bytes | `4D 5A 90 00` ("MZ": a Windows executable) |
| Authenticode | **Valid**; signer `CN=Lollapalooza Lab Inc, O=Lollapalooza Lab Inc, L=Dover, S=Delaware, C=US`; countersigned by the Microsoft Public RSA Time Stamping Authority |
| Version info | product "Furever Dock", description "Furever Dock", file/product version 2.0.3; company and copyright fields **empty** |
| File times | created 2026-10-20 21:15:56, written 21:16:09 (a download of the same evening) |
| Antivirus verdict | **none recorded**: no hash lookup or upload was made (the file is proprietary; the plan asks to consider privacy first). A valid signature says who signed it, not what it does. |

The signer matches the company the official site names as the developer (observed on the site: "developed and operated by Lollapalooza Lab Inc"), so provenance of the file is **consistent with** the official release. That is all it says.

## Installer — not examined (unverified)

- **Contents, installer technology, bundled runtime (Electron? Tauri? native?), `app.asar`, sprite/atlas formats, animation names, state graph, network endpoints, telemetry, updater, permissions.** No archive tool (7-Zip) is installed on this machine, and installing one for this was not worth it: the plan's own guidance is to stop when value diminishes, and Kino's cat has no dependency on any of it. Any statement about how Furever Dock is built would be a guess; none is made here.
- **The owner's 18-second reel** the plan mentions was not found on this machine (looked on the Desktop and in the working folders). No scene-by-scene timeline was made from it.

## Official site — observed (marketing text only)

- A desktop pet for Windows and macOS; the pet is "inspired by your own or one you adopt"; described as **AI-powered** (pet creation, remembering context, answering questions, reminders).
- A "day with your pet" timeline: 9:00 good morning (hangs around), 10:30 "need a hand?" (questions, reminders), 2:30 "let's play" (tricks such as Sit, High Five), 4:30 break (stretch, water, breathing), 9:30 bedtime (a daily rhythm; sleepy at night).
- Developer: Lollapalooza Lab Inc.

Informs **high-level design only**: a companion has a daily rhythm, rest/sleep, a few playful interactions, and offers help on request. Kino's cat does not copy any of it literally (it has no AI, no accounts, no reminders, no telemetry, no tricks list).

## Public repositories — observed, partial, second-hand

| Repo | Finding | Consequence |
|---|---|---|
| `fureverDock2-assets` | no description; folders `demo/`, `nancy/`; some PNGs with Chinese file names; **no LICENSE file and no usage-rights text visible**; 23 commits, 1 star. Listing truncated. | **Not reusable.** No licence = all rights reserved. Not downloaded, not copied, not used as a style reference sheet. |
| `react-shimeji` | declares **MIT**; dependency-free engine; mascots are DOM elements animated per frame from sprite atlases; weighted action trees; 27 commits, 0 stars, no releases; LICENSE file presence not confirmed on the page. | Not used. Kino needs behaviour tied to *its* page geometry and a rig that is not a sprite sheet. Only the idea (weighted action choice, walk/climb/jump) is shared, and that idea is common knowledge. |

## What was inferred (and how it was used)

1. **Renderer choice (inferred, then tested rather than assumed):** a reel-style "creature on the desktop" is usually either sprite sequences or pre-rendered video. Kino cannot rely on either (no art licence; alpha video is poor on older TV browsers). So the cat is built from scratch and rendered live: see 02.
2. **Top visual tricks to carry over** (from the plan's list and general animation practice, none from the binary): (1) anticipation before a jump and a settle after it; (2) breathing and blinking at all times; (3) a slow blink at the viewer; (4) weight shift before a sit; (5) a tail that follows with a delay; (6) feet that do not slide (odometer-driven gait); (7) the eyes lead the head and the head leads the body when it looks at something; (8) a ground shadow that grows/shrinks with height; (9) rests are long, moves are short (a cat is mostly asleep); (10) the cat reacts to what the viewer does (focus, petting) rather than to a timer.
3. **Not reusable, by licence or by design:** all Furever code, art, names, sounds, prompts, telemetry; the "AI" parts; any proprietary file format.

## Risks recorded here and carried to 06

- Anything in the installer's payload is proprietary and was not read; the clean room is intact because nothing from it exists in this repository (verify with `git log -p --all -S"Furever"`: the only mentions are in these reports and in commit messages saying so).
- The two repositories could change or vanish; nothing depends on them.
