import { afterEach, describe, expect, it } from "vitest";
import type { SettingKey } from "../../shared";
import { buildApp } from "../app";
import { MemoryPersistence } from "./persistence";
import { AccountStore } from "./store";
import { WATCHING_DAYS, watchedOnKino } from "./watching";

const DAY = 24 * 60 * 60_000;
const FILM = "https://filmpire.sc/watch/603";
const SHOW = (s: number, e: number) => `https://filmpire.sc/watch/1399?s=${s}&e=${e}`;
const apps: Array<{ close(): Promise<unknown> }> = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

async function world() {
  const clock = { now: Date.UTC(2026, 10, 18, 12) };
  const store = await AccountStore.open({ persistence: new MemoryPersistence(), flushMs: 0, now: () => clock.now });
  let made = 0;
  const person = () => {
    const account = store.createAccount(`person${++made}@example.com`, "x");
    if (!account.ok) throw new Error("could not make the account");
    return { account: account.value.id, profile: account.value.profiles[0]!.id };
  };
  const watch = (profile: string, url: string, more: Record<string, unknown> = {}) =>
    store.sync(profile, { since: 0, progress: [{ key: `url:${url}`, at: clock.now, title: "Anything a screen wrote", url, position: 300, duration: 6000, ...more }] });
  const set = (profile: string, key: SettingKey, value: unknown) => store.sync(profile, { since: 0, settings: [{ key, at: clock.now, value }] });
  return { clock, store, person, watch, set };
}

describe("what people watch on Kino", () => {
  it("is a title once people of three accounts watched it, the most watched first, and says nothing of who", async () => {
    const { store, person, watch } = await world();
    const [a, b, c] = [person(), person(), person()];
    for (const one of [a, b, c]) watch(one.profile, FILM);
    watch(a.profile, SHOW(1, 1));
    watch(b.profile, SHOW(2, 4));
    expect(watchedOnKino(store)).toEqual(["filmpire-movie-603"]);
    const second = store.addProfile(a.account, "Second", "owl");
    if (!second.ok) throw new Error("no second profile");
    watch(second.value.id, SHOW(1, 2));
    expect(watchedOnKino(store)).toEqual(["filmpire-movie-603"]);
    const d = person();
    watch(c.profile, SHOW(1, 3));
    watch(d.profile, SHOW(3, 1));
    expect(watchedOnKino(store)).toEqual(["filmpire-tv-1399", "filmpire-movie-603"]);
  });

  it("leaves out a child's profile, one that said no to sharing before, a few seconds, and last week's, but no longer an old switch turned off", async () => {
    const { clock, store, person, watch, set } = await world();
    const people = [person(), person(), person(), person(), person()];
    const [a, b, c, d, e] = people;
    for (const one of people) watch(one!.profile, FILM);
    expect(watchedOnKino(store)).toEqual(["filmpire-movie-603"]);
    set(a!.profile, "child", true);
    set(b!.profile, "friends", false);
    set(c!.profile, "publicWatching", false);
    clock.now += 1000;
    watch(d!.profile, FILM, { position: 5 });
    watch(e!.profile, FILM, { position: 5 });
    expect(watchedOnKino(store)).toEqual([]);
    clock.now += 1000;
    watch(d!.profile, FILM, { position: 5, done: true });
    expect(watchedOnKino(store)).toEqual([]);
    watch(e!.profile, FILM, { position: 5, done: true });
    expect(watchedOnKino(store)).toEqual(["filmpire-movie-603"]);
    clock.now += WATCHING_DAYS * DAY + 1;
    expect(watchedOnKino(store)).toEqual([]);
  });

  it("counts only the movie database's titles: a pasted link is nobody's business", async () => {
    const { store, person, watch } = await world();
    for (let i = 0; i < 4; i++) watch(person().profile, "https://example.com/home-video.mp4");
    expect(watchedOnKino(store)).toEqual([]);
  });

  it("is answered at /api/watching as the library knows the titles, never as a card says them", async () => {
    const { store, person, watch } = await world();
    for (let i = 0; i < 3; i++) watch(person().profile, FILM, { title: "<b>Look at me</b>", image: "https://evil.example/x.png" });
    const known = { id: "filmpire-movie-603", title: "Fight Club", year: 1999, url: FILM, image: "https://image.tmdb.org/t/p/w342/a.jpg", kind: "movie" as const };
    const asked: string[] = [];
    const source = { id: "test", name: "Test", load: async () => [], title: async (id: string) => (asked.push(id), id === known.id ? known : null) };
    const app = await buildApp({ logger: false, accounts: store, librarySources: [source] });
    apps.push(app);
    const res = await app.inject({ method: "GET", url: "/api/watching" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=600");
    const body = res.json() as { items: Array<Record<string, unknown>> };
    expect(body).toEqual({ items: [known] });
    expect(JSON.stringify(body)).not.toContain("Look at me");
    expect(JSON.stringify(body)).not.toContain("evil.example");
    await app.inject({ method: "GET", url: "/api/watching" });
    expect(asked).toEqual(["filmpire-movie-603"]);
  });

  it("is an empty row on a site with no accounts", async () => {
    const app = await buildApp({ logger: false, librarySources: [] });
    apps.push(app);
    expect((await app.inject({ method: "GET", url: "/api/watching" })).json()).toEqual({ items: [] });
  });
});
