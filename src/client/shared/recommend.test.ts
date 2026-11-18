import { describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "../../shared";
import { t } from "../i18n";
import { createLikeThis, titleOfPersonal, type Seed } from "./recommend";

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
    expect(again.look("k")).toBeNull(); // (the rows after it are laid out without it)
    expect(heard).toHaveBeenCalledTimes(1);
    again.ask(seed);
    await settle();
    expect(down).toHaveBeenCalledTimes(1);

    const refused = createLikeThis({ fetch: answering({}, false) as unknown as typeof fetch });
    refused.ask(seed);
    await settle();
    expect(refused.look("k")).toBeNull();
    // (a site opened again asks again)
    again.reset();
    expect(again.look("k")).toBeUndefined();
  });

  it("asks about so many titles and no more, whatever the pages want: the ones past it have no answer", async () => {
    const fetchFake = answering({ items: [item("1")] });
    const store = createLikeThis({ fetch: fetchFake as unknown as typeof fetch, max: 2 });
    for (const key of ["a", "b", "c"]) store.ask({ ...seed, key, url: `https://x.example/${key}` });
    expect(store.look("c")).toBeUndefined(); // (told a moment later, not while a page is being drawn)
    await settle();
    expect(fetchFake).toHaveBeenCalledTimes(2);
    expect(store.look("a")).toEqual([item("1")]);
    expect(store.look("c")).toBeNull();
  });
});
