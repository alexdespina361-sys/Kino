import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { baseTitle, createAnimeSkipLookup, namesSeason, plainTitle, sameShow, type AnimeSkipLookup } from "./skipTimes";

/**
 * AniList and AniSkip as they answer (the shapes are theirs; AniSkip's times are what it answered for Frieren's first episode, 16 Nov 2026: the opening is at
 * 3-93 s in a cut 1560 s long, and at 117-207 s in one 1510 s long). Nothing here asks the real ones.
 */
const FRIEREN = { idMal: 52991, episodes: 28, format: "TV", countryOfOrigin: "JP", title: { english: "Frieren: Beyond Journey’s End", romaji: "Sousou no Frieren" }, synonyms: [] };
const ANISKIP = [
  { interval: { startTime: 3.221, endTime: 93.221 }, skipType: "op", skipId: "a", episodeLength: 1559.949 },
  { interval: { startTime: 116.748, endTime: 206.748 }, skipType: "op", skipId: "b", episodeLength: 1510.092 },
  { interval: { startTime: 1417.135, endTime: 1507.135 }, skipType: "ed", skipId: "c", episodeLength: 1510.102 },
];

interface Fake {
  fetch: typeof fetch;
  asked: string[];
  aniList: Array<{ search: string }>;
}

/** AniList answers `media` to any search; AniSkip answers the results of the cuts within 60 s of the length asked (as it does: a near cut, not only the same). */
function fake({ media = [FRIEREN] as unknown[], aniListStatus = 200, aniSkipStatus = 200, results = ANISKIP } = {}): Fake {
  const asked: string[] = [];
  const aniList: Array<{ search: string }> = [];
  const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch: typeof globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const address = String(input);
    asked.push(address);
    if (address.startsWith("https://graphql.anilist.co")) {
      aniList.push((JSON.parse(String(init?.body)) as { variables: { search: string } }).variables);
      return answer(aniListStatus, { data: { Page: { media } } });
    }
    if (address.startsWith("https://api.aniskip.com/")) {
      const length = Number(new URL(address).searchParams.get("episodeLength"));
      const near = results.filter((result) => Math.abs(result.episodeLength - length) < 60);
      return near.length > 0 && aniSkipStatus === 200 ? answer(200, { found: true, results: near, message: "ok", statusCode: 200 }) : answer(aniSkipStatus === 200 ? 404 : aniSkipStatus, { found: false, results: [] });
    }
    throw new Error(`asked ${address}`);
  }) as typeof globalThis.fetch;
  return { fetch, asked, aniList };
}

const HINT = { title: "Frieren: Beyond Journey's End", season: 1, episode: 1 };

describe("names", () => {
  it("are words without accents, apostrophes or the season", () => {
    expect(plainTitle("Pokémon")).toBe("pokemon"); // (Gemini's cleaner made it "Pok mon")
    expect(plainTitle("Frieren: Beyond Journey’s End")).toBe(plainTitle("Frieren: Beyond Journey's End"));
    expect(baseTitle("Attack on Titan Season 2")).toBe("attack on titan");
    expect(baseTitle("Mob Psycho 100 (2016)")).toBe("mob psycho 100");
    expect(baseTitle("Re:ZERO 2nd Season Part 2")).toBe("re zero");
  });

  it("are the same show when the words are, or one name holds the other's (two words at least)", () => {
    expect(sameShow("Frieren: Beyond Journey's End", ["Frieren: Beyond Journey’s End"])).toBe(true);
    expect(sameShow("Demon Slayer: Kimetsu no Yaiba", ["Demon Slayer: Kimetsu no Yaiba Entertainment District Arc"])).toBe(true);
    expect(sameShow("Attack on Titan", ["Attack on Titan Season 2"])).toBe(true);
    expect(sameShow("Monster", ["Monster Musume: Everyday Life with Monster Girls"])).toBe(false); // (one word must be the whole name)
    expect(sameShow("The Simpsons", ["The Simpsons Movie Anime Fan Project"])).toBe(false); // (not half of the longer name)
    expect(sameShow("Frieren", ["Sousou no Frieren"])).toBe(false);
  });

  it("say a season", () => {
    expect(namesSeason(["Attack on Titan Season 2"], 2)).toBe(true);
    expect(namesSeason(["Re:ZERO 2nd Season"], 2)).toBe(true);
    expect(namesSeason(["Mob Psycho 100 II"], 2)).toBe(true);
    expect(namesSeason(["Mob Psycho 100 III"], 3)).toBe(true);
    expect(namesSeason(["Attack on Titan"], 2)).toBe(false);
    expect(namesSeason(["Mob Psycho 100"], 2)).toBe(false); // (100 is not 2)
  });
});

