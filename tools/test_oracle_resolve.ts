import { createFilmpireAdapter } from "../src/server/resolvers/adapters/filmpire.ts";

async function testAll12() {
  console.log("=== Testing 12 Target Titles with Filmpire Adapter ===");
  const adapter = createFilmpireAdapter();

  const targets = [
    // 4 Anime
    { kind: "Anime", name: "Madoka Magica: Walpurgisnacht", url: "https://filmpire.sc/watch/823219" },
    { kind: "Anime", name: "Jujutsu Kaisen S1E1", url: "https://filmpire.sc/watch/95479?s=1&e=1" },
    { kind: "Anime", name: "Attack on Titan S1E1", url: "https://filmpire.sc/watch/1429?s=1&e=1" },
    { kind: "Anime", name: "Demon Slayer S1E1", url: "https://filmpire.sc/watch/85937?s=1&e=1" },

    // 4 Movies
    { kind: "Movie", name: "The Odyssey", url: "https://filmpire.sc/watch/332794" },
    { kind: "Movie", name: "The Matrix", url: "https://filmpire.sc/watch/603" },
    { kind: "Movie", name: "Inception", url: "https://filmpire.sc/watch/27205" },
    { kind: "Movie", name: "Interstellar", url: "https://filmpire.sc/watch/157336" },

    // 4 Series
    { kind: "Series", name: "Doctor Who S1E1", url: "https://filmpire.sc/watch/57243?s=1&e=1" },
    { kind: "Series", name: "Breaking Bad S1E1", url: "https://filmpire.sc/watch/1396?s=1&e=1" },
    { kind: "Series", name: "Game of Thrones S1E1", url: "https://filmpire.sc/watch/1399?s=1&e=1" },
    { kind: "Series", name: "The Boys S1E1", url: "https://filmpire.sc/watch/76479?s=1&e=1" },
  ];

  let passed = 0;
  for (const t of targets) {
    const t0 = Date.now();
    try {
      const res = await adapter.resolve(new URL(t.url));
      const elapsed = Date.now() - t0;
      if (res.status === "success") {
        passed++;
        console.log(`[PASS] [${t.kind}] ${t.name} -> "${res.media.title}" in ${elapsed}ms | stream=${res.media.stream.url.slice(0, 60)}...`);
      } else {
        console.log(`[FAIL] [${t.kind}] ${t.name} -> status=${res.status} reason=${res.reason} in ${elapsed}ms`);
      }
    } catch (err) {
      console.log(`[ERR] [${t.kind}] ${t.name} -> error=${err.message} in ${Date.now() - t0}ms`);
    }
  }

  console.log(`\nResult: ${passed} / ${targets.length} passed.`);
  if (passed !== targets.length) {
    process.exit(1);
  }
}

testAll12().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
