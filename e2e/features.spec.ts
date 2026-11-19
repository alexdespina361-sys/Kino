import { chromium, expect, type Browser, type BrowserContext, type Locator, type Page, type WebSocketRoute } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import qrcode from "qrcode-generator";
import { MAX_LINK_LENGTH, progressKey, type NormalizedMedia } from "../src/shared";
import { en } from "../src/client/i18n/en";
import { it as italian } from "../src/client/i18n/it";
import { ro } from "../src/client/i18n/ro";
import { FIRST_VISIT, guestStorage, heldUpright, REMOTE_FIRST_VISIT, loadOnTv, openDevice, openLibrary, openPairedPhone, openTv, PHONE, place, playFirst, pressMenuLine, RawPhone, readPairingCode, serverDown, serverUp, sleepingServer, test, tvRoot, tvTime, twoSizes, withLibrary } from "./helpers";

const sample = (baseURL: string) => `${baseURL}/fixtures/sample.mp4`;

function seriesMedia(baseURL: string): NormalizedMedia {
  return {
    title: "The Long Night · S1 E2",
    stream: { url: "/fixtures/sample.mp4", type: "mp4" },
    subtitles: [
      { id: "en", label: "English", lang: "en", url: "/fixtures/sample.vtt" },
      { id: "nl", label: "Dutch", lang: "nl", url: "/fixtures/sample.vtt" },
    ],
    series: {
      season: 1,
      episode: 2,
      episodes: [
        { season: 1, episode: 1, title: "Pilot", url: `${baseURL}/fixtures/pages/video.html` },
        { season: 1, episode: 2, title: "The Long Night", url: `${baseURL}/fixtures/pages/none.html` },
        { season: 1, episode: 3, title: "Cold Open", url: `${baseURL}/fixtures/pages/hls.html` },
      ],
    },
  };
}

function writeQrVideo(text: string): string {
  const [width, height] = [640, 480];
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const modules = qr.getModuleCount();
  const quiet = 4;
  const scale = Math.floor(400 / (modules + quiet * 2));
  const side = (modules + quiet * 2) * scale;
  const left = (width - side) >> 1;
  const top = (height - side) >> 1;

  const luma = Buffer.alloc(width * height, 255);
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (!qr.isDark(row, col)) continue;
      for (let y = 0; y < scale; y++) {
        luma.fill(0, (top + (row + quiet) * scale + y) * width + left + (col + quiet) * scale, (top + (row + quiet) * scale + y) * width + left + (col + quiet + 1) * scale);
      }
    }
  }
  const chroma = Buffer.alloc((width * height) / 4, 128);
  const frame = Buffer.concat([Buffer.from("FRAME\n"), luma, chroma, chroma]);
  const file = join(mkdtempSync(join(tmpdir(), "kino-qr-")), "qr.y4m");
  writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H${height} F10:1 Ip A1:1 C420jpeg\n`), frame, frame, frame, frame, frame]));
  return file;
}

test.describe("one page", () => {
  const desktop = { viewport: { width: 1280, height: 720 } } as const;

  test("the same address is the TV on a screen without touch and the remote on a phone, and they pair", async ({ browser }) => {
    const tv = await (await browser.newContext(desktop)).newPage();
    await tv.goto("/");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(tv.getByTestId("unlock")).toHaveCount(0);
    await tv.getByTestId("rail-connect").click();

    const phone = await (await browser.newContext(PHONE)).newPage();
    await phone.goto("/");
    await phone.getByTestId("code-input").fill(await readPairingCode(tv));
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
  });

  test("/tv is the TV whatever the device, and ?role= picks a screen without remembering it", async ({ browser }) => {
    const touch = await (await browser.newContext(PHONE)).newPage();
    await touch.goto("/tv");
    await expect(touch.getByTestId("tv-browse")).toBeVisible();

    const wide = await (await browser.newContext(desktop)).newPage();
    await wide.goto("/?role=remote");
    await expect(wide.getByTestId("code-input")).toBeVisible();
    await wide.goto("/");
    await expect(wide.getByTestId("tv-browse")).toBeVisible();
  });

  test("a screen the page guessed wrong about can be switched from the page that shows the code, and stays switched", async ({ browser }) => {
    const page = await (await browser.newContext(desktop)).newPage();
    await page.goto("/");
    await page.getByTestId("rail-connect").click();
    await page.getByTestId("switch-to-remote").click();
    await expect(page.getByTestId("code-input")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("code-input")).toBeVisible();

    await page.getByTestId("switch-to-tv").click();
    await expect(page.getByTestId("tv-browse")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("tv-browse")).toBeVisible();
  });

  test("a paired remote can become a TV from its menu", async ({ browser }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.getByTestId("menu").click();
    await phone.getByTestId("switch-to-tv").click();
    await expect(phone.getByTestId("tv-browse")).toBeVisible();
  });
});

test.describe("pairing", () => {
  test("the TV shows a QR code, and opening its link connects the phone without typing", async ({ browser }) => {
    const tv = await openTv(browser);
    await expect(tv.getByTestId("pairing-qr")).toBeVisible();
    const phone = await (await browser.newContext(PHONE)).newPage();
    await phone.goto(`/?code=${await readPairingCode(tv)}`);
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await expect(tv.getByTestId("tv-paired")).toBeVisible();
    expect(phone.url()).not.toContain("code=");
  });

  test("the phone's camera reads the TV's QR code and connects", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const video = writeQrVideo(`${baseURL}/?code=${await readPairingCode(tv)}`);
    const withCamera = await chromium.launch({
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${video}`],
    });
    try {
      const context = await withCamera.newContext({ ...PHONE, baseURL, permissions: ["camera"] });
      const phone = await context.newPage();
      await phone.goto("/");
      await phone.getByTestId("scan").click();
      await expect(phone.getByTestId("scanner")).toBeVisible();
      await expect(phone.getByTestId("tv-online")).toHaveText("TV connected", { timeout: 20_000 });
      await expect(phone.getByTestId("scanner")).toHaveCount(0);
      await expect(tv.getByTestId("tv-paired")).toBeVisible();
    } finally {
      await withCamera.close();
    }
  });

  test("the camera can be closed without connecting, and a blocked camera says why", async ({ browser }) => {
    const phone = await (await browser.newContext(PHONE)).newPage();
    await phone.goto("/");
    await phone.getByTestId("scan").click();
    await expect(phone.getByTestId("scanner")).toBeVisible();
    await expect(phone.getByTestId("scanner-hint")).toHaveAttribute("role", "alert");
    await phone.getByTestId("scanner-close").click();
    await expect(phone.getByTestId("scanner")).toHaveCount(0);
    await expect(phone.getByTestId("code-input")).toBeVisible();
  });

  test("Disconnect sends the phone back to the code screen and gives the TV a fresh code", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.getByTestId("url-input").fill(sample(baseURL!));
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");

    await phone.getByTestId("menu").click();
    await phone.getByTestId("disconnect").click();

    await expect(phone.getByTestId("code-input")).toBeVisible();
    await expect(phone.getByTestId("error")).toHaveCount(0);
    await expect(phone.getByTestId("pair-notice")).toHaveCount(0);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle");
    const fresh = await readPairingCode(tv);
    await phone.getByTestId("code-input").fill(fresh);
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
  });

  test("the TV can disconnect while it waits for a video, using only the remote's keys", async ({ browser }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await expect(tv.getByTestId("tv-paired")).toBeVisible();
    const button = tv.getByTestId("tv-disconnect");
    const browse = tv.getByTestId("tv-back-to-library");
    await expect(button).not.toBeFocused();
    await expect(browse).not.toBeFocused();
    const order = await tv.evaluate(() => [...document.querySelectorAll<HTMLElement>(".tv-screen [data-nav]")].map((one) => one.dataset.testid));
    expect(order).toContain("tv-back-to-library");
    expect(order.indexOf("tv-back-to-library")).toBeLessThan(order.indexOf("tv-disconnect"));

    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("tv-join-code-copy")).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await expect(button).toBeFocused();
    await tv.keyboard.press("ArrowUp");
    await tv.keyboard.press("ArrowUp");
    await expect(browse).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await expect(button).toBeFocused();
    await expect(tv.getByTestId("tv-paired")).toBeVisible();
    await tv.keyboard.press("Enter");

    await expect(tv.getByTestId("pairing-code")).toBeVisible();
    await expect(phone.getByTestId("code-input")).toBeVisible();
    await expect(phone.getByTestId("pair-notice")).toHaveText("This phone is no longer connected to the TV. Enter the code on the TV to connect again.");
    await expect(phone.getByTestId("code-input")).toHaveValue("");
    await phone.getByTestId("code-input").fill(await readPairingCode(tv));
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await expect(tv.getByTestId("tv-paired")).toBeVisible();
  });
});

test.describe("a server that is slow to answer", () => {
  const WAKING = /waking up|se trezește|svegliando/i;

  test("the phone's first screen keeps saying it is reaching the server, never that one is waking up, and is back when the server answers", async ({ browser }) => {
    const phone = await openDevice(browser, PHONE, {}, sleepingServer());
    await phone.goto("/");
    await expect(phone.getByTestId("code-input")).toBeVisible();
    await expect(phone.getByText(en["pair.reaching"])).toBeVisible();

    await phone.clock.fastForward(10_500);
    await expect(phone.getByText(en["error.offline"])).toBeVisible();
    await expect(phone.getByText(WAKING)).toHaveCount(0);

    await serverUp(phone);
    await phone.clock.fastForward(10_500);
    await expect(phone.getByText(en["error.offline"])).toHaveCount(0);
    await phone.getByTestId("code-input").fill("000000");
    await expect(phone.getByTestId("error")).toBeVisible();
  });

  test("a paired remote that loses the server says Reconnecting in its header, and nothing more, and is back when it answers", async ({ browser }) => {
    const tv = await openTv(browser);
    const phone = await openDevice(browser, PHONE, {}, sleepingServer(true));
    await phone.goto("/");
    await phone.getByTestId("code-input").fill(await readPairingCode(tv));
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");

    await serverDown(phone);
    await expect(phone.getByTestId("tv-online")).toHaveText(en["phone.reconnecting"]);
    await phone.clock.fastForward(10_500);
    await expect(phone.getByTestId("tv-online")).toHaveText(en["phone.reconnecting"]);
    await expect(phone.getByText(WAKING)).toHaveCount(0);

    await serverUp(phone);
    await phone.clock.fastForward(10_500);
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
  });

  test("the TV's banner says nothing of a connection away for a moment (a server that restarts); away for ten seconds it says so in a word, and goes when the server answers", async ({ browser }) => {
    const tv = await openLibrary(browser, sleepingServer());
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await tv.clock.fastForward(8_000);
    await expect(tv.getByTestId("tv-banner"), "a moment is not said").toHaveCount(0);

    await tv.clock.fastForward(2_500);
    await expect(tv.getByTestId("tv-banner")).toHaveText(new RegExp(`^(${en["tv.connecting"]}|${en["tv.bannerReconnecting"]})$`));
    await expect(tv.getByText(WAKING)).toHaveCount(0);

    await serverUp(tv);
    await tv.clock.fastForward(10_500);
    await expect(tv.getByTestId("tv-banner")).toHaveCount(0);
  });

  test("a server that takes a connection and drops it again at once is asked back after longer and longer waits, not twice a second for as long as it does; one that said something is asked back at once", async ({ browser }) => {
    type Line = { __tries: number; __talks: boolean };
    const tv = await openDevice(browser, { viewport: { width: 1280, height: 720 } }, {}, async (context) => {
      await context.clock.install();
      await context.addInitScript(() => {
        const line = window as unknown as Line;
        line.__tries = 0;
        line.__talks = false;
        window.WebSocket = new Proxy(window.WebSocket, {
          construct() {
            line.__tries++;
            const stand: Record<string, unknown> = { readyState: 0, onopen: null, onmessage: null, onerror: null, onclose: null, send() {}, close() {} };
            queueMicrotask(() => {
              stand.readyState = 1;
              (stand.onopen as (() => void) | null)?.();
              if (line.__talks) (stand.onmessage as ((event: { data: string }) => void) | null)?.({ data: "{}" });
              stand.readyState = 3;
              (stand.onclose as ((event: { code: number }) => void) | null)?.({ code: 1006 });
            });
            return stand as unknown as WebSocket;
          },
        });
      });
    });
    const tries = () => tv.evaluate(() => (window as unknown as Line).__tries);
    const halfSecondsUntil = async (count: number) => {
      for (let steps = 1; steps <= 40; steps++) {
        await tv.clock.runFor(500);
        if ((await tries()) >= count) return steps;
      }
      return 40;
    };
    await tv.goto("/tv");
    expect(await halfSecondsUntil(5)).toBeGreaterThanOrEqual(8);

    await tv.evaluate(() => ((window as unknown as Line).__talks = true));
    expect(await halfSecondsUntil(7)).toBeLessThanOrEqual(14);
  });
});

test.describe("a screen whose script cannot be fetched", () => {
  const screens = [
    ["the TV's player", "Tv", "/tv", "tv-browse"],
    ["the phone's remote", "Controller", "/", "code-input"],
  ] as const;
  for (const [name, chunk, address, shown] of screens) {
    const device = async (browser: Browser, failing: () => boolean) => {
      let loads = 0;
      const page = await openDevice(browser, name === "the TV's player" ? { viewport: { width: 1280, height: 720 } } : PHONE, {}, async (context) => {
        await context.route(new RegExp(`/assets/${chunk}-[\\w-]+\\.js$`), (route) => (failing() ? route.abort() : route.continue()));
      });
      page.on("request", (request) => request.isNavigationRequest() && request.frame() === page.mainFrame() && loads++);
      return { page, loads: () => loads };
    };

    test(`${name} is started again by the page, once, when its script could not be fetched the first time`, async ({ browser }) => {
      let loads = () => 0;
      const screen = await device(browser, () => loads() === 1);
      loads = screen.loads;
      await screen.page.goto(address);
      await expect(screen.page.getByTestId(shown)).toBeVisible({ timeout: 20_000 });
      expect(screen.loads()).toBe(2);
      await expect(screen.page.getByTestId("screen-failed")).toHaveCount(0);
    });

    test(`${name} says so, with a button that tries again, and does not go round, when its script is not coming`, async ({ browser }) => {
      let coming = false;
      const screen = await device(browser, () => !coming);
      await screen.page.goto(address);
      await expect(screen.page.getByTestId("screen-failed")).toBeVisible({ timeout: 20_000 });
      await expect(screen.page.getByTestId("screen-failed")).toContainText(en["common.screenFailed"]);
      await screen.page.waitForTimeout(1500);
      expect(screen.loads()).toBe(2);
      coming = true;
      await screen.page.getByRole("button", { name: en["common.retry"] }).click();
      await expect(screen.page.getByTestId(shown)).toBeVisible({ timeout: 20_000 });
      await expect(screen.page.getByTestId("screen-failed")).toHaveCount(0);
    });

    test(`${name} that breaks for any other reason than a script that is missing says so at once, without starting the page again`, async ({ browser }) => {
      let loads = 0;
      const page = await openDevice(browser, name === "the TV's player" ? { viewport: { width: 1280, height: 720 } } : PHONE, {}, async (context) => {
        await context.route(new RegExp(`/assets/${chunk}-[\\w-]+\\.js$`), (route) => route.fulfill({ contentType: "text/javascript", body: 'throw new Error("a fault of the screen itself");' }));
      });
      page.on("request", (request) => request.isNavigationRequest() && request.frame() === page.mainFrame() && loads++);
      await page.goto(address);
      await expect(page.getByTestId("screen-failed")).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1500);
      expect(loads).toBe(1);
    });
  }

  test("a film that needs a script of the player which cannot be fetched is a card that says so after the page's one start again, not a screen that waits for ever", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    let loads = 0;
    const tv = await openDevice(browser, { viewport: { width: 1280, height: 720 } }, {}, async (context) => {
      await context.route(/\/assets\/hls-[\w-]+\.js$/, (route) => route.abort());
    });
    tv.on("request", (request) => request.isNavigationRequest() && request.frame() === tv.mainFrame() && loads++);
    await tv.goto("/tv");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await pressMenuLine(tv, "rail-connect");
    const phone = await openPairedPhone(browser, tv);
    await phone.getByTestId("url-input").fill(`${baseURL}/fixtures/hls/master.m3u8`);
    await phone.getByTestId("play-url").click();
    await expect(tv.getByTestId("tv-error")).toBeVisible({ timeout: 60_000 });
    expect(loads).toBe(2);
  });
});

test.describe("playing links", () => {
  test("a link that is too long for the server to read is said to be too long, not blamed on the server's version", async ({ browser }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.getByTestId("url-input").fill(`http://example.com/${"a".repeat(MAX_LINK_LENGTH)}`);
    await phone.getByTestId("play-url").click();
    await expect(phone.getByTestId("error")).toHaveText(en["phone.linkTooLong"]);
    await expect(phone.getByTestId("resolve-status")).toHaveCount(0);
    await phone.getByTestId("url-input").fill("http://example.com/short");
    await phone.getByTestId("play-url").click();
    await expect(phone.getByTestId("error")).toHaveCount(0);
    await expect(phone.getByTestId("resolve-status")).toBeVisible();
  });

  test("a link shared to the app (?url=) plays as soon as a TV is paired", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.goto(`/?url=${encodeURIComponent(sample(baseURL!))}`);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    expect(phone.url()).not.toContain("url=");
  });

  test("what was played is remembered, and can be played again", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.getByTestId("url-input").fill(sample(baseURL!));
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await phone.getByTestId("stop").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle");

    await phone.reload();
    await expect(phone.getByTestId("continue-item")).toHaveCount(1);
    await phone.getByTestId("continue-play").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
  });

  test("a saved position is where the TV resumes", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    await expect(tv.getByTestId("tv-paired")).toBeVisible();
    phone.playUrl(sample(baseURL!), 12);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", /playing|paused/);
    await expect.poll(() => tvTime(tv)).toBeGreaterThanOrEqual(11.5);
    phone.close();
  });
});

