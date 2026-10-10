import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import type { NormalizedMedia } from "../src/shared";
import { clickAsAHand, guestStorage, openDevice, openLibrary, openPairedPhone, openTv, RawPhone, readPairingCode, tvRoot, withLibrary } from "./helpers";

/** What the screens look like on a TV: the remote walks them, the buttons match, and everything fits. */

const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!;

test.describe("the start screens", () => {
  test("a screen opens straight on the library, under a welcome that fades by itself and never takes a press", async ({ browser }) => {
    const library = { updatedAt: Date.now(), rows: [{ id: "r1", title: "Classics", source: "Test Source", items: [{ id: "f0", title: "Film number 1", url: "/fixtures/sample.mp4" }] }] };
    const page = await openDevice(browser, { viewport: { width: 1280, height: 720 } }, {}, withLibrary(library));
    await page.goto("/tv");
    await expect(page.getByTestId("tv-welcome")).toBeVisible();
    await expect(page.getByTestId("unlock")).toHaveCount(0); // nothing to press first
    await expect(page.getByTestId("tv-browse")).toBeVisible();
    await expect(page.getByTestId("tv-browse-tile").first()).toBeFocused(); // the remote is already on the first title
    await page.keyboard.press("ArrowRight"); // a press goes to the library, and lets the welcome go
    await expect(page.getByTestId("tv-welcome")).toHaveCount(0, { timeout: 4_000 });
    await expect(page.getByTestId("tv-hero-title")).toHaveText("Film number 1");
  });

  test("the welcome goes by itself too, when nobody presses anything", async ({ browser }) => {
    const page = await openDevice(browser, { viewport: { width: 1280, height: 720 } });
    await page.goto("/tv");
    await expect(page.getByTestId("tv-welcome")).toBeVisible();
    await expect(page.getByTestId("tv-welcome")).toHaveCount(0, { timeout: 6_000 });
    await expect(page.getByTestId("tv-browse")).toBeVisible();
  });

  test("Connect a phone in the library's menu shows the code, and Back returns to the library", async ({ browser }) => {
    const tv = await openLibrary(browser);
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(tv.getByTestId("pairing-code")).toHaveCount(0);
    await tv.getByTestId("rail-connect").click();
    await expect(tv.getByTestId("pairing-code")).toBeVisible();
    await expect(tv.getByTestId("tv-browse")).toHaveCount(0);
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
  });

  test("a phone that connects while the library shows is told in a line, and the menu goes on saying so", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const code = await readPairingCode(tv);
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    const phone = await RawPhone.connect(baseURL!, code);
    await expect(tv.getByTestId("tv-flash")).toHaveText("A phone is connected.");
    await expect(tv.getByTestId("rail-connect")).toHaveAttribute("data-badged", "true");
    phone.close();
  });

  test("the switch to the remote can be chosen with OK from the page that shows the code", async ({ browser }) => {
    const tv = await openTv(browser);
    await expect(tv.getByTestId("pairing-code")).toBeVisible();
    await tv.keyboard.press("ArrowDown");
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("switch-to-remote")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("code-input")).toBeVisible(); // the page became a remote
  });

  test("the buttons under a connected TV are the same size, side by side", async ({ browser }) => {
    const tv = await openTv(browser);
    await openPairedPhone(browser, tv);
    await expect(tv.getByTestId("tv-paired")).toBeVisible();

    const browse = await box(tv, "tv-back-to-library");
    const disconnect = await box(tv, "tv-disconnect");
    expect(Math.abs(browse.height - disconnect.height)).toBeLessThan(1);
    expect(Math.abs(browse.width - disconnect.width)).toBeLessThan(1);
    expect(Math.abs(browse.y - disconnect.y)).toBeLessThan(1);
    expect(browse.x + browse.width).toBeLessThan(disconnect.x);
  });

  test("the arrow keys reach the library button on the pairing screen, and OK opens the library", async ({ browser }) => {
    const tv = await openTv(browser);
    await expect(tv.getByTestId("pairing-code")).toBeVisible();
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("tv-back-to-library")).toBeFocused();
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
    expect(middles.length).toBe(9); // play, two skips, subtitles, speed, party, mute, full screen, stop
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
    await tv.getByRole("option", { name: "Subtitle style…" }).click();
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

test.describe("the pause screen", () => {
  const film = (title: string): NormalizedMedia => ({ title, stream: { url: "/fixtures/sample.mp4", type: "mp4" } });

  test("while the picture is held the title is said once, big, and playing takes it away", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: film("The Long Night") });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");

    const card = tv.getByTestId("tv-pause-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("The Long Night");
    // Big, and the small title in the corner steps aside so it is not said twice.
    const fontSize = (locator: Locator) => locator.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    const corner = tv.getByTestId("tv-title");
    expect(await fontSize(card.locator("b"))).toBeGreaterThan(await fontSize(corner));
    const cornerOpacity = () => corner.evaluate((element) => getComputedStyle(element.closest(".hud-titles")!).opacity);
    await expect.poll(cornerOpacity).toBe("0");

    phone.cmd({ type: "PLAY" });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await expect(card).toHaveCount(0);
    await expect.poll(cornerOpacity).toBe("1");
    phone.cmd({ type: "PAUSE" });
    await expect(card).toBeVisible();
    phone.close();
  });

  test("an episode's card says which one it is", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({
      type: "LOAD",
      media: {
        ...film("The Long Night · S1 E2"),
        series: {
          season: 1,
          episode: 2,
          episodes: [
            { season: 1, episode: 1, title: "Pilot", url: `${baseURL}/fixtures/pages/video.html` },
            { season: 1, episode: 2, title: "The Long Night", url: `${baseURL}/fixtures/pages/none.html` },
          ],
        },
      },
    });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect(tv.getByTestId("tv-pause-card")).toContainText("S1:E2");
    phone.close();
  });
});

