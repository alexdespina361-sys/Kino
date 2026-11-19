import { expect, type Browser, type Page } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { ratingKey } from "../src/shared";
import { FIRST_VISIT, guestStorage, openDevice, openLibrary, openPairedPhone, openProfilePlace, openTv, PAGE_LEFT_ALONE_MS, PHONE, playFirst, pressMenuLine, PRESS_EXPIRES_MS, RawPhone, readPairingCode, strictBrowser, test, tvRoot, tvTime, withLibrary } from "./helpers";

const films = Array.from({ length: 9 }, (_, i) => ({ id: `f${i}`, title: `Film number ${i + 1}`, year: 1990 + i, url: `/fixtures/sample.mp4?n=${i}` }));
const library = { updatedAt: Date.now(), rows: [{ id: "r1", title: "Classics", source: "Test Source", items: films }] };
const search = (query: string) => films.filter((film) => film.title.toLowerCase().includes(query.toLowerCase()));
const withFilms = withLibrary(library, search);

const sidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const columns = (page: Page) => page.locator(".tv-results .tv-tile").evaluateAll((tiles) => new Set(tiles.map((tile) => Math.round(tile.getBoundingClientRect().left))).size);
async function searchFilms(page: Page) {
  await page.getByTestId("rail-search").tap();
  await page.getByTestId("tv-query").fill("film");
  await expect(page.getByTestId("tv-browse-tile")).toHaveCount(films.length);
}

