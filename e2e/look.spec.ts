import { expect, type Page } from "@playwright/test";
import { openDevice, openLibrary, openProfilePlace, PHONE, test } from "./helpers";

const html = (page: Page) => page.locator("html");
/** What the refined stylesheet leaves on the page, and the classic look never does. */
const refinedStylesheet = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ui-look").trim());

test.describe("the two looks of the site", () => {
  test("an address asks for a look, the page keeps it for the next visit, and 'reset' gives the default back", async ({ browser }) => {
    const page = await openDevice(browser, { viewport: { width: 1280, height: 720 } });
    await page.goto("/tv?ui=polish");
    await expect(page.getByTestId("tv-browse")).toBeVisible();
    await expect(html(page)).toHaveAttribute("data-ui", "polish");
    expect(await refinedStylesheet(page)).toBe("polish");

    await page.goto("/tv"); // (no ?ui: what was asked for last time)
    await expect(page.getByTestId("tv-browse")).toBeVisible();
    await expect(html(page)).toHaveAttribute("data-ui", "polish");

    await page.goto("/tv?ui=classic");
    await expect(page.getByTestId("tv-browse")).toBeVisible();
    await expect(html(page)).toHaveAttribute("data-ui", "classic");
    expect(await refinedStylesheet(page)).toBe(""); // none of the refined rules matches

    await page.goto("/tv?ui=polish");
    await page.goto("/tv?ui=reset");
    await expect(page.getByTestId("tv-browse")).toBeVisible();
    await expect(html(page)).toHaveAttribute("data-ui", "classic");
    expect(await page.evaluate(() => localStorage.getItem("kino.ui"))).toBeNull();
  });

  test("the TV's settings page switches it at once, and the choice is still there after a reload", async ({ browser }) => {
    const tv = await openLibrary(browser);
    await tv.goto("/tv?ui=classic");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await openProfilePlace(tv, "settings");
    await expect(tv.getByTestId("tv-look-classic")).toHaveAttribute("aria-checked", "true");

    await tv.getByTestId("tv-look-polish").click();
    await expect(html(tv)).toHaveAttribute("data-ui", "polish");
    await expect(tv.getByTestId("tv-look-polish")).toHaveAttribute("aria-checked", "true");
    await expect(tv.getByTestId("tv-look-classic")).toHaveAttribute("aria-checked", "false");

    await tv.reload();
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(html(tv)).toHaveAttribute("data-ui", "polish");

    await openProfilePlace(tv, "settings");
    await tv.getByTestId("tv-look-classic").click();
    await expect(html(tv)).toHaveAttribute("data-ui", "classic");
    expect(await tv.evaluate(() => localStorage.getItem("kino.ui"))).toBeNull(); // (the default leaves nothing behind)
  });

  test("the phone's settings page has the same switch", async ({ browser }) => {
    const phone = await openDevice(browser, PHONE);
    await phone.goto("/?ui=classic");
    await phone.getByTestId("account-button").click();
    await phone.getByTestId("menu-settings").click();
    await expect(phone.getByTestId("look-classic")).toHaveAttribute("aria-checked", "true");

    await phone.getByTestId("look-polish").click();
    await expect(html(phone)).toHaveAttribute("data-ui", "polish");
    await expect(phone.getByTestId("look-polish")).toHaveAttribute("aria-checked", "true");

    await phone.getByTestId("look-classic").click();
    await expect(html(phone)).toHaveAttribute("data-ui", "classic");
  });
});
