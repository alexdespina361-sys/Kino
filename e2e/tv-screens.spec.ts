import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import type { NormalizedMedia } from "../src/shared";
import { en } from "../src/client/i18n/en";
import { clickAsAHand, guestStorage, openDevice, openLibrary, openPairedPhone, openTv, RawPhone, readPairingCode, tvRoot, withLibrary } from "./helpers";

/** What the screens look like on a TV: the remote walks them, the buttons match, and everything fits. */

const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!;

test.describe("the start screens", () => {
  test("a screen opens straight on the library, under a welcome that fades by itself and never takes a press", async ({ browser }) => {
    const library = { updatedAt: Date.now(), rows: [{ id: "r1", title: "Classics", source: "Test Source", items: [{ id: "f0", title: "Film number 1", url: "/fixtures/sample.mp4" }] }] };
    const page = await openDevice(browser, { viewport: { width: 1280, height: 720 } }, {}, withLibrary(library));
    await page.goto("/tv");
    await expect(page.getByTestId("tv-welcome")).toBeVisible();
    await expect(page.getByTestId("welcome-enter")).toHaveCount(0); // (this screen's viewer left full screen last time: nothing is asked of them)
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

  /** How many lines the player's controls are on. The buttons are not all as tall, so it is their middles that say. */
  const linesOf = (tv: Page) =>
    tv.evaluate(() => {
      const middles = [...document.querySelectorAll(".hud-controls button")]
        .map((button) => {
          const { top, bottom } = button.getBoundingClientRect();
          return (top + bottom) / 2;
        })
        .sort((a, b) => a - b);
      return middles.reduce((lines, middle, i) => (i > 0 && middle - middles[i - 1]! > 10 ? lines + 1 : lines), 1);
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
      expect(await linesOf(tv)).toBe(1);
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

  /** One stream at two sizes: the quality button is only there when there is a choice. */
  const twoSizes = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    '#EXT-X-STREAM-INF:BANDWIDTH=153168,RESOLUTION=320x180,CODECS="vp09.00.11.08"',
    "stream.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=453168,RESOLUTION=1280x720,CODECS="vp09.00.11.08"',
    "stream.m3u8",
    "",
  ].join("\n");

  for (const [locale, language] of [["en-US", "English"], ["ro-RO", "Romanian"], ["it-IT", "Italian"]] as const) {
    test(`everything the controls have is on one line in ${language}, from 4K down to a small window, and stays there as the window changes`, async ({ browser, baseURL }) => {
      const tv = await openDevice(browser, { viewport: { width: 1920, height: 1080 }, locale }, {}, (context) =>
        context.route("**/fixtures/hls/multi.m3u8", (route) => route.fulfill({ contentType: "application/vnd.apple.mpegurl", body: twoSizes })),
      );
      await tv.goto("/tv");
      await expect(tv.getByTestId("tv-browse")).toBeVisible();
      await tv.getByTestId("rail-connect").click();
      const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
      phone.cmd({ type: "LOAD", media: { ...fullest(baseURL!), stream: { url: "/fixtures/hls/multi.m3u8", type: "hls" } } });
      await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
      for (const id of ["prev", "next", "episodes", "audio-sub", "source", "speed", "quality", "party", "mute", "fullscreen", "stop"]) {
        await expect(tv.getByTestId(`tv-${id}-btn`), `the ${id} button`).toBeVisible(); // the fullest the controls get: a button for everything
      }
      for (const [width, height] of [[1920, 1080], [3840, 2160], [1280, 720], [1024, 768], [900, 506], [800, 600], [1920, 1080]] as const) {
        await tv.setViewportSize({ width, height });
        // (a frame after the window has changed, the controls have been fitted to it)
        await expect
          .poll(
            async () => {
              const overflow = await tv.evaluate(() => {
                const row = document.querySelector(".hud-controls")!;
                return row.scrollWidth - row.clientWidth;
              });
              return (await linesOf(tv)) === 1 && overflow <= 1;
            },
            { message: `at ${width}×${height}` },
          )
          .toBe(true);
      }
      phone.close();
    });
  }

  test("what the controls give up on a small screen is a label, and the button keeps its name and its place", async ({ browser, baseURL }) => {
    const tv = await openDevice(browser, { viewport: { width: 800, height: 600 }, locale: "ro-RO" });
    await tv.goto("/tv");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await tv.getByTestId("rail-connect").click();
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: fullest(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    const row = tv.locator(".hud-controls");
    await expect(row).toHaveAttribute("data-fit", /party/); // the longest label goes first of them
    const party = tv.getByTestId("tv-party-btn");
    await expect(party).toHaveAttribute("data-folded", "");
    await expect(party).toHaveAttribute("aria-label", "Vizionare comună");
    expect(await party.evaluate((button) => (button.querySelector(".tv-btn-label") as HTMLElement).offsetWidth)).toBe(0); // the words are not drawn
    await party.click(); // and it is a button like any other
    await expect(tv.getByTestId("tv-party-panel")).toBeVisible();
    await tv.keyboard.press("Escape");

    await tv.setViewportSize({ width: 2560, height: 1080 }); // room again: the words come back
    await expect(party).not.toHaveAttribute("data-folded", "");
    await expect(row).toHaveAttribute("data-fit", "");
    expect(await party.evaluate((button) => (button.querySelector(".tv-btn-label") as HTMLElement).offsetWidth)).toBeGreaterThan(0);
    phone.close();
  });

  test("a phone-sized screen wraps the controls on two lines rather than running them off the side", async ({ browser, baseURL }) => {
    const tv = await openDevice(browser, { viewport: { width: 390, height: 844 }, locale: "ro-RO" });
    await tv.goto("/tv");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await tv.getByTestId("rail-connect").click();
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: fullest(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect.poll(() => linesOf(tv)).toBe(2);
    const rects = await tv.evaluate(() => [...document.querySelectorAll(".hud-controls button")].map((button) => button.getBoundingClientRect().right));
    for (const right of rects) expect(right).toBeLessThanOrEqual(390);
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

test.describe("a menu's close button on the TV", () => {
  /** A paused film with subtitles, and the menu behind `button` open on it (opened with the mouse: the keys go on from there). */
  const openMenu = async (browser: Browser, baseURL: string, button: string) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: { title: "A film", stream: { url: "/fixtures/sample.mp4", type: "mp4" }, subtitles: [{ id: "en", label: "English", lang: "en", url: "/fixtures/sample.vtt" }] } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await tv.getByTestId(button).click();
    return { tv, phone };
  };

  test("the remote reaches it from the top of a column and from past the last one, and goes back in from it", async ({ browser, baseURL }) => {
    const { tv, phone } = await openMenu(browser, baseURL!, "tv-audio-sub-btn");
    const modal = tv.getByTestId("audio-subtitles-modal");
    const close = modal.getByRole("button", { name: "Close" });
    const off = modal.getByRole("option", { name: "Off" });
    await expect(off).toBeFocused(); // the subtitles in use, at the top of the first column

    await tv.keyboard.press("ArrowUp");
    await expect(close).toBeFocused();
    await tv.keyboard.press("ArrowUp"); // nothing is above it
    await tv.keyboard.press("ArrowRight"); // nor beside it
    await expect(close).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await expect(off).toBeFocused(); // back where the remote was

    await tv.keyboard.press("ArrowRight"); // the next column (the delay)
    await expect(modal.getByRole("option", { name: /^Earlier/ })).toBeFocused();
    await tv.keyboard.press("ArrowRight"); // and past the last one
    await expect(close).toBeFocused();
    await tv.keyboard.press("ArrowLeft");
    await expect(modal.getByRole("option", { name: /^Earlier/ })).toBeFocused(); // in again, on the option it left

    await tv.keyboard.press("ArrowUp");
    await expect(close).toBeFocused();
    await tv.keyboard.press("Enter"); // OK closes the menu
    await expect(modal).toHaveCount(0);
    // A hand opened it (see `openMenu`), so the remote had no button to go back to, and none is left lit: the arrows skip until it asks for the controls.
    // (A menu the remote opened gives the focus back to its button: "Back from a menu returns to the button that opened it", in features.spec.ts.)
    expect(await tv.locator(".hud-controls button:focus").count()).toBe(0);
    phone.close();
  });

  test("a menu of one column has it to the right of all of its options", async ({ browser, baseURL }) => {
    const { tv, phone } = await openMenu(browser, baseURL!, "tv-speed-btn");
    const modal = tv.getByTestId("audio-subtitles-modal");
    const normal = modal.getByRole("option", { name: /Normal/ });
    await expect(normal).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(modal.getByRole("button", { name: "Close" })).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await expect(normal).toBeFocused();
    await tv.keyboard.press("ArrowUp"); // one option up, not the button: it is only above the first
    await expect(normal).not.toBeFocused();
    await expect(modal.getByRole("button", { name: "Close" })).not.toBeFocused();
    phone.close();
  });

  test("the watch party's panel has the same button within reach", async ({ browser, baseURL }) => {
    const { tv, phone } = await openMenu(browser, baseURL!, "tv-party-btn");
    const panel = tv.getByTestId("tv-party-panel");
    await expect(tv.getByTestId("tv-party-start")).toBeFocused();
    await tv.keyboard.press("ArrowUp");
    await expect(panel.getByRole("button", { name: "Close" })).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("tv-party-start")).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(panel.getByRole("button", { name: "Close" })).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(panel).toHaveCount(0);
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
    await expect(tv.getByTestId("tv-pause-card")).toContainText("Season 1, Episode 2");
    await expect(tv.getByTestId("tv-pause-card")).not.toContainText("S1:E2"); // said once, in words
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
    await expect(tv.getByTestId("tv-detail-list")).toHaveText("Add to Favourites");
    await expect(tv.getByTestId("tv-detail-remove")).toHaveCount(0); // nothing started, nothing to take off a row

    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-detail-list")).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-detail-rate")).toBeFocused();
    await expect(tv.getByTestId("tv-detail-rate")).toHaveText("Rate"); // not rated yet
    await tv.keyboard.press("ArrowRight"); // past the last button is the Close button in the corner
    await expect(tv.getByTestId("tv-detail-close")).toBeFocused();
    await tv.keyboard.press("ArrowRight"); // and that is the end of it
    await expect(tv.getByTestId("tv-detail-close")).toBeFocused();
    await tv.keyboard.press("ArrowLeft");
    await expect(tv.getByTestId("tv-detail-rate")).toBeFocused();
    await tv.keyboard.press("ArrowUp"); // Up reaches Close from any button too
    await expect(tv.getByTestId("tv-detail-close")).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused();
    await tv.keyboard.press("ArrowLeft"); // never on to the menu behind the page
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused();
    await tv.keyboard.press("ArrowDown"); // a film's page has nothing under its buttons
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused();
    await expect(tv.getByTestId("tv-rail")).toHaveAttribute("data-open", "false");
    await expect(tv.getByTestId("tv-episodes")).toHaveCount(0);

    await tv.keyboard.press("ArrowUp");
    await tv.keyboard.press("Enter"); // OK on Close is the same as Back
    await expect(page).toHaveCount(0);
    await expect(tiles(tv).nth(1)).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(page).toBeVisible();

    await tv.keyboard.press("Escape");
    await expect(page).toHaveCount(0);
    await expect(tiles(tv).nth(1)).toBeFocused(); // back on the title it came from
    await expect(tv.getByTestId("tv-hero-title")).toHaveText("Film number 2");
  });

  test("a title is added to Favourites from its own page and taken out the same way", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await expect(tiles(tv).first()).toBeFocused();
    await tv.keyboard.press("Enter");
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-detail-list")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-detail-list")).toHaveText("Remove from Favourites");
    await expect(tv.getByTestId("tv-detail-list")).toHaveAttribute("aria-pressed", "true");
    await expect(tv.getByTestId("tv-detail")).toBeVisible(); // the page stays, to show it took

    await tv.keyboard.press("Escape");
    await expect(tv.getByRole("region", { name: "Favourites" }).getByTestId("tv-browse-tile")).toHaveCount(1); // Home has a row of it now

    await tv.getByTestId("rail-list").click();
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Favourites");
    await expect(tiles(tv)).toHaveCount(1);
    await tiles(tv).first().click(); // its page again, which now takes it out
    await expect(tv.getByTestId("tv-detail-list")).toHaveText("Remove from Favourites");
    await tv.getByTestId("tv-detail-list").click();
    await expect(tv.getByTestId("tv-detail-list")).toHaveText("Add to Favourites");
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-view-empty")).toContainText("Nothing here yet");
  });

  test("with one list a press saves a title in Favourites; with two the buttons ask which list, and Home has a row for each", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await expect(tiles(tv).first()).toBeFocused();

    // One list: the banner says its name, and a press puts the title in it.
    await expect(tv.getByTestId("tv-hero-list")).toHaveText("Favourites");
    await tv.getByTestId("tv-hero-list").click();
    await expect(tv.getByTestId("tv-hero-list")).toHaveAttribute("aria-pressed", "true");

    // A second list is made on the lists page, with the keys: its button, the name, OK.
    await tv.getByTestId("rail-list").click();
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Favourites");
    await expect(tiles(tv)).toHaveCount(1);
    await tv.getByTestId("list-new").click();
    await expect(tv.getByTestId("list-name-input")).toBeFocused();
    await tv.keyboard.type("Weekend");
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Weekend");
    await expect(tv.getByTestId("tv-view-empty")).toContainText("Nothing here yet");
    await expect(tv.locator('[data-testid^="list-chip-l"]')).toBeFocused(); // the remote is on the new list's button

    // Now the page of a title asks which list; a press on a list puts the title in it or takes it out, and Done closes the question.
    await tv.getByTestId("rail-home").click();
    await tv.locator('[data-testid="tv-browse-tile"][title="Film number 3"]').click();
    await expect(tv.getByTestId("tv-detail-list")).toHaveText("Add to a list");
    await tv.getByTestId("tv-detail-list").click();
    await expect(tv.getByTestId("tv-list-picker")).toBeVisible();
    await expect(tv.getByTestId("pick-favourites")).toBeFocused();
    await expect(tv.getByTestId("pick-favourites")).toHaveAttribute("aria-pressed", "false");
    await tv.keyboard.press("ArrowDown");
    await tv.keyboard.press("Enter");
    await expect(tv.locator('[data-testid^="pick-l"]')).toHaveAttribute("aria-pressed", "true");
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("pick-new")).toBeFocused(); // a way to make a list is the last of the lists
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("pick-done")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-list-picker")).toHaveCount(0);
    await expect(tv.getByTestId("tv-detail-list")).toBeFocused();
    await expect(tv.getByTestId("tv-detail-list")).toHaveText("In your lists");

    // Home has a row for each list; the lists page has a button for each, and keeps the one that was last shown.
    await tv.keyboard.press("Escape");
    await expect(tv.getByRole("region", { name: "Favourites" }).getByTestId("tv-browse-tile")).toHaveCount(1);
    await expect(tv.getByRole("region", { name: "Weekend" }).getByTestId("tv-browse-tile")).toHaveCount(1);
    await tv.getByTestId("rail-list").click();
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Weekend");
    await expect(tiles(tv)).toHaveAttribute("title", "Film number 3");
    await tv.getByTestId("list-chip-favourites").click();
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Favourites");
    await expect(tiles(tv)).toHaveAttribute("title", "Film number 1");
  });

  test("a list is renamed or deleted from its page, with the question before a delete; the first list can be renamed but not deleted", async ({ browser }) => {
    const now = Date.now();
    const seed = guestStorage({
      listNames: [{ key: "lweekend", at: now - 5000, name: "Weekend" }],
      list: [
        { key: "url:https://films.example/first", at: now - 4000, id: "k1", title: "Kept First", url: "https://films.example/first" },
        { key: "lweekend|url:https://films.example/second", at: now - 3000, list: "lweekend", id: "k2", title: "Kept Second", url: "https://films.example/second" },
      ],
    });
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    await tv.getByTestId("rail-list").click();
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Favourites");
    await expect(tv.locator('[data-zone="chips"]')).toHaveCount(4); // the two lists, New list, Edit list
    await tv.getByTestId("list-chip-lweekend").click();
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Weekend");
    await expect(tiles(tv)).toHaveAttribute("title", "Kept Second");

    // Renamed: OK in the name field saves it.
    await tv.getByTestId("list-edit").click();
    await expect(tv.getByTestId("list-name-input")).toHaveValue("Weekend");
    await tv.getByTestId("list-name-input").fill("Friday night");
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Friday night");
    await expect(tv.getByTestId("list-chip-lweekend")).toHaveText("Friday night");

    // Removed: the question lands the remote on the answer that keeps the list; the titles in it go with it.
    await tv.getByTestId("list-edit").click();
    await tv.getByTestId("list-delete").click();
    await expect(tv.getByTestId("list-delete-cancel")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("list-delete-confirm")).toHaveCount(0);
    await tv.getByTestId("list-delete").click();
    await tv.getByTestId("list-delete-confirm").click();
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Favourites");
    await expect(tv.getByTestId("list-chip-lweekend")).toHaveCount(0);
    await expect(tiles(tv)).toHaveAttribute("title", "Kept First");

    // The first list has no Delete, and takes another name: with one list left the banner says it.
    await tv.getByTestId("list-edit").click();
    await expect(tv.getByTestId("list-delete")).toHaveCount(0);
    await tv.getByTestId("list-name-input").fill("Watch later");
    await tv.getByTestId("list-save").click();
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Watch later");
    await tv.getByTestId("rail-home").click();
    await expect(tv.getByTestId("tv-hero-list")).toHaveText("Watch later");
  });

  test("a list is named with the keys on the page: the first letter is a capital, no double spaces, Delete and Clear, and no more than the name can hold", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await tv.getByTestId("rail-list").click();
    await tv.getByTestId("list-new").click();
    const field = tv.getByTestId("list-name-input");
    await expect(field).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await expect(tv.locator('[data-testid^="name-key-"]:focus')).toHaveCount(1); // Down from the field is on the keys

    const key = async (name: string) => {
      await tv.getByTestId(`name-key-${name}`).focus();
      await tv.keyboard.press("Enter");
    };
    await key("space"); // (no space to begin with)
    for (const letter of "date") await key(letter);
    await key("space");
    await key("space"); // (nor two in a row)
    await key("n");
    await key("2");
    await expect(field).toHaveValue("Date n2");
    await key("delete");
    await expect(field).toHaveValue("Date n");
    await key("clear");
    await expect(field).toHaveValue("");

    await field.fill("a".repeat(24));
    await key("b");
    await expect(field).toHaveValue("a".repeat(24));
    await key("clear");

    // A name the other list has already is said at once; another one saves.
    await tv.getByTestId("list-cancel").click();
    await expect(tv.getByTestId("tv-list-edit")).toHaveCount(0);
    await tv.getByTestId("list-new").click();
    for (const letter of "kids") await key(letter);
    await expect(field).toHaveValue("Kids");
    await tv.getByTestId("list-save").focus();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Kids");
  });

  test("the picker of a title has New list: the list is made with the title in it, and Back from the keys is the picker again", async ({ browser }) => {
    const seed = guestStorage({ listNames: [{ key: "lweekend", at: Date.now() - 5000, name: "Weekend" }] }); // two lists, so that the page of a title asks which
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    await tv.locator('[data-testid="tv-browse-tile"][title="Film number 3"]').click();
    await tv.getByTestId("tv-detail-list").click();
    await expect(tv.getByTestId("tv-list-picker")).toBeVisible();

    await tv.getByTestId("pick-new").click();
    await expect(tv.getByTestId("tv-list-edit")).toBeVisible();
    await expect(tv.getByTestId("list-name-input")).toBeFocused();
    await tv.keyboard.press("Escape"); // Back: nothing was made
    await expect(tv.getByTestId("tv-list-picker")).toBeVisible();
    await expect(tv.locator('[data-testid^="pick-l"]')).toHaveCount(1);

    await tv.getByTestId("pick-new").click();
    for (const letter of "kids") {
      await tv.getByTestId(`name-key-${letter}`).focus();
      await tv.keyboard.press("Enter");
    }
    await tv.getByTestId("list-save").focus();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-list-picker")).toBeVisible();
    await expect(tv.locator('[data-testid^="pick-l"]')).toHaveCount(2);
    await expect(tv.getByRole("button", { name: "Kids" })).toHaveAttribute("aria-pressed", "true"); // the title is in it
    await expect(tv.getByRole("button", { name: "Weekend" })).toHaveAttribute("aria-pressed", "false");
    await expect(tv.getByTestId("pick-done")).toBeFocused(); // the remote is on the answer
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-detail-list")).toHaveText("In your lists");
    await tv.keyboard.press("Escape");
    await expect(tv.getByRole("region", { name: "Kids" }).getByTestId("tv-browse-tile")).toHaveCount(1);
  });

  test("a list is moved one place earlier or later from its page, and never the first list; the buttons over the titles follow", async ({ browser }) => {
    const now = Date.now();
    const seed = guestStorage({
      listNames: [
        { key: "la", at: now - 5000, name: "Weekend" },
        { key: "lb", at: now - 4000, name: "Kids" },
        { key: "lc", at: now - 3000, name: "Date night" },
      ],
    });
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    await tv.getByTestId("rail-list").click();
    const chips = () => tv.locator('.tv-filters [role="radio"]').allTextContents();
    await expect.poll(chips).toEqual(["Favourites", "Weekend", "Kids", "Date night"]);

    await tv.getByTestId("list-edit").click(); // the first list stays first
    await expect(tv.getByTestId("list-move-earlier")).toHaveCount(0);
    await expect(tv.getByTestId("list-move-later")).toHaveCount(0);
    await tv.getByTestId("list-cancel").click();

    await tv.getByTestId("list-chip-lc").click();
    await tv.getByTestId("list-edit").click();
    await expect(tv.getByTestId("list-move-later")).toHaveAttribute("aria-disabled", "true"); // the last of them
    await expect(tv.getByTestId("list-move-earlier")).toHaveAttribute("aria-disabled", "false");
    await tv.getByTestId("list-move-earlier").focus();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("list-move-later")).toHaveAttribute("aria-disabled", "false");
    await expect(tv.getByTestId("list-move-earlier")).toBeFocused(); // the remote stays where it was, so another press goes on
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("list-move-earlier")).toHaveAttribute("aria-disabled", "true"); // the first of the others
    await expect(tv.getByTestId("list-move-earlier")).toBeFocused(); // (a button with nowhere to go is dimmed, not gone)
    await tv.keyboard.press("Enter"); // nothing happens
    await tv.getByTestId("list-cancel").click();

    await expect.poll(chips).toEqual(["Favourites", "Date night", "Weekend", "Kids"]);
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Date night"); // the one shown is still the one shown
    await expect(tv.getByTestId("list-edit")).toBeFocused();

    // The other way, and a new name keeps the place.
    await tv.getByTestId("list-edit").click();
    await tv.getByTestId("list-move-later").click();
    await tv.getByTestId("list-name-input").fill("Late night");
    await tv.getByTestId("list-save").click();
    await expect.poll(chips).toEqual(["Favourites", "Weekend", "Late night", "Kids"]);

    // It is where it was put after the page is opened again.
    await expect.poll(() => tv.evaluate(() => localStorage.getItem("kino.data.guest")?.includes("Late night"))).toBe(true); // (written a moment after the change)
    await tv.reload();
    await tv.getByTestId("rail-list").click();
    await expect.poll(chips).toEqual(["Favourites", "Weekend", "Late night", "Kids"]);
  });

  test("with one list besides the first there is nothing to put in another place", async ({ browser }) => {
    const seed = guestStorage({ listNames: [{ key: "la", at: Date.now() - 5000, name: "Weekend" }] });
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    await tv.getByTestId("rail-list").click();
    await tv.getByTestId("list-chip-la").click();
    await tv.getByTestId("list-edit").click();
    await expect(tv.getByTestId("list-name-input")).toHaveValue("Weekend");
    await expect(tv.getByTestId("list-move-earlier")).toHaveCount(0);
    await expect(tv.getByTestId("list-move-later")).toHaveCount(0);
  });

  test("as many lists as there can be stay on one line, and the arrow keys slide the buttons into view", async ({ browser }) => {
    const now = Date.now();
    const names = ["Weekend movies", "Date night", "Documentaries", "With the kids", "Rainy day", "Slow burns", "Comfort shows", "Foreign cinema", "Short films", "Rewatch", "Classics"];
    const seed = guestStorage({ listNames: names.map((name, i) => ({ key: `l${String(i).padStart(3, "0")}`, at: now - 10_000 + i, name })) });
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    await tv.getByTestId("rail-list").click();
    await expect(tv.locator('[data-zone="chips"]')).toHaveCount(13); // twelve lists and Edit list: no New list, twelve is the most

    const tops = await tv.locator(".tv-filters > *").evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1); // one line, not a stack of them pushing the titles off the screen

    await tv.getByTestId("list-chip-favourites").focus();
    for (let i = 0; i < 13; i++) await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("list-edit")).toBeFocused();
    const rightEdge = async () => {
      const edit = (await tv.getByTestId("list-edit").boundingBox())!;
      return edit.x + edit.width;
    };
    await expect.poll(rightEdge).toBeLessThanOrEqual(1280); // the last button has slid into view (it takes a moment)
  });

  test("a saved title that is part way through says Resume on its own page, wherever it is shown", async ({ browser }) => {
    const url = "https://films.example/night-train";
    const seed = guestStorage({
      progress: [{ key: `url:${url}`, at: Date.now() - 60_000, title: "Night Train", url, position: 1500, duration: 6000 }],
      list: [{ key: `url:${url}`, at: Date.now() - 30_000, id: "nt", title: "Night Train", url }],
    });
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    await tv.getByTestId("rail-list").click();
    await expect(tiles(tv)).toHaveCount(1);
    await tiles(tv).first().click();
    await expect(tv.getByTestId("tv-detail-title")).toHaveText("Night Train");
    await expect(tv.getByTestId("tv-detail-play")).toHaveText("Resume"); // not "Play" from the start, as if it had never been begun
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
    await expect(tv.getByTestId("tv-detail-list")).toHaveText("Remove from Favourites");

    await tv.keyboard.press("Escape");
    await expect(tv.locator("[data-testid='tv-browse-tile']:focus")).toHaveAttribute("title", "Second row first"); // back on the title it came from
    await expect(tv.getByRole("region", { name: "Favourites" }).getByTestId("tv-browse-tile")).toHaveCount(1);
  });

  test("a title that is part way through says Resume, and can be taken off its row from its page", async ({ browser }) => {
    const seed = guestStorage({ progress: [{ key: "url:https://films.example/night-train", at: Date.now() - 60_000, title: "Night Train", url: "https://films.example/night-train", position: 1500, duration: 6000 }] });
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    await expect(tiles(tv).first()).toHaveAttribute("title", "Night Train"); // Continue watching comes first
    await expect(tiles(tv).first()).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-detail-title")).toHaveText("Night Train");
    await expect(tv.getByTestId("tv-detail-play")).toHaveText("Resume");
    await expect(tv.getByTestId("tv-detail-list")).toHaveText("Add to Favourites");
    await expect(tv.getByTestId("tv-detail-remove")).toHaveText("Remove from Continue watching");

    await tv.keyboard.press("ArrowRight");
    await tv.keyboard.press("ArrowRight");
    await tv.keyboard.press("ArrowRight"); // (Play, the list, Rate, then this)
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

  test("the + in a title's corner keeps it in Favourites at once and the × lets it go, without opening the title or moving the remote", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await expect(tiles(tv).first()).toBeFocused();
    const favourites = tv.getByRole("region", { name: "Favourites" }).getByTestId("tv-browse-tile");
    const corner = (n: number) => tv.getByRole("region", { name: "Classics" }).getByTestId("tv-browse-tile").nth(n).getByTestId("tv-tile-corner");
    await expect(corner(1)).toHaveAttribute("data-corner", "add");
    await expect(corner(1)).toHaveAttribute("title", "Add to Favourites");

    await corner(1).click();
    await expect(corner(1)).toHaveAttribute("data-corner", "kept");
    await expect(corner(1)).toHaveAttribute("title", "Remove from Favourites");
    await expect(corner(2)).toHaveAttribute("data-corner", "add"); // that title only
    await expect(favourites).toHaveCount(1); // Home has a row of it now
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0); // the title was not opened
    await expect(tv.locator("[data-testid='tv-browse-tile']:focus")).toHaveAttribute("title", "Film number 1"); // nor did the remote move to it
    await expect(tv.getByTestId("tv-hero-title")).toHaveText("Film number 1");

    // The next one straight after, from the same row: that is what the button is for.
    await corner(3).click();
    await expect(favourites).toHaveCount(2);

    // The same button lets a kept title go.
    await corner(1).click();
    await expect(corner(1)).toHaveAttribute("data-corner", "add");
    await expect(favourites).toHaveCount(1);
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
  });

  test("a card of Continue watching is cleared by the × in its corner, and a title is let go from the list its row or page is, however many lists there are", async ({ browser }) => {
    const now = Date.now();
    const seed = guestStorage({
      progress: [{ key: "url:https://films.example/night-train", at: now - 60_000, title: "Night Train", url: "https://films.example/night-train", position: 1500, duration: 6000 }],
      listNames: [{ key: "lweekend", at: now - 5000, name: "Weekend" }],
      list: [
        { key: "url:https://films.example/first", at: now - 4000, id: "k1", title: "Kept First", url: "https://films.example/first" },
        { key: "lweekend|url:https://films.example/first", at: now - 3500, list: "lweekend", id: "k1", title: "Kept First", url: "https://films.example/first" },
        { key: "lweekend|url:https://films.example/second", at: now - 3000, list: "lweekend", id: "k2", title: "Kept Second", url: "https://films.example/second" },
      ],
    });
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    const row = (name: string) => tv.getByRole("region", { name }).getByTestId("tv-browse-tile");
    const cornerOf = (name: string, title: string) => tv.getByRole("region", { name }).locator(`[data-testid="tv-browse-tile"][title="${title}"]`).getByTestId("tv-tile-corner");

    // A card part way through: a grey ×, and the card goes (the banner moves on to the next title, and nothing is opened).
    await expect(cornerOf("Continue watching", "Night Train")).toHaveAttribute("data-corner", "clear");
    await expect(cornerOf("Continue watching", "Night Train")).toHaveAttribute("title", "Remove from Continue watching");
    await expect(tv.getByTestId("tv-hero-title")).toHaveText("Night Train");
    await cornerOf("Continue watching", "Night Train").click();
    await expect(tv.getByRole("region", { name: "Continue watching" })).toHaveCount(0);
    await expect(tv.getByTestId("tv-hero-title")).not.toHaveText("Night Train");
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);

    // With two lists a ＋ on the library's own rows still keeps a title in the first one, and a title in a list's row lets go of that list.
    await expect(cornerOf("Classics", "Film number 5")).toHaveAttribute("title", "Add to Favourites");
    await cornerOf("Classics", "Film number 5").click();
    await expect(row("Favourites")).toHaveCount(2);
    await expect(cornerOf("Weekend", "Kept First")).toHaveAttribute("title", "Remove from Weekend");
    await cornerOf("Weekend", "Kept First").click();
    await expect(row("Weekend")).toHaveCount(1);
    await expect(row("Favourites")).toHaveCount(2); // still in the first list

    // The lists page: the × lets go of the list that is shown, and only of that one.
    await tv.getByTestId("rail-list").click();
    await tv.getByTestId("list-chip-lweekend").click();
    await expect(tiles(tv)).toHaveCount(1);
    await expect(tiles(tv).first().getByTestId("tv-tile-corner")).toHaveAttribute("title", "Remove from Weekend");
    await tiles(tv).first().getByTestId("tv-tile-corner").click();
    await expect(tv.getByTestId("tv-view-empty")).toContainText("Nothing here yet");
    await tv.getByTestId("list-chip-favourites").click();
    await expect(tiles(tv)).toHaveCount(2);
    await expect(tiles(tv).first().getByTestId("tv-tile-corner")).toHaveAttribute("title", "Remove from Favourites");
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

test.describe("a show's own page on the TV", () => {
  const link = (episode: number, season = 1) => `https://shows.example/watch/7?s=${season}&e=${episode}`;
  const show = { id: "show-7", title: "The Long Night", year: 2019, kind: "series", url: link(1), description: "A show about a very long night." };
  const library = {
    updatedAt: Date.now(),
    rows: [
      { id: "s", title: "Shows", source: "Test Source", kind: "series", items: [show] },
      { id: "m", title: "Films", source: "Test Source", kind: "movie", items: [{ id: "f", title: "A film", kind: "movie", url: "/fixtures/sample.mp4" }] },
    ],
  };
  /** The library with one show: `seasons` of three episodes each, whose episodes are fixture pages (the first plays, the second has no video). */
  const withShow =
    (baseURL: string, seasons: number[] | "unknown" = [1, 2]) =>
    async (context: BrowserContext): Promise<void> => {
      await withLibrary(library)(context);
      await context.route(/\/api\/library\/seasons/, (route) => route.fulfill({ json: { seasons: seasons === "unknown" ? [] : seasons } }));
      await context.route(/\/api\/library\/episodes/, (route) => {
        const season = Number(new URL(route.request().url()).searchParams.get("season"));
        const names = ["Pilot", "The Long Night", "The Third Day"];
        const pages = ["video", "none", "hls"];
        return route.fulfill({
          json: { episodes: names.map((name, i) => ({ season, episode: i + 1, title: season === 1 ? name : `${name} again`, runtime: 40, url: `${baseURL}/fixtures/pages/${pages[i]}.html` })) },
        });
      });
    };
  const tiles = (tv: Page) => tv.getByTestId("tv-browse-tile");
  const episodes = (tv: Page) => tv.getByTestId("tv-episode");

  test("its seasons and episodes lie under its buttons, and Play says which episode it starts", async ({ browser, baseURL }) => {
    const tv = await openLibrary(browser, withShow(baseURL!));
    await expect(tiles(tv).first()).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-detail-title")).toHaveText("The Long Night");
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused();
    await expect(tv.getByTestId("tv-detail-play")).toHaveText("Play S1:E1");
    await expect(tv.getByTestId("tv-episodes")).toBeVisible();
    await expect(tv.getByTestId("tv-season-1")).toHaveAttribute("aria-checked", "true");
    await expect(tv.getByTestId("tv-season-2")).toHaveAttribute("aria-checked", "false");
    await expect(episodes(tv)).toHaveCount(3);
    await expect(episodes(tv).first()).toContainText("Pilot");
    await expect(episodes(tv).first()).toContainText("40 min");
    await expect(episodes(tv).first()).toHaveAttribute("data-target", "true"); // what Play starts
    await expect(episodes(tv).nth(1)).toHaveAttribute("data-target", "false");
  });

  test("the arrow keys go from the buttons to the seasons to the episodes, and back; Close is above all of it", async ({ browser, baseURL }) => {
    const tv = await openLibrary(browser, withShow(baseURL!));
    await expect(tiles(tv).first()).toBeFocused(); // (the keys act on what the screen has by now: OK before the library is there leads nowhere)
    await tv.keyboard.press("Enter");
    await expect(episodes(tv)).toHaveCount(3); // (and the arrow keys walk what is on the page: they wait for the seasons and episodes to be listed)
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused();

    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("tv-season-1")).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-season-2")).toBeFocused();
    await tv.keyboard.press("Enter"); // the episodes change, and the remote stays on the season
    await expect(tv.getByTestId("tv-season-2")).toHaveAttribute("aria-checked", "true");
    await expect(tv.getByTestId("tv-season-2")).toBeFocused();
    await expect(episodes(tv).first()).toContainText("Pilot again");
    await expect(episodes(tv).first()).toHaveAttribute("data-target", "false"); // Play is for season 1

    await tv.keyboard.press("ArrowDown");
    await expect(episodes(tv).first()).toBeFocused(); // no episode of this season is the one Play starts: the first
    await tv.keyboard.press("ArrowDown");
    await expect(episodes(tv).nth(1)).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await tv.keyboard.press("ArrowDown"); // the last stays
    await expect(episodes(tv).nth(2)).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await tv.keyboard.press("ArrowLeft"); // sideways leads nowhere from an episode
    await expect(episodes(tv).nth(2)).toBeFocused();

    await tv.keyboard.press("ArrowUp");
    await tv.keyboard.press("ArrowUp");
    await tv.keyboard.press("ArrowUp");
    await expect(tv.getByTestId("tv-season-2")).toBeFocused(); // up to the season that is shown, not the first one
    await tv.keyboard.press("ArrowUp");
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused();
    await expect(tv.getByTestId("tv-detail-title")).toBeInViewport(); // the page came back up to its buttons
    await tv.keyboard.press("ArrowUp");
    await expect(tv.getByTestId("tv-detail-close")).toBeFocused();
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
    await expect(tiles(tv).first()).toBeFocused();

    await tv.keyboard.press("Enter"); // opened again, it is at the season Play is for, not the one that was browsed before
    await expect(tv.getByTestId("tv-season-1")).toHaveAttribute("aria-checked", "true");
  });

  test("OK on an episode plays it, and one with no video says so on the page, which is still there to pick another from", async ({ browser, baseURL }) => {
    const tv = await openLibrary(browser, withShow(baseURL!));
    await expect(tiles(tv).first()).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(episodes(tv)).toHaveCount(3); // (the arrow keys walk what is on the page: they wait for the seasons and episodes to be listed)
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await tv.keyboard.press("ArrowRight");
    await tv.keyboard.press("Enter"); // season 2
    await expect(tv.getByTestId("tv-season-2")).toHaveAttribute("aria-checked", "true");
    await expect(episodes(tv).first()).toContainText("Pilot again");
    await tv.keyboard.press("ArrowDown");
    await expect(episodes(tv).first()).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await expect(episodes(tv).nth(1)).toBeFocused();
    await tv.keyboard.press("Enter"); // the second episode's page has no video
    await expect(tv.getByTestId("tv-notice")).toBeVisible({ timeout: 15_000 });
    await expect(tv.getByTestId("tv-detail")).toBeVisible(); // not a library with the show's tile: the page, to pick again
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused();
    await expect(tv.getByTestId("tv-season-2")).toHaveAttribute("aria-checked", "true"); // on the season that was being looked at
    await expect(tv.getByTestId("tv-notice")).toHaveCount(1); // (one line, and it is on the page)

    await episodes(tv).first().click(); // the first one plays
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
  });

  test("Back from an episode comes back to the show's page, on the season it was in", async ({ browser, baseURL }) => {
    const here = `${baseURL}/fixtures/pages/video.html`;
    const tv = await openLibrary(browser, async (context) => {
      await withLibrary({ ...library, rows: [{ id: "s", title: "Shows", source: "Test Source", kind: "series", items: [{ ...show, url: `${here}?s=1&e=1` }] }] })(context);
      await context.route(/\/api\/library\/seasons/, (route) => route.fulfill({ json: { seasons: [1, 2] } }));
      await context.route(/\/api\/library\/episodes/, (route) => {
        const season = Number(new URL(route.request().url()).searchParams.get("season"));
        return route.fulfill({ json: { episodes: [1, 2, 3].map((n) => ({ season, episode: n, title: `Part ${n}`, url: `${here}?s=${season}&e=${n}` })) } });
      });
    });
    await expect(tiles(tv).first()).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(episodes(tv)).toHaveCount(3);
    await tv.keyboard.press("ArrowDown");
    await tv.keyboard.press("ArrowRight");
    await tv.keyboard.press("Enter"); // season 2
    await expect(tv.getByTestId("tv-season-2")).toHaveAttribute("aria-checked", "true");
    await episodes(tv).nth(1).click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    await tv.mouse.move(400, 300); // (wakes the controls)
    await tv.getByTestId("tv-stop-btn").click();

    await expect(tv.getByTestId("tv-detail")).toBeVisible(); // where the next episode is picked
    await expect(tv.getByTestId("tv-detail-title")).toHaveText("The Long Night");
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused();
    await expect(tv.getByTestId("tv-season-2")).toHaveAttribute("aria-checked", "true"); // the season it was in
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
    await expect(tv.locator('[data-testid="tv-browse-tile"][title="The Long Night"]').first()).toBeFocused(); // and Back from the page is the library, on the show it came from (the row of what was just watched is above it now)
  });

  test("a show part way through says Resume with its episode, shows that season, and lands on that episode", async ({ browser, baseURL }) => {
    const seed = guestStorage({
      progress: [{ key: "show:The Long Night", at: Date.now() - 60_000, title: "The Long Night", url: link(2, 2), position: 600, duration: 2400, season: 2, episode: 2 }],
      watched: [
        { key: "The Long Night|2x1", at: Date.now() - 120_000, show: "The Long Night", season: 2, episode: 1, position: 2390, duration: 2400, done: true },
        { key: "The Long Night|2x2", at: Date.now() - 60_000, show: "The Long Night", season: 2, episode: 2, position: 600, duration: 2400, done: false },
      ],
    });
    const tv = await openLibrary(browser, withShow(baseURL!), undefined, seed);
    await tv.getByTestId("rail-series").click();
    await tiles(tv).nth(1).focus(); // (the first is Continue watching's card of the same show; this is the library's own)
    await expect(tv.getByTestId("tv-hero-title")).toHaveText("The Long Night");
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-detail-play")).toHaveText("Resume S2:E2");
    await expect(tv.getByTestId("tv-season-2")).toHaveAttribute("aria-checked", "true"); // where the profile is, not season 1
    await expect(episodes(tv).first()).toContainText("Watched");
    await expect(episodes(tv).nth(1)).toContainText("30 min left");
    await expect(episodes(tv).nth(1)).toHaveAttribute("data-target", "true");

    await tv.keyboard.press("ArrowDown");
    await tv.keyboard.press("ArrowDown");
    await expect(episodes(tv).nth(1)).toBeFocused(); // on the one Play starts, not the first of the season
  });

  test("the episode after a finished one is where Play leads, from its start", async ({ browser, baseURL }) => {
    const seed = guestStorage({ progress: [{ key: "show:The Long Night", at: Date.now() - 60_000, title: "The Long Night", url: link(3), position: 0, duration: 0, season: 1, episode: 3 }] });
    const tv = await openLibrary(browser, withShow(baseURL!), undefined, seed);
    await tv.getByTestId("rail-series").click();
    await tiles(tv).nth(1).focus();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-detail-play")).toHaveText("Play S1:E3"); // up next: not "Resume", nothing was begun of it
    await expect(episodes(tv).nth(2)).toHaveAttribute("data-target", "true");
  });

  test("a show with one season lists its episodes without a row of seasons, and Play is there when the episodes cannot be listed", async ({ browser, baseURL }) => {
    const one = await openLibrary(browser, withShow(baseURL!, [1]));
    await expect(tiles(one).first()).toBeFocused();
    await one.keyboard.press("Enter");
    await expect(episodes(one)).toHaveCount(3);
    await expect(one.getByTestId("tv-season-1")).toHaveCount(0);
    await one.keyboard.press("ArrowDown");
    await expect(episodes(one).first()).toBeFocused(); // straight from the buttons to the episodes

    const none = await openLibrary(browser, withShow(baseURL!, "unknown"));
    await expect(tiles(none).first()).toBeFocused();
    await none.keyboard.press("Enter");
    await expect(none.getByTestId("tv-detail-play")).toHaveText("Play S1:E1");
    await expect(none.getByTestId("tv-episodes-note")).toHaveText("The episodes can't be listed right now.");
    await none.keyboard.press("ArrowDown");
    await expect(none.getByTestId("tv-detail-play")).toBeFocused(); // nothing to walk down to
  });

  test("a title that may be a show is asked about, and one the library calls a film is not", async ({ browser, baseURL }) => {
    const asked: string[] = [];
    const tv = await openLibrary(browser, async (context) => {
      await withShow(baseURL!)(context);
      await context.route(/\/api\/library\/seasons/, (route) => {
        asked.push(new URL(route.request().url()).searchParams.get("url")!);
        return route.fulfill({ json: { seasons: [1] } });
      });
    });
    await tv.getByTestId("rail-movies").click();
    await tiles(tv).first().focus();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-detail-title")).toHaveText("A film");
    await expect(tv.getByTestId("tv-episodes")).toHaveCount(0);
    expect(asked).toEqual([]);
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
    await expect(tv.getByTestId("tv-category-tile").first().getByTestId("tv-tile-corner")).toHaveCount(0); // a category is no title to keep
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-category")).toBeVisible();
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Action");
  });

  test("History is everything watched, newest first and the finished ones marked; Favourites is what was saved", async ({ browser }) => {
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
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Favourites");
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
    await expect(tv.getByTestId("tv-view-empty")).toContainText("Nothing here yet");
    await expect(rail(tv)).toHaveAttribute("data-open", "false");
    await expect(tv.getByTestId("list-chip-favourites")).toBeFocused(); // an empty list still has its buttons: that is where the remote goes
    await tv.keyboard.press("Escape"); // Back is home
    await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "home");
  });

  for (const shape of [
    { where: "on a TV", viewport: { width: 1280, height: 720 } },
    { where: "at a phone's width", viewport: { width: 390, height: 844 } },
  ]) {
    test(`the entry the remote is on is a square around its icon, in the middle of the closed menu, and holds its icon when the menu is open: ${shape.where}`, async ({ browser }) => {
      const tv = await openLibrary(browser, withLibrary(library), shape.viewport);
      await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
      await choose(tv, "rail-history"); // nothing watched: the menu shuts with the remote still on this entry

      /** Where the entry, its icon and the menu lie from left to right. */
      const across = () =>
        tv.evaluate(() => {
          const entry = document.querySelector('[data-testid="rail-history"]')!;
          const strip = document.querySelector('[data-testid="tv-rail"]')!.getBoundingClientRect();
          const box = entry.getBoundingClientRect();
          const icon = entry.querySelector("svg")!.getBoundingClientRect();
          return { strip: [strip.left, strip.right], box: [box.left, box.right], icon: [icon.left, icon.right] };
        });
      const middle = ([from, to]: number[]) => (from! + to!) / 2;

      await expect(rail(tv)).toHaveAttribute("data-open", "false");
      await expect(tv.getByTestId("rail-history")).toBeFocused();
      // (the box takes a moment to settle: it narrows as the menu closes)
      await expect
        .poll(async () => {
          const { strip, box, icon } = await across();
          return {
            iconInsideBox: icon[0]! >= box[0]! && icon[1]! <= box[1]!,
            iconInMiddleOfBox: Math.abs(middle(icon) - middle(box)) <= 1,
            boxInMiddleOfMenu: Math.abs(middle(box) - middle(strip)) <= 1,
          };
        })
        .toEqual({ iconInsideBox: true, iconInMiddleOfBox: true, boxInMiddleOfMenu: true });

      await tv.keyboard.press("ArrowUp"); // brings the menu back, on the entry above
      await tv.keyboard.press("ArrowDown");
      await expect(rail(tv)).toHaveAttribute("data-open", "true");
      await expect(tv.getByTestId("rail-history")).toBeFocused();
      await expect
        .poll(async () => {
          const { strip, box, icon } = await across();
          return { iconInsideBox: icon[0]! >= box[0]! && icon[1]! <= box[1]!, boxInsideMenu: box[0]! >= strip[0]! && box[1]! <= strip[1]! };
        })
        .toEqual({ iconInsideBox: true, boxInsideMenu: true });
    });
  }

  test("clicking the lists or History shuts the menu, whether or not they have anything in them", async ({ browser }) => {
    const seed = guestStorage({ list: [{ key: "url:https://films.example/saved", at: Date.now() - 1000, id: "s1", title: "Saved For Later", url: "https://films.example/saved" }] });
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);

    await tv.getByTestId("rail-history").click(); // nothing watched: an empty page
    await expect(tv.getByTestId("tv-view-empty")).toHaveText("Nothing watched yet.");
    await expect(rail(tv)).toHaveAttribute("data-open", "false");

    await tv.getByTestId("rail-list").click(); // one title saved
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Favourites");
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
    for (const entry of ["rail-home", "rail-movies", "rail-series", "rail-list", "rail-history", "rail-ratings", "rail-party", "rail-connect", "rail-settings", "rail-category-r1"]) {
      await tv.keyboard.press("ArrowDown");
      await expect(tv.getByTestId(entry)).toBeFocused();
    }
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-rail")).toHaveAttribute("data-open", "false");
    await expect(tiles(tv).first()).toBeFocused();
  });

  test("a mouse resting on the menu opens it, with no button held; leaving shuts it again, and a click goes to the page and shuts it", async ({ browser }) => {
    const tv = await open(browser);
    const rail = tv.getByTestId("tv-rail");
    await expect(rail).toHaveAttribute("data-open", "false");

    await tv.mouse.move(30, 300); // onto the strip, and nothing pressed
    await expect(rail).toHaveAttribute("data-open", "true");
    await expect(tv.getByTestId("rail-movies").locator("span")).toHaveCSS("opacity", "1"); // the names are showing
    await tv.mouse.move(700, 300); // off it
    await expect(rail).toHaveAttribute("data-open", "false");

    await tv.mouse.move(30, 300);
    await expect(rail).toHaveAttribute("data-open", "true");
    await tv.getByTestId("rail-search").click(); // pressing a line is pressing what it says
    await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "search");
    await expect(rail).toHaveAttribute("data-open", "false"); // the page is open, so the menu is out of the way though the pointer has not moved

    await tv.mouse.move(700, 300);
    await tv.mouse.move(30, 300); // out and back
    await expect(rail).toHaveAttribute("data-open", "true");
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

    // Under the letters: Space, Delete and Clear, which empties the box in one press instead of a Delete for each letter.
    for (let i = 0; i < 4; i++) await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("key-space")).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("key-delete")).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("key-clear")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-query")).toHaveText("Search titles");
    await expect(tv.getByTestId("tv-search-status")).toHaveText("Type a title to search.");
    await expect(tv.getByTestId("key-clear")).toBeFocused(); // and it stays under the remote
  });

  test("search: a title is found with a slip of the fingers, an unfinished word or its spaces left out, before the server has answered", async ({ browser }) => {
    asked.length = 0;
    const tv = await open(browser);
    await choose(tv, "rail-search");
    await tv.keyboard.type("secnd row frist"); // a letter missing, two letters swapped
    await expect(tiles(tv)).toHaveCount(1);
    await expect(tiles(tv).first()).toHaveAttribute("title", "Second row first");
    await expect.poll(() => asked.at(-1)).toBe("secnd row frist"); // the server was asked as typed, and had nothing: the title stays
    await expect(tiles(tv)).toHaveCount(1);

    for (let i = 0; i < 15; i++) await tv.keyboard.press("Backspace");
    await tv.keyboard.type("secondrowsec"); // no spaces, and the last word not finished
    await expect(tiles(tv)).toHaveCount(1);
    await expect(tiles(tv).first()).toHaveAttribute("title", "Second row second");
  });

  test("search: a short word brings a long list, the likeliest titles first (what the screen has and what the server knows together), and it scrolls to its end", async ({ browser }) => {
    const rows = [{ id: "r1", title: "Classics", source: "Test Source", items: [{ id: "w", title: "Welcome to the Boondocks", url: "/fixtures/sample.mp4?w=1" }, { id: "n", title: "Boonie Bears", url: "/fixtures/sample.mp4?n=1" }] }];
    const server = [
      { id: "far", title: "Baboon", url: "/fixtures/sample.mp4?far=1" }, // (the word is inside another)
      ...Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, title: `Zed ${i + 1} Boone Story`, url: `/fixtures/sample.mp4?s=${i}` })), // (a word of the title begins with it)
      { id: "d", title: "The Boondocks", url: "/fixtures/sample.mp4?d=1" }, // (the title begins with it)
      { id: "b", title: "Boon", url: "/fixtures/sample.mp4?b=1" }, // (it is the title)
    ];
    const tv = await open(browser, withLibrary({ updatedAt: Date.now(), rows }, (query) => (query.includes("boon") ? server : [])));
    await choose(tv, "rail-search");
    await tv.keyboard.type("boon");
    await expect(tv.getByTestId("tv-search-status")).toContainText("45 titles for “boon”");
    const titles = await tiles(tv).evaluateAll((all) => all.map((tile) => tile.getAttribute("title")));
    expect(titles.slice(0, 4)).toEqual(["Boon", "Boonie Bears", "The Boondocks", "Welcome to the Boondocks"]);
    expect(titles.at(-1)).toBe("Baboon");

    await tiles(tv).last().scrollIntoViewIfNeeded();
    await expect(tiles(tv).last()).toBeInViewport();
  });

  test("the rows are named in the language of the screen: on the home page, in the menu and on a category's page", async ({ browser }) => {
    const rows = [
      { id: "filmpire-trending-movies", title: "Trending Movies", source: "Filmpire", kind: "movie", items: films },
      { id: "filmpire-comedy-movies", title: "Comedy Movies", source: "Filmpire", kind: "movie", items: films.slice(0, 5) },
      { id: "elsewhere-picks", title: "Staff Picks", source: "Elsewhere", kind: "movie", items: films.slice(0, 3) },
    ];
    const tv = await openDevice(browser, { viewport: { width: 1280, height: 720 }, locale: "ro-RO" }, {}, withLibrary({ updatedAt: Date.now(), rows }));
    await tv.goto("/tv");
    await expect(tiles(tv).first()).toBeFocused();
    await expect(tv.locator(".tv-row-title")).toHaveText(["Filme în tendințe", "Filme de comedie", "Staff Picks"]);

    await choose(tv, "rail-category-filmpire-comedy-movies"); // (the menu names it the same way)
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Filme de comedie");
    await expect(tiles(tv)).toHaveCount(5);
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

  test("a search that cannot be reached says so instead of saying nothing matches, and asks again by itself", async ({ browser }) => {
    let reachable = false;
    const tv = await openLibrary(browser, async (context) => {
      await context.clock.install();
      await context.route("**/api/library", (route) => route.fulfill({ json: library }));
      await context.route(/\/api\/library\/search/, (route) =>
        reachable ? route.fulfill({ json: { items: [{ id: "srv", title: "Only On The Server", url: "/fixtures/sample.mp4" }] } }) : route.fulfill({ status: 503, body: "down" }),
      );
    });
    await expect(tiles(tv).first()).toBeFocused();
    await choose(tv, "rail-search");
    await tv.keyboard.type("server");
    await expect(tv.getByTestId("tv-search-status")).toHaveText(en["tv.searchFailed"]); // not "Nothing matches": it was never asked
    await expect(tiles(tv)).toHaveCount(0);

    reachable = true;
    await tv.clock.fastForward(5500);
    await expect(tiles(tv).first()).toHaveAttribute("title", "Only On The Server");
    await expect(tv.getByTestId("tv-search-status")).toHaveText("1 title for “server”");

    // With titles from the rows already on screen, the line says that it is only the rest that is missing.
    reachable = false;
    for (let i = 0; i < "server".length; i++) await tv.keyboard.press("Backspace");
    await tv.keyboard.type("film");
    await expect(tv.getByTestId("tv-search-status")).toContainText(en["tv.searchOffline"].trim());
    await expect(tiles(tv)).toHaveCount(10);
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

  test("a title whose video is not there is gone from the library once the server stops offering it, and the remote is on another title", async ({ browser, baseURL }) => {
    const dead = { id: "dead", title: "Dead Film", kind: "movie", url: `${baseURL}/fixtures/pages/none.html` };
    const alive = { id: "alive", title: "Alive Film", kind: "movie", url: "/fixtures/sample.mp4" };
    let offered = [dead, alive];
    const tv = await openLibrary(browser, (context) =>
      context.route("**/api/library", (route) => route.fulfill({ json: { updatedAt: Date.now(), rows: [{ id: "r", title: "Films", source: "S", kind: "movie", items: offered }] } })),
    );
    await expect(tv.getByTestId("tv-browse-tile")).toHaveCount(2);
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
    await tv.keyboard.press("Enter"); // its own page
    offered = [alive]; // (what the real server does once the video has not been found)
    await tv.keyboard.press("Enter"); // Play
    await expect(tv.getByTestId("tv-notice")).toBeVisible({ timeout: 15_000 });
    await expect(tv.getByTestId("tv-browse-tile")).toHaveCount(1);
    await expect(tv.getByTestId("tv-browse-tile")).toHaveAttribute("title", "Alive Film");
    await expect(tv.getByTestId("tv-browse-tile")).toBeFocused(); // not left on a button that is gone
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
    await expect(tv.getByTestId("end-similar")).toHaveCount(2); // they come from the server a moment after the card; Down before them has nothing to land on
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

  test("a next episode that will not play leaves the end card where it was, and says so", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const tv = await openTv(browser, undefined, guestStorage({ settings: [{ key: "autoplayNext", at: Date.now(), value: false }] }));
    const first = { season: 1, episode: 1, title: "Part 1", url: `${baseURL}/fixtures/pages/video.html` };
    const missing = { season: 1, episode: 2, title: "Part 2", url: `${baseURL}/fixtures/pages/none.html` }; // a page with no video in it
    const phone = await playToTheEnd(tv, baseURL!, {
      title: "Parts · S1 E1",
      stream: { url: "/fixtures/sample.mp4", type: "mp4" },
      series: { season: 1, episode: 1, episodes: [first, missing], next: missing },
    });
    const upNext = tv.getByTestId("netflix-upnext");
    await expect(upNext).toBeVisible({ timeout: 15_000 });
    await upNext.getByRole("button", { name: "Cancel" }).click();
    await expect(tv.getByTestId("end-next")).toBeFocused();
    await tv.keyboard.press("Enter");

    await expect(tv.getByTestId("tv-flash")).toContainText("wouldn't play", { timeout: 25_000 }); // not a frozen last frame with nothing said
    await expect(tv.getByTestId("tv-end")).toBeVisible();
    await expect(tv.getByTestId("end-next")).toBeFocused(); // so OK tries again or Left/Right goes elsewhere
    phone.close();
  });

  test("Up Next comes with fifteen seconds left of a long episode, its count waits while the picture is held, and winding back takes it away", async ({ browser, baseURL }) => {
    test.setTimeout(45_000);
    const tv = await openTv(browser);
    const episode = (n: number) => ({ season: 1, episode: n, title: `Part ${n}`, url: `${baseURL}/fixtures/pages/${n === 1 ? "video" : "hls"}.html` });
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    // (fixtures/long.mp4 is forty seconds: the card keeps away from anything of thirty or less, where the end is never far.)
    phone.cmd({ type: "LOAD", media: { title: "Parts · S1 E1", stream: { url: "/fixtures/long.mp4", type: "mp4" }, series: { season: 1, episode: 1, episodes: [episode(1), episode(2)], next: episode(2) } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    const seek = (to: number) => tv.evaluate((time) => void (document.querySelector("video")!.currentTime = time), to);
    const upNext = tv.getByTestId("netflix-upnext");
    const count = async () => Number((await upNext.locator("b").innerText()).replace("s", ""));
    await expect(upNext).toHaveCount(0); // a long way from the end

    await seek(24);
    phone.cmd({ type: "PLAY" });
    await expect(upNext).toBeVisible();
    phone.cmd({ type: "PAUSE" });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect(tv.getByTestId("tv-pause-card")).toHaveCount(0); // one card says what is happening, not two
    const held = await count();
    await tv.waitForTimeout(2500);
    expect(await count()).toBe(held); // it counts to the end of the episode, and the picture is not going there

    await seek(5); // wound back, and the card goes with the end, the pause card in its place
    await expect(upNext).toHaveCount(0);
    await expect(tv.getByTestId("tv-pause-card")).toBeVisible();

    await seek(34); // six seconds left: it never counts down from more than is left
    phone.cmd({ type: "PLAY" });
    await expect(upNext).toBeVisible();
    expect(await count()).toBeLessThanOrEqual(6);
    phone.close();
  });
});

test.describe("text on the TV is big enough to read from the sofa", () => {
  /** A TV is read from across the room, so its text is sized by the screen and not by a pixel: this is the share of the screen's width the smallest visible text has. */
  const smallest = (page: Page) =>
    page.evaluate(() => {
      let least: { share: number; text: string; element: string } | null = null;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim();
        const element = node.parentElement;
        if (!text || !element || element.closest("svg, #kino-debug")) continue; // (the number inside a skip icon is a drawing, not words)
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0 || box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth) continue;
        let seen = true;
        for (let up: Element | null = element; up; up = up.parentElement) {
          const style = getComputedStyle(up);
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) seen = false;
        }
        if (!seen) continue;
        const share = (parseFloat(getComputedStyle(element).fontSize) / innerWidth) * 100;
        if (!least || share < least.share) least = { share, text: text.slice(0, 30), element: `${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]}` };
      }
      return least;
    });
  const enough = async (page: Page, where: string) => {
    const least = await smallest(page);
    expect(least && least.share, `${where}: "${least?.text}" (${least?.element}) is smaller than the TV's smallest text`).toBeGreaterThanOrEqual(1.15);
  };

  const films = Array.from({ length: 8 }, (_, i) => ({
    id: `f${i}`,
    title: `Film number ${i + 1}`,
    year: 1930 + i,
    url: `/fixtures/sample.mp4?n=${i}`,
    description: "A longer note about the film, which the banner shows while it is selected.",
  }));
  const library = { updatedAt: Date.now(), rows: [{ id: "r1", title: "Classics", source: "Test Source", items: films }] };
  const series = (baseURL: string): NormalizedMedia => ({
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
        { season: 1, episode: 1, title: "A Pilot Episode", url: `${baseURL}/fixtures/pages/video.html` },
        { season: 1, episode: 2, title: "The Long Night", url: `${baseURL}/fixtures/pages/none.html` },
        { season: 1, episode: 3, title: "The Following Episode", url: `${baseURL}/fixtures/pages/hls.html` },
      ],
      next: { season: 1, episode: 3, title: "The Following Episode", url: `${baseURL}/fixtures/pages/hls.html` },
    },
  });

  test("the library, a title's page and the menu", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
    await enough(tv, "the library");
    await tv.keyboard.press("ArrowRight");
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-detail")).toBeVisible();
    await enough(tv, "a title's page");
    await tv.keyboard.press("Escape");
    await tv.getByTestId("rail-connect").click();
    await expect(tv.getByTestId("pairing-code")).toBeVisible();
    await enough(tv, "the page with the code");
  });

  test("the player's controls and its menus", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: series(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect(tv.getByTestId("tv-next-btn")).toBeVisible();
    await enough(tv, "the controls, paused");
    for (const button of ["tv-audio-sub-btn", "tv-episodes-btn", "tv-source-btn"]) {
      await tv.getByTestId(button).click();
      await expect(tv.locator(".tv-menu")).toBeVisible();
      await enough(tv, `the menu of ${button}`);
      await tv.keyboard.press("Escape");
      await expect(tv.locator(".tv-menu")).toHaveCount(0);
    }
    phone.close();
  });
});

