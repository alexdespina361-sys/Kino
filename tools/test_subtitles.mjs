import { RomanianSubtitleManager } from "../src/server/subtitles/romanian.ts";

async function testSubtitles() {
  console.log("--- Testing Subtitle Backends ---");

  // Test cases:
  // 1. Movie: The Matrix (tt0133093 / TMDB 603)
  // 2. Movie: Inception (tt1375666 / TMDB 27205)
  // 3. Series: Breaking Bad S1E1 (tt0903747 / TMDB 1396)
  // 4. Series: Doctor Who S1E1 (tt0436992 / TMDB 57243)
  const testCases = [
    { imdbId: "tt0133093", tmdbId: 603, title: "The Matrix", year: 1999 },
    { imdbId: "tt1375666", tmdbId: 27205, title: "Inception", year: 2010 },
    { imdbId: "tt0903747", tmdbId: 1396, title: "Breaking Bad", season: 1, episode: 1 },
    { imdbId: "tt0436992", tmdbId: 57243, title: "Doctor Who", season: 1, episode: 1 }
  ];

  console.log("\n1. Testing OpenSubtitles Stremio Endpoint directly...");
  for (const tc of testCases) {
    const url = tc.season
      ? `https://opensubtitles-v3.strem.io/subtitles/series/${tc.imdbId}:${tc.season}:${tc.episode}.json`
      : `https://opensubtitles-v3.strem.io/subtitles/movie/${tc.imdbId}.json`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      const subs = data.subtitles || [];
      const roSubs = subs.filter(s => s.lang === "ron" || s.lang === "ro" || s.lang === "rum");
      const enSubs = subs.filter(s => s.lang === "eng" || s.lang === "en");
      console.log(`[OpenSubtitles] ${tc.title}: total=${subs.length}, RO=${roSubs.length}, EN=${enSubs.length} (status: ${res.status})`);
    } catch (e) {
      console.log(`[OpenSubtitles] ${tc.title} FAILED:`, e.message);
    }
  }

  console.log("\n2. Testing Subs.ro directly...");
  for (const tc of testCases) {
    try {
      const pageRes = await fetch("https://subs.ro/cautare", {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        signal: AbortSignal.timeout(6000),
      });
      const pageHtml = await pageRes.text();
      const antispamMatch = pageHtml.match(/name="antispam"\s+value="([^"]+)"/);
      const cookies = pageRes.headers.get("set-cookie") || "";
      if (!antispamMatch) {
        console.log(`[Subs.ro] ${tc.title}: antispam token missing in page HTML`);
        continue;
      }
      const form = new URLSearchParams();
      form.set("antispam", antispamMatch[1]);
      form.set("type", "subtitrari");
      form.set("external_id", tc.imdbId);
      form.set("titlu-film", tc.title);
      form.set("limba", "ro");

      const searchRes = await fetch("https://subs.ro/ajax/search", {
        method: "POST",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
          Referer: "https://subs.ro/cautare",
          Cookie: cookies,
        },
        body: form.toString(),
        signal: AbortSignal.timeout(8000),
      });
      const searchHtml = await searchRes.text();
      const matches = [...searchHtml.matchAll(/href="https:\/\/subs\.ro\/subtitrare\/([^\/]+)\/(\d+)"/g)];
      console.log(`[Subs.ro] ${tc.title}: status=${searchRes.status}, found=${matches.length} titles`);
    } catch (e) {
      console.log(`[Subs.ro] ${tc.title} FAILED:`, e.message);
    }
  }

  console.log("\n3. Testing Subtitrari-Noi.ro directly...");
  for (const tc of testCases) {
    try {
      const isTv = Boolean(tc.season && tc.episode);
      const body = new URLSearchParams({
        search_q: "1",
        query_q: tc.title,
        cautare: tc.title,
        tip: isTv ? "1" : "2",
      });
      const res = await fetch("https://www.subtitrari-noi.ro/paginare_filme.php", {
        method: "POST",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
          Referer: "https://www.subtitrari-noi.ro/",
        },
        body: body.toString(),
        signal: AbortSignal.timeout(8000),
      });
      const html = await res.text();
      const zipMatches = [...html.matchAll(/href="(?:\d+-)?(https:\/\/subtitrari-noi\.ro\/Arhive\/[^"]+\.zip)"/g)];
      console.log(`[Subtitrari-Noi] ${tc.title}: status=${res.status}, found=${zipMatches.length} zips`);
    } catch (e) {
      console.log(`[Subtitrari-Noi] ${tc.title} FAILED:`, e.message);
    }
  }

  console.log("\n4. Testing RomanianSubtitleManager (end-to-end)...");
  const mgr = new RomanianSubtitleManager();
  for (const tc of testCases) {
    const t0 = Date.now();
    const subs = await mgr.getSubtitles(tc);
    console.log(`[RomanianSubtitleManager] ${tc.title}: returned ${subs.length} tracks in ${Date.now() - t0}ms`);
    for (const s of subs.slice(0, 3)) {
      console.log(`   - ${s.label} (${s.url})`);
    }
  }
}

testSubtitles().catch(console.error);
