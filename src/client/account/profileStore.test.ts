import { describe, expect, it } from "vitest";
import type { NormalizedMedia } from "../../shared";
import { AccountStore } from "../../server/accounts/store";
import { MemoryPersistence } from "../../server/accounts/persistence";
import { GUEST, ProfileStore, type StorageLike } from "./profileStore";

class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  getItem = (key: string) => this.items.get(key) ?? null;
  setItem = (key: string, value: string) => void this.items.set(key, value);
  removeItem = (key: string) => void this.items.delete(key);
}

const MIN = 60;
const stream = { url: "https://cdn.example/x.m3u8", type: "hls" as const };
const film = (n: number): NormalizedMedia => ({ title: `Film ${n}`, stream, page: `https://site.example/film/${n}`, poster: `/p${n}.jpg`, year: 2000 + n });
const episode = (n: number, next?: number): NormalizedMedia => ({
  title: `Show · S1 E${n}`,
  stream,
  page: `https://site.example/show?e=${n}`,
  series: { season: 1, episode: n, ...(next ? { next: { season: 1, episode: next, url: `https://site.example/show?e=${next}` } } : {}) },
});

/** A device: its own storage and clock. */
function device(start: number, storage = new MemoryStorage()) {
  const clock = { now: start };
  const store = new ProfileStore(storage, () => clock.now);
  return { store, storage, clock, advance: (ms: number) => void (clock.now += ms) };
}

describe("what is watched", () => {
  it("keeps one card per film or show, newest first, and marks the episodes", () => {
    const d = device(1_000_000);
    d.store.playbackStarted(film(1));
    d.advance(1000);
    d.store.playbackStarted(episode(1, 2));
    d.advance(1000);
    d.store.playbackAt(episode(1, 2), { currentTime: 600, duration: 45 * MIN });
    d.advance(1000);
    d.store.playbackStarted(film(2));

    const snapshot = d.store.getSnapshot();
    expect(snapshot.progress.map((card) => card.title)).toEqual(["Film 2", "Show", "Film 1"]);
    expect(snapshot.progress[1]).toMatchObject({ season: 1, episode: 1, position: 600 });
    expect(snapshot.watched).toMatchObject([{ show: "Show", season: 1, episode: 1, position: 600, done: false }]);
  });

  it("does not touch anything for a few more seconds of the same playback, and tells listeners when something does change", () => {
    const d = device(1_000_000);
    let notified = 0;
    d.store.subscribe(() => notified++);
    d.store.playbackStarted(film(1));
    d.store.playbackAt(film(1), { currentTime: 100, duration: 7200 });
    const after = d.store.getSnapshot();
    const count = notified;
    d.advance(1000);
    d.store.playbackAt(film(1), { currentTime: 102, duration: 7200 });
    expect(notified).toBe(count);
    expect(d.store.getSnapshot()).toBe(after);
    d.store.playbackAt(film(1), { currentTime: 140, duration: 7200 });
    expect(notified).toBe(count + 1);
  });

  it("points a finished episode at the next one, and takes a card off the row until it is watched again", () => {
    const d = device(1_000_000);
    d.store.playbackStarted(episode(1, 2));
    d.store.playbackAt(episode(1, 2), { currentTime: 45 * MIN - 10, duration: 45 * MIN });
    expect(d.store.getSnapshot().progress[0]).toMatchObject({ episode: 2, url: "https://site.example/show?e=2", position: 0 });
    expect(d.store.getSnapshot().watched[0]?.done).toBe(true);

    d.advance(1000);
    d.store.removeProgress("show:Show");
    expect(d.store.getSnapshot().progress).toEqual([]);
    d.advance(1000);
    d.store.playbackStarted(episode(2, 3));
    expect(d.store.getSnapshot().progress).toHaveLength(1);
  });

  it("keeps My List and the settings, and goes back to a default when a setting is cleared", () => {
    const d = device(1_000_000);
    d.store.setInList({ id: "1", title: "Film", url: "https://site.example/film/1#x", image: "/p.jpg", year: 1999 }, true);
    expect(d.store.getSnapshot().list).toMatchObject([{ key: "url:https://site.example/film/1", title: "Film", image: "/p.jpg" }]);
    d.advance(1000);
    d.store.setInList({ id: "1", title: "Film", url: "https://site.example/film/1" }, false);
    expect(d.store.getSnapshot().list).toEqual([]);

    d.store.setSetting("lang", "ro");
    d.store.setSetting("subtitleLanguages", ["ro", "en"]);
    expect(d.store.getSnapshot().settings).toEqual({ lang: "ro", subtitleLanguages: ["ro", "en"] });
    d.advance(1000);
    d.store.setSetting("lang", undefined);
    expect(d.store.getSnapshot().settings).toEqual({ subtitleLanguages: ["ro", "en"] });
  });
});

