import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../accounts/persistence";
import { KEEP_MS, MARK_MS, MAX_RECORDS, OCCASION_GAP_MS, playKeyOf, UnavailableStore } from "./unavailable";

const film = "https://filmpire.sc/watch/603";
const episode = (season: number, number: number) => `https://filmpire.sc/watch/60572?s=${season}&e=${number}`;
const MIN = 60 * 1000;

async function storeAt(start = 1_000_000_000_000, persistence = new MemoryPersistence()) {
  let at = start;
  const store = await UnavailableStore.open({ persistence, now: () => at, flushMs: 0 });
  return { store, persistence, later: (ms: number) => (at += ms) };
}

describe("playKeyOf: the film or the episode a library link plays", () => {
  it("knows the film and the show's episodes by the same key whatever form the link has", () => {
    expect(playKeyOf(film)).toEqual({ key: "filmpire:movie:603", show: "filmpire:movie:603", titleId: "filmpire-movie-603" });
    const s23e3 = { key: "filmpire:tv:60572:23:3", show: "filmpire:tv:60572", titleId: "filmpire-tv-60572", season: 23, episode: 3 };
    expect(playKeyOf(episode(23, 3))).toEqual(s23e3);
    expect(playKeyOf("https://filmpire.cc/watch/60572?season=23&episode=3")).toEqual(s23e3);
    expect(playKeyOf("https://www.filmpire.sc/watch/60572?type=series&s=23&e=3")).toEqual(s23e3);
  });

  it("knows an anime site episode by its show and number, not by the key its link carries", () => {
    const one = playKeyOf("https://animeheaven.me/anime.php?pynn3&s=1&e=4&key=6f31e2ab5faa70eb14183e66185b46e3");
    expect(one).toEqual({ key: "animeheaven:pynn3:1:4", show: "animeheaven:pynn3", titleId: "animeheaven-series-pynn3", season: 1, episode: 4 });
    expect(playKeyOf("https://animeheaven.me/anime.php?pynn3&s=1&e=4&key=other")?.key).toBe(one!.key);
    expect(playKeyOf("https://animeheaven.me/anime.php?pynn3&s=1&e=1")?.show).toBe(one!.show);
  });

  it("keeps no link that is not the library's: a pasted page, a video file, a show's link without its episode", () => {
    for (const link of [
      "https://example.com/watch/603",
      "https://filmpire.sc.example.com/watch/603",
      "https://filmpire.sc/watch/603/extra",
      "https://filmpire.sc/watch/60572?type=series",
      "https://filmpire.sc/watch/60572?s=2",
      "https://animeheaven.me/anime.php?pynn3",
      "http://127.0.0.1:8787/fixtures/a.mp4",
      "javascript:alert(1)",
      "not a link",
    ])
      expect(playKeyOf(link), link).toBeNull();
  });
});

describe("UnavailableStore", () => {
  it("marks an episode only after two separate occasions found nothing, and every episode of the show is asked for with any of its links", async () => {
    const { store, later } = await storeAt();
    store.nothingFound(episode(23, 3), { title: "Pokémon", kind: "series" });
    expect(store.answerFor(episode(1, 1))).toEqual({ title: false, episodes: [] });
    later(2 * MIN);
    store.nothingFound(episode(23, 3));
    later(3 * 60 * MIN);
    store.nothingFound(episode(23, 3));
    expect(store.answerFor(episode(1, 1)).episodes).toEqual([]);
    later(OCCASION_GAP_MS);
    store.nothingFound(episode(23, 3));
    expect(store.answerFor(episode(1, 1))).toEqual({ title: false, episodes: [{ season: 23, episode: 3 }] });
    expect(store.answerFor("https://filmpire.sc/watch/60572?type=series&s=25&e=1").episodes).toEqual([{ season: 23, episode: 3 }]);
    expect(store.answerFor("https://filmpire.sc/watch/1399?s=1&e=1").episodes).toEqual([]);
  });

  it("marks a film itself, and one video found takes the mark away for good", async () => {
    const { store, later } = await storeAt();
    store.nothingFound(film);
    later(OCCASION_GAP_MS);
    store.nothingFound(film);
    expect(store.answerFor(film)).toEqual({ title: true, episodes: [] });
    store.found(film);
    expect(store.answerFor(film).title).toBe(false);
    expect(store.list()).toEqual([]);
    later(OCCASION_GAP_MS);
    store.nothingFound(film);
    expect(store.answerFor(film).title).toBe(false);
  });

  it("stops showing a mark nobody has met for two weeks, and forgets the record after two months", async () => {
    const { store, later } = await storeAt();
    store.nothingFound(film);
    later(OCCASION_GAP_MS);
    store.nothingFound(film);
    later(MARK_MS);
    expect(store.answerFor(film).title).toBe(false);
    expect(store.list()).toMatchObject([{ key: "filmpire:movie:603", occasions: 2, marked: false }]);
    later(KEEP_MS);
    expect(store.list()).toEqual([]);
  });

  it("lists for the team what people asked for most first, with what it is, and nothing about who asked", async () => {
    const { store, later } = await storeAt();
    store.nothingFound(film, { title: "The Matrix", kind: "movie" });
    store.nothingFound(episode(25, 6), { title: "Pokémon", kind: "series" });
    later(OCCASION_GAP_MS);
    store.nothingFound(episode(25, 6));
    const listed = store.list();
    expect(listed.map((record) => [record.title, record.season ?? null, record.episode ?? null, record.occasions, record.marked])).toEqual([
      ["Pokémon", 25, 6, 2, true],
      ["The Matrix", null, null, 1, false],
    ]);
    expect(Object.keys(listed[0]!).sort()).toEqual(["episode", "first", "key", "kind", "last", "link", "marked", "occasions", "season", "show", "title", "titleId", "v"]);
  });

  it("keeps what was heard across a restart, and keeps no more than its share", async () => {
    const persistence = new MemoryPersistence();
    const first = await storeAt(1_000_000_000_000, persistence);
    first.store.nothingFound(film);
    first.later(OCCASION_GAP_MS);
    first.store.nothingFound(film);
    await first.store.flush();
    const second = await storeAt(1_000_000_000_000 + OCCASION_GAP_MS + MIN, persistence);
    expect(second.store.answerFor(film).title).toBe(true);

    for (let n = 0; n < MAX_RECORDS + 5; n++) second.store.nothingFound(`https://filmpire.sc/watch/${n + 1}?s=1&e=1`);
    await second.store.flush();
    expect(second.store.list()).toHaveLength(MAX_RECORDS);
    expect(persistence.docs.size).toBe(MAX_RECORDS);
    expect(second.store.answerFor(film).title).toBe(false);
  });

  it("does not keep a link that is not the library's", async () => {
    const { store } = await storeAt();
    store.nothingFound("https://someones.example/private/video-page");
    store.found("https://someones.example/private/video-page");
    expect(store.list()).toEqual([]);
  });
});
