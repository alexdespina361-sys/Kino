import { createFilmpireAdapter } from "../src/server/resolvers/adapters/filmpire.ts";

async function run() {
  process.env.EDGE_STREAM_PROXY_URL = "https://kino-relay.24-7.ro";
  process.env.EDGE_STREAM_PROXY_KEY = "da35a95e5f58021f2d5f5633198c6aa6592acf68d516bd3a7b079891aca53fd5";
  const adapter = createFilmpireAdapter();
  const res = await adapter.resolve(new URL("https://filmpire.sc/watch/95479?s=1&e=1"));
  console.log("Resolve status:", res.status);
  if (res.status === "success") {
    console.log("Relay Stream URL:", res.media.stream.url);
    const fetchRes = await fetch(res.media.stream.url);
    console.log("Fetch relay status:", fetchRes.status);
    const text = await fetchRes.text();
    console.log("Body length:", text.length);
    console.log("Body preview:\n", text.slice(0, 150));
  } else {
    console.log("Failed:", res);
  }
}

run();
