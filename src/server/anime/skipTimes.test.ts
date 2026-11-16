import { describe, expect, it } from "vitest";
import {
  cleanAnimeTitle,
  fetchAniSkipTimes,
  getAnimeSkipTimes,
  resolveMalId,
} from "./skipTimes";

describe("anime skipTimes", () => {
  it("cleans anime titles from season, part and year suffixes", () => {
    expect(cleanAnimeTitle("Attack on Titan Season 2")).toBe("Attack on Titan");
    expect(cleanAnimeTitle("Chainsaw Man (2022)")).toBe("Chainsaw Man");
    expect(cleanAnimeTitle("Bleach: Thousand-Year Blood War Part 3")).toBe("Bleach: Thousand-Year Blood War");
  });

  it("resolves MAL ID via AniList GraphQL", async () => {
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("graphql.anilist.co")) {
        return Response.json({
          data: {
            Media: {
              id: 16498,
              idMal: 16498,
              title: { english: "Attack on Titan", romaji: "Shingeki no Kyojin" },
            },
          },
        });
      }
      return new Response("Not found", { status: 404 });
    };

    const malId = await resolveMalId("Attack on Titan", 1, fakeFetch);
    expect(malId).toBe(16498);
  });

  it("fetches and parses AniSkip timestamps for opening and ending", async () => {
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("aniskip.com")) {
        return Response.json({
          found: true,
          results: [
            {
              skipType: "op",
              interval: { startTime: 47.365, endTime: 137.365 },
            },
            {
              skipType: "ed",
              interval: { startTime: 1342.795, endTime: 1430.616 },
            },
          ],
        });
      }
      return new Response("Not found", { status: 404 });
    };

    const skip = await fetchAniSkipTimes(16498, 1, fakeFetch);
    expect(skip).toBeDefined();
    expect(skip?.intro).toEqual({ start: 47.37, end: 137.37 });
    expect(skip?.outro).toEqual({ start: 1342.8, end: 1430.62 });
  });

  it("uses valid providerSkip directly without calling network", async () => {
    let called = false;
    const fakeFetch: typeof fetch = async () => {
      called = true;
      return new Response("ok");
    };

    const skip = await getAnimeSkipTimes({
      title: "Attack on Titan",
      episode: 1,
      providerSkip: {
        intro: { start: 50, end: 140 },
        outro: { start: 1300, end: 1390 },
      },
      fetcher: fakeFetch,
    });

    expect(called).toBe(false); // No network calls made!
    expect(skip?.intro).toEqual({ start: 50, end: 140 });
    expect(skip?.outro).toEqual({ start: 1300, end: 1390 });
  });

  it("falls back to AniSkip when providerSkip is missing", async () => {
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("graphql.anilist.co")) {
        return Response.json({
          data: {
            Media: {
              id: 40748,
              idMal: 40748,
              title: { english: "Jujutsu Kaisen" },
            },
          },
        });
      }
      if (url.includes("aniskip.com")) {
        return Response.json({
          found: true,
          results: [
            {
              skipType: "op",
              interval: { startTime: 54.71, endTime: 145.11 },
            },
          ],
        });
      }
      return new Response("Not found", { status: 404 });
    };

    const skip = await getAnimeSkipTimes({
      title: "Jujutsu Kaisen",
      episode: 1,
      fetcher: fakeFetch,
    });

    expect(skip?.intro).toEqual({ start: 54.71, end: 145.11 });
    expect(skip?.outro).toBeUndefined();
  });
});
