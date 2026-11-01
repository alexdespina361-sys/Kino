import { expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { openDevice, openLibrary, openTv, PHONE, readPairingCode, test, withLibrary } from "./helpers";

/**
 * What the movie database knows of a title (feedback #6), on the title's own page: on the TV and on the phone, its age rating and genres, who made it and who is in it,
 * and the rows of the titles that go with it (the other parts of its collection, "More like this"). The server is asked once for each title whose page is opened, and
 * for no other. The movie database's answers are the test's (the server these tests run against has no library, and no key).
 */

const link = (n: number) => `https://films.example/watch/${n}`;
const film = (n: number, title: string, extra: Record<string, unknown> = {}) => ({ id: `f${n}`, title, year: 2008, kind: "movie", url: link(n), ...extra });
const library = {
  updatedAt: Date.now(),
  rows: [{ id: "top", title: "Top films", source: "Test Source", kind: "movie", items: [film(1, "Kung Fu Panda"), film(2, "A film nobody knows"), film(9, "A film that is not asked about")] }],
};

const panda = {
  genres: ["Animation", "Action", "Comedy"],
  directors: ["Mark Osborne", "John Stevenson"],
  creators: [],
  cast: ["Jack Black", "Dustin Hoffman", "Angelina Jolie"],
  ages: { US: "PG", GB: "U", RO: "AP" },
  parts: [film(3, "Kung Fu Panda 2"), film(4, "Kung Fu Panda 3")],
  similar: [film(5, "Madagascar"), film(6, "Shrek"), film(7, "How to Train Your Dragon")],
};
const panda2 = { ...panda, directors: ["Jennifer Yuh Nelson"], parts: [film(1, "Kung Fu Panda"), film(4, "Kung Fu Panda 3")], similar: [film(8, "Megamind")] };

/**
 * The movie database's answers about titles, by the title's link (a title not listed is one nothing is known of; "fail": the server could not be reached). Every question is
 * recorded. With `held`, the answers wait for it: a test can look at the page as it is before the answer comes, and after.
 */
function aboutAnswers(answers: Record<string, unknown>, held?: Promise<void>) {
  const asked: string[] = [];
  const setup = async (context: BrowserContext) => {
    await withLibrary(library)(context);
    await context.route(/\/api\/library\/about/, async (route) => {
      const url = new URL(route.request().url()).searchParams.get("url") ?? "";
      asked.push(url);
      await held;
      const answer = answers[url];
      return answer === "fail" ? route.fulfill({ status: 500, json: { error: "down" } }) : route.fulfill({ json: { about: answer ?? null } });
    });
  };
  return { asked, setup };
}

const titlesOf = (row: Locator) => row.getByTestId("tv-browse-tile").evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("title")));
const tileIn = (row: Locator, title: string) => row.locator(`[title="${title}"]`);
/** Where something is once it has stopped moving (a page rises into place as it opens). */
async function still(target: Locator) {
  let last = await target.boundingBox();
  for (let tries = 0; tries < 30; tries++) {
    await target.page().waitForTimeout(60);
    const now = await target.boundingBox();
    if (last && now && now.x === last.x && now.y === last.y) return now;
    last = now;
  }
  return last!;
}
/** An answer that is let go when the test says so. */
const gate = () => {
  let open!: () => void;
  const closed = new Promise<void>((resolve) => (open = resolve));
  return { closed, open };
};
/** The zone of the button or title the remote is on. */
const zoneOf = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("data-zone"));

