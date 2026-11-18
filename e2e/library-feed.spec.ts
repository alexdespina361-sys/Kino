import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { guestStorage, openDevice, openLibrary, openTv, PHONE, place, readPairingCode, test, tvRoot, withLibrary } from "./helpers";

const film = (id: string, title: string) => ({ id, title, url: `/fixtures/sample.mp4?n=${encodeURIComponent(id)}` });
const rowOf = (id: string, title: string, count: number) => ({ id, title, source: "Test Source", items: Array.from({ length: count }, (_, i) => film(`${id}-${i}`, `${title} ${i + 1}`)) });
const base = { updatedAt: Date.now(), rows: Array.from({ length: 5 }, (_, i) => rowOf(`b${i}`, `Base ${i + 1}`, 20)) };

const tiles = (tv: Page) => tv.getByTestId("tv-browse-tile");
async function choose(tv: Page, entry: string) {
  await tv.keyboard.press("ArrowLeft");
  await expect(tv.getByTestId("tv-rail")).toHaveAttribute("data-open", "true");
  const order = await tv.getByTestId("tv-rail").locator("button").evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).dataset.testid));
  const focused = await tv.evaluate(() => (document.activeElement as HTMLElement).dataset.testid);
  const steps = order.indexOf(entry) - order.indexOf(focused!);
  for (let i = 0; i < Math.abs(steps); i++) await tv.keyboard.press(steps > 0 ? "ArrowDown" : "ArrowUp");
  await expect(tv.getByTestId(entry)).toBeFocused();
  await tv.keyboard.press("Enter");
}

const LOVED = "https://films.example/loved-film";
const KEPT = "https://films.example/kept-film";
const SEEN = base.rows[1]!.items[2]!;
const some = (id: string, title: string, count: number) => Array.from({ length: count }, (_, i) => film(`${id}${i}`, `${title} ${i + 1}`));
const likeOf = (asked: string | null, second = KEPT) =>
  asked === LOVED
    ? [film("l1", "Like Loved One"), film("l2", "Like Loved Two"), ...some("m", "Like Both", 5)]
    : asked === second
      ? [...some("m", "Like Both", 5), ...some("k", "Like Kept", 6)]
      : asked === film("l1", "").url
        ? some("n", "Next", 5)
        : [];
const withTaste = async (context: BrowserContext) => {
  await withLibrary(base)(context);
  await context.route(/\/api\/library\/similar/, (route) => route.fulfill({ json: { items: likeOf(new URL(route.request().url()).searchParams.get("url")) } }));
};
const FOND = "https://films.example/fond-film";
const tall = { updatedAt: Date.now(), rows: Array.from({ length: 9 }, (_, i) => rowOf(`b${i}`, `Base ${i + 1}`, 20)) };
const twoLoved = () =>
  guestStorage({
    ratings: [
      { key: `rate:${LOVED}`, at: Date.now(), title: "Loved Film", url: LOVED, score: 9, ratedAt: Date.now() },
      { key: `rate:${FOND}`, at: Date.now() - 5000, title: "Fond Film", url: FOND, score: 10, ratedAt: Date.now() - 5000 },
    ],
  });
function lateLikes(waitsFor: (asked: string) => boolean = () => true) {
  let answer!: () => void;
  const held = new Promise<void>((resolve) => (answer = resolve));
  const seen = { waited: 0 };
  const setup = async (context: BrowserContext) => {
    await withLibrary(tall)(context);
    await context.route(/\/api\/library\/similar/, async (route) => {
      const asked = new URL(route.request().url()).searchParams.get("url") ?? "";
      if (waitsFor(asked)) {
        seen.waited++;
        await held;
      }
      await route.fulfill({ json: { items: likeOf(asked, FOND) } });
    });
  };
  return { setup, answer: () => answer(), seen };
}
const offTheTop = (tv: Page) => tv.evaluate(() => Math.round(document.activeElement!.closest(".tv-row")!.getBoundingClientRect().top - document.querySelector(".tv-rows")!.getBoundingClientRect().top));
const rowNames = (tv: Page) => tv.locator("section.tv-row").evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label") ?? "").filter((name) => /^(Base \d+|You might like|Because you .*|More like .*)$/.test(name)));
const tasteStorage = () =>
  guestStorage({
    ratings: [{ key: `rate:${LOVED}`, at: Date.now(), title: "Loved Film", url: LOVED, score: 9, ratedAt: Date.now() }],
    list: [{ key: `url:${KEPT}`, at: Date.now(), id: "kept", title: "Kept Film", url: KEPT }],
    progress: [{ key: `url:${SEEN.url}`, at: Date.now(), title: SEEN.title, url: SEEN.url, position: 6000, duration: 6000, done: true }],
  });
