// What nobody could play: the films and episodes no source had a video of, the most asked for first, to look for sources with (docs/unavailable.md).
// The same as `node scripts/feedback.mjs unavailable`, with the same token and address; `--all` lists every one kept, `--json` gives them as they are.
process.argv.splice(2, 0, "unavailable");
await import("./feedback.mjs");
