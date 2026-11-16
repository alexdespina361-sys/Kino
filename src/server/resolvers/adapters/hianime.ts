import { AnimeHintSchema, type AlternateSource, type NormalizedMedia, type SubtitleTrack } from "../../../shared";
import { sourceSkipTimes } from "../../anime/hint";
import {
  extractZokoStream,
  getHiAnimeEpisodes,
  HIANIME_BASE,
  resolveHiAnimeEpisodeStream,
} from "../../library/hianime";
import { providerFetch } from "../providerFetch";
import type { ResolveResult, SiteAdapter } from "../types";
import { streamAddress } from "./streamAddress";

const MAX_SUBTITLES = 40;

/** The show a HiAnime link is of, by its name in the link ("attack-on-titan-season-2-123" is "attack on titan season 2"), as a hint for AniSkip (anime/hint.ts). */
function animeOfSlug(slug: string, episode: number): Pick<NormalizedMedia, "anime"> {
  const title = slug.replace(/-?\d+$/, "").replace(/-/g, " ").trim();
  const anime = AnimeHintSchema.safeParse({ title, season: 1, episode });
  return title && anime.success ? { anime: anime.data } : {};
}

export function createHiAnimeAdapter(options: { fetch?: typeof fetch } = {}): SiteAdapter {
  const get = options.fetch ?? providerFetch();

  return {
    id: "hianime",
    domains: ["hianime.to", "www.hianime.to", "hianime.at", "www.hianime.at", "zokoanime.video"],

    async resolve(url: URL): Promise<ResolveResult> {
      try {
        // 1. Direct ZokoAnime embed URL: https://zokoanime.video/stream/...
        if (url.hostname.includes("zokoanime.video")) {
          const stream = await extractZokoStream(url.href, get);
          if (!stream) {
            return { status: "unsupported", reason: "Could not extract stream from ZokoAnime player." };
          }

          const proxiedUrl = streamAddress(stream.src, url.href, process.env, false);
          const subTracks: SubtitleTrack[] = stream.subtitles.slice(0, MAX_SUBTITLES).map((s, idx) => ({
            id: idx,
            url: `/api/proxy?url=${encodeURIComponent(s.src)}&format=vtt`,
            label: s.label.slice(0, 100),
            lang: s.lang.slice(0, 20),
          }));

          return {
            status: "success",
            resolver: "hianime",
            media: {
              title: "Anime Episode",
              stream: {
                url: proxiedUrl,
                type: "hls",
                directUrl: stream.src,
              },
              ...(subTracks.length > 0 ? { subtitles: subTracks } : {}),
              ...sourceSkipTimes(stream.skip),
              page: url.href,
            },
          };
        }

        // 2. HiAnime watch page URL: https://hianime.at/watch/pokemon-1879?ep=30873 or /watch/1879
        const pathParts = url.pathname.split("/").filter(Boolean);
        const slug = pathParts[pathParts.length - 1] || "";
        const idMatch = slug.match(/-([0-9]+)$/) || slug.match(/^([0-9]+)$/);
        const animeId = idMatch ? idMatch[1]! : "";

        if (!animeId) {
          return { status: "unsupported", reason: "Could not identify anime ID in HiAnime URL." };
        }

        const requestedEp = Number(url.searchParams.get("ep") || url.searchParams.get("e") || "1");
        const mode = url.searchParams.get("mode") === "dub" ? "dub" : "sub";

        const resolved = await resolveHiAnimeEpisodeStream(animeId, requestedEp, {
          mode,
          fetcher: get,
        });

        if (!resolved) {
          return { status: "unsupported", reason: "No playable stream found on HiAnime." };
        }

        const proxiedUrl = streamAddress(resolved.stream.src, resolved.embedUrl, process.env, false);
        const subTracks: SubtitleTrack[] = resolved.stream.subtitles.slice(0, MAX_SUBTITLES).map((s, idx) => ({
          id: idx,
          url: `/api/proxy?url=${encodeURIComponent(s.src)}&format=vtt`,
          label: s.label.slice(0, 100),
          lang: s.lang.slice(0, 20),
        }));

        const alternates: AlternateSource[] = [];
        if (resolved.altDubStream) {
          alternates.push({
            label: "Server 2 (English Dub)",
            stream: {
              url: streamAddress(resolved.altDubStream.stream.src, resolved.altDubStream.embedUrl, process.env, false),
              type: "hls",
              directUrl: resolved.altDubStream.stream.src,
            },
          });
        }

        // Fetch episode list for series metadata
        const eps = await getHiAnimeEpisodes(animeId, get);
        const currentIndex = eps.findIndex((ep) => ep.num === requestedEp);
        const nextEp = currentIndex !== -1 && currentIndex < eps.length - 1 ? eps[currentIndex + 1] : undefined;

        return {
          status: "success",
          resolver: "hianime",
          media: {
            title: `Anime Episode ${requestedEp}`,
            stream: {
              url: proxiedUrl,
              type: "hls",
              directUrl: resolved.stream.src,
            },
            ...(subTracks.length > 0 ? { subtitles: subTracks } : {}),
            ...(alternates.length > 0 ? { alternates } : {}),
            // (HiAnime's own times for its own stream; and the show's name, from the link, for AniSkip's: HiAnime has a page for each season, as AniList does.)
            ...sourceSkipTimes(resolved.stream.skip),
            ...animeOfSlug(slug, requestedEp),
            series: {
              season: 1,
              episode: requestedEp,
              next: nextEp
                ? {
                    season: 1,
                    episode: nextEp.num,
                    title: nextEp.title || `Episode ${nextEp.num}`,
                    url: `${HIANIME_BASE}/watch/${slug}?ep=${nextEp.num}`,
                  }
                : undefined,
            },
            page: url.href,
          },
        };
      } catch {
        return { status: "temporary_failure", reason: "Error resolving HiAnime stream." };
      }
    },
  };
}
