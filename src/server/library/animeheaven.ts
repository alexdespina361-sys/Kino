import type { EpisodeDetail, LibraryItem, LibraryKind, LibraryRow } from "../../shared";
import type { LibrarySource } from "./library";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const BASE = "https://animeheaven.me";

export interface AnimeHeavenSourceOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function parseAnimeHeavenLink(link: string): { slug: string } | null {
  try {
    const url = new URL(link);
    if (!/(^|\.)animeheaven\.me$/i.test(url.hostname)) return null;
    for (const [key, val] of url.searchParams.entries()) {
      if (val === "" && /^[a-z0-9]{4,10}$/i.test(key)) {
        return { slug: key };
      }
      if (key === "slug" || key === "id") {
        return { slug: val };
      }
    }
    const match = /anime\.php\?([a-z0-9]+)/i.exec(url.search);
    return match ? { slug: match[1]! } : null;
  } catch {
    return null;
  }
}

export function animeHeavenSource(options: AnimeHeavenSourceOptions = {}): LibrarySource {
  const get = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  const fetchHtml = async (path: string): Promise<string> => {
    const url = path.startsWith("http") ? path : `${BASE}/${path.replace(/^\//, "")}`;
    const res = await get(url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`AnimeHeaven error: HTTP ${res.status}`);
    return res.text();
  };

  const parseItemCards = (html: string): LibraryItem[] => {
    const items: LibraryItem[] = [];
    const seen = new Set<string>();

    // Matches <div class='p1'><a href='anime.php?SLUG'><img ... src='IMG' alt='TITLE'></a>
    const p1Matches = [...html.matchAll(/<div class=['"]p1['"]>[\s\S]*?<a href=['"]anime\.php\?([a-z0-9]+)['"][^>]*>[\s\S]*?<img[^>]+src=['"]([^'"]+)['"][^>]*alt=['"]([^'"]+)['"][\s\S]*?<\/div>/gi)];
    for (const m of p1Matches) {
      const slug = m[1]!;
      if (seen.has(slug)) continue;
      seen.add(slug);
      const imgPath = m[2]!;
      const rawTitle = m[3]!.replace(/Anime Poster/i, "").trim();
      const image = imgPath.startsWith("http") ? imgPath : `${BASE}/${imgPath.replace(/^\//, "")}`;
      items.push({
        id: `animeheaven-series-${slug}`,
        title: rawTitle,
        kind: "series",
        image,
        url: `${BASE}/anime.php?${slug}&s=1&e=1`,
      });
    }

    if (items.length > 0) return items;

    // Fallback: match <a href='anime.php?SLUG'>TITLE</a>
    const linkMatches = [...html.matchAll(/<a[^>]+href=['"]anime\.php\?([a-z0-9]+)['"][^>]*>([\s\S]*?)<\/a>/gi)];
    for (const m of linkMatches) {
      const slug = m[1]!;
      if (seen.has(slug)) continue;
      const text = m[2]!.replace(/<[^>]+>/g, "").trim();
      if (!text || text === "1" || text.length <= 1) continue;
      seen.add(slug);
      items.push({
        id: `animeheaven-series-${slug}`,
        title: text,
        kind: "series",
        url: `${BASE}/anime.php?${slug}&s=1&e=1`,
      });
    }

    return items;
  };

  return {
    id: "animeheaven",
    name: "AnimeHeaven",
    async load(): Promise<LibraryRow[]> {
      const [popularHtml, newHtml] = await Promise.all([
        fetchHtml("popular.php").catch(() => ""),
        fetchHtml("new.php").catch(() => ""),
      ]);

      const rows: LibraryRow[] = [];
      if (popularHtml) {
        const popItems = parseItemCards(popularHtml);
        if (popItems.length > 0) {
          rows.push({
            id: "animeheaven-popular",
            title: "Trending Anime",
            source: "AnimeHeaven",
            kind: "series",
            items: popItems.slice(0, 30),
          });
        }
      }

      if (newHtml) {
        const newItems = parseItemCards(newHtml);
        if (newItems.length > 0) {
          rows.push({
            id: "animeheaven-new",
            title: "New Anime Releases",
            source: "AnimeHeaven",
            kind: "series",
            items: newItems.slice(0, 30),
          });
        }
      }

      return rows;
    },
    async search(query: string): Promise<LibraryItem[]> {
      const q = query.trim();
      if (!q) return [];
      try {
        const html = await fetchHtml(`search.php?s=${encodeURIComponent(q)}`);
        return parseItemCards(html);
      } catch {
        return [];
      }
    },
    async seasons(link: string): Promise<number[]> {
      const parsed = parseAnimeHeavenLink(link);
      if (!parsed) return [];
      return [1];
    },
    async episodes(link: string, season: number): Promise<EpisodeDetail[]> {
      const parsed = parseAnimeHeavenLink(link);
      if (!parsed || season !== 1) return [];

      try {
        const html = await fetchHtml(`anime.php?${parsed.slug}`);
        const epMatches = [...html.matchAll(/<a[^>]+id\s*=\s*['"]([a-f0-9]{32})['"][^>]*>([\s\S]*?)<\/a>/g)];
        const result: EpisodeDetail[] = [];

        for (const m of epMatches) {
          const key = m[1]!;
          const epNum = Number(m[2]!.match(/watch2[^>]*>(\d+)<\/div>/)?.[1] || "1");
          result.push({
            season: 1,
            episode: epNum,
            title: `Episode ${epNum}`,
            url: `${BASE}/anime.php?${parsed.slug}&s=1&e=${epNum}&key=${key}`,
          });
        }

        // Return sorted episodes
        return result.sort((a, b) => a.episode - b.episode);
      } catch {
        return [];
      }
    },
    async similar(link: string): Promise<LibraryItem[]> {
      const parsed = parseAnimeHeavenLink(link);
      if (!parsed) return [];
      try {
        const html = await fetchHtml(`anime.php?${parsed.slug}`);
        // Similar anime items appear under <div class='similarimg'>
        const simIdx = html.indexOf("class='similarimg'") || html.indexOf('class="similarimg"');
        if (simIdx !== -1) {
          return parseItemCards(html.slice(simIdx));
        }
        return [];
      } catch {
        return [];
      }
    },
  };
}
