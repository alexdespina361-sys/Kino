import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { openDevice, PHONE, test, tvRoot, withLibrary } from "./helpers";

const films = [
  { id: "filmpire-movie-603", title: "The Matrix", year: 1999, kind: "movie", url: "/fixtures/sample.mp4?n=1" },
  { id: "filmpire-tv-1399", title: "A Long Show", year: 2011, kind: "series", url: "/fixtures/sample.mp4?n=2" },
  { id: "pasted", title: "Something pasted", url: "/fixtures/sample.mp4?n=3" },
];
const library = { updatedAt: Date.now(), rows: [{ id: "r1", title: "Classics", source: "Test Source", items: films }] };
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function serve(asked: string[]) {
  return async (context: BrowserContext) => {
    await withLibrary(library)(context);
    await context.route(/\/api\/library\/title\?/, (route) => {
      const id = new URL(route.request().url()).searchParams.get("id") ?? "";
      asked.push(id);
      return route.fulfill({ json: { item: id === "filmpire-movie-603" ? { ...films[0], title: "The Matrix", description: "A hacker learns the truth." } : null } });
    });
  };
}

async function open(browser: Browser, path: string, asked: string[] = [], device: Parameters<typeof openDevice>[1] = { viewport: { width: 1280, height: 720 } }): Promise<Page> {
  const page = await openDevice(browser, device, {}, serve(asked));
  await page.goto(path);
  await expect(page.getByTestId("tv-browse")).toBeVisible();
  return page;
}

const search = (page: Page) => new URL(page.url()).search;