test.describe("the TV player", () => {
  test("the remote's arrows seek, step through the buttons, and drive the menus", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.playUrl(sample(baseURL!));
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");

    await tv.keyboard.press("ArrowRight");
    await tv.keyboard.press("ArrowRight");
    await expect(tv.locator(".hud-toast")).toHaveText("+20s");
    await expect.poll(() => tvTime(tv)).toBeGreaterThanOrEqual(19);

    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("tv-play-btn")).toBeFocused();
    for (let i = 0; i < 8 && !(await tv.getByTestId("tv-speed-btn").evaluate((el) => el === document.activeElement)); i++) {
      await tv.keyboard.press("ArrowRight");
    }
    await expect(tv.getByTestId("tv-speed-btn")).toBeFocused();

    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("audio-subtitles-modal")).toHaveAttribute("data-kind", "speed");
    await tv.keyboard.press("ArrowDown");
    await tv.keyboard.press("Enter");
    await expect.poll(() => tv.evaluate(() => document.querySelector("video")!.playbackRate)).toBe(1.25);
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("audio-subtitles-modal")).toHaveCount(0);
    phone.close();
  });

  test("Down brings back controls that have faded and lands on Play; the arrows keep to the bar and never wrap, and the bar waits for whoever is choosing", async ({ browser, baseURL }) => {
    test.setTimeout(45_000);
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: { title: "Sample", stream: { url: "/fixtures/sample.mp4", type: "mp4" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    phone.cmd({ type: "PLAY" });
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "hidden", { timeout: 8_000 });

    await tv.keyboard.press("ArrowDown");
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "visible");
    await expect(tv.getByTestId("tv-play-btn")).toBeFocused();

    await tv.keyboard.press("ArrowLeft");
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("tv-play-btn")).toBeFocused();
    for (let i = 0; i < 12; i++) await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-stop-btn")).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-stop-btn")).toBeFocused();

    await tv.waitForTimeout(3500);
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "visible");
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "hidden", { timeout: 8_000 });
    await expect(tv.getByTestId("tv-stop-btn")).not.toBeFocused();
    phone.close();
  });

  test("a control the remote rests on is named above it; one a hand pressed keeps neither the focus nor the name, so the arrows still skip", async ({ browser, baseURL }) => {
    test.setTimeout(45_000);
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: { title: "Sample", stream: { url: "/fixtures/sample.mp4", type: "mp4" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    const play = tv.getByTestId("tv-play-btn");
    const nameAbove = () => play.evaluate((button) => getComputedStyle(button, "::after").content);
    const focusedControls = tv.locator(".hud-controls button:focus");

    await tv.keyboard.press("ArrowDown");
    await expect(play).toBeFocused();
    const label = (await play.getAttribute("aria-label"))!;
    expect(label.length).toBeGreaterThan(0);
    expect(await nameAbove()).toBe(`"${label}"`);
    await tv.keyboard.press("ArrowRight");
    await expect(play).not.toBeFocused();
    await expect(focusedControls).toHaveCount(1);
    await tv.keyboard.press("ArrowLeft");
    await expect(play).toBeFocused();

    await play.click();
    expect(await play.evaluate((button) => button === document.activeElement)).toBe(false);
    expect(await nameAbove()).not.toContain(label);
    await tv.keyboard.press("ArrowRight");
    expect(await focusedControls.count()).toBe(0);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    phone.close();
  });

  test("Back from a menu returns to the button that opened it, and the subtitle style is a page of the audio and subtitles menu", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: { title: "Sample", stream: { url: "/fixtures/sample.mp4", type: "mp4" }, subtitles: [{ id: "en", label: "English", lang: "en", url: "/fixtures/sample.vtt" }] } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    const modal = tv.getByTestId("audio-subtitles-modal");
    const subtitles = tv.getByTestId("tv-audio-sub-btn");

    await tv.keyboard.press("ArrowDown");
    for (let i = 0; i < 8 && !(await subtitles.evaluate((el) => el === document.activeElement)); i++) await tv.keyboard.press("ArrowRight");
    await expect(subtitles).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(modal).toHaveAttribute("data-kind", "tracks");
    await tv.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    await expect(subtitles).toBeFocused();

    await tv.keyboard.press("Enter");
    await tv.getByRole("option", { name: "Subtitle style…" }).click();
    await expect(modal).toHaveAttribute("data-kind", "captions");
    await tv.keyboard.press("Escape");
    await expect(modal).toHaveAttribute("data-kind", "tracks");
    await expect(tv.getByRole("option", { name: "Subtitle style…" })).toBeFocused();
    await tv.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    await expect(subtitles).toBeFocused();
    phone.close();
  });

  test("the controls fade away while playing, stay while paused, and the big button in the middle plays", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: { title: "Sample", stream: { url: "/fixtures/sample.mp4", type: "mp4" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "visible");

    await tv.getByTestId("tv-center-btn").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "hidden", { timeout: 5_000 });
    phone.close();
  });

  test("a click on the picture only shows or hides the controls: the button on the bar pauses, and the one in the middle plays", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: { title: "Sample", stream: { url: "/fixtures/sample.mp4", type: "mp4" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    phone.cmd({ type: "PLAY" });
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "hidden", { timeout: 8_000 });

    await tv.mouse.click(640, 360);
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "hidden");
    await tv.waitForTimeout(800);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");

    await tv.waitForTimeout(700);
    await tv.mouse.move(500, 300);
    await tv.mouse.move(520, 320);
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "visible");
    await expect(tv.getByTestId("tv-center-btn")).toHaveCount(0);
    await tv.getByTestId("tv-play-btn").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "visible");

    await tv.mouse.click(1000, 250);
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "hidden");
    await tv.waitForTimeout(500);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect(tv.getByTestId("tv-pause-card")).toBeHidden();
    await tv.waitForTimeout(700);
    await tv.mouse.move(500, 300);
    await tv.mouse.move(520, 320);
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "visible");
    await tv.getByTestId("tv-center-btn").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    phone.close();
  });

  test("OK on the remote still pauses and plays, whatever a click does", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: { title: "Sample", stream: { url: "/fixtures/sample.mp4", type: "mp4" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await tv.keyboard.press("Enter");
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await tv.keyboard.press("Enter");
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    phone.close();
  });

  test("a profile that wants the picture to be a button gets one: a click pauses and plays, as it always did", async ({ browser, baseURL }) => {
    const tv = await openTv(browser, undefined, guestStorage({ settings: [{ key: "tapToPause", at: Date.now(), value: true }] }));
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: { title: "Sample", stream: { url: "/fixtures/sample.mp4", type: "mp4" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    phone.cmd({ type: "PLAY" });
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "hidden", { timeout: 8_000 });

    await tv.mouse.click(1000, 250);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "visible");
    await tv.mouse.click(1000, 250);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    phone.close();
  });

  test("the big button in the middle is big enough to hit, and leaves room for the card beside it", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: { title: "Sample", stream: { url: "/fixtures/sample.mp4", type: "mp4" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    const button = (await tv.getByTestId("tv-center-btn").boundingBox())!;
    const card = (await tv.getByTestId("tv-pause-card").boundingBox())!;
    expect(button.width).toBeGreaterThanOrEqual(1280 * 0.14);
    expect(button.width).toBeLessThanOrEqual(1280 * 0.2);
    expect(Math.abs(button.x + button.width / 2 - 640)).toBeLessThan(2);
    expect(card.x + card.width).toBeLessThan(button.x);
    phone.close();
  });

  test("M and the button silence this screen's own sound, and say so", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.playUrl(sample(baseURL!));
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    const muted = () => tv.evaluate(() => document.querySelector("video")!.muted);
    expect(await muted()).toBe(false);

    await tv.keyboard.press("m");
    await expect.poll(muted).toBe(true);
    await expect(tv.locator(".hud-toast")).toHaveText(en["notice.muted"]);
    await expect(tv.getByTestId("tv-mute-btn")).toHaveAttribute("aria-pressed", "true");

    await tv.getByTestId("tv-mute-btn").click();
    await expect.poll(muted).toBe(false);
    await expect(tv.locator(".hud-toast")).toHaveText(en["notice.unmuted"]);
    await expect(tv.getByTestId("tv-mute-btn")).toHaveAttribute("aria-pressed", "false");
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    phone.close();
  });

  test("subtitle language and size are remembered for the next video", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    const track = (index: number) => tv.evaluate((i) => document.querySelector("video")!.textTracks[i]?.mode, index);

    phone.cmd({ type: "LOAD", media: seriesMedia(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect.poll(() => track(1)).toBe("disabled");

    phone.cmd({ type: "SET_SUBTITLE", track: 1 });
    await expect.poll(() => track(1)).toBe("hidden");

    phone.cmd({ type: "LOAD", media: { ...seriesMedia(baseURL!), stream: { url: "/fixtures/sample.mp4?again=1", type: "mp4" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect.poll(() => track(1)).toBe("hidden");
    expect(await track(0)).toBe("disabled");

    phone.cmd({ type: "SET_SUBTITLE", track: -1 });
    await expect.poll(() => track(1)).toBe("disabled");
    phone.cmd({ type: "LOAD", media: { ...seriesMedia(baseURL!), stream: { url: "/fixtures/sample.mp4?third=1", type: "mp4" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect.poll(() => tv.evaluate(() => document.querySelector("video")!.textTracks.length)).toBe(2);
    await tv.waitForTimeout(500);
    expect(await track(0)).toBe("disabled");
    expect(await track(1)).toBe("disabled");
    phone.close();
  });

  test("the subtitle menu previews the look and the panel doesn't move when you change it", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: seriesMedia(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");

    await tv.getByTestId("tv-audio-sub-btn").click();
    const modal = tv.getByTestId("audio-subtitles-modal");
    await expect(modal).toHaveAttribute("data-kind", "tracks");
    await expect(tv.getByRole("option", { name: "Off", exact: true })).toBeVisible();
    await expect(tv.getByTestId("subtitle-preview")).toBeVisible();

    await tv.getByRole("option", { name: "Subtitle style…" }).click();
    await expect(modal).toHaveAttribute("data-kind", "captions");
    await expect(tv.getByTestId("subtitle-preview")).toBeVisible();
    await tv.getByRole("option", { name: "More options…" }).click();
    await expect(modal).toHaveAttribute("data-page", "more");
    await expect(tv.getByTestId("subtitle-preview")).toBeVisible();

    const box = async () => (await modal.boundingBox())!;
    const before = await box();
    const preview = () => tv.getByTestId("subtitle-preview").locator("span");
    const fontSize = async () => parseFloat(await preview().evaluate((el) => getComputedStyle(el).fontSize));
    const mediumPx = await fontSize();

    await tv.getByRole("option", { name: /^Size/ }).focus();
    for (const label of ["Large", "Small", "Medium"]) {
      await tv.getByRole("option", { name: label, exact: true }).click();
      const now = await box();
      expect([now.x, now.y, now.width, now.height]).toEqual([before.x, before.y, before.width, before.height]);
    }
    await tv.getByRole("option", { name: "Large", exact: true }).click();
    await expect.poll(fontSize).toBeGreaterThan(mediumPx);

    await tv.getByRole("option", { name: /^Text color/ }).focus();
    await tv.getByRole("option", { name: "Yellow", exact: true }).click();
    await expect.poll(() => preview().evaluate((el) => getComputedStyle(el).color)).toBe("rgb(255, 235, 59)");
    const now = await box();
    expect([now.x, now.y, now.width, now.height]).toEqual([before.x, before.y, before.width, before.height]);

    expect(JSON.parse(await tv.evaluate(() => localStorage.getItem("tv.prefs")!)).captionStyle).toMatchObject({ size: "large", color: "yellow" });
    phone.close();
  });

  test("the subtitle style starts with three looks: one OK is a whole look and keeps the height, the eight settings are a page further, and Back goes one page at a time", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: seriesMedia(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    phone.cmd({ type: "SET_CAPTION_STYLE", style: { position: "high" } });
    await expect.poll(() => phone.states.at(-1)?.captionStyle?.position).toBe("high");
    const prefs = async () => JSON.parse((await tv.evaluate(() => localStorage.getItem("tv.prefs")))!).captionStyle as Record<string, string>;

    await tv.getByTestId("tv-audio-sub-btn").click();
    const modal = tv.getByTestId("audio-subtitles-modal");
    await tv.getByRole("option", { name: "Subtitle style…" }).click();
    await expect(modal).toHaveAttribute("data-kind", "captions");
    await expect(modal).not.toHaveAttribute("data-page", /./);
    const look = (name: string) => tv.getByRole("option", { name, exact: true });
    await expect(look("Standard")).toHaveAttribute("aria-selected", "true");
    await expect(look("Standard")).toBeFocused();
    await expect(tv.getByRole("option", { name: /^Size/ })).toHaveCount(0);

    await tv.keyboard.press("ArrowDown");
    await expect(look("Large text")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(look("Large text")).toHaveAttribute("aria-selected", "true");
    await expect.poll(prefs).toMatchObject({ size: "large", background: "75", edge: "shadow", position: "high" });
    await expect(modal).not.toHaveAttribute("data-page", /./);

    await tv.keyboard.press("ArrowDown");
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByRole("option", { name: "More options…" })).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(modal).toHaveAttribute("data-page", "more");
    await expect(tv.getByRole("option", { name: /^Size/ })).toBeVisible();
    await tv.getByRole("option", { name: /^Text color/ }).focus();
    await tv.getByRole("option", { name: "Yellow", exact: true }).click();
    await expect.poll(prefs).toMatchObject({ color: "yellow", size: "large" });

    await tv.keyboard.press("Escape");
    await expect(modal).not.toHaveAttribute("data-page", /./);
    await expect(tv.getByRole("option", { name: /^More options…/ })).toBeFocused();
    await expect(tv.getByRole("option", { name: /^More options…/ })).toContainText("Your own");
    for (const name of ["Standard", "Large text", "No box"]) await expect(look(name)).toHaveAttribute("aria-selected", "false");
    await tv.keyboard.press("Escape");
    await expect(modal).toHaveAttribute("data-kind", "tracks");
    await expect(tv.getByRole("option", { name: "Subtitle style…" })).toBeFocused();
    await tv.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    phone.close();
  });

  test("subtitles are drawn by the page in the chosen look, and the phone sees the look", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: seriesMedia(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect(tv.getByTestId("caption")).toHaveCount(0);

    phone.cmd({ type: "SET_SUBTITLE", track: 0 });
    const caption = tv.getByTestId("caption");
    await expect(caption).toHaveText("Hello, this is a subtitle test!");
    const css = (property: string) => caption.evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), property);
    const px = async (property: string) => parseFloat(await css(property));
    expect(await px("font-size")).toBeCloseTo(0.046 * 720, 0);
    expect(await css("color")).toBe("rgb(255, 255, 255)");
    expect(await tv.evaluate(() => document.querySelector("video")!.textTracks[0]?.mode)).toBe("hidden");

    phone.cmd({ type: "SET_CAPTION_STYLE", style: { size: "large", color: "yellow", spacing: "wide", background: "0", position: "high" } });
    await expect.poll(() => px("font-size")).toBeCloseTo(0.06 * 720, 0);
    expect(await css("color")).toBe("rgb(255, 235, 59)");
    expect(await px("word-spacing")).toBeCloseTo(0.25 * 0.06 * 720, 0);
    expect(await css("background-color")).toBe("rgba(0, 0, 0, 0)");
    await expect.poll(() => phone.states.at(-1)?.captionStyle?.color).toBe("yellow");

    phone.cmd({ type: "PLAY" });
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "hidden", { timeout: 6_000 });
    const bottom = () => tv.getByTestId("captions").evaluate((el) => 720 - el.getBoundingClientRect().bottom);
    await expect.poll(bottom).toBeCloseTo(0.18 * 720, -1);

    phone.cmd({ type: "LOAD", media: { ...seriesMedia(baseURL!), stream: { url: "/fixtures/sample.mp4?again=1", type: "mp4" } } });
    await expect(tv.getByTestId("caption")).toHaveText("Hello, this is a subtitle test!");
    expect(await css("color")).toBe("rgb(255, 235, 59)");
    phone.close();
  });

  test("on a screen held upright the subtitles are sized and placed for the picture, which is a strip across the middle of it", async ({ browser, baseURL }) => {
    const tv = await openTv(browser, { width: 390, height: 844 });
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: seriesMedia(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    phone.cmd({ type: "SET_SUBTITLE", track: 0 });
    const caption = tv.getByTestId("caption");
    await expect(caption).toHaveText("Hello, this is a subtitle test!");

    expect(parseFloat(await caption.evaluate((el) => getComputedStyle(el).fontSize))).toBe(14);
    const pictureTop = (844 - (390 * 9) / 16) / 2;
    const pictureBottom = (844 + (390 * 9) / 16) / 2;
    const box = (await caption.boundingBox())!;
    expect(box.y).toBeGreaterThan(pictureTop);
    expect(box.y + box.height).toBeLessThanOrEqual(pictureBottom);
    phone.close();
  });
});

test.describe("the phone's subtitle style", () => {
  test("changes how the TV draws subtitles, shows the TV's real values, and can go back to the default", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await loadOnTv(phone, seriesMedia(baseURL!));
    await expect(phone.getByTestId("media-title")).toBeVisible();

    await phone.getByTestId("chip-tracks").click();
    await phone.getByTestId("subtitle-0").click();
    await phone.getByTestId("open-caption-style").click();
    await expect(phone.getByTestId("captions-sheet")).toBeVisible();
    await phone.getByTestId("caption-more").click();
    await expect(phone.getByTestId("caption-color-white")).toHaveAttribute("aria-checked", "true");

    await phone.getByTestId("caption-color-yellow").click();
    await phone.getByTestId("caption-spacing-wider").click();
    await expect(phone.getByTestId("caption-color-yellow")).toHaveAttribute("aria-checked", "true");
    await expect(phone.getByTestId("caption-preview").locator("span")).toHaveCSS("color", "rgb(255, 235, 59)");
    const caption = tv.getByTestId("caption");
    await expect(caption).toHaveCSS("color", "rgb(255, 235, 59)");
    await expect(caption).toHaveCSS("word-spacing", `${0.5 * 0.046 * 720}px`);

    await phone.getByTestId("caption-reset").click();
    await expect(caption).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(phone.getByTestId("caption-spacing-normal")).toHaveAttribute("aria-checked", "true");
  });

  test("three looks come first, one tap each; the eight settings stay folded until asked for, and open by themselves for a look of one's own", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await loadOnTv(phone, seriesMedia(baseURL!));
    await expect(phone.getByTestId("media-title")).toBeVisible();
    await phone.getByTestId("chip-tracks").click();
    await phone.getByTestId("subtitle-0").click();
    await phone.getByTestId("open-caption-style").click();
    await expect(phone.getByTestId("captions-sheet")).toBeVisible();

    await expect(phone.getByTestId("caption-look-standard")).toHaveAttribute("aria-checked", "true");
    await expect(phone.getByTestId("caption-color-white")).toHaveCount(0);
    await phone.getByTestId("caption-look-large").click();
    await expect(phone.getByTestId("caption-look-large")).toHaveAttribute("aria-checked", "true");
    const caption = tv.getByTestId("caption");
    await expect.poll(async () => parseFloat(await caption.evaluate((el) => getComputedStyle(el).fontSize))).toBeCloseTo(0.06 * 720, 0);
    await phone.getByTestId("caption-look-clear").click();
    await expect(caption).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

    await phone.getByTestId("caption-more").click();
    await phone.getByTestId("caption-color-yellow").click();
    await expect(phone.getByTestId("caption-color-yellow")).toHaveAttribute("aria-checked", "true");
    for (const name of ["standard", "large", "clear"]) await expect(phone.getByTestId(`caption-look-${name}`)).toHaveAttribute("aria-checked", "false");

    await phone.keyboard.press("Escape");
    await expect(phone.getByTestId("captions-sheet")).toHaveCount(0);
    await phone.getByTestId("chip-tracks").click();
    await phone.getByTestId("open-caption-style").click();
    await expect(phone.getByTestId("caption-color-yellow")).toHaveAttribute("aria-checked", "true");
    await expect(phone.getByTestId("caption-more")).toHaveCount(0);
  });
});

test.describe("the menu of tracks of a film that has one sound", () => {
  const media = (baseURL: string): NormalizedMedia => ({
    ...seriesMedia(baseURL),
    subtitles: [
      { id: "en", label: "English", lang: "en", url: "/fixtures/sample.vtt" },
      { id: "en2", label: "English (SDH)", lang: "en", url: "/fixtures/sample.vtt" },
      { id: "nl", label: "Dutch", lang: "nl", url: "/fixtures/sample.vtt" },
    ],
  });

  test("is called Subtitles on the TV, names the language of the subtitles as theirs, and says there is no other audio language", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: media(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");

    const button = tv.getByTestId("tv-audio-sub-btn");
    await expect(button).toHaveAttribute("aria-label", "Subtitles");
    await expect(button.locator(".tv-btn-label")).toHaveText("Subtitles");
    await button.click();
    const menu = tv.getByTestId("audio-subtitles-modal");
    await expect(menu).toHaveAttribute("data-kind", "tracks");
    await expect(menu.getByRole("heading", { level: 2 })).toHaveText("Subtitles");
    await expect(tv.getByTestId("no-audio-choice")).toHaveText("This film has no other audio language to choose.");
    await expect(menu.getByRole("heading", { level: 3, name: "Subtitle language" })).toBeVisible();
    await expect(menu.getByRole("heading", { level: 3, name: /^Audio/ })).toHaveCount(0);
    phone.close();
  });

  test("is called Subtitles on the phone too, with the same line where an audio list would be", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await loadOnTv(phone, media(baseURL!));
    await expect(phone.getByTestId("media-title")).toBeVisible();

    await phone.getByTestId("chip-tracks").click();
    const sheet = phone.getByTestId("tracks-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("heading", { level: 2 }).first()).toHaveText("Subtitles");
    await expect(phone.getByTestId("no-audio-choice")).toHaveText("This film has no other audio language to choose.");
    await expect(sheet.getByRole("heading", { level: 3, name: /^Audio/ })).toHaveCount(0);
  });
});

test.describe("the subtitle delay", () => {
  test("is offered for subtitles that are on, and not while there are none", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await loadOnTv(phone, seriesMedia(baseURL!));
    await expect(phone.getByTestId("media-title")).toBeVisible();

    await phone.getByTestId("chip-tracks").click();
    await expect(phone.getByTestId("subtitle-0")).toBeVisible();
    await expect(phone.getByTestId("subtitle-delay")).toBeVisible();
    await phone.getByTestId("subtitle--1").click();
    await expect(phone.getByTestId("subtitle-delay")).toHaveCount(0);
    await phone.getByTestId("subtitle-0").click();
    await expect(phone.getByTestId("subtitle-delay")).toBeVisible();
  });
});

test.describe("series", () => {
  test("the TV lists every episode and plays the one you pick", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: seriesMedia(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");

    await tv.getByTestId("tv-episodes-btn").click();
    await expect(tv.getByTestId("audio-subtitles-modal")).toHaveAttribute("data-kind", "episodes");
    await expect(tv.getByRole("option")).toHaveCount(3);
    await expect(tv.getByRole("option", { name: /2\. The Long Night/ })).toHaveAttribute("aria-selected", "true");

    await tv.getByRole("option", { name: /3\. Cold Open/ }).click();
    await expect(tv.getByTestId("tv-title")).toHaveText("Fixture HLS Stream", { timeout: 15_000 });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", /playing|paused/);
    phone.close();
  });

  test("when the library knows the episodes the TV lists them as cards: a picture, the length, a line about each", async ({ browser, baseURL }) => {
    const asked: string[] = [];
    const picture = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='9'><rect width='16' height='9' fill='teal'/></svg>";
    const tv = await openLibrary(browser, (context) =>
      context.route(/\/api\/library\/episodes/, (route) => {
        asked.push(new URL(route.request().url()).search);
        return route.fulfill({
          json: {
            episodes: [
              { season: 1, episode: 1, title: "The Pilot", overview: "A stranger arrives in town.", still: picture, runtime: 47 },
              { season: 1, episode: 2, title: "A Long Night", overview: "Nobody sleeps.", still: "/fixtures/missing-still.jpg", runtime: 52 },
              { season: 1, episode: 3, title: "Cold Open", runtime: 61 },
            ],
          },
        });
      }),
    );
    await tv.getByTestId("rail-connect").click();
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: seriesMedia(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");

    await tv.getByTestId("tv-episodes-btn").click();
    const card = (episode: number) => tv.locator(".tv-ep").nth(episode - 1);
    await expect(tv.locator(".tv-ep")).toHaveCount(3);
    await expect(card(1)).toContainText("The Pilot");
    await expect(card(1)).toContainText("A stranger arrives in town.");
    await expect(card(1)).toContainText("47 min");
    await expect(card(1).locator("img")).toBeVisible();
    await expect(card(2).locator("img")).toHaveCount(0);
    await expect(card(3)).toContainText("1 h 1 min");
    await expect(card(2)).toContainText("Now playing");
    await expect(card(2)).toHaveAttribute("aria-selected", "true");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("season=1");
    expect(asked[0]).toContain(encodeURIComponent(`${baseURL}/fixtures/pages/video.html`));

    await tv.keyboard.press("ArrowDown");
    await expect(card(3)).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-title")).toHaveText("Fixture HLS Stream", { timeout: 15_000 });
    phone.close();
  });

  test("when the library knows nothing of the episodes the list stays plain", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: seriesMedia(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");

    await tv.getByTestId("tv-episodes-btn").click();
    await expect(tv.getByRole("option", { name: /3\. Cold Open/ })).toBeVisible();
    await expect(tv.locator(".tv-ep")).toHaveCount(0);
    await expect(tv.getByTestId("audio-subtitles-modal")).toHaveAttribute("data-rich", "false");
    phone.close();
  });

  test("the phone lists every episode, marks the current one, and plays the one you pick", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await loadOnTv(phone, seriesMedia(baseURL!));
    await expect(phone.getByTestId("media-title")).toBeVisible();

    await phone.getByTestId("chip-episodes").click();
    await expect(phone.getByTestId("episode")).toHaveCount(3);
    await expect(phone.locator('[data-testid="episode"].now')).toContainText("The Long Night");

    await phone.getByTestId("episode").nth(2).click();
    await expect(phone.getByTestId("media-title")).toHaveText("Fixture HLS Stream");
    await expect(tvRoot(tv)).toHaveAttribute("data-state", /playing|paused/);
  });

  test("the phone's list is cards too when the library knows the episodes: the length, a line about each, and the library's own names", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.context().route(/\/api\/library\/episodes/, (route) =>
      route.fulfill({
        json: {
          episodes: [
            { season: 1, episode: 1, title: "The Pilot", overview: "A stranger arrives in town.", runtime: 47 },
            { season: 1, episode: 3, title: "Cold Open", runtime: 61 },
          ],
        },
      }),
    );
    await loadOnTv(phone, seriesMedia(baseURL!));
    await expect(phone.getByTestId("media-title")).toBeVisible();

    await phone.getByTestId("chip-episodes").click();
    const row = (episode: number) => phone.locator(`[data-testid="episode"][data-episode="${episode}"]`);
    await expect(row(1)).toHaveClass(/rich/);
    await expect(row(1)).toContainText("The Pilot");
    await expect(row(1)).toContainText("A stranger arrives in town.");
    await expect(row(1)).toContainText("47 min");
    await expect(row(3)).toContainText("1 h 1 min");
    await expect(row(2)).toContainText("The Long Night");
    await expect(row(2)).toContainText("Now playing");
  });
});

test.describe("watched markers", () => {
  const third = (baseURL: string): NormalizedMedia => {
    const base = seriesMedia(baseURL);
    return { ...base, title: "The Long Night · S1 E3", stream: { url: "/fixtures/sample.mp4?third=1", type: "mp4" }, series: { ...base.series!, episode: 3 } };
  };

  type Saved = { episode: number; done: boolean; position: number };
  const savedWatched = (page: Page) =>
    page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem("kino.data.guest") ?? "null") as { data?: { watched?: Array<Saved & { deleted?: boolean }> } } | null;
      return (saved?.data?.watched ?? []).filter((entry) => !entry.deleted) as Saved[];
    });
  const savedOnTv = savedWatched;
  const savedOnPhone = savedWatched;

  test("the TV marks an episode watched or half-watched in its list", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: seriesMedia(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    phone.cmd({ type: "SEEK", time: 29 });
    await expect.poll(() => tvTime(tv)).toBeGreaterThan(28);
    await expect.poll(async () => (await savedOnTv(tv)).find((entry) => entry.episode === 2)?.done).toBe(true);

    phone.cmd({ type: "LOAD", media: third(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    phone.cmd({ type: "SEEK", time: 20 });
    await expect.poll(async () => (await savedOnTv(tv)).find((entry) => entry.episode === 3)?.position ?? 0).toBeGreaterThan(19);
    phone.cmd({ type: "LOAD", media: seriesMedia(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");

    await tv.getByTestId("tv-episodes-btn").click();
    await expect(tv.getByRole("option", { name: /3\. Cold Open/ })).toContainText("1 min left");
    await expect(tv.getByRole("option", { name: /1\. Pilot/ })).not.toContainText("Watched");
    await expect(tv.getByRole("option", { name: /2\. The Long Night/ })).not.toContainText("Watched");
    phone.close();
  });

  test("the old episode's progress is never counted for the new one", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: seriesMedia(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    phone.cmd({ type: "SEEK", time: 29 });
    await expect.poll(() => tvTime(tv)).toBeGreaterThan(28);
    phone.cmd({ type: "LOAD", media: third(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect.poll(async () => (await savedOnTv(tv)).find((entry) => entry.episode === 3) !== undefined).toBe(true);
    expect((await savedOnTv(tv)).find((entry) => entry.episode === 3)).toMatchObject({ done: false });
    phone.close();
  });

  test("the phone's list shows the same markers, and a progress bar for the one in between", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await loadOnTv(phone, seriesMedia(baseURL!));
    await expect(phone.getByTestId("media-title")).toBeVisible();
    await tv.evaluate(() => void (document.querySelector("video")!.currentTime = 29));
    await expect.poll(async () => (await savedOnPhone(phone)).find((entry) => entry.episode === 2)?.done).toBe(true);

    await loadOnTv(phone, third(baseURL!));
    await expect(phone.getByTestId("media-title")).toBeVisible();
    await tv.evaluate(() => void (document.querySelector("video")!.currentTime = 20));
    await expect.poll(async () => (await savedOnPhone(phone)).find((entry) => entry.episode === 3)?.position ?? 0).toBeGreaterThan(19);
    await loadOnTv(phone, seriesMedia(baseURL!));

    await phone.getByTestId("chip-episodes").click();
    const row = (episode: number) => phone.locator(`[data-testid="episode"][data-episode="${episode}"]`);
    await expect(row(3)).toHaveAttribute("data-status", "started");
    await expect(row(3)).toContainText("1 min left");
    await expect(row(3).locator(".episode-progress i")).toBeVisible();
    await expect(row(1)).toHaveAttribute("data-status", "new");
    await expect(row(2)).toHaveAttribute("data-status", "watched");
  });
});

test.describe("languages", () => {
  test("a subtitle track the file only labels with a code is named by its language, on the TV and the phone", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    const media = seriesMedia(baseURL!);
    await loadOnTv(phone, {
      ...media,
      subtitles: [
        { id: "a", label: "ron", lang: "ro", url: "/fixtures/sample.vtt" },
        { id: "b", label: "", lang: "nl", url: "/fixtures/sample.vtt" },
        { id: "c", label: "English (SDH)", lang: "en", url: "/fixtures/sample.vtt" },
      ],
    });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");

    await tv.getByTestId("tv-audio-sub-btn").click();
    for (const name of ["Romanian", "Dutch", "English (SDH)"]) await expect(tv.getByRole("option", { name, exact: true })).toBeVisible();

    await expect(tv.getByText("More languages", { exact: true })).toBeVisible();
    const order = await tv.getByRole("listbox", { name: "Subtitles" }).getByRole("option").allTextContents();
    expect(order.map((text) => text.trim()).filter((text) => text !== "Off")).toEqual(["English (SDH)", "Romanian", "Dutch"]);

    await phone.getByTestId("chip-tracks").click();
    await expect(phone.getByTestId("subtitle-0")).toHaveText(/Romanian/);
    await expect(phone.getByTestId("subtitle-1")).toHaveText(/Dutch/);
    await expect(phone.getByTestId("subtitle-more")).toHaveCount(0);
  });

  test("with many languages, three show and the rest wait behind More languages, on the TV and the phone", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    const media = seriesMedia(baseURL!);
    const langs = [["en", "English"], ["fr", "French"], ["de", "German"], ["es", "Spanish"], ["nl", "Dutch"], ["pt", "Portuguese"]] as const;
    await loadOnTv(phone, { ...media, subtitles: langs.map(([lang, label]) => ({ id: lang, label, lang, url: "/fixtures/sample.vtt" })) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");

    await tv.getByTestId("tv-audio-sub-btn").click();
    const order = async () => (await tv.getByRole("listbox", { name: "Subtitles" }).getByRole("option").allTextContents()).map((text) => text.trim());
    await expect.poll(order).toEqual(["Off", "English", "More languages5"]);
    await tv.locator("[data-key='more-languages-open']").click();
    await expect.poll(order).toEqual(["Off", "English", "French", "German", "Spanish", "Dutch", "Portuguese"]);

    await phone.getByTestId("chip-tracks").click();
    await expect(phone.getByTestId("subtitle-0")).toHaveText(/English/);
    await expect(phone.getByTestId("subtitle-1")).toHaveCount(0);
    await expect(phone.getByTestId("subtitle-more")).toContainText("5");
    await phone.getByTestId("subtitle-more").click();
    await expect(phone.getByTestId("subtitle-5")).toHaveText(/Portuguese/);
  });
});

test.describe("sources", () => {
  const withSources = (sources: { label?: string; url: string }[]): NormalizedMedia => {
    const [first, ...others] = sources;
    return {
      title: "Two Ways",
      stream: { url: first!.url, type: "mp4" },
      alternates: others.map((source) => ({ ...(source.label ? { label: source.label } : {}), stream: { url: source.url, type: "mp4" as const } })),
    };
  };
  const currentSrc = (tv: Page) => tv.evaluate(() => document.querySelector("video")!.currentSrc);

  test("a source that does not play hands over to the next one by itself", async ({ browser }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await loadOnTv(phone, withSources([{ url: "/fixtures/does-not-exist.mp4" }, { label: "Mirror", url: "/fixtures/sample.mp4" }]));
    await expect(tvRoot(tv)).toHaveAttribute("data-state", /playing|paused/, { timeout: 15_000 });
    await expect(tv.getByTestId("tv-source-btn")).toHaveText("Mirror");
    expect(await currentSrc(tv)).toContain("/fixtures/sample.mp4");
    await expect(phone.getByTestId("chip-source")).toContainText("Mirror");
  });

  test("the source that takes over starts where the video was told to start, and stays held when it was put back held", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: withSources([{ url: "/fixtures/does-not-exist.mp4" }, { label: "Mirror", url: "/fixtures/sample.mp4" }]), startAt: 9 });
    await expect(tv.getByTestId("tv-source-btn")).toHaveText("Mirror", { timeout: 15_000 });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect.poll(() => tvTime(tv), { timeout: 10_000 }).toBeGreaterThan(8);
    await tv.waitForTimeout(1000);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    phone.close();
  });

  test("the source that takes over plays from where the video was told to start, when it was meant to play", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: withSources([{ url: "/fixtures/does-not-exist.mp4" }, { label: "Mirror", url: "/fixtures/sample.mp4" }]), startAt: 9 });
    phone.cmd({ type: "PLAY" });
    await expect(tv.getByTestId("tv-source-btn")).toHaveText("Mirror", { timeout: 15_000 });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    expect(await tvTime(tv)).toBeGreaterThan(8);
    phone.close();
  });

  test("Try again carries on from where the video stopped, not from the start", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: withSources([{ url: "/fixtures/sample.mp4" }]) });
    phone.cmd({ type: "PLAY" });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    await tv.evaluate(() => void (document.querySelector("video")!.currentTime = 9));
    await expect.poll(() => tvTime(tv)).toBeGreaterThan(8.5);
    await tv.evaluate(() => void document.querySelector("video")!.dispatchEvent(new Event("error")));
    await expect(tv.getByTestId("tv-error")).toBeVisible();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-error")).toHaveCount(0);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    expect(await tvTime(tv)).toBeGreaterThan(8);
    phone.close();
  });

  test("a video that stopped because the connection went is tried again by itself, and the card says what happened", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: { title: "Streamed", stream: { url: "/fixtures/hls/master.m3u8", type: "hls" } } });
    phone.cmd({ type: "PLAY" });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    await tv.evaluate(() => void (document.querySelector("video")!.currentTime = 0.5));
    await tv.evaluate(() => {
      Object.defineProperty(document.querySelector("video")!, "error", { configurable: true, get: () => ({ code: 2 }) });
      document.querySelector("video")!.dispatchEvent(new Event("error"));
    });
    await expect(tv.getByTestId("tv-error")).toBeVisible();
    await expect(tv.getByTestId("tv-error")).toContainText("The connection to the video was lost.");
    await expect(tv.getByTestId("tv-error")).toHaveCount(0, { timeout: 10_000 });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", /playing|paused/, { timeout: 15_000 });
    phone.close();
  });

  test("when every source fails, the TV says so instead of looping", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: withSources([{ url: "/fixtures/nope-1.mp4" }, { url: "/fixtures/nope-2.mp4" }]) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "error", { timeout: 15_000 });
    await tv.waitForTimeout(1500);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "error");
    await expect(tv.getByTestId("tv-error")).toBeVisible();
    await expect(tv.getByTestId("tv-play-btn")).toHaveCount(0);
    await expect(tv.getByTestId("error-retry")).toBeFocused();
    phone.close();
  });

  test("on the card of a video that would not play, OK tries again and Back leaves for the library", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    let broken = true;
    await tv.route("**/fixtures/flaky.mp4", (route) => (broken ? route.fulfill({ status: 404, body: "gone" }) : route.continue({ url: `${baseURL}/fixtures/sample.mp4` })));
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: withSources([{ url: "/fixtures/flaky.mp4" }]) });
    await expect(tv.getByTestId("tv-error")).toBeVisible({ timeout: 15_000 });

    broken = false;
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-error")).toHaveCount(0);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", /playing|paused/, { timeout: 15_000 });

    phone.cmd({ type: "LOAD", media: withSources([{ url: "/fixtures/nope.mp4" }]) });
    await expect(tv.getByTestId("tv-error")).toBeVisible({ timeout: 15_000 });
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle");
    await expect.poll(() => phone.states.at(-1)?.state).toBe("idle");
    phone.close();
  });

  test("the phone and the TV can pick a source, and it carries on from where it was", async ({ browser }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await loadOnTv(phone, withSources([{ url: "/fixtures/sample.mp4" }, { label: "Server B", url: "/fixtures/sample.mp4?b=1" }]));
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect(phone.getByTestId("chip-source")).toContainText("Source 1");
    await tv.evaluate(() => void (document.querySelector("video")!.currentTime = 12));

    await phone.getByTestId("chip-source").click();
    await phone.getByTestId("source-1").click();
    await expect(phone.getByTestId("chip-source")).toContainText("Server B");
    await expect.poll(() => currentSrc(tv)).toContain("b=1");
    await expect.poll(() => tvTime(tv), { timeout: 10_000 }).toBeGreaterThan(11);

    await tv.getByTestId("tv-source-btn").click();
    await expect(tv.getByTestId("audio-subtitles-modal")).toHaveAttribute("data-kind", "sources");
    await tv.getByRole("option", { name: "Source 1" }).click();
    await expect.poll(() => currentSrc(tv)).not.toContain("b=1");
    await expect(phone.getByTestId("chip-source")).toContainText("Source 1");
  });

  test("the same film in another quality is picked under Quality, and only another place to get it from under Source", async ({ browser }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    const file = (name: string) => ({ url: `/fixtures/sample.mp4?${name}`, type: "mp4" as const });
    await loadOnTv(phone, {
      title: "Two Questions",
      stream: file("q=1080"),
      quality: "1080p",
      alternates: [
        { label: "720p", quality: "720p", stream: file("q=720") },
        { label: "Mirror", stream: file("mirror=1") },
      ],
    });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await tv.evaluate(() => void (document.querySelector("video")!.currentTime = 12));

    await expect(tv.getByTestId("tv-source-btn")).toHaveText("Source 1");
    await expect(tv.getByTestId("tv-quality-btn")).toHaveText("1080p");
    await phone.getByTestId("chip-quality").click();
    await expect(phone.getByTestId("quality-1000")).toContainText("1080p");
    await expect(phone.getByTestId("quality--1")).toHaveCount(0);
    await phone.getByTestId("quality-1001").click();
    await expect.poll(() => currentSrc(tv)).toContain("q=720");
    await expect.poll(() => tvTime(tv), { timeout: 10_000 }).toBeGreaterThan(11);
    await expect(phone.getByTestId("chip-quality")).toContainText("720p");
    await expect(phone.getByTestId("chip-source")).toContainText("Source 1");
    await phone.keyboard.press("Escape");
    await expect(phone.getByTestId("quality-sheet")).toHaveCount(0);

    await phone.getByTestId("chip-source").click();
    await expect(phone.getByTestId("source-0")).toContainText("Source 1");
    await expect(phone.getByTestId("source-1")).toContainText("Mirror");
    await expect(phone.getByTestId("source-2")).toHaveCount(0);
    await phone.getByTestId("source-1").click();
    await expect.poll(() => currentSrc(tv)).toContain("mirror=1");
    await expect(tv.getByTestId("tv-source-btn")).toHaveText("Mirror");
    await expect(tv.getByTestId("tv-quality-btn")).toHaveText("✦ Off");

    await tv.getByTestId("tv-source-btn").click();
    await tv.getByRole("option", { name: "Source 1" }).click();
    await expect.poll(() => currentSrc(tv)).toContain("q=1080");
    await expect(tv.getByTestId("tv-quality-btn")).toHaveText("1080p");
  });

  test("what the screen says when one does not play names it as the pickers do: a quality by its quality, a place by its place among the places", async ({ browser }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    const toasts: string[] = [];
    await tv.exposeFunction("__toast", (text: string) => void toasts.push(text));
    await tv.evaluate(() => {
      new MutationObserver(() => {
        const toast = document.querySelector(".hud-toast");
        if (toast?.textContent) (window as unknown as { __toast: (text: string) => void }).__toast(toast.textContent);
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await loadOnTv(phone, {
      title: "Three Tries",
      stream: { url: "/fixtures/nope-1080.mp4", type: "mp4" },
      quality: "1080",
      alternates: [
        { quality: "720", stream: { url: "/fixtures/nope-720.mp4", type: "mp4" } },
        { stream: { url: "/fixtures/sample.mp4", type: "mp4" } },
      ],
    });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", /playing|paused/, { timeout: 15_000 });
    await expect(tv.getByTestId("tv-source-btn")).toHaveText("Source 2");
    await expect.poll(() => toasts).toContain(en["notice.sourceFailed"].replace("{from}", "1080p").replace("{to}", "720p"));
    await expect.poll(() => toasts).toContain(en["notice.sourceFailed"].replace("{from}", "720p").replace("{to}", "Source 2"));
  });

  test("a video with one source shows no source button", async ({ browser }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await loadOnTv(phone, withSources([{ url: "/fixtures/sample.mp4" }]));
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect(tv.getByTestId("tv-source-btn")).toHaveCount(0);
    await expect(phone.getByTestId("chip-source")).toHaveCount(0);
  });
});

test.describe("feedback", () => {
  test("a change is said on the TV and on the phone, whoever asked for it", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await loadOnTv(phone, seriesMedia(baseURL!));
    await expect(phone.getByTestId("media-title")).toBeVisible();
    await tv.evaluate(() => void (document.querySelector("video")!.currentTime = 5));

    await phone.getByTestId("chip-speed").click();
    await phone.getByTestId("speed-1.5").click();
    await expect(tv.getByTestId("tv-toast")).toHaveText("Speed 1.5×");
    await expect(phone.getByTestId("speed-1.5")).toHaveAttribute("aria-selected", "true");
    await expect(phone.getByTestId("toast")).toHaveCount(0);
    await phone.getByTestId("sheet-close").click();

    await tv.keyboard.press("c");
    await expect(tv.getByTestId("tv-toast")).toHaveText("Subtitles: Dutch");
    await expect(phone.getByTestId("toast")).toHaveText("Subtitles: Dutch");
    await tv.keyboard.press("c");
    await expect(tv.getByTestId("tv-toast")).toHaveText("Subtitles off");
  });

  test("with reduced motion asked for, a line the phone shows is there for its time, and not faded out the moment it comes", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await loadOnTv(phone, seriesMedia(baseURL!));
    await expect(phone.getByTestId("media-title")).toBeVisible();
    await phone.emulateMedia({ reducedMotion: "reduce" });
    await tv.evaluate(() => void (document.querySelector("video")!.currentTime = 5));
    await tv.keyboard.press("c");
    const toast = phone.getByTestId("toast");
    await expect(toast).toHaveText("Subtitles: Dutch");
    await expect(toast).toHaveCSS("opacity", "1");
  });

  test("nothing is announced when a video starts", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: seriesMedia(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await tv.waitForTimeout(1200);
    await expect(tv.getByTestId("tv-toast")).toHaveCount(0);
    phone.close();
  });
});

