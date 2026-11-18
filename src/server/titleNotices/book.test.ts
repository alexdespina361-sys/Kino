import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../accounts/persistence";
import { HOLD_MS, TELLS_PER_DAY, TITLES_PER_LOOK, TitleNoticeBook, type Follower } from "./book";
import { showNowOf, type FilmNow, type FilmPart, type ShowNow, type TitleSource } from "./source";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (day: string, hour = 0) => Date.parse(`${day}T00:00:00Z`) + hour * HOUR;

/** A movie database that says what the test put in it, and counts what it was asked. */
function fakeSource() {
  const shows = new Map<number, ShowNow | null>();
  const films = new Map<number, FilmNow | null>();
  const series = new Map<number, FilmPart[] | null>();
  const home = new Set<number>();
  const asked: string[] = [];
  let down = false;
  const answer = <T>(what: string, value: T | undefined): T | null => {
    asked.push(what);
    if (down) throw new Error("no answer");
    return value ?? null;
  };
  const source: TitleSource = {
    show: async (id) => answer(`tv-${id}`, shows.get(id)),
    film: async (id) => answer(`movie-${id}`, films.get(id)),
    parts: async (id) => answer(`col-${id}`, series.get(id)),
    outAtHome: async (id) => {
      asked.push(`home-${id}`);
      if (down) throw new Error("no answer");
      return home.has(id);
    },
  };
  return { source, shows, films, series, home, asked, setDown: (value: boolean) => void (down = value) };
}

const show = (season: number, episode: number, day: string, more: Partial<ShowNow> = {}): ShowNow => ({ name: "The Show", ended: false, last: { season, episode, day }, ...more });

async function setup(start = at("2026-11-10", 12)) {
  const tmdb = fakeSource();
  const clock = { now: start };
  const persistence = new MemoryPersistence();
  let followers: Follower[] = [];
  const told: string[] = [];
  const open = () => TitleNoticeBook.open({ persistence, source: tmdb.source, followers: () => followers, tell: (profile) => void told.push(profile), now: () => clock.now, flushMs: 0 });
  const book = await open();
  return { tmdb, clock, persistence, told, open, book, watch: (next: Follower[]) => void (followers = next) };
}

const watcher = (profile: string, keys: string[], more: Partial<Follower> = {}): Follower => ({ profile, on: true, child: false, titles: keys.map((key) => ({ key, title: `Title ${key}` })), ...more });

describe("what the movie database says of a show", () => {
  it("is its last episode that aired, never a special, and whether more is expected", () => {
    const raw = { name: "Show", status: "Returning Series", first_air_date: "2020-01-05", poster_path: "/p.jpg", last_episode_to_air: { season_number: 3, episode_number: 4, air_date: "2026-11-08" }, next_episode_to_air: { air_date: "2026-11-15" } };
    expect(showNowOf(raw)).toEqual({ name: "Show", image: "https://image.tmdb.org/t/p/w500/p.jpg", year: 2020, ended: false, last: { season: 3, episode: 4, day: "2026-11-08" }, nextDay: "2026-11-15" });
    expect(showNowOf({ ...raw, last_episode_to_air: { season_number: 0, episode_number: 7, air_date: "2026-11-08" } }).last).toBeNull();
    expect(showNowOf({ name: "Old", status: "Ended", last_episode_to_air: null }).ended).toBe(true);
    // (an answer with a part that cannot be read is still an answer)
    expect(showNowOf({ name: "Odd", last_episode_to_air: "soon", next_episode_to_air: 5 })).toEqual({ name: "Odd", ended: false, last: null });
  });
});