describe("AniSkip's times", () => {
  it("are the times of the cut of this length: Frieren's opening is at 117-207 s in the 1510 s cut, at 3-93 s in the 1560 s one, and nothing for a cut of 1300 s", async () => {
    const site = fake();
    const lookup = createAnimeSkipLookup({ fetch: site.fetch });
    expect(await lookup.find(HINT, 1510)).toEqual({ intro: { start: 116.75, end: 206.75 }, outro: { start: expect.closeTo(1417.14, 1), end: expect.closeTo(1507.14, 1) } });
    // (the 1560 s cut has an opening sent in, and no ending: the ending AniSkip has is the 1510 s cut's, 50 s away, and is not taken)
    expect(await lookup.find(HINT, 1560)).toEqual({ intro: { start: 3.22, end: 93.22 } });
    expect(await lookup.find(HINT, 1300)).toBeNull();
    // what was asked: by the length, and no "mixed" openings or endings (played over the story)
    const aniSkip = site.asked.filter((address) => address.includes("aniskip"));
    expect(aniSkip).toHaveLength(3);
    expect(aniSkip[0]).toBe("https://api.aniskip.com/v2/skip-times/52991/1?types=op&types=ed&types=recap&episodeLength=1510");
    for (const address of aniSkip) expect(address).not.toContain("mixed");
    // the id was asked of AniList once, for all three
    expect(site.aniList).toEqual([{ search: "Frieren: Beyond Journey's End" }]);
  });

  it("are not looked for when AniList's answer is another show, an earlier season, or has fewer episodes", async () => {
    const other = fake({ media: [{ ...FRIEREN, idMal: 1, title: { english: "Frieren Picture Drama Collection Special Edition", romaji: "x" } }] });
    expect(await createAnimeSkipLookup({ fetch: other.fetch }).find(HINT, 1510)).toBeNull();
    expect(other.asked.some((address) => address.includes("aniskip"))).toBe(false);

    const season2 = fake({ media: [{ ...FRIEREN, title: { english: "Frieren: Beyond Journey’s End", romaji: "Sousou no Frieren" } }] });
    expect(await createAnimeSkipLookup({ fetch: season2.fetch }).find({ ...HINT, season: 2 }, 1510)).toBeNull(); // (season 1 is not season 2)
    expect(season2.aniList.map((asked) => asked.search)).toEqual(["Frieren: Beyond Journey's End Season 2", "Frieren: Beyond Journey's End 2"]);

    const beyond = fake();
    expect(await createAnimeSkipLookup({ fetch: beyond.fetch }).find({ ...HINT, episode: 29 }, 1510)).toBeNull(); // (it has 28)

    const western = fake({ media: [{ ...FRIEREN, countryOfOrigin: "US" }] });
    expect(await createAnimeSkipLookup({ fetch: western.fetch }).find(HINT, 1510)).toBeNull();
  });

  it("takes the second of AniList's answers when the first is not the show", async () => {
    const site = fake({ media: [{ ...FRIEREN, idMal: 7, title: { english: "Something Else Entirely", romaji: "Betsu" } }, FRIEREN] });
    expect(await createAnimeSkipLookup({ fetch: site.fetch }).find(HINT, 1510)).not.toBeNull();
    expect(site.asked.filter((address) => address.includes("aniskip"))[0]).toContain("/52991/1?");
  });

  it("are left out when they cannot be believed for the video (an opening in the second half, an ending of four seconds)", async () => {
    const site = fake({
      results: [
        { interval: { startTime: 900, endTime: 990 }, skipType: "op", skipId: "x", episodeLength: 1510 },
        { interval: { startTime: 1500, endTime: 1504 }, skipType: "ed", skipId: "y", episodeLength: 1510 },
      ],
    });
    expect(await createAnimeSkipLookup({ fetch: site.fetch }).find(HINT, 1510)).toBeNull();
  });

  it("are asked once for the same question at once, kept, and not kept for long when the sites failed", async () => {
    let clock = 1_000_000;
    const site = fake();
    const lookup = createAnimeSkipLookup({ fetch: site.fetch, now: () => clock });
    const [one, two] = await Promise.all([lookup.find(HINT, 1510), lookup.find(HINT, 1510)]);
    expect(one).toEqual(two);
    expect(site.asked).toHaveLength(2); // (AniList once, AniSkip once)
    await lookup.find(HINT, 1510);
    expect(site.asked).toHaveLength(2); // kept

    const failing = fake({ aniListStatus: 500 });
    const flaky = createAnimeSkipLookup({ fetch: failing.fetch, now: () => clock });
    expect(await flaky.find(HINT, 1510)).toBeNull();
    expect(await flaky.find(HINT, 1510)).toBeNull();
    expect(failing.aniList).toHaveLength(1); // (a failure is kept a little while)
    clock += 3 * 60_000;
    await flaky.find(HINT, 1510);
    expect(failing.aniList).toHaveLength(2); // (and asked again after it)
  });

  it("asks AniList at most so often a minute for the whole server, and rests when AniList says so", async () => {
    let clock = 1_000_000;
    const site = fake({ media: [] });
    const lookup = createAnimeSkipLookup({ fetch: site.fetch, now: () => clock, perMinute: 2 });
    for (const title of ["One A", "Two B", "Three C"]) await lookup.find({ ...HINT, title }, 1510);
    expect(site.aniList).toHaveLength(2);
    clock += 61_000;
    await lookup.find({ ...HINT, title: "Three C" }, 1510); // (the one past the budget was not kept as "none": it is asked now)
    expect(site.aniList).toHaveLength(3);

    const busy = fake({ aniListStatus: 429 });
    const resting = createAnimeSkipLookup({ fetch: busy.fetch, now: () => clock });
    await resting.find({ ...HINT, title: "Four D" }, 1510);
    await resting.find({ ...HINT, title: "Five E" }, 1510);
    expect(busy.aniList).toHaveLength(1); // (a minute's rest after a 429)
  });
});

