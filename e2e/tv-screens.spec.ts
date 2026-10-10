import { expect, test, type Page, type Route } from "@playwright/test";
import type { NormalizedMedia } from "../src/shared";
import { openPairedPhone, openTv, RawPhone, readPairingCode, tvRoot } from "./helpers";

/** What the screens look like on a TV: the remote walks them, the buttons match, and everything fits. */

const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!;

test.describe("the start screens", () => {
  test("the first screen is walked with the arrow keys, down to the switch and back up to OK", async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await page.goto("/tv");
    await expect(page.getByTestId("unlock")).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("switch-to-remote")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId("unlock")).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.getByTestId("pairing-code")).toBeVisible();
  });

  test("the switch to the remote can be chosen with OK from the first screen", async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await page.goto("/tv");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("code-input")).toBeVisible(); // the page became a remote
  });

  test("the buttons under a connected TV are the same size, side by side", async ({ browser }) => {
    const tv = await openTv(browser);
    await openPairedPhone(browser, tv);
    await expect(tv.getByTestId("tv-paired")).toBeVisible();

    const browse = await box(tv, "tv-browse-open");
    const disconnect = await box(tv, "tv-disconnect");
    expect(Math.abs(browse.height - disconnect.height)).toBeLessThan(1);
    expect(Math.abs(browse.width - disconnect.width)).toBeLessThan(1);
    expect(Math.abs(browse.y - disconnect.y)).toBeLessThan(1);
    expect(browse.x + browse.width).toBeLessThan(disconnect.x);
  });

  test("the arrow keys reach the library button on the pairing screen, and OK opens the library", async ({ browser }) => {
    const tv = await openTv(browser);
    await tv.context().route("**/api/library", (route) => route.fulfill({ json: { rows: [], updatedAt: 0 } }));
    await expect(tv.getByTestId("pairing-code")).toBeVisible();
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("tv-browse-open")).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("switch-to-remote")).toBeFocused();
    await tv.keyboard.press("ArrowUp");
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
  });
});

test.describe("the controls fit the screen", () => {
  /** The fullest the controls get: episodes before and after, subtitles, a second source. */
  const fullest = (baseURL: string): NormalizedMedia => ({
    title: "The Long Night · S1 E2",
    stream: { url: "/fixtures/sample.mp4", type: "mp4" },
    alternates: [{ label: "Mirror server", stream: { url: "/fixtures/sample.mp4?b=1", type: "mp4" } }],
    subtitles: [
      { id: "en", label: "English", lang: "en", url: "/fixtures/sample.vtt" },
      { id: "nl", label: "Dutch", lang: "nl", url: "/fixtures/sample.vtt" },
    ],
    series: {
      season: 1,
      episode: 2,
      episodes: [
        { season: 1, episode: 1, title: "A Very Long Name For A Pilot Episode Indeed", url: `${baseURL}/fixtures/pages/video.html` },
        { season: 1, episode: 2, title: "The Long Night", url: `${baseURL}/fixtures/pages/none.html` },
        { season: 1, episode: 3, title: "The Even Longer Title Of The Following Episode", url: `${baseURL}/fixtures/pages/hls.html` },
      ],
      next: { season: 1, episode: 3, title: "The Even Longer Title Of The Following Episode", url: `${baseURL}/fixtures/pages/hls.html` },
    },
  });

  const screens = [
    { name: "720p", width: 1280, height: 720 },
    { name: "1080p", width: 1920, height: 1080 },
    { name: "a small window", width: 800, height: 600 },
    { name: "4:3", width: 1024, height: 768 },
    { name: "ultrawide", width: 2560, height: 1080 },
  ];

  for (const screen of screens) {
    test(`every control is on screen at ${screen.name}`, async ({ browser, baseURL }) => {
      const tv = await openTv(browser, { width: screen.width, height: screen.height });
      const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
      phone.cmd({ type: "LOAD", media: fullest(baseURL!) });
      await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
      await expect(tv.getByTestId("tv-next-btn")).toBeVisible();
      await expect(tv.getByTestId("tv-prev-btn")).toBeVisible();
      await expect(tv.getByTestId("tv-episodes-btn")).toBeVisible();
      await expect(tv.getByTestId("tv-audio-sub-btn")).toBeVisible();
      await expect(tv.getByTestId("tv-source-btn")).toBeVisible();

      const rects = await tv.evaluate(() =>
        [...document.querySelectorAll(".hud-controls button")].map((button) => {
          const { left, right, top, bottom } = button.getBoundingClientRect();
          return { left, right, top, bottom };
        }),
      );
      expect(rects.length).toBeGreaterThanOrEqual(10);
      for (const rect of rects) {
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.top).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(screen.width);
        expect(rect.bottom).toBeLessThanOrEqual(screen.height);
      }
      // Nothing crosses another: the long episode names are cut, not spilled over the next button.
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const [a, b] = [rects[i]!, rects[j]!];
          const across = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          expect(across > 1 && down > 1, `buttons ${i} and ${j} overlap`).toBe(false);
        }
      }
      phone.close();
    });
  }

  test("an ordinary film's controls are one row", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: { title: "A film", stream: { url: "/fixtures/sample.mp4", type: "mp4" }, subtitles: [{ id: "en", label: "English", lang: "en", url: "/fixtures/sample.vtt" }] } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    const middles = await tv.evaluate(() =>
      [...document.querySelectorAll(".hud-controls button")].map((button) => {
        const { top, bottom } = button.getBoundingClientRect();
        return (top + bottom) / 2;
      }),
    );
    expect(middles.length).toBe(7); // play, two skips, subtitles, speed, full screen, stop
    expect(Math.max(...middles) - Math.min(...middles)).toBeLessThan(6); // all on one line
    phone.close();
  });
});

