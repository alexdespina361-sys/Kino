# An optional elbow for the Meshy cat's forelegs (judged, not shipped)

**Result: the shipped cat is unchanged.** The gate (anatomy mark up by 1 on most clips with a raised or bent leg, nothing worse) was not met, so `cat.mesh`, `cat.clips`, the runtime and `dist/client` are untouched.

## What this PR contains (scripts and docs only)
- `build-meshy.mts`: with `CAT_ELBOW=1`, adds `frontleg_e` / `R_frontleg_e` half way along each foreleg's first bone (36 bones; weights shared by a smooth step). Default off: the mesh and clips rebuild byte for byte as shipped.
- `posegen.mts`, `feet.mts`, recipes: a five-bone foreleg is used only if the skeleton has the bone.
- `qa.mts --mesh=<file>`.
- Docs: `QA.md` round 14, `SESSION_LOG.md` decision 16, `README.md` note.
- The hind legs already have a knee and a hock; nothing was added there.

## Blind A/B (old pack vs new, nine clips, one fresh Opus judge each; a call under 65 % is noise)
groom: old better (65 %), point: new better (70 %, anatomy 3 to 4), tap, stretch, swat, scale, sit, walk, run: equal (50-53 %). Four judges said the sheets looked the same. Every judge of both versions named the same fault: a one-piece tube of fur with no readable forearm. That is the mesh's shape, which a rig cannot change.

`qa.mts` for the elbow pack: stretch99 and flips fine (crouch 2.47 to 1.83, scale 3.35), volume 0.71 to 1.19 (the scale's low end is worse: 0.89 before), pack 337,440 B (budget 348,160). Skin tests and 132 cat render unit tests pass.

## Not done / not seen
No real phone, Fire TV or Safari. The carried cat was not judged. `e2e/cat.spec.ts` and the soak were not rerun because no `src/` file changed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)