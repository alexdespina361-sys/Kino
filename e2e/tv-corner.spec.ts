import { expect, type Page } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { it as italian } from "../src/client/i18n/it";
import { ro } from "../src/client/i18n/ro";
import { openLibrary, openTvSettings, openTvSignIn, readPairingCode, test, withLibrary } from "./helpers";

/**
 * The corners and edges of the TV's pages that every page shares: the way out of a full-screen page, a code that can be copied, the wordmark
 * that stays beside the menu when it opens, and the keys of the search keyboard. (What a page holds is tested with the page.)
 */

const HD = { width: 1280, height: 720 };
const FULL_HD = { width: 1920, height: 1080 };

const films = Array.from({ length: 6 }, (_, index) => ({ id: `f${index}`, title: `Film number ${index + 1}`, year: 1930 + index, url: `/fixtures/sample.mp4?n=${index}` }));
const library = { updatedAt: Date.now(), rows: [{ id: "r1", title: "Classics", source: "Test Source", items: films }] };

/** Where a button is (its right edge and top, its height) and what it is filled with. */
const look = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((element) => {
    const { top, right, height } = element.getBoundingClientRect();
    return { top, right, height, fill: getComputedStyle(element).backgroundColor };
  });

for (const viewport of [HD, FULL_HD]) {
  test(`the way out of a full-screen page is one quiet pill in one corner, whichever page it is: ${viewport.width} wide`, async ({ browser }) => {
    const tv = await openLibrary(browser, undefined, viewport);
    const seen: Record<string, Awaited<ReturnType<typeof look>>> = {};

    await tv.getByTestId("rail-connect").click(); // the code of a phone to connect
    seen["connect"] = await look(tv, "tv-back-to-library");
    await tv.getByTestId("tv-back-to-library").click();

    await tv.getByTestId("rail-party").click(); // the watch party's two ways in
    seen["party"] = await look(tv, "tv-back-to-library");
    await tv.getByTestId("tv-party-join").click();
    seen["join"] = await look(tv, "tv-party-join-back");
    await tv.getByTestId("tv-party-join-back").click();
    await tv.getByTestId("tv-back-to-library").click();

    await openTvSignIn(tv); // signing in: the code, then the form
    seen["sign-in"] = await look(tv, "tv-signin-back");
    await tv.getByTestId("tv-signin-email").click();
    seen["form"] = await look(tv, "tv-signin-form-back");
    await tv.getByTestId("tv-signin-form-back").click();
    await tv.getByTestId("tv-signin-back").click();

    await openTvSettings(tv);
    seen["settings"] = await look(tv, "tv-account-back");

    const first = Object.values(seen)[0]!;
    for (const [page, one] of Object.entries(seen)) {
      expect(Math.abs(one.right - first.right), `${page}: the right edge`).toBeLessThanOrEqual(1);
      expect(Math.abs(one.top - first.top), `${page}: the top`).toBeLessThanOrEqual(1);
      expect(Math.abs(one.height - first.height), `${page}: the height`).toBeLessThanOrEqual(1);
      expect(one.fill, `${page}: the fill`).toBe(first.fill);
    }
    expect(first.fill, "never the accent's colour").not.toBe("rgb(229, 9, 20)");
    expect(first.right, "on the same edge as the library's corner buttons").toBeGreaterThan(viewport.width * 0.9);
    expect(first.right).toBeLessThanOrEqual(viewport.width * 0.96);
  });
}

for (const viewport of [HD, { width: 1024, height: 768 }, FULL_HD]) {
  test(`the wordmark stays where it is: in the library, in the open menu and on a page that fills the screen: ${viewport.width} wide`, async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library), viewport);
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
    const place = (selector: string) =>
      tv.evaluate((sel) => {
        const { left, top, width, height } = document.querySelector(sel)!.getBoundingClientRect();
        return { left, top, width, height };
      }, selector);
    const library_ = await place(".tv-browse-logo");

    await tv.keyboard.press("ArrowLeft");
    await expect(tv.getByTestId("tv-rail")).toHaveAttribute("data-open", "true");
    const menu = await place(".tv-rail-brand");
    await tv.keyboard.press("Escape");

    await tv.getByTestId("rail-connect").click();
    await expect(tv.getByTestId("tv-back-to-library")).toBeVisible();
    const page = await place(".tv-brand");

    for (const [where, one] of Object.entries({ menu, page })) {
      expect(Math.abs(one.left - library_.left), `${where}: left`).toBeLessThanOrEqual(1);
      expect(Math.abs(one.top - library_.top), `${where}: top`).toBeLessThanOrEqual(1);
      expect(Math.abs(one.width - library_.width), `${where}: width`).toBeLessThanOrEqual(1);
      expect(Math.abs(one.height - library_.height), `${where}: height`).toBeLessThanOrEqual(1);
    }
  });
}

