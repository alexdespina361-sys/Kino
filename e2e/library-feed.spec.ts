import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { guestStorage, openDevice, openLibrary, openTv, PHONE, place, readPairingCode, test, withLibrary } from "./helpers";

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

test.describe("the phone's library goes on as it is scrolled", () => {
  /** Twenty rows are far more than a phone's screen shows: nothing more is asked for until the page is scrolled near its end. */
  const long = { updatedAt: Date.now(), rows: Array.from({ length: 20 }, (_, i) => rowOf(`b${i}`, `Base ${i + 1}`, 20)) };

  /** A phone that is paired with a TV, its library answered by `setup`, and what it kept (`seed`) like a device that has watched and scored things. */
  async function pairedPhone(browser: Browser, setup: (context: BrowserContext) => Promise<unknown>, seed: Record<string, string> = {}, device: Parameters<Browser["newContext"]>[0] = PHONE) {
    const tv = await openTv(browser);
    const phone = await openDevice(browser, device, seed, setup);
    await phone.goto("/");
    await phone.getByTestId("code-input").fill(await readPairingCode(tv)); // connects by itself on the sixth digit
    await expect(phone.getByTestId("tv-online")).toHaveClass(/\bok\b/); // (connected: the words for it are the language's)
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
    await expect(rows).toHaveCount(30); // ten rows are a long way to the new end: the page waits for the finger
    await expect(rows.nth(20).locator("h3")).toHaveText("Shelf 1");
    expect(asked).toEqual([0]);

    await toTheEnd(phone);
    await expect(rows).toHaveCount(31);
    await expect(rows.nth(30).locator("h3")).toHaveText("Shelf 11");
    expect(asked).toEqual([0, 10]);

    await toTheEnd(phone); // that was the last: the page ends there, and nothing more is asked for
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
    expect(asked).toEqual([]); // the end of the row is far off

    await toTheRight();
    await expect(titles).toHaveCount(40);
    await expect(row.getByTitle("b1 page 2 title 1", { exact: true })).toBeAttached();
    await toTheRight();
    await expect(titles).toHaveCount(60);
    await toTheRight(); // the third page was the last: no more is asked for
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
    await expect(phone.getByTestId("library-closest")).toHaveCount(0); // (the line above the title says it)
  });

  test("titles a profile scored high get a row of titles like them, above the library's own", async ({ browser }) => {
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
    await expect(phone.locator('[data-testid="library-because"], [data-testid="library-row"]').first()).toHaveAttribute("data-testid", "library-because");
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
    await expect(rows.locator("h3")).toHaveText(["Cartoons for all"]); // (the film row and the series row are not in it)

    await phone.getByTestId("filter-anime").click(); // none in the library and none to come: it says so
    await expect(rows).toHaveCount(0);
    await expect(phone.getByTestId("library-section-empty")).toHaveText("No anime here");

    await phone.getByTestId("filter-movies").click();
    await expect(rows.locator("h3")).toHaveText(["Feature films"]); // (the cartoon row is not among the films)
    await expect(phone.getByTestId("library-section-empty")).toHaveCount(0);

    await phone.getByTestId("filter-series").click();
    await expect(rows.locator("h3")).toHaveText(["Classic TV"]);
    await expect.poll(() => asked).toEqual(expect.arrayContaining(["cartoon", "anime"])); // the rows that come next are the section's, not the page's
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
        expect(new Set(fit.names).size).toBe(5); // (All, Movies, Series, Cartoons, Anime: five names, none the same)
        expect(fit.oneLine).toBe(true);
        expect(fit.first).toBe(true);
        expect(fit.page).toBeLessThanOrEqual(fit.view); // (the row scrolls inside itself: the page does not)

        await row.evaluate((box) => box.scrollTo(box.scrollWidth, 0));
        await expect.poll(async () => (await read()).last).toBe(true); // (the last one is there to be tapped, with the room of the page's side)
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
