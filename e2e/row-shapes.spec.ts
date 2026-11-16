import { expect, type BrowserContext, type Page } from "@playwright/test";
import { openDevice, openLibrary, PHONE, pressMenuLine, readPairingCode, test, withLibrary } from "./helpers";

/**
 * Rows of more than one shape (the owner, 15 Nov: "Mix the row shapes (posters, wide cards, category rows) instead of one size everywhere, on the phone too"):
 * the second row of the library and every third after it are wide cards, a still of each title, on the TV and on the phone; the phone has the row of
 * categories as well; and Up and Down between rows of different sizes land on the tile under the one the remote is on. (See src/client/shared/shapes.ts.)
 * The pictures are drawn here: nothing is asked of the movie database.
 */

const film = (id: string, title: string) => ({
  id,
  title,
  url: `/fixtures/sample.mp4?n=${encodeURIComponent(id)}`,
  image: `https://image.tmdb.org/t/p/w500/${id}.jpg`,
  backdrop: `https://image.tmdb.org/t/p/w1280/${id}-wide.jpg`,
});
const rowOf = (id: string, title: string, count = 20) => ({ id, title, source: "Test Source", items: Array.from({ length: count }, (_, i) => film(`${id}-${i}`, `${title} ${i + 1}`)) });
const library = { updatedAt: Date.now(), rows: Array.from({ length: 8 }, (_, i) => rowOf(`r${i}`, `Row ${i + 1}`)) };

async function setup(context: BrowserContext) {
  await withLibrary(library)(context);
  await context.route(/image\.tmdb\.org/, (route) => {
    const wide = route.request().url().includes("-wide");
    const [w, h] = wide ? [1280, 720] : [500, 750];
    return route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#345"/></svg>` });
  });
}

const focused = (tv: Page) => tv.evaluate(() => {
  const element = document.activeElement as HTMLElement;
  return { row: element.closest(".tv-row")?.getAttribute("aria-label"), col: Number(element.dataset.col) };
});

test("the TV draws the second row of the library and every third after it as wide cards, each with its still", async ({ browser }) => {
  const tv = await openLibrary(browser, setup, { width: 1920, height: 1080 });
  const wide = tv.locator('.tv-row[data-shape="landscape"]');
  await expect(wide).toHaveCount(3);
  expect(await wide.evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label")))).toEqual(["Row 2", "Row 5", "Row 8"]);
  const card = tv.getByRole("region", { name: "Row 2" }).getByTestId("tv-browse-tile").first();
  await expect(card).toHaveClass(/tv-tile-landscape/);
  await expect(card.locator("img")).toHaveAttribute("src", /w1280\/r1-0-wide\.jpg$/);
  await expect(card.locator("img")).toHaveAttribute("srcset", /w780\/r1-0-wide\.jpg 780w/); // (a card takes the 780 px still, not the 1280 px one)
  const box = (await card.boundingBox())!;
  expect(box.width / box.height).toBeGreaterThan(1.3); // (wide: its picture is 16 by 9, with its name under it)
  // The other rows of the library are posters, the first one a ranking.
  await expect(tv.getByRole("region", { name: "Row 3" }).getByTestId("tv-browse-tile").first()).toHaveClass(/tv-tile-poster/);
  await expect(tv.getByRole("region", { name: "Row 1" })).toHaveAttribute("data-layout", "ranked");
});

test("Up and Down between a row of wide cards and a row of posters land on the tile under the one the remote is on", async ({ browser }) => {
  const tv = await openLibrary(browser, setup, { width: 1920, height: 1080 });
  await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
  await tv.keyboard.press("ArrowDown"); // the ranking's first title -> the first wide card
  await expect.poll(() => focused(tv)).toEqual({ row: "Row 2", col: 0 });
  await tv.keyboard.press("ArrowDown"); // ...and the first poster under it, not the second (the card's middle is over that one)
  await expect.poll(() => focused(tv)).toEqual({ row: "Row 3", col: 0 });
  for (let i = 0; i < 5; i++) await tv.keyboard.press("ArrowRight");
  await expect.poll(() => focused(tv)).toEqual({ row: "Row 3", col: 5 });
  await tv.keyboard.press("ArrowUp"); // the sixth poster stands over the third wide card, not the sixth (two screens along)
  await expect.poll(() => focused(tv)).toEqual({ row: "Row 2", col: 2 });
  await tv.keyboard.press("ArrowDown"); // and back down, to a poster under that card
  const back = await focused(tv);
  expect(back.row).toBe("Row 3");
  expect(back.col).toBeGreaterThanOrEqual(4);
  expect(back.col).toBeLessThanOrEqual(6);
});

test("the phone has the wide cards in the same rows, and a row of categories that opens a whole row", async ({ browser }) => {
  const tv = await openDevice(browser, { viewport: { width: 1280, height: 720 } }, {}, setup);
  await tv.goto("/tv");
  await pressMenuLine(tv, "rail-connect");
  const phone = await openDevice(browser, PHONE, {}, setup);
  await phone.goto("/");
  await phone.getByTestId("code-input").fill(await readPairingCode(tv));
  await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");

  const rows = phone.getByTestId("library-row");
  await expect(rows).toHaveCount(8);
  expect(await rows.evaluateAll((all) => all.map((row) => row.getAttribute("data-shape")))).toEqual([null, "landscape", null, null, "landscape", null, null, "landscape"]);
  const card = rows.nth(1).getByTestId("library-tile").first();
  await expect(card.locator("img")).toHaveAttribute("src", /r1-0-wide\.jpg$/);
  const box = (await card.locator(".lib-art").boundingBox())!;
  expect(box.width / box.height).toBeGreaterThan(1.6);

  // The categories come after the third row: a card for each row, that opens it.
  const categories = phone.getByTestId("library-categories");
  await expect(categories).toBeVisible();
  expect(await phone.evaluate(() => {
    const all = [...document.querySelectorAll('[data-testid="library-row"], [data-testid="library-categories"]')];
    return all.findIndex((one) => one.getAttribute("data-testid") === "library-categories");
  })).toBe(3);
  await expect(categories.getByTestId("library-category")).toHaveCount(8);
  await categories.getByTestId("library-category").nth(4).click();
  await expect(phone.getByTestId("row-grid")).toBeVisible();
  await expect(phone.getByTestId("row-page")).toContainText("Row 5");
  await expect(phone.getByTestId("row-grid").getByTestId("library-tile").first()).toHaveAttribute("title", "Row 5 1");
});
