import { expect, type Browser, type Page } from "@playwright/test";
import { test, withLibrary } from "./helpers";

/*
 * A computer (a laptop or a PC, with a mouse or a pad) gets the big screen's page at a computer's size: up to 1920 by 1080 nothing changes, and past it
 * the page stops growing with the window, so a wide monitor shows more of the library and not the same titles larger. A TV keeps its own size whatever its width.
 */

const films = Array.from({ length: 30 }, (_, i) => ({ id: `f${i}`, title: `Film number ${i + 1}`, year: 1990 + i, url: `/fixtures/sample.mp4?n=${i}` }));
const library = { updatedAt: Date.now(), rows: [{ id: "r1", title: "Classics", source: "Test Source", items: films }] };
const search = (query: string) => films.filter((film) => film.title.toLowerCase().includes(query.toLowerCase()));
const TIZEN = "Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) 94.0.4606.31/7.0 TV Safari/537.36";

/** A screen that has not been told what it is (the other tests' screens are told they are watched from the couch: playwright.config.ts). */
async function open(browser: Browser, baseURL: string, viewport: { width: number; height: number }, extra: { userAgent?: string; fit?: string } = {}): Promise<Page> {
  const kept = [{ name: "kino.fullscreen.left", value: "1" }, ...(extra.fit ? [{ name: "kino.fit", value: extra.fit }] : [])];
  const context = await browser.newContext({ viewport, ...(extra.userAgent ? { userAgent: extra.userAgent } : {}), storageState: { cookies: [], origins: [{ origin: baseURL, localStorage: kept }] } });
  await withLibrary(library, search)(context);
  const page = await context.newPage();
  await page.goto("/tv");
  await expect(page.getByTestId("tv-browse")).toBeVisible();
  return page;
}
const unit = (page: Page) => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".tv")!).fontSize));
const fit = (page: Page) => page.evaluate(() => document.documentElement.dataset.fit ?? "");
/** How many titles of the first row are wholly on screen. */
const acrossRow = (page: Page) => page.locator(".tv-row .tv-tile").evaluateAll((tiles) => tiles.filter((tile) => tile.getBoundingClientRect().left >= 0 && tile.getBoundingClientRect().right <= innerWidth).length);
/** How many titles sit side by side in a grid, and whether the last of them is wholly on screen. */
const grid = (page: Page, selector: string) =>
  page.locator(`${selector} .tv-tile`).evaluateAll((tiles) => {
    const lefts = [...new Set(tiles.map((tile) => Math.round(tile.getBoundingClientRect().left)))];
    return { columns: lefts.length, inside: tiles.every((tile) => tile.getBoundingClientRect().right <= innerWidth) };
  });
/** The grid of a category's titles (the library's one row). */
async function openCategory(page: Page) {
  await page.getByTestId("rail-categories").click();
  await page.locator(".tv-grid .tv-tile").first().click();
  await expect(page.locator(".tv-grid .tv-tile")).toHaveCount(films.length);
}

test("a computer up to 1920 by 1080 is drawn as it was: the same size and the same grids", async ({ browser, baseURL }) => {
  const laptop = await open(browser, baseURL!, { width: 1280, height: 720 });
  expect(await fit(laptop)).toBe("desk");
  expect(await unit(laptop)).toBeCloseTo(12.8, 1);
  const full = await open(browser, baseURL!, { width: 1920, height: 1080 });
  expect(await fit(full)).toBe("desk");
  expect(await unit(full)).toBeCloseTo(19.2, 1);
  await openCategory(full);
  expect(await grid(full, ".tv-grid")).toEqual({ columns: 8, inside: true });
});

test("a wide monitor shows more titles, not bigger ones: in a row, in a grid and in what a search found", async ({ browser, baseURL }) => {
  const full = await open(browser, baseURL!, { width: 1920, height: 1080 });
  const onFull = await acrossRow(full);

  const monitor = await open(browser, baseURL!, { width: 2560, height: 1440 });
  expect(await unit(monitor)).toBeCloseTo(19.2, 1);
  expect(await acrossRow(monitor)).toBeGreaterThanOrEqual(onFull + 2); // (a row's poster is a little larger than a grid's: two more whole ones, and a third in part)

  await openCategory(monitor);
  expect(await grid(monitor, ".tv-grid")).toEqual({ columns: 11, inside: true });

  await monitor.getByTestId("rail-search").click();
  await monitor.keyboard.type("film");
  await expect(monitor.locator(".tv-results .tv-tile")).toHaveCount(films.length);
  expect(await grid(monitor, ".tv-results")).toEqual({ columns: 8, inside: true });

  // A window made narrower again goes back to what a 16 by 9 screen shows.
  await monitor.setViewportSize({ width: 1600, height: 900 });
  await expect.poll(() => grid(monitor, ".tv-results")).toEqual({ columns: 5, inside: true });

  // An ultra-wide one: more again, and all of it on the screen.
  const ultra = await open(browser, baseURL!, { width: 3440, height: 1440 });
  await openCategory(ultra);
  expect(await grid(ultra, ".tv-grid")).toEqual({ columns: 15, inside: true });
});

test("a TV keeps its own size whatever its width, and so does a computer that was told it is watched from the couch", async ({ browser, baseURL }) => {
  const tv = await open(browser, baseURL!, { width: 2560, height: 1440 }, { userAgent: TIZEN });
  expect(await fit(tv)).toBe("");
  expect(await unit(tv)).toBeCloseTo(25.6, 1);
  await openCategory(tv);
  expect(await grid(tv, ".tv-grid")).toEqual({ columns: 8, inside: true });

  const couch = await open(browser, baseURL!, { width: 2560, height: 1440 }, { fit: "couch" });
  expect(await fit(couch)).toBe("");
  expect(await unit(couch)).toBeCloseTo(25.6, 1);
});

test("J, K and L go back, pause and go on in a film, as they do on the video sites; in the search they are letters", async ({ browser, baseURL }) => {
  const page = await open(browser, baseURL!, { width: 1280, height: 720 });
  await page.getByTestId("rail-search").click();
  await page.keyboard.type("jkl");
  await expect(page.getByTestId("tv-query")).toHaveText("jkl");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace");
  await page.keyboard.press("Escape");

  await page.getByTestId("rail-home").click();
  await page.locator(".tv-row .tv-tile").first().click();
  await page.getByTestId("tv-detail-play").click();
  const root = page.getByTestId("tv");
  await expect(root).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
  await page.keyboard.press("k");
  await expect(root).toHaveAttribute("data-state", "paused");
  const before = Number(await root.getAttribute("data-time"));
  await page.keyboard.press("l");
  await expect.poll(async () => Number(await root.getAttribute("data-time"))).toBeGreaterThan(before + 5);
  const after = Number(await root.getAttribute("data-time"));
  await page.keyboard.press("j");
  await expect.poll(async () => Number(await root.getAttribute("data-time"))).toBeLessThan(after - 5);
  await page.keyboard.press("k");
  await expect(root).toHaveAttribute("data-state", "playing");
});
