# Tooling for the UI polish program

What was looked at, what is used, what was left out and why. Updated as the program goes.

## Used

| Tool | What for | Where |
|---|---|---|
| **Playwright 1.64** (already a dev dependency) | the screenshot walk, the live-DOM scanner, the e2e suite, ad-hoc exploration scripts | `scripts/ui-walk/`, `e2e/` |
| **pixelmatch + pngjs** (added) | pixel comparison between two walks (`ui:compare`), side-by-side pictures of what changed | `scripts/ui-walk/compare.mjs` |
| **The screenshot walk** (`pnpm ui:walk`) | the same ~170 pictures of every screen of the TV and the phone, for either look, on a made-up catalogue with drawn posters (no real titles, no network) | `scripts/ui-walk/run.mjs` |
| **The live-DOM scanner** (`pnpm ui:walk -- --scan`, then `pnpm ui:drift`) | what the pages really use (type sizes, weights, radii, colours, shadows, motion) and where they break the rules (small text, small targets, low contrast, unnamed controls, outside the TV's safe margin) | `scripts/ui-walk/scan.mjs`, `drift.mjs`, report in `docs/ui-polish/drift/` |
| **`design:*` skills** (accessibility-review, design-critique, design-system, ux-copy) | structured critique and accessibility review of the screens; the design-system skill for the rule sheet | session skills |
| **`frontend-design` skill** | direction for the polished look so it does not come out generic | session skill |
| **`simplify` / `code-review` skills** | the code-quality pass after the visual work is accepted | session skills |
| **Codex / Gemini second opinions** (`fable-delegation`, `codex:*`) | a blind second look at a before/after pair, an outside review of the finished diff | session skills |
| **WebSearch / WebFetch** | the reference research in `REFERENCE_PRINCIPLES.md` | built in |

## Looked at and left out

| Tool | Why not |
|---|---|
| **Storybook** | The plan allows it "or" a lab page. Kino is plain CSS (no Tailwind, no CSS-in-JS), one icon file and a handful of components that depend on page context (TV focus, pairing). A dev-only lab route shows them with far less machinery and no second build. |
| **Tailwind / a token framework** | The plan says "no new token framework". The CSS already has `--accent`, `--surface`, ... custom properties; the polish work extends those. |
| **Figma** | Needs your authorisation (see `REGISTRATION_BLOCKERS.md`). Optional. |
| **Context7 / library-docs MCP** | Not installed in this environment and nothing in the work needs a library the model does not already know. WebFetch of the vendor page covers the odd lookup. |
| **Visual-regression SaaS (Percy, Chromatic, ...)** | Needs an account and uploads screenshots. The local pixelmatch compare does the same job on this machine. |

## Facts about this machine that shape the tooling

* Windows 11, Node 24, pnpm 11.2.2, Playwright's bundled Chromium. `git config core.autocrlf=true`.
* `dist/client` is committed (hashed file names), so every client/shared change needs a rebuild before it is committed. The walk builds once at the start and leaves `dist` as the tree has it (checked with `git status`).
* The walk starts a **fresh in-memory server for each part** (accounts live in the server's memory, so a part that signs people up gets a server of its own). Ports: 8810 (classic), 8811 (polish). The e2e suite uses its own `E2E_PORT`; do not run both at once.
* Pairing codes, QR patterns and the film's frame change from run to run; the walk pins them to fixed values for the picture (`steady()` in `lib.mjs`) so a comparison shows what the *page* did. Pictures named `*-live.png` keep the real frame and are for looking at, not for comparing.