test.describe("the episode before", () => {
  test("the TV has a Previous button and the P key, and plays the earlier episode", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: seriesMedia(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect(tv.getByTestId("tv-prev-btn")).toContainText("Pilot");

    await tv.keyboard.press("p");
    await expect(tv.getByTestId("tv-title")).toHaveText("Fixture Movie (HTML5 video)", { timeout: 15_000 });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", /playing|paused/);
    phone.close();
  });

  test("the TV's Previous button works with a click", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: seriesMedia(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await tv.getByTestId("tv-prev-btn").click();
    await expect(tv.getByTestId("tv-title")).toHaveText("Fixture Movie (HTML5 video)", { timeout: 15_000 });
    phone.close();
  });

  test("the phone's Previous button plays the earlier episode, and the first episode has none", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    const first = seriesMedia(baseURL!);
    await loadOnTv(phone, { ...first, series: { ...first.series!, episode: 1 } });
    await expect(phone.getByTestId("media-title")).toBeVisible();
    await expect(phone.getByTestId("previous-episode")).toHaveCount(0);
    await expect(tv.getByTestId("tv-prev-btn")).toHaveCount(0);

    await loadOnTv(phone, first);
    await expect(phone.getByTestId("previous-episode")).toContainText("Pilot");
    await phone.getByTestId("previous-episode").click();
    await expect(phone.getByTestId("media-title")).toHaveText("Fixture Movie (HTML5 video)");
    await expect(tvRoot(tv)).toHaveAttribute("data-state", /playing|paused/);
  });
});

test.describe("full screen", () => {
  const isFullScreen = (tv: Page) => tv.evaluate(() => document.fullscreenElement !== null);

  const filmsOf = (baseURL: string) => ({ updatedAt: Date.now(), rows: [{ id: "r", title: "Films", source: "Test", items: [{ id: "a", title: "The Sample", url: sample(baseURL) }] }] });
  async function firstVisit(browser: Browser, baseURL: string) {
    const couch = { cookies: [], origins: [{ origin: new URL(baseURL).origin, localStorage: [{ name: "kino.fit", value: "couch" }] }] };
    const tv = await openDevice(browser, { viewport: { width: 1280, height: 720 }, storageState: couch }, {}, withLibrary(filmsOf(baseURL)));
    await tv.goto("/tv");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    return tv;
  }

  test("a computer's first visit is only greeted: nothing waits for a press, a click is a click, and the corner's button goes full screen", async ({ browser, baseURL }) => {
    const pc = await openDevice(browser, { viewport: { width: 1280, height: 720 }, storageState: FIRST_VISIT }, {}, withLibrary(filmsOf(baseURL!)));
    await pc.goto("/tv");
    await expect(pc.getByTestId("tv-browse")).toBeVisible();
    expect(await pc.evaluate(() => document.documentElement.dataset.fit)).toBe("desk");
    await expect(pc.getByTestId("welcome-enter")).toHaveCount(0);
    await expect(pc.getByTestId("tv-welcome")).toHaveCount(0, { timeout: 4_000 });
    await pc.getByTestId("tv-browse-tile").first().click();
    await expect(pc.getByTestId("tv-detail")).toBeVisible();
    await pc.waitForTimeout(400);
    expect(await isFullScreen(pc)).toBe(false);
    await pc.keyboard.press("Escape");
    await pc.getByTestId("fullscreen-toggle").click();
    await expect.poll(() => isFullScreen(pc)).toBe(true);
  });

  test("the waiting welcome says in a line what the site is", async ({ browser, baseURL }) => {
    const tv = await firstVisit(browser, baseURL!);
    await expect(tv.getByTestId("welcome-about")).toHaveText(en["tv.welcomeAbout"]);
    await expect(tv.getByTestId("welcome-about")).toBeInViewport({ ratio: 1 });
  });

  test("a screen's welcome waits with a button for the press that takes it full screen, and it is left alone after that", async ({ browser, baseURL }) => {
    const tv = await firstVisit(browser, baseURL!);
    const welcome = tv.getByTestId("tv-welcome");
    await expect(welcome).toBeVisible();
    await expect(tv.getByTestId("welcome-enter")).toHaveText(en["tv.welcomeStart"]);
    await tv.waitForTimeout(2400);
    await expect(welcome).toBeVisible();
    expect(await isFullScreen(tv)).toBe(false);

    await tv.keyboard.press("Enter");
    await expect.poll(() => isFullScreen(tv)).toBe(true);
    await expect(welcome).toHaveCount(0, { timeout: 4_000 });
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();

    await playFirst(tv);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");

    await tv.keyboard.press("f");
    await expect.poll(() => isFullScreen(tv)).toBe(false);
    await tv.keyboard.press("Escape");
    await expect(tv.locator("[data-testid='tv-browse-tile']:focus")).toHaveAttribute("title", "The Sample");
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    expect(await isFullScreen(tv)).toBe(false);
  });

  test("a click anywhere on the waiting welcome goes full screen too, and does not press what is under it", async ({ browser, baseURL }) => {
    const tv = await firstVisit(browser, baseURL!);
    await expect(tv.getByTestId("welcome-enter")).toBeVisible();
    const tile = (await tv.getByTestId("tv-browse-tile").first().boundingBox())!;
    await tv.mouse.click(tile.x + tile.width / 2, tile.y + tile.height / 2);
    await expect.poll(() => isFullScreen(tv)).toBe(true);
    await expect(tv.getByTestId("tv-welcome")).toHaveCount(0, { timeout: 4_000 });
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
  });

  for (const how of ["key", "click"] as const) {
    test(`the first ${how === "key" ? "key press" : "click"} on the welcome asks the browser for full screen once: nothing is refused, so the console has nothing to say`, async ({ browser, baseURL }) => {
      const tv = await firstVisit(browser, baseURL!);
      const complaints: string[] = [];
      tv.on("console", (message) => message.text().includes("requestFullscreen") && complaints.push(message.text()));
      await expect(tv.getByTestId("welcome-enter")).toBeVisible();
      if (how === "key") await tv.keyboard.press("Enter");
      else await tv.getByTestId("welcome-enter").click();
      await expect.poll(() => isFullScreen(tv)).toBe(true);
      await expect(tv.getByTestId("tv-welcome")).toHaveCount(0, { timeout: 4_000 });
      expect(complaints).toEqual([]);
    });
  }

  test("Back lets the waiting welcome go, and the library is as it was", async ({ browser, baseURL }) => {
    const tv = await firstVisit(browser, baseURL!);
    await expect(tv.getByTestId("welcome-enter")).toBeVisible();
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-welcome")).toHaveCount(0, { timeout: 4_000 });
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
  });

  test("on a phone the welcome only greets: nothing waits for a tap, and a tap does not go full screen", async ({ browser, baseURL }) => {
    const phone = await openDevice(browser, { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, hasTouch: true, storageState: FIRST_VISIT }, {}, withLibrary(filmsOf(baseURL!)));
    await phone.goto("/tv");
    await expect(phone.getByTestId("tv-browse")).toBeVisible();
    await expect(phone.getByTestId("welcome-enter")).toHaveCount(0);
    await expect(phone.getByTestId("tv-welcome")).toHaveCount(0, { timeout: 4_000 });
    await phone.getByTestId("tv-browse-tile").first().tap();
    await expect(phone.getByTestId("tv-detail")).toBeVisible();
    await phone.waitForTimeout(400);
    expect(await isFullScreen(phone)).toBe(false);
  });

  test("a video that a phone starts while the welcome waits takes the screen from it", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await tv.evaluate(() => localStorage.removeItem("kino.fullscreen.left"));
    await tv.reload();
    await expect(tv.getByTestId("welcome-enter")).toBeVisible();
    await phone.getByTestId("url-input").fill(sample(baseURL!));
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await expect(tv.getByTestId("tv-welcome")).toHaveCount(0);
  });

  test("what the viewer chose is kept for the next visit: leaving stays left, and going in by the button opens full screen again", async ({ browser, baseURL }) => {
    const tv = await firstVisit(browser, baseURL!);
    await tv.keyboard.press("ArrowRight");
    await expect.poll(() => isFullScreen(tv)).toBe(true);
    const button = tv.getByTestId("fullscreen-toggle");
    await expect(button).toHaveAttribute("aria-label", "Exit full screen");

    await button.click();
    await expect.poll(() => isFullScreen(tv)).toBe(false);
    await expect(button).toHaveAttribute("aria-label", "Full screen");
    await tv.reload();
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await tv.keyboard.press("ArrowRight");
    await tv.waitForTimeout(600);
    expect(await isFullScreen(tv)).toBe(false);

    await tv.getByTestId("fullscreen-toggle").click();
    await expect.poll(() => isFullScreen(tv)).toBe(true);
    await tv.reload();
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await tv.keyboard.press("ArrowRight");
    await expect.poll(() => isFullScreen(tv)).toBe(true);
  });

  test("the library's corner has a full screen button beside the account button, and the arrow keys reach it", async ({ browser, baseURL }) => {
    const tv = await openLibrary(browser, withLibrary(filmsOf(baseURL!)));
    const chip = tv.getByTestId("tv-account-chip");
    const button = tv.getByTestId("fullscreen-toggle");
    const [chipBox, buttonBox] = [(await chip.boundingBox())!, (await button.boundingBox())!];
    expect(buttonBox.x).toBeGreaterThanOrEqual(chipBox.x + chipBox.width);
    expect(Math.abs(buttonBox.height - chipBox.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(buttonBox.y - chipBox.y)).toBeLessThanOrEqual(1);

    for (let up = 0; up < 3 && !(await chip.evaluate((element) => element === document.activeElement)); up++) await tv.keyboard.press("ArrowUp");
    await expect(chip).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(button).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect.poll(() => isFullScreen(tv)).toBe(true);
    await expect(button).toHaveAttribute("aria-label", "Exit full screen");
    await tv.keyboard.press("Enter");
    await expect.poll(() => isFullScreen(tv)).toBe(false);
    await tv.keyboard.press("ArrowLeft");
    await expect(chip).toBeFocused();
  });

  test("the remote does not go full screen by itself, but has the button on its first screen and in its menu", async ({ browser }) => {
    const first = await openDevice(browser, { ...PHONE, storageState: REMOTE_FIRST_VISIT });
    await first.goto("/");
    await first.getByTestId("code-input").tap();
    await first.waitForTimeout(600);
    expect(await isFullScreen(first)).toBe(false);
    const [toggleBox, accountBox] = [(await first.getByTestId("fullscreen-toggle").boundingBox())!, (await first.getByTestId("account-button").boundingBox())!];
    expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(accountBox.x);
    await first.getByTestId("fullscreen-toggle").tap();
    await expect.poll(() => isFullScreen(first)).toBe(true);
    await expect(first.getByTestId("fullscreen-toggle")).toHaveAttribute("aria-label", "Exit full screen");

    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.getByTestId("menu").click();
    const row = phone.getByTestId("menu-sheet").getByTestId("fullscreen-toggle");
    await expect(row).toHaveText(en["phone.fullscreen"]);
    await row.click();
    await expect.poll(() => isFullScreen(phone)).toBe(true);
    await expect(row).toHaveText(en["phone.exitFullscreen"]);
    expect(await isFullScreen(tv)).toBe(false);
  });

  test("the phone's button leaves full screen, and asks for an OK press on the TV to come back", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.getByTestId("url-input").fill(sample(baseURL!));
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await tv.keyboard.press("f");
    const button = phone.getByTestId("fullscreen");
    await expect(button).toHaveText("Exit full screen");

    await tv.waitForTimeout(5500);
    await button.click();
    await expect(button).toHaveText("Full screen");

    await button.click();
    await expect(tv.getByTestId("fs-prompt")).toBeVisible();
    await expect(phone.getByTestId("fs-hint")).toBeVisible();
    await expect(button).toHaveText("Full screen");

    await tv.keyboard.press("Enter");
    await expect(button).toHaveText("Exit full screen");
    expect(await isFullScreen(tv)).toBe(true);
    await expect(tv.getByTestId("fs-prompt")).toHaveCount(0);
    await expect(phone.getByTestId("fs-hint")).toHaveCount(0);
  });
});

