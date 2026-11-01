// The owner's stats: how many accounts and how many visitors, by day (docs/stats.md). The same as `node scripts/feedback.mjs stats`,
// and it takes the same token and address; `--days 30` lists more days, `--json` gives the numbers as they are.
process.argv.splice(2, 0, "stats");
await import("./feedback.mjs");
