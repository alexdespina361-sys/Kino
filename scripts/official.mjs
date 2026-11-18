process.argv.splice(2, 0, "official");
await import("./feedback.mjs");
