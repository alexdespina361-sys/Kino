import { describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "../../shared";
import { t } from "../i18n";
import { ASK_AGAIN_MS, createLikeThis, titleOfPersonal, warm, type Seed } from "./recommend";
import { FIRST_ASKS } from "./taste";

const item = (id: string, title = `Title ${id}`): LibraryItem => ({ id, title, url: `/fixtures/${id}.mp4` });

describe("the name of a row of the profile's own", () => {
  it("says why the row is there", () => {
    expect(titleOfPersonal({ why: "watched", title: "Up" })).toBe(t("rows.because", { title: "Up" }));
    expect(titleOfPersonal({ why: "loved", title: "Up" })).toBe(t("rows.loved", { title: "Up" }));
    expect(titleOfPersonal({ why: "saved", title: "Up" })).toBe(t("rows.saved", { title: "Up" }));
    expect(titleOfPersonal({ why: "like", title: "Up" })).toBe(t("rows.moreLike", { title: "Up" }));
    expect(titleOfPersonal({ why: "picks", title: "" })).toBe(t("rows.picks"));
    expect(new Set(["watched", "loved", "saved", "like", "picks"].map((why) => titleOfPersonal({ why: why as Seed["why"], title: "Up" }))).size).toBe(5);
  });
});
describe("createLikeThis", () => {
  const seed: Seed = { key: "k", title: "T", url: "https://x.example/t?s=1&e=2", why: "watched" };
  const settle = async () => {
    for (let at = 0; at < 30; at++) await Promise.resolve();
  };
  const answering = (body: unknown, ok = true) => vi.fn(async (_input: RequestInfo | URL) => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response);

  it("asks the library once for a title, keeps the answer, and tells those who listen", async () => {
    const fetchFake = answering({ items: [item("1")] });
    const learn = vi.fn();
    const store = createLikeThis({ fetch: fetchFake as unknown as typeof fetch, learn });
    const heard = vi.fn();
    store.subscribe(heard);
    store.ask(seed);
    store.ask(seed);
    await settle();
    expect(fetchFake).toHaveBeenCalledTimes(1);
    expect(fetchFake.mock.calls[0]![0]).toBe(`/api/library/similar?url=${encodeURIComponent(seed.url)}`);
    expect(store.get("k")).toEqual([item("1")]);
    expect(learn).toHaveBeenCalledWith([item("1")]);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(store.version()).toBe(1);
    store.ask(seed);
    await settle();
    expect(fetchFake).toHaveBeenCalledTimes(1);
  });

  it("keeps that nothing was found; a question that failed or was refused has no answer, says so, and is not asked again", async () => {
    const nothing = answering({ nonsense: true });
    const store = createLikeThis({ fetch: nothing as unknown as typeof fetch });
    expect(store.look("k")).toBeUndefined();
    store.ask(seed);
    await settle();
    expect(store.look("k")).toEqual([]);
    store.ask(seed);
    await settle();
    expect(nothing).toHaveBeenCalledTimes(1);

    const down = vi.fn(async () => {
      throw new Error("down");
    });
    const again = createLikeThis({ fetch: down as unknown as typeof fetch });
    const heard = vi.fn();
    again.subscribe(heard);
    again.ask(seed);
    await settle();
    expect(again.get("k")).toBeUndefined();
    expect(again.look("k")).toBeNull();
    expect(heard).toHaveBeenCalledTimes(1);
    again.ask(seed);
    await settle();
    expect(down).toHaveBeenCalledTimes(1);

    const refused = createLikeThis({ fetch: answering({}, false) as unknown as typeof fetch });
    refused.ask(seed);
    await settle();
    expect(refused.look("k")).toBeNull();
    again.reset();
    expect(again.look("k")).toBeUndefined();
  });

  it("asks again what failed a while ago when a page of rows is next opened, and not before that long has passed", async () => {
    let up = false;
    let clock = 1_000_000;
    const fetchFake = vi.fn(async () => {
      if (!up) throw new Error("down");
      return { ok: true, status: 200, json: async () => ({ items: [item("1")] }) } as Response;
    });
    const store = createLikeThis({ fetch: fetchFake as unknown as typeof fetch, now: () => clock });
    const heard = vi.fn();
    store.subscribe(heard);
    store.ask(seed);
    await settle();
    expect(store.look("k")).toBeNull();
    up = true;
    clock += ASK_AGAIN_MS - 1;
    store.refresh();
    expect(store.look("k")).toBeNull();
    expect(heard).toHaveBeenCalledTimes(1);
    clock += 1;
    store.refresh();
    expect(store.look("k")).toBeUndefined();
    expect(heard).toHaveBeenCalledTimes(2);
    store.ask(seed);
    await settle();
    expect(store.look("k")).toEqual([item("1")]);
    expect(fetchFake).toHaveBeenCalledTimes(2);
    store.refresh();
    expect(heard).toHaveBeenCalledTimes(3);
  });

  it("counts the titles asked about by the hour: a screen that is never shut is not left without rows for good", async () => {
    let clock = 5_000_000;
    const fetchFake = answering({ items: [item("1")] });
    const store = createLikeThis({ fetch: fetchFake as unknown as typeof fetch, max: 1, now: () => clock });
    store.ask({ ...seed, key: "a" });
    store.ask({ ...seed, key: "b" });
    await settle();
    expect(store.look("b")).toBeNull();
    clock += 60 * 60_000;
    store.refresh();
    expect(store.look("b")).toBeUndefined();
    store.ask({ ...seed, key: "b" });
    await settle();
    expect(store.look("b")).toEqual([item("1")]);
  });

  it("keeps the rows a page was last given, by the page's name", () => {
    const store = createLikeThis({ fetch: answering({}) as unknown as typeof fetch });
    const rows = [{ id: "because:k", key: "k", title: "T", why: "watched" as const, items: [item("1")] }];
    expect(store.kept("p\nhome")).toBeUndefined();
    store.keep("p\nhome", rows);
    expect(store.kept("p\nhome")).toBe(rows);
    expect(store.kept("p\nmovie")).toBeUndefined();
    store.reset();
    expect(store.kept("p\nhome")).toBeUndefined();
  });

  it("asks about the first of a profile's titles as soon as they are its titles, and nothing of a profile that is still being read", async () => {
    const fetchFake = answering({ items: [] });
    const store = createLikeThis({ fetch: fetchFake as unknown as typeof fetch });
    const card = (name: string) => ({ key: `url:${name}`, at: 1, title: name, url: `https://x.example/${name}`, position: 10, duration: 100 });
    const data = { progress: Array.from({ length: FIRST_ASKS + 3 }, (_, at) => card(`p${at}`)), list: [], ratings: [], settings: {} as never, waiting: false };
    warm(store, { ...data, waiting: true });
    await settle();
    expect(fetchFake).toHaveBeenCalledTimes(0);
    warm(store, data);
    warm(store, data);
    await settle();
    expect(fetchFake).toHaveBeenCalledTimes(FIRST_ASKS);
  });

  it("asks about so many titles and no more, whatever the pages want: the ones past it have no answer", async () => {
    const fetchFake = answering({ items: [item("1")] });
    const store = createLikeThis({ fetch: fetchFake as unknown as typeof fetch, max: 2 });
    for (const key of ["a", "b", "c"]) store.ask({ ...seed, key, url: `https://x.example/${key}` });
    expect(store.look("c")).toBeUndefined();
    await settle();
    expect(fetchFake).toHaveBeenCalledTimes(2);
    expect(store.look("a")).toEqual([item("1")]);
    expect(store.look("c")).toBeNull();
  });
});
