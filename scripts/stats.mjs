process.argv.splice(2, 0, "stats");
await import("./feedback.mjs");