test.describe("the TV's library goes on as it is scrolled", () => {
  test("Home brings the rows that come next as the remote nears the last one, and goes on to them", async ({ browser }) => {
    const asked: number[] = [];
    const tv = await openLibrary(
      browser,
      withLibrary(base, undefined, {
        rows: (cursor) => {
          asked.push(cursor);
          return cursor === 0 ? { rows: [rowOf("s1", "Shelf one", 12), rowOf("s2", "Shelf two", 12), rowOf("s3", "Shelf three", 12)], next: 3 } : { rows: [rowOf("s4", "Shelf four", 12)], next: null };
        },
      }),
    );
    await expect(tiles(tv).first()).toBeFocused();
    expect(asked).toEqual([]);

    for (let i = 0; i < 3; i++) await tv.keyboard.press("ArrowDown");
    await expect(tv.getByRole("region", { name: "Shelf one" })).toBeAttached();
    for (let i = 0; i < 5; i++) await tv.keyboard.press("ArrowDown");
    await expect(tv.getByRole("region", { name: "Shelf three" }).getByTestId("tv-browse-tile").first()).toBeFocused();
    await expect(tv.getByRole("region", { name: "Shelf four" })).toBeAttached();
    expect(asked).toEqual([0, 3]);

    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByRole("region", { name: "Shelf four" }).getByTestId("tv-browse-tile").first()).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByRole("region", { name: "Shelf four" }).getByTestId("tv-browse-tile").first()).toBeFocused();
    expect(asked).toEqual([0, 3]);
  });

  test("a row brings more of its titles as the remote nears its end", async ({ browser }) => {
    const asked: number[] = [];
    const tv = await openLibrary(
      browser,
      withLibrary(base, undefined, {
        more: (row, page) => {
          if (row === "b1") asked.push(page);
          return { items: Array.from({ length: 20 }, (_, i) => film(`${row}-p${page}-${i}`, `${row} page ${page} title ${i + 1}`)), last: page === 3 };
        },
      }),
    );
    await expect(tiles(tv).first()).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    const row = tv.getByRole("region", { name: "Base 2" });
    await expect(row.getByTestId("tv-browse-tile").first()).toBeFocused();

    for (let i = 0; i < 15; i++) await tv.keyboard.press("ArrowRight");
    await expect(row.getByTitle("b1 page 2 title 1", { exact: true })).toBeAttached();
    for (let i = 0; i < 10; i++) await tv.keyboard.press("ArrowRight");
    await expect(row.getByTitle("b1 page 2 title 6", { exact: true })).toBeFocused();
    expect(asked[0]).toBe(2);
    expect(new Set(asked).size).toBe(asked.length);
  });

  test("only a row on the screen asks for more of its titles as the page opens: one further down asks when it is scrolled to", async ({ browser }) => {
    const asked = new Set<string>();
    const short = { updatedAt: Date.now(), rows: Array.from({ length: 8 }, (_, i) => rowOf(`c${i}`, `Short ${i + 1}`, 5)) };
    const tv = await openLibrary(browser, withLibrary(short, undefined, { more: (row) => (asked.add(row), { items: [], last: true }) }));
    await expect(tiles(tv).first()).toBeFocused();
    await expect.poll(() => asked.size).toBeGreaterThan(0);
    await tv.waitForTimeout(1000);
    const onScreen = await tv.locator(".tv-row").evaluateAll((rows) => rows.filter((row) => row.getBoundingClientRect().top < innerHeight).map((row) => row.getAttribute("aria-label")));
    expect(onScreen.length).toBeLessThan(8);
    expect(asked.has("c7")).toBe(false);
    await tv.getByRole("region", { name: "Short 8" }).scrollIntoViewIfNeeded();
    await expect.poll(() => asked.has("c7")).toBe(true);
  });

  test("a category brings more of its titles as the remote goes down its grid, to the last page", async ({ browser }) => {
    const asked: number[] = [];
    const tv = await openLibrary(
      browser,
      withLibrary(base, undefined, {
        more: (row, page) => {
          if (row === "b0") asked.push(page);
          return { items: Array.from({ length: 20 }, (_, i) => film(`${row}-p${page}-${i}`, `${row} page ${page} title ${i + 1}`)), last: page === 3 };
        },
      }),
    );
    await expect(tiles(tv).first()).toBeFocused();
    await choose(tv, "rail-categories");
    await expect(tv.getByTestId("tv-view-title")).toHaveText("All categories");
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Base 1");
    await expect(tiles(tv).first()).toBeFocused();
    await expect.poll(() => tiles(tv).count()).toBeGreaterThanOrEqual(40);

    for (let i = 0; i < 6; i++) await tv.keyboard.press("ArrowDown");
    await expect(tiles(tv)).toHaveCount(60);
    expect(asked).toEqual([2, 3]);
    for (let i = 0; i < 4; i++) await tv.keyboard.press("ArrowDown");
    await expect.poll(() => asked.length).toBe(2);
  });

  test("a search with a slip shows the title that has the words, and the closest others under a heading of their own", async ({ browser }) => {
    const tv = await openLibrary(
      browser,
      withLibrary(base, (query) => (query.includes("strager") ? { items: [film("st", "Stranger Things"), film("c1", "Strange World"), film("c2", "Stranger Than Fiction")], exact: 1 } : [])),
    );
    await expect(tiles(tv).first()).toBeFocused();
    await choose(tv, "rail-search");
    await expect(tv.getByTestId("tv-search")).toBeVisible();
    await tv.keyboard.type("strager things");

    await expect(tv.getByTestId("tv-search-status")).toContainText("1 title for “strager things”");
    await expect(tv.getByTestId("tv-closest")).toHaveText("Closest matches");
    await expect(tiles(tv)).toHaveText([/Stranger Things/, /Strange World/, /Stranger Than Fiction/]);

    await tiles(tv).first().focus();
    await tv.keyboard.press("ArrowDown");
    await expect(tiles(tv).nth(1)).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tiles(tv).nth(2)).toBeFocused();
    await tv.keyboard.press("ArrowUp");
    await expect(tiles(tv).first()).toBeFocused();
  });

  test("a search that only the closest titles answer says so", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(base, (query) => (query.includes("zq") ? { items: [film("c1", "Zorro Quest")], exact: 0 } : [])));
    await expect(tiles(tv).first()).toBeFocused();
    await choose(tv, "rail-search");
    await tv.keyboard.type("zq");
    await expect(tv.getByTestId("tv-search-status")).toContainText("Nothing matches “zq” exactly. These are the closest.");
    await expect(tiles(tv)).toHaveCount(1);
    await expect(tv.getByTestId("tv-closest")).toHaveCount(0);
  });

  test("titles a profile scored high get a row of titles like them", async ({ browser }) => {
    const url = "https://films.example/loved-film";
    const tv = await openLibrary(
      browser,
      async (context) => {
        await withLibrary(base)(context);
        await context.route(/\/api\/library\/similar/, (route) => route.fulfill({ json: { items: [film("l1", "Like Loved One"), film("l2", "Like Loved Two")] } }));
      },
      undefined,
      guestStorage({ ratings: [{ key: `rate:${url}`, at: Date.now(), title: "Loved Film", url, score: 9, ratedAt: Date.now() }] }),
    );
    const loved = tv.getByRole("region", { name: "Because you loved Loved Film" });
    await expect(loved).toBeVisible();
    await expect(loved.getByTestId("tv-browse-tile")).toHaveText([/Like Loved One/, /Like Loved Two/]);
  });

  test("what a profile might like and the titles like what it loved and saved are rows among the library's, all the way down; a film it has seen is out of the rows under the first", async ({ browser }) => {
    const tv = await openLibrary(browser, withTaste, undefined, tasteStorage());
    const picks = tv.getByRole("region", { name: "You might like" });
    await expect(picks).toBeVisible();
    await expect(picks.getByTestId("tv-browse-tile")).toHaveText([/Like Both 1/, /Like Both 2/, /Like Both 3/, /Like Both 4/, /Like Both 5/]);
    await expect(tv.getByRole("region", { name: "Because you loved Loved Film" }).getByTestId("tv-browse-tile")).toHaveText([/Like Loved One/, /Like Loved Two/]);
    await expect(tv.getByRole("region", { name: "Because you saved Kept Film" }).getByTestId("tv-browse-tile")).toHaveText([/Like Kept 1/, /Like Kept 2/, /Like Kept 3/, /Like Kept 4/, /Like Kept 5/, /Like Kept 6/]);
    await expect.poll(() => rowNames(tv)).toEqual(["Base 1", "You might like", "Base 2", "Base 3", "Because you loved Loved Film", "Base 4", "Base 5", "Because you saved Kept Film"]);
    const second = tv.getByRole("region", { name: "Base 2", exact: true }).getByTestId("tv-browse-tile");
    await expect(second.nth(1)).toHaveText(/Base 2 2/);
    await expect(second.nth(2)).toHaveText(/Base 2 4/);
  });

  test("rows of the profile's own that come late leave the remote where it is, and go on to \"More like ...\"", async ({ browser }) => {
    const late = lateLikes();
    const answer = late.answer;
    const tv = await openLibrary(browser, late.setup, undefined, twoLoved());
    await expect(tiles(tv).first()).toBeFocused();
    for (let i = 0; i < 4; i++) await tv.keyboard.press("ArrowDown");
    const on = tv.locator(":focus");
    await expect(on).toHaveAttribute("title", "Base 4 1");
    const top = async () => Math.round((await on.boundingBox())!.y);
    let rest = await top();
    await expect.poll(async () => { const was = rest; rest = await top(); return rest === was; }, { intervals: [150] }).toBe(true);
    expect(await rowNames(tv)).toEqual(Array.from({ length: 9 }, (_, i) => `Base ${i + 1}`));

    answer();
    await expect.poll(() => rowNames(tv)).toEqual([
      "Base 1",
      "You might like",
      "Base 2",
      "Base 3",
      "Because you loved Loved Film",
      "Base 4",
      "Base 5",
      "Because you loved Fond Film",
      "Base 6",
      "Base 7",
      "More like Like Loved One",
      "Base 8",
      "Base 9",
    ]);
    await expect(tv.getByRole("region", { name: "More like Like Loved One" }).getByTestId("tv-browse-tile")).toHaveText([/Next 1/, /Next 2/, /Next 3/, /Next 4/, /Next 5/]);
    await expect(tv.locator(":focus")).toHaveAttribute("title", "Base 4 1");
    await expect.poll(top).toBeGreaterThanOrEqual(rest - 2);
    expect(await top()).toBeLessThanOrEqual(rest + 2);
    expect(Math.abs(await offTheTop(tv))).toBeLessThanOrEqual(2);
    await tv.keyboard.press("ArrowUp");
    await expect(tv.locator(":focus")).toHaveAttribute("data-testid", "tv-category-tile");
    await tv.keyboard.press("ArrowUp");
    await expect(tv.locator(":focus")).toHaveAttribute("title", "Like Loved One");
  });

  test("...and when they come while the page is still on its way to the row the remote moved to, it ends on that row", async ({ browser }) => {
    const late = lateLikes();
    const tv = await openLibrary(browser, late.setup, undefined, twoLoved());
    await expect(tiles(tv).first()).toBeFocused();
    for (let i = 0; i < 4; i++) await tv.keyboard.press("ArrowDown");
    late.answer();
    await expect.poll(() => rowNames(tv)).toContain("More like Like Loved One");
    await expect(tv.locator(":focus")).toHaveAttribute("title", "Base 4 1");
    await expect.poll(async () => Math.abs(await offTheTop(tv)), { timeout: 6000 }).toBeLessThanOrEqual(2);
    await tv.waitForTimeout(600);
    expect(Math.abs(await offTheTop(tv))).toBeLessThanOrEqual(2);
  });

  test("on a phone held upright, whose page a finger scrolls, the rows that come late leave the page where it is too", async ({ browser }) => {
    const late = lateLikes();
    const tv = await openLibrary(browser, late.setup, { width: 390, height: 844 }, twoLoved());
    const fifth = tv.getByRole("region", { name: "Base 5", exact: true });
    await expect(fifth).toBeAttached();
    await fifth.evaluate((row) => row.scrollIntoView({ block: "start" }));
    const top = async () => Math.round((await fifth.boundingBox())!.y);
    let rest = await top();
    await expect.poll(async () => { const was = rest; rest = await top(); return rest === was; }, { intervals: [150] }).toBe(true);
    expect(rest).toBeLessThan(600);
    late.answer();
    await expect.poll(() => rowNames(tv)).toContain("Because you loved Loved Film");
    await expect.poll(() => rowNames(tv)).toContain("Because you loved Fond Film");
    await expect.poll(top).toBeGreaterThanOrEqual(rest - 2);
    expect(await top()).toBeLessThanOrEqual(rest + 2);
  });

  test("back from a film that was opened from one of the profile's own rows, the remote is on that row again: before the library has said what is like the film, and after", async ({ browser }) => {
    const late = lateLikes((asked) => asked.startsWith("http") && asked.includes("n=l2"));
    const tv = await openLibrary(browser, late.setup, undefined, twoLoved());
    const loved = tv.getByRole("region", { name: "Because you loved Loved Film" });
    await expect(loved).toBeAttached();
    await expect(tiles(tv).first()).toBeFocused();
    for (let i = 0; i < 4; i++) await tv.keyboard.press("ArrowDown");
    await tv.keyboard.press("ArrowRight");
    await expect(tv.locator(":focus")).toHaveAttribute("title", "Like Loved Two");
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-browse")).toHaveCount(0);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    await expect.poll(() => late.seen.waited).toBeGreaterThan(0);
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "hidden", { timeout: 8_000 });
    await tv.keyboard.press("Escape");
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "visible");
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(tv.locator(":focus")).toHaveAttribute("title", "Like Loved Two");
    expect(await rowNames(tv)).toEqual(expect.arrayContaining(["You might like", "Because you loved Loved Film", "Because you loved Fond Film"]));
    late.answer();
    await expect.poll(async () => (await rowNames(tv)).includes("Because you loved Loved Film")).toBe(true);
    await tv.waitForTimeout(500);
    await expect(loved.locator(":focus")).toHaveCount(1);
    expect(Math.abs(await offTheTop(tv))).toBeLessThanOrEqual(2);
  });
});