describe("keeping it on the device", () => {
  it("is still there after the page is opened again, and each place has its own copy", () => {
    const first = device(1_000_000);
    first.store.playbackStarted(film(1));
    first.store.flush();

    const again = device(2_000_000, first.storage);
    expect(again.store.getSnapshot().progress.map((card) => card.title)).toEqual(["Film 1"]);

    again.store.openScope("pro_a");
    expect(again.store.getSnapshot()).toMatchObject({ scope: "pro_a", progress: [] });
    again.store.playbackStarted(film(2));
    again.store.openScope(GUEST);
    expect(again.store.getSnapshot().progress.map((card) => card.title)).toEqual(["Film 1"]);
    again.store.openScope("pro_a");
    expect(again.store.getSnapshot().progress.map((card) => card.title)).toEqual(["Film 2"]);
  });

  it("writes by itself a moment after a change", async () => {
    const d = device(1_000_000);
    d.store.playbackStarted(film(1));
    expect(d.storage.items.has("kino.data.guest")).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(d.storage.items.has("kino.data.guest")).toBe(true);
  });

  it("takes in the history the screens kept before accounts, once", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "controller.history",
      JSON.stringify([{ url: "https://site.example/film/7", title: "Old film", position: 600, duration: 7200, at: 5 }, { url: "https://site.example/show?e=2", title: "Show · S1 E2", seriesKey: "Show", position: 100, duration: 2700, at: 9 }]),
    );
    storage.setItem("controller.watched", JSON.stringify([{ show: "Show", season: 1, episode: 1, position: 2690, duration: 2700, done: true, at: 3 }]));
    const d = device(1_000_000, storage);
    const snapshot = d.store.getSnapshot();
    expect(snapshot.progress.map((card) => [card.title, card.key])).toEqual([
      ["Show", "show:Show"],
      ["Old film", "url:https://site.example/film/7"],
    ]);
    expect(snapshot.watched).toMatchObject([{ show: "Show", season: 1, episode: 1, done: true }]);
    expect(storage.items.has("controller.history")).toBe(false);
    expect(storage.items.has("controller.watched")).toBe(false);
  });

  it("works without any storage at all", () => {
    const store = new ProfileStore(undefined);
    store.playbackStarted(film(1));
    expect(store.getSnapshot().progress).toHaveLength(1);
  });
});

describe("signing in on a screen that was used as a guest", () => {
  it("brings the guest's history into the profile, keeps the profile's own, and leaves the guest nothing", () => {
    const d = device(10_000_000);
    d.store.playbackStarted(film(1));
    d.advance(1000);
    d.store.setInList({ id: "g", title: "Guest pick", url: "https://site.example/film/5" }, true);
    d.store.setSetting("lang", "it");
    d.store.flush();

    d.store.openScope("pro_a");
    d.advance(1000);
    d.store.playbackStarted(film(2));
    d.store.setSetting("lang", "ro");
    expect(d.store.adoptGuest()).toBe(true);

    const snapshot = d.store.getSnapshot();
    expect(snapshot.progress.map((card) => card.title).sort()).toEqual(["Film 1", "Film 2"]);
    expect(snapshot.list.map((item) => item.title)).toEqual(["Guest pick"]);
    expect(snapshot.settings).toEqual({ lang: "ro" }); // the visitor's language does not replace the profile's

    d.store.openScope(GUEST);
    expect(d.store.getSnapshot().progress).toEqual([]);
    expect(d.store.getSnapshot().settings).toEqual({ lang: "it" });
    expect(d.store.adoptGuest()).toBe(false);
  });

  it("sends all of it to the server, though it is older than the last exchange", () => {
    const d = device(10_000_000);
    d.store.playbackStarted(film(1));
    d.store.openScope("pro_a");
    d.store.accept({ rev: 4, progress: [], watched: [], list: [], settings: [] }, new Map());
    d.advance(60_000);
    d.store.adoptGuest();
    expect(d.store.pending().request.progress).toHaveLength(1);
  });

  it("forgets a profile's copy when it is signed out", () => {
    const d = device(1_000_000);
    d.store.openScope("pro_a");
    d.store.playbackStarted(film(1));
    d.store.flush();
    d.store.forget("pro_a");
    d.store.openScope(GUEST);
    d.store.openScope("pro_a");
    expect(d.store.getSnapshot().progress).toEqual([]);
  });
});