test.describe("the audio and subtitles menu on the TV", () => {
  /** A source that offers many releases of the same subtitles, with the long names such releases have. */
  const release = (n: number) => `English · The.Very.Long.Release.Name.${2020 + n}.1080p.WEB-DL.DDP5.1.Atmos.H.264-GROUPNAME.srt`;
  const media: NormalizedMedia = {
    title: "A film",
    stream: { url: "/fixtures/sample.mp4", type: "mp4" },
    subtitles: [
      ...[0, 1, 2, 3].map((n) => ({ id: `en${n}`, label: release(n), lang: "en", url: "/fixtures/sample.vtt" })),
      { id: "ro0", label: "Romanian", lang: "ro", url: "/fixtures/sample.vtt" },
      { id: "ro1", label: "Romanian (2) · Altă.Versiune.srt", lang: "ro", url: "/fixtures/sample.vtt" },
      { id: "it0", label: "Italian", lang: "it", url: "/fixtures/sample.vtt" },
    ],
  };
  const screens = [
    { name: "1080p", width: 1920, height: 1080 },
    { name: "720p", width: 1280, height: 720 },
    { name: "4:3", width: 1024, height: 768 },
  ];

  for (const screen of screens) {
    test(`many releases are picked language first, and nothing is cut off or off screen at ${screen.name}`, async ({ browser, baseURL }) => {
      const tv = await openTv(browser, { width: screen.width, height: screen.height });
      const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
      phone.cmd({ type: "LOAD", media });
      await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");

      await tv.getByTestId("tv-audio-sub-btn").click();
      const modal = tv.getByTestId("audio-subtitles-modal");
      await expect(modal).toHaveAttribute("data-kind", "tracks");
      const panel = (await modal.boundingBox())!;
      expect(panel.x).toBeGreaterThanOrEqual(0);
      expect(panel.y).toBeGreaterThanOrEqual(0);
      expect(panel.x + panel.width).toBeLessThanOrEqual(screen.width);
      expect(panel.y + panel.height).toBeLessThanOrEqual(screen.height);

      // The languages, with how many releases each has; no column of one lonely "Default" for audio.
      await expect(tv.getByRole("option", { name: "Off", exact: true })).toBeVisible();
      await expect(tv.getByRole("option", { name: /^English\s*4$/ })).toBeVisible();
      await expect(tv.getByRole("option", { name: /^Romanian\s*2$/ })).toBeVisible();
      await expect(tv.getByRole("option", { name: "Italian", exact: true })).toBeVisible();
      await expect(tv.getByRole("option", { name: "Default", exact: true })).toHaveCount(0);

      // Passing a language lists its releases beside it, named by what is particular to each.
      await tv.getByRole("option", { name: /^English/ }).focus();
      await expect(tv.getByRole("option", { name: /The\.Very\.Long\.Release\.Name\.2021/ })).toBeVisible();
      await expect(tv.getByRole("listbox", { name: "English: versions" }).getByRole("option")).toHaveCount(4);
      await tv.getByRole("option", { name: /^Romanian/ }).focus();
      await expect(tv.getByRole("listbox", { name: "Romanian: versions" }).getByRole("option")).toHaveText([/Version 1|^Romanian$/, /Altă\.Versiune/]);

      // Short names show whole: only the long release names may be shortened, and those wrap rather than vanish.
      const clipped = await tv.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".tv-menu-col:not([data-wrap='true']) .tv-opt > span")]
          .filter((span) => span.scrollWidth > span.clientWidth + 1)
          .map((span) => span.textContent),
      );
      expect(clipped).toEqual([]);

      // OK on a language turns it on.
      await tv.getByRole("option", { name: "Italian", exact: true }).click();
      await expect(tv.getByRole("option", { name: "Italian", exact: true })).toHaveAttribute("data-active", "true");
      await expect
        .poll(() => tv.evaluate(() => [...document.querySelector("video")!.textTracks].map((track) => track.mode)))
        .toEqual(["disabled", "disabled", "disabled", "disabled", "disabled", "disabled", "hidden"]);
      phone.close();
    });
  }

  test("the delay moves when the subtitles show, can be reset, and the phone and the TV agree on it", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    phone.cmd({ type: "SET_SUBTITLE", track: 6 });
    await expect(tv.getByTestId("caption")).toHaveText("Hello, this is a subtitle test!"); // the line starts at 0:00

    await tv.getByTestId("tv-audio-sub-btn").click();
    await tv.getByRole("option", { name: /^Later/ }).click();
    await tv.getByRole("option", { name: /^Later/ }).click();
    await expect(tv.getByRole("option", { name: /^Reset delay\s*\+1\.0s$/ })).toBeVisible();
    await expect(tv.getByTestId("caption")).toHaveCount(0); // a second late: nothing yet at 0:00
    await expect.poll(() => phone.states.at(-1)?.subtitleDelay).toBe(1);

    await tv.getByRole("option", { name: /^Reset delay/ }).click();
    await expect(tv.getByRole("option", { name: /^Reset delay\s*0\.0s$/ })).toBeVisible();
    await expect(tv.getByTestId("caption")).toHaveText("Hello, this is a subtitle test!");

    await tv.getByRole("option", { name: /^Earlier/ }).click();
    await expect(tv.getByRole("option", { name: /^Reset delay\s*−0\.5s$/ })).toBeVisible();
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
  const tiles = (tv: Page) => tv.getByTestId("tv-browse-tile");

  test("opens on the first title, shows it in the banner, and walks the rows with the arrow keys", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await expect(tv.getByTestId("tv-account-chip")).toBeVisible();

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
    await expect(tiles(tv).nth(1)).toBeFocused(); // the first row again, in the same column
    await tv.keyboard.press("ArrowUp");
    await expect(tv.getByTestId("tv-hero-play")).toBeFocused(); // the buttons under the banner sit between the rows and the top
    await tv.keyboard.press("ArrowUp");
    await expect(tv.getByTestId("tv-account-chip")).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("tv-hero-play")).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await expect(tiles(tv).nth(1)).toBeFocused(); // back where it was
  });

  test("the banner leaves room for the rows: the first two rows are on screen at once", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library), { width: 1920, height: 1080 });
    await expect(tiles(tv).first()).toBeFocused();
    const [hero, second] = await tv.evaluate(() => [document.querySelector(".tv-hero")!.getBoundingClientRect().bottom, document.querySelectorAll(".tv-row")[1]!.getBoundingClientRect()] as const).then(([bottom, rect]) => [bottom, rect.bottom] as const);
    expect(hero).toBeLessThan(1080 * 0.45); // a banner, not most of the page
    expect(second).toBeLessThanOrEqual(1080); // and the next row is not pushed below the fold
  });

  test("a row scrolls along to keep the title in view while the page stays put", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
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

  test("OK on a title opens its own page and OK again plays it; Back shows the controls first, then returns to the library on the same title", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await expect(tiles(tv).first()).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tiles(tv).nth(1)).toBeFocused();
    await tv.keyboard.press("ArrowLeft");
    await tv.keyboard.press("Enter"); // the first title: the sample film, on a page of its own
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused();
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await tv.keyboard.press("Enter"); // Play
    await expect(tv.getByTestId("tv-browse")).toHaveCount(0);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });

    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "hidden", { timeout: 8_000 });
    await tv.keyboard.press("Escape"); // the controls were gone: this only brings them back
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "visible");
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await tv.keyboard.press("Escape"); // this leaves
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle");
    // What was playing now heads "Continue watching", but the remote lands on the title it left, in its own row.
    await expect(tv.getByTestId("tv-browse").locator('[data-testid="tv-browse-tile"][title="Film number 1"]')).toBeFocused();
    await expect(tv.getByTestId("tv-hero-title")).toHaveText("Film number 1");
    await expect(tiles(tv).first()).toHaveAttribute("title", "sample");
  });

  test("Back on the home page opens the menu, and a title that will not play says so and stays in the library", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await expect(tiles(tv).first()).toBeFocused();
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-rail")).toHaveAttribute("data-open", "true");
    await expect(tv.getByTestId("rail-home")).toBeFocused();
    await tv.keyboard.press("Escape");
    await expect(tiles(tv).first()).toBeFocused();
    await expect(tv.getByTestId("tv-browse")).toBeVisible(); // the library is where the TV is; Back never leaves it

    for (let i = 0; i < 9; i++) await tv.keyboard.press("ArrowRight");
    await expect(tiles(tv).nth(9)).toBeFocused();
    await tv.keyboard.press("Enter"); // its own page
    await tv.keyboard.press("Enter"); // Play: a page with no video
    await expect(tv.getByTestId("tv-notice")).toBeVisible({ timeout: 15_000 });
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(tiles(tv).nth(9)).toBeFocused();
  });

  test("OK on a title opens its own page, which keeps the arrow keys to itself; Back closes it on the same title", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await expect(tiles(tv).first()).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tiles(tv).nth(1)).toBeFocused();
    await tv.keyboard.press("Enter");

    const page = tv.getByTestId("tv-detail");
    await expect(page).toBeVisible();
    await expect(tv.getByTestId("tv-detail-title")).toHaveText("Film number 2");
    await expect(page).toContainText("A longer note about the second film");
    await expect(page).toContainText("1931");
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused();
    await expect(tv.getByTestId("tv-detail-play")).toHaveText("Play");
    await expect(tv.getByTestId("tv-detail-list")).toHaveText("Add to My List");
    await expect(tv.getByTestId("tv-detail-remove")).toHaveCount(0); // nothing started, nothing to take off a row

    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-detail-list")).toBeFocused();
    await tv.keyboard.press("ArrowRight"); // the end of the buttons
    await expect(tv.getByTestId("tv-detail-list")).toBeFocused();
    await tv.keyboard.press("ArrowLeft");
    await tv.keyboard.press("ArrowLeft"); // never on to the menu behind the page
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused();
    await expect(tv.getByTestId("tv-rail")).toHaveAttribute("data-open", "false");

    await tv.keyboard.press("Escape");
    await expect(page).toHaveCount(0);
    await expect(tiles(tv).nth(1)).toBeFocused(); // back on the title it came from
    await expect(tv.getByTestId("tv-hero-title")).toHaveText("Film number 2");
  });

  test("a title is added to My List from its own page and taken out the same way", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await expect(tiles(tv).first()).toBeFocused();
    await tv.keyboard.press("Enter");
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-detail-list")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-detail-list")).toHaveText("Remove from My List");
    await expect(tv.getByTestId("tv-detail-list")).toHaveAttribute("aria-pressed", "true");
    await expect(tv.getByTestId("tv-detail")).toBeVisible(); // the page stays, to show it took

    await tv.keyboard.press("Escape");
    await expect(tv.getByRole("region", { name: "My List" }).getByTestId("tv-browse-tile")).toHaveCount(1); // Home has a row of it now

    await tv.getByTestId("rail-list").click();
    await expect(tv.getByTestId("tv-view-title")).toHaveText("My List");
    await expect(tiles(tv)).toHaveCount(1);
    await tiles(tv).first().click(); // its page again, which now takes it out
    await expect(tv.getByTestId("tv-detail-list")).toHaveText("Remove from My List");
    await tv.getByTestId("tv-detail-list").click();
    await expect(tv.getByTestId("tv-detail-list")).toHaveText("Add to My List");
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-view-empty")).toContainText("Nothing saved yet");
  });

  test("a title in a lower row has its page with every button too, where the banner has shrunk to a line", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await expect(tiles(tv).first()).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await expect(tiles(tv).nth(10)).toBeFocused(); // the first title of the second row
    await expect(tv.getByTestId("tv-hero-play")).toBeHidden(); // the banner's own buttons make room for the rows

    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-detail-title")).toHaveText("Second row first");
    await expect(tv.getByTestId("tv-detail-play")).toBeVisible();
    await expect(tv.getByTestId("tv-detail-list")).toBeVisible();
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-detail-list")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-detail-list")).toHaveText("Remove from My List");

    await tv.keyboard.press("Escape");
    await expect(tv.locator("[data-testid='tv-browse-tile']:focus")).toHaveAttribute("title", "Second row first"); // back on the title it came from
    await expect(tv.getByRole("region", { name: "My List" }).getByTestId("tv-browse-tile")).toHaveCount(1);
  });

  test("a title that is part way through says Resume, and can be taken off its row from its page", async ({ browser }) => {
    const seed = guestStorage({ progress: [{ key: "url:https://films.example/night-train", at: Date.now() - 60_000, title: "Night Train", url: "https://films.example/night-train", position: 1500, duration: 6000 }] });
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    await expect(tiles(tv).first()).toHaveAttribute("title", "Night Train"); // Continue watching comes first
    await expect(tiles(tv).first()).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-detail-title")).toHaveText("Night Train");
    await expect(tv.getByTestId("tv-detail-play")).toHaveText("Resume");
    await expect(tv.getByTestId("tv-detail-list")).toHaveText("Add to My List");
    await expect(tv.getByTestId("tv-detail-remove")).toHaveText("Remove from this row");

    await tv.keyboard.press("ArrowRight");
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-detail-remove")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0); // the card is gone, and so is its page
    await expect(tiles(tv).first()).toHaveAttribute("title", "Film number 1");
  });

  test("a click opens a title's page, and its Close button, or a click beside it, closes it", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await tiles(tv).nth(2).click();
    await expect(tv.getByTestId("tv-detail-title")).toHaveText("Film number 3");
    await tv.getByTestId("tv-detail-close").click();
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);

    await tiles(tv).nth(2).click();
    await expect(tv.getByTestId("tv-detail")).toBeVisible();
    await tv.getByTestId("tv-detail").click({ position: { x: 640, y: 120 } }); // the empty part of it
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
    await expect(tiles(tv).nth(2)).toBeFocused();
  });

  test("a click held the way a hand holds it opens a title in a lower row, though the rows would move on the press", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await expect(tiles(tv).first()).toBeFocused();
    await clickAsAHand(tv, tiles(tv).nth(10 + 1)); // "Second row second": the banner shrinks and the rows climb the moment it is pressed
    await expect(tv.getByTestId("tv-detail-title")).toHaveText("Second row second");
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused();

    await tv.keyboard.press("Escape");
    await expect(tv.locator("[data-testid='tv-browse-tile']:focus")).toHaveAttribute("title", "Second row second"); // the remote is where the mouse was
    await expect(tv.getByTestId("tv-hero-title")).toHaveText("Second row second");
  });

  test("a double click opens a title's page and leaves it open, instead of pressing what the page puts under the pointer", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await expect(tiles(tv).first()).toBeFocused();
    await tiles(tv).nth(1).dblclick();
    await tv.waitForTimeout(900);
    await expect(tv.getByTestId("tv-detail-title")).toHaveText("Film number 2");
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle"); // not played by the second click

    await tv.getByTestId("tv-detail-close").click();
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
    await tiles(tv).nth(10 + 1).dblclick(); // a lower row too
    await tv.waitForTimeout(900);
    await expect(tv.getByTestId("tv-detail-title")).toHaveText("Second row second");
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle");
  });

  test("the banner's Play still plays at once, for whoever wants to skip the page", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await expect(tiles(tv).first()).toBeFocused();
    await tv.keyboard.press("ArrowUp");
    await expect(tv.getByTestId("tv-hero-play")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-browse")).toHaveCount(0);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
  });

  test("a library that cannot be reached says so and can be tried again", async ({ browser }) => {
    const tv = await openLibrary(browser, (context) => context.route("**/api/library", (route) => route.fulfill({ status: 500, body: "nope" })));
    await expect(tv.getByTestId("tv-browse-retry")).toBeFocused();
    await expect(tv.getByTestId("tv-browse")).toContainText("isn't reachable");

    await tv.context().unroute("**/api/library");
    await withLibrary(library)(tv.context());
    await tv.keyboard.press("Enter"); // Try again
    await expect(tiles(tv).first()).toBeFocused();
  });

  test("an empty library says so, and the menu is still there", async ({ browser }) => {
    const tv = await openLibrary(browser); // the test server has no library of its own
    await expect(tv.getByTestId("tv-browse-retry")).toBeFocused();
    await expect(tv.getByTestId("tv-browse")).toContainText("Nothing in the library yet");
    await tv.keyboard.press("ArrowLeft");
    await expect(tv.getByTestId("tv-rail")).toHaveAttribute("data-open", "true");
    await expect(tv.getByTestId("rail-connect")).toBeVisible();
  });
});