test.describe("watching together", () => {
  const video = (tv: Page) =>
    tv.evaluate(() => ({ paused: document.querySelector("video")!.paused, time: document.querySelector("video")!.currentTime }));

  async function party(browser: Parameters<typeof openTv>[0]) {
    const leader = await openTv(browser);
    const phone = await openPairedPhone(browser, leader);
    const follower = await openTv(browser);
    const code = await readPairingCode(follower);
    await phone.getByTestId("menu").click();
    await phone.getByTestId("party-open").click();
    await phone.getByTestId("party-code").fill(code);
    return { leader, phone, follower };
  }

  test("a second TV added by the phone plays along, and pauses and skips with it", async ({ browser, baseURL }) => {
    const { leader, phone, follower } = await party(browser);
    await expect(follower.getByTestId("tv-following")).toContainText(await phone.getByTestId("tv-name").innerText());
    await expect(phone.getByTestId("party-tv")).toHaveCount(1);
    await expect(phone.getByTestId("party-code")).toHaveValue("");
    await phone.getByTestId("sheet-close").click();
    await expect(phone.getByTestId("party-count")).toHaveText("+1");

    await phone.getByTestId("url-input").fill(sample(baseURL!));
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(leader)).toHaveAttribute("data-state", "playing");
    await expect(tvRoot(follower)).toHaveAttribute("data-state", "playing");
    await expect(follower.getByTestId("tv-follow-bar")).toBeVisible();

    await phone.getByTestId("pause").click();
    await expect(tvRoot(leader)).toHaveAttribute("data-state", "paused");
    await expect.poll(async () => (await video(follower)).paused).toBe(true);

    await phone.getByRole("button", { name: "Forward 10 seconds" }).click();
    const at = await tvTime(leader);
    await expect.poll(async () => Math.abs((await video(follower)).time - at), { timeout: 10_000 }).toBeLessThan(1);

    await phone.getByTestId("play").click();
    await expect.poll(async () => (await video(follower)).paused).toBe(false);
    await expect
      .poll(async () => Math.abs((await video(follower)).time - (await video(leader)).time), { timeout: 10_000 })
      .toBeLessThan(1.5);
  });

  test("a screen tells the server how long its round trip takes, from the moment it connects", async ({ browser }) => {
    const pings: string[] = [];
    const tv = await openLibrary(browser, async (context) => {
      context.on("page", (page) =>
        page.on("websocket", (socket) =>
          socket.on("framesent", (frame) => {
            if (typeof frame.payload === "string" && frame.payload.includes('"PING"')) pings.push(frame.payload);
          }),
        ),
      );
    });
    await expect.poll(() => pings.length).toBeGreaterThan(0);
    await expect
      .poll(async () => {
        await tv.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
        return pings.some((ping) => /"rtt":\d+/.test(ping));
      })
      .toBe(true);
  });

  test("a guest aims where the host is now: it plays ahead of the position it is sent by the age it is told that has", async ({ browser, baseURL }) => {
    const leader = await openTv(browser);
    const phone = await openPairedPhone(browser, leader);
    const follower = await openLibrary(browser, async (context) => {
      await context.routeWebSocket(/\/ws$/, (page) => {
        const server = page.connectToServer();
        page.onMessage((message) => server.send(message));
        server.onMessage((message) => {
          const report = typeof message === "string" ? (JSON.parse(message) as { type?: string }) : null;
          page.send(report?.type === "TV_SYNC" ? JSON.stringify({ ...report, lag: 1.5 }) : message);
        });
        page.onClose((code, reason) => void server.close({ code, reason }));
        server.onClose((code, reason) => void page.close({ code, reason }));
      });
    });
    await follower.getByTestId("rail-connect").click();
    await phone.getByTestId("menu").click();
    await phone.getByTestId("party-open").click();
    await phone.getByTestId("party-code").fill(await readPairingCode(follower));
    await expect(phone.getByTestId("party-tv")).toHaveCount(1);
    await phone.getByTestId("sheet-close").click();

    await phone.getByTestId("url-input").fill(`${baseURL}/fixtures/long.mp4`);
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(follower)).toHaveAttribute("data-state", "playing");
    await expect
      .poll(async () => (await video(follower)).time - (await video(leader)).time, { timeout: 15_000, message: "the guest settles about 1.5 s ahead of the host" })
      .toBeGreaterThan(1.1);
    expect((await video(follower)).time - (await video(leader)).time).toBeLessThan(2.1);
  });

  test("a screen that has the host's film on when the party takes it in loads that film again, however close the two messages come", async ({ browser, baseURL }) => {
    const sockets: WebSocketRoute[] = [];
    const tv = await openLibrary(browser, async (context) => {
      await context.routeWebSocket(/\/ws$/, (page) => {
        sockets.push(page);
        const server = page.connectToServer();
        page.onMessage((message) => server.send(message));
        server.onMessage((message) => page.send(message));
        page.onClose((code, reason) => void server.close({ code, reason }));
        server.onClose((code, reason) => void page.close({ code, reason }));
      });
    });
    await tv.getByTestId("rail-connect").click();
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    const media: NormalizedMedia = { title: "Same Film", stream: { url: "/fixtures/sample.mp4", type: "mp4" } };
    phone.cmd({ type: "LOAD", media });
    phone.cmd({ type: "PLAY" });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });

    sockets.at(-1)!.send(JSON.stringify({ type: "TV_FOLLOWING", leader: "Sam" }));
    sockets.at(-1)!.send(JSON.stringify({ type: "TV_CMD", command: { type: "LOAD", media } }));
    await expect(tvRoot(tv)).toHaveAttribute("data-state", /paused|playing/, { timeout: 15_000 });
    expect(await tv.evaluate(() => document.querySelector("video")!.currentSrc)).toContain("/fixtures/sample.mp4");
    phone.close();
  });

  test("a follower has no controls of its own: keys do nothing, and the phone's stop ends it for both", async ({ browser, baseURL }) => {
    const { leader, phone, follower } = await party(browser);
    await phone.getByTestId("sheet-close").click();
    await phone.getByTestId("url-input").fill(sample(baseURL!));
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(follower)).toHaveAttribute("data-state", "playing");

    await follower.keyboard.press("Space");
    await follower.waitForTimeout(1500);
    await expect(tvRoot(follower)).toHaveAttribute("data-state", "playing");
    await expect(leader.getByTestId("tv-play-btn")).toHaveCount(1);
    await expect(follower.getByTestId("tv-play-btn")).toHaveCount(0);

    await follower.keyboard.press("ArrowUp");
    await expect(follower.locator(".hud-controls button").first()).toBeFocused();
    await phone.getByTestId("pause").click();
    await expect(follower.getByTestId("tv-held")).toHaveText(/^Paused by TV /);

    await phone.getByTestId("stop").click();
    await expect(tvRoot(leader)).toHaveAttribute("data-state", "idle");
    await expect(tvRoot(follower)).toHaveAttribute("data-state", "idle");
    await expect(follower.getByTestId("tv-following")).toBeVisible();
    await expect(follower.getByTestId("tv-back-to-library")).toHaveCount(0);
    await expect(follower.getByTestId("tv-browse")).toHaveCount(0);
    await expect(follower.getByTestId("tv-disconnect")).toHaveText("Stop watching along");
  });

  test("when the host's film has played to its end the card of a screen that watches along says it is finished, not that somebody paused it", async ({ browser, baseURL }) => {
    const { leader, phone, follower } = await party(browser);
    await phone.getByTestId("sheet-close").click();
    await phone.getByTestId("url-input").fill(sample(baseURL!));
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(follower)).toHaveAttribute("data-state", "playing");

    await leader.evaluate(() => {
      const video = document.querySelector("video")!;
      video.currentTime = video.duration - 1.2;
    });
    await expect(leader.getByTestId("tv-end")).toBeVisible({ timeout: 15_000 });
    await expect(follower.getByTestId("tv-held")).toHaveText("Finished", { timeout: 15_000 });
  });

  test("a TV added while a film is playing starts at the same place", async ({ browser, baseURL }) => {
    const leader = await openTv(browser);
    const phone = await openPairedPhone(browser, leader);
    await phone.getByTestId("url-input").fill(sample(baseURL!));
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(leader)).toHaveAttribute("data-state", "playing");
    await phone.getByTestId("pause").click();
    await phone.getByRole("button", { name: "Forward 10 seconds" }).click();
    await phone.getByRole("button", { name: "Forward 10 seconds" }).click();
    await expect.poll(() => tvTime(leader)).toBeGreaterThan(19);

    const follower = await openTv(browser);
    await phone.getByTestId("menu").click();
    await phone.getByTestId("party-open").click();
    await phone.getByTestId("party-code").fill(await readPairingCode(follower));
    await expect(tvRoot(follower)).toHaveAttribute("data-state", "paused", { timeout: 15_000 });
    await expect.poll(async () => Math.abs((await video(follower)).time - (await tvTime(leader))), { timeout: 10_000 }).toBeLessThan(1);
  });

  test("the phone can send a TV away, and a follower can leave by itself", async ({ browser, baseURL }) => {
    const { leader, phone, follower } = await party(browser);
    await expect(phone.getByTestId("party-tv")).toHaveCount(1);
    await phone.getByTestId("party-remove").click();
    await expect(phone.getByTestId("party-tv")).toHaveCount(0);
    await expect(follower.getByTestId("pairing-code")).toBeVisible();
    await expect(tvRoot(leader)).toHaveAttribute("data-state", "idle");

    await phone.getByTestId("party-code").fill(await readPairingCode(follower));
    await expect(phone.getByTestId("party-tv")).toHaveCount(1);
    await phone.getByTestId("sheet-close").click();
    await phone.getByTestId("url-input").fill(sample(baseURL!));
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(follower)).toHaveAttribute("data-state", "playing");
    await follower.keyboard.press("ArrowDown");
    await expect(follower.locator(".hud-controls button").first()).toBeFocused();
    for (let i = 0; i < 5 && !(await follower.getByTestId("tv-leave").evaluate((el) => el === document.activeElement)); i++) {
      await follower.keyboard.press("ArrowRight");
    }
    await expect(follower.getByTestId("tv-leave")).toBeFocused();
    await follower.keyboard.press("Enter");
    await expect(follower.getByTestId("pairing-code")).toBeVisible();
    await expect(tvRoot(leader)).toHaveAttribute("data-state", "playing");
    await expect(phone.getByTestId("party-count")).toHaveCount(0);
  });

  test("the phone makes a TV of its party an admin, which then steers the film, and takes that back", async ({ browser, baseURL }) => {
    const { leader, phone, follower } = await party(browser);
    await expect(phone.getByTestId("party-tv")).toHaveCount(1);
    await expect(phone.getByTestId("party-admin")).toHaveText("Make admin");
    await phone.getByTestId("party-admin").click();
    await expect(phone.getByTestId("party-admin")).toHaveText("Remove admin");
    await expect(phone.getByTestId("party-tv")).toContainText("Admin");
    await phone.getByTestId("sheet-close").click();

    await phone.getByTestId("url-input").fill(sample(baseURL!));
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(follower)).toHaveAttribute("data-state", "playing");
    await follower.mouse.move(60, 60);
    await follower.getByTestId("tv-admin-play").click();
    await expect(tvRoot(leader)).toHaveAttribute("data-state", "paused");
    await expect(phone.getByTestId("play")).toBeVisible();

    await phone.getByTestId("menu").click();
    await phone.getByTestId("party-open").click();
    await phone.getByTestId("party-admin").click();
    await expect(phone.getByTestId("party-admin")).toHaveText("Make admin");
    await expect(phone.getByTestId("party-tv")).not.toContainText("Admin");
    await expect(follower.getByTestId("tv-admin-bar")).toHaveCount(0);
  });

  test("End party sends every TV away at once", async ({ browser }) => {
    const { leader, phone, follower } = await party(browser);
    await expect(phone.getByTestId("party-tv")).toHaveCount(1);
    await phone.getByTestId("party-end").click();
    await expect(phone.getByTestId("party-tv")).toHaveCount(0);
    await expect(phone.getByTestId("party-end")).toHaveCount(0);
    await expect(follower.getByTestId("pairing-code")).toBeVisible();
    await expect(tvRoot(leader)).toHaveAttribute("data-state", "idle");
  });

  test("a wrong code is refused in the sheet", async ({ browser }) => {
    const leader = await openTv(browser);
    const phone = await openPairedPhone(browser, leader);
    await phone.getByTestId("menu").click();
    await phone.getByTestId("party-open").click();
    await phone.getByTestId("party-code").fill("000000");
    await expect(phone.getByTestId("party-error")).toBeVisible();
    await expect(phone.getByTestId("party-tv")).toHaveCount(0);
  });
});

