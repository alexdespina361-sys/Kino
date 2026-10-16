const SITE_ORIGINS = ["https://kino.24-7.ro"];
const tokens = new Map();
const pending = new Map();
let ruleUpdates = Promise.resolve();

function streamSource(raw) {
  if (typeof raw !== "string" || raw.length > 4096) throw new Error("Invalid video address");
  const url = new URL(raw);
  // The provider rotates unrelated domains. Accept its playlist shape on public DNS names,
  // while refusing credentials, IP literals, local names and arbitrary fetch paths.
  const publicName = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname) &&
    !/\.(?:localhost|local|internal|lan|home|arpa|test|invalid|example)$/i.test(url.hostname);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !publicName ||
      !url.pathname.startsWith("/pl/") || !url.pathname.endsWith(".m3u8")) throw new Error("Unsupported video provider");
  return url;
}

function prepareHeaders(hostname) {
  // Serialize changes: simultaneous loads must not allocate the same rule ID or lose a host.
  const update = ruleUpdates.then(async () => {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    if (rules.some(rule => rule.condition.requestDomains?.includes(hostname))) return;
    const id = Math.max(0, ...rules.map(rule => rule.id)) + 1;
    const oldest = [...rules].sort((a, b) => a.id - b.id);
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: oldest.slice(0, Math.max(0, rules.length - 99)).map(rule => rule.id),
      addRules: [{
        id, priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "Origin", operation: "remove" }, { header: "Referer", operation: "remove" }],
          responseHeaders: [
            { header: "Access-Control-Allow-Origin", operation: "set", value: "*" },
            { header: "Access-Control-Expose-Headers", operation: "set", value: "Content-Length, Content-Range, Accept-Ranges" },
          ],
        },
        condition: {
          initiatorDomains: ["kino.24-7.ro"], requestDomains: [hostname],
          regexFilter: "^https://" + hostname.replace(/\./g, "\\.") + "/",
          resourceTypes: ["xmlhttprequest", "media"],
        },
      }],
    });
  });
  ruleUpdates = update.catch(() => {});
  return update;
}

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
    const url = streamSource(message.url);
    await prepareHeaders(url.hostname);
    // The token and every media request now originate from the viewer's own connection.
    url.searchParams.set("token", await hostToken(url.origin));
    url.searchParams.set("bypass_localize", "true");
    return url.href;
  })().then(url => respond({ url }), error => respond({ error: error instanceof Error ? error.message : "Could not prepare video" }));
  return true;
});
