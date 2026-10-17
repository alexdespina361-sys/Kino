import { expect, test, type Page } from "@playwright/test";
import { guestStorage, openLibrary, withLibrary } from "./helpers";

/** The library as it grows while a page is scrolled: the rows after the first ones, more titles of a row, and a search that forgives (see src/client/shared/feed.ts). */

const film = (id: string, title: string) => ({ id, title, url: `/fixtures/sample.mp4?n=${encodeURIComponent(id)}` });
const rowOf = (id: string, title: string, count: number) => ({ id, title, source: "Test Source", items: Array.from({ length: count }, (_, i) => film(`${id}-${i}`, `${title} ${i + 1}`)) });
const base = { updatedAt: Date.now(), rows: Array.from({ length: 5 }, (_, i) => rowOf(`b${i}`, `Base ${i + 1}`, 20)) };

const tiles = (tv: Page) => tv.getByTestId("tv-browse-tile");
/** Left from the first title, then up or down the menu to an entry, and OK. */
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
    expect(asked).toEqual([]); // the first rows fill the page: nothing more is asked for yet

    for (let i = 0; i < 3; i++) await tv.keyboard.press("ArrowDown"); // the ranking, two rows, and the row of categories: three from the last
    await expect(tv.getByRole("region", { name: "Shelf one" })).toBeAttached();
    for (let i = 0; i < 5; i++) await tv.keyboard.press("ArrowDown"); // on through the two rows left and the three that came
    await expect(tv.getByRole("region", { name: "Shelf three" }).getByTestId("tv-browse-tile").first()).toBeFocused();
    await expect(tv.getByRole("region", { name: "Shelf four" })).toBeAttached(); // and it asked again, past the three it had
    expect(asked).toEqual([0, 3]);

    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByRole("region", { name: "Shelf four" }).getByTestId("tv-browse-tile").first()).toBeFocused();
    await tv.keyboard.press("ArrowDown"); // that was the last: the page ends there, and nothing more is asked for
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
    for (let i = 0; i < 10; i++) await tv.keyboard.press("ArrowRight"); // on into the titles that came
    await expect(row.getByTitle("b1 page 2 title 6", { exact: true })).toBeFocused();
    expect(asked[0]).toBe(2);
    expect(new Set(asked).size).toBe(asked.length); // each page once
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
    await tv.keyboard.press("Enter"); // the first category
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Base 1");
    await expect(tiles(tv).first()).toBeFocused();
    await expect.poll(() => tiles(tv).count()).toBeGreaterThanOrEqual(40); // the page was not full, so the next twenty came before the remote moved

    for (let i = 0; i < 6; i++) await tv.keyboard.press("ArrowDown");
    await expect(tiles(tv)).toHaveCount(60); // ...and the last page when it came near
    expect(asked).toEqual([2, 3]);
    for (let i = 0; i < 4; i++) await tv.keyboard.press("ArrowDown");
    await expect.poll(() => asked.length).toBe(2); // the last page was the last: no more is asked for
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
    await tv.keyboard.press("ArrowDown"); // from the title that has the words into the closest others, which are a block of their own
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
    await expect(tv.getByTestId("tv-closest")).toHaveCount(0); // (the line above the titles says it)
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
});
