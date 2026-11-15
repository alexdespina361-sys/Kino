import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { openDevice, openLibrary, openTv, PHONE, readPairingCode, test, withLibrary } from "./helpers";

/**
 * What no source had: a film or an episode that found nothing on two separate plays is marked "Not available yet" on its title's page, on the TV and on the
 * phone (src/server/library/unavailable.ts). It is a label only: the episode is still a button, and Play is where it was. The server's answers are the test's
 * (the server these tests run against has no library).
 */

const show = { id: "s1", title: "The Long Night", year: 2019, kind: "series", url: "https://shows.example/watch/7?s=1&e=1", description: "A show about a very long night." };
const film = { id: "f1", title: "A Quiet Film", year: 2008, kind: "movie", url: "https://films.example/watch/1" };
const other = { id: "f2", title: "A Film That Plays", year: 2010, kind: "movie", url: "https://films.example/watch/2" };
const library = { updatedAt: Date.now(), rows: [{ id: "top", title: "Top", source: "Test Source", items: [show, film, other] }] };

/**
 * The library, a show of three episodes, and what nobody could play: the show's second episode, and the first film. Every question about it is recorded; with
 * `held`, the answers wait for it, so a test can look at the page before the answer comes and after.
 */
function answers(held?: Promise<void>) {
  const asked: string[] = [];
  const setup = async (context: BrowserContext) => {
    await withLibrary(library)(context);
    await context.route(/\/api\/library\/seasons/, (route) => route.fulfill({ json: { seasons: [1] } }));
    await context.route(/\/api\/library\/episodes/, (route) =>
      route.fulfill({ json: { episodes: [1, 2, 3].map((episode) => ({ season: 1, episode, title: `Episode ${episode}`, runtime: 40, url: `https://shows.example/watch/7?s=1&e=${episode}` })) } }),
    );
    await context.route(/\/api\/library\/about/, (route) => route.fulfill({ json: { about: null } }));
    await context.route(/\/api\/library\/unavailable/, async (route) => {
      const url = new URL(route.request().url()).searchParams.get("url") ?? "";
      asked.push(url);
      await held;
      const marks = url === show.url ? { title: false, episodes: [{ season: 1, episode: 2 }] } : url === film.url ? { title: true, episodes: [] } : { title: false, episodes: [] };
      return route.fulfill({ json: marks, headers: { "cache-control": "no-store" } });
    });
  };
  return { asked, setup };
}

/** Where something is once it has stopped moving (a page rises into place as it opens). */
async function still(target: ReturnType<Page["getByTestId"]>) {
  let before = await target.boundingBox();
  for (;;) {
    await new Promise((wait) => setTimeout(wait, 150));
    const now = await target.boundingBox();
    if (now && before && now.x === before.x && now.y === before.y) return now;
    before = now;
  }
}

const marked = (episodes: ReturnType<Page["getByTestId"]>) =>
  episodes.evaluateAll((rows) => rows.map((row) => [row.getAttribute("data-episode"), row.hasAttribute("data-unavailable"), row.querySelector('[data-testid="episode-unavailable"]')?.textContent ?? null]));

