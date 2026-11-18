import { expect } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { openLibrary, openPairedPhone, openTv, test, withLibrary } from "./helpers";

const film = (id: string, title: string) => ({ id, title, kind: "movie" as const, url: `/fixtures/sample.mp4?${id}` });
const library = {
  updatedAt: Date.now(),
  rows: [1, 2, 3].map((r) => ({ id: `r${r}`, title: `Shelf ${r}`, source: "Test Source", kind: "movie", items: [1, 2, 3].map((n) => film(`s${r}-${n}`, `Shelf ${r} Film ${n}`)) })),
};
const watched = [1, 2, 3, 4, 5].map((n) => film(`w${n}`, `Watched Film ${n}`));

test("the TV's Home has the row of what people watch on Kino after its second row, and a section's page does not; three titles are too few for a row", async ({ browser }) => {
  const tv = await openLibrary(browser, async (context) => {
    await withLibrary(library)(context);
    await context.route("**/api/watching", (route) => route.fulfill({ json: { items: watched } }));
  });
  const row = tv.locator('.tv-rows > .tv-row[data-row-id="watching"]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(en["rows.watching"]);
  await expect(row).toContainText("Watched Film 1");
  const ids = await tv.locator(".tv-rows > .tv-row").evaluateAll((rows) => rows.map((each) => each.getAttribute("data-row-id")));
  expect(ids.indexOf("watching"), ids.join(", ")).toBe(ids.indexOf("r2") + 1);

  await tv.getByTestId("rail-movies").click();
  await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "movies");
  await expect(tv.locator(".tv-rows > .tv-row").first()).toBeVisible();
  await expect(tv.locator('.tv-row[data-row-id="watching"]')).toHaveCount(0);

  const few = await openLibrary(browser, async (context) => {
    await withLibrary(library)(context);
    await context.route("**/api/watching", (route) => route.fulfill({ json: { items: watched.slice(0, 3) } }));
  });
  await expect(few.locator('.tv-rows > .tv-row[data-row-id="r3"]')).toHaveCount(1);
  await expect(few.locator('.tv-row[data-row-id="watching"]')).toHaveCount(0);
});

test("the phone's Home has the row too", async ({ browser }) => {
  const tv = await openTv(browser);
  const phone = await openPairedPhone(browser, tv);
  await phone.context().route("**/api/library", (route) => route.fulfill({ json: library }));
  await phone.context().route("**/api/watching", (route) => route.fulfill({ json: { items: watched } }));
  await phone.reload();
  const row = phone.getByTestId("library-watching");
  await expect(row).toBeVisible();
  await expect(row).toContainText(en["rows.watching"]);
  await expect(row).toContainText("Watched Film 2");
});
