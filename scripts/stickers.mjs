// The personal stickers, for the team: every one with who made it, one saved to look at, one taken down everywhere (src/shared/stickers.ts). The same as
// `node scripts/feedback.mjs stickers ...`, with the same token and address:
//
//   node scripts/stickers.mjs [--json]
//   node scripts/stickers.mjs show <name>
//   node scripts/stickers.mjs remove <name> --yes
//   node scripts/stickers.mjs remove-by <profile or account> --yes
process.argv.splice(2, 0, "stickers");
await import("./feedback.mjs");