describe("new episodes of what a profile watches", () => {
  it("tells nothing of what is out when a show is first looked at, and of the next episode only a day and a half after the day it aired", async () => {
    const { tmdb, clock, told, book, watch } = await setup();
    tmdb.shows.set(7, show(2, 3, "2026-11-08", { nextDay: "2026-11-15" }));
    watch([watcher("ana", ["tv-7"])]);
    await book.look();
    expect(book.of("ana")).toEqual([]);
    expect(told).toEqual([]);

    // Nothing is asked again until the next episode is due (and then not before it has had its day and a half).
    clock.now = at("2026-11-14", 12);
    await book.look();
    expect(tmdb.asked).toEqual(["tv-7"]);

    // The day it airs, as the movie database dates it: listed, and not news yet.
    tmdb.shows.set(7, show(2, 4, "2026-11-15", { nextDay: "2026-11-22" }));
    clock.now = at("2026-11-15") + HOLD_MS - HOUR;
    await book.look();
    expect(book.of("ana")).toEqual([]);

    clock.now = at("2026-11-15") + HOLD_MS;
    await book.look();
    expect(book.of("ana")).toEqual([
      { id: "tv-7", at: clock.now, what: "episode", title: "The Show", url: "https://filmpire.sc/watch/7?s=1&e=1", season: 2, episode: 4, read: false },
    ]);
    expect(told).toEqual(["ana"]);
  });

  it("keeps one line for a show: episodes that come while it is unread are counted, and a new season says so", async () => {
    const { tmdb, clock, book, watch } = await setup();
    tmdb.shows.set(7, show(1, 5, "2026-11-01"));
    watch([watcher("ana", ["tv-7"])]);
    await book.look();

    clock.now += 2 * DAY;
    tmdb.shows.set(7, show(1, 7, "2026-11-09")); // (two at once: a double episode)
    await book.look();
    expect(book.of("ana")).toMatchObject([{ what: "episode", season: 1, episode: 7, count: 2 }]);

    clock.now += 2 * DAY;
    tmdb.shows.set(7, show(1, 8, "2026-11-11"));
    await book.look();
    expect(book.of("ana")).toMatchObject([{ what: "episode", season: 1, episode: 8, count: 3 }]);

    // Looked at: the next one is one episode again.
    book.seen("ana");
    clock.now += 2 * DAY;
    tmdb.shows.set(7, show(1, 9, "2026-11-13"));
    await book.look();
    const [again] = book.of("ana");
    expect(again).toMatchObject({ what: "episode", episode: 9, read: false });
    expect(again).not.toHaveProperty("count");

    clock.now += 2 * DAY;
    tmdb.shows.set(7, show(2, 1, "2026-11-15"));
    await book.look();
    expect(book.of("ana")).toMatchObject([{ what: "season", season: 2, episode: 1 }]);
    expect(book.of("ana")).toHaveLength(1);
  });

  it("tells of a show with an episode every day: each one a day and a half after its day, though a newer one has aired by then", async () => {
    const { tmdb, clock, told, book, watch } = await setup(at("2026-11-10", 12));
    tmdb.shows.set(7, show(1, 5, "2026-11-10", { nextDay: "2026-11-11" }));
    watch([watcher("ana", ["tv-7"])]);
    await book.look();
    const seen: Array<number | undefined> = [];
    // Looked at every hour for four days, as the days go by: the 11th's episode is out on the 11th, and so on.
    for (let hour = 13; hour <= 5 * 24; hour++) {
      clock.now = at("2026-11-10", hour);
      const day = Math.floor(hour / 24);
      tmdb.shows.set(7, show(1, 5 + day, `2026-11-${10 + day}`, { nextDay: `2026-11-${11 + day}` }));
      await book.look();
      const [item] = book.of("ana");
      if (item && item.episode !== seen[seen.length - 1]) {
        seen.push(item.episode);
        // Each is news from a day and a half after the start of its day.
        expect(clock.now).toBe(at(`2026-11-${10 + item.episode! - 5}`) + HOLD_MS);
        book.seen("ana");
      }
    }
    expect(seen).toEqual([6, 7, 8]);
    expect(told).toEqual(["ana", "ana", "ana"]);
    // (and the movie database was asked a few times a day, not every hour)
    expect(tmdb.asked.length).toBeLessThan(16);
  });

  it("does not tell of an episode the movie database took back", async () => {
    const { tmdb, clock, book, watch } = await setup(at("2026-11-10", 12));
    tmdb.shows.set(7, show(1, 5, "2026-11-08"));
    watch([watcher("ana", ["tv-7"])]);
    await book.look();
    clock.now = at("2026-11-11", 12);
    tmdb.shows.set(7, show(1, 6, "2026-11-11"));
    await book.look();
    tmdb.shows.set(7, show(1, 5, "2026-11-08")); // (it was listed by mistake)
    clock.now = at("2026-11-11") + HOLD_MS + HOUR;
    await book.look();
    expect(book.of("ana")).toEqual([]);
  });

  it("tells of an episode of one long season without its number, as its page numbers it in parts", async () => {
    const { tmdb, clock, book, watch } = await setup();
    tmdb.shows.set(7, show(1, 1122, "2026-11-01"));
    tmdb.shows.set(8, show(1, 26, "2026-11-01", { name: "Short" }));
    watch([watcher("ana", ["tv-7", "tv-8"])]);
    await book.look();
    clock.now += 2 * DAY;
    tmdb.shows.set(7, show(1, 1124, "2026-11-09"));
    tmdb.shows.set(8, show(1, 27, "2026-11-09", { name: "Short" }));
    await book.look();
    const long = book.of("ana").find((item) => item.id === "tv-7");
    expect(long).toMatchObject({ what: "episode", count: 2 });
    expect(long).not.toHaveProperty("season");
    expect(long).not.toHaveProperty("episode");
    // (the 27th of a first season is one such too: nobody can tell from here whether its page cuts it)
    expect(book.of("ana").find((item) => item.id === "tv-8")).not.toHaveProperty("episode");
  });

  it("starts a profile that begins a show later from what is out then, and tells each profile once", async () => {
    const { tmdb, clock, told, book, watch } = await setup();
    tmdb.shows.set(7, show(1, 5, "2026-11-01"));
    watch([watcher("ana", ["tv-7"])]);
    await book.look();

    watch([watcher("ana", ["tv-7"]), watcher("bob", ["tv-7"])]);
    clock.now += 2 * DAY;
    tmdb.shows.set(7, show(1, 6, "2026-11-09"));
    book.sweep(); // (bob is seen to watch it before anything new is known)
    await book.look();
    expect(book.of("ana")).toHaveLength(1);
    expect(book.of("bob")).toHaveLength(1);
    expect(told.sort()).toEqual(["ana", "bob"]);

    // One who comes after that has nothing to be told.
    watch([watcher("ana", ["tv-7"]), watcher("bob", ["tv-7"]), watcher("cat", ["tv-7"])]);
    book.sweep();
    clock.now += DAY;
    await book.look();
    expect(book.of("cat")).toEqual([]);
    expect(tmdb.asked.filter((what) => what === "tv-7")).toHaveLength(3); // (one question for everybody who watches it, each time it is due)
  });

  it("tells a profile that turned the notices off nothing, and brings no backlog when they are turned on again", async () => {
    const { tmdb, clock, told, book, watch } = await setup();
    tmdb.shows.set(7, show(1, 5, "2026-11-01"));
    watch([watcher("ana", ["tv-7"], { on: false })]);
    await book.look();
    clock.now += 2 * DAY;
    tmdb.shows.set(7, show(1, 6, "2026-11-09"));
    await book.look();
    expect(book.of("ana")).toEqual([]);
    expect(told).toEqual([]);

    watch([watcher("ana", ["tv-7"])]);
    clock.now += DAY;
    await book.look();
    expect(book.of("ana")).toEqual([]);
    clock.now += 2 * DAY;
    tmdb.shows.set(7, show(1, 7, "2026-11-12"));
    await book.look();
    expect(book.of("ana")).toMatchObject([{ episode: 7 }]);
    expect(book.of("ana")[0]).not.toHaveProperty("count");
  });

  it("asks about a show that is over once a week, and a running one with no day for its next episode once a day", async () => {
    const { tmdb, clock, book, watch } = await setup();
    tmdb.shows.set(1, show(5, 10, "2020-05-01", { ended: true }));
    tmdb.shows.set(2, show(1, 2, "2026-11-01"));
    watch([watcher("ana", ["tv-1", "tv-2"])]);
    await book.look();
    for (let day = 1; day <= 7; day++) {
      clock.now += DAY;
      await book.look();
    }
    expect(tmdb.asked.filter((what) => what === "tv-1")).toHaveLength(2);
    expect(tmdb.asked.filter((what) => what === "tv-2")).toHaveLength(8);
  });

  it("asks about a few titles at a look, the ones due the longest first", async () => {
    const { tmdb, clock, book, watch } = await setup();
    const keys = Array.from({ length: TITLES_PER_LOOK + 3 }, (_, index) => `tv-${index + 1}`);
    for (const key of keys) tmdb.shows.set(Number(key.slice(3)), show(1, 1, "2026-11-01"));
    watch([watcher("ana", keys)]);
    await book.look();
    expect(tmdb.asked).toHaveLength(TITLES_PER_LOOK);
    clock.now += 60_000;
    await book.look();
    expect(new Set(tmdb.asked).size).toBe(keys.length);
    expect(book.usage()).toMatchObject({ titles: keys.length, due: 0, asked: keys.length, failed: 0 });
  });

  it("keeps what it knew when the movie database cannot be asked, and asks again in a while", async () => {
    const { tmdb, clock, book, watch } = await setup();
    tmdb.shows.set(7, show(1, 5, "2026-11-01"));
    watch([watcher("ana", ["tv-7"])]);
    await book.look();
    clock.now += 2 * DAY;
    tmdb.setDown(true);
    tmdb.shows.set(7, show(1, 6, "2026-11-09"));
    await book.look();
    expect(book.of("ana")).toEqual([]);
    expect(book.usage().failed).toBe(1);
    clock.now += 10 * 60_000;
    await book.look(); // (not yet)
    expect(tmdb.asked).toHaveLength(2);
    tmdb.setDown(false);
    clock.now += 30 * 60_000;
    await book.look();
    expect(book.of("ana")).toMatchObject([{ episode: 6 }]);
  });

  it("is kept across a restart: nothing is asked again before its time, and nobody is told twice", async () => {
    const { tmdb, clock, told, open, book, watch } = await setup();
    tmdb.shows.set(7, show(1, 5, "2026-11-01", { ended: true }));
    watch([watcher("ana", ["tv-7"])]);
    await book.look();
    clock.now += 8 * DAY;
    tmdb.shows.set(7, show(1, 6, "2026-11-12", { ended: true }));
    await book.look();
    expect(told).toEqual(["ana"]);
    await book.close();

    const again = await open();
    expect(again.of("ana")).toMatchObject([{ episode: 6, read: false }]);
    clock.now += DAY;
    await again.look();
    expect(tmdb.asked).toHaveLength(2);
    expect(told).toEqual(["ana"]);
    expect(again.of("ana")).toHaveLength(1);
  });

  it("says so when what changed cannot be kept, tries again by itself, and lets nothing fall on the floor", async () => {
    const tmdb = fakeSource();
    const inner = new MemoryPersistence();
    let broken = true;
    let saves = 0;
    const persistence = {
      load: () => inner.load(),
      save: async (changes: Parameters<MemoryPersistence["save"]>[0]) => {
        saves++;
        if (broken) throw new Error("disk full");
        await inner.save(changes);
      },
    };
    const warned: string[] = [];
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const book = await TitleNoticeBook.open({ persistence, source: tmdb.source, followers: () => [watcher("ana", ["tv-7"])], flushMs: 5, log: { warn: (message) => void warned.push(message) } });
      tmdb.shows.set(7, show(1, 5, "2026-11-01"));
      await book.look();
      await new Promise((resolve) => setTimeout(resolve, 60)); // (the timer's save fails)
      expect(saves).toBeGreaterThan(0);
      expect(warned.some((line) => line.includes("disk full"))).toBe(true);
      expect(unhandled).toEqual([]);
      // Once it can be kept again, it is: nothing was forgotten.
      broken = false;
      await book.flush();
      expect([...(await inner.load()).keys()].sort()).toEqual(["p:ana", "t:tv-7"]);
      await book.close();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("tells a profile's phone a few times a day at most, though the bell has every one", async () => {
    const { tmdb, clock, told, book, watch } = await setup();
    const keys = Array.from({ length: TELLS_PER_DAY + 2 }, (_, index) => `tv-${index + 1}`);
    for (const key of keys) tmdb.shows.set(Number(key.slice(3)), show(1, 1, "2026-11-01"));
    // (The shows are begun an hour apart, so each is asked about again an hour after the one before it.)
    for (let count = 1; count <= keys.length; count++) {
      watch([watcher("ana", keys.slice(0, count))]);
      await book.look();
      clock.now += HOUR;
    }
    for (const key of keys) tmdb.shows.set(Number(key.slice(3)), show(1, 2, "2026-11-09"));
    clock.now = at("2026-11-11", 12);
    for (let hour = 0; hour < keys.length; hour++) {
      await book.look();
      clock.now += HOUR;
    }
    expect(book.of("ana")).toHaveLength(keys.length);
    expect(told).toHaveLength(TELLS_PER_DAY);
    // The next day it is told again.
    tmdb.shows.set(1, show(1, 3, "2026-11-10"));
    clock.now = at("2026-11-12", 13);
    await book.look();
    expect(told).toHaveLength(TELLS_PER_DAY + 1);
  });

  it("lets a profile look at them and clear one, and lets go of those older than a month", async () => {
    const { tmdb, clock, book, watch } = await setup();
    tmdb.shows.set(7, show(1, 5, "2026-11-01"));
    tmdb.shows.set(8, show(1, 5, "2026-11-01", { name: "Other" }));
    watch([watcher("ana", ["tv-7", "tv-8"])]);
    await book.look();
    clock.now += 2 * DAY;
    tmdb.shows.set(7, show(1, 6, "2026-11-09"));
    tmdb.shows.set(8, show(1, 6, "2026-11-09", { name: "Other" }));
    await book.look();
    expect(book.of("ana").map((item) => item.read)).toEqual([false, false]);
    // The ones its bell listed are looked at, the rest are news still.
    expect(book.seen("ana", ["tv-8", "tv-99"]).map((item) => [item.id, item.read])).toEqual(expect.arrayContaining([["tv-7", false], ["tv-8", true]]));
    expect(book.seen("ana").map((item) => item.read)).toEqual([true, true]);
    expect(book.dismiss("ana", "tv-7").map((item) => item.id)).toEqual(["tv-8"]);
    expect(book.of("nobody")).toEqual([]);
    clock.now += 31 * DAY;
    expect(book.of("ana")).toEqual([]);
  });

  it("forgets what a profile no longer watches, and a profile that is gone", async () => {
    const { tmdb, clock, persistence, book, watch } = await setup();
    tmdb.shows.set(7, show(1, 5, "2026-11-01"));
    tmdb.shows.set(8, show(1, 5, "2026-11-01"));
    watch([watcher("ana", ["tv-7"]), watcher("bob", ["tv-8"])]);
    await book.look();
    await book.flush();
    expect([...persistence.docs.keys()].sort()).toEqual(["p:ana", "p:bob", "t:tv-7", "t:tv-8"]);

    watch([watcher("ana", [])]);
    clock.now += 6 * 60_000;
    await book.look();
    await book.flush();
    expect([...persistence.docs.keys()]).toEqual(["p:ana"]);
    expect(persistence.docs.get("p:ana")).toMatchObject({ shows: {} });
    expect(book.usage().titles).toBe(0);

    // Watched again, it starts from what is out by then.
    tmdb.shows.set(7, show(1, 9, "2026-11-05"));
    watch([watcher("ana", ["tv-7"])]);
    clock.now += 6 * 60_000;
    await book.look();
    expect(book.of("ana")).toEqual([]);
  });
});

describe("a new film of a series of films", () => {
  const parts = (...extra: FilmPart[]): FilmPart[] => [{ id: 100, name: "Part One", day: "2019-05-01", year: 2019 }, { id: 101, name: "Part Two", day: "2022-05-01", year: 2022 }, ...extra];

  async function watching(more: Partial<Follower> = {}) {
    const all = await setup();
    const { tmdb, book, watch, clock } = all;
    tmdb.films.set(100, { name: "Part One", collection: 9 });
    tmdb.series.set(9, parts({ id: 102, name: "Part Three", day: "2026-10-20", year: 2026 }));
    watch([watcher("ana", ["movie-100"], more)]);
    await book.look(); // the film: it is one of a series
    clock.now += 60_000;
    await book.look(); // the series, for the first time
    return all;
  }

  it("is news once it can be watched at home, with the film the profile watched; what was out when the series was first looked at is not", async () => {
    const { tmdb, clock, told, book } = await watching();
    expect(book.of("ana")).toEqual([]);
    // (only the film that is new was asked about: the old ones are out at home for sure)
    expect(tmdb.asked).toEqual(["movie-100", "col-9", "home-102"]);

    clock.now += DAY;
    await book.look();
    expect(book.of("ana")).toEqual([]); // in cinemas only

    tmdb.home.add(102);
    clock.now += DAY;
    await book.look();
    expect(book.of("ana")).toEqual([{ id: "movie-102", at: clock.now, what: "film", title: "Part Three", url: "https://filmpire.sc/watch/102", year: 2026, like: "Title movie-100", read: false }]);
    expect(told).toEqual(["ana"]);
    // (and once it is out, the series is looked at once a week)
    clock.now += 6 * DAY;
    await book.look();
    expect(tmdb.asked.filter((what) => what === "col-9")).toHaveLength(3);
  });

  it("is no news to a profile that has watched it already, nor ever to a child's profile", async () => {
    for (const more of [{ child: true }, {}] as Partial<Follower>[]) {
      const { tmdb, clock, book, watch } = await watching(more);
      if (!more.child) watch([watcher("ana", ["movie-100", "movie-102"])]);
      tmdb.home.add(102);
      clock.now += DAY;
      await book.look();
      expect(book.of("ana")).toEqual([]);
    }
  });

  it("asks nothing more of a film that is one of no series", async () => {
    const { tmdb, clock, book, watch } = await setup();
    tmdb.films.set(5, { name: "Alone" });
    watch([watcher("ana", ["movie-5"])]);
    await book.look();
    clock.now += 7 * DAY;
    await book.look();
    expect(tmdb.asked).toEqual(["movie-5"]);
  });
});