test.describe("a watch party started on a TV", () => {
  const films = (baseURL: string) => ({
    updatedAt: Date.now(),
    rows: [{ id: "r", title: "Films", source: "Test", items: [{ id: "a", title: "The Sample", url: `${baseURL}/fixtures/sample.mp4` }] }],
  });
  const video = (tv: Page) => tv.evaluate(() => ({ paused: document.querySelector("video")!.paused, time: document.querySelector("video")!.currentTime, rate: document.querySelector("video")!.playbackRate }));
  const screen = (browser: Browser, baseURL: string) => openLibrary(browser, withLibrary(films(baseURL)));
  const codeOf = async (host: Page) => (await host.getByTestId("tv-party-code").innerText()).replace(/\s/g, "");
  async function startParty(host: Page): Promise<string> {
    await pressMenuLine(host, "rail-party");
    await host.getByTestId("tv-party-start").click();
    return codeOf(host);
  }
  async function joinWith(guest: Page, code: string) {
    await pressMenuLine(guest, "rail-party");
    await guest.getByTestId("tv-party-join").click();
    await guest.keyboard.type(code);
  }
  async function party(browser: Browser, baseURL: string) {
    const host = await screen(browser, baseURL);
    const code = await startParty(host);
    const guest = await screen(browser, baseURL);
    await joinWith(guest, code);
    await expect(guest.getByTestId("tv-following")).toBeVisible();
    return { host, guest, code };
  }

  test("a TV starts a party from the library's menu, another joins with the code, and both see who is in", async ({ browser, baseURL }) => {
    const { host, guest } = await party(browser, baseURL!);
    for (const tv of [host, guest]) await expect(tv.getByTestId("tv-party-member")).toHaveCount(2);
    await expect(host.getByTestId("tv-party-member").first()).toContainText("you");
    await expect(guest.getByTestId("tv-party-member").first()).toContainText("Host");
    await expect(guest.getByTestId("tv-party-member").nth(1)).toContainText("you");
    await expect(guest.getByTestId("tv-following")).toContainText(await host.getByTestId("tv-party-member").first().locator(".tv-party-name").innerText());

    await host.getByTestId("tv-back-to-library").click();
    await expect(host.getByTestId("rail-party")).toHaveAttribute("data-badged", "true");
  });

  test("what the host plays plays on the guest, and its pause and speed carry over", async ({ browser, baseURL }) => {
    const { host, guest } = await party(browser, baseURL!);
    await host.getByTestId("tv-back-to-library").click();
    await playFirst(host);
    await expect(tvRoot(host)).toHaveAttribute("data-state", "playing");
    await expect(tvRoot(guest)).toHaveAttribute("data-state", "playing");
    await expect(guest.getByTestId("tv-follow-bar")).toBeVisible();
    await expect(guest.getByTestId("tv-play-btn")).toHaveCount(0);

    await host.keyboard.press("Space");
    await expect(tvRoot(host)).toHaveAttribute("data-state", "paused");
    await expect.poll(async () => (await video(guest)).paused).toBe(true);

    await host.mouse.move(60, 60);
    await host.getByTestId("tv-speed-btn").click();
    await host.getByRole("option", { name: "1.5×" }).click();
    await expect.poll(async () => (await video(guest)).rate, { timeout: 10_000 }).toBeGreaterThan(1.3);
  });

  test("a party can be started from a film, and a screen that joins later starts where the host is", async ({ browser, baseURL }) => {
    const host = await screen(browser, baseURL!);
    await playFirst(host);
    await expect(tvRoot(host)).toHaveAttribute("data-state", "playing");
    await host.mouse.move(60, 60);
    await host.getByTestId("tv-party-btn").click();
    await expect(host.getByTestId("tv-party-panel")).toBeVisible();
    await host.getByTestId("tv-party-start").click();
    await expect(host.getByTestId("tv-party-code")).toBeVisible();
    await expect(host.getByTestId("tv-party-done")).toBeFocused();
    const code = await codeOf(host);

    const guest = await screen(browser, baseURL!);
    await joinWith(guest, code);
    await expect(tvRoot(guest)).toHaveAttribute("data-state", /playing|paused/, { timeout: 15_000 });
    await expect.poll(async () => Math.abs((await video(guest)).time - (await video(host)).time), { timeout: 10_000 }).toBeLessThan(2.5);
    await expect(host.getByTestId("tv-party-member")).toHaveCount(2);

    await host.keyboard.press("Escape");
    await expect(host.getByTestId("tv-party-panel")).toHaveCount(0);
    await host.mouse.move(80, 80);
    await expect(host.getByTestId("tv-party-btn")).toContainText("2 devices");
  });

  test("the invite has the party's link with a button that copies it, on the page and in the panel over a film, and the remote reaches it", async ({ browser, baseURL }) => {
    const host = await screen(browser, baseURL!);
    await host.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const clipboard = () => host.evaluate(() => navigator.clipboard.readText());
    const copy = host.getByTestId("tv-party-link-copy");
    const code = await startParty(host);
    const link = new URL(`/?party=${code}`, host.url()).href;

    await expect(host.getByTestId("tv-party-link-url")).toHaveText(link);
    await expect(host.getByTestId("tv-back-to-library")).toBeFocused();
    await host.keyboard.press("ArrowDown");
    await expect(copy).toBeFocused();
    await host.keyboard.press("Enter");
    await expect(copy).toHaveText("Link copied");
    expect(await clipboard()).toBe(link);
    await expect(copy).toBeFocused();
    await expect(copy).toHaveText("Copy link");

    await host.getByTestId("tv-back-to-library").click();
    await playFirst(host);
    await expect(tvRoot(host)).toHaveAttribute("data-state", "playing");
    await host.mouse.move(60, 60);
    await host.getByTestId("tv-party-btn").click();
    await expect(host.getByTestId("tv-party-done")).toBeFocused();
    await expect(host.getByTestId("tv-party-link-url")).toHaveText(link);
    await host.keyboard.press("ArrowLeft");
    await expect(copy).toBeFocused();
    await host.evaluate(() => navigator.clipboard.writeText("something else"));
    await host.keyboard.press("Enter");
    await expect(copy).toHaveText("Link copied");
    expect(await clipboard()).toBe(link);
    await host.keyboard.press("ArrowRight");
    await expect(host.getByTestId("tv-party-done")).toBeFocused();
  });

  test("there is no link before a party is started, and a browser that refuses to copy it says so and selects it instead", async ({ browser, baseURL }) => {
    const host = await screen(browser, baseURL!);
    await host.getByTestId("rail-party").click();
    await expect(host.getByTestId("tv-party-link")).toHaveCount(0);

    await host.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      document.execCommand = () => false;
    });
    await host.reload();
    await host.getByTestId("rail-party").click();
    await host.getByTestId("tv-party-start").click();
    await host.getByTestId("tv-party-link-copy").click();
    await expect(host.getByTestId("tv-party-link").getByRole("status")).toHaveText("Could not copy: select the link and copy it");
    expect(await host.evaluate(() => window.getSelection()?.toString())).toBe(await host.getByTestId("tv-party-link-url").innerText());
  });

  test("a guest keeps its own subtitles: the host's stay as they are", async ({ browser, baseURL }) => {
    const host = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(host));
    await expect(host.getByTestId("tv-paired")).toBeVisible();
    await host.getByTestId("tv-back-to-library").click();
    const code = await startParty(host);
    const guest = await screen(browser, baseURL!);
    await joinWith(guest, code);
    await expect(guest.getByTestId("tv-following")).toBeVisible();

    phone.cmd({ type: "LOAD", media: seriesMedia(baseURL!) });
    await expect(tvRoot(guest)).toHaveAttribute("data-state", "paused", { timeout: 15_000 });
    await guest.mouse.move(60, 60);
    await guest.getByTestId("tv-audio-sub-btn").click();
    await expect(guest.getByTestId("audio-subtitles-modal")).toBeVisible();
    await guest.getByRole("option", { name: "Dutch" }).click();
    await expect(guest.getByRole("option", { name: "Dutch" })).toHaveAttribute("aria-selected", "true");
    await guest.waitForTimeout(800);
    expect(phone.states.at(-1)?.subtitles?.current).toBe(0);
    phone.close();
  });

  test("a guest picks the quality of its own picture, from its own controls: the host's is left as it was", async ({ browser, baseURL }) => {
    const host = await openLibrary(browser, twoSizes);
    await host.getByTestId("rail-connect").click();
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(host));
    await expect(host.getByTestId("tv-paired")).toBeVisible();
    await host.getByTestId("tv-back-to-library").click();
    const code = await startParty(host);
    const guest = await openLibrary(browser, twoSizes);
    await joinWith(guest, code);
    await expect(guest.getByTestId("tv-following")).toBeVisible();

    phone.cmd({ type: "LOAD", media: { title: "Two sizes", stream: { url: "/fixtures/hls/multi.m3u8", type: "hls" } } });
    await expect(tvRoot(guest)).toHaveAttribute("data-state", "paused", { timeout: 15_000 });
    await guest.mouse.move(60, 60);
    const quality = guest.getByTestId("tv-quality-btn");
    await expect(quality).toHaveText(/^Auto/);
    await quality.click();
    await guest.getByRole("option", { name: "720p" }).click();
    await expect(quality).toHaveText("720p");
    await expect.poll(() => phone.states.at(-1)?.quality?.current).toBe(-1);

    await guest.getByRole("option", { name: "Auto" }).click();
    await expect(quality).toHaveText(/^Auto/);
    phone.close();
  });

  test("what a guest watches along is not put in its own Continue watching: it is the host's to continue", async ({ browser, baseURL }) => {
    const host = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(host));
    await expect(host.getByTestId("tv-paired")).toBeVisible();
    await host.getByTestId("tv-back-to-library").click();
    const code = await startParty(host);
    const guest = await screen(browser, baseURL!);
    await joinWith(guest, code);
    await expect(guest.getByTestId("tv-following")).toBeVisible();

    phone.cmd({ type: "LOAD", media: { ...seriesMedia(baseURL!), page: `${baseURL}/fixtures/pages/none.html` } });
    await expect(tvRoot(guest)).toHaveAttribute("data-state", "paused", { timeout: 15_000 });
    const cards = (tv: Page) => tv.evaluate(() => (JSON.parse(localStorage.getItem("kino.data.guest") ?? "null") as { data: { progress: unknown[] } } | null)?.data.progress.length ?? 0);
    await expect.poll(() => cards(host), { timeout: 10_000 }).toBe(1);
    await guest.waitForTimeout(1500);
    expect(await cards(guest)).toBe(0);
    phone.close();
  });

  test("a code that is wrong is refused, and the number pad starts over", async ({ browser, baseURL }) => {
    const guest = await screen(browser, baseURL!);
    await joinWith(guest, "000000");
    await expect(guest.getByTestId("tv-party-error")).toHaveText("Invalid or expired code.");
    const filled = guest.getByTestId("tv-party-digits").locator('[data-filled="true"]');
    await expect(filled).toHaveCount(0);

    for (const digit of "123") await guest.getByTestId(`pad-${digit}`).click();
    await expect(filled).toHaveCount(3);
    await guest.keyboard.press("Escape");
    await expect(filled).toHaveCount(2);
    await guest.keyboard.press("Escape");
    await guest.keyboard.press("Escape");
    await expect(guest.getByTestId("tv-party-start")).toHaveCount(0);
    await guest.keyboard.press("Escape");
    await expect(guest.getByTestId("tv-party-start")).toBeVisible();
  });

  test("the code's boxes take a click and a keyboard, as a text field does: Backspace takes a digit off there, and the remote still starts on the pad", async ({ browser, baseURL }) => {
    const host = await screen(browser, baseURL!);
    const code = await startParty(host);
    const guest = await screen(browser, baseURL!);
    await pressMenuLine(guest, "rail-party");
    await guest.getByTestId("tv-party-join").click();
    await expect(guest.getByTestId("pad-1")).toBeFocused();
    const boxes = guest.getByTestId("tv-party-digits");
    const filled = boxes.locator('[data-filled="true"]');

    await guest.keyboard.type("9");
    await expect(filled).toHaveCount(1);
    await guest.keyboard.press("Backspace");
    await expect(filled).toHaveCount(0);
    await expect(guest.getByTestId("tv-party-join-page")).toBeVisible();
    await guest.getByTestId("pad-2").focus();
    await guest.keyboard.press("ArrowUp");
    await expect(guest.getByTestId("tv-party-paste")).toBeFocused();
    await guest.keyboard.press("ArrowDown");
    await expect(guest.getByTestId("pad-2")).toBeFocused();

    const box = await boxes.boundingBox();
    expect(await guest.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("data-testid"), { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 })).toBe("tv-party-code-input");
    await guest.mouse.click(box!.x + box!.width / 4, box!.y + box!.height / 2);
    await expect(guest.getByTestId("tv-party-code-input")).toBeFocused();
    await expect(boxes.locator("i").nth(0)).toHaveAttribute("data-caret", "true");
    await guest.keyboard.type(code.slice(0, 2));
    await expect(filled).toHaveCount(2);
    await expect(boxes.locator("i").nth(2)).toHaveAttribute("data-caret", "true");
    await guest.keyboard.type("x");
    await expect(filled).toHaveCount(2);
    await guest.keyboard.press("Backspace");
    await expect(filled).toHaveCount(1);
    await expect(guest.getByTestId("tv-party-join-page")).toBeVisible();
    await guest.keyboard.type(code.slice(1));
    await expect(guest.getByTestId("tv-following")).toBeVisible();
  });

  test("a code is pasted: Ctrl+V on the page, or the Paste button; a link to the party gives its code, and what has no code says so", async ({ browser, baseURL }) => {
    const host = await screen(browser, baseURL!);
    const code = await startParty(host);
    const guest = await screen(browser, baseURL!);
    await guest.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL! });
    await pressMenuLine(guest, "rail-party");
    await guest.getByTestId("tv-party-join").click();
    const filled = guest.getByTestId("tv-party-digits").locator('[data-filled="true"]');
    const error = guest.getByTestId("tv-party-error");
    const ctrlV = (text: string) =>
      guest.evaluate((copied) => {
        const data = new DataTransfer();
        data.setData("text/plain", copied);
        (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      }, text);

    await ctrlV("see you at nine");
    await expect(error).toHaveText(en["party.pasteNone"]);
    await expect(filled).toHaveCount(0);
    await guest.evaluate(() => navigator.clipboard.writeText("no code in here"));
    await guest.getByTestId("tv-party-paste").click();
    await expect(error).toHaveText(en["party.pasteNone"]);
    await guest.getByTestId("pad-4").click();
    await expect(error).not.toHaveClass(/is-shown/);
    await guest.getByTestId("pad-delete").click();

    await guest.evaluate((link) => navigator.clipboard.writeText(`Join me: ${link}`), `${baseURL}/?party=${code}`);
    await guest.getByTestId("tv-party-paste").click();
    await expect(guest.getByTestId("tv-following")).toBeVisible();
  });

  test("a clipboard the page may not read says what to do instead: Ctrl+V where there is a keyboard, typing where there is only a finger", async ({ browser }) => {
    for (const [options, said] of [
      [{ viewport: { width: 1280, height: 720 } }, en["party.pasteRefused"]],
      [{ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, en["party.pasteRefusedTouch"]],
    ] as const) {
      const guest = await openDevice(browser, options);
      await guest.goto("/tv");
      await expect(guest.getByTestId("tv-browse")).toBeVisible();
      await pressMenuLine(guest, "rail-party");
      await guest.getByTestId("tv-party-join").click();
      await guest.getByTestId("tv-party-paste").click();
      await expect(guest.getByTestId("tv-party-error")).toHaveText(said);
      await expect(guest.getByTestId("tv-party-error")).toHaveClass(/is-note/);
      await guest.context().close();
    }
  });

  test("on a phone on its side, Paste is beside the boxes and the whole pad and Back are on the screen", async ({ browser }) => {
    const guest = await openDevice(browser, { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }, { "kino.lang": "ro" });
    await guest.goto("/tv");
    await expect(guest.getByTestId("tv-browse")).toBeVisible();
    await pressMenuLine(guest, "rail-party");
    await guest.getByTestId("tv-party-join").click();
    await expect(guest.getByTestId("tv-party-paste")).toBeVisible();
    const seen = await guest.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const boxes = box('[data-testid="tv-party-digits"]');
      const paste = box('[data-testid="tv-party-paste"]');
      return {
        beside: paste.left >= boxes.right && paste.top < boxes.bottom && paste.bottom > boxes.top,
        middle: Math.abs((boxes.left + boxes.right) / 2 - innerWidth / 2),
        lowest: Math.max(...[...document.querySelectorAll(".tv-pad .tv-key, [data-testid='tv-party-join-back']")].map((key) => key.getBoundingClientRect().bottom)),
        height: innerHeight,
      };
    });
    expect(seen.beside, "Paste on the boxes' line, to their right").toBe(true);
    expect(seen.middle, "the boxes still in the middle").toBeLessThan(2);
    expect(seen.lowest, "the pad's last row and Back on the screen").toBeLessThanOrEqual(seen.height);
  });

  test("Ctrl+V of the code as the host's screen shows it joins at once", async ({ browser, baseURL }) => {
    const host = await screen(browser, baseURL!);
    const code = await startParty(host);
    const guest = await screen(browser, baseURL!);
    await pressMenuLine(guest, "rail-party");
    await guest.getByTestId("tv-party-join").click();
    await guest.evaluate((copied) => {
      const data = new DataTransfer();
      data.setData("text/plain", copied);
      document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, `${code.slice(0, 3)} ${code.slice(3)}`);
    await expect(guest.getByTestId("tv-following")).toBeVisible();
  });

  test("the party's link joins a screen as soon as it is unlocked, and leaves nothing in the address", async ({ browser, baseURL }) => {
    const host = await screen(browser, baseURL!);
    const code = await startParty(host);
    const guest = await openDevice(browser, { viewport: { width: 1280, height: 720 } });
    await guest.addInitScript(() => {
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="tv-welcome"]')) (window as unknown as { welcomed: boolean }).welcomed = true;
      }).observe(document, { childList: true, subtree: true });
    });
    await guest.goto(`/?party=${code}`);
    await expect(guest.getByTestId("unlock")).toBeFocused();
    await expect(guest.getByTestId("tv-browse")).toHaveCount(0);
    await guest.keyboard.press("ArrowDown");
    await expect(guest.getByTestId("switch-to-remote")).toBeFocused();
    await guest.keyboard.press("ArrowUp");
    await expect(guest.getByTestId("unlock")).toBeFocused();
    await guest.keyboard.press("Enter");
    await expect(guest.getByTestId("tv-following")).toBeVisible();
    expect(new URL(guest.url()).search).toBe("");
    await expect(host.getByTestId("tv-party-member")).toHaveCount(2);
    expect(await guest.evaluate(() => (window as unknown as { welcomed?: boolean }).welcomed)).toBeFalsy();
  });

  test("a phone that opens the party's link becomes a screen of the party, not a remote", async ({ browser, baseURL }) => {
    const host = await screen(browser, baseURL!);
    const code = await startParty(host);
    const phone = await openDevice(browser, PHONE);
    await phone.goto(`/?party=${code}`);
    await phone.getByTestId("unlock").tap();
    await expect(phone.getByTestId("tv-following")).toBeVisible();
    await expect(host.getByTestId("tv-party-member")).toHaveCount(2);
  });

  test("the host sends a guest away, and the guest is told and cannot come back, with the code it had or with the party's new one", async ({ browser, baseURL }) => {
    const { host, guest, code } = await party(browser, baseURL!);
    await host.getByTestId("tv-party-remove").click();
    await expect(host.getByTestId("tv-party-member")).toHaveCount(1);
    await expect(guest.getByTestId("tv-following")).toHaveCount(0);
    await expect(guest.getByTestId("tv-flash")).toHaveText("You are no longer in the party.");
    await expect(guest.getByTestId("tv-party-start")).toBeVisible();

    await expect.poll(() => codeOf(host)).not.toBe(code);
    const fresh = await codeOf(host);
    await guest.getByTestId("tv-party-join").click();
    await guest.keyboard.type(code);
    await expect(guest.getByTestId("tv-party-error")).toHaveText("Invalid or expired code.");
    await guest.keyboard.type(fresh);
    await guest.waitForTimeout(1000);
    await expect(guest.getByTestId("tv-party-error")).toHaveText("Invalid or expired code.");
    await expect(guest.getByTestId("tv-following")).toHaveCount(0);
    await expect(host.getByTestId("tv-party-member")).toHaveCount(1);
  });

  test("the host makes a guest an admin: its buttons and keys steer the film for everyone, and taking that back puts them away", async ({ browser, baseURL }) => {
    const { host, guest } = await party(browser, baseURL!);
    await expect(guest.getByTestId("tv-party-admin")).toHaveCount(0);
    await host.getByTestId("tv-party-admin").click();
    await expect(host.getByTestId("tv-party-member").nth(1)).toContainText("Admin");
    await expect(host.getByTestId("tv-party-admin")).toHaveText("Remove admin");
    await expect(guest.getByTestId("tv-party-member").nth(1)).toContainText("Admin");

    await host.getByTestId("tv-back-to-library").click();
    await playFirst(host);
    await expect(tvRoot(guest)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    await expect(guest.getByTestId("tv-play-btn")).toHaveCount(0);

    await guest.mouse.move(60, 60);
    await guest.getByTestId("tv-admin-play").click();
    await expect(tvRoot(host)).toHaveAttribute("data-state", "paused");
    await expect.poll(async () => (await video(guest)).paused).toBe(true);
    const paused = await tvTime(host);
    await guest.getByTestId("tv-admin-forward").click();
    await expect.poll(() => tvTime(host)).toBeGreaterThan(paused + 8);
    await expect.poll(async () => Math.abs((await video(guest)).time - (await tvTime(host))), { timeout: 10_000 }).toBeLessThan(1.5);

    await guest.keyboard.press("Space");
    await expect(tvRoot(host)).toHaveAttribute("data-state", "playing");
    await expect.poll(async () => (await video(guest)).paused).toBe(false);
    const playing = await tvTime(host);
    await guest.keyboard.press("ArrowLeft");
    await expect.poll(() => tvTime(host), { timeout: 10_000 }).toBeLessThan(playing - 6);

    await guest.keyboard.press("ArrowDown");
    await expect(guest.getByTestId("tv-admin-play")).toBeFocused();

    await host.mouse.move(60, 60);
    await host.getByTestId("tv-party-btn").click();
    await host.getByTestId("tv-party-admin").click();
    await expect(host.getByTestId("tv-party-admin")).toHaveText("Make admin");
    await expect(guest.getByTestId("tv-admin-bar")).toHaveCount(0);
    await expect(guest.getByTestId("tv-follow-bar")).toBeVisible();
    await guest.keyboard.press("Space");
    await guest.waitForTimeout(1500);
    await expect(tvRoot(host)).toHaveAttribute("data-state", "playing");

    await host.getByTestId("tv-party-admin").click();
    await guest.mouse.move(60, 60);
    await guest.getByTestId("tv-admin-stop").click();
    await expect(tvRoot(host)).toHaveAttribute("data-state", "idle");
    await expect(tvRoot(guest)).toHaveAttribute("data-state", "idle");
    await expect(guest.getByTestId("tv-following")).toBeVisible();
  });

  test("an admin that is dragging the dot when the host takes its admin away lets go of it: the bar shows where the film is again, and does not stay where the dot was left", async ({ browser, baseURL }) => {
    const { host, guest } = await party(browser, baseURL!);
    await host.getByTestId("tv-party-admin").click();
    await expect(guest.getByTestId("tv-party-member").nth(1)).toContainText("Admin");
    await host.getByTestId("tv-back-to-library").click();
    await playFirst(host);
    await expect(tvRoot(guest)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    await guest.mouse.move(60, 60);
    const bar = guest.locator(".hud-bar");
    await expect(bar).toHaveAttribute("role", "slider");
    await expect.poll(async () => Number(await bar.getAttribute("aria-valuemax"))).toBeGreaterThan(0);
    const box = (await bar.boundingBox())!;
    const dot = (await guest.locator(".hud-bar-thumb").boundingBox())!;
    const y = dot.y + dot.height / 2;
    await guest.mouse.move(dot.x + dot.width / 2, y);
    await guest.mouse.down();
    await guest.mouse.move(box.x + box.width * 0.8, y, { steps: 6 });
    await expect(bar).toHaveAttribute("data-scrubbing", "true");

    await host.mouse.move(60, 60);
    await host.getByTestId("tv-party-btn").click();
    await host.getByTestId("tv-party-admin").click();
    await expect(host.getByTestId("tv-party-admin")).toHaveText("Make admin");
    await expect(bar).toHaveAttribute("role", "progressbar");
    await expect(bar).not.toHaveAttribute("data-scrubbing", "true");
    await guest.mouse.up();
    await expect(bar).not.toHaveAttribute("data-scrubbing", "true");
  });

  test("a guest has the bars any screen has, but only to be read: what is on, whom it follows, how far it is; and its own things stay its own", async ({ browser, baseURL }) => {
    const { host, guest } = await party(browser, baseURL!);
    const hostName = await host.getByTestId("tv-party-member").first().locator(".tv-party-name").innerText();
    await host.getByTestId("tv-back-to-library").click();
    await playFirst(host);
    await expect(tvRoot(guest)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });

    await guest.mouse.move(60, 60);
    await expect(guest.getByTestId("tv-title")).toHaveText("sample");
    await expect(guest.getByTestId("tv-follow-line")).toContainText(hostName);
    await expect(guest.getByTestId("tv-elapsed")).toHaveText(/^\d+:\d\d$/);
    await expect(guest.locator(".hud-bar")).toHaveAttribute("role", "progressbar");
    await expect.poll(async () => Number(await guest.locator(".hud-bar").getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    await expect(guest.getByTestId("tv-play-btn")).toHaveCount(0);
    await expect(guest.getByTestId("tv-admin-bar")).toHaveCount(0);

    const at = await tvTime(host);
    const bar = (await guest.locator(".hud-bar").boundingBox())!;
    await guest.mouse.click(bar.x + bar.width * 0.9, bar.y + bar.height / 2);
    await guest.waitForTimeout(600);
    expect(Math.abs((await tvTime(host)) - at)).toBeLessThan(3);

    await expect(guest.getByTestId("tv-mute-btn")).toBeVisible();
    await expect(guest.getByTestId("tv-party-btn")).toBeVisible();
    await expect(guest.getByTestId("tv-leave")).toBeVisible();
    await guest.getByTestId("tv-party-btn").click();
    await expect(guest.getByTestId("tv-party-panel")).toBeVisible();
    await expect(guest.getByTestId("tv-party-leave")).toBeVisible();
  });

  test("who held the film is said where it is held: a pause of the host's own to the guests, an admin's to the host and the others (and 'you' on its own screen)", async ({ browser, baseURL }) => {
    const { host, guest: admin, code } = await party(browser, baseURL!);
    const other = await screen(browser, baseURL!);
    await joinWith(other, code);
    await expect(host.getByTestId("tv-party-member")).toHaveCount(3);
    const nameAt = async (index: number) => host.getByTestId("tv-party-member").nth(index).locator(".tv-party-name").innerText();
    const hostName = await nameAt(0);
    const adminName = await nameAt(1);
    await host.getByTestId("tv-party-admin").first().click();
    await expect(admin.getByTestId("tv-party-member").nth(1)).toContainText("Admin");
    await host.getByTestId("tv-back-to-library").click();
    await playFirst(host);
    for (const tv of [admin, other]) await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });

    await host.keyboard.press("Space");
    for (const tv of [admin, other]) await expect(tv.getByTestId("tv-held")).toHaveText(`Paused by ${hostName}`);
    await host.keyboard.press("Space");
    for (const tv of [admin, other]) await expect(tv.getByTestId("tv-held")).toHaveCount(0);
    await expect(other.getByTestId("tv-toast")).toHaveText(`${hostName} resumed`);

    await admin.mouse.move(60, 60);
    await admin.getByTestId("tv-admin-play").click();
    await expect(tvRoot(host)).toHaveAttribute("data-state", "paused");
    await expect(admin.getByTestId("tv-held")).toHaveText("Paused by you");
    await expect(other.getByTestId("tv-held")).toHaveText(`Paused by ${adminName}`);
    await expect(host.getByTestId("tv-held")).toHaveText(`Paused by ${adminName}`);
    await admin.getByTestId("tv-admin-play").click();
    await expect(tvRoot(host)).toHaveAttribute("data-state", "playing");
    await expect(other.getByTestId("tv-toast")).toHaveText(`${adminName} resumed`);
    await expect(host.getByTestId("tv-toast")).toHaveText(`${adminName} resumed`);
    await expect(admin.getByTestId("tv-held")).toHaveCount(0);
    await expect(host.getByTestId("tv-held")).toHaveCount(0);
  });

  for (const size of [
    { name: "a TV (1280×720) in Italian", width: 1280, height: 720, language: "it" },
    { name: "a phone in Romanian", width: 390, height: 844, language: "ro" },
    { name: "a small phone in Romanian", width: 320, height: 568, language: "ro" },
  ]) {
    test(`with an admin in the party, the list and the bars fit ${size.name}`, async ({ browser, baseURL }) => {
      const viewport = { width: size.width, height: size.height };
      const seed = { "kino.lang": size.language };
      const words = size.language === "ro" ? ro : italian;
      const misfits = (page: Page) =>
        page.evaluate(() => {
          const touching = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
          let wrong = 0;
          for (const member of document.querySelectorAll(".tv-party-member")) {
            const row = member.getBoundingClientRect();
            if (row.left < -1 || row.right > innerWidth + 1) wrong++;
            for (const part of member.children) {
              const box = part.getBoundingClientRect();
              if (box.width > 0 && (box.left < row.left - 1 || box.right > row.right + 1)) wrong++;
            }
            const buttons = [...member.querySelectorAll("button")].map((button) => button.getBoundingClientRect());
            buttons.forEach((a, i) => buttons.slice(i + 1).forEach((b) => touching(a, b) && wrong++));
            for (const name of member.querySelectorAll<HTMLElement>(".tv-party-name")) if (name.scrollWidth > name.clientWidth + 1) wrong++;
          }
          return wrong;
        });
      const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

      const host = await openLibrary(browser, withLibrary(films(baseURL!)), viewport, seed);
      const code = await startParty(host);
      const admin = await openLibrary(browser, withLibrary(films(baseURL!)), viewport, seed);
      await joinWith(admin, code);
      await expect(admin.getByTestId("tv-following")).toBeVisible();
      expect(await misfits(admin)).toBe(0);
      await host.getByTestId("tv-party-admin").click();
      await expect(host.getByTestId("tv-party-admin")).toHaveText(words["party.removeAdmin"]);
      await expect(host.getByTestId("tv-party-member").nth(1)).toContainText(words["party.admin"]);
      await expect(admin.getByTestId("tv-party-member").nth(1)).toContainText(words["party.admin"]);
      for (const page of [host, admin]) {
        expect(await misfits(page)).toBe(0);
        expect(await sideways(page)).toBeLessThanOrEqual(0);
      }
      await host.getByTestId("tv-back-to-library").click();
      if (heldUpright(host)) await host.getByTestId("rail-home").click();
      await host.getByTestId("tv-browse-tile").first().click();
      await host.getByTestId("tv-detail-play").click();
      await expect(tvRoot(host)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
      await host.mouse.move(60, 60);
      await host.getByTestId("tv-party-btn").click();
      await expect(host.getByTestId("tv-party-admin")).toBeAttached();
      expect(await misfits(host)).toBe(0);
      const panel = (await host.getByTestId("tv-party-panel").boundingBox())!;
      expect(panel.x).toBeGreaterThanOrEqual(0);
      expect(panel.x + panel.width).toBeLessThanOrEqual(size.width + 1);

      await expect(tvRoot(admin)).toHaveAttribute("data-state", /playing|paused/, { timeout: 15_000 });
      await admin.mouse.move(60, 60);
      await expect(admin.getByTestId("tv-admin-bar")).toBeInViewport();
      const bar = await admin.evaluate(() => {
        const inside = (box: DOMRect) => box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
        const elements = [...document.querySelectorAll<HTMLElement>(".hud-bottom, .hud-bottom button")];
        return { outside: elements.filter((element) => !inside(element.getBoundingClientRect())).length, buttons: elements.length - 1 };
      });
      expect(bar.outside).toBe(0);
      expect(bar.buttons).toBeGreaterThanOrEqual(6);
      expect(await sideways(admin)).toBeLessThanOrEqual(0);
    });
  }

  test("a guest that leaves by choice is not told it has left", async ({ browser, baseURL }) => {
    const { host, guest } = await party(browser, baseURL!);
    await guest.getByTestId("tv-disconnect").click();
    await expect(guest.getByTestId("tv-party-start")).toBeVisible();
    await expect(host.getByTestId("tv-party-member")).toHaveCount(1);
    await expect(guest.getByTestId("tv-flash")).toHaveCount(0);
  });

  test("Back on a guest's waiting page shows the way out and does not take it: OK on Leave does", async ({ browser, baseURL }) => {
    const { host, guest } = await party(browser, baseURL!);
    await expect(guest.getByTestId("tv-disconnect")).not.toBeFocused();
    await expect(async () => {
      await guest.keyboard.press("Escape");
      await expect(guest.getByTestId("tv-disconnect")).toBeFocused({ timeout: 1500 });
    }).toPass({ timeout: 10_000 });
    await expect(guest.getByTestId("tv-following")).toBeVisible();
    await expect(host.getByTestId("tv-party-member")).toHaveCount(2);
    await guest.keyboard.press("Enter");
    await expect(guest.getByTestId("tv-party-start")).toBeVisible();
    await expect(host.getByTestId("tv-party-member")).toHaveCount(1);
  });

  test("ending the party sends everyone back to their own screen", async ({ browser, baseURL }) => {
    const { host, guest } = await party(browser, baseURL!);
    await host.getByTestId("tv-party-end").click();
    await expect(host.getByTestId("tv-party-start")).toBeVisible();
    await expect(guest.getByTestId("tv-following")).toHaveCount(0);
    await expect(guest.getByTestId("tv-flash")).toHaveText("You are no longer in the party.");
  });

  test("with the remote alone: Start lands on the party page's button, and ending the party lands back on the choices", async ({ browser, baseURL }) => {
    const host = await screen(browser, baseURL!);
    await host.getByTestId("rail-party").click();
    await expect(host.getByTestId("tv-party-start")).toBeFocused();
    await host.keyboard.press("Enter");
    await expect(host.getByTestId("tv-party-code")).toBeVisible();
    await expect(host.getByTestId("tv-back-to-library")).toBeFocused();
    await host.keyboard.press("ArrowDown");
    await host.keyboard.press("ArrowDown");
    await expect(host.getByTestId("tv-party-end")).toBeFocused();
    await host.keyboard.press("Enter");
    await expect(host.getByTestId("tv-party-start")).toBeFocused();
  });

  test("a TV with a phone connected cannot join, and is told why", async ({ browser, baseURL }) => {
    const host = await screen(browser, baseURL!);
    const code = await startParty(host);
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    await expect(tv.getByTestId("tv-paired")).toBeVisible();
    await tv.getByTestId("tv-back-to-library").click();
    await joinWith(tv, code);
    await expect(tv.getByTestId("tv-party-error")).toHaveText("Disconnect the phone from this TV before joining a party.");
    await expect(tv.getByTestId("tv-following")).toHaveCount(0);
    phone.close();
  });

  test("the phone of a TV shows its party's code and who is in, and a screen that types the code joins", async ({ browser, baseURL }) => {
    const host = await openTv(browser);
    const phone = await openPairedPhone(browser, host);
    await phone.getByTestId("menu").click();
    await phone.getByTestId("party-open").click();
    await expect(phone.getByTestId("party-invite").getByTestId("pairing-qr")).toBeVisible();
    const code = (await phone.getByTestId("party-join-code").innerText()).replace(/\s/g, "");
    expect(code).toMatch(/^\d{6}$/);
    await expect(phone.getByTestId("party-host")).toContainText("Host");
    await expect(phone.getByTestId("party-tv")).toHaveCount(0);

    const guest = await screen(browser, baseURL!);
    await joinWith(guest, code);
    await expect(guest.getByTestId("tv-following")).toBeVisible();
    await expect(phone.getByTestId("party-tv")).toHaveCount(1);
    await expect(phone.getByTestId("party-join-code")).toBeVisible();
    await phone.getByTestId("sheet-close").click();
    await expect(phone.getByTestId("party-count")).toHaveText("+1");
  });

  test("the phone shows the party's link with a button that copies it, and shares it too where it has a share sheet", async ({ browser }) => {
    const host = await openTv(browser);
    const phone = await openPairedPhone(browser, host);
    await phone.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const defineShare = (share: boolean) =>
      phone.evaluate((value) => {
        Object.defineProperty(navigator, "share", { configurable: true, value: value ? (data: ShareData) => Promise.resolve(((window as unknown as { shared: ShareData }).shared = data)) : undefined });
      }, share);
    const openSheet = async () => {
      await phone.getByTestId("menu").click();
      await phone.getByTestId("party-open").click();
      await expect(phone.getByTestId("party-join-code")).toBeVisible();
      return new URL(`/?party=${(await phone.getByTestId("party-join-code").innerText()).replace(/\s/g, "")}`, phone.url()).href;
    };
    const copy = phone.getByTestId("party-link-copy");

    await defineShare(true);
    let link = await openSheet();
    await expect(phone.getByTestId("party-link-url")).toHaveText(link);
    await phone.getByTestId("party-share").click();
    await expect.poll(() => phone.evaluate(() => (window as unknown as { shared?: ShareData }).shared?.url)).toBe(link);
    await copy.click();
    await expect(copy).toHaveText("Link copied");
    expect(await phone.evaluate(() => navigator.clipboard.readText())).toBe(link);
    await expect(copy).toHaveText("Copy link");

    await phone.getByTestId("sheet-close").click();
    await defineShare(false);
    link = await openSheet();
    await expect(phone.getByTestId("party-share")).toHaveCount(0);
    await phone.evaluate(() => navigator.clipboard.writeText("something else"));
    await copy.click();
    await expect(copy).toHaveText("Link copied");
    expect(await phone.evaluate(() => navigator.clipboard.readText())).toBe(link);
  });

  test("a party that the TV ends is not opened again by the phone's sheet, until the phone asks", async ({ browser }) => {
    const host = await openTv(browser);
    const phone = await openPairedPhone(browser, host);
    await phone.getByTestId("menu").click();
    await phone.getByTestId("party-open").click();
    await expect(phone.getByTestId("party-join-code")).toBeVisible();

    await host.getByTestId("tv-back-to-library").click();
    await host.getByTestId("rail-party").click();
    await host.getByTestId("tv-party-end").click();
    await expect(phone.getByTestId("party-invite-open")).toBeVisible();
    await phone.waitForTimeout(1200);
    await expect(phone.getByTestId("party-join-code")).toHaveCount(0);

    await phone.getByTestId("party-invite-open").click();
    await expect(phone.getByTestId("party-join-code")).toBeVisible();
  });
});