test.describe("a title's own address", () => {
  test("names the title while its page is open, and nothing once it is closed; the history is not added to", async ({ browser }) => {
    const tv = await open(browser, "/tv");
    const entries = await tv.evaluate(() => history.length);
    await tv.getByTestId("tv-browse-tile").nth(0).click();
    await expect(tv.getByTestId("tv-detail")).toBeVisible();
    await expect.poll(() => search(tv)).toBe("?title=movie-603");
    await tv.getByTestId("tv-detail-close").click();
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
    await expect.poll(() => search(tv)).toBe("");

    await tv.getByTestId("tv-browse-tile").nth(1).click();
    await expect.poll(() => search(tv)).toBe("?title=tv-1399");
    await tv.getByTestId("tv-detail-close").click();
    await tv.getByTestId("tv-browse-tile").nth(2).click();
    await expect(tv.getByTestId("tv-detail")).toBeVisible();
    expect(search(tv)).toBe("");
    expect(await tv.evaluate(() => history.length)).toBe(entries);
  });

  test("opened, opens that title's page over Home; closed, Home is there under it", async ({ browser }) => {
    const asked: string[] = [];
    const tv = await open(browser, "/tv?title=movie-603", asked);
    await expect(tv.getByTestId("tv-detail")).toBeVisible();
    await expect(tv.getByTestId("tv-detail")).toContainText("The Matrix");
    expect(asked).toEqual(["filmpire-movie-603"]);
    expect(search(tv)).toBe("?title=movie-603");
    await tv.getByTestId("tv-detail-close").click();
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeVisible();
    await expect.poll(() => search(tv)).toBe("");
  });

  test("opens its page once: the library after a film from it, and a reload, are Home (the owner's report: the same page kept coming back)", async ({ browser }) => {
    const asked: string[] = [];
    const tv = await open(browser, "/tv?title=movie-603", asked);
    await expect(tv.getByTestId("tv-detail")).toContainText("The Matrix");
    await tv.getByTestId("tv-detail-play").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await expect.poll(() => search(tv)).toBe("");
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeVisible();
    await tv.waitForTimeout(600);
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
    expect(asked).toEqual(["filmpire-movie-603"]);
    await tv.reload();
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeVisible();
    await tv.waitForTimeout(600);
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
    expect(asked).toEqual(["filmpire-movie-603"]);
  });

  test("of a title nobody knows leaves Home, says so, and takes the title out of the address", async ({ browser }) => {
    const asked: string[] = [];
    const tv = await open(browser, "/tv?title=movie-999", asked);
    await expect.poll(() => asked).toEqual(["filmpire-movie-999"]);
    await expect.poll(() => search(tv)).toBe("");
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
    await expect(tv.getByTestId("tv-notice")).toHaveText("The title in that link couldn't be found. Here's the library.");
    const odd: string[] = [];
    const other = await open(browser, "/tv?title=../../etc", odd);
    await expect(other.getByTestId("tv-notice")).toHaveText("The title in that link couldn't be found. Here's the library.");
    await expect.poll(() => search(other)).toBe("");
    expect(odd).toEqual([]);
  });

  test("an address that is no page of the site opens the library as / does, says so, and is answered with a 404", async ({ browser }) => {
    const tv = await openDevice(browser, { viewport: { width: 1280, height: 720 } }, {}, serve([]));
    const answer = await tv.goto("/does-not-exist?role=tv");
    expect(answer?.status()).toBe(404);
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(tv.getByTestId("tv-notice")).toHaveText("There's no page at that address. Here's the library.");
    expect(new URL(tv.url()).pathname).toBe("/");
    expect(search(tv)).toBe("?role=tv");
    await tv.getByTestId("tv-browse-tile").first().click();
    await tv.getByTestId("tv-detail-play").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeVisible();
    await expect(tv.getByTestId("tv-notice")).toHaveCount(0);
    expect((await tv.goto("/tv"))?.status()).toBe(200);
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(tv.getByTestId("tv-notice")).toHaveCount(0);
  });

  test("the phone that is the remote says the same of an address that is no page of the site", async ({ browser }) => {
    const phone = await openDevice(browser, PHONE, {}, serve([]));
    expect((await phone.goto("/no/such/page"))?.status()).toBe(404);
    await expect(phone.getByTestId("pair-notice")).toHaveText("There's no page at that address.");
    expect(new URL(phone.url()).pathname).toBe("/");
  });

  test("on a computer, the browser's Back closes a title's page, then steps back through the library's pages to Home, as a phone's does", async ({ browser, baseURL }) => {
    const kept = [
      { name: "kino.fullscreen.left", value: "1" },
      { name: "kino.fit", value: "desk" },
    ];
    const pc = await open(browser, "/tv", [], { viewport: { width: 1280, height: 720 }, storageState: { cookies: [], origins: [{ origin: baseURL!, localStorage: kept }] } });
    expect(await pc.evaluate(() => document.documentElement.dataset.fit)).toBe("desk");
    const view = async () => (await pc.getByTestId("tv-browse").getAttribute("data-view"))?.split(":")[0];
    await pc.getByTestId("rail-categories").click();
    await expect.poll(view).toBe("categories");
    await pc.locator(".tv-grid .tv-tile").first().click();
    await expect.poll(view).toBe("category");
    await pc.locator(".tv-grid .tv-tile").first().click();
    await expect(pc.getByTestId("tv-detail")).toBeVisible();
    await expect.poll(() => search(pc)).toBe("?title=movie-603");

    await pc.goBack();
    await expect(pc.getByTestId("tv-detail")).toHaveCount(0);
    expect(await view()).toBe("category");
    await expect.poll(() => search(pc)).toBe("");
    await pc.goBack();
    await expect.poll(view).toBe("categories");
    await pc.goBack();
    await expect.poll(view).toBe("home");
    await expect(pc.getByTestId("tv-browse")).toBeVisible();

    await pc.getByTestId("tv-browse-tile").nth(0).click();
    await expect(pc.getByTestId("tv-detail")).toBeVisible();
    await pc.getByTestId("tv-detail-close").click();
    await expect(pc.getByTestId("tv-detail")).toHaveCount(0);
    await expect.poll(() => search(pc)).toBe("");
    await expect.poll(() => pc.evaluate(() => (history.state as { layers?: number } | null)?.layers ?? 0)).toBe(0);

    await pc.getByTestId("tv-browse-tile").nth(0).click();
    await pc.getByTestId("tv-detail-play").click();
    await expect(tvRoot(pc)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    await pc.goBack();
    await expect(tvRoot(pc)).toHaveAttribute("data-state", "idle");
    await expect(pc.getByTestId("tv-browse")).toBeVisible();
  });

  test("opened on a phone, is the screen that plays, on the title's page: the link is for watching, as a watch party's is", async ({ browser }) => {
    const phone = await open(browser, "/?title=movie-603", [], { viewport: { width: 390, height: 844 }, userAgent: IPHONE, hasTouch: true, isMobile: true });
    await expect(phone.getByTestId("tv-detail")).toBeVisible();
    await expect(phone.getByTestId("tv-detail")).toContainText("The Matrix");
  });
});
