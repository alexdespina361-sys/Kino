import { afterEach, describe, expect, it } from "vitest";
import { CHECK_AGAIN_MS, checkForUpdate, forgetUpdates, isOtherBuild, offered, putOff, updateNow } from "./update";

const answering = (body: unknown, ok = true) => {
  const asked: string[] = [];
  const fetcher = (async (url: string) => {
    asked.push(url);
    return { ok, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return { asked, fetcher };
};

afterEach(() => forgetUpdates());

describe("a new Kino while a page is open", () => {
  it("is another build than the page's, as the site names it, and never for a page made for development", () => {
    expect(isOtherBuild("index-Ab1", "index-Zz9")).toBe(true);
    expect(isOtherBuild("index-Ab1", "index-Ab1")).toBe(false);
    expect(isOtherBuild("dev", "index-Zz9")).toBe(false);
    for (const odd of [null, undefined, 3, "", "index-", "../index-a", "index-a b", `index-${"a".repeat(81)}`]) expect(isOtherBuild("index-Ab1", odd), String(odd)).toBe(false);
  });

  it("is offered once the site serves another build, and not again once put off, until yet another is out", async () => {
    const first = answering({ build: "index-new1" });
    await checkForUpdate({ mine: "index-old", fetcher: first.fetcher, now: 0 });
    expect(first.asked).toEqual(["/api/build"]);
    expect(updateNow().found).toBe("index-new1");
    expect(offered(updateNow())).toBe(true);
    putOff();
    expect(offered(updateNow())).toBe(false);
    await checkForUpdate({ mine: "index-old", fetcher: first.fetcher, always: true, now: 1 });
    expect(offered(updateNow())).toBe(false);
    const second = answering({ build: "index-new2" });
    await checkForUpdate({ mine: "index-old", fetcher: second.fetcher, always: true, now: 2 });
    expect(offered(updateNow())).toBe(true);
  });

  it("says nothing for the page's own build, a site that names none, a failed answer or no network", async () => {
    for (const [body, ok] of [[{ build: "index-old" }, true], [{ build: null }, true], [{}, true], [{ build: "index-new" }, false]] as const) {
      forgetUpdates();
      await checkForUpdate({ mine: "index-old", fetcher: answering(body, ok).fetcher, now: 0 });
      expect(offered(updateNow()), JSON.stringify(body)).toBe(false);
    }
    forgetUpdates();
    const down = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(checkForUpdate({ mine: "index-old", fetcher: down, now: 0 })).resolves.toBeUndefined();
    expect(offered(updateNow())).toBe(false);
  });

  it("asks at most once a minute when the page is shown again, and a page made for development never asks", async () => {
    const site = answering({ build: "index-old" });
    await checkForUpdate({ mine: "index-old", fetcher: site.fetcher, now: 1000 });
    await checkForUpdate({ mine: "index-old", fetcher: site.fetcher, now: 1000 + CHECK_AGAIN_MS - 1 });
    expect(site.asked).toHaveLength(1);
    await checkForUpdate({ mine: "index-old", fetcher: site.fetcher, now: 1000 + CHECK_AGAIN_MS });
    expect(site.asked).toHaveLength(2);
    await checkForUpdate({ mine: "index-old", fetcher: site.fetcher, always: true, now: 1000 + CHECK_AGAIN_MS });
    expect(site.asked).toHaveLength(3);
    await checkForUpdate({ mine: "dev", fetcher: site.fetcher, always: true, now: 10 ** 9 });
    expect(site.asked).toHaveLength(3);
  });
});
