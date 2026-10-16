export const BROWSER_STREAM_TIMEOUT_MS = 15_000;

/** An installed, site-scoped extension prepares the token; normal hls.js then fetches media directly with its header rules. */
export function prepareBrowserStream(raw: string): Promise<string> | undefined {
  let source: URL;
  try { source = new URL(raw); } catch { return; }
  // Hosts rotate per title/request. The extension validates and scopes each resolved host.
  if (source.protocol !== "https:" || source.username || source.password || source.port ||
      !source.pathname.startsWith("/pl/") || !source.pathname.endsWith(".m3u8")) return;
  if (document.documentElement?.getAttribute("data-kino-direct") !== "1") return;
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", receive); };
    const receive = (event: MessageEvent) => {
      const message = event.data;
      if (event.source !== window || event.origin !== location.origin || message?.channel !== "kino-direct" || message.type !== "prepared" || message.id !== id) return;
      cleanup();
      if (typeof message.error === "string") return reject(new Error(message.error));
      try {
        const url = new URL(message.url);
        if (url.origin !== source.origin || url.pathname !== source.pathname || url.username || url.password || !url.searchParams.get("token")) throw new Error("Invalid extension response");
        resolve(url.href);
      } catch (error) { reject(error); }
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error("The playback extension did not respond")); }, BROWSER_STREAM_TIMEOUT_MS);
    window.addEventListener("message", receive);
    window.postMessage({ channel: "kino-direct", type: "prepare", id, url: source.href }, location.origin);
  });
}