describe("/api/anime/skip", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });
  const asked: Array<[string, number, number, number]> = [];
  const lookup: AnimeSkipLookup = {
    async find(hint, length) {
      asked.push([hint.title, hint.season, hint.episode, length]);
      return hint.title === "Frieren" ? { intro: { start: 116.75, end: 206.75 } } : null;
    },
  };

  it("answers the times for the title, season, episode and length, kept by the browser an hour (ten minutes when there are none)", async () => {
    app = await buildApp({ animeSkip: lookup });
    const found = await app.inject("/api/anime/skip?title=Frieren&season=1&episode=3&length=1510.4");
    expect(found.statusCode).toBe(200);
    expect(found.json()).toEqual({ skip: { intro: { start: 116.75, end: 206.75 } } });
    expect(found.headers["cache-control"]).toBe("private, max-age=3600");
    expect(found.headers["access-control-allow-origin"]).toBeUndefined();
    expect(asked.at(-1)).toEqual(["Frieren", 1, 3, 1510.4]);
    const none = await app.inject("/api/anime/skip?title=Other&season=2&episode=1&length=1400");
    expect(none.json()).toEqual({ skip: null });
    expect(none.headers["cache-control"]).toBe("private, max-age=600");
  });

  it("turns away what is not a question it can answer, and another site's page", async () => {
    app = await buildApp({ animeSkip: lookup });
    const before = asked.length;
    for (const bad of ["", "?length=1500", "?title=Frieren", "?title=Frieren&length=30", "?title=Frieren&length=99999", "?title=Frieren&season=0&length=1500", "?title=Frieren&episode=1.5&length=1500", "?title=Frieren&length=abc", `?title=${"x".repeat(201)}&length=1500`, "?title=a&title=b&length=1500"]) {
      expect((await app.inject(`/api/anime/skip${bad}`)).statusCode, bad).toBe(400);
    }
    const elsewhere = await app.inject({ url: "/api/anime/skip?title=Frieren&length=1510", headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors" } });
    expect(elsewhere.statusCode).toBe(403);
    expect(asked.length).toBe(before);
  });

  it("answers that nothing is known when the host turned it off", async () => {
    const saved = process.env.ANIME_SKIP;
    try {
      process.env.ANIME_SKIP = "off";
      app = await buildApp();
      expect((await app.inject("/api/anime/skip?title=Frieren&length=1510")).json()).toEqual({ skip: null });
    } finally {
      if (saved === undefined) delete process.env.ANIME_SKIP;
      else process.env.ANIME_SKIP = saved;
    }
  });
});
