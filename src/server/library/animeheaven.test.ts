import { describe, expect, it, vi } from "vitest";
import { animeHeavenSource, parseAnimeHeavenLink } from "./animeheaven";

const samplePopularHtml = `
<div class='info3 bc1'>
  <div class='similarimg'>
    <div class='p1'>
      <a href='anime.php?pynn3'>
        <img class='coverimg' src='image.php?dpnxp' alt='Dragon Ball Super: Beerus Anime Poster'>
      </a>
      <div class='similarname c'>
        <a href='anime.php?pynn3'>Dragon Ball Super: Beerus</a>
      </div>
    </div>
  </div>
</div>
`;

const sampleAnimePageHtml = `
<div class='infotitle c'>Dragon Ball Super: Beerus</div>
<div class='infodes c'>Beerus, the God of Destruction, awakens...</div>
<div class='posterimg'><img class='posterimg' src='image.php?dpnxp' alt='Dragon Ball Super: Beerus Anime Poster'></div>
<a class='c' id="6f31e2ab5faa70eb14183e66185b46e3" href='gate.php'>
  <div class='watch1'>Episode</div>
  <div class='watch2'>1</div>
</a>
<a class='c' id="fdf3cd8f7a34be5bb5cbb095841aed93" href='gate.php'>
  <div class='watch1'>Episode</div>
  <div class='watch2'>2</div>
</a>
`;

describe("animeHeavenSource", () => {
  it("parses animeheaven links accurately", () => {
    expect(parseAnimeHeavenLink("https://animeheaven.me/anime.php?pynn3")).toEqual({ slug: "pynn3" });
    expect(parseAnimeHeavenLink("https://animeheaven.me/anime.php?pynn3&s=1&e=1&key=abc")).toEqual({ slug: "pynn3" });
    expect(parseAnimeHeavenLink("https://other.com/anime.php?pynn3")).toBeNull();
  });

  it("loads popular and new anime lists", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("popular.php") || u.includes("new.php")) {
        return {
          ok: true,
          status: 200,
          text: async () => samplePopularHtml,
        } as unknown as Response;
      }
      return { ok: false, status: 404 } as unknown as Response;
    });

    const source = animeHeavenSource({ fetch: fetchMock as never });
    const rows = await source.load();
    expect(rows.length).toBeGreaterThan(0);
    const item = rows[0]?.items[0];
    expect(item?.title).toBe("Dragon Ball Super: Beerus");
    expect(item?.url).toBe("https://animeheaven.me/anime.php?pynn3&s=1&e=1");
    expect(item?.image).toBe("https://animeheaven.me/image.php?dpnxp");
  });

  it("searches anime by query", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain("search.php?s=Beerus");
      return {
        ok: true,
        status: 200,
        text: async () => samplePopularHtml,
      } as unknown as Response;
    });

    const source = animeHeavenSource({ fetch: fetchMock as never });
    const results = await source.search!("Beerus");
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("Dragon Ball Super: Beerus");
    expect(results[0]?.id).toBe("animeheaven-series-pynn3");
  });

  it("extracts episodes for an anime title", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain("anime.php?pynn3");
      return {
        ok: true,
        status: 200,
        text: async () => sampleAnimePageHtml,
      } as unknown as Response;
    });

    const source = animeHeavenSource({ fetch: fetchMock as never });
    const eps = await source.episodes!("https://animeheaven.me/anime.php?pynn3", 1);
    expect(eps).toHaveLength(2);
    expect(eps[0]).toEqual({
      season: 1,
      episode: 1,
      title: "Episode 1",
      url: "https://animeheaven.me/anime.php?pynn3&s=1&e=1&key=6f31e2ab5faa70eb14183e66185b46e3",
    });
    expect(eps[1]).toEqual({
      season: 1,
      episode: 2,
      title: "Episode 2",
      url: "https://animeheaven.me/anime.php?pynn3&s=1&e=2&key=fdf3cd8f7a34be5bb5cbb095841aed93",
    });
  });

  it("returns season 1 for seasons query", async () => {
    const source = animeHeavenSource();
    const s = await source.seasons!("https://animeheaven.me/anime.php?pynn3");
    expect(s).toEqual([1]);
  });
});