test.describe("the phone's library goes on as it is scrolled", () => {
  const long = { updatedAt: Date.now(), rows: Array.from({ length: 20 }, (_, i) => rowOf(`b${i}`, `Base ${i + 1}`, 20)) };

  async function pairedPhone(browser: Browser, setup: (context: BrowserContext) => Promise<unknown>, seed: Record<string, string> = {}, device: Parameters<Browser["newContext"]>[0] = PHONE) {
    const tv = await openTv(browser);
    const phone = await openDevice(browser, device, seed, setup);
    await phone.goto("/");
    await phone.getByTestId("code-input").fill(await readPairingCode(tv));
    await expect(phone.getByTestId("tv-online")).toHaveClass(/\bok\b/);
    return phone;
  }
  const toTheEnd = (phone: Page) => phone.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

  test("the rows that come next are asked for as the page is scrolled near its end, to the last ones", async ({ browser }) => {
    const asked: number[] = [];
    const shelves = (from: number, count: number) => Array.from({ length: count }, (_, i) => rowOf(`s${from + i}`, `Shelf ${from + i}`, 12));
    const phone = await pairedPhone(
      browser,
      withLibrary(long, undefined, {
        rows: (cursor) => {
          asked.push(cursor);
          return cursor === 0 ? { rows: shelves(1, 10), next: 10 } : { rows: shelves(11, 1), next: null };
        },
      }),
    );
    const rows = phone.getByTestId("library-row");
    await expect(rows).toHaveCount(20);
    expect(asked).toEqual([]);

    await toTheEnd(phone);
    await expect(rows).toHaveCount(30);
    await expect(rows.nth(20).locator("h3")).toHaveText("Shelf 1");
    expect(asked).toEqual([0]);

    await toTheEnd(phone);
    await expect(rows).toHaveCount(31);
    await expect(rows.nth(30).locator("h3")).toHaveText("Shelf 11");
    expect(asked).toEqual([0, 10]);

    await toTheEnd(phone);
    await phone.waitForTimeout(300);
    await expect(rows).toHaveCount(31);
    expect(asked).toEqual([0, 10]);
  });

  test("a row brings more of its titles as it is scrolled sideways, to its last page", async ({ browser }) => {
    const asked: number[] = [];
    const phone = await pairedPhone(
      browser,
      withLibrary(base, undefined, {
        more: (row, page) => {
          if (row === "b1") asked.push(page);
          return { items: Array.from({ length: 20 }, (_, i) => film(`${row}-p${page}-${i}`, `${row} page ${page} title ${i + 1}`)), last: page === 3 };
        },
      }),
    );
    const row = phone.getByTestId("library-row").nth(1);
    const titles = row.getByTestId("library-tile");
    const toTheRight = () => row.locator(".lib-scroller").evaluate((box) => box.scrollTo(box.scrollWidth, 0));
    await expect(titles).toHaveCount(20);
    expect(asked).toEqual([]);

    await toTheRight();
    await expect(titles).toHaveCount(40);
    await expect(row.getByTitle("b1 page 2 title 1", { exact: true })).toBeAttached();
    await toTheRight();
    await expect(titles).toHaveCount(60);
    await toTheRight();
    await phone.waitForTimeout(300);
    await expect(titles).toHaveCount(60);
    expect(asked).toEqual([2, 3]);
  });

  test("a search with a slip lists the title that has the words, and the closest others under a heading of their own", async ({ browser }) => {
    const phone = await pairedPhone(
      browser,
      withLibrary(base, (query) => (query.includes("strager") ? { items: [film("st", "Stranger Things"), film("c1", "Strange World"), film("c2", "Stranger Than Fiction")], exact: 1 } : [])),
    );
    await place(phone, "search");
    await phone.getByTestId("library-search-input").fill("strager things");
    const results = phone.getByTestId("library-search-results");
    await expect(results.locator("h3")).toHaveText("Results for “strager things”");
    await expect(results.locator("li")).toHaveText([/Stranger Things/, "Closest matches", /Strange World/, /Stranger Than Fiction/]);
    await expect(phone.getByTestId("library-result")).toHaveCount(3);
  });

  test("a search that only the closest titles answer says so", async ({ browser }) => {
    const phone = await pairedPhone(browser, withLibrary(base, (query) => (query.includes("zq") ? { items: [film("c1", "Zorro Quest")], exact: 0 } : [])));
    await place(phone, "search");
    await phone.getByTestId("library-search-input").fill("zq");
    await expect(phone.getByTestId("library-search-results").locator("h3")).toHaveText("Nothing matches “zq” exactly. These are the closest.");
    await expect(phone.getByTestId("library-result")).toHaveCount(1);
    await expect(phone.getByTestId("library-closest")).toHaveCount(0);
  });

  test("titles a profile scored high get a row of titles like them, under the library's first row", async ({ browser }) => {
    const url = "https://films.example/loved-film";
    const phone = await pairedPhone(
      browser,
      async (context) => {
        await withLibrary(base)(context);
        await context.route(/\/api\/library\/similar/, (route) => route.fulfill({ json: { items: [film("l1", "Like Loved One"), film("l2", "Like Loved Two")] } }));
      },
      guestStorage({ ratings: [{ key: `rate:${url}`, at: Date.now(), title: "Loved Film", url, score: 9, ratedAt: Date.now() }] }),
    );
    const loved = phone.getByTestId("library-because");
    await expect(loved.locator("h3")).toHaveText("Because you loved Loved Film");
    await expect(loved.getByTestId("library-tile")).toHaveText([/Like Loved One/, /Like Loved Two/]);
    await expect(phone.locator('[data-testid="library-because"], [data-testid="library-row"]').nth(1)).toHaveAttribute("data-testid", "library-because");
  });

  test("what a profile might like and the titles like what it loved and saved are rows among the library's, all the way down; a film it has seen is out of the rows under the first", async ({ browser }) => {
    const phone = await pairedPhone(browser, withTaste, tasteStorage());
    const picks = phone.getByTestId("library-picks");
    await expect(picks.locator("h3")).toHaveText("You might like");
    await expect(picks.getByTestId("library-tile")).toHaveText([/Like Both 1/, /Like Both 2/, /Like Both 3/, /Like Both 4/, /Like Both 5/]);
    await expect(phone.getByTestId("library-because").locator("h3")).toHaveText(["Because you loved Loved Film", "Because you saved Kept Film"]);
    await expect(phone.getByTestId("library-because").nth(1).getByTestId("library-tile")).toHaveText([/Like Kept 1/, /Like Kept 2/, /Like Kept 3/, /Like Kept 4/, /Like Kept 5/, /Like Kept 6/]);
    const kinds = () => phone.locator('[data-testid="library-because"], [data-testid="library-picks"], [data-testid="library-row"]').evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.testid!.replace("library-", "")));
    await expect.poll(kinds).toEqual(["row", "picks", "row", "row", "because", "row", "row", "because"]);
    const second = phone.getByTestId("library-row").filter({ has: phone.getByRole("heading", { name: "Base 2", exact: true }) }).getByTestId("library-tile");
    await expect(second.nth(1)).toHaveText(/Base 2 2/);
    await expect(second.nth(2)).toHaveText(/Base 2 4/);
  });

  test("rows of the profile's own that come late leave the page where the finger left it", async ({ browser }) => {
    const late = lateLikes();
    const phone = await pairedPhone(browser, late.setup, twoLoved());
    const fifth = phone.getByTestId("library-row").filter({ has: phone.getByRole("heading", { name: "Base 5", exact: true }) });
    await expect(fifth).toBeAttached();
    await fifth.evaluate((row) => row.scrollIntoView({ block: "start" }));
    const top = async () => Math.round((await fifth.boundingBox())!.y);
    let rest = await top();
    await expect.poll(async () => { const was = rest; rest = await top(); return rest === was; }, { intervals: [150] }).toBe(true);
    await expect(phone.getByTestId("library-because")).toHaveCount(0);
    late.answer();
    await expect(phone.getByTestId("library-because").locator("h3")).toHaveText(["Because you loved Loved Film", "Because you loved Fond Film", "More like Like Loved One"]);
    await expect.poll(top).toBeGreaterThanOrEqual(rest - 2);
    expect(await top()).toBeLessThanOrEqual(rest + 2);
  });

  test("Cartoons and Anime are filters of their own: a row is in the section it says, and a section with no rows says so", async ({ browser }) => {
    const asked: Array<string | null> = [];
    const library = {
      updatedAt: Date.now(),
      rows: [
        { ...rowOf("m1", "Feature films", 4), kind: "movie" },
        { ...rowOf("s1", "Classic TV", 4), kind: "series" },
        { ...rowOf("c1", "Cartoons for all", 4), section: "cartoon" },
      ],
    };
    const phone = await pairedPhone(
      browser,
      withLibrary(library, undefined, {
        rows: (_cursor, section) => {
          asked.push(section);
          return { rows: [], next: null };
        },
      }),
    );
    const rows = phone.getByTestId("library-row");
    await expect(rows.locator("h3")).toHaveText(["Feature films", "Classic TV", "Cartoons for all"]);
    await expect(phone.getByTestId("filter-cartoons")).toHaveText("Cartoons");
    await expect(phone.getByTestId("filter-anime")).toHaveText("Anime");

    await phone.getByTestId("filter-cartoons").click();
    await expect(phone.getByTestId("filter-cartoons")).toHaveAttribute("aria-pressed", "true");
    await expect(rows.locator("h3")).toHaveText(["Cartoons for all"]);

    await phone.getByTestId("filter-anime").click();
    await expect(rows).toHaveCount(0);
    await expect(phone.getByTestId("library-section-empty")).toHaveText("No anime here");

    await phone.getByTestId("filter-movies").click();
    await expect(rows.locator("h3")).toHaveText(["Feature films"]);
    await expect(phone.getByTestId("library-section-empty")).toHaveCount(0);

    await phone.getByTestId("filter-series").click();
    await expect(rows.locator("h3")).toHaveText(["Classic TV"]);
    await expect.poll(() => asked).toEqual(expect.arrayContaining(["cartoon", "anime"]));
  });

  for (const language of [
    { name: "English", locale: "en-US" },
    { name: "Romanian", locale: "ro-RO" },
    { name: "Italian", locale: "it-IT" },
  ]) {
    for (const width of [320, 360, 390]) {
      test(`the five filters are one row that scrolls sideways: each name on one line, the first on the screen, the last reachable, the page no wider than the screen: ${language.name}, ${width} wide`, async ({ browser }) => {
        const phone = await pairedPhone(browser, withLibrary(base), {}, { ...PHONE, viewport: { width, height: 740 }, screen: { width, height: 740 }, locale: language.locale });
        const row = phone.getByTestId("filter-all").locator("xpath=..");
        const read = () =>
          row.evaluate((box) => {
            const pills = [...box.children] as HTMLElement[];
            const oneLine = (pill: HTMLElement) => {
              const range = document.createRange();
              range.selectNodeContents(pill);
              return range.getClientRects().length === 1;
            };
            const inside = (pill: HTMLElement) => {
              const edge = pill.getBoundingClientRect();
              return edge.left >= 0 && edge.right <= window.innerWidth;
            };
            const first = pills[0]!;
            const last = pills[pills.length - 1]!;
            return { names: pills.map((pill) => pill.textContent), oneLine: pills.every(oneLine), first: inside(first), last: inside(last), page: document.documentElement.scrollWidth, view: window.innerWidth };
          });
        const fit = await read();
        expect(new Set(fit.names).size).toBe(5);
        expect(fit.oneLine).toBe(true);
        expect(fit.first).toBe(true);
        expect(fit.page).toBeLessThanOrEqual(fit.view);

        await row.evaluate((box) => box.scrollTo(box.scrollWidth, 0));
        await expect.poll(async () => (await read()).last).toBe(true);
        expect((await read()).page).toBeLessThanOrEqual(fit.view);
      });
    }
  }

  test("names TMDB where the titles are its", async ({ browser }) => {
    const filmpire = { updatedAt: Date.now(), rows: [{ ...rowOf("f1", "Filmpire row", 4), source: "Filmpire" }] };
    const phone = await pairedPhone(browser, withLibrary(filmpire));
    await expect(phone.getByTestId("library")).toContainText("From Filmpire.");
    await expect(phone.getByTestId("library")).toContainText("This product uses the TMDB API but is not endorsed or certified by TMDB.");

    const other = await pairedPhone(browser, withLibrary(base));
    await expect(other.getByTestId("library")).toContainText("From Test Source.");
    await expect(other.getByTestId("library")).not.toContainText("TMDB");
  });
});
