// tools/check-upstream-token.mjs
// Verifies full flow: screenfetch4 -> container -> playerUrl -> streamApi -> streamOrigin -> generate.php -> master.m3u8

import { decryptWasm } from "../src/server/resolvers/adapters/filmpire.ts";

const urlArg = process.argv[2] || "https://filmpire.sc/watch/95479?s=1&e=1";

async function run() {
  console.log(`Checking upstream playback for: ${urlArg}`);

  const targetUrl = new URL(urlArg);
  const idMatch = urlArg.match(/\/watch\/(\d+)/);
  if (!idMatch) {
    console.error("Invalid URL format, expected /watch/<id>");
    process.exit(1);
  }
  const id = idMatch[1];
  const s = targetUrl.searchParams.get("s") || "1";
  const e = targetUrl.searchParams.get("e") || "1";
  const isTv = targetUrl.searchParams.has("s");
  const contentType = isTv ? "tv" : "movie";
  const tvQuery = s && e ? `&s=${encodeURIComponent(s)}&e=${encodeURIComponent(e)}` : "";

  // 1. screenfetch4
  const sfUrl = `https://screenfetch4.cyou/vs_src.php?type=${contentType}&id=${id}${tvQuery}`;
  console.log(`1. Requesting screenfetch4: ${sfUrl}`);
  const sfRes = await fetch(sfUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": `https://screenfetch4.cyou/embed/${contentType}?tmdb=${id}&o=https%3A%2F%2Ffilmpire.sc`,
      "Accept": "application/json"
    }
  });

  if (!sfRes.ok) {
    console.error(`   screenfetch4 failed: HTTP ${sfRes.status}`);
    process.exit(1);
  }
  const sfData = await sfRes.json();
  const containerUrl = sfData.src;
  console.log(`   Got containerUrl: ${containerUrl}`);

  // 2. Fetch container page
  console.log(`2. Fetching container page: ${containerUrl}`);
  const containerRes = await fetch(containerUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": "https://screenfetch4.cyou/",
      "Accept": "text/html"
    }
  });
  if (!containerRes.ok) {
    console.error(`   Container fetch failed: HTTP ${containerRes.status}`);
    process.exit(1);
  }
  const containerHtml = await containerRes.text();
  const playerMatch = containerHtml.match(/"playerUrl"\s*:\s*"([^"]+)"/i);
  if (!playerMatch?.[1]) {
    console.error(`   Could not find playerUrl in container HTML!`);
    process.exit(1);
  }
  const playerUrl = new URL(playerMatch[1].replace(/\\u0026/g, "&"), containerUrl).href;
  console.log(`   Got playerUrl: ${playerUrl}`);

  // 3. Fetch player page
  console.log(`3. Fetching player page: ${playerUrl}`);
  const playerRes = await fetch(playerUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": containerUrl,
      "Accept": "text/html"
    }
  });
  if (!playerRes.ok) {
    console.error(`   Player fetch failed: HTTP ${playerRes.status}`);
    process.exit(1);
  }
  const playerHtml = await playerRes.text();
  const configMatch = playerHtml.match(/window\.CONFIG\s*=\s*(\{[\s\S]*?\});/);
  if (!configMatch?.[1]) {
    console.error(`   Could not find window.CONFIG in player HTML!`);
    process.exit(1);
  }
  const config = JSON.parse(configMatch[1]);
  console.log(`   Got apiToken: ${config.apiToken ? config.apiToken.slice(0, 16) + '...' : 'none'}`);

  // 4. Fetch streamApi
  const streamBase = (config.streamBase || config.api || "").replace(/\\u0026/g, "&");
  const streamApiUrl = `${streamBase}&season=${encodeURIComponent(s)}&episode=${encodeURIComponent(e)}&stream_urls&api_token=${config.apiToken}`;
  console.log(`4. Fetching streamApi: ${streamApiUrl}`);
  const streamApiRes = await fetch(streamApiUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": playerUrl,
      "Accept": "application/json"
    }
  });
  if (!streamApiRes.ok) {
    console.error(`   streamApi failed: HTTP ${streamApiRes.status}`);
    process.exit(1);
  }
  const apiData = await streamApiRes.json();
  let streamUrls = [];
  const raw = apiData.data?.stream_urls;
  if (typeof raw === "string" && apiData.vs?.wasm_url) {
    streamUrls = await decryptWasm(fetch, raw, apiData.vs.wasm_url, playerUrl);
  } else if (Array.isArray(raw)) {
    streamUrls = raw;
  }
  console.log(`   Decrypted stream URLs count: ${streamUrls.length}`);
  if (streamUrls.length === 0) {
    console.error("   No stream URLs available!");
    process.exit(1);
  }
  const chosenStream = streamUrls[0];
  console.log(`   Chosen stream URL: ${chosenStream}`);

  // 5. Call generate.php on streamOrigin
  const streamOrigin = new URL(chosenStream).origin;
  const genUrl = `${streamOrigin}/generate.php?api_token=${encodeURIComponent(config.apiToken)}`;
  console.log(`5. Calling generate.php at: ${genUrl}`);
  const genRes = await fetch(genUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": playerUrl,
      "Accept": "*/*"
    }
  });
  console.log(`   generate.php status: ${genRes.status}`);
  const genText = await genRes.text();
  console.log(`   generate.php body:`, genText);

  if (!genRes.ok) {
    console.error("\nFAILURE: generate.php returned error!");
    process.exit(1);
  }

  let jwt = "";
  try {
    const parsed = JSON.parse(genText);
    jwt = parsed.token || parsed.data || genText;
  } catch {
    jwt = genText.trim();
  }

  // 6. Test playlist fetch
  const playlistUrl = `${chosenStream}?token=${encodeURIComponent(jwt)}&bypass_localize=true`;
  console.log(`6. Fetching master.m3u8 from: ${playlistUrl}`);
  const plRes = await fetch(playlistUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": playerUrl,
      "Accept": "*/*"
    }
  });
  console.log(`   master.m3u8 status: ${plRes.status}`);
  if (plRes.ok) {
    const plText = await plRes.text();
    console.log(`   master.m3u8 length: ${plText.length} bytes (starts with: ${plText.slice(0, 30)})`);
    console.log("\nALL STAGES PASSED (HTTP 200)!");
  } else {
    console.error(`\nFAILURE: master.m3u8 failed with HTTP ${plRes.status}`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
