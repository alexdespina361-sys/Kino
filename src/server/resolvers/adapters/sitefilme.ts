import type { ResolveResult, SiteAdapter } from "../types";
import { streamAddress } from "./streamAddress";

export function createSitefilmeAdapter(): SiteAdapter {
  return {
    id: "sitefilme",
    domains: ["sitefilme.com", "sitefilme.net", "sitefilme.org"],
    async resolve(url: URL): Promise<ResolveResult> {
      const { safeFetch } = await import("../safe-fetch");
      const { extractMedia } = await import("../html-extract");

      let page;
      try {
        page = await safeFetch(url);
      } catch {
        return { status: "temporary_failure", reason: "Could not open sitefilme page." };
      }

      const { title, candidates } = extractMedia(page.body, page.url);
      const best = candidates[0];
      if (!best) {
        return { status: "unsupported", reason: "Could not find video on sitefilme." };
      }

      // sitefilme streams (e.g. stf05.vip) enforce CORS (allow-origin: https://sitefilme.com)
      // and require the sitefilme referer. Route through the edge relay or the stream proxy (see `streamAddress`).
      const proxiedUrl = streamAddress(best.url, page.url.href);

      return {
        status: "success",
        resolver: "sitefilme",
        media: {
          title: title || "Sitefilme Video",
          stream: {
            url: proxiedUrl,
            type: best.type,
          },
          subtitles: best.subtitles,
        },
      };
    },
  };
}