test.describe("subtitle height on the TV", () => {
  test("choosing a height moves the sample, as it will move the real subtitles", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: { title: "A film", stream: { url: "/fixtures/sample.mp4", type: "mp4" }, subtitles: [{ id: "en", label: "English", lang: "en", url: "/fixtures/sample.vtt" }] } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");

    await tv.getByTestId("tv-audio-sub-btn").click();
    await tv.getByRole("option", { name: "Customize…" }).click();
    await expect(tv.getByTestId("audio-subtitles-modal")).toHaveAttribute("data-kind", "captions");

    const sample = tv.getByTestId("subtitle-preview");
    const fromBottom = async () => 720 - (await sample.boundingBox())!.y - (await sample.boundingBox())!.height;
    await tv.getByRole("option", { name: /^Height/ }).focus();
    await tv.getByRole("option", { name: "Low", exact: true }).click();
    await expect.poll(fromBottom).toBeCloseTo(0.05 * 720, -1);
    const low = await fromBottom();

    await tv.getByRole("option", { name: "Higher", exact: true }).click();
    await expect.poll(fromBottom).toBeGreaterThan(low + 100); // 28% up rather than 5%
    await expect.poll(fromBottom).toBeCloseTo(0.28 * 720, -1);

    // The panel stays clear of the sample at the highest setting, so both can be seen together.
    const panel = (await tv.getByTestId("audio-subtitles-modal").boundingBox())!;
    expect(panel.y + panel.height).toBeLessThanOrEqual((await sample.boundingBox())!.y);
    phone.close();
  });
});