test("a code on the screen is selected whole by a click, and the button under it copies it and says so", async ({ browser }) => {
  const tv = await openLibrary(browser, (context) => context.grantPermissions(["clipboard-read", "clipboard-write"]), HD);
  await tv.getByTestId("rail-connect").click();
  const code = tv.getByTestId("pairing-code");
  await expect(code).toBeVisible();
  const digits = await readPairingCode(tv);
  expect(digits).toMatch(/^\d{6}$/);

  await code.click();
  expect(await tv.evaluate(() => (window.getSelection()?.toString() ?? "").replace(/\s/g, ""))).toBe(digits);

  const copy = tv.getByTestId("pairing-code-copy");
  await expect(copy).toContainText(en["friends.copyCode"]);
  await copy.click();
  await expect(copy).toContainText(en["friends.codeCopied"]);
  expect(await tv.evaluate(() => navigator.clipboard.readText())).toBe(digits);
  await expect(copy).toContainText(en["friends.copyCode"], { timeout: 6_000 }); // (it says so for a moment, and goes back)
});

test("the sign-in code has its button too, and the remote reaches it", async ({ browser }) => {
  const tv = await openLibrary(browser, (context) => context.grantPermissions(["clipboard-read", "clipboard-write"]), HD);
  await openTvSignIn(tv);
  const code = tv.getByTestId("tv-link-code");
  await expect(code).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const shown = (await code.textContent())!.trim();
  const copy = tv.getByTestId("tv-link-code-copy");
  await copy.focus();
  await tv.keyboard.press("Enter");
  await expect(copy).toContainText(en["friends.codeCopied"]);
  expect(await tv.evaluate(() => navigator.clipboard.readText())).toBe(shown);
});

for (const [language, words] of [["en", en], ["ro", ro], ["it", italian]] as const) {
  for (const viewport of [HD, { width: 1024, height: 768 }]) {
    test(`the open menu carries the wordmark, clear of its first line, and every line of it fits: ${language} at ${viewport.width} wide`, async ({ browser }) => {
      const tv = await openLibrary(browser, withLibrary(library), viewport, { "kino.lang": language });
      await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
      const brand = tv.locator(".tv-rail-brand");
      await expect(brand).toHaveCSS("opacity", "0"); // (shut, the page's own wordmark is the one that shows)

      await tv.keyboard.press("ArrowLeft");
      await expect(tv.getByTestId("tv-rail")).toHaveAttribute("data-open", "true");
      await expect(brand).toHaveCSS("opacity", "1");

      // The same place as the page's own wordmark, which the open menu covers: the name does not move.
      const [mine, page] = await tv.evaluate(() => {
        const rect = (selector: string) => {
          const { left, top, width, height } = document.querySelector(selector)!.getBoundingClientRect();
          return { left, top, width, height };
        };
        return [rect(".tv-rail-brand"), rect(".tv-browse-logo")] as const;
      });
      expect(Math.abs(mine.left - page.left), "the wordmark's left").toBeLessThanOrEqual(2);
      expect(Math.abs(mine.top - page.top), "the wordmark's top").toBeLessThanOrEqual(2);
      expect(Math.abs(mine.height - page.height), "the wordmark's height").toBeLessThanOrEqual(2);

      // Clear of the first line, and every line's words whole (none ends in dots).
      const first = (await tv.getByTestId("rail-search").boundingBox())!;
      expect(mine.top + mine.height, "the wordmark is above the first line").toBeLessThanOrEqual(first.y);
      const cut = await tv.getByTestId("tv-rail").locator("button span").evaluateAll((spans) =>
        spans.filter((span) => span.scrollWidth > span.clientWidth + 0.5).map((span) => span.textContent),
      );
      expect(cut, "the words that do not fit").toEqual([]);
      await expect(tv.getByTestId("rail-connect")).toContainText(words["tv.connectPhone"]);
    });
  }
}

for (const viewport of [HD, FULL_HD]) {
  test(`the keys of the search keyboard are a little wider than tall, not slabs and not squares: ${viewport.width} wide`, async ({ browser }) => {
    const tv = await openLibrary(browser, undefined, viewport);
    await tv.getByTestId("rail-search").click();
    await expect(tv.getByTestId("tv-search")).toBeVisible();
    for (const key of ["key-a", "key-z", "key-5", "key-left", "key-delete", "key-clear"]) {
      const box = (await tv.getByTestId(key).boundingBox())!;
      const ratio = box.width / box.height;
      expect(ratio, `${key} is ${Math.round(box.width)} by ${Math.round(box.height)}`).toBeGreaterThan(1.0);
      expect(ratio, `${key} is ${Math.round(box.width)} by ${Math.round(box.height)}`).toBeLessThan(1.3);
    }
    const space = (await tv.getByTestId("key-space").boundingBox())!;
    const letter = (await tv.getByTestId("key-a").boundingBox())!;
    expect(space.height, "Space is as tall as a letter").toBeCloseTo(letter.height, 0);
  });
}