describe("staying in step with the server", () => {
  async function server() {
    const accounts = await AccountStore.open({ persistence: new MemoryPersistence(), flushMs: 0, now: () => Date.now() });
    const created = accounts.createAccount("a@example.com", "hash");
    if (!created.ok) throw new Error("no account");
    const profile = accounts.profilesOf(created.value.id)[0]!;
    return { accounts, profile };
  }

  /** One round trip for a device, as the app makes it. */
  function sync(d: ReturnType<typeof device>, accounts: AccountStore, profileId: string) {
    const { request, sent } = d.store.pending();
    const response = accounts.sync(profileId, request);
    if (!response) throw new Error("no such profile");
    d.store.accept(response, sent);
    return response;
  }

  it("shares what one screen watched with another, and does not send the same thing twice", async () => {
    const { accounts, profile } = await server();
    const tv = device(Date.now() - 100_000);
    const phone = device(Date.now() - 100_000);
    tv.store.openScope(profile.id);
    phone.store.openScope(profile.id);

    tv.store.playbackStarted(episode(1, 2));
    tv.advance(1000);
    tv.store.playbackAt(episode(1, 2), { currentTime: 900, duration: 45 * MIN });
    sync(tv, accounts, profile.id);

    const received = sync(phone, accounts, profile.id);
    expect(received.progress).toMatchObject([{ title: "Show", position: 900 }]);
    expect(phone.store.getSnapshot().progress[0]).toMatchObject({ season: 1, episode: 1, position: 900 });
    expect(phone.store.getSnapshot().watched).toMatchObject([{ show: "Show", episode: 1 }]);

    // nothing new on either side: nothing to send, nothing comes back
    expect(phone.store.pending().request).toMatchObject({ progress: [], watched: [], list: [], settings: [] });
    expect(sync(tv, accounts, profile.id)).toMatchObject({ progress: [], watched: [] });
  });

  it("settles on the same answer when two screens change the same things in different order", async () => {
    const { accounts, profile } = await server();
    const tv = device(Date.now() - 100_000);
    const phone = device(Date.now() - 100_000);
    tv.store.openScope(profile.id);
    phone.store.openScope(profile.id);

    tv.store.setInList({ id: "1", title: "A", url: "https://site.example/a" }, true);
    phone.advance(500);
    phone.store.setInList({ id: "2", title: "B", url: "https://site.example/b" }, true);
    phone.store.setSetting("accent", "blue");
    tv.advance(1000);
    tv.store.setSetting("accent", "green"); // later than the phone's
    sync(phone, accounts, profile.id);
    sync(tv, accounts, profile.id);
    sync(phone, accounts, profile.id);

    for (const screen of [tv, phone]) {
      expect(screen.store.getSnapshot().list.map((item) => item.title).sort()).toEqual(["A", "B"]);
      expect(screen.store.getSnapshot().settings).toEqual({ accent: "green" });
    }
  });

  it("carries a removal to the screen that still shows the title", async () => {
    const { accounts, profile } = await server();
    const tv = device(Date.now() - 100_000);
    const phone = device(Date.now() - 100_000);
    tv.store.openScope(profile.id);
    phone.store.openScope(profile.id);
    phone.store.playbackStarted(film(1));
    sync(phone, accounts, profile.id);
    sync(tv, accounts, profile.id);
    expect(tv.store.getSnapshot().progress).toHaveLength(1);

    tv.advance(1000);
    tv.store.removeProgress(tv.store.getSnapshot().progress[0]!.key);
    sync(tv, accounts, profile.id);
    sync(phone, accounts, profile.id);
    expect(phone.store.getSnapshot().progress).toEqual([]);
  });

  it("sends everything again when the server has lost what it had", async () => {
    const { accounts, profile } = await server();
    const tv = device(Date.now() - 100_000);
    tv.store.openScope(profile.id);
    tv.store.playbackStarted(film(1));
    sync(tv, accounts, profile.id);
    tv.advance(1000);
    // a fresh server, as after a restart on a host that forgets its disk
    const lost = await server();
    const first = sync(tv, lost.accounts, lost.profile.id);
    expect(first.reset).toBe(true);
    sync(tv, lost.accounts, lost.profile.id);
    expect(lost.accounts.snapshot(lost.profile.id)!.progress).toHaveLength(1);
  });

  it("brings a guest's history to the account on the first sync after signing in", async () => {
    const { accounts, profile } = await server();
    const tv = device(Date.now() - 100_000);
    tv.store.playbackStarted(film(1)); // as a guest
    tv.store.flush();
    tv.store.openScope(profile.id);
    tv.advance(1000);
    expect(tv.store.adoptGuest()).toBe(true);
    sync(tv, accounts, profile.id);

    const other = device(Date.now() - 100_000);
    other.store.openScope(profile.id);
    sync(other, accounts, profile.id);
    expect(other.store.getSnapshot().progress.map((card) => card.title)).toEqual(["Film 1"]);
  });
});
