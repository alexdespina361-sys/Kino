# Decisions

Newest at the bottom of each section. "Owner" = a call the owner made; "Me" = a call I made and will defend; "Open" = waiting for the owner (a default is being used meanwhile).

## Program rules

| # | Decision | Who | Why |
|---|---|---|---|
| D1 | Work on branch `ui/polish-system`, cut from `origin/main` (`cde1d7f`, the merged `release/everything`). Nothing is pushed or opened as a PR until the owner says. | Me | The owner opens and merges PRs themselves. |
| D2 | **Two looks, switchable at any time**: `classic` (exactly today's site) and `polish`. Chosen in Settings (TV and phone, "Look") or by `?ui=polish` / `?ui=classic` / `?ui=reset` in the address; kept in this browser (`kino.ui`). Default stays `classic` until the owner decides otherwise. | Owner (requirement) | "Keep the current version of the website, allowing us to switch between the two at any point in time". |
| D3 | The refined look lives in its own stylesheets under `src/client/polish/`; **every rule starts with `:root[data-ui="polish"]`**, so while the look is classic none of it matches. A test fails the build if a rule does not (and if a `@keyframes` name does not start with `polish-`: keyframes are global). | Me | Classic stays pixel-identical; checked by the walk's compare against a build of the old `main`. |
| D4 | The polish CSS keeps to what old TV browsers (VIDAA / Tizen / webOS, Chromium about 68-76) understand: no `@layer`, `:has()`, `:is()`, `:where()`, `@container`, `color-mix()`, `dvh`, `text-wrap`, `@property`, `subgrid`. A browser drops a whole rule (or block) for a part it does not know. | Me | The same guard test. |
| D5 | **Bug fixes go into both looks** (a dead end, a wrong label, a lost state, an accessibility failure). **Layout, new buttons, changed paths and every purely visual change go only into polish.** | Me (assumed; told to the owner) | Classic must stay what it is for comparison, but nobody wants a known bug kept for reference. If the owner wants classic frozen completely, bug fixes move behind the look switch too: one-line change of policy. |
| D6 | The brand red (`#e50914`) and the six per-profile accents (red, blue, purple, green, orange, pink) do not change. Everything is checked with all six. | Me (assumed; told to the owner) | The plan speaks of "the blue accent": in the app the accent is a per-profile choice, red by default. |
| D7 | No Storybook, no Tailwind, no token framework. A small dev-only lab page (built only on request, never in the production bundle) shows the primitives under both looks and all accents. | Me | Plain CSS app, one icon file, components that depend on page context; Storybook would be a second build for little gain. |
| D8 | Screenshots are the evidence: a walk of every screen on a made-up catalogue with drawn posters (no real titles), the same pictures for either look; baselines are **never** updated automatically. Anything random on a screen (codes, QR pattern, film frame) is pinned for the picture. | Me | Comparable, repeatable, and no real content in the repo. |
| D9 | Audits are eight consolidated, parallel, read-only audits (the plan's nine, with A+D, B+C, G+I paired) plus two user-flow audits (TV, phone) that the plan does not have but the owner's goal ("fix bugs, adding missing buttons, optimizing pathing") needs. Every finding must cite evidence; behaviour bugs need exact repro steps. | Me | Scale: one reviewer per question beats nine thin ones. |
| D10 | Tests stay targeted while working (the specs for what changed); one full e2e run per look at the end, not per wave. | Owner (earlier feedback) | "An hour of tests is too slow". |
| D11 | Figma and the other design-plugin connectors need the owner's authorisation; they are optional and noted in `REGISTRATION_BLOCKERS.md`. Work does not wait for them. | Me | Cannot start an OAuth flow myself. |

## Design calls

*(Filled in as they are made. The taste-calibration pictures and the owner's answers go here, each with the options shown, the recommendation, and what was chosen.)*

| # | Question | Options shown | Recommended | Chosen | Who |
|---|---|---|---|---|---|
| | | | | | |