test.describe("movies, series, and the rest of the menu", () => {
  /** Six film categories (more than the menu lists), two of series, with their titles told apart by name. */
  const kinded = (kind: "movie" | "series", id: string, title: string) => ({
    id,
    title,
    source: "Test Source",
    kind,
    items: [1, 2].map((n) => ({ id: `${id}-${n}`, title: `${kind === "movie" ? "Movie" : "Show"} ${title} ${n}`, kind, url: `/fixtures/sample.mp4?${id}=${n}` })),
  });
  const library = {
    updatedAt: Date.now(),
    rows: [
      kinded("movie", "m0", "Action"),
      kinded("series", "s0", "Crime"),
      kinded("movie", "m1", "Comedy"),
      kinded("series", "s1", "Drama"),
      ...["Horror", "Romance", "Thriller", "Western"].map((name, i) => kinded("movie", `m${i + 2}`, name)),
    ],
  };
  const titlesOnScreen = (tv: Page) => tv.getByTestId("tv-browse-tile").evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("title")));
  const rail = (tv: Page) => tv.getByTestId("tv-rail");
  /** Left from the first title, then up or down the menu to an entry, and OK. */
  const choose = async (tv: Page, entry: string) => {
    await tv.keyboard.press("ArrowLeft");
    await expect(rail(tv)).toHaveAttribute("data-open", "true");
    const order = await rail(tv).locator("button").evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).dataset.testid));
    const focused = await tv.evaluate(() => (document.activeElement as HTMLElement).dataset.testid);
    const steps = order.indexOf(entry) - order.indexOf(focused!);
    expect(order).toContain(entry);
    for (let i = 0; i < Math.abs(steps); i++) await tv.keyboard.press(steps > 0 ? "ArrowDown" : "ArrowUp");
    await expect(tv.getByTestId(entry)).toBeFocused();
    await tv.keyboard.press("Enter");
  };

  test("the menu keeps the categories of films and of series apart, a few of each, with More… after them", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
    await tv.keyboard.press("ArrowLeft");
    await expect(rail(tv)).toHaveAttribute("data-open", "true");
    await expect(rail(tv)).toContainText("Movie categories");
    await expect(rail(tv)).toContainText("Series categories");
    for (const shown of ["m0", "m1", "m2", "m3", "s0", "s1"]) await expect(tv.getByTestId(`rail-category-${shown}`)).toBeVisible();
    for (const hidden of ["m4", "m5"]) await expect(tv.getByTestId(`rail-category-${hidden}`)).toHaveCount(0); // not all six
    await expect(tv.getByTestId("rail-more-movie")).toBeVisible();
    await expect(tv.getByTestId("rail-more-series")).toHaveCount(0); // two is not more than fit
  });

  test("Movies and Series are pages of their own, each with only its kind", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
    expect((await titlesOnScreen(tv)).some((title) => title?.startsWith("Show"))).toBe(true); // Home has both

    await choose(tv, "rail-movies");
    await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "movies");
    await expect(tv.getByTestId("rail-movies")).toHaveAttribute("aria-current", "page");
    const films = await titlesOnScreen(tv);
    expect(films.length).toBeGreaterThan(0);
    expect(films.every((title) => title?.startsWith("Movie"))).toBe(true);

    await choose(tv, "rail-series");
    await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "series");
    const shows = await titlesOnScreen(tv);
    expect(shows.length).toBeGreaterThan(0);
    expect(shows.every((title) => title?.startsWith("Show"))).toBe(true);
  });

  test("More… lists all the categories of a kind, and one opens as a grid", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
    await choose(tv, "rail-more-movie");
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Movie categories");
    await expect(tv.getByTestId("tv-category-tile")).toHaveCount(6);
    await expect(tv.getByTestId("tv-category-tile").first()).toBeFocused();
    for (let i = 0; i < 5; i++) await tv.keyboard.press("ArrowRight"); // five to a row
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("tv-category-tile").nth(5)).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Western");
    expect(await titlesOnScreen(tv)).toEqual(["Movie Western 1", "Movie Western 2"]);
  });

  test("Home has a row of categories among its rows, and a category from it opens", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
    for (let i = 0; i < 3; i++) await tv.keyboard.press("ArrowDown"); // after the third row
    await expect(tv.getByTestId("tv-category-tile").first()).toBeFocused();
    await expect(tv.getByTestId("tv-hero-title")).toHaveText("Action");
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-category")).toBeVisible();
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Action");
  });

  test("History is everything watched, newest first and the finished ones marked; My List is what was saved", async ({ browser }) => {
    const now = Date.now();
    const seed = guestStorage({
      progress: [
        { key: "url:https://films.example/night-train", at: now - 60_000, title: "Night Train", url: "https://films.example/night-train", position: 1500, duration: 6000 },
        { key: "url:https://films.example/old-one", at: now - 90_000, title: "Old One", url: "https://films.example/old-one", position: 5990, duration: 6000, done: true },
      ],
      list: [{ key: "url:https://films.example/saved", at: now - 120_000, id: "s1", title: "Saved For Later", url: "https://films.example/saved" }],
    });
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();

    await choose(tv, "rail-history");
    await expect(tv.getByTestId("tv-view-title")).toHaveText("History");
    expect(await titlesOnScreen(tv)).toEqual(["Night Train", "Old One"]);
    await expect(tv.getByTestId("tv-history")).toContainText("Watched");

    await choose(tv, "rail-list");
    await expect(tv.getByTestId("tv-view-title")).toHaveText("My List");
    expect(await titlesOnScreen(tv)).toEqual(["Saved For Later"]);
  });

  test("a profile with nothing watched or saved gets a plain line, the menu shuts, and an arrow key brings it back", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
    await choose(tv, "rail-history");
    await expect(tv.getByTestId("tv-view-empty")).toHaveText("Nothing watched yet.");
    await expect(rail(tv)).toHaveAttribute("data-open", "false"); // there is no title to move to, but the menu is not left open over the page
    await expect(tv.getByTestId("rail-history")).toBeFocused(); // the remote is still on its line
    await tv.keyboard.press("ArrowUp");
    await expect(rail(tv)).toHaveAttribute("data-open", "true");
    await expect(tv.getByTestId("rail-list")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-view-empty")).toContainText("Nothing saved yet");
    await expect(rail(tv)).toHaveAttribute("data-open", "false");
    await tv.keyboard.press("Escape"); // Back is home
    await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "home");
  });

  test("clicking My List or History shuts the menu, whether or not they have anything in them", async ({ browser }) => {
    const seed = guestStorage({ list: [{ key: "url:https://films.example/saved", at: Date.now() - 1000, id: "s1", title: "Saved For Later", url: "https://films.example/saved" }] });
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);

    await tv.getByTestId("rail-history").click(); // nothing watched: an empty page
    await expect(tv.getByTestId("tv-view-empty")).toHaveText("Nothing watched yet.");
    await expect(rail(tv)).toHaveAttribute("data-open", "false");

    await tv.getByTestId("rail-list").click(); // one title saved
    await expect(tv.getByTestId("tv-view-title")).toHaveText("My List");
    await expect(tv.getByTestId("tv-browse-tile")).toHaveCount(1);
    await expect(rail(tv)).toHaveAttribute("data-open", "false");
  });

  test("titles like the last one watched come as a row of their own, without anything already started", async ({ browser }) => {
    const night = { key: "url:https://films.example/night-train", at: Date.now() - 60_000, title: "Night Train", url: "https://films.example/night-train", position: 1500, duration: 6000 };
    const tv = await openLibrary(
      browser,
      async (context) => {
        await withLibrary(library)(context);
        await context.route(/\/api\/library\/similar/, (route) =>
          route.fulfill({ json: { items: [{ id: "a", title: "Another Night", url: "/fixtures/sample.mp4?a=1" }, { id: "b", title: "Night Train", url: "https://films.example/night-train" }] } }),
        );
      },
      undefined,
      guestStorage({ progress: [night] }),
    );
    const similar = tv.getByRole("region", { name: "Because you watched Night Train" });
    await expect(similar).toBeVisible();
    await expect(similar.getByTestId("tv-browse-tile")).toHaveCount(1); // the one already started is not suggested again
    await expect(similar.getByTestId("tv-browse-tile")).toHaveAttribute("title", "Another Night");
  });
});