async function hold(phone: Page, target: Locator) {
  await target.evaluate((element) => element.scrollIntoView({ block: "center", inline: "center" }));
  const box = (await target.boundingBox())!;
  await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await phone.mouse.down();
  await phone.waitForTimeout(700);
  await phone.mouse.up();
}

const ticked = (phone: Page, n: number) => phone.getByTestId("library-tile").nth(n).getByTestId("saved-mark");

test.describe("the library", () => {
  const library = {
    updatedAt: Date.now(),
    rows: [
      {
        id: "r1",
        title: "Test films",
        source: "Test Source",
        items: [
          { id: "a", title: "The Sample", year: 1999, image: "/fixtures/missing.png", url: "/fixtures/sample.mp4" },
          { id: "b", title: "The Other One", url: "/fixtures/pages/video.html" },
        ],
      },
      { id: "r2", title: "More films", source: "Test Source", items: [{ id: "c", title: "Third", url: "/fixtures/sample.mp4?third=1" }] },
    ],
  };

  async function phoneWithLibrary(browser: Parameters<typeof openTv>[0], answer: Parameters<Page["route"]>[1]) {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.context().route("**/api/library", answer);
    await phone.reload();
    return { tv, phone };
  }

  test("the home screen shows rows of titles, and a tap opens a title's page, where Play starts it on the TV", async ({ browser }) => {
    const { tv, phone } = await phoneWithLibrary(browser, (route) => route.fulfill({ json: library }));
    await expect(phone.getByTestId("library-row")).toHaveCount(2);
    await expect(phone.getByTestId("library-row").first()).toContainText("Test films");
    await expect(phone.getByTestId("library-tile")).toHaveCount(3);
    await expect(phone.getByTestId("library")).toContainText("From Test Source");
    await expect(phone.getByTestId("library-tile").first()).not.toContainText("1999");

    await phone.getByTestId("library-tile").first().click();
    const page = phone.getByTestId("title-sheet");
    await expect(page).toContainText("The Sample");
    await expect(page.getByTestId("title-meta")).toHaveText("1999");
    await expect(page.getByTestId("title-play")).toHaveText("Play");
    await expect(tvRoot(tv)).not.toHaveAttribute("data-state", "playing");

    await page.getByTestId("title-play").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await expect(phone.getByTestId("player-state")).toBeVisible();
    await expect(phone.getByTestId("title-sheet")).toHaveCount(0);
  });

  test("a title that is a page plays through the resolver like a pasted link", async ({ browser }) => {
    const { tv, phone } = await phoneWithLibrary(browser, (route) => route.fulfill({ json: library }));
    await phone.getByTestId("library-tile").nth(1).click();
    await phone.getByTestId("title-play").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", /playing|paused|loading/);
    await expect(phone.getByTestId("media-title")).toBeVisible();
  });

  test("Change video steps the remote aside: the library is there to pick from, and what plays goes on, as a line above the bar", async ({ browser, baseURL }) => {
    const { tv, phone } = await phoneWithLibrary(browser, (route) => route.fulfill({ json: library }));
    await phone.getByTestId("url-input").fill(sample(baseURL!));
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await phone.getByTestId("change-video").click();
    await expect(phone.getByTestId("library-tile")).toHaveCount(3);
    await expect(phone.getByTestId("mini-remote")).toBeVisible();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await phone.getByTestId("playing-bar").click();
    await expect(phone.getByTestId("player-state")).toBeVisible();
  });

  test("Escape closes the sheet on top, and the page under it the next time", async ({ browser }) => {
    const { phone } = await phoneWithLibrary(browser, (route) => route.fulfill({ json: library }));
    await hold(phone, phone.getByTestId("library-tile").first());
    await place(phone, "list");
    await phone.getByTestId("lists-manage").click();
    await phone.getByTestId("list-new").click();
    await phone.getByTestId("list-name-input").fill("Weekend");
    await phone.getByTestId("list-save").click();
    await phone.getByTestId("sheet-close").click();
    await place(phone, "home");

    await phone.getByTestId("library-tile").first().click();
    await phone.getByTestId("title-lists").click();
    await expect(phone.getByTestId("list-picker")).toBeVisible();
    await phone.keyboard.press("Escape");
    await expect(phone.getByTestId("list-picker")).toHaveCount(0);
    await expect(phone.getByTestId("title-sheet")).toBeVisible();
    await phone.keyboard.press("Escape");
    await expect(phone.getByTestId("title-sheet")).toHaveCount(0);
  });

  test("a hold on a title saves it in Favourites, and a tick on its poster says so; with a second list a hold still does, the title's Other lists asks which, and a cross takes a title off one list", async ({ browser }) => {
    const { phone } = await phoneWithLibrary(browser, (route) => route.fulfill({ json: library }));
    await place(phone, "list");
    await expect(phone.getByTestId("list-row")).toHaveCount(0);
    await expect(phone.getByTestId("lists-manage")).toHaveCount(0);
    await expect(phone.getByTestId("my-lists-empty")).toBeVisible();
    await expect(phone.getByTestId("my-lists-empty")).toContainText("Hold a title");
    await place(phone, "home");

    await expect(ticked(phone, 0)).toHaveCount(0);
    await expect(phone.getByTestId("library-tile").first().locator("xpath=..").getByRole("button")).toHaveCount(1);
    await hold(phone, phone.getByTestId("library-tile").first());
    await expect(ticked(phone, 0)).toBeVisible();
    await place(phone, "list");
    await expect(phone.getByRole("region", { name: "Favourites" })).toContainText("The Sample");

    await phone.getByTestId("lists-manage").click();
    await expect(phone.getByTestId("lists-sheet")).toContainText("1 title");
    await phone.getByTestId("list-new").click();
    await phone.getByTestId("list-name-input").fill("Weekend");
    await phone.getByTestId("list-save").click();
    await expect(phone.getByTestId("lists-sheet")).toContainText("Weekend");
    await phone.getByTestId("sheet-close").click();
    await expect(phone.getByTestId("lists-sheet")).toHaveCount(0);
    await place(phone, "home");

    await expect(ticked(phone, 1)).toHaveCount(0);
    await hold(phone, phone.getByTestId("library-tile").nth(1));
    await expect(phone.getByTestId("toast")).toHaveText("Added to Favourites");
    await expect(phone.getByTestId("list-picker")).toHaveCount(0);
    await expect(ticked(phone, 1)).toBeVisible();
    await phone.getByTestId("library-tile").nth(1).click();
    await phone.getByTestId("title-lists").click();
    const picker = phone.getByTestId("list-picker");
    await expect(picker).toContainText("The Other One");
    await expect(picker.getByRole("button", { name: "Favourites" })).toHaveAttribute("aria-pressed", "true");
    await expect(picker.getByRole("button", { name: "Weekend" })).toHaveAttribute("aria-pressed", "false");
    await picker.getByRole("button", { name: "Weekend" }).click();
    await expect(picker.getByRole("button", { name: "Weekend" })).toHaveAttribute("aria-pressed", "true");
    await phone.getByTestId("sheet-close").click();
    await phone.getByTestId("title-back").click();
    await hold(phone, phone.getByTestId("library-tile").nth(1));
    await expect(picker).toBeVisible();
    await phone.getByTestId("sheet-close").click();
    await expect(ticked(phone, 1)).toBeVisible();
    await place(phone, "list");
    await expect(phone.getByRole("region", { name: "Favourites" })).toContainText("The Sample");
    await expect(phone.getByRole("region", { name: "Favourites" })).toContainText("The Other One");
    await expect(phone.getByRole("region", { name: "Weekend" })).toContainText("The Other One");
    await expect(phone.getByRole("region", { name: "Weekend" })).not.toContainText("The Sample");

    await phone.getByRole("region", { name: "Weekend" }).getByTestId("list-remove").click();
    await expect(phone.getByRole("region", { name: "Weekend" })).toHaveCount(0);
    await expect(phone.getByRole("region", { name: "Favourites" })).toContainText("The Other One");
    await place(phone, "home");
    await expect(ticked(phone, 1)).toBeVisible();
  });

  test("a list is made from the picker with the title in it, then renamed, and deleted with the titles in it; the first list is renamed but not deleted", async ({ browser }) => {
    const { phone } = await phoneWithLibrary(browser, (route) => route.fulfill({ json: library }));
    const titleAt = (n: number) => phone.getByTestId("library-tile").nth(n);
    await hold(phone, titleAt(0));
    await place(phone, "list");
    await phone.getByTestId("lists-manage").click();
    await phone.getByTestId("list-new").click();
    await phone.getByTestId("list-name-input").fill("Weekend");
    await phone.getByTestId("list-save").click();
    await phone.getByTestId("sheet-close").click();
    await place(phone, "home");

    await titleAt(2).click();
    await phone.getByTestId("title-lists").click();
    const picker = phone.getByTestId("list-picker");
    await picker.getByTestId("pick-new").click();
    await expect(picker.getByTestId("list-editor")).toBeVisible();
    await phone.getByTestId("list-name-input").fill("weekend");
    await phone.getByTestId("list-save").click();
    await expect(phone.getByTestId("list-error")).toHaveText("You already have a list with that name.");
    await phone.getByTestId("list-name-input").fill("Classics");
    await expect(phone.getByTestId("list-error")).toHaveCount(0);
    await phone.getByTestId("list-save").click();
    await expect(picker.getByRole("button", { name: "Classics" })).toHaveAttribute("aria-pressed", "true");
    await phone.getByTestId("sheet-close").click();
    await phone.getByTestId("title-back").click();
    await place(phone, "list");
    await expect(phone.getByRole("region", { name: "Classics" })).toContainText("Third");

    await phone.getByTestId("lists-manage").click();
    const sheet = phone.getByTestId("lists-sheet");
    await expect(sheet).toContainText("Classics");
    await sheet.getByRole("button", { name: /^Classics/ }).click();
    await expect(phone.getByTestId("list-name-input")).toHaveValue("Classics");
    await phone.getByTestId("list-name-input").fill("Old films");
    await phone.getByTestId("list-save").click();
    await expect(sheet.getByRole("button", { name: /^Old films/ })).toContainText("1 title");
    await expect(phone.getByRole("region", { name: "Old films" })).toContainText("Third");

    await sheet.getByRole("button", { name: /^Old films/ }).click();
    await phone.getByTestId("list-delete").click();
    await expect(phone.getByTestId("list-editor")).toContainText("Delete “Old films”?");
    await phone.getByTestId("list-delete-cancel").click();
    await phone.getByTestId("list-delete").click();
    await phone.getByTestId("list-delete-confirm").click();
    await expect(sheet).not.toContainText("Old films");
    await expect(phone.getByRole("region", { name: "Old films" })).toHaveCount(0);

    await sheet.getByRole("button", { name: /^Favourites/ }).click();
    await expect(phone.getByTestId("list-delete")).toHaveCount(0);
    await phone.getByTestId("list-name-input").fill("Watch later");
    await phone.getByTestId("list-save").click();
    await expect(sheet.getByRole("button", { name: /^Watch later/ })).toBeVisible();
    await phone.getByTestId("sheet-close").click();
    await expect(phone.getByRole("region", { name: "Watch later" })).toContainText("The Sample");
    await place(phone, "home");
    await expect(ticked(phone, 2)).toHaveCount(0);
  });

  test("the lists are put in the order wanted from the sheet that manages them: a list moves one place, never the first, and a new name keeps its place", async ({ browser }) => {
    const { phone } = await phoneWithLibrary(browser, (route) => route.fulfill({ json: library }));
    await hold(phone, phone.getByTestId("library-tile").first());
    await place(phone, "list");
    await phone.getByTestId("lists-manage").click();
    const sheet = phone.getByTestId("lists-sheet");
    const order = () => sheet.locator('[data-testid^="manage-"] > span:first-child').allTextContents();
    const make = async (name: string) => {
      await phone.getByTestId("list-new").click();
      await phone.getByTestId("list-name-input").fill(name);
      await phone.getByTestId("list-save").click();
    };
    const open = (name: string) => sheet.getByRole("button", { name: new RegExp(`^${name}`) }).click();

    await make("Weekend");
    await open("Weekend");
    await expect(phone.getByTestId("list-name-input")).toHaveValue("Weekend");
    await expect(phone.getByTestId("list-move-earlier")).toHaveCount(0);
    await phone.getByTestId("list-cancel").click();

    await make("Kids");
    await make("Date night");
    await expect.poll(order).toEqual(["Favourites", "Weekend", "Kids", "Date night"]);

    await open("Favourites");
    await expect(phone.getByTestId("list-move-earlier")).toHaveCount(0);
    await phone.getByTestId("list-cancel").click();

    await open("Date night");
    await expect(phone.getByTestId("list-move-later")).toHaveAttribute("aria-disabled", "true");
    await expect(phone.getByTestId("list-move-earlier")).toHaveAccessibleName("Move up");
    await phone.getByTestId("list-move-earlier").click();
    await phone.getByTestId("list-move-earlier").click();
    await expect(phone.getByTestId("list-move-earlier")).toHaveAttribute("aria-disabled", "true");
    await phone.getByTestId("list-move-earlier").click({ force: true });
    await expect(phone.getByTestId("list-name-input")).toHaveValue("Date night");
    await phone.getByTestId("list-cancel").click();
    await expect.poll(order).toEqual(["Favourites", "Date night", "Weekend", "Kids"]);

    await open("Date night");
    await phone.getByTestId("list-move-later").click();
    await phone.getByTestId("list-name-input").fill("Late night");
    await phone.getByTestId("list-save").click();
    await expect.poll(order).toEqual(["Favourites", "Weekend", "Late night", "Kids"]);

    await make("Newest");
    await expect.poll(order).toEqual(["Favourites", "Weekend", "Late night", "Kids", "Newest"]);
    await open("Weekend");
    await phone.getByTestId("list-delete").click();
    await phone.getByTestId("list-delete-confirm").click();
    await expect.poll(order).toEqual(["Favourites", "Late night", "Kids", "Newest"]);
  });

  test("no titles leaves the home screen as it was, and a library that cannot be reached says so", async ({ browser }) => {
    const empty = await phoneWithLibrary(browser, (route) => route.fulfill({ json: { rows: [], updatedAt: 0 } }));
    await expect(empty.phone.getByTestId("url-input")).toBeVisible();
    await expect(empty.phone.getByTestId("library")).toHaveCount(0);
    await expect(empty.phone.getByTestId("library-loading")).toHaveCount(0);

    for (const answer of [(route: import("@playwright/test").Route) => route.abort(), (route: import("@playwright/test").Route) => route.fulfill({ status: 500, body: "nope" }), (route: import("@playwright/test").Route) => route.fulfill({ json: { rows: "wrong" } })]) {
      const { phone } = await phoneWithLibrary(browser, answer);
      await expect(phone.getByTestId("url-input")).toBeVisible();
      await expect(phone.getByTestId("library")).toHaveCount(0);
      await expect(phone.getByTestId("library-loading")).toHaveCount(0);
      await expect(phone.getByTestId("library-failed")).toContainText("The library isn't reachable right now");
    }
  });

  test("Try again asks the library again", async ({ browser }) => {
    let up = false;
    const { phone } = await phoneWithLibrary(browser, (route) => (up ? route.fulfill({ json: library }) : route.fulfill({ status: 500, body: "nope" })));
    await expect(phone.getByTestId("library-failed")).toBeVisible();
    up = true;
    await phone.getByTestId("library-retry").click();
    await expect(phone.getByTestId("library-row")).toHaveCount(2);
    await expect(phone.getByTestId("library-failed")).toHaveCount(0);
  });

  test("a search that cannot be made says so, instead of saying nothing matches", async ({ browser }) => {
    const { phone } = await phoneWithLibrary(browser, (route) => route.fulfill({ json: library }));
    await phone.context().route(/\/api\/library\/search/, (route) => route.fulfill({ status: 500, body: "nope" }));
    await place(phone, "search");
    await phone.getByTestId("library-search-input").fill("zzz");
    await expect(phone.getByTestId("library-search-results")).toContainText("Search can't be reached right now");
    await phone.getByTestId("library-search-input").fill("Sample");
    await expect(phone.getByTestId("library-search-results")).toContainText("Results for “Sample”");
    await expect(phone.getByTestId("library-search-results")).toContainText("the rest of the search can't be reached");
  });
});

