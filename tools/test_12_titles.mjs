async function resolveBuzz(id, isTv, s = "1", e = "1") {
  const embedUrl = isTv
    ? `https://vidsrc.buzz/embed/tv/${id}/${s}/${e}`
    : `https://vidsrc.buzz/embed/movie/${id}`;

  const res = await fetch(embedUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "referer": "https://www.2embed.cc/"
    },
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) return null;
  const html = await res.text();
  const qMatch = html.match(/var\s+Q\s*=\s*(\{[\s\S]*?\});/);
  if (!qMatch) return null;
  const q = JSON.parse(qMatch[1]);
  const servers = q.ssr?.servers || [];
  if (servers.length === 0) return null;

  const playStreams = [];
  for (const srv of servers.slice(0, 3)) {
    try {
      const playUrl = `https://vidsrc.buzz/pl/api.php?a=play&ref=${encodeURIComponent(srv.ref)}&t=${encodeURIComponent(q.t)}`;
      const pRes = await fetch(playUrl, {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "referer": embedUrl
        },
        signal: AbortSignal.timeout(8000)
      });
      if (!pRes.ok) continue;
      const pData = await pRes.json();
      if (pData?.url) {
        const fullStream = new URL(pData.url, "https://vidsrc.buzz/").href;
        playStreams.push({ name: srv.name || "Server", url: fullStream, type: pData.type || "hls" });
      }
    } catch {
      // ignore
    }
  }

  if (playStreams.length === 0) return null;
  return {
    stream: playStreams[0],
    alternates: playStreams.slice(1),
    embedUrl
  };
}

async function test12Titles() {
  const titles = [
    // 4 Anime
    { kind: "Anime", name: "Madoka Magica: Walpurgisnacht", id: 823219, isTv: false },
    { kind: "Anime", name: "Jujutsu Kaisen S1E1", id: 95479, isTv: true, s: 1, e: 1 },
    { kind: "Anime", name: "Attack on Titan S1E1", id: 1429, isTv: true, s: 1, e: 1 },
    { kind: "Anime", name: "Demon Slayer S1E1", id: 85937, isTv: true, s: 1, e: 1 },

    // 4 Movies
    { kind: "Movie", name: "The Odyssey", id: 332794, isTv: false },
    { kind: "Movie", name: "The Matrix", id: 603, isTv: false },
    { kind: "Movie", name: "Inception", id: 27205, isTv: false },
    { kind: "Movie", name: "Interstellar", id: 157336, isTv: false },

    // 4 Series
    { kind: "Series", name: "Doctor Who S1E1", id: 57243, isTv: true, s: 1, e: 1 },
    { kind: "Series", name: "Breaking Bad S1E1", id: 1396, isTv: true, s: 1, e: 1 },
    { kind: "Series", name: "Game of Thrones S1E1", id: 1399, isTv: true, s: 1, e: 1 },
    { kind: "Series", name: "The Boys S1E1", id: 76479, isTv: true, s: 1, e: 1 },
  ];

  console.log("=== Testing 12 Target Titles on Oracle Cloud ===");
  let passed = 0;
  for (const t of titles) {
    const t0 = Date.now();
    const result = await resolveBuzz(t.id, t.isTv, t.s, t.e);
    const ms = Date.now() - t0;
    if (result) {
      passed++;
      console.log(`[PASS] [${t.kind}] ${t.name}: Stream=${result.stream.url} (${result.stream.type}) in ${ms}ms [Alternates: ${result.alternates.length}]`);
    } else {
      console.log(`[FAIL] [${t.kind}] ${t.name}: Could not resolve in ${ms}ms`);
    }
  }
  console.log(`\nResult: ${passed} / ${titles.length} passed.`);
}

test12Titles().catch(console.error);