test.describe("categories and search on the TV", () => {
  const films = Array.from({ length: 10 }, (_, i) => ({ id: `f${i}`, title: `Film number ${i + 1}`, url: `/fixtures/sample.mp4?n=${i}` }));
  const library = {
    updatedAt: Date.now(),
    rows: [
      { id: "r1", title: "Classics", source: "Test Source", items: films },
      { id: "r2", title: "More films", source: "Test Source", items: [{ id: "x1", title: "Second row first", url: "/fixtures/sample.mp4?r2=1" }, { id: "x2", title: "Second row second", url: "/fixtures/sample.mp4?r2=2" }] },
    ],
  };
  /** The server knows one more title than the rows show, for any search with "film" in it. */
  const asked: string[] = [];
  const serverKnows = (query: string) => {
    asked.push(query);
    return query.includes("film") ? [{ id: "srv", title: "Film from the server", url: "/fixtures/sample.mp4?srv=1" }] : [];
  };
  const tiles = (tv: Page) => tv.getByTestId("tv-browse-tile");
  const open = async (browser: Browser, answer = withLibrary(library, serverKnows)) => {
    const tv = await openLibrary(browser, answer);
    await expect(tiles(tv).first()).toBeFocused();
    return tv;
  };
  /** Left from the first title, then up or down the menu to an entry, and OK. */
  const choose = async (tv: Page, entry: string) => {
    await tv.keyboard.press("ArrowLeft");
    await expect(tv.getByTestId("tv-rail")).toHaveAttribute("data-open", "true");
    const order = await tv.getByTestId("tv-rail").locator("button").evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).dataset.testid));
    const focused = await tv.evaluate(() => (document.activeElement as HTMLElement).dataset.testid);
    const steps = order.indexOf(entry) - order.indexOf(focused!);
    for (let i = 0; i < Math.abs(steps); i++) await tv.keyboard.press(steps > 0 ? "ArrowDown" : "ArrowUp");
    await expect(tv.getByTestId(entry)).toBeFocused();
    await tv.keyboard.press("Enter");
  };

  test("Left from the first title opens the menu on the page that is open, and Right goes back to the titles", async ({ browser }) => {
    const tv = await open(browser);
    await expect(tv.getByTestId("tv-rail")).toHaveAttribute("data-open", "false");

    await tv.keyboard.press("ArrowLeft");
    await expect(tv.getByTestId("tv-rail")).toHaveAttribute("data-open", "true");
    await expect(tv.getByTestId("rail-home")).toBeFocused();
    await expect(tv.getByTestId("rail-home")).toHaveAttribute("aria-current", "page");
    await expect(tv.getByTestId("rail-category-r1")).toHaveText("Classics");
    await expect(tv.getByTestId("rail-category-r2")).toHaveText("More films");

    await tv.keyboard.press("ArrowUp");
    await expect(tv.getByTestId("rail-search")).toBeFocused();
    for (const entry of ["rail-home", "rail-movies", "rail-series", "rail-list", "rail-history", "rail-party", "rail-connect", "rail-settings", "rail-category-r1"]) {
      await tv.keyboard.press("ArrowDown");
      await expect(tv.getByTestId(entry)).toBeFocused();
    }
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-rail")).toHaveAttribute("data-open", "false");
    await expect(tiles(tv).first()).toBeFocused();
  });

  test("a category opens as a grid of all its titles; Back goes home, and Back again opens the menu", async ({ browser }) => {
    const tv = await open(browser);
    await choose(tv, "rail-category-r1");
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Classics");
    await expect(tiles(tv)).toHaveCount(10);
    await expect(tiles(tv).first()).toBeFocused();
    await expect(tv.getByTestId("tv-rail")).toHaveAttribute("data-open", "false");

    for (let i = 0; i < 4; i++) await tv.keyboard.press("ArrowRight"); // five to a row
    await tv.keyboard.press("ArrowDown");
    await expect(tiles(tv).nth(9)).toBeFocused();
    await tv.keyboard.press("ArrowUp");
    await expect(tiles(tv).nth(4)).toBeFocused();

    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-hero")).toBeVisible();
    await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "home");
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-rail")).toHaveAttribute("data-open", "true");
  });

  test("Back from the menu returns to the titles before it leaves anything", async ({ browser }) => {
    const tv = await open(browser);
    await tv.keyboard.press("ArrowLeft");
    await expect(tv.getByTestId("rail-home")).toBeFocused();
    await tv.keyboard.press("Escape");
    await expect(tiles(tv).first()).toBeFocused();
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
  });

  test("search: the keyboard and a real keyboard type, titles on screen answer at once and the server adds more", async ({ browser }) => {
    asked.length = 0;
    const tv = await open(browser);
    await choose(tv, "rail-search");
    await expect(tv.getByTestId("tv-search")).toBeVisible();
    await expect(tv.getByTestId("key-a")).toBeFocused();
    await expect(tv.getByTestId("tv-search-status")).toHaveText("Type a title to search.");

    await tv.keyboard.press("ArrowRight"); // the on-screen keyboard, by the arrow keys
    await expect(tv.getByTestId("key-b")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-query")).toHaveText("b");
    await tv.keyboard.press("ArrowDown");
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("key-n")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-query")).toHaveText("bn");
    await tv.keyboard.press("Backspace"); // a keyboard's Backspace deletes before it means Back
    await tv.keyboard.press("Backspace");
    await expect(tv.getByTestId("tv-query")).toHaveText("Search titles");

    await tv.keyboard.type("film number");
    await expect(tv.getByTestId("tv-query")).toHaveText("film number"); // and a space press does not also press the key under the remote
    await expect(tv.getByTestId("tv-search-status")).toContainText("10 titles for “film number”"); // from the rows, before the server answers
    await expect(tiles(tv)).toHaveCount(10);
    for (let i = 0; i < 7; i++) await tv.keyboard.press("Backspace");
    await expect(tv.getByTestId("tv-query")).toHaveText("film");
    await expect(tv.getByTestId("tv-search-status")).toContainText("11 titles for “film”"); // the server knew one more
    await expect(tiles(tv).last()).toHaveAttribute("title", "Film from the server");
    expect(asked.at(-1)).toBe("film");
    expect(asked.filter((q) => q.length < 2)).toEqual([]); // nothing for a single letter
  });

  test("search: right from the keyboard reaches the filter and then the results, OK plays one, and Back returns to the same search", async ({ browser }) => {
    const tv = await open(browser);
    await choose(tv, "rail-search");
    await tv.keyboard.type("film");
    await expect(tv.getByTestId("tv-search-status")).toContainText("11 titles");

    for (let i = 0; i < 5; i++) await tv.keyboard.press("ArrowRight"); // along the top row of keys
    await expect(tv.getByTestId("key-f")).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("filter-all")).toBeFocused(); // the filter sits between the keys and the results
    await tv.keyboard.press("ArrowDown");
    await expect(tiles(tv).first()).toBeFocused();
    await tv.keyboard.press("ArrowUp");
    await expect(tv.getByTestId("filter-all")).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await tv.keyboard.press("ArrowDown");
    await tv.keyboard.press("ArrowRight");
    await expect(tiles(tv).nth(4)).toBeFocused(); // three to a row
    await tv.keyboard.press("ArrowLeft");
    await tv.keyboard.press("ArrowLeft");
    await expect(tv.getByTestId("key-l")).toBeFocused(); // left from the first column goes back to the end of the keys' row
    await tv.keyboard.press("ArrowUp");
    await tv.keyboard.press("ArrowRight");
    await tv.keyboard.press("ArrowDown");
    await tv.keyboard.press("ArrowDown");
    await tv.keyboard.press("ArrowRight");
    await expect(tiles(tv).nth(4)).toBeFocused();
    await tv.keyboard.press("Enter"); // its own page, over the search
    await expect(tv.getByTestId("tv-detail-title")).toHaveText("Film number 5");
    await tv.keyboard.type("zz"); // typing goes nowhere while the page is open
    await expect(tv.getByTestId("tv-query")).toHaveText("film");
    await tv.keyboard.press("Enter"); // Play

    await expect(tv.getByTestId("tv-browse")).toHaveCount(0);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "hidden", { timeout: 8_000 });
    await tv.keyboard.press("Escape");
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-search")).toBeVisible();
    await expect(tv.getByTestId("tv-query")).toHaveText("film");
    await expect(tiles(tv)).toHaveCount(11);
    await expect(tiles(tv).nth(4)).toBeFocused();
  });

  test("search: the type filter narrows the answers to films or to series", async ({ browser }) => {
    const mixed = {
      updatedAt: Date.now(),
      rows: [
        {
          id: "mix",
          title: "Tonight",
          source: "Test Source",
          items: [
            { id: "a", title: "Night Film", kind: "movie", url: "/fixtures/sample.mp4?a=1" },
            { id: "b", title: "Night Show", kind: "series", url: "/fixtures/sample.mp4?b=1" },
            { id: "c", title: "Night Other", kind: "movie", url: "/fixtures/sample.mp4?c=1" },
          ],
        },
      ],
    };
    const tv = await open(browser, withLibrary(mixed));
    await choose(tv, "rail-search");
    await tv.keyboard.type("night");
    await expect(tiles(tv)).toHaveCount(3);

    for (let i = 0; i < 6; i++) await tv.keyboard.press("ArrowRight"); // the end of the top row of keys, then the filter
    await expect(tv.getByTestId("filter-all")).toBeFocused();
    await expect(tv.getByTestId("filter-all")).toHaveAttribute("aria-checked", "true");
    await tv.keyboard.press("ArrowRight");
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("filter-movie")).toHaveAttribute("aria-checked", "true");
    await expect(tiles(tv)).toHaveCount(2);
    await expect(tv.getByTestId("tv-search-status")).toContainText("2 titles");

    await tv.keyboard.press("ArrowRight");
    await tv.keyboard.press("Enter");
    await expect(tiles(tv)).toHaveCount(1);
    await expect(tiles(tv).first()).toHaveAttribute("title", "Night Show");
  });

  test("search: nothing found says so, and Back leaves the search for the home page", async ({ browser }) => {
    const tv = await open(browser);
    await choose(tv, "rail-search");
    await tv.keyboard.type("zzzz");
    await expect(tv.getByTestId("tv-search-status")).toHaveText("Nothing matches “zzzz”.");
    await expect(tiles(tv)).toHaveCount(0);

    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-hero")).toBeVisible();
    await expect(tiles(tv).first()).toBeFocused();
  });

  test("the library can be searched even when its rows could not be loaded", async ({ browser }) => {
    const tv = await openLibrary(browser, async (context) => {
      await context.route("**/api/library", (route) => route.fulfill({ status: 500, body: "nope" }));
      await context.route(/\/api\/library\/search/, (route) => route.fulfill({ json: { items: [{ id: "srv", title: "Only On The Server", url: "/fixtures/sample.mp4" }] } }));
    });
    await expect(tv.getByTestId("tv-browse-retry")).toBeFocused();
    await tv.keyboard.press("ArrowLeft"); // the menu opens on Home; Search is above it
    await tv.keyboard.press("ArrowUp");
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-search")).toBeVisible();
    await tv.keyboard.type("server");
    await expect(tiles(tv).first()).toHaveAttribute("title", "Only On The Server");
  });
});