test.describe("a title's page on the TV says what the movie database knows of it", () => {
  test("its age rating, genres, director and cast, and the rows of its other parts and of titles like it; the server was asked about that title and no other", async ({ browser }) => {
    const answer = gate();
    const about = aboutAnswers({ [link(1)]: panda }, answer.closed);
    const tv = await openLibrary(browser, about.setup);
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
    expect(about.asked).toEqual([]); // (nothing is asked for the titles on the shelves)

    await tv.keyboard.press("Enter");
    const page = tv.getByTestId("tv-detail");
    await expect(page).toBeVisible();
    await expect(page.getByTestId("about-facts")).toHaveCount(0); // (the page is the page it was until the answer comes)
    const before = await still(tv.getByTestId("tv-detail-play"));
    answer.open();
    await expect(page.getByTestId("about-people")).toBeVisible();
    expect((await still(tv.getByTestId("tv-detail-play"))).y, "the answer did not move Play: the page grows upward from its buttons").toBe(before.y);
    await expect(page.getByTestId("about-age")).toContainText("PG");
    await expect(page.getByTestId("about-age")).toContainText("US");
    await expect(page.getByTestId("about-genres")).toHaveText("Animation · Action · Comedy");
    await expect(page.getByTestId("about.directedBy")).toHaveText("Mark Osborne, John Stevenson");
    await expect(page.getByTestId("about.cast")).toHaveText("Jack Black, Dustin Hoffman, Angelina Jolie");
    await expect(page.getByTestId("about.createdBy")).toHaveCount(0); // (a film has a director; a show has its creators)
    await expect(page.getByRole("region", { name: "Other parts" })).toBeAttached();
    expect(await titlesOf(page.getByTestId("tv-about-parts"))).toEqual(["Kung Fu Panda 2", "Kung Fu Panda 3"]);
    expect(await titlesOf(page.getByTestId("tv-about-similar"))).toEqual(["Madagascar", "Shrek", "How to Train Your Dragon"]);
    await expect(page.getByTestId("tv-detail-play")).toBeFocused(); // (the page opened on Play, as it does, and was not moved by the answer)
    expect(about.asked).toEqual([link(1)]);
  });

  test("the remote goes down from the buttons into the rows, along them and between them; OK on a title opens its own page, from its top; Back closes the page", async ({ browser }) => {
    const about = aboutAnswers({ [link(1)]: panda, [link(3)]: panda2 });
    const tv = await openLibrary(browser, about.setup);
    await tv.keyboard.press("Enter");
    const page = tv.getByTestId("tv-detail");
    const parts = page.getByTestId("tv-about-parts");
    const similar = page.getByTestId("tv-about-similar");
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused();
    await expect(parts.getByTestId("tv-browse-tile")).toHaveCount(2);

    await tv.keyboard.press("ArrowDown");
    await expect(tileIn(parts, "Kung Fu Panda 2")).toBeFocused();
    await expect(tileIn(parts, "Kung Fu Panda 2")).toBeInViewport({ ratio: 1 }); // (the page scrolled to it)
    await tv.keyboard.press("ArrowRight");
    await expect(tileIn(parts, "Kung Fu Panda 3")).toBeFocused();
    await tv.keyboard.press("ArrowRight"); // the end of the row
    await expect(tileIn(parts, "Kung Fu Panda 3")).toBeFocused();
    await tv.keyboard.press("ArrowDown"); // the next row, at the same place along it
    await expect(tileIn(similar, "Shrek")).toBeFocused();
    await expect(tileIn(similar, "Shrek")).toBeInViewport({ ratio: 1 });
    await tv.keyboard.press("ArrowDown"); // the last row: nothing under it
    await expect(tileIn(similar, "Shrek")).toBeFocused();
    await tv.keyboard.press("ArrowUp");
    await tv.keyboard.press("ArrowUp"); // up from the first row: back to the buttons, and the page to its top
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused();
    await expect(tv.getByTestId("tv-detail-play")).toBeInViewport({ ratio: 1 });

    await tv.keyboard.press("ArrowDown");
    await tv.keyboard.press("Enter"); // Kung Fu Panda 2
    await expect(tv.getByTestId("tv-detail-title")).toHaveText("Kung Fu Panda 2");
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused();
    expect(await zoneOf(tv)).toBe("detail");
    await expect(page.getByTestId("about.directedBy")).toHaveText("Jennifer Yuh Nelson"); // (its own answer: the page is its own)
    await expect.poll(() => tv.getByTestId("tv-detail").locator(".tv-detail-scroll").evaluate((scroller) => scroller.scrollTop)).toBe(0);
    expect(await titlesOf(page.getByTestId("tv-about-parts"))).toEqual(["Kung Fu Panda", "Kung Fu Panda 3"]);
    expect(about.asked).toEqual([link(1), link(3)]);

    await tv.keyboard.press("Escape"); // Back leaves the page, whichever title's it is, and the remote is on the title it came from
    await expect(page).toHaveCount(0);
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
    await expect(tv.getByTestId("tv-hero-title")).toHaveText("Kung Fu Panda");
  });

  test("a title nothing is known of, and one the server could not be asked about, have the page they had: nothing added, no row, no notice, and Back still closes it", async ({ browser }) => {
    const about = aboutAnswers({ [link(9)]: "fail" });
    const tv = await openLibrary(browser, about.setup);

    await tv.keyboard.press("ArrowRight"); // "A film nobody knows"
    await tv.keyboard.press("Enter");
    const page = tv.getByTestId("tv-detail");
    await expect(page.getByTestId("tv-detail-title")).toHaveText("A film nobody knows");
    await expect.poll(() => about.asked).toEqual([link(2)]);
    await expect(page.getByTestId("about-facts")).toHaveCount(0);
    await expect(page.getByTestId("about-people")).toHaveCount(0);
    await expect(page.getByTestId("tv-about-parts")).toHaveCount(0);
    await expect(page.getByTestId("tv-about-similar")).toHaveCount(0);
    await tv.keyboard.press("ArrowDown"); // (nothing under the buttons: the remote stays)
    expect(await zoneOf(tv)).toBe("detail");
    await tv.keyboard.press("Escape");
    await expect(page).toHaveCount(0);

    await tv.keyboard.press("ArrowRight"); // the third title is one the server fails on
    await tv.keyboard.press("Enter");
    await expect(page.getByTestId("tv-detail-title")).toHaveText("A film that is not asked about");
    await expect.poll(() => about.asked).toEqual([link(2), link(9)]);
    await expect(page.getByTestId("about-facts")).toHaveCount(0);
    await expect(page.getByTestId("tv-notice")).toHaveCount(0);
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused();
    await tv.getByTestId("tv-detail-close").click();
    await expect(page).toHaveCount(0);
  });

  test("a show's page lists its rows after its episodes; the remote reaches them from the last episode", async ({ browser }) => {
    const show = { id: "s1", title: "The Long Night", year: 2019, kind: "series", url: "https://shows.example/watch/7?s=1&e=1", description: "A show about a very long night." };
    const shows = { updatedAt: Date.now(), rows: [{ id: "tv", title: "Series", source: "Test Source", kind: "series", items: [show] }] };
    const asked: string[] = [];
    const tv = await openLibrary(browser, async (context) => {
      await withLibrary(shows)(context);
      await context.route(/\/api\/library\/seasons/, (route) => route.fulfill({ json: { seasons: [1] } }));
      await context.route(/\/api\/library\/episodes/, (route) =>
        route.fulfill({ json: { episodes: [1, 2, 3].map((episode) => ({ season: 1, episode, title: `Episode ${episode}`, runtime: 40, url: `https://shows.example/watch/7?s=1&e=${episode}` })) } }),
      );
      await context.route(/\/api\/library\/about/, (route) => {
        asked.push(new URL(route.request().url()).searchParams.get("url") ?? "");
        return route.fulfill({ json: { about: { genres: ["Drama"], directors: [], creators: ["Ada Writer"], cast: ["Some Actor"], ages: { US: "TV-14" }, parts: [], similar: [film(5, "Another show", { kind: "series" })] } } });
      });
    });
    await tv.keyboard.press("Enter");
    const page = tv.getByTestId("tv-detail");
    await expect(page.getByTestId("about.createdBy")).toHaveText("Ada Writer");
    await expect(page.getByTestId("about.directedBy")).toHaveCount(0);
    await expect(page.getByTestId("tv-about-parts")).toHaveCount(0); // (a show's other parts are its seasons, which are on its page)
    await expect(page.getByTestId("tv-episodes")).toBeVisible();
    await expect(page.getByTestId("tv-about-similar")).toBeAttached();
    expect(asked).toEqual(["https://shows.example/watch/7?s=1&e=1"]); // (one question for the show, not one for each episode)
    const after = await page.evaluate(() => {
      const episodes = document.querySelector('[data-testid="tv-episodes"]')!;
      const rows = document.querySelector('[data-testid="tv-about-similar"]')!;
      return Boolean(episodes.compareDocumentPosition(rows) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(after).toBe(true);

    for (let step = 0; step < 8 && (await tv.evaluate(() => document.activeElement?.getAttribute("data-zone"))) !== "related"; step++) await tv.keyboard.press("ArrowDown");
    expect(await zoneOf(tv)).toBe("related");
    await expect(tileIn(page.getByTestId("tv-about-similar"), "Another show")).toBeFocused();
    await expect(tileIn(page.getByTestId("tv-about-similar"), "Another show")).toBeInViewport({ ratio: 1 });
    await tv.keyboard.press("ArrowUp"); // back up to the last episode
    expect(await zoneOf(tv)).toBe("episodes");
  });
});

test.describe("a title's page on a phone that is the screen", () => {
  test("what the movie database knows comes under the buttons, so Play stays in the first screen where it was; the rows come under that, and a tap on a title of one opens its page", async ({ browser }) => {
    const answer = gate();
    const about = aboutAnswers({ [link(1)]: panda, [link(3)]: panda2 }, answer.closed);
    const size = { width: 320, height: 568 };
    const tv = await openDevice(browser, { ...PHONE, viewport: size, screen: size }, {}, about.setup);
    await tv.goto("/tv");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await tv.locator('.tv-tile[title="Kung Fu Panda"]').first().tap();
    const page = tv.getByTestId("tv-detail");
    const play = tv.getByTestId("tv-detail-play");
    await expect(play).toBeInViewport({ ratio: 1 });
    const before = await still(play);
    answer.open();
    await expect(page.getByTestId("about-people")).toBeVisible();
    await expect(page.getByTestId("tv-about-similar")).toBeAttached();
    expect((await still(play)).y, "the answer did not move Play").toBe(before.y);
    await expect(play).toBeInViewport({ ratio: 1 });
    expect(await tv.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "the page does not slide sideways").toBe(true);
    const under = await page.evaluate(() => {
      const bottom = (testId: string) => document.querySelector(`[data-testid="${testId}"]`)!.getBoundingClientRect().top;
      return bottom("about-facts") > bottom("tv-detail-play") && bottom("about-people") > bottom("about-facts");
    });
    expect(under, "the genres and the people are under the buttons").toBe(true);

    await tileIn(page.getByTestId("tv-about-parts"), "Kung Fu Panda 2").scrollIntoViewIfNeeded();
    await tileIn(page.getByTestId("tv-about-parts"), "Kung Fu Panda 2").tap();
    await expect(tv.getByTestId("tv-detail-title")).toHaveText("Kung Fu Panda 2");
    await expect.poll(() => page.locator(".tv-detail-scroll").evaluate((scroller) => scroller.scrollTop)).toBe(0);
    await expect(page.getByTestId("about.directedBy")).toHaveText("Jennifer Yuh Nelson");
  });
});

test.describe("a title's page on the phone says what the movie database knows of it", () => {
  /** A phone paired with a TV, its library answered by the test. */
  async function pairedPhone(browser: Browser, about: ReturnType<typeof aboutAnswers>): Promise<Page> {
    const [tv, phone] = await Promise.all([openTv(browser), openDevice(browser, PHONE, {}, about.setup)]);
    await phone.goto("/");
    await phone.getByTestId("code-input").fill(await readPairingCode(tv)); // connects by itself on the sixth digit
    await expect(phone.getByTestId("tv-online")).toHaveClass(/\bok\b/);
    await expect(phone.getByTestId("library-row").first()).toBeVisible();
    return phone;
  }

  test("under what it is about: the age rating, the genres and the people; under the page: the rows; a tap on a title of a row opens that title's page, from its top, and Back closes it", async ({ browser }) => {
    const answer = gate();
    const many = [film(5, "Madagascar"), film(6, "Shrek"), film(7, "How to Train Your Dragon"), film(10, "Turbo"), film(11, "Megamind")]; // (more than a row holds, so that it scrolls)
    const about = aboutAnswers({ [link(1)]: { ...panda, similar: many }, [link(3)]: { ...panda2, similar: many } }, answer.closed);
    const phone = await pairedPhone(browser, about);
    await phone.locator('[data-testid="library-tile"][title="Kung Fu Panda"]').tap();
    const page = phone.getByTestId("title-sheet");
    await expect(page.getByTestId("title-name")).toHaveText("Kung Fu Panda");
    const before = await still(phone.getByTestId("title-play"));
    answer.open();
    await expect(page.getByTestId("about-people")).toBeVisible();
    expect((await still(phone.getByTestId("title-play"))).y, "the answer did not move Play").toBe(before.y);
    await expect(page.getByTestId("about-age")).toContainText("PG");
    await expect(page.getByTestId("about-genres")).toHaveText("Animation · Action · Comedy");
    await expect(page.getByTestId("about.directedBy")).toHaveText("Mark Osborne, John Stevenson");
    await expect(page.getByTestId("about.cast")).toHaveText("Jack Black, Dustin Hoffman, Angelina Jolie");
    const parts = page.getByTestId("title-about-parts");
    const similar = page.getByTestId("title-about-similar");
    await expect(parts.getByRole("heading", { name: "Other parts" })).toBeVisible();
    expect(await parts.getByTestId("library-tile").evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("title")))).toEqual(["Kung Fu Panda 2", "Kung Fu Panda 3"]);
    expect(await similar.getByTestId("library-tile").evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("title")))).toEqual(["Madagascar", "Shrek", "How to Train Your Dragon", "Turbo", "Megamind"]);
    await expect(phone.getByTestId("title-play")).toBeVisible();
    expect(about.asked).toEqual([link(1)]);

    await similar.scrollIntoViewIfNeeded(); // (the page is read down to its rows)
    await similar.locator(".lib-scroller").evaluate((row) => row.scrollTo({ left: 150 }));
    expect(await similar.locator(".lib-scroller").evaluate((row) => row.scrollLeft)).toBeGreaterThan(0);
    await parts.locator('[title="Kung Fu Panda 2"]').tap();
    await expect(page.getByTestId("title-name")).toHaveText("Kung Fu Panda 2");
    await expect.poll(() => similar.locator(".lib-scroller").evaluate((row) => row.scrollLeft), { message: "the rows of the next page start at their first title" }).toBe(0);
    await expect(page.getByTestId("about.directedBy")).toHaveText("Jennifer Yuh Nelson");
    await expect.poll(() => page.locator(".page-body").evaluate((body) => body.scrollTop)).toBe(0);
    expect(await parts.getByTestId("library-tile").evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("title")))).toEqual(["Kung Fu Panda", "Kung Fu Panda 3"]);
    expect(about.asked).toEqual([link(1), link(3)]);

    await phone.getByTestId("title-back").tap(); // (one Back closes the page: related titles replace each other, they are not a stack)
    await expect(page).toHaveCount(0);
  });

  test("a title nothing is known of has the page it had", async ({ browser }) => {
    const about = aboutAnswers({});
    const phone = await pairedPhone(browser, about);
    await phone.locator('[data-testid="library-tile"][title="A film nobody knows"]').tap();
    const page = phone.getByTestId("title-sheet");
    await expect(page.getByTestId("title-name")).toHaveText("A film nobody knows");
    await expect.poll(() => about.asked).toEqual([link(2)]);
    await expect(page.getByTestId("about-facts")).toHaveCount(0);
    await expect(page.getByTestId("about-people")).toHaveCount(0);
    await expect(page.getByTestId("title-about-parts")).toHaveCount(0);
    await expect(page.getByTestId("title-about-similar")).toHaveCount(0);
    await expect(phone.getByTestId("title-play")).toBeVisible();
  });
});