test.describe("what no source had, on the TV", () => {
  test("a show's page marks the episode nobody could play, and only that one; it is still a button to press", async ({ browser }) => {
    const told = answers();
    const tv = await openLibrary(browser, told.setup);
    await tv.locator('[data-testid="tv-browse-tile"][title="The Long Night"]').click();
    const page = tv.getByTestId("tv-detail");
    await expect(page.getByTestId("tv-episode")).toHaveCount(3);
    await expect.poll(() => marked(page.getByTestId("tv-episode"))).toEqual([
      ["1", false, null],
      ["2", true, "Not available yet"],
      ["3", false, null],
    ]);
    await expect(page.getByTestId("tv-episode").nth(1)).toBeEnabled();
    await expect(page.getByTestId("tv-detail-unavailable")).toHaveCount(0); // (a show is never marked itself: its episodes are)
    expect(told.asked).toEqual([show.url]); // (one question for the show, not one for each episode)
  });

  test("a film's page says that no source had it, and the answer does not move Play; a film that plays says nothing", async ({ browser }) => {
    let open = () => {};
    const told = answers(new Promise<void>((go) => (open = go)));
    const tv = await openLibrary(browser, told.setup);
    await tv.locator('[data-testid="tv-browse-tile"][title="A Quiet Film"]').click();
    const page = tv.getByTestId("tv-detail");
    const before = await still(page.getByTestId("tv-detail-play"));
    open();
    await expect(page.getByTestId("tv-detail-unavailable")).toHaveText("No source had this film the last times it was tried. You can try again.");
    expect((await still(page.getByTestId("tv-detail-play"))).y, "the answer did not move Play").toBe(before.y);
    await page.getByTestId("tv-detail-close").click();
    await expect(page).toHaveCount(0);

    await tv.locator('[data-testid="tv-browse-tile"][title="A Film That Plays"]').click();
    await expect(page.getByTestId("tv-detail-title")).toHaveText("A Film That Plays");
    await expect.poll(() => told.asked).toEqual([film.url, other.url]);
    await expect(page.getByTestId("tv-detail-unavailable")).toHaveCount(0);
  });
});

test.describe("what no source had, on a phone that is the screen", () => {
  test("a film's page says it under the buttons, where the page grows, and the answer does not move Play", async ({ browser }) => {
    let open = () => {};
    const told = answers(new Promise<void>((go) => (open = go)));
    const size = { width: 320, height: 568 };
    const tv = await openDevice(browser, { ...PHONE, viewport: size, screen: size }, {}, told.setup);
    await tv.goto("/tv");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await tv.locator('.tv-tile[title="A Quiet Film"]').first().tap();
    const page = tv.getByTestId("tv-detail");
    const play = page.getByTestId("tv-detail-play");
    const before = await still(play);
    open();
    await expect(page.getByTestId("tv-detail-unavailable")).toBeVisible();
    expect((await still(play)).y, "the answer did not move Play").toBe(before.y);
    const note = await page.getByTestId("tv-detail-unavailable").boundingBox();
    expect(note!.y, "the note is under Play").toBeGreaterThan(before.y);
  });
});

test.describe("what no source had, on the phone", () => {
  async function pairedPhone(browser: Browser, setup: (context: BrowserContext) => Promise<void>): Promise<Page> {
    const [tv, phone] = await Promise.all([openTv(browser), openDevice(browser, PHONE, {}, setup)]);
    await phone.goto("/");
    await phone.getByTestId("code-input").fill(await readPairingCode(tv)); // connects by itself on the sixth digit
    await expect(phone.getByTestId("tv-online")).toHaveClass(/\bok\b/);
    await expect(phone.getByTestId("library-row").first()).toBeVisible();
    return phone;
  }

  test("a show's page marks the episode, and a film's page says it under its buttons", async ({ browser }) => {
    const told = answers();
    const phone = await pairedPhone(browser, told.setup);
    await phone.locator('[data-testid="library-tile"][title="The Long Night"]').tap();
    const page = phone.getByTestId("title-sheet");
    await expect(page.getByTestId("title-episode")).toHaveCount(3);
    await expect.poll(() => marked(page.getByTestId("title-episode"))).toEqual([
      ["1", false, null],
      ["2", true, "Not available yet"],
      ["3", false, null],
    ]);
    await expect(page.getByTestId("title-unavailable")).toHaveCount(0);
    await phone.getByTestId("title-back").tap();
    await expect(page).toHaveCount(0);

    await phone.locator('[data-testid="library-tile"][title="A Quiet Film"]').tap();
    await expect(page.getByTestId("title-unavailable")).toHaveText("No source had this film the last times it was tried. You can try again.");
    await expect(page.getByTestId("title-play")).toBeVisible();
    const play = await page.getByTestId("title-play").boundingBox();
    const note = await page.getByTestId("title-unavailable").boundingBox();
    expect(note!.y, "the note is under Play, which it does not move").toBeGreaterThan(play!.y);
  });
});
