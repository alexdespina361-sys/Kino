import type { AlternateSource, EpisodeRef, SeriesInfo } from "../../../shared";
import type { ResolveResult, SiteAdapter } from "../types";
import { streamAddress } from "./streamAddress";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const BASE = "https://animeheaven.me";

export function createAnimeHeavenAdapter(): SiteAdapter {
  return {
    id: "animeheaven",
    domains: ["animeheaven.me", "www.animeheaven.me"],
    async resolve(url: URL): Promise<ResolveResult> {
      try {
        // 1. Extract slug from pathname or search params
        // URL can be:
        // https://animeheaven.me/anime.php?pynn3
        // https://animeheaven.me/anime.php?pynn3&s=1&e=1&key=6f31e2ab5faa70eb14183e66185b46e3
        // https://animeheaven.me/gate.php (with key in query or cookie)
        let slug = "";
        for (const [key, val] of url.searchParams.entries()) {
          if (val === "" && /^[a-z0-9]{4,10}$/i.test(key)) {
            slug = key;
            break;
          }
          if (key === "slug" || key === "id") {
            slug = val;
            break;
          }
        }
        let episodeKey = url.searchParams.get("key") || "";
        const requestedEp = Number(url.searchParams.get("e") || "1");

        let animeHtml = "";
        let animeTitle = "Anime Episode";

        if (slug) {
          try {
            const pageRes = await fetch(`${BASE}/anime.php?${slug}`, {
              headers: { "user-agent": UA },
            });
            if (pageRes.ok) {
              animeHtml = await pageRes.text();
              const titleMatch = animeHtml.match(/class=['"]infotitle[^'"]*['"]>([^<]+)<\/div>/i);
              if (titleMatch?.[1]) {
                animeTitle = titleMatch[1].trim();
              }
            }
          } catch {
            // non-fatal
          }
        }

        // 2. If episodeKey is not provided in URL, locate it from the page
        if (!episodeKey && animeHtml) {
          // If specific episode was requested, search for that episode's link
          const epMatches = [...animeHtml.matchAll(/<a[^>]+id\s*=\s*['"]([a-f0-9]{32})['"][^>]*>([\s\S]*?)<\/a>/g)];
          let foundKey = "";
          for (const m of epMatches) {
            const inner = m[2] || "";
            const key = m[1] || "";
            const epNum = Number(inner.match(/watch2[^>]*>(\d+)<\/div>/)?.[1] || "1");
            if (epNum === requestedEp && key) {
              foundKey = key;
              break;
            }
          }
          if (foundKey) {
            episodeKey = foundKey;
          } else {
            // Fallback to dfkey or first episode key
            const dfMatch = animeHtml.match(/var\s+dfkey\s*=\s*['"]([a-f0-9]{32})['"]/i);
            episodeKey = dfMatch?.[1] || epMatches[0]?.[1] || "";
          }
        }

        if (!episodeKey) {
          return { status: "unsupported", reason: "Could not find episode playback key on AnimeHeaven." };
        }

        // 3. Fetch gate.php with key cookie
        const gateRes = await fetch(`${BASE}/gate.php`, {
          headers: {
            "user-agent": UA,
            Cookie: `key=${episodeKey}`,
            Referer: slug ? `${BASE}/anime.php?${slug}` : `${BASE}/`,
          },
        });
        if (!gateRes.ok) {
          return { status: "temporary_failure", reason: "Could not reach AnimeHeaven gate." };
        }
        const gateHtml = await gateRes.text();

        // 4. Extract video sources from <source> tags
        const allSources = [...gateHtml.matchAll(/<source[^>]+src=['"]([^'"]+)['"]/gi)].flatMap((m) => (m[1] ? [m[1]] : []));
        // Filter out sponsor/ad roll (the genuine episode streams contain the episodeKey)
        const episodeStreams = allSources.filter((s) => s.includes(episodeKey));
        const streamUrls = episodeStreams.length > 0 ? episodeStreams : allSources;

        if (streamUrls.length === 0) {
          return { status: "unsupported", reason: "No video stream found for this episode." };
        }

        // Dedup streams while keeping unique hosts
        const uniqueStreams: string[] = [];
        const seenHosts = new Set<string>();
        for (const sUrl of streamUrls) {
          if (!sUrl) continue;
          try {
            const host = new URL(sUrl).host;
            if (!seenHosts.has(host)) {
              seenHosts.add(host);
              uniqueStreams.push(sUrl);
            }
          } catch {
            if (!uniqueStreams.includes(sUrl)) uniqueStreams.push(sUrl);
          }
        }

        const primaryStream = uniqueStreams[0] || streamUrls[0];
        if (!primaryStream) {
          return { status: "unsupported", reason: "No playable stream URL." };
        }
        const gateReferer = `${BASE}/gate.php`;
        const proxiedUrl = streamAddress(primaryStream, gateReferer, process.env);

        // 5. Build alternates for fallback servers
        const alternates: AlternateSource[] = [];
        for (let i = 1; i < uniqueStreams.length; i++) {
          const altUrl = uniqueStreams[i];
          if (!altUrl) continue;
          try {
            const host = new URL(altUrl).hostname.split(".")[0]?.toUpperCase() || `Server ${i + 1}`;
            alternates.push({
              label: `Server ${i + 1} (${host})`,
              stream: {
                url: streamAddress(altUrl, gateReferer, process.env),
                type: "mp4",
                directUrl: altUrl,
              },
            });
          } catch {
            // ignore
          }
        }

        // 6. Build series info if slug and episode are available
        let seriesInfo: SeriesInfo | undefined;
        if (slug && animeHtml) {
          const epMatches = [...animeHtml.matchAll(/<a[^>]+id\s*=\s*['"]([a-f0-9]{32})['"][^>]*>([\s\S]*?)<\/a>/g)];
          const episodeList: EpisodeRef[] = [];
          for (const m of epMatches) {
            const epKey = m[1];
            const inner = m[2];
            if (!epKey || !inner) continue;
            const epNum = Number(inner.match(/watch2[^>]*>(\d+)<\/div>/)?.[1] || "1");
            episodeList.push({
              season: 1,
              episode: epNum,
              title: `Episode ${epNum}`,
              url: `${BASE}/anime.php?${slug}&s=1&e=${epNum}&key=${epKey}`,
            });
          }
          // Sort episodes in ascending order
          episodeList.sort((a, b) => a.episode - b.episode);
          const currentIndex = episodeList.findIndex((ep) => ep.episode === requestedEp);
          const nextEpisode = currentIndex !== -1 && currentIndex < episodeList.length - 1 ? episodeList[currentIndex + 1] : undefined;

          seriesInfo = {
            season: 1,
            episode: requestedEp,
            episodes: episodeList.length > 0 ? episodeList : undefined,
            next: nextEpisode,
          };
        }

        const title = requestedEp > 0 ? `${animeTitle} · Episode ${requestedEp}` : animeTitle;

        return {
          status: "success",
          resolver: "animeheaven",
          media: {
            title,
            stream: {
              url: proxiedUrl,
              type: "mp4",
              directUrl: primaryStream,
            },
            series: seriesInfo,
            alternates: alternates.length > 0 ? alternates : undefined,
          },
        };
      } catch {
        return { status: "temporary_failure", reason: "Error resolving AnimeHeaven stream." };
      }
    },
  };
}