test.describe("a phone used as the screen", () => {
  test("the connect page offers it, the library fits the width, and a finger does the rest", async ({ browser }) => {
    const phone = await openDevice(browser, PHONE, {}, withFilms);
    await phone.goto("/");
    await phone.getByTestId("switch-to-tv").tap();
    await expect(phone.locator('.tv-tile[title="Film number 1"]')).toBeVisible();
    expect(await sidewaysScroll(phone)).toBeLessThanOrEqual(0);
    await expect(phone.getByTestId("tv-account-chip")).toBeInViewport();
    await expect(phone.getByTestId("fullscreen-toggle")).toBeInViewport();

    await searchFilms(phone);
    await expect(phone.getByTestId("tv-query")).toHaveJSProperty("tagName", "INPUT");
    const cross = await phone.getByTestId("tv-query-clear").boundingBox();
    expect(Math.min(cross!.width, cross!.height)).toBeGreaterThanOrEqual(44);
    await phone.getByTestId("tv-query-clear").tap();
    await expect(phone.getByTestId("tv-query")).toHaveValue("");
    await expect(phone.getByTestId("tv-query")).toBeFocused();
    await expect(phone.getByTestId("tv-query-clear")).toHaveCount(0);
    await searchFilms(phone);
    expect(await columns(phone)).toBe(3);
    expect(await sidewaysScroll(phone)).toBeLessThanOrEqual(0);

    await phone.getByTestId("tv-browse-tile").first().tap();
    await expect(phone.getByTestId("tv-detail")).toBeVisible();
    expect(await sidewaysScroll(phone)).toBeLessThanOrEqual(0);
    await phone.getByTestId("tv-detail-play").tap();
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    await expect(tvRoot(phone)).toHaveAttribute("data-hud", "hidden", { timeout: 10_000 });
    await phone.touchscreen.tap(195, 420);
    await expect(tvRoot(phone)).toHaveAttribute("data-hud", "visible");
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing");
    await phone.touchscreen.tap(195, 300);
    await expect(tvRoot(phone)).toHaveAttribute("data-hud", "hidden");
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing");
    await phone.touchscreen.tap(195, 300);
    await expect(tvRoot(phone)).toHaveAttribute("data-hud", "visible");
    await phone.getByTestId("tv-center-btn").tap();
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "paused");
    await phone.getByTestId("tv-center-btn").tap();
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing");
  });

  test("the name at the top is the way home, from whatever page the phone is on", async ({ browser }) => {
    const phone = await openDevice(browser, PHONE, {}, withFilms);
    await phone.goto("/");
    await phone.getByTestId("switch-to-tv").tap();
    await expect(phone.locator('.tv-tile[title="Film number 1"]')).toBeVisible();
    await phone.getByTestId("rail-search").tap();
    await expect(phone.getByTestId("tv-search")).toBeVisible();
    await phone.getByTestId("tv-logo-home").tap();
    await expect(phone.getByTestId("tv-search")).toHaveCount(0);
    await expect(phone.locator('.tv-tile[title="Film number 1"]')).toBeVisible();
    await expect(phone.getByTestId("tv-browse")).toHaveAttribute("data-view", "home");
  });

  test("the pages that only a remote's arrow keys could leave have a Back button for a finger", async ({ browser }) => {
    const phone = await openDevice(browser, PHONE, {}, withFilms);
    await phone.goto("/tv");
    await phone.getByTestId("tv-account-chip").tap();
    await phone.getByTestId("tv-profile-settings").tap();
    await expect(phone.getByTestId("tv-account")).toBeVisible();
    await phone.getByTestId("tv-account-back").tap();
    await expect(phone.getByTestId("tv-browse")).toBeVisible();
  });

  test("what is part way through has Resume and Remove on its page, on the screen, one under the other or side by side, down to the narrowest phone", async ({ browser }) => {
    const resume = guestStorage({ progress: [{ key: "url:https://films.example/night-train", at: Date.now() - 60_000, title: "Night Train", url: "https://films.example/night-train", position: 1500, duration: 6000 }] });
    for (const language of ["en", "it"]) {
      for (const width of [430, 360, 320]) {
        const phone = await openDevice(browser, { ...PHONE, viewport: { width, height: 760 } }, { ...resume, "kino.lang": language }, withFilms);
        await phone.goto("/tv");
        await phone.locator('.tv-tile[title="Night Train"]').first().tap();
        await expect(phone.getByTestId("tv-detail")).toBeVisible();
        for (const action of ["play", "remove"]) await expect(phone.getByTestId(`tv-detail-${action}`), `${action} at ${width} wide in ${language}`).toBeInViewport({ ratio: 1 });
        expect(await sidewaysScroll(phone)).toBeLessThanOrEqual(0);
        await phone.context().close();
      }
    }
  });

  test("a finger gets the corner button on a title: one tap keeps it in the list and another takes it out, without opening its page; a tap on the menu's icons still goes there", async ({ browser }) => {
    const phone = await openDevice(browser, PHONE, {}, withFilms);
    await phone.goto("/tv");
    const tile = phone.getByRole("region", { name: "Classics" }).locator('[data-testid="tv-browse-tile"][title="Film number 2"]');
    await expect(tile).toBeVisible();
    const corner = tile.getByTestId("tv-tile-corner");
    await expect(corner).toBeVisible();
    await expect(corner).toHaveAttribute("data-corner", "add");
    const box = (await corner.boundingBox())!;
    expect(Math.min(box.width, box.height), "big enough to see and hit").toBeGreaterThanOrEqual(28);
    await corner.tap();
    await expect(corner).toHaveAttribute("data-corner", "kept");
    await expect(phone.getByTestId("tv-detail")).toHaveCount(0);
    await corner.tap();
    await expect(corner).toHaveAttribute("data-corner", "add");
    await expect(phone.getByTestId("tv-detail")).toHaveCount(0);

    await phone.getByTestId("rail-search").tap();
    await expect(phone.getByTestId("tv-browse")).toHaveAttribute("data-view", "search");
    await expect(phone.getByTestId("tv-rail")).toHaveAttribute("data-open", "false");
  });

  test("the menu's phone entry makes a phone the remote, where a TV's would show the code to type on one", async ({ browser }) => {
    const phone = await openDevice(browser, PHONE, {}, withFilms);
    await phone.goto("/tv");
    await phone.getByTestId("tv-account-chip").tap();
    const entry = phone.getByTestId("rail-connect");
    await expect(entry).toHaveText(en["tv.useRemote"]);
    await entry.tap();

    await expect(phone.getByTestId("code-input")).toBeVisible();
    await expect(phone.getByTestId("tv-browse")).toHaveCount(0);
    expect(await phone.evaluate(() => localStorage.getItem("kino.role"))).toBe("remote");
  });

  test("a tablet is somebody's screen, so its menu still shows the code to type on a phone, with a Back button for a finger", async ({ browser }) => {
    const tablet = await openDevice(browser, { viewport: { width: 768, height: 1024 }, hasTouch: true }, {}, withFilms);
    await tablet.goto("/tv");
    const entry = tablet.getByTestId("rail-connect");
    await expect(entry).toHaveText(en["tv.connectPhone"]);
    await entry.tap();
    await expect(tablet.getByTestId("pairing-code")).toBeVisible();
    await tablet.getByTestId("tv-back-to-library").tap();
    await expect(tablet.getByTestId("tv-browse")).toBeVisible();
  });

  test("a tablet gets as many titles across as fit, and a phone held sideways keeps everything on screen", async ({ browser }) => {
    const tablet = await openDevice(browser, { viewport: { width: 768, height: 1024 }, hasTouch: true }, {}, withFilms);
    await tablet.goto("/tv");
    await expect(tablet.getByTestId("tv-hero-title")).toBeVisible();
    await searchFilms(tablet);
    expect(await columns(tablet)).toBe(5);
    expect(await sidewaysScroll(tablet)).toBeLessThanOrEqual(0);

    const sideways = await openDevice(browser, { viewport: { width: 844, height: 390 }, hasTouch: true }, {}, withFilms);
    await sideways.goto("/tv");
    await expect(sideways.getByTestId("tv-hero-title")).toBeVisible();
    const [heroBottom, firstRowBottom] = await sideways.evaluate(() => [document.querySelector(".tv-hero")!.getBoundingClientRect().bottom, document.querySelector(".tv-row")!.getBoundingClientRect().bottom]);
    expect(heroBottom).toBeLessThan(390 * 0.5);
    expect(firstRowBottom).toBeLessThanOrEqual(390);
    expect(await sidewaysScroll(sideways)).toBeLessThanOrEqual(0);
  });

  test("an upright phone's filters fit its width in every language: the sections, search and rating kinds as one bar, list names on more lines, the scores one button that opens their list", async ({ browser }) => {
    test.setTimeout(180_000);
    const at = Date.now();
    const kinds = [{ kind: "movie" }, { kind: "series" }, { kind: "movie", section: "cartoon" }, { kind: "series", section: "anime" }];
    const ratings = films.map((film, n) => ({ key: ratingKey(film.url), at, title: film.title, url: film.url, year: film.year, ...kinds[n % 4], score: n + 1, ratedAt: at - n }));
    const listNames = ["Weekend with the family", "Watch later together!!!", "Rainy Sunday classics", "Kids", "Documentaries"].map((name, i) => ({ key: `l${i}`, at, name }));
    const fits = (page: Page, selector: string) =>
      page.locator(selector).evaluate((bar) => {
        const lost = [...bar.querySelectorAll<HTMLElement>(".tv-choice")].filter((chip) => {
          const box = chip.getBoundingClientRect();
          return box.left < -0.5 || box.right > innerWidth + 0.5 || chip.scrollWidth > chip.clientWidth + 1;
        });
        return { scrolls: bar.scrollWidth - bar.clientWidth, lost: lost.map((chip) => chip.textContent), lines: new Set([...bar.querySelectorAll<HTMLElement>(".tv-choice")].map((chip) => Math.round(chip.getBoundingClientRect().top))).size };
      });
    for (const lang of ["en", "ro", "it"] as const)
      for (const width of [320, 360, 390]) {
        const where = `${lang} at ${width}`;
        const phone = await openDevice(browser, { viewport: { width, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, { ...guestStorage({ ratings, listNames }), "kino.lang": lang, "kino.role": "tv" }, withFilms);
        await phone.goto("/tv");
        await expect(phone.getByTestId("section-anime")).toBeVisible();
        expect(await fits(phone, ".tv-sections"), where).toEqual({ scrolls: 0, lost: [], lines: 1 });
        await phone.getByTestId("rail-search").tap();
        await phone.getByTestId("tv-query").fill("film");
        expect(await fits(phone, ".tv-search-main .tv-filters"), where).toEqual({ scrolls: 0, lost: [], lines: 1 });
        await phone.getByTestId("rail-list").tap();
        await expect(phone.locator(".tv-filters-wrap .tv-choice")).not.toHaveCount(0);
        expect(await fits(phone, ".tv-filters-wrap"), where).toMatchObject({ scrolls: 0, lost: [] });
        await openProfilePlace(phone, "ratings");
        await expect(phone.getByTestId("rating-filters")).toBeVisible();
        expect(await fits(phone, '.tv-rating-filters .tv-filters-kind'), where).toEqual({ scrolls: 0, lost: [], lines: 1 });
        await expect(phone.locator(".tv-rating-filters .tv-filters-wrap")).toHaveCount(0);
        const pick = phone.getByTestId("rating-pick");
        await pick.tap();
        const menu = phone.getByTestId("rating-pick-menu");
        await expect(menu.getByRole("option")).toHaveCount(films.length + 1);
        expect(await menu.evaluate((box) => { const at = box.getBoundingClientRect(); return { inside: at.left >= 0 && at.right <= innerWidth && at.bottom <= innerHeight, scrolls: box.scrollHeight > box.clientHeight }; }), where).toEqual({ inside: true, scrolls: false });
        expect(await sidewaysScroll(phone), where).toBeLessThanOrEqual(0);
        if (lang === "en" && width === 320) {
          await phone.getByTestId("rating-pick-3").tap();
          await expect(menu).toBeHidden();
          await expect(pick).toHaveAccessibleName("Score: Rated 3");
          await expect(phone.locator('[data-zone="grid"]')).toHaveCount(1);
          await pick.tap();
          await expect(phone.getByTestId("rating-pick-3")).toHaveAttribute("aria-selected", "true");
          await phone.keyboard.press("Escape");
          await expect(menu).toBeHidden();
          await expect(phone.getByTestId("rating-filters")).toBeVisible();
          await pick.focus();
          await phone.keyboard.press("Enter");
          await expect(menu).toBeVisible();
          await phone.keyboard.press("ArrowDown");
          await expect(phone.getByTestId("rating-pick-any")).toBeFocused();
          await phone.keyboard.press("ArrowDown");
          await expect(phone.getByTestId("rating-pick-9")).toBeFocused();
          await phone.keyboard.press("Escape");
          await expect(menu).toBeHidden();
          await expect(pick).toBeFocused();
          await pick.tap();
          await expect(menu).toBeVisible();
          await phone.goBack();
          await expect(menu).toBeHidden();
          await expect(phone.getByTestId("rating-filters")).toBeVisible();
          await pick.tap();
          await expect(menu).toBeVisible();
          await phone.setViewportSize({ width: 780, height: 353 });
          await expect(menu).toBeHidden();
          await phone.setViewportSize({ width, height: 760 });
          await expect(menu).toBeHidden();
          await pick.tap();
          await phone.getByTestId("rating-filter-movie").tap();
          await expect(menu).toBeHidden();
          await pick.tap();
          await phone.getByTestId("rating-pick-any").tap();
          await expect(pick).toHaveAccessibleName("Score: Any score");
        }
        await phone.context().close();
      }
  });

  test("a phone on its side has the four places of an upright phone down the left, each a thumb's size with room between them, and its sections over the titles", async ({ browser }) => {
    for (const size of [
      { width: 780, height: 353 },
      { width: 844, height: 390 },
      { width: 667, height: 375 },
    ]) {
      const long = { id: "long", title: "A title far too long for one line of a phone held sideways, as some are", year: 2020, url: "/fixtures/sample.mp4?long=1" };
      const withLong = withLibrary({ updatedAt: Date.now(), rows: [{ id: "r1", title: "Classics", source: "Test Source", items: [long, ...films] }] }, search);
      const phone = await openDevice(browser, { viewport: size, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }, {}, withLong);
      await phone.goto("/tv");
      await expect(phone.getByTestId("tv-hero-title")).toBeVisible();
      const where = `at ${size.width} by ${size.height}`;
      const cut = await phone.evaluate(() => {
        const hero = document.querySelector(".tv-hero")!.getBoundingClientRect();
        return [...document.querySelectorAll<HTMLElement>(".tv-hero-text > *")].filter((part) => part.offsetParent !== null && part.getBoundingClientRect().top < hero.top - 0.5).map((part) => part.className);
      });
      expect(cut, where).toEqual([]);
      const lines = await phone.locator(".tv-rail .tv-rail-item").evaluateAll((items) => items.map((item) => ({ id: item.getAttribute("data-testid"), ...item.getBoundingClientRect().toJSON() })));
      expect(lines.map((line) => line.id), where).toEqual(["rail-home", "rail-search", "rail-categories", "rail-list"]);
      for (const line of lines) {
        expect(line.height, `${line.id} ${where}`).toBeGreaterThanOrEqual(48);
        expect(line.width, `${line.id} ${where}`).toBeGreaterThanOrEqual(48);
        expect(line.bottom, `${line.id} ${where}`).toBeLessThanOrEqual(size.height);
      }
      for (let i = 1; i < lines.length; i++) expect(lines[i]!.top - lines[i - 1]!.bottom, where).toBeGreaterThanOrEqual(8);
      const menuRight = await phone.getByTestId("tv-rail").evaluate((rail) => rail.getBoundingClientRect().right);
      const icons = await phone.locator(".tv-rail .tv-rail-item svg").evaluateAll((all) => all.map((icon) => icon.getBoundingClientRect()).map((box) => box.left + box.width / 2));
      for (const middle of icons) expect(Math.abs(middle - menuRight / 2), `the icons sit in the middle of the menu ${where}`).toBeLessThanOrEqual(4);
      for (const kind of ["home", "movies", "series", "cartoons", "anime"]) {
        const box = (await phone.getByTestId(`section-${kind}`).boundingBox())!;
        expect(box.x, `section-${kind} ${where}`).toBeGreaterThanOrEqual(menuRight);
        expect(box.height, `section-${kind} ${where}`).toBeGreaterThanOrEqual(40);
      }
      for (const id of ["tv-hero-play", "tv-account-chip", "fullscreen-toggle"]) {
        const reach = await phone.getByTestId(id).evaluate((button) => {
          const box = button.getBoundingClientRect();
          const at = (y: number) => document.elementFromPoint(box.left + box.width / 2, y)?.closest("[data-testid]") === button;
          return { above: at(box.top - 6), below: at(box.bottom + 6) };
        });
        expect(reach, `${id} ${where}`).toEqual({ above: true, below: id !== "tv-hero-play" ? true : reach.below });
      }
      await phone.locator(".tv-row .tv-tile").first().tap();
      for (const id of ["tv-detail-play", "tv-detail-list"]) expect((await phone.getByTestId(id).boundingBox())!.height, `${id} ${where}`).toBeGreaterThanOrEqual(44);
      await phone.getByTestId("tv-detail-close").tap();
      await phone.getByTestId("section-movies").tap();
      await expect(phone.getByTestId("section-movies")).toHaveAttribute("aria-checked", "true");
      await expect(phone.getByTestId("rail-home")).toHaveAttribute("aria-current", "page");
      const firstRowBottom = await phone.evaluate(() => document.querySelector(".tv-row")?.getBoundingClientRect().bottom ?? 0);
      expect(firstRowBottom, where).toBeLessThanOrEqual(size.height);
      expect(await sidewaysScroll(phone)).toBeLessThanOrEqual(0);
      await phone.getByTestId("rail-search").tap();
      await phone.getByTestId("tv-query").fill("film");
      const cross = (await phone.getByTestId("tv-query-clear").boundingBox())!;
      expect(Math.min(cross.width, cross.height), where).toBeGreaterThanOrEqual(44);
      await phone.getByTestId("tv-query-clear").tap();
      await expect(phone.getByTestId("tv-query")).toHaveValue("");
      await pressMenuLine(phone, "rail-party", "tap");
      await expect(phone.getByTestId("tv-party-start")).toBeVisible();
      await phone.context().close();
    }

    const tv = await openDevice(browser, { viewport: { width: 780, height: 353 } }, {}, withFilms);
    await tv.goto("/tv");
    await expect(tv.getByTestId("tv-hero-title")).toBeVisible();
    await expect(tv.getByTestId("rail-movies")).toHaveCount(1);
    await expect(tv.getByTestId("rail-party")).toHaveCount(1);
    await expect(tv.getByTestId("section-movies")).toHaveCount(0);
  });
});

test.describe("a phone that watches a party along", () => {
  const isFullScreen = (page: Page) => page.evaluate(() => document.fullscreenElement !== null);

  async function hosting(browser: Browser) {
    const host = await openLibrary(browser, withFilms);
    await host.getByTestId("rail-party").click();
    await host.getByTestId("tv-party-start").click();
    const code = (await host.getByTestId("tv-party-code").innerText()).replace(/\s/g, "");
    return { host, code };
  }
  async function join(phone: Page, code: string, { open = true } = {}) {
    if (open) await phone.goto("/tv");
    await expect(phone.getByTestId("tv-browse")).toBeVisible();
    await pressMenuLine(phone, "rail-party", "tap");
    await phone.getByTestId("tv-party-join").tap();
    for (const digit of code) await phone.getByTestId(`pad-${digit}`).tap();
    await expect(phone.getByTestId("tv-following")).toBeVisible();
  }
  async function hostPlays(host: Page) {
    await expect(host.getByTestId("tv-party-member")).toHaveCount(2);
    await host.getByTestId("tv-back-to-library").click();
    await playFirst(host);
    await expect(tvRoot(host)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
  }

  for (const shape of [
    { how: "upright", width: 390, height: 844 },
    { how: "sideways", width: 844, height: 390 },
  ]) {
    test(`held ${shape.how}: the film plays, and the bar's buttons are all on the screen`, async ({ browser }) => {
      const { host, code } = await hosting(browser);
      const phone = await openDevice(browser, { viewport: { width: shape.width, height: shape.height }, hasTouch: true });
      await join(phone, code);
      await expect(phone.getByTestId("tv-fullscreen")).toBeInViewport();
      await hostPlays(host);
      await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
      await expect(phone.locator("video")).toBeVisible();
      const bar = await phone.evaluate(() => {
        const elements = [...document.querySelectorAll(".hud-bottom, .hud-bottom button")];
        const outside = elements.filter((element) => {
          const box = element.getBoundingClientRect();
          return box.left < 0 || box.top < 0 || box.right > innerWidth || box.bottom > innerHeight;
        });
        return { outside: outside.length, all: elements.length };
      });
      expect(bar.all).toBeGreaterThan(3);
      expect(bar.outside).toBe(0);
      expect(await sidewaysScroll(phone)).toBeLessThanOrEqual(0);
    });
  }

  test("a party's code typed on the phone's first screen, where a TV's code goes, makes the phone a screen of the party", async ({ browser }) => {
    const { host, code } = await hosting(browser);
    const phone = await openDevice(browser, PHONE);
    await phone.goto("/");
    await phone.getByTestId("code-input").fill(code);
    await expect(phone.getByTestId("unlock")).toBeVisible();
    expect(new URL(phone.url()).searchParams.get("party")).toBe(code);
    await expect(phone.getByTestId("error")).toHaveCount(0);
    await phone.getByTestId("unlock").tap();
    await expect(phone.getByTestId("tv-following")).toBeVisible();
    await expect(host.getByTestId("tv-party-member")).toHaveCount(2);
  });

  test("the phone's page is not taken full screen by itself (no welcome waits for a tap), and a button on each screen brings it there and leaves it", async ({ browser }) => {
    const { host, code } = await hosting(browser);
    const phone = await openDevice(browser, { ...PHONE, storageState: FIRST_VISIT });
    await phone.goto("/tv");
    await expect(phone.getByTestId("tv-browse")).toBeVisible();
    await expect(phone.getByTestId("welcome-enter")).toHaveCount(0);
    await join(phone, code, { open: false });
    const waiting = phone.getByTestId("tv-fullscreen");
    await expect(waiting).toHaveText("Full screen");
    expect(await isFullScreen(phone)).toBe(false);
    await waiting.tap();
    await expect(waiting).toHaveText("Exit full screen");
    await expect.poll(() => isFullScreen(phone)).toBe(true);
    await waiting.tap();
    await expect(waiting).toHaveText("Full screen");
    expect(await isFullScreen(phone)).toBe(false);
    await waiting.tap();
    await expect(waiting).toHaveText("Exit full screen");

    await hostPlays(host);
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    await phone.touchscreen.tap(195, 420);
    const onBar = phone.getByTestId("tv-fullscreen-btn");
    await expect(onBar).toHaveAttribute("aria-label", "Exit full screen");
    await onBar.tap();
    await expect(onBar).toHaveAttribute("aria-label", en["hud.fullscreen"]);
    expect(await isFullScreen(phone)).toBe(false);
  });

  test("while the picture fills in, the phone shows that it is waiting", async ({ browser }) => {
    const { host, code } = await hosting(browser);
    const phone = await openDevice(browser, PHONE);
    await phone.route("**/fixtures/sample.mp4*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.continue();
    });
    await join(phone, code);
    await hostPlays(host);
    await expect(phone.getByTestId("tv-buffering")).toBeVisible();
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    await expect(phone.getByTestId("tv-buffering")).toHaveCount(0);
  });

  test("a guest that follows the host to places it has downloaded does not flash the waiting wheel", async ({ browser }) => {
    test.setTimeout(60_000);
    const { host, code } = await hosting(browser);
    const phone = await openDevice(browser, PHONE);
    await join(phone, code);
    await hostPlays(host);
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    const downloaded = (page: Page) =>
      page.evaluate(() => {
        const { buffered } = document.querySelector("video")!;
        return buffered.length ? buffered.end(buffered.length - 1) : 0;
      });
    await expect.poll(() => downloaded(phone), { timeout: 15_000 }).toBeGreaterThan(25);

    await phone.evaluate(() => {
      const seen = { wheels: 0 };
      Object.assign(window, { seen });
      new MutationObserver((records) => {
        for (const added of records.flatMap((record) => [...record.addedNodes])) {
          if (added instanceof Element && (added.matches('[data-testid="tv-buffering"]') || added.querySelector('[data-testid="tv-buffering"]'))) seen.wheels += 1;
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    const place = (page: Page) => page.evaluate(() => document.querySelector("video")!.currentTime);
    for (const to of [20, 8, 22]) {
      await host.evaluate((time) => void (document.querySelector("video")!.currentTime = time), to);
      await expect.poll(async () => Math.abs((await place(phone)) - (await place(host))), { timeout: 10_000 }).toBeLessThan(1.5);
    }
    expect(await phone.evaluate(() => (window as unknown as { seen: { wheels: number } }).seen.wheels)).toBe(0);
  });

  test("a video it cannot play is said on its screen, not left as a black one", async ({ browser, baseURL }) => {
    const host = await openTv(browser);
    const remote = await RawPhone.connect(baseURL!, await readPairingCode(host));
    await expect(host.getByTestId("tv-paired")).toBeVisible();
    await host.getByTestId("tv-back-to-library").click();
    await host.getByTestId("rail-party").click();
    await host.getByTestId("tv-party-start").click();
    const code = (await host.getByTestId("tv-party-code").innerText()).replace(/\s/g, "");
    const phone = await openDevice(browser, PHONE);
    await join(phone, code);

    remote.cmd({ type: "LOAD", media: { title: "Broken", stream: { url: "/fixtures/missing.mp4", type: "mp4" } } });
    await expect(phone.getByTestId("tv-error")).toContainText("can't be played");
    await expect(tvRoot(phone)).toHaveAttribute("data-error", "SOURCE_NOT_DIRECTLY_PLAYABLE");
    remote.close();
  });

  test("a browser that will not start the video by itself shows a button for it, and one tap starts it in step with the host", async ({ browser, baseURL }) => {
    const { host, code } = await hosting(browser);
    const strict = await strictBrowser();
    try {
      const phone = await (await strict.newContext({ ...PHONE, baseURL })).newPage();
      await join(phone, code);
      await expect(host.getByTestId("tv-party-member")).toHaveCount(2);
      await phone.waitForTimeout(PRESS_EXPIRES_MS);
      await hostPlays(host);
      await phone.waitForTimeout(PAGE_LEFT_ALONE_MS);
      await expect(tvRoot(phone)).toHaveAttribute("data-error", "PLAYBACK_BLOCKED", { timeout: 15_000 });
      await expect(phone.getByTestId("tv-tap-play")).toBeVisible();
      await expect(phone.getByTestId("tv-error")).toHaveCount(0);

      await phone.getByTestId("tv-tap-play").tap();
      await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing");
      await expect(phone.getByTestId("tv-tap-play")).toHaveCount(0);
      await expect.poll(async () => Math.abs((await tvTime(phone)) - (await tvTime(host))), { timeout: 10_000 }).toBeLessThan(2.5);
    } finally {
      await strict.close();
    }
  });

  test("a screen nobody has pressed waits for OK before it plays what the phone sent, and OK starts it", async ({ browser, baseURL }) => {
    const strict = await strictBrowser();
    try {
      const tv = await (await strict.newContext({ viewport: { width: 1280, height: 720 }, baseURL })).newPage();
      await tv.goto("/tv");
      await expect(tv.getByTestId("tv-browse")).toBeVisible();
      await tv.getByTestId("rail-connect").click();
      const remote = await RawPhone.connect(baseURL!, await readPairingCode(tv));
      await expect(tv.getByTestId("tv-paired")).toBeVisible();
      await tv.waitForTimeout(PRESS_EXPIRES_MS);

      remote.cmd({ type: "LOAD", media: { title: "Sample", stream: { url: "/fixtures/sample.mp4", type: "mp4" } } });
      remote.cmd({ type: "PLAY" });
      await tv.waitForTimeout(PAGE_LEFT_ALONE_MS);
      await expect(tvRoot(tv)).toHaveAttribute("data-error", "PLAYBACK_BLOCKED");
      await expect(tv.getByTestId("tv-tap-play")).toBeVisible();
      await tv.keyboard.press("Enter");
      await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
      await expect(tv.getByTestId("tv-tap-play")).toHaveCount(0);
      remote.close();
    } finally {
      await strict.close();
    }
  });
});

test("the page can be added to a phone's home screen, and opens there as an app with no browser bar", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator("link[rel=manifest]")).toHaveAttribute("href", "/manifest.webmanifest");
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as { name: string; display: string; start_url: string; icons: Array<{ src: string; sizes: string }> };
  expect(manifest).toMatchObject({ name: "Kino", display: "standalone", start_url: "/" });
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  const touchIcon = await page.locator("link[rel=apple-touch-icon]").getAttribute("href");
  for (const src of [...manifest.icons.map((icon) => icon.src), touchIcon!]) {
    const image = await request.get(src);
    expect(image.ok(), src).toBe(true);
    expect(image.headers()["content-type"], src).toBe("image/png");
  }
});

test.describe("a phone that has a TV scans another one", () => {
  async function scanned(browser: Parameters<typeof openTv>[0]) {
    const first = await openTv(browser);
    const phone = await openPairedPhone(browser, first);
    const second = await openTv(browser);
    await phone.goto(`/?code=${await readPairingCode(second)}`);
    await expect(phone.getByTestId("other-tv-sheet")).toBeVisible();
    return { first, phone, second };
  }

  test("it asks first, and the other TV can join the watch party", async ({ browser }) => {
    const { first, phone, second } = await scanned(browser);
    await expect(phone.getByTestId("other-tv-sheet")).toContainText(await phone.getByTestId("tv-name").innerText());
    await phone.getByTestId("other-add").click();
    await expect(phone.getByTestId("party-tv")).toHaveCount(1);
    await expect(second.getByTestId("tv-following")).toBeVisible();
    await expect(first.getByTestId("tv-paired")).toBeVisible();
  });

  test("or the phone can move over to it, and the first TV stays paired and on its list", async ({ browser }) => {
    const { first, phone, second } = await scanned(browser);
    await expect(phone.getByTestId("other-tv-sheet")).toContainText("stays on your list");
    await phone.getByTestId("other-switch").click();
    await expect(second.getByTestId("tv-paired")).toBeVisible();
    await expect(first.getByTestId("tv-paired")).toBeVisible();
    await expect(first.getByTestId("pairing-code")).toHaveCount(0);
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await phone.getByTestId("menu").click();
    await expect(phone.getByTestId("tvs-open")).toHaveText("My TVs · 2");
  });

  test("moving over leaves the watch party the first TV leads running", async ({ browser }) => {
    const { phone, second } = await scanned(browser);
    await phone.getByTestId("other-add").click();
    await expect(phone.getByTestId("party-tv")).toHaveCount(1);
    await expect(second.getByTestId("tv-following")).toBeVisible();

    const third = await openTv(browser);
    await phone.goto(`/?code=${await readPairingCode(third)}`);
    await expect(phone.getByTestId("other-tv-sheet")).toBeVisible();
    await phone.getByTestId("other-switch").click();
    await expect(third.getByTestId("tv-paired")).toBeVisible();
    await expect(second.getByTestId("tv-following")).toBeVisible();
    await expect(phone.getByTestId("party-count")).toHaveCount(0);
  });

  test("or nothing happens at all", async ({ browser }) => {
    const { first, phone, second } = await scanned(browser);
    await phone.getByTestId("other-cancel").click();
    await expect(phone.getByTestId("other-tv-sheet")).toHaveCount(0);
    await expect(phone.getByTestId("party-count")).toHaveCount(0);
    await expect(first.getByTestId("tv-paired")).toBeVisible();
    await expect(second.getByTestId("pairing-code")).toBeVisible();
  });

  test("when the TV it had is off there is nothing to ask: it moves over to the one it scanned at once", async ({ browser }) => {
    const first = await openTv(browser);
    const phone = await openPairedPhone(browser, first);
    const second = await openTv(browser);
    await first.close();
    await expect(phone.getByTestId("tv-online")).toHaveText("TV disconnected");

    await phone.goto(`/?code=${await readPairingCode(second)}`);
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await expect(second.getByTestId("tv-paired")).toBeVisible();
    await expect(phone.getByTestId("other-tv-sheet")).toHaveCount(0);
    await expect(phone.getByTestId("pair-notice")).toHaveCount(0);
  });

  test("scanning the QR code of the TV it already has changes nothing", async ({ browser }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.getByTestId("menu").click();
    await phone.getByTestId("control-open").click();
    const code = (await phone.getByTestId("control-code").innerText()).replace(/\s/g, "");
    await phone.goto(`/?control=${code}`);
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await expect(phone.getByTestId("other-tv-sheet")).toHaveCount(0);
  });

  test("a TV that has a phone of its own can only be moved over to: there is no party to add it to", async ({ browser }) => {
    const first = await openTv(browser);
    const phone = await openPairedPhone(browser, first);
    const second = await openTv(browser);
    const other = await openPairedPhone(browser, second);
    const code = (await second.getByTestId("tv-join-code").innerText()).replace(/\s/g, "");

    await phone.goto(`/?control=${code}`);
    await expect(phone.getByTestId("other-tv-sheet")).toBeVisible();
    await expect(phone.getByTestId("other-add")).toHaveCount(0);
    await expect(phone.getByTestId("other-switch")).toBeVisible();

    await phone.getByTestId("other-switch").click();
    await expect(first.getByTestId("tv-paired")).toBeVisible();
    await expect(second.getByTestId("tv-flash")).toHaveText("A phone is connected.");
    await phone.getByTestId("menu").click();
    await expect(phone.getByTestId("control-card")).toContainText("2 connected");
    await other.close();
  });
});

test.describe("a second phone", () => {
  test("joins from a QR code on the first phone's menu, and can bring another TV into the party", async ({ browser }) => {
    const tv = await openTv(browser);
    const first = await openPairedPhone(browser, tv);
    await first.getByTestId("menu").click();
    const card = first.getByTestId("control-card");
    await expect(card.getByTestId("pairing-qr")).toHaveCount(0);
    await card.getByTestId("control-open").click();
    await expect(card.getByTestId("pairing-qr")).toBeVisible();
    const code = (await card.getByTestId("control-code").innerText()).replace(/\s/g, "");

    const second = await (await browser.newContext(PHONE)).newPage();
    await second.goto(`/?control=${code}`);
    await expect(second.getByTestId("tv-online")).toHaveText("TV connected");
    await expect(card).toContainText("2 connected");

    const guest = await openTv(browser);
    await second.getByTestId("menu").click();
    await second.getByTestId("party-open").click();
    await second.getByTestId("party-code").fill(await readPairingCode(guest));
    await expect(second.getByTestId("party-tv")).toHaveCount(1);
    await expect(guest.getByTestId("tv-following")).toBeVisible();
  });

  test("joins from the QR code on the TV itself, and the TV says so", async ({ browser }) => {
    const tv = await openTv(browser);
    const first = await openPairedPhone(browser, tv);
    const join = tv.getByTestId("tv-join");
    await expect(join).toBeVisible();
    await expect(join.getByTestId("pairing-qr")).toBeVisible();
    const code = (await tv.getByTestId("tv-join-code").innerText()).replace(/\s/g, "");
    expect(code).toMatch(/^\d{6}$/);

    await first.getByTestId("menu").click();
    await first.getByTestId("control-open").click();
    expect((await first.getByTestId("control-code").innerText()).replace(/\s/g, "")).toBe(code);

    const second = await (await browser.newContext(PHONE)).newPage();
    await second.goto(`/?control=${code}`);
    await expect(second.getByTestId("tv-online")).toHaveText("TV connected");
    await expect(tv.getByTestId("tv-flash")).toHaveText("A phone is connected.");
    await expect(join).toBeVisible();
    await expect(first.getByTestId("control-card")).toContainText("2 connected");
  });

  test("a code typed on the phone works as well as the QR code does", async ({ browser }) => {
    const tv = await openTv(browser);
    await openPairedPhone(browser, tv);
    const code = (await tv.getByTestId("tv-join-code").innerText()).replace(/\s/g, "");
    const second = await (await browser.newContext(PHONE)).newPage();
    await second.goto("/");
    await second.getByTestId("code-input").fill(code);
    await expect(second.getByTestId("tv-online")).toHaveText("TV connected");
  });

  test("the TV asks for that code only while the page that shows it is open", async ({ browser }) => {
    const tv = await openLibrary(browser, (context) =>
      context.addInitScript(() => {
        const counted = window as unknown as { asked: number };
        counted.asked = 0;
        const send = WebSocket.prototype.send;
        WebSocket.prototype.send = function (data) {
          if (typeof data === "string" && data.includes("TV_NEW_CODE")) counted.asked += 1;
          return send.call(this, data);
        };
      }),
    );
    const asked = () => tv.evaluate(() => (window as unknown as { asked: number }).asked);
    await tv.getByTestId("rail-connect").click();
    await openPairedPhone(browser, tv);
    await expect(tv.getByTestId("tv-join-code")).toHaveText(/\d/);
    expect(await asked()).toBe(1);

    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await tv.waitForTimeout(600);
    expect(await asked()).toBe(1);

    await tv.getByTestId("rail-connect").click();
    await expect(tv.getByTestId("tv-join-code")).toHaveText(/\d/);
    expect(await asked()).toBe(2);
  });
});