test.describe("ratings on the TV", () => {
  /** Noon in October, the same day in any time zone (and a month whose short name is the same in every English). */
  const day = (date: number) => Date.UTC(2026, 9, date, 12);
  const RATED_TODAY = /^Rated \d{1,2} [A-Za-z]{3,4} \d{4}$/;
  const films = Array.from({ length: 6 }, (_, i) => ({ id: `f${i}`, title: `Film number ${i + 1}`, year: 1930 + i, kind: "movie", url: `/fixtures/sample.mp4?n=${i}` }));
  const library = { updatedAt: Date.now(), rows: [{ id: "r1", title: "Classics", source: "Test Source", kind: "movie", items: films }] };
  const link = (episode: number, season = 1) => `https://shows.example/watch/7?s=${season}&e=${episode}`;
  const show = { id: "show-7", title: "The Long Night", year: 2019, kind: "series", url: link(1), description: "A show about a very long night." };
  /** The library with one show of two seasons of three episodes. */
  const withShow = (baseURL: string) => async (context: BrowserContext) => {
    await withLibrary({ updatedAt: Date.now(), rows: [{ id: "s", title: "Shows", source: "Test Source", kind: "series", items: [show] }] })(context);
    await context.route(/\/api\/library\/seasons/, (route) => route.fulfill({ json: { seasons: [1, 2] } }));
    await context.route(/\/api\/library\/episodes/, (route) => {
      const season = Number(new URL(route.request().url()).searchParams.get("season"));
      return route.fulfill({ json: { episodes: [1, 2, 3].map((n) => ({ season, episode: n, title: `Part ${n}`, runtime: 40, url: `${baseURL}/fixtures/pages/video.html?s=${season}&e=${n}` })) } });
    });
  };
  const tiles = (tv: Page) => tv.getByTestId("tv-browse-tile");
  const facts = (tv: Page) => tv.getByTestId("rate-facts").locator("li");
  /** The score the remote is on, or the button of the page. */
  const onScreen = (tv: Page) => tv.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid ?? null);
  /** From the first title: its page, and the rating page over it. */
  async function openRating(tv: Page) {
    await expect(tiles(tv).first()).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused();
    await tv.keyboard.press("ArrowRight"); // the list
    await tv.keyboard.press("ArrowRight"); // Rate
    await expect(tv.getByTestId("tv-detail-rate")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-rate")).toBeVisible();
  }
  /** Left from the first title, then up or down the menu to an entry, and OK. */
  const choose = async (tv: Page, entry: string) => {
    await tv.keyboard.press("ArrowLeft");
    await expect(tv.getByTestId("tv-rail")).toHaveAttribute("data-open", "true");
    const order = await tv.getByTestId("tv-rail").locator("button").evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).dataset.testid));
    const focused = await onScreen(tv);
    const steps = order.indexOf(entry) - order.indexOf(focused!);
    expect(order).toContain(entry);
    for (let i = 0; i < Math.abs(steps); i++) await tv.keyboard.press(steps > 0 ? "ArrowDown" : "ArrowUp");
    await expect(tv.getByTestId(entry)).toBeFocused();
    await tv.keyboard.press("Enter");
  };

  test("Rate on a title's page opens the scores with the remote on 7; OK on a score is a rating, and Back goes back to the page, where the button says it", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await openRating(tv);
    await expect(tv.getByTestId("tv-rate-title")).toHaveText("Film number 1");
    await expect(tv.getByTestId("rate-score-7")).toBeFocused(); // a little above the middle
    await expect(tv.getByTestId("rate-score-7")).toHaveAttribute("aria-checked", "false");
    await expect(tv.getByTestId("rate-word")).toHaveText("Pick a score out of 10");
    await expect(tv.getByTestId("rate-note-button")).toBeDisabled(); // a note is for a score that is there
    await expect(tv.getByTestId("rate-remove")).toHaveCount(0);
    await expect(tv.getByTestId("rate-facts")).toHaveCount(0);
    await expect(tv.getByTestId("rate-scope-all")).toHaveCount(0); // (a film is not rated by season)

    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("rate-score-8")).toBeFocused();
    await tv.keyboard.press("Enter"); // that is all it takes
    await expect(tv.getByTestId("rate-score-8")).toHaveAttribute("aria-checked", "true");
    await expect(tv.getByTestId("rate-score-7")).toHaveAttribute("aria-checked", "false");
    await expect(tv.getByTestId("rate-word")).toHaveText("Very good");
    await expect(facts(tv)).toHaveText([RATED_TODAY]);
    await expect(tv.getByTestId("rate-note-button")).toBeEnabled();
    await expect(tv.getByTestId("rate-note-button")).toHaveText("Add a note");
    await expect(tv.getByTestId("rate-remove")).toBeVisible();

    for (let i = 0; i < 5; i++) await tv.keyboard.press("ArrowLeft");
    await expect(tv.getByTestId("rate-score-3")).toBeFocused();
    await tv.keyboard.press("Enter"); // another score replaces it
    await expect(tv.getByTestId("rate-word")).toHaveText("Very bad");
    await expect(tv.locator('[data-testid^="rate-score-"][aria-checked="true"]')).toHaveCount(1);

    await tv.keyboard.press("ArrowDown"); // from the scores to the buttons below them, and back up
    expect(["rate-note-button", "rate-remove", "rate-done"]).toContain(await onScreen(tv));
    await tv.keyboard.press("ArrowUp");
    expect(await onScreen(tv)).toMatch(/^rate-score-\d+$/);

    await tv.keyboard.press("Escape"); // Back: the page of the title, with the remote on the button it pressed
    await expect(tv.getByTestId("tv-rate")).toHaveCount(0);
    await expect(tv.getByTestId("tv-detail-rate")).toBeFocused();
    await expect(tv.getByTestId("tv-detail-rate")).toHaveText("3/10");
    await expect(tv.getByTestId("tv-detail-rate")).toBeVisible();

    await tv.keyboard.press("Enter"); // opened again, it starts on the score it has
    await expect(tv.getByTestId("rate-score-3")).toBeFocused();
    await expect(tv.getByTestId("rate-score-3")).toHaveAttribute("aria-checked", "true");
    await expect(tv.getByTestId("rate-word")).toHaveText("Very bad");
  });

  test("a mouse rates as well: a click on a score, Done, and the rating taken back with its button", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await tiles(tv).nth(2).click();
    await tv.getByTestId("tv-detail-rate").click();
    await expect(tv.getByTestId("tv-rate-title")).toHaveText("Film number 3");
    await tv.getByTestId("rate-score-9").click();
    await expect(tv.getByTestId("rate-word")).toHaveText("Great");
    await expect(tv.getByTestId("rate-score-9")).toHaveAttribute("aria-checked", "true");
    await tv.getByTestId("rate-done").click();
    await expect(tv.getByTestId("tv-rate")).toHaveCount(0);
    await expect(tv.getByTestId("tv-detail-rate")).toHaveText("9/10");

    await tv.getByTestId("tv-detail-rate").click();
    await tv.getByTestId("rate-remove").click(); // the remote lands on the scores, where the button was
    await expect(tv.getByTestId("rate-word")).toHaveText("Pick a score out of 10");
    await expect(tv.getByTestId("rate-remove")).toHaveCount(0);
    await expect(tv.getByTestId("rate-note-button")).toBeDisabled();
    await expect(tv.locator('[data-testid^="rate-score-"][aria-checked="true"]')).toHaveCount(0);
    expect(await onScreen(tv)).toMatch(/^rate-score-\d+$/);
    await tv.getByTestId("rate-done").click();
    await expect(tv.getByTestId("tv-detail-rate")).toHaveText("Rate");
  });

  test("a note is typed on the keys of a page of its own and kept; Back from there is the scores again, and an empty note takes it away", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await openRating(tv);
    await tv.keyboard.press("Enter"); // 7
    await expect(tv.getByTestId("rate-word")).toHaveText("Good");
    await tv.getByTestId("rate-note-button").focus();
    await tv.keyboard.press("Enter");

    const field = tv.getByTestId("rate-note-input");
    await expect(tv.getByTestId("tv-rate-note")).toBeVisible();
    await expect(tv.getByTestId("tv-rate")).toHaveCount(0);
    const key = async (name: string) => {
      await tv.getByTestId(`name-key-${name}`).focus();
      await tv.keyboard.press("Enter");
    };
    for (const letter of "good") await key(letter);
    await key("space");
    for (const letter of "one") await key(letter);
    await key("!");
    await expect(field).toHaveValue("Good one!"); // (the first letter is a capital, and the marks of a sentence are on the keys)
    await key("delete");
    await expect(field).toHaveValue("Good one");

    await tv.keyboard.press("Escape"); // Back: nothing was kept
    await expect(tv.getByTestId("tv-rate")).toBeVisible();
    await expect(tv.getByTestId("rate-note-text")).toHaveCount(0);

    await tv.getByTestId("rate-note-button").focus();
    await tv.keyboard.press("Enter");
    for (const letter of "fun") await key(letter);
    await key(".");
    await tv.getByTestId("rate-note-save").focus();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("rate-note-text")).toHaveText("Fun."); // (and it is shown under the score)
    await expect(tv.getByTestId("rate-note-button")).toHaveText("Edit note");
    await expect(facts(tv)).toHaveText([RATED_TODAY]); // a note does not make it rated again

    await tv.getByTestId("rate-note-button").focus();
    await tv.keyboard.press("Enter");
    await expect(field).toHaveValue("Fun."); // (what it says is what is edited)
    await key("clear");
    await tv.getByTestId("rate-note-save").focus();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("rate-note-text")).toHaveCount(0);
    await expect(tv.getByTestId("rate-note-button")).toHaveText("Add a note");
    await expect(tv.getByTestId("rate-word")).toHaveText("Good"); // the score is as it was

    // What is typed is what a note can hold: no more.
    await tv.getByTestId("rate-note-button").focus();
    await tv.keyboard.press("Enter");
    await field.fill("a".repeat(400));
    await key("b");
    await expect(field).toHaveValue("a".repeat(400));
  });

  test("the watching is told with the rating, from what the profile watched of the title", async ({ browser }) => {
    const url = "https://films.example/night-train";
    const seed = guestStorage({
      progress: [{ key: `url:${url}`, at: day(4), title: "Night Train", url, position: 3000, duration: 6000 }],
      list: [{ key: `url:${url}`, at: day(4), id: "nt", title: "Night Train", url }],
    });
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    await tv.getByTestId("rail-list").click();
    await tiles(tv).first().click();
    await expect(tv.getByTestId("tv-detail-title")).toHaveText("Night Train");
    await tv.getByTestId("tv-detail-rate").click();
    await tv.getByTestId("rate-score-8").click();
    await expect(facts(tv)).toHaveText([RATED_TODAY, "50% watched", "Last watched 4 Oct 2026"]);
  });

  test("a show is rated as a whole and season by season, each apart; the episodes seen of a season are counted", async ({ browser, baseURL }) => {
    const seen = (episode: number, season: number) => ({ key: `The Long Night|${season}x${episode}`, at: day(episode + (season - 1) * 3), show: "The Long Night", season, episode, position: 2400, duration: 2400, done: true });
    const tv = await openLibrary(browser, withShow(baseURL!), undefined, guestStorage({ watched: [seen(1, 1), seen(2, 1), seen(1, 2)] }));
    await expect(tiles(tv).first()).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-episode")).toHaveCount(3); // (the page lists the seasons before it is asked about them)
    await tv.getByTestId("tv-detail-rate").click();

    await expect(tv.getByTestId("tv-rate-title")).toHaveText("The Long Night");
    await expect(tv.getByTestId("rate-scope-all")).toHaveAttribute("aria-checked", "true");
    await expect(tv.getByTestId("rate-scope-1")).toHaveAttribute("aria-checked", "false");
    await expect(tv.getByTestId("rate-scope-2")).toHaveText("Season 2");
    await tv.getByTestId("rate-score-9").click();
    await expect(facts(tv)).toHaveText([RATED_TODAY, "3 episodes watched", "Last watched 4 Oct 2026"]);

    await tv.getByTestId("rate-scope-1").click(); // the season the page was showing: its size is known
    await expect(tv.getByTestId("tv-rate-title")).toHaveText("The Long Night · Season 1");
    await expect(tv.getByTestId("rate-word")).toHaveText("Pick a score out of 10"); // (not rated because the show is)
    await tv.getByTestId("rate-score-7").click();
    await expect(facts(tv)).toHaveText([RATED_TODAY, "2 of 3 episodes watched", "Last watched 2 Oct 2026"]);

    await tv.getByTestId("rate-scope-2").click(); // another season: the page does not know how many episodes it has
    await expect(tv.getByTestId("tv-rate-title")).toHaveText("The Long Night · Season 2");
    await expect(tv.getByTestId("rate-word")).toHaveText("Pick a score out of 10");
    await tv.getByTestId("rate-score-5").click();
    await expect(facts(tv)).toHaveText([RATED_TODAY, "1 episode watched", "Last watched 4 Oct 2026"]);

    await tv.getByTestId("rate-scope-all").click();
    await expect(tv.getByTestId("rate-score-9")).toHaveAttribute("aria-checked", "true"); // the show's own is as it was
    await tv.getByTestId("rate-scope-1").click();
    await tv.getByTestId("rate-remove").click(); // a season's rating taken back leaves the others
    await expect(tv.getByTestId("rate-word")).toHaveText("Pick a score out of 10");
    await tv.getByTestId("rate-scope-2").click();
    await expect(tv.getByTestId("rate-score-5")).toHaveAttribute("aria-checked", "true");

    await tv.getByTestId("rate-done").click();
    await expect(tv.getByTestId("tv-detail-rate")).toHaveText("9/10"); // the page's button is the show's
  });

  test("My ratings is a page in the menu: what was rated, newest first, with the score under each and the mean on top; OK on one opens its page", async ({ browser }) => {
    const rated = (n: number, score: number, date: number, extra: Record<string, unknown> = {}) => ({
      key: `rate:https://films.example/${n}`,
      at: day(date),
      title: `Rated ${n}`,
      url: `https://films.example/${n}`,
      score,
      ratedAt: day(date),
      ...extra,
    });
    const seed = guestStorage({ ratings: [rated(1, 6, 1), rated(2, 9, 5, { note: "Twice." }), rated(3, 8, 9, { season: 2, kind: "series", url: link(1), key: `rate:${link(1)}|s2`, title: "The Long Night" })] });
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    await expect(tiles(tv).first()).toBeFocused();
    await choose(tv, "rail-ratings");

    await expect(tv.getByTestId("rail-ratings")).toHaveAttribute("aria-current", "page");
    await expect(tv.getByTestId("tv-view-title")).toHaveText("My ratings");
    await expect(tv.getByTestId("tv-ratings")).toContainText("3 ratings · average 7.7");
    await expect(tiles(tv)).toHaveCount(3);
    expect(await tiles(tv).evaluateAll((all) => all.map((tile) => tile.getAttribute("title")))).toEqual(["The Long Night", "Rated 2", "Rated 1"]); // newest first
    await expect(tiles(tv).nth(0)).toContainText("Season 2 · 8/10");
    await expect(tiles(tv).nth(1)).toContainText("9/10");
    await expect(tiles(tv).nth(2)).toContainText("6/10");
    await expect(tiles(tv).first()).toBeFocused();

    await tv.keyboard.press("ArrowRight");
    await tv.keyboard.press("Enter"); // "Rated 2": its page, where the button has the score
    await expect(tv.getByTestId("tv-detail-title")).toHaveText("Rated 2");
    await expect(tv.getByTestId("tv-detail-rate")).toHaveText("9/10");
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-ratings")).toBeVisible();
    await expect(tiles(tv).nth(1)).toBeFocused();
  });

  test("with nothing rated the page says how to start", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await tv.getByTestId("rail-ratings").click();
    await expect(tv.getByTestId("tv-view-title")).toHaveText("My ratings");
    await expect(tv.getByTestId("tv-view-empty")).toHaveText("Nothing rated yet. Open a title and give it a score.");
    await expect(tv.getByTestId("tv-ratings")).toContainText("The titles and seasons you gave a score.");
  });

  test("the switch on the account page hides ratings from the menu and the pages, and what was rated is kept", async ({ browser }) => {
    const seed = guestStorage({ ratings: [{ key: "rate:https://films.example/1", at: day(2), title: "Rated 1", url: "https://films.example/1", score: 8, ratedAt: day(2) }] });
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    await expect(tv.getByTestId("rail-ratings")).toHaveCount(1);

    await tv.getByTestId("rail-settings").click(); // (a guest's settings are in the menu; the corner button is the way to sign in)
    const rate = tv.getByTestId("tv-ratings-switch");
    await expect(rate).toHaveAttribute("aria-checked", "true");
    await rate.click();
    await expect(rate).toHaveAttribute("aria-checked", "false");
    await tv.getByTestId("tv-account-back").click();
    await expect(tv.getByTestId("rail-ratings")).toHaveCount(0);
    await tiles(tv).first().click();
    await expect(tv.getByTestId("tv-detail")).toBeVisible();
    await expect(tv.getByTestId("tv-detail-rate")).toHaveCount(0);
    await tv.getByTestId("tv-detail-close").click();

    await tv.getByTestId("rail-settings").click();
    await tv.getByTestId("tv-ratings-switch").click();
    await expect(tv.getByTestId("tv-ratings-switch")).toHaveAttribute("aria-checked", "true");
    await tv.getByTestId("tv-account-back").click();
    await tv.getByTestId("rail-ratings").click();
    await expect(tiles(tv)).toHaveCount(1); // kept
    await expect(tiles(tv).first()).toContainText("8/10");
  });

  for (const screen of [
    { name: "720p", width: 1280, height: 720 },
    { name: "1080p", width: 1920, height: 1080 },
    { name: "4:3", width: 1024, height: 768 },
  ]) {
    test(`the account page, with the ratings switch among its settings, is all on the screen: ${screen.name}`, async ({ browser }) => {
      const tv = await openLibrary(browser, withLibrary(library), { width: screen.width, height: screen.height });
      await tv.getByTestId("rail-settings").click();
      await expect(tv.getByTestId("tv-ratings-switch")).toBeVisible();
      for (const id of ["tv-lang-en", "tv-autoplay", "tv-tap-to-pause", "tv-ratings-switch", "tv-account-back"]) {
        const at = (await tv.getByTestId(id).boundingBox())!;
        expect(at.x, `${id} from the left`).toBeGreaterThanOrEqual(0);
        expect(at.y, `${id} from the top`).toBeGreaterThanOrEqual(0);
        expect(at.x + at.width, `${id} to the right`).toBeLessThanOrEqual(screen.width + 0.5);
        expect(at.y + at.height, `${id} to the bottom`).toBeLessThanOrEqual(screen.height + 0.5);
      }
    });
  }

  test("Back from a page with ratings goes home, as from the other pages", async ({ browser }) => {
    const seed = guestStorage({ ratings: [{ key: "rate:https://films.example/1", at: day(2), title: "Rated 1", url: "https://films.example/1", score: 8, ratedAt: day(2) }] });
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    await tv.getByTestId("rail-ratings").click();
    await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "ratings");
    await expect(tiles(tv).first()).toBeFocused();
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "home");
  });

  for (const screen of [
    { name: "720p", width: 1280, height: 720 },
    { name: "1080p", width: 1920, height: 1080 },
    { name: "4:3", width: 1024, height: 768 },
    { name: "a small window", width: 800, height: 600 },
    { name: "a phone's width", width: 390, height: 844 },
  ]) {
    test(`the rating page fits the screen, with a show's seasons and a long note: ${screen.name}`, async ({ browser, baseURL }) => {
      const note = "Slow at first and long, but the last episode made up for all of it, and the people in it felt real the whole way through.";
      const ratings = [{ key: `rate:${link(1)}`, at: day(2), title: "The Long Night", url: link(1), kind: "series", score: 8, note, ratedAt: day(2), seen: 3, watchedAt: day(3) }];
      const tv = await openLibrary(browser, withShow(baseURL!), { width: screen.width, height: screen.height }, guestStorage({ ratings }));
      await expect(tiles(tv).first()).toBeFocused();
      await tv.keyboard.press("Enter");
      await expect(tv.getByTestId("tv-episode")).toHaveCount(3);
      await tv.getByTestId("tv-detail-rate").click();
      await expect(tv.getByTestId("rate-note-text")).toBeVisible();
      for (const id of ["tv-rate-title", "rate-scope-all", "rate-scope-2", "rate-score-1", "rate-score-10", "rate-word", "rate-note-text", "rate-facts", "rate-note-button", "rate-remove", "rate-done"]) {
        const at = await tv.getByTestId(id).boundingBox();
        expect(at, id).not.toBeNull();
        expect(at!.x, `${id} from the left`).toBeGreaterThanOrEqual(0);
        expect(at!.y, `${id} from the top`).toBeGreaterThanOrEqual(0);
        expect(at!.x + at!.width, `${id} to the right`).toBeLessThanOrEqual(screen.width + 0.5);
        expect(at!.y + at!.height, `${id} to the bottom`).toBeLessThanOrEqual(screen.height + 0.5);
      }
      expect(await tv.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      // The scores are one row of ten on a TV (and on a narrow screen, as many rows as it takes: two at the width of a phone), and each is as wide as it is tall.
      const scores = await tv.locator('[data-testid^="rate-score-"]').evaluateAll((all) => all.map((one) => one.getBoundingClientRect()));
      expect(scores).toHaveLength(10);
      expect(new Set(scores.map((rect) => Math.round(rect.top))).size, "the rows of scores").toBeLessThanOrEqual(screen.width >= 900 ? 1 : 2);
      for (const rect of scores) expect(Math.abs(rect.width - rect.height)).toBeLessThan(2);

      // And the note page, with its keys, fits too.
      await tv.getByTestId("rate-note-button").click();
      await expect(tv.getByTestId("rate-note-input")).toBeVisible();
      await expect(tv.getByTestId("rate-note-input")).toHaveValue(note);
      const done = await tv.getByTestId("rate-note-save").boundingBox();
      expect(done!.y + done!.height, "the note's Save").toBeLessThanOrEqual(screen.height + 0.5);
      expect(await tv.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
});
