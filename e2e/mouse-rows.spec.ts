import { expect, type Page } from "@playwright/test";
import { openLibrary, test, withLibrary } from "./helpers";

/**
 * A mouse and the library's rows: a wheel scrolls the page, not a row, so a row that runs off the screen has an arrow at each end for a pointer
 * (the remote and the keyboard walk the titles, and a finger swipes).
 */

const film = (id: string, title: string) => ({ id, title, year: 2000, url: `/fixtures/sample.mp4?n=${id}` });
const library = {
  updatedAt: Date.now(),
  rows: [
    { id: "top", title: "Top", source: "Test Source", items: Array.from({ length: 12 }, (_, index) => film(`t${index}`, `Top film ${index + 1}`)) },
    { id: "long", title: "A long row", source: "Test Source", items: Array.from({ length: 18 }, (_, index) => film(`l${index}`, `Long film ${index + 1}`)) },
    { id: "short", title: "A short row", source: "Test Source", items: [film("s1", "Short one"), film("s2", "Short two")] },
  ],
};

const rowOf = (tv: Page, title: string) => tv.locator(".tv-row").filter({ has: tv.getByRole("heading", { name: title }) });
const scrolled = (tv: Page, title: string) => rowOf(tv, title).locator(".tv-row-tiles").evaluate((element) => element.scrollLeft);
/** A press slides the row (smoothly): the next look is after it has stopped, not while it is still on its way (an arrow that goes at the end is gone from under a click). */
async function settled(tv: Page, title: string) {
  let was = -1;
  await expect
    .poll(async () => {
      const now = await scrolled(tv, title);
      const same = now === was;
      was = now;
      return same;
    }, { intervals: [150] })
    .toBe(true);
}

test("a long row has an arrow for the pointer on the side that has more, and the arrows walk it along and back without taking the remote's place", async ({ browser }) => {
  const tv = await openLibrary(browser, withLibrary(library));
  const first = tv.getByTestId("tv-browse-tile").first();
  await expect(first).toBeFocused();
  await expect(tv.getByTestId("tv-welcome")).toHaveCount(0, { timeout: 8_000 });

  const row = rowOf(tv, "A long row");
  const next = row.getByTestId("tv-row-next");
  const back = row.getByTestId("tv-row-back");
  await expect(next).toHaveCount(1); // more to the right, nothing to the left
  await expect(back).toHaveCount(0);
  await expect(next).toHaveCSS("opacity", "0"); // (quiet until a pointer is over the row)

  await row.locator(".tv-tile").first().hover();
  await expect(next).toHaveCSS("opacity", "1");
  expect(await scrolled(tv, "A long row")).toBe(0);

  await next.click();
  await expect.poll(() => scrolled(tv, "A long row")).toBeGreaterThan(300);
  await expect(back).toHaveCount(1); // and now more to the left
  await expect(first).toBeFocused(); // the click did not take the focus from the title the remote is on

  // To the far end, where there is no more to the right.
  for (let step = 0; step < 12 && (await next.count()) > 0; step++) {
    await next.click({ timeout: 3_000 });
    await settled(tv, "A long row");
  }
  await expect(next).toHaveCount(0);
  await expect(back).toHaveCount(1);

  // And back to the start.
  for (let step = 0; step < 12 && (await back.count()) > 0; step++) {
    await back.click({ timeout: 3_000 });
    await settled(tv, "A long row");
  }
  await expect(back).toHaveCount(0);
  expect(await scrolled(tv, "A long row")).toBe(0);
});

test("a row that fits has no arrows, and the arrows are not stops for the remote or the keyboard", async ({ browser }) => {
  const tv = await openLibrary(browser, withLibrary(library));
  await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
  await expect(rowOf(tv, "A short row").locator(".tv-row-more")).toHaveCount(0);

  await expect(tv.locator(".tv-row-more").first()).toHaveAttribute("tabindex", "-1");
  await expect(tv.locator(".tv-row-more").first()).toHaveAttribute("aria-hidden", "true");
  // The remote goes down the rows along the titles; it never lands on an arrow.
  for (let step = 0; step < 6; step++) {
    await tv.keyboard.press("ArrowDown");
    expect(await tv.evaluate(() => document.activeElement?.classList.contains("tv-row-more"))).toBe(false);
  }
});

test("the arrow of a row of posters is level with the posters, on the first row too", async ({ browser }) => {
  const tv = await openLibrary(browser, withLibrary(library));
  await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
  for (const title of ["Top", "A long row"]) {
    const row = rowOf(tv, title);
    await row.locator(".tv-tile").first().hover();
    const next = row.getByTestId("tv-row-next");
    await expect(next).toHaveCSS("opacity", "1");
    const arrow = (await next.boundingBox())!;
    const art = (await row.locator(".tv-tile-art").first().boundingBox())!;
    expect(Math.abs(arrow.y + arrow.height / 2 - (art.y + art.height / 2)), `${title}: the arrow is level with the pictures`).toBeLessThanOrEqual(8);
  }
});