test.describe("a title's page, a hold, the search and the cards, on the phone", () => {
  const films = Array.from({ length: 12 }, (_, i) => ({ id: `f${i}`, title: `Film number ${i + 1}`, year: 1930 + i, kind: "movie", url: `/fixtures/sample.mp4?n=${i}` }));
  const episodeLink = (episode: number, season = 1) => `https://shows.example/watch/7?s=${season}&e=${episode}`;
  const show = { id: "show-7", title: "The Long Night", year: 2019, kind: "series", url: episodeLink(1), description: "A show about a very long night." };
  const libraryOf = (baseURL: string) => ({
    updatedAt: Date.now(),
    rows: [
      { id: "trending-movies", title: "Trending movies", source: "Test Source", kind: "movie", items: [...films, { id: "nv", title: "No video here", kind: "movie", url: `${baseURL}/fixtures/pages/none.html` }] },
      { id: "trending-tv", title: "Trending series", source: "Test Source", kind: "series", items: [show] },
    ],
  });
  const withoutLinkBox = (baseURL: string) => ({
    cookies: [],
    origins: [{ origin: new URL(baseURL).origin, localStorage: [{ name: "kino.fullscreen.left", value: "1" }, { name: "kino.role", value: "remote" }] }],
  });

  let searches = 0;
  async function connect(
    browser: Browser,
    baseURL: string,
    {
      device = {},
      seed = {},
      library = libraryOf(baseURL),
      find = (query) => films.filter((film) => film.title.toLowerCase().includes(query.toLowerCase())),
    }: { device?: Parameters<Browser["newContext"]>[0]; seed?: Record<string, string>; library?: unknown; find?: (query: string) => unknown[] } = {},
  ) {
    searches = 0;
    const tv = await openTv(browser);
    const phone = await openDevice(browser, { ...PHONE, ...device }, seed, async (context) => {
      await withLibrary(library, (query) => {
        searches += 1;
        return find(query);
      })(context);
      await context.route(/\/api\/library\/seasons/, (route) => route.fulfill({ json: { seasons: [1, 2] } }));
      await context.route(/\/api\/library\/episodes/, (route) => {
        const season = Number(new URL(route.request().url()).searchParams.get("season"));
        const pages = ["video", "none", "hls"];
        return route.fulfill({
          json: { episodes: ["Pilot", "The Long Night", "The Third Day"].map((name, i) => ({ season, episode: i + 1, title: season === 1 ? name : `${name} again`, runtime: 40, url: `${baseURL}/fixtures/pages/${pages[i]}.html` })) },
        });
      });
    });
    await phone.goto("/");
    await phone.getByTestId("code-input").fill(await readPairingCode(tv));
    await expect(phone.getByTestId("tv-online")).toHaveClass(/\bok\b/);
    return { tv, phone };
  }
  const tile = (phone: Page, title: string) => phone.locator(`[data-testid="library-tile"][title="${title}"]`);

  test("a show's page lists its seasons and episodes; Play says which one it starts, and an episode plays on its own", async ({ browser, baseURL }) => {
    const { tv, phone } = await connect(browser, baseURL!);
    await tile(phone, "The Long Night").click();
    const page = phone.getByTestId("title-sheet");
    await expect(page.getByTestId("title-meta")).toHaveText("2019 · Series");
    await expect(page).toContainText("A show about a very long night.");
    await expect(page.getByTestId("title-play")).toHaveText("Play S1:E1");
    await expect(page.getByTestId("title-season-1")).toHaveAttribute("aria-selected", "true");
    const episodes = page.getByTestId("title-episode");
    await expect(episodes).toHaveCount(3);
    await expect(episodes.first()).toContainText("Pilot");
    await expect(episodes.first()).toContainText("40 min");
    await expect(episodes.first()).toHaveAttribute("data-target", "true");
    await page.getByTestId("title-season-2").click();
    await expect(episodes.first()).toContainText("Pilot again");
    await expect(episodes.first()).toHaveAttribute("data-target", "false");

    await episodes.first().click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", /playing|paused|loading/);
    await expect(phone.getByTestId("title-sheet")).toHaveCount(0);
  });

  test("a show that was started is picked up on its page: Resume, at its season and episode", async ({ browser, baseURL }) => {
    const card = { key: progressKey({ show: "The Long Night", url: episodeLink(3, 2) }), at: Date.now(), title: "The Long Night", url: episodeLink(3, 2), season: 2, episode: 3, position: 600, duration: 2400 };
    const { phone } = await connect(browser, baseURL!, { seed: guestStorage({ progress: [card] }) });
    await tile(phone, "The Long Night").click();
    await expect(phone.getByTestId("title-play")).toHaveText("Resume S2:E3");
    await expect(phone.getByTestId("title-season-2")).toHaveAttribute("aria-selected", "true");
    await expect(phone.getByTestId("title-episode").nth(2)).toHaveAttribute("data-target", "true");
  });

  const longSeason = (on: Page | BrowserContext, baseURL: string) =>
    on.route(/\/api\/library\/episodes/, (route) => {
      const season = Number(new URL(route.request().url()).searchParams.get("season"));
      const episodes = Array.from({ length: season === 1 ? 100 : 3 }, (_, i) => ({ season, episode: i + 1, title: `Chapter ${i + 1}`, runtime: 24, url: `${baseURL}/fixtures/pages/video.html?e=${i + 1}` }));
      return route.fulfill({ json: { episodes } });
    });
  const atForty = () => guestStorage({ progress: [{ key: progressKey({ show: "The Long Night", url: episodeLink(40) }), at: Date.now(), title: "The Long Night", url: episodeLink(40), season: 1, episode: 40, position: 600, duration: 1440 }] });

  test("a long season lists 24 episodes at a time, from the one this profile is at; Show earlier and Show more add 24 more, and a short season is whole", async ({ browser, baseURL }) => {
    const { phone } = await connect(browser, baseURL!, { seed: atForty() });
    await longSeason(phone, baseURL!);
    await tile(phone, "The Long Night").click();
    await expect(phone.getByTestId("title-play")).toHaveText("Resume S1:E40");
    const episodes = phone.getByTestId("title-episode");
    const earlier = phone.getByTestId("title-episodes-earlier");
    const more = phone.getByTestId("title-episodes-more");
    await expect(episodes).toHaveCount(24);
    await expect(episodes.first()).toHaveAttribute("data-episode", "40");
    await expect(episodes.first()).toHaveAttribute("data-target", "true");
    await expect(episodes.last()).toHaveAttribute("data-episode", "63");
    await expect(earlier).toHaveText("Show 24 earlier episodes");
    await expect(more).toHaveText("Show 24 more episodes");

    await earlier.click();
    await expect(episodes).toHaveCount(48);
    await expect(episodes.first()).toHaveAttribute("data-episode", "16");
    await expect(earlier).toHaveText("Show 15 earlier episodes");
    await earlier.click();
    await expect(episodes.first()).toHaveAttribute("data-episode", "1");
    await expect(earlier).toHaveCount(0);
    await more.click();
    await expect(episodes).toHaveCount(87);
    await expect(more).toHaveText("Show 13 more episodes");
    await more.click();
    await expect(episodes).toHaveCount(100);
    await expect(more).toHaveCount(0);

    await phone.getByTestId("title-season-2").click();
    await expect(episodes).toHaveCount(3);
    await expect(earlier).toHaveCount(0);
    await expect(more).toHaveCount(0);
    await phone.getByTestId("title-season-1").click();
    await expect(episodes).toHaveCount(100);
  });

  test("on the TV the remote walks a long season: into the episodes on the one it is at, Up to Show earlier, OK lands on the last that came; Show more on the first", async ({ browser, baseURL }) => {
    const tv = await openLibrary(
      browser,
      async (context) => {
        await withLibrary(libraryOf(baseURL!))(context);
        await context.route(/\/api\/library\/seasons/, (route) => route.fulfill({ json: { seasons: [1, 2] } }));
        await longSeason(context, baseURL!);
      },
      undefined,
      atForty(),
    );
    await tv.locator("[data-testid='tv-browse-tile'][title='The Long Night']").first().click();
    await expect(tv.getByTestId("tv-detail-play")).toHaveText("Resume S1:E40");
    const episodes = tv.getByTestId("tv-episode");
    await expect(episodes).toHaveCount(24);
    await expect(episodes.first()).toHaveAttribute("data-episode", "40");
    const focused = () => tv.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.episode ?? document.activeElement?.getAttribute("data-testid"));

    await tv.getByTestId("tv-season-1").focus();
    await tv.keyboard.press("ArrowDown");
    await expect.poll(focused).toBe("40");
    await tv.keyboard.press("ArrowUp");
    await expect.poll(focused).toBe("tv-episodes-earlier");
    await tv.keyboard.press("Enter");
    await expect(episodes).toHaveCount(48);
    await expect.poll(focused).toBe("39");
    await tv.keyboard.press("ArrowDown");
    await expect.poll(focused).toBe("41");

    await tv.getByTestId("tv-episodes-more").focus();
    await tv.keyboard.press("Enter");
    await expect(episodes).toHaveCount(72);
    await expect.poll(focused).toBe("64");
    await tv.keyboard.press("ArrowUp");
    await expect.poll(focused).toBe("62");
  });

  test("at twelve lists there is no New list, and the sheets say why; a list deleted gives the button back", async ({ browser, baseURL }) => {
    const now = Date.now();
    const listNames = Array.from({ length: 11 }, (_, i) => ({ key: `l${String(i).padStart(3, "0")}`, at: now - 10_000 + i, name: `List ${i + 1}` }));
    const { phone } = await connect(browser, baseURL!, { seed: guestStorage({ listNames }) });
    const words = "You have reached the limit of 12 lists. Delete one to make a new one.";

    await phone.getByTestId("library-tile").first().click();
    await phone.getByTestId("title-lists").click();
    await expect(phone.getByTestId("list-picker")).toBeVisible();
    await expect(phone.getByTestId("pick-new")).toHaveCount(0);
    await expect(phone.getByTestId("lists-full")).toHaveText(words);
    await phone.getByTestId("pick-favourites").click();
    await phone.getByTestId("sheet-close").click();
    await phone.getByTestId("title-back").click();

    await place(phone, "list");
    await phone.getByTestId("lists-manage").click();
    await expect(phone.getByTestId("list-new")).toHaveCount(0);
    await expect(phone.getByTestId("lists-full")).toHaveText(words);

    await phone.getByTestId("manage-l010").click();
    await phone.getByTestId("list-delete").click();
    await phone.getByTestId("list-delete-confirm").click();
    await expect(phone.getByTestId("list-new")).toBeVisible();
    await expect(phone.getByTestId("lists-full")).toHaveCount(0);
  });

  test("a title's page keeps the title in a list, and its Back puts it away", async ({ browser, baseURL }) => {
    const { phone } = await connect(browser, baseURL!);
    await tile(phone, "Film number 1").click();
    const page = phone.getByTestId("title-sheet");
    await expect(page.getByTestId("title-list")).toHaveText("Favourites");
    await expect(page.getByTestId("title-list")).toHaveAccessibleName("Add to Favourites");
    await page.getByTestId("title-list").click();
    await expect(page.getByTestId("title-list")).toHaveAccessibleName("Remove from Favourites");
    await expect(page.getByTestId("title-list")).toHaveAttribute("aria-pressed", "true");
    await phone.getByTestId("title-back").click();
    await expect(phone.getByTestId("title-sheet")).toHaveCount(0);
    await place(phone, "list");
    await expect(phone.getByRole("region", { name: "Favourites" })).toContainText("Film number 1");

    await phone.getByRole("region", { name: "Favourites" }).getByTestId("list-play").click();
    await expect(phone.getByTestId("title-list")).toHaveAttribute("aria-pressed", "true");
  });

  test("a hold on a title puts it in a list and a tick comes on its poster; a tap after a hold is still a tap", async ({ browser, baseURL }) => {
    const { phone } = await connect(browser, baseURL!);
    const first = phone.getByTestId("library-tile").first();
    await expect(ticked(phone, 0)).toHaveCount(0);
    await hold(phone, first);
    await expect(ticked(phone, 0)).toBeVisible();
    await expect(phone.getByTestId("title-sheet")).toHaveCount(0);
    await expect(phone.getByTestId("toast")).toHaveText("Added to Favourites");
    await place(phone, "list");
    await expect(phone.getByRole("region", { name: "Favourites" })).toContainText("Film number 1");
    await place(phone, "home");

    await hold(phone, first);
    await expect(ticked(phone, 0)).toHaveCount(0);
    await expect(phone.getByTestId("toast")).toHaveText("Removed from Favourites");
    await first.click();
    await expect(phone.getByTestId("title-sheet")).toBeVisible();
  });

  test("with several lists a hold puts a title in the first list or takes it out at once, and asks which only for a title that is in another list", async ({ browser, baseURL }) => {
    const { phone } = await connect(browser, baseURL!);
    await hold(phone, phone.getByTestId("library-tile").first());
    await place(phone, "list");
    await phone.getByTestId("lists-manage").click();
    await phone.getByTestId("list-new").click();
    await phone.getByTestId("list-name-input").fill("Weekend");
    await phone.getByTestId("list-save").click();
    await phone.getByTestId("sheet-close").click();
    await place(phone, "home");

    await hold(phone, tile(phone, "Film number 2"));
    await expect(phone.getByTestId("toast")).toHaveText("Added to Favourites");
    await expect(phone.getByTestId("list-picker")).toHaveCount(0);
    await hold(phone, tile(phone, "Film number 2"));
    await expect(phone.getByTestId("toast")).toHaveText("Removed from Favourites");

    await tile(phone, "Film number 2").click();
    await phone.getByTestId("title-lists").click();
    await phone.getByTestId("list-picker").getByRole("button", { name: "Weekend" }).click();
    await phone.getByTestId("sheet-close").click();
    await expect(phone.getByTestId("title-list")).toHaveAttribute("aria-haspopup", "dialog");
    await phone.getByTestId("title-back").click();
    await hold(phone, tile(phone, "Film number 2"));
    await expect(phone.getByTestId("list-picker")).toContainText("Film number 2");
    await expect(phone.getByTestId("title-sheet")).toHaveCount(0);
  });

  test("a search shows what it finds as a grid of posters, and is still there after something is played and stopped", async ({ browser, baseURL }) => {
    const { tv, phone } = await connect(browser, baseURL!);
    await place(phone, "search");
    await phone.getByTestId("library-search-input").fill("film");
    const results = phone.getByTestId("library-result");
    await expect(results).toHaveCount(12);
    await expect(phone.getByTestId("library-search-results")).toContainText("Results for “film”");
    await expect(results.first()).toContainText("1930 · Movie");
    await expect(phone.locator(".lib-scroller")).toHaveCount(0);

    const first = (await results.nth(0).boundingBox())!;
    const second = (await results.nth(1).boundingBox())!;
    const fourth = (await results.nth(3).boundingBox())!;
    expect(Math.abs(second.y - first.y)).toBeLessThan(2);
    expect(second.x).toBeGreaterThanOrEqual(first.x + first.width - 1);
    expect(fourth.y).toBeGreaterThanOrEqual(first.y + first.height - 1);
    expect(Math.abs(fourth.x - first.x)).toBeLessThan(2);
    expect(first.height, "a poster is upright").toBeGreaterThan(first.width);

    await phone.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(() => phone.evaluate(() => window.scrollY)).toBeGreaterThan(300);
    await results.nth(5).scrollIntoViewIfNeeded();
    const before = (await results.nth(5).boundingBox())!.y;
    await results.nth(5).click();
    await expect(phone.getByTestId("title-sheet")).toContainText("Film number 6");
    await phone.getByTestId("title-play").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await phone.getByTestId("stop").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle");

    await expect(phone.getByTestId("library-search-input")).toHaveValue("film");
    await expect(results).toHaveCount(12);
    await expect.poll(async () => Math.abs((await results.nth(5).boundingBox())!.y - before)).toBeLessThan(4);
    expect(searches).toBe(1);
    await place(phone, "home");
    await expect(phone.getByTestId("continue-item")).toHaveCount(1);
  });

  test("a search forgives a slip of the fingers, an unfinished word and spaces left out: a title on the page is found, and the answer from the library adds nothing wrong", async ({ browser, baseURL }) => {
    const { phone } = await connect(browser, baseURL!);
    const results = phone.getByTestId("library-result");
    await place(phone, "search");
    await phone.getByTestId("library-search-input").fill("long nigth");
    await expect(results).toHaveCount(1);
    await expect(results.first()).toContainText("The Long Night");
    await expect.poll(() => searches).toBe(1);
    await expect(results).toHaveCount(1);

    await phone.getByTestId("library-search-input").fill("thelongnight");
    await expect(results).toHaveCount(1);
    await phone.getByTestId("library-search-input").fill("the lon nig");
    await expect(results).toHaveCount(1);
    await expect(results.first()).toContainText("The Long Night");
  });

  test("a short word brings a long list, the likeliest titles first (what the page has and what the library knows together), down to its end", async ({ browser, baseURL }) => {
    const rows = [{ id: "r", title: "Classics", source: "Test Source", kind: "movie", items: [{ id: "w", title: "Welcome to the Boondocks", url: "/fixtures/sample.mp4?w=1" }, { id: "n", title: "Boonie Bears", url: "/fixtures/sample.mp4?n=1" }] }];
    const server = [
      { id: "far", title: "Baboon", url: "/fixtures/sample.mp4?far=1" },
      ...Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, title: `Zed ${i + 1} Boone Story`, url: `/fixtures/sample.mp4?s=${i}` })),
      { id: "d", title: "The Boondocks", url: "/fixtures/sample.mp4?d=1" },
      { id: "b", title: "Boon", url: "/fixtures/sample.mp4?b=1" },
    ];
    const { phone } = await connect(browser, baseURL!, { library: { updatedAt: Date.now(), rows }, find: (query) => (query.includes("boon") ? server : []) });
    await place(phone, "search");
    await phone.getByTestId("library-search-input").fill("boon");
    const results = phone.getByTestId("library-result");
    await expect(results).toHaveCount(45);
    const titles = await results.evaluateAll((all) => all.map((one) => one.getAttribute("title")));
    expect(titles.slice(0, 4)).toEqual(["Boon", "Boonie Bears", "The Boondocks", "Welcome to the Boondocks"]);
    expect(titles.at(-1)).toBe("Baboon");

    await results.last().scrollIntoViewIfNeeded();
    await expect(results.last()).toBeInViewport();
  });

  test("the rows of the library are named in the language of the phone, and a row the app does not know keeps its place's name", async ({ browser, baseURL }) => {
    const rows = [
      { id: "filmpire-trending-movies", title: "Trending Movies", source: "Filmpire", kind: "movie", items: films },
      { id: "filmpire-comedy-tv", title: "Comedy Series", source: "Filmpire", kind: "series", items: [show] },
      { id: "elsewhere-picks", title: "Staff Picks", source: "Elsewhere", kind: "movie", items: [films[0]] },
    ];
    const { phone } = await connect(browser, baseURL!, { device: { locale: "ro-RO" }, library: { updatedAt: Date.now(), rows } });
    await expect(phone.getByTestId("library-row").locator("h3")).toHaveText(["Filme în tendințe", "Seriale de comedie", "Staff Picks"]);
  });

  test("Continue watching is a row of big cards that snap one at a time, each with a cross; a tap resumes, and a hold saves the title", async ({ browser, baseURL }) => {
    const now = Date.now();
    const progress = [0, 1, 2].map((i) => ({ key: `url:${baseURL}/fixtures/sample.mp4?n=${i}`, at: now - (i + 1) * 60_000, title: `Film number ${i + 1}`, url: `${baseURL}/fixtures/sample.mp4?n=${i}`, position: 1500, duration: 6000 }));
    const { tv, phone } = await connect(browser, baseURL!, { seed: guestStorage({ progress }) });
    const cards = phone.getByTestId("continue-item");
    await expect(cards).toHaveCount(3);
    await expect(phone.getByTestId("continue-row")).toContainText("Film number 3");

    const first = (await cards.nth(0).boundingBox())!;
    const next = (await cards.nth(1).boundingBox())!;
    expect(first.width).toBeGreaterThan(200);
    expect(next.x).toBeLessThan(390);
    expect(next.x + next.width).toBeGreaterThan(390);
    const cross = (await phone.getByTestId("continue-remove").first().boundingBox())!;
    expect(cross.width).toBeGreaterThanOrEqual(36);
    expect(cross.height).toBeGreaterThanOrEqual(36);
    await expect(phone.getByTestId("continue-list-toggle")).toHaveCount(0);

    await hold(phone, phone.getByTestId("continue-play").first());
    await place(phone, "list");
    await expect(phone.getByRole("region", { name: "Favourites" })).toContainText("Film number 1");
    await place(phone, "home");
    await phone.getByTestId("continue-remove").nth(1).click();
    await expect(cards).toHaveCount(2);
    await expect(phone.getByTestId("continue-row")).not.toContainText("Film number 2");

    await phone.getByTestId("continue-play").first().click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
  });

  const linkBoxSetting = async (phone: Page) => {
    await place(phone, "you");
    await phone.getByTestId("menu-settings").click();
    return phone.getByTestId("link-box-setting");
  };

  test("the subtitle languages to add are folded until asked for; one added is listed first, and the list to add from stays open for the next", async ({ browser, baseURL }) => {
    const { phone } = await connect(browser, baseURL!);
    await place(phone, "you");
    await phone.getByTestId("menu-settings").click();
    const page = phone.getByTestId("settings-page");
    await expect(page.getByTestId("subtitle-defaults")).toContainText("English, Romanian, Italian");
    await expect(page.locator('[data-testid^="add-language-"]')).toHaveCount(0);
    const add = page.getByTestId("add-language");
    await expect(add).toHaveAttribute("aria-expanded", "false");
    await add.click();
    await expect(add).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator('[data-testid^="add-language-"]')).toHaveCount(26);
    await page.getByTestId("add-language-fr").click();
    await page.getByTestId("add-language-ro").click();
    await expect(page.getByTestId("subtitle-languages")).toHaveText(/1\s*French.*2\s*Romanian/s);
    await expect(page.getByTestId("add-language-fr")).toHaveCount(0);
    await add.click();
    await expect(page.locator('[data-testid^="add-language-"]')).toHaveCount(0);
  });

  test("the box for pasting a link is off on a new phone, comes back from Settings and stays", async ({ browser, baseURL }) => {
    const { phone } = await connect(browser, baseURL!, { device: { storageState: withoutLinkBox(baseURL!) } });
    await expect(phone.getByTestId("library")).toBeVisible();
    await expect(phone.getByTestId("url-input")).toHaveCount(0);
    await expect(phone.getByTestId("play-url")).toHaveCount(0);

    const box = await linkBoxSetting(phone);
    await expect(box).toHaveAttribute("aria-checked", "false");
    await box.click();
    await expect(box).toHaveAttribute("aria-checked", "true");
    await phone.getByTestId("page-back").click();
    await place(phone, "home");
    await expect(phone.getByTestId("url-input")).toBeVisible();
    await expect(phone.getByTestId("play-url")).toHaveCount(0);
    await phone.getByTestId("url-input").fill("https://example.com/watch");
    await expect(phone.getByTestId("play-url")).toBeVisible();

    await phone.reload();
    await expect(phone.getByTestId("url-input")).toBeVisible();

    await (await linkBoxSetting(phone)).click();
    await phone.getByTestId("page-back").click();
    await place(phone, "home");
    await expect(phone.getByTestId("url-input")).toHaveCount(0);
  });

  test("the TV's menu does not carry the switch for the box: Settings is the one place that has it", async ({ browser, baseURL }) => {
    const { phone } = await connect(browser, baseURL!, { device: { storageState: withoutLinkBox(baseURL!) } });
    await phone.getByTestId("menu").click();
    await expect(phone.getByTestId("tvs-open")).toBeVisible();
    await expect(phone.getByTestId("link-box-toggle")).toHaveCount(0);
    await phone.getByTestId("sheet-close").click();
    await expect(await linkBoxSetting(phone)).toHaveAttribute("aria-checked", "false");
  });

  test("without the box, a title that cannot be played still says so", async ({ browser, baseURL }) => {
    const { phone } = await connect(browser, baseURL!, { device: { storageState: withoutLinkBox(baseURL!) } });
    await tile(phone, "No video here").click();
    await phone.getByTestId("title-play").click();
    await expect(phone.getByTestId("resolve-status")).toHaveAttribute("data-phase", "failed");
    await expect(phone.getByTestId("url-input")).toHaveCount(0);
    await expect(phone.getByTestId("toast")).toHaveText(await phone.getByTestId("resolve-status").innerText());
  });

  test("a title whose video is not there is gone from the phone's library once the server stops offering it", async ({ browser, baseURL }) => {
    const library = libraryOf(baseURL!);
    const { phone } = await connect(browser, baseURL!, { device: { storageState: withoutLinkBox(baseURL!) }, library });
    await expect(tile(phone, "No video here")).toHaveCount(1);
    await tile(phone, "No video here").click();
    library.rows[0]!.items = library.rows[0]!.items.filter((item) => item.id !== "nv");
    await phone.getByTestId("title-play").click();
    await expect(phone.getByTestId("resolve-status")).toHaveAttribute("data-phase", "failed");
    await expect(tile(phone, "No video here")).toHaveCount(0);
    await expect(tile(phone, "Film number 1")).toHaveCount(1);
  });

  test("with no library to pick from the box is there whatever the menu says, as the only way to play", async ({ browser, baseURL }) => {
    for (const answer of [(route: import("@playwright/test").Route) => route.fulfill({ status: 500, body: "nope" }), (route: import("@playwright/test").Route) => route.fulfill({ json: { rows: [], updatedAt: 0 } })]) {
      const tv = await openTv(browser);
      const phone = await openDevice(browser, { ...PHONE, storageState: withoutLinkBox(baseURL!) }, {}, async (context) => {
        await context.route("**/api/library", answer);
      });
      await phone.goto("/");
      await phone.getByTestId("code-input").fill(await readPairingCode(tv));
      await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
      await expect(phone.getByTestId("url-input")).toBeVisible();
      await expect(phone.getByTestId("play-url")).toHaveCount(0);
      await phone.getByTestId("url-input").fill("https://example.com/watch");
      await expect(phone.getByTestId("play-url")).toBeVisible();
    }
  });

  test.describe("ratings", () => {
    const day = (date: number) => Date.UTC(2026, 9, date, 12);
    const RATED_TODAY = /^Rated \d{1,2} [A-Za-z]{3,4} \d{4}$/;
    const facts = (phone: Page, id = "rate-title") => phone.getByTestId(`${id}-facts`).locator("li");

    async function open(phone: Page, id = "rate-title") {
      const toggle = phone.getByTestId(`${id}-toggle`);
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
    }
    const notesKept = (phone: Page) =>
      phone.evaluate(() => {
        const kept = JSON.parse(localStorage.getItem("kino.data.guest") ?? "{}") as { data?: { ratings?: Array<{ note?: string; deleted?: boolean }> } };
        return (kept.data?.ratings ?? []).filter((rating) => !rating.deleted).map((rating) => rating.note ?? "");
      });
    const given = (baseURL: string, n: number, score: number, date: number, extra: Record<string, unknown> = {}) => ({
      key: `rate:${baseURL}/fixtures/sample.mp4?n=${n}`,
      at: day(date),
      title: `Film number ${n + 1}`,
      url: `${baseURL}/fixtures/sample.mp4?n=${n}`,
      score,
      ratedAt: day(date),
      ...extra,
    });
    const wholeLibrary = (baseURL: string) => ({
      updatedAt: Date.now(),
      rows: [{ id: "r", title: "Classics", source: "Test Source", kind: "movie", items: films.map((film) => ({ ...film, url: `${baseURL}${film.url}` })) }],
    });

    test("one tap on a score is a rating, with the word for it and the day; another tap changes it, and it is still there when the page is opened again", async ({ browser, baseURL }) => {
      const { phone } = await connect(browser, baseURL!);
      await tile(phone, "Film number 1").click();
      const box = phone.getByTestId("rate-title");
      await expect(box).toHaveAttribute("data-rated", "false");
      await expect(phone.getByTestId("rate-title-value")).toHaveText("");
      await expect(phone.getByTestId("rate-title-score-8")).toBeVisible();
      await expect(phone.getByTestId("rate-title-word")).toHaveText("Pick a score out of 10");
      await expect(phone.getByTestId("rate-title-note")).toHaveCount(0);
      await expect(phone.getByTestId("rate-title-facts")).toHaveCount(0);
      await expect(phone.getByTestId("rate-title-remove")).toHaveCount(0);
      await expect(phone.getByTestId("ratings-row")).toHaveCount(0);

      await phone.getByTestId("rate-title-score-8").click();
      await expect(box).toHaveAttribute("data-rated", "true");
      await expect(phone.getByTestId("rate-title-value")).toHaveText("8/10");
      await expect(phone.getByTestId("rate-title-score-8")).toHaveAttribute("aria-checked", "true");
      await expect(phone.getByTestId("rate-title-score-7")).toHaveAttribute("aria-checked", "false");
      await expect(phone.getByTestId("rate-title-word")).toHaveText("Very good");
      await expect(phone.getByTestId("rate-title-remove")).toBeVisible();
      await open(phone);
      await expect(phone.getByTestId("rate-title-toggle")).toHaveText("Less");
      await expect(facts(phone)).toHaveText([RATED_TODAY]);
      await expect(phone.getByTestId("rate-title-note")).toBeEnabled();

      await phone.getByTestId("rate-title-score-3").click();
      await expect(phone.getByTestId("rate-title-value")).toHaveText("3/10");
      await expect(phone.getByTestId("rate-title-word")).toHaveText("Very bad");
      await expect(phone.getByTestId("rate-title-score-8")).toHaveAttribute("aria-checked", "false");

      for (const score of [1, 5, 10]) {
        const press = (await phone.getByTestId(`rate-title-score-${score}`).boundingBox())!;
        expect(press.width).toBeGreaterThanOrEqual(36);
        expect(press.height).toBeGreaterThanOrEqual(36);
      }

      await phone.getByTestId("title-back").click();
      await place(phone, "list");
      await expect(phone.getByTestId("ratings-row")).toContainText("Film number 1");
      await expect(phone.getByTestId("ratings-row").getByTestId("rating-item").locator(".lib-year")).toHaveText(["3/10"]);
      await phone.reload();
      await place(phone, "list");
      await expect(phone.getByTestId("ratings-row")).toContainText("Film number 1");
      await place(phone, "home");
      await tile(phone, "Film number 1").click();
      await expect(phone.getByTestId("rate-title-value")).toHaveText("3/10");
    });

    test("a note says why: it waits for a score, is kept as it is typed (even when the page is closed at once), and goes when the rating does", async ({ browser, baseURL }) => {
      const { phone } = await connect(browser, baseURL!);
      await tile(phone, "Film number 2").click();
      await open(phone);
      const note = phone.getByTestId("rate-title-note");
      await expect(note).toBeDisabled();
      await expect(note).toHaveAttribute("placeholder", "Pick a score first, then say why (optional)");
      await phone.getByTestId("rate-title-score-6").click();
      await expect(note).toBeEnabled();
      await expect(note).toHaveAttribute("placeholder", "Why? (optional)");

      await note.fill("Too long, but the ending paid off.");
      await expect.poll(() => notesKept(phone)).toEqual(["Too long, but the ending paid off."]);
      await expect(facts(phone)).toHaveText([RATED_TODAY]);

      await note.fill("Too long, but the ending paid off. Twice.");
      await phone.getByTestId("title-back").click();
      await place(phone, "list");
      await expect(phone.getByTestId("ratings-row")).toBeVisible();
      await place(phone, "home");
      await tile(phone, "Film number 2").click();
      await open(phone);
      await expect(phone.getByTestId("rate-title-note")).toHaveValue("Too long, but the ending paid off. Twice.");
      await expect(phone.getByTestId("rate-title-value")).toHaveText("6/10");

      await expect(phone.locator(".rating-count")).toHaveCount(0);
      await phone.getByTestId("rate-title-note").fill("x".repeat(320));
      await expect(phone.locator(".rating-count")).toHaveText("320/400");

      await phone.getByTestId("rate-title-remove").click();
      await expect(phone.getByTestId("rate-title")).toHaveAttribute("data-rated", "false");
      await expect(phone.getByTestId("rate-title-value")).toHaveText("");
      await expect(phone.getByTestId("rate-title-note")).toBeDisabled();
      await expect(phone.getByTestId("rate-title-note")).toHaveValue("");
      await expect.poll(() => notesKept(phone)).toEqual([]);
      await phone.getByTestId("title-back").click();
      await place(phone, "list");
      await expect(phone.getByTestId("ratings-row")).toHaveCount(0);
      await place(phone, "home");
      await tile(phone, "Film number 2").click();
      await open(phone);
      await phone.getByTestId("rate-title-score-4").click();
      await expect(phone.getByTestId("rate-title-note")).toHaveValue("");
    });

    test("the watching is told with the rating: all of a film once 95% of it was seen, else how much, and when", async ({ browser, baseURL }) => {
      const card = (n: number, position: number, at: number) => ({
        key: `url:${baseURL}/fixtures/sample.mp4?n=${n}`,
        at,
        title: `Film number ${n + 1}`,
        url: `${baseURL}/fixtures/sample.mp4?n=${n}`,
        position,
        duration: 6000,
      });
      const progress = [card(0, 5800, day(3)), card(1, 3720, day(4))];
      const { phone } = await connect(browser, baseURL!, { library: wholeLibrary(baseURL!), seed: guestStorage({ progress }) });

      await tile(phone, "Film number 1").click();
      await open(phone);
      await phone.getByTestId("rate-title-score-9").click();
      await expect(facts(phone)).toHaveText([RATED_TODAY, "Watched all of it", "Finished 3 Oct 2026"]);
      await phone.getByTestId("title-back").click();

      await tile(phone, "Film number 2").click();
      await open(phone);
      await phone.getByTestId("rate-title-score-7").click();
      await expect(facts(phone)).toHaveText([RATED_TODAY, "62% watched", "Last watched 4 Oct 2026"]);
      await phone.getByTestId("title-back").click();

      await tile(phone, "Film number 3").click();
      await open(phone);
      await phone.getByTestId("rate-title-score-5").click();
      await expect(facts(phone)).toHaveText([RATED_TODAY]);
    });

    test("each season of a show is rated on its own, apart from the show; the episodes seen are counted out of the season's", async ({ browser, baseURL }) => {
      const seen = (episode: number, season: number) => ({ key: `The Long Night|${season}x${episode}`, at: day(episode + (season - 1) * 3), show: "The Long Night", season, episode, position: 2400, duration: 2400, done: true });
      const { phone } = await connect(browser, baseURL!, { seed: guestStorage({ watched: [seen(1, 1), seen(2, 1), seen(1, 2)] }) });
      await tile(phone, "The Long Night").click();

      await open(phone);
      await expect(phone.getByTestId("rate-title")).toContainText("Your rating");
      await phone.getByTestId("rate-title-score-9").click();
      await expect(facts(phone)).toHaveText([RATED_TODAY, "3 episodes watched", "Last watched 4 Oct 2026"]);

      await expect(phone.getByTestId("rate-season-toggle")).toContainText("Season 1 rating");
      await expect(phone.getByTestId("rate-season-value")).toHaveText("Rate");
      await open(phone, "rate-season");
      await phone.getByTestId("rate-season-score-7").click();
      await expect(phone.getByTestId("rate-season-value")).toHaveText("7/10");
      await expect(facts(phone, "rate-season")).toHaveText([RATED_TODAY, "2 of 3 episodes watched", "Last watched 2 Oct 2026"]);

      await phone.getByTestId("title-season-2").click();
      await expect(phone.getByTestId("rate-season-toggle")).toContainText("Season 2 rating");
      await expect(phone.getByTestId("rate-season")).toHaveAttribute("data-rated", "false");
      await expect(phone.getByTestId("rate-season-value")).toHaveText("Rate");
      await open(phone, "rate-season");
      await phone.getByTestId("rate-season-score-5").click();
      await expect(facts(phone, "rate-season")).toHaveText([RATED_TODAY, "1 of 3 episodes watched", "Last watched 4 Oct 2026"]);

      await phone.getByTestId("title-season-1").click();
      await expect(phone.getByTestId("rate-season-value")).toHaveText("7/10");
      await expect(phone.getByTestId("rate-title-value")).toHaveText("9/10");
      await open(phone, "rate-season");
      await phone.getByTestId("rate-season-remove").click();
      await expect(phone.getByTestId("rate-season-value")).toHaveText("Rate");
      await expect(phone.getByTestId("rate-title-value")).toHaveText("9/10");
      await phone.getByTestId("title-season-2").click();
      await expect(phone.getByTestId("rate-season-value")).toHaveText("5/10");

      await phone.getByTestId("title-back").click();
      await place(phone, "list");
      await expect(phone.getByTestId("ratings-row").getByTestId("rating-item").locator(".lib-year")).toHaveText(["Season 2 · 5/10", "9/10"]);
    });

    test("My ratings is a row of what was rated, and a page with all of it: newest or best first, with the notes and the watching; a tap opens the title", async ({ browser, baseURL }) => {
      const url = baseURL!;
      const ratings = [
        given(url, 0, 6, 1),
        given(url, 1, 9, 5, { note: "Rewatched it twice.", percent: 100, watchedAt: day(4) }),
        {
          key: `rate:${episodeLink(1)}|s2`,
          at: day(9),
          title: "The Long Night",
          url: episodeLink(1),
          kind: "series",
          season: 2,
          score: 8,
          ratedAt: day(9),
          seen: 2,
          of: 3,
          watchedAt: day(8),
        },
      ];
      const { phone } = await connect(browser, url, { seed: guestStorage({ ratings }) });
      await place(phone, "list");
      const row = phone.getByTestId("ratings-row");
      await expect(row.getByTestId("rating-item")).toHaveCount(3);
      await expect(row.getByTestId("rating-item").locator(".lib-title")).toHaveText(["The Long Night", "Film number 2", "Film number 1"]);
      await expect(row.getByTestId("rating-item").locator(".lib-year")).toHaveText(["Season 2 · 8/10", "9/10", "6/10"]);

      await phone.getByTestId("ratings-all").click();
      const sheet = phone.getByTestId("ratings-sheet");
      await expect(sheet.getByTestId("ratings-summary")).toHaveText("3 ratings · average 7.7");
      const entries = sheet.getByTestId("rating-entry");
      await expect(entries.locator(".rating-name")).toHaveText(["The Long Night · Season 2", "Film number 2", "Film number 1"]);
      await expect(sheet.getByTestId("ratings-sort-new")).toHaveAttribute("aria-pressed", "true");
      await expect(entries.nth(1)).toContainText("9/10");
      await expect(entries.nth(1)).toContainText("Great");
      await expect(entries.nth(1)).toContainText("Rewatched it twice.");
      await expect(entries.nth(1).locator(".rating-facts span")).toHaveText(["Rated 5 Oct 2026", "Watched all of it", "Finished 4 Oct 2026"]);
      await expect(entries.nth(0).locator(".rating-facts span")).toHaveText(["Rated 9 Oct 2026", "2 of 3 episodes watched", "Last watched 8 Oct 2026"]);

      await sheet.getByTestId("ratings-sort-high").click();
      await expect(sheet.getByTestId("ratings-sort-high")).toHaveAttribute("aria-pressed", "true");
      await expect(entries.locator(".rating-name")).toHaveText(["Film number 2", "The Long Night · Season 2", "Film number 1"]);

      await expect(sheet.getByTestId("ratings-filter-all")).toHaveAttribute("aria-pressed", "true");
      await expect(sheet.locator('[data-testid^="ratings-filter-"]')).toHaveText(["All 3", "Movies 2", "Series 1"]);
      const pick = sheet.getByTestId("ratings-pick");
      await expect(pick).toHaveAttribute("aria-expanded", "false");
      await expect(sheet.locator('[data-testid^="ratings-score-"]')).toHaveCount(0);
      await pick.click();
      await expect(sheet.locator('[data-testid^="ratings-score-"] .lib-pick-name')).toHaveText(["Any score", "9", "8", "6"]);
      await expect(sheet.locator('[data-testid^="ratings-score-"] .lib-pill-count')).toHaveText(["3", "1", "1", "1"]);
      await sheet.getByTestId("ratings-filter-series").click();
      await expect(entries.locator(".rating-name")).toHaveText(["The Long Night · Season 2"]);
      await expect(sheet.getByTestId("ratings-pick")).toHaveCount(0);
      await sheet.getByTestId("ratings-filter-all").click();
      await pick.click();
      await sheet.getByTestId("ratings-score-9").click();
      await expect(sheet.locator('[data-testid^="ratings-score-"]')).toHaveCount(0);
      await expect(pick).toHaveAccessibleName("Score: Rated 9");
      await expect(entries.locator(".rating-name")).toHaveText(["Film number 2"]);
      await expect(sheet.getByTestId("ratings-summary")).toContainText("average 9");
      await sheet.getByTestId("ratings-filter-movie").click();
      await expect(entries.locator(".rating-name")).toHaveText(["Film number 2"]);
      await pick.click();
      await expect(sheet.locator('[data-testid^="ratings-score-"] .lib-pick-name')).toHaveText(["Any score", "9", "6"]);
      await sheet.getByTestId("ratings-filter-all").click();
      await pick.click();
      await sheet.getByTestId("ratings-score-any").click();
      await expect(entries.locator(".rating-name")).toHaveText(["Film number 2", "The Long Night · Season 2", "Film number 1"]);

      await entries.first().click();
      const page = phone.getByTestId("title-sheet");
      await expect(page).toContainText("Film number 2");
      await expect(page.getByTestId("rate-title-value")).toHaveText("9/10");
      await page.getByTestId("title-back").click();
      await expect(phone.getByTestId("ratings-sheet")).toBeVisible();
      await sheet.getByTestId("sheet-close").click();
      await expect(phone.getByTestId("ratings-sheet")).toHaveCount(0);
    });

    test("ratings show for everybody: a profile that had turned them off has them all the same, with what it rated, and the settings have no switch for them", async ({ browser, baseURL }) => {
      const url = baseURL!;
      const off = [{ key: "ratings", at: Date.now(), value: false }];
      const { phone } = await connect(browser, url, { library: wholeLibrary(url), seed: guestStorage({ ratings: [given(url, 0, 8, 2)], settings: off }) });
      await place(phone, "list");
      await expect(phone.getByTestId("ratings-row")).toContainText("Film number 1");
      await place(phone, "home");
      await expect(tile(phone, "Film number 1").getByTestId("score-badge")).toHaveText("8");
      await tile(phone, "Film number 1").click();
      await expect(phone.getByTestId("rate-title-value")).toHaveText("8/10");
      await phone.getByTestId("title-back").click();
      await place(phone, "you");
      await phone.getByTestId("menu-settings").click();
      await expect(phone.getByTestId("settings-page")).toBeVisible();
      await expect(phone.getByTestId("ratings-switch")).toHaveCount(0);
    });

    test("a rated title shows its score in the corner of its picture, in the rows, a search, Continue watching and a list; one not rated shows none", async ({ browser, baseURL }) => {
      const url = baseURL!;
      const link = (n: number) => `${url}/fixtures/sample.mp4?n=${n}`;
      const started = { key: `url:${link(4)}`, at: day(5), title: "Film number 5", url: link(4), position: 1500, duration: 6000 };
      const kept = { key: `url:${link(6)}`, at: day(6), id: "f6", title: "Film number 7", url: link(6) };
      const ratings = [given(url, 0, 8, 2), given(url, 4, 6, 3), given(url, 6, 9, 4), given(url, 1, 3, 5, { key: `rate:${link(1)}|s2`, season: 2 })];
      const whole = films.map((film) => ({ ...film, url: `${url}${film.url}` }));
      const { phone } = await connect(browser, url, {
        library: wholeLibrary(url),
        find: (query) => whole.filter((film) => film.title.toLowerCase().includes(query.toLowerCase())),
        seed: guestStorage({ ratings, progress: [started], list: [kept] }),
      });
      const badge = (where: Locator) => where.getByTestId("score-badge");

      await expect(badge(tile(phone, "Film number 1"))).toHaveText("8");
      await expect(badge(tile(phone, "Film number 1"))).toHaveAttribute("title", "Your rating: 8/10");
      await expect(tile(phone, "Film number 1")).toHaveAccessibleName(/Your rating: 8\/10/);
      await expect(tile(phone, "Film number 2")).not.toHaveAccessibleName(/Your rating/);
      await expect(phone.getByTestId("continue-play")).toHaveAccessibleName(/Your rating: 6\/10/);
      await expect(badge(tile(phone, "Film number 2"))).toHaveCount(0);
      await expect(badge(tile(phone, "Film number 3"))).toHaveCount(0);
      await expect(badge(phone.getByTestId("continue-item"))).toHaveText("6");
      await place(phone, "list");
      await expect(badge(phone.getByTestId("list-item"))).toHaveText("9");
      await expect(badge(phone.getByTestId("ratings-row"))).toHaveCount(0);
      await place(phone, "home");

      await hold(phone, tile(phone, "Film number 1"));
      const score = (await badge(tile(phone, "Film number 1")).boundingBox())!;
      const tick = (await tile(phone, "Film number 1").getByTestId("saved-mark").boundingBox())!;
      expect(score.x + score.width).toBeLessThan(tick.x);
      await hold(phone, tile(phone, "Film number 1"));
      await expect(tile(phone, "Film number 1").getByTestId("saved-mark")).toHaveCount(0);

      await place(phone, "search");
      await phone.getByTestId("library-search-input").fill("film number 1");
      const found = (title: string) => phone.locator(`[data-testid="library-result"][title="${title}"]`);
      await expect(found("Film number 1")).toBeVisible();
      await expect(badge(found("Film number 1"))).toHaveText("8");
      await expect(found("Film number 10")).toBeVisible();
      await expect(badge(found("Film number 10"))).toHaveCount(0);
      await phone.getByTestId("library-search-input").fill("");
      await place(phone, "home");

      await tile(phone, "Film number 3").click();
      await phone.getByTestId("rate-title-score-4").click();
      await phone.getByTestId("title-back").click();
      await expect(badge(tile(phone, "Film number 3"))).toHaveText("4");
      await tile(phone, "Film number 3").click();
      await phone.getByTestId("rate-title-remove").click();
      await phone.getByTestId("title-back").click();
      await expect(badge(tile(phone, "Film number 3"))).toHaveCount(0);
    });

    test("the account page has My ratings among the profile's places, for a guest too, saying how many; it opens the list over the page, and a title opened from it shows over the list", async ({ browser, baseURL }) => {
      const url = baseURL!;
      const { phone } = await connect(browser, url, { library: wholeLibrary(url), seed: guestStorage({ ratings: [given(url, 0, 8, 2), given(url, 1, 5, 3)] }) });
      await phone.getByTestId("account-button").click();
      const row = phone.getByTestId("menu-ratings");
      await expect(row).toContainText("My ratings");
      await expect(row).toContainText("2");
      await row.click();
      const sheet = phone.getByTestId("ratings-sheet");
      await expect(sheet.getByTestId("ratings-summary")).toHaveText("2 ratings · average 6.5");
      await expect(sheet.getByTestId("rating-entry").locator(".rating-name")).toHaveText(["Film number 2", "Film number 1"]);

      await sheet.getByTestId("rating-entry").first().click();
      const page = phone.getByTestId("title-sheet");
      await expect(page).toContainText("Film number 2");
      await expect(page.getByTestId("rate-title-value")).toHaveText("5/10");
      await page.getByTestId("title-back").click();
      await expect(sheet).toBeVisible();
      await sheet.getByTestId("sheet-close").click();
      await expect(sheet).toHaveCount(0);
      await expect(phone.getByTestId("account-screen")).toBeVisible();
    });

    test("My ratings works on a phone with no TV: the keyboard is in the sheet, a title opens from it (with no Play), its rating can be taken back, and with none the sheet says what to do", async ({ browser, baseURL }) => {
      const url = baseURL!;
      const phone = await openDevice(browser, PHONE, guestStorage({ ratings: [given(url, 0, 8, 2)] }), withLibrary(wholeLibrary(url), () => []));
      await phone.goto("/");
      await expect(phone.getByTestId("code-input")).toBeVisible();
      await phone.getByTestId("account-button").click();
      const row = phone.getByTestId("menu-ratings");
      await row.click();
      const sheet = phone.getByTestId("ratings-sheet");
      await expect(sheet).toBeFocused();

      await sheet.getByTestId("rating-entry").click();
      const page = phone.getByTestId("title-sheet");
      await expect(page).toContainText("Film number 1");
      await expect(page.getByTestId("title-play")).toHaveCount(0);
      await expect(page.getByTestId("rate-title-value")).toHaveText("8/10");
      await open(phone);
      await page.getByTestId("rate-title-remove").click();
      await page.getByTestId("title-back").click();
      await expect(sheet.getByTestId("ratings-empty")).toBeVisible();
      await expect(sheet.getByTestId("ratings-sort-new")).toHaveCount(0);
      await sheet.getByTestId("sheet-close").click();
      await expect(row).toBeFocused();
    });
  });
});
