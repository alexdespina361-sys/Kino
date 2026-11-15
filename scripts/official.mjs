// The Kino Official subtitles: the list, one saved to correct, the corrected one sent back, one taken away (docs/official-subtitles.md).
// The same as `node scripts/feedback.mjs official ...`, with the same token and address.
process.argv.splice(2, 0, "official");
await import("./feedback.mjs");
