const SITE_ORIGINS = ["https://kino.24-7.ro"];
const PROVIDERS = new Set(["farragoandfulcrum.website", "diaphanousdogma.website"]);
const tokens = new Map();
const pending = new Map();

async function hostToken(origin) {
  const cached = tokens.get(origin);
  if (cached && cached.expires > Date.now() + 60_000) return cached.value;
  if (pending.has(origin)) return pending.get(origin);
  const loading = (async () => {
    const response = await fetch(`${origin}/generate.php`, {
      credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", redirect: "error", signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Video provider returned HTTP ${response.status}`);
    const text = (await response.text()).trim();
    if (text.length > 16_384) throw new Error("Invalid video token");
    let value = text;
    try { const data = JSON.parse(text); value = data.token || data.data || text; } catch { /* Plain JWT is also supported. */ }
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid video token");
    const expires = Number(JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp) * 1000;
    if (!Number.isFinite(expires) || expires <= Date.now() + 60_000) throw new Error("Video token is expired");
    tokens.set(origin, { value, expires });
    return value;
  })().finally(() => pending.delete(origin));
  pending.set(origin, loading);
  return loading;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.channel !== "kino-direct" || message.type !== "prepare") return;
  (async () => {
    if (sender.id !== chrome.runtime.id || !sender.tab || !SITE_ORIGINS.includes(new URL(sender.url).origin)) throw new Error("This page is not Kino");
    if (typeof message.url !== "string" || message.url.length > 4096) throw new Error("Invalid video address");
    const url = new URL(message.url);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !PROVIDERS.has(url.hostname) ||
        !url.pathname.startsWith("/pl/") || !url.pathname.endsWith(".m3u8")) throw new Error("Unsupported video provider");
    // The token and every media request now originate from the viewer's own connection.
    url.searchParams.set("token", await hostToken(url.origin));
    url.searchParams.set("bypass_localize", "true");
    return url.href;
  })().then(url => respond({ url }), error => respond({ error: error instanceof Error ? error.message : "Could not prepare video" }));
  return true;
});