test.describe("a video that will not start", () => {
  /** A page that takes the request and never answers, for a lookup that does not end. */
  async function hangingPage() {
    const server = createServer(() => {});
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/film` };
  }
  /** The TV page's clock is its own, so ten seconds of waiting can be skipped instead of sat through. */
  const withFakeClock = (context: BrowserContext) => context.clock.install();
  const SLOW = 10_500;
  const hanging = (url: string) => ({ updatedAt: Date.now(), rows: [{ id: "r", title: "Row", source: "S", items: [{ id: "a", title: "Hangs", url }] }] });

  test("a lookup that never answers offers Cancel after ten seconds, and OK on it puts the TV back in the library", async ({ browser }) => {
    const { server, url } = await hangingPage();
    try {
      const tv = await openLibrary(browser, async (context) => {
        await withFakeClock(context);
        await withLibrary(hanging(url))(context);
      });
      await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
      await tv.keyboard.press("Enter"); // its own page
      await tv.keyboard.press("Enter"); // Play
      await expect(tv.getByTestId("tv-resolving")).toBeVisible();
      await expect(tv.getByTestId("tv-cancel-load")).toHaveCount(0); // nothing to give up on yet

      await tv.clock.fastForward(SLOW);
      await expect(tv.getByTestId("tv-resolving")).toContainText("longer than usual");
      await expect(tv.getByTestId("tv-cancel-load")).toBeFocused(); // so OK is all it takes
      await tv.keyboard.press("Enter");

      await expect(tv.getByTestId("tv-browse")).toBeVisible();
      await expect(tv.getByTestId("tv-resolving")).toHaveCount(0);
      await expect(tv.getByTestId("tv-notice")).toHaveCount(0); // giving up is not a failure to explain
      await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
    } finally {
      server.close();
    }
  });

  test("Back gives up on a lookup straight away", async ({ browser }) => {
    const { server, url } = await hangingPage();
    try {
      const tv = await openLibrary(browser, withLibrary(hanging(url)));
      await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
      await tv.keyboard.press("Enter"); // its own page
      await tv.keyboard.press("Enter"); // Play
      await expect(tv.getByTestId("tv-resolving")).toBeVisible();
      await tv.keyboard.press("Escape");
      await expect(tv.getByTestId("tv-browse")).toBeVisible();
      await expect(tv.getByTestId("tv-notice")).toHaveCount(0);
    } finally {
      server.close();
    }
  });

  test("a stream that never loads offers Cancel after ten seconds; OK stops it and the phone sees nothing playing", async ({ browser, baseURL }) => {
    const tv = await openLibrary(browser, withFakeClock);
    await tv.getByTestId("rail-connect").click();
    await tv.route("**/fixtures/never.mp4", () => {}); // the request is taken and never answered
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: { title: "Stuck", stream: { url: "/fixtures/never.mp4", type: "mp4" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "loading");
    await expect(tv.getByTestId("tv-buffering")).toBeVisible();
    await expect(tv.getByTestId("tv-cancel-load")).toHaveCount(0);

    await tv.clock.fastForward(SLOW);
    await expect(tv.getByTestId("tv-cancel-load")).toBeVisible();
    await tv.keyboard.press("Enter");

    await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle");
    await expect(tv.getByTestId("tv-paired")).toBeVisible(); // back on the screen it was on, still connected
    await expect.poll(() => phone.states.at(-1)?.state).toBe("idle");
    phone.close();
  });

  test("the button can be clicked too", async ({ browser, baseURL }) => {
    const tv = await openLibrary(browser, withFakeClock);
    await tv.getByTestId("rail-connect").click();
    await tv.route("**/fixtures/never.mp4", () => {});
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: { title: "Stuck", stream: { url: "/fixtures/never.mp4", type: "mp4" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "loading");
    await tv.clock.fastForward(SLOW);
    await tv.getByTestId("tv-cancel-load").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle");
    phone.close();
  });

  test("the phone that asked for the link is not left waiting when the TV gives up", async ({ browser }) => {
    const { server, url } = await hangingPage();
    try {
      const tv = await openLibrary(browser, withFakeClock);
      await tv.getByTestId("rail-connect").click();
      const phone = await openPairedPhone(browser, tv);
      await phone.getByTestId("url-input").fill(url);
      await phone.getByTestId("play-url").click();
      await expect(tv.getByTestId("tv-resolving")).toBeVisible();
      await expect(phone.getByTestId("resolve-status")).toHaveAttribute("data-phase", "resolving");

      await tv.clock.fastForward(SLOW);
      await tv.getByTestId("tv-cancel-load").click();
      await expect(phone.getByTestId("resolve-status")).toHaveCount(0);
      await expect(tv.getByTestId("tv-paired")).toBeVisible();
    } finally {
      server.close();
    }
  });
});

test.describe("a film that has ended", () => {
  const like = (baseURL: string) => [
    { id: "a", title: "Another Film", year: 2001, url: `${baseURL}/fixtures/pages/video.html` },
    { id: "b", title: "One More", url: `${baseURL}/fixtures/pages/video.html?b` },
  ];
  const film = (title: string): NormalizedMedia => ({ title, page: "https://films.example/short", stream: { url: "/fixtures/sample.mp4", type: "mp4" } });

  /** The film on the TV, taken to its last second and let to end (what the phone would have done by playing it). */
  async function playToTheEnd(tv: Page, baseURL: string, media: NormalizedMedia) {
    await tv.route(/\/api\/library\/similar/, (route) => route.fulfill({ json: { items: like(baseURL) } }));
    const phone = await RawPhone.connect(baseURL, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await tv.evaluate(() => {
      const video = document.querySelector("video")!;
      video.currentTime = video.duration - 1.2;
    });
    phone.cmd({ type: "PLAY" });
    return phone;
  }

  test("an end card takes the place of the last frame, with the way out first and titles like it under", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await playToTheEnd(tv, baseURL!, film("A Short Film"));
    const card = tv.getByTestId("tv-end");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(tv.getByTestId("tv-end-title")).toHaveText("A Short Film");
    await expect(tv.getByTestId("end-library")).toBeFocused(); // so OK is all it takes to leave
    await expect(tv.getByTestId("end-next")).toHaveCount(0); // a film has no next episode
    await expect(tv.getByTestId("tv-play-btn")).toHaveCount(0); // the player's controls give way to it
    await expect(tv.getByTestId("end-similar")).toHaveCount(2);
    await expect(tv.getByTestId("end-similar").first()).toHaveAttribute("title", "Another Film");

    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle");
    await expect.poll(() => phone.states.at(-1)?.state).toBe("idle"); // the phone is told it is over
    phone.close();
  });

  test("Back leaves for the library too, and Watch again starts over", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await playToTheEnd(tv, baseURL!, film("Twice"));
    await expect(tv.getByTestId("tv-end")).toBeVisible({ timeout: 15_000 });
    await tv.keyboard.press("ArrowRight"); // Watch again is beside the library
    await expect(tv.getByTestId("end-again")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-end")).toHaveCount(0);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    expect(Number(await tvRoot(tv).getAttribute("data-time"))).toBeLessThan(3);

    await tv.evaluate(() => {
      const video = document.querySelector("video")!;
      video.currentTime = video.duration - 1.2;
    });
    await expect(tv.getByTestId("tv-end")).toBeVisible({ timeout: 15_000 });
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    phone.close();
  });

  test("a title like it is chosen with the arrow keys and plays", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await playToTheEnd(tv, baseURL!, film("Before"));
    await expect(tv.getByTestId("tv-end")).toBeVisible({ timeout: 15_000 });
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("end-similar").first()).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-end")).toHaveCount(0);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    phone.close();
  });

  test("a card that has nothing like it to offer is still complete", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await playToTheEnd(tv, baseURL!, { title: "Alone", stream: { url: "/fixtures/sample.mp4", type: "mp4" } }); // no page: the library has nothing to compare
    await expect(tv.getByTestId("tv-end")).toBeVisible({ timeout: 15_000 });
    await expect(tv.getByTestId("end-similar")).toHaveCount(0);
    await expect(tv.getByTestId("end-again")).toBeVisible();
    phone.close();
  });

  test("the last episode offers the next one only if there is one, and turning down Up Next lands on the card", async ({ browser, baseURL }) => {
    test.setTimeout(45_000);
    const tv = await openTv(browser, undefined, guestStorage({ settings: [{ key: "autoplayNext", at: Date.now(), value: false }] }));
    const episode = (n: number) => ({ season: 1, episode: n, title: `Part ${n}`, url: `${baseURL}/fixtures/pages/${n === 1 ? "video" : "hls"}.html` });
    const phone = await playToTheEnd(tv, baseURL!, {
      title: "Parts · S1 E1",
      stream: { url: "/fixtures/sample.mp4", type: "mp4" },
      series: { season: 1, episode: 1, episodes: [episode(1), episode(2)], next: episode(2) },
    });
    const upNext = tv.getByTestId("netflix-upnext");
    await expect(upNext).toBeVisible({ timeout: 15_000 });
    await expect(tv.getByTestId("tv-end")).toHaveCount(0); // the next episode is offered first
    await upNext.getByRole("button", { name: "Cancel" }).click();

    await expect(tv.getByTestId("tv-end")).toBeVisible();
    await expect(tv.getByTestId("end-next")).toBeFocused();
    await expect(tv.getByTestId("tv-end")).toContainText("Season 1, Episode 1");
    await tv.getByTestId("end-next").click();
    await expect(tv.getByTestId("tv-end")).toHaveCount(0);
    await expect(tvRoot(tv)).not.toHaveAttribute("data-state", "paused", { timeout: 15_000 });
    phone.close();
  });
});
