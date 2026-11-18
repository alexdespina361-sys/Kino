import { expect, test } from "@playwright/test";

/*
 * A browser that cannot run Kino (too old for its syntax, or the app's file did not come) is told so, instead of a black page: public/old-browser.js.
 * A browser that runs it is told nothing. The app's own file is made unreadable here, as an old browser would find it.
 */

const NOTICE = "#kino-old-browser";
const unreadable = (page: import("@playwright/test").Page) =>
  page.route(/\/assets\/index-[\w-]+\.js$/, (route) => route.fulfill({ contentType: "text/javascript", body: "const tooNew = ;" }));

test("a browser that cannot read the app is told so, with a button that tries again", async ({ page }) => {
  await unreadable(page);
  await page.goto("/tv");
  const notice = page.locator(NOTICE);
  await expect(notice).toBeVisible({ timeout: 10_000 });
  await expect(notice.getByRole("heading")).toHaveText("Kino could not start");
  await expect(notice).toContainText("Chrome 94");
  const again = notice.getByRole("button", { name: "Try again" });
  // (A TV's remote presses what has the focus.)
  await expect(again).toBeFocused();
  await page.unroute(/\/assets\/index-[\w-]+\.js$/);
  await again.click();
  // Tried again with the app's file as it is: the app starts and the notice is gone.
  await expect(page.locator("html")).toHaveAttribute("data-kino-started", "1");
  await expect(notice).toHaveCount(0);
});

test("in the browser's language", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ locale: "ro-RO", baseURL });
  const page = await context.newPage();
  await unreadable(page);
  await page.goto("/");
  await expect(page.locator(NOTICE).getByRole("heading")).toHaveText("Kino nu a putut porni", { timeout: 10_000 });
  await expect(page.locator(NOTICE).getByRole("button")).toHaveText("Încearcă din nou");
  await context.close();
});

test("a browser that runs the app is told nothing", async ({ page }) => {
  await page.goto("/tv");
  await page.waitForLoadState("load");
  await expect(page.locator("html")).toHaveAttribute("data-kino-started", "1");
  // (The notice looks 3 seconds after the page has loaded.)
  await page.waitForTimeout(4_000);
  await expect(page.locator(NOTICE)).toHaveCount(0);
});