test.describe("the library on the TV", () => {
  const films = Array.from({ length: 10 }, (_, i) => ({
    id: `f${i}`,
    title: `Film number ${i + 1}`,
    year: 1930 + i,
    url: i === 0 ? "/fixtures/sample.mp4" : i === 9 ? "/fixtures/pages/none.html" : `/fixtures/sample.mp4?n=${i}`,
    ...(i === 1 ? { description: "A longer note about the second film, which the banner shows while it is selected." } : {}),
  }));
  const library = {
    updatedAt: Date.now(),
    rows: [
      { id: "r1", title: "Classics", source: "Test Source", items: films },
      { id: "r2", title: "More films", source: "Test Source", items: [{ id: "x1", title: "Second row first", url: "/fixtures/sample.mp4?r2=1" }, { id: "x2", title: "Second row second", url: "/fixtures/sample.mp4?r2=2" }] },
    ],
  };
  const serve = (answer: (route: Route) => Promise<void>) => async (tv: Page) => void (await tv.context().route("**/api/library", answer));
  const withLibrary = serve((route) => route.fulfill({ json: library }));

  const open = async (tv: Page) => {
    await tv.getByTestId("tv-browse-open").focus();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
  };
  const tiles = (tv: Page) => tv.getByTestId("tv-browse-tile");

  test("opens on the first title, shows it in the banner, and walks the rows with the arrow keys", async ({ browser }) => {
    const tv = await openTv(browser);
    await withLibrary(tv);
    await open(tv);

    await expect(tiles(tv).first()).toBeFocused();
    await expect(tv.getByTestId("tv-hero-title")).toHaveText("Film number 1");
    await tv.keyboard.press("ArrowRight");
    await expect(tiles(tv).nth(1)).toBeFocused();
    await expect(tv.getByTestId("tv-hero")).toContainText("A longer note about the second film");
    await expect(tv.getByTestId("tv-hero-title")).toHaveText("Film number 2");

    await tv.keyboard.press("ArrowDown");
    await expect(tiles(tv).nth(10 + 1)).toBeFocused(); // same column, next row
    await expect(tv.getByTestId("tv-hero-title")).toHaveText("Second row second");
    await tv.keyboard.press("ArrowRight"); // it is the last one there
    await expect(tiles(tv).nth(10 + 1)).toBeFocused();
    await tv.keyboard.press("ArrowUp");
    await tv.keyboard.press("ArrowUp");
    await expect(tv.getByTestId("tv-browse-close")).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await expect(tiles(tv).nth(1)).toBeFocused(); // back where it was
  });

  test("a row scrolls along to keep the title in view while the page stays put", async ({ browser }) => {
    const tv = await openTv(browser);
    await withLibrary(tv);
    await open(tv);
    await expect(tiles(tv).first()).toBeFocused();
    for (let i = 0; i < 9; i++) await tv.keyboard.press("ArrowRight");
    await expect(tiles(tv).nth(9)).toBeFocused();
    const inView = () =>
      tiles(tv).nth(9).evaluate((tile) => {
        const rect = tile.getBoundingClientRect();
        const view = tile.parentElement!.getBoundingClientRect();
        return rect.left >= view.left && rect.right <= view.right;
      });
    await expect.poll(inView).toBe(true); // the row eases along
    expect(await tv.evaluate(() => [document.scrollingElement?.scrollTop, document.querySelector(".tv")?.scrollTop, document.querySelector(".tv-browse")?.scrollTop])).toEqual([0, 0, 0]);

    await tv.keyboard.press("ArrowDown");
    await expect(tiles(tv).nth(10 + 1)).toBeFocused();
    const shown = () => tiles(tv).nth(10 + 1).evaluate((tile) => tile.getBoundingClientRect().bottom <= window.innerHeight);
    await expect.poll(shown).toBe(true); // the second row was brought up, not left below the screen
  });

  test("OK plays the title; Back shows the controls first, then returns to the library on the same title", async ({ browser }) => {
    const tv = await openTv(browser);
    await withLibrary(tv);
    await open(tv);
    await expect(tiles(tv).first()).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tiles(tv).nth(1)).toBeFocused();
    await tv.keyboard.press("ArrowLeft");
    await tv.keyboard.press("Enter"); // the first title: the sample film
    await expect(tv.getByTestId("tv-browse")).toHaveCount(0);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });

    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "hidden", { timeout: 8_000 });
    await tv.keyboard.press("Escape"); // the controls were gone: this only brings them back
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "visible");
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await tv.keyboard.press("Escape"); // this leaves
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle");
    await expect(tiles(tv).first()).toBeFocused();
  });

  test("Back closes the library, and a title that will not play says so and stays in the library", async ({ browser }) => {
    const tv = await openTv(browser);
    await withLibrary(tv);
    await open(tv);
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-browse")).toHaveCount(0);

    await open(tv);
    await expect(tiles(tv).first()).toBeFocused();
    for (let i = 0; i < 9; i++) await tv.keyboard.press("ArrowRight");
    await expect(tiles(tv).nth(9)).toBeFocused();
    await tv.keyboard.press("Enter"); // a page with no video
    await expect(tv.getByTestId("tv-notice")).toBeVisible({ timeout: 15_000 });
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(tiles(tv).nth(9)).toBeFocused();
  });

  test("a library that cannot be reached, or is empty, says so and can be left", async ({ browser }) => {
    const tv = await openTv(browser);
    await serve((route) => route.fulfill({ status: 500, body: "nope" }))(tv);
    await open(tv);
    await expect(tv.getByTestId("tv-browse-retry")).toBeFocused();
    await expect(tv.getByTestId("tv-browse")).toContainText("isn't reachable");

    await tv.context().unroute("**/api/library");
    await withLibrary(tv);
    await tv.keyboard.press("Enter"); // Try again
    await expect(tiles(tv).first()).toBeFocused();
  });
});
