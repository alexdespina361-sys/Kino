import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { it as italian } from "../src/client/i18n/it";
import { ro } from "../src/client/i18n/ro";
import { openDevice, openLibrary, openTvSettings, openTvSignIn, readPairingCode, test, withLibrary } from "./helpers";

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

/**
 * The cat's ears on the wordmark (Logo.tsx): a second picture over the plain one, shown while the cat is on (the cat's own setting, as the library's corner
 * button has it), and the wordmark never moves for them. The ginger cat is the flat one, which a headless browser draws without trouble.
 */
const WANTS_CAT = { "kino.cat": JSON.stringify({ on: true, quiet: false, films: true, look: "ginger" }) };
const hostWith = (cat: boolean, asked = { count: 0 }) => async (context: BrowserContext) => {
  await withLibrary(library)(context);
  await context.route("**/api/features", (route) => {
    asked.count++;
    return route.fulfill({ json: { cat } });
  });
};
const rect = (locator: Locator) =>
  locator.evaluate((element) => {
    const { left, top, width, height } = element.getBoundingClientRect();
    return { left, top, width, height };
  });

test("the wordmark has the cat's ears when the cat is on, and only then, and it does not move for them", async ({ browser }) => {
  const seen: Record<string, Awaited<ReturnType<typeof rect>>> = {};
  for (const [name, seed, cat] of [
    ["no cat asked for", {}, true],
    ["no cat on the host", WANTS_CAT, false],
    ["the cat", WANTS_CAT, true],
  ] as const) {
    const asked = { count: 0 };
    const tv = await openLibrary(browser, hostWith(cat, asked), FULL_HD, seed);
    const logo = tv.locator(".tv-browse-logo .logo");
    const ears = name === "the cat";
    if (seed === WANTS_CAT) await expect.poll(() => asked.count, name).toBeGreaterThan(0); // (the host has been asked and has answered: now it is known)
    else expect(asked.count, "a screen that has not asked for the cat does not ask the host about it").toBe(0);
    if (!ears) await tv.waitForTimeout(300); // (an answer that leaves it off has nothing to show for itself: give a late change time to come)
    await expect(logo, name).toHaveAttribute("data-cat", ears ? "on" : "off");
    await expect(logo.locator(".logo-ears"), name).toHaveCSS("opacity", ears ? "1" : "0");
    await expect(logo, "named for a screen reader whichever picture it has").toHaveAccessibleName("Kino");
    seen[name] = await rect(logo);
  }
  expect(seen["the cat"], "the box with the ears is the box without them").toEqual(seen["no cat asked for"]);
});

test("the wordmark has its size before its pictures have come, the two pictures sit exactly over each other, and the box does not change when they arrive", async ({ browser }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  try {
    const tv = await openLibrary(
      browser,
      async (context) => {
        await hostWith(true)(context);
        await context.route("**/branding/*.svg", async (route) => {
          await held;
          await route.continue();
        });
      },
      FULL_HD,
      WANTS_CAT,
    );
    const logo = tv.locator(".tv-browse-logo .logo");
    const pictures = logo.locator("img");
    await expect(pictures).toHaveCount(2);
    const before = await rect(logo);
    expect(before.width, "the wordmark has a size with no picture yet").toBeGreaterThan(100);
    expect(before.height).toBeGreaterThan(40);

    release();
    await expect.poll(() => pictures.evaluateAll((all) => all.every((one) => one instanceof HTMLImageElement && one.complete && one.naturalWidth > 0))).toBe(true);
    expect(await rect(logo), "the same box once they have").toEqual(before);
    expect(await rect(pictures.nth(1)), "the one with the ears is exactly over the plain one").toEqual(await rect(pictures.nth(0)));
    // (the wordmark is one image to a screen reader, and these are its parts)
    expect(await pictures.evaluateAll((all) => all.map((one) => [one.getAttribute("alt"), one.getAttribute("aria-hidden")]))).toEqual([["", "true"], ["", "true"]]);
  } finally {
    release();
  }
});

test("the cat's switch gives the wordmark its ears at once, on the page it is on, and takes them away again", async ({ browser }) => {
  const tv = await openLibrary(browser, hostWith(true), FULL_HD);
  await openTvSettings(tv);
  await tv.getByTestId("tv-cat-open").click();
  const logo = tv.getByTestId("tv-cat-settings").locator(".logo");
  await expect(logo).toHaveAttribute("data-cat", "off");
  await tv.getByTestId("tv-cat-switch").click();
  await expect(logo).toHaveAttribute("data-cat", "on");
  await expect(logo.locator(".logo-ears")).toHaveCSS("opacity", "1");
  await tv.getByTestId("tv-cat-switch").click();
  await expect(logo).toHaveAttribute("data-cat", "off");
  await expect(logo.locator(".logo-ears")).toHaveCSS("opacity", "0");
});

test("the ears fade in over a moment, and are there at once for a screen set to less motion", async ({ browser }) => {
  const fade = async (reducedMotion: "no-preference" | "reduce") => {
    const tv = await openDevice(browser, { viewport: FULL_HD, reducedMotion }, WANTS_CAT, hostWith(true));
    await tv.goto("/tv");
    const ears = tv.locator(".tv-browse-logo .logo-ears");
    await expect(ears).toBeAttached();
    return ears.evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration)); // (seconds)
  };
  expect(await fade("no-preference")).toBeCloseTo(0.2, 2);
  expect(await fade("reduce")).toBeLessThan(0.001); // (the TV's pages set every transition to a hundredth of a millisecond for this, and the logo's own rule is none)
});

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

test("a server without accounts still has the corner button, as Profile, and Settings behind it, and nothing there to sign in to", async ({ browser }) => {
  const tv = await openLibrary(
    browser,
    async (context) => {
      await withLibrary(library)(context);
      await context.route("**/api/me", (route) => route.fulfill({ status: 404, body: "not found" })); // (what a server without accounts answers)
    },
    HD,
  );
  const chip = tv.getByTestId("tv-account-chip");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText(en["tv.profile"]);
  await chip.click();
  await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "profile");
  await expect(tv.getByTestId("tv-profile-signin")).toHaveCount(0);
  await expect(tv.getByTestId("tv-profile-settings")).toBeVisible();
  await tv.getByTestId("tv-profile-settings").click();
  await expect(tv.getByTestId("tv-account")).toBeVisible();
  await expect(tv.getByTestId("tv-sign-in")).toHaveCount(0);
  await expect(tv.getByTestId("tv-lang-en")).toBeVisible(); // (what is the device's own is all there: the language, the colour, what playback does)
  await expect(tv.getByTestId("tv-autoplay")).toBeVisible();
});
