import { chromium, expect, test, type Browser, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import qrcode from "qrcode-generator";
import type { NormalizedMedia } from "../src/shared";
import { en } from "../src/client/i18n/en";
import { loadOnTv, openDevice, openLibrary, openPairedPhone, openTv, PHONE, playFirst, RawPhone, readPairingCode, tvRoot, tvTime, withLibrary } from "./helpers";

const sample = (baseURL: string) => `${baseURL}/fixtures/sample.mp4`;

/** A 30-second-ish series entry whose episode list points at pages the test server can really resolve. */
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

/** A Y4M "camera recording" of one QR code, for Chromium's fake webcam. */
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
    await expect(tv.getByTestId("tv-browse")).toBeVisible(); // the library first, with nothing to press; the code is one menu entry away
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
    await expect(wide.getByTestId("tv-browse")).toBeVisible(); // asking once did not change what "/" is
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
    expect(phone.url()).not.toContain("code="); // the code doesn't linger in the address bar
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
      await expect(phone.getByTestId("scanner")).toHaveCount(0); // closed itself
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
    await expect(phone.getByTestId("scanner-hint")).toHaveAttribute("role", "alert"); // no camera in this browser: it says so
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
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle"); // playback stopped
    const fresh = await readPairingCode(tv); // and the TV is offering itself again
    await phone.getByTestId("code-input").fill(fresh);
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
  });

  test("the TV can disconnect while it waits for a video, using only the remote's keys", async ({ browser }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await expect(tv.getByTestId("tv-paired")).toBeVisible();
    const button = tv.getByTestId("tv-disconnect");
    const browse = tv.getByTestId("tv-back-to-library");
    await expect(button).not.toBeFocused(); // a stray OK press must not disconnect anything
    await expect(browse).not.toBeFocused();

    await tv.keyboard.press("ArrowDown"); // the first press only lands on the first button
    await expect(browse).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(button).toBeFocused();
    await tv.keyboard.press("ArrowLeft");
    await expect(browse).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-paired")).toBeVisible();
    await tv.keyboard.press("Enter");

    await expect(tv.getByTestId("pairing-code")).toBeVisible();
    await expect(phone.getByTestId("code-input")).toBeVisible();
    await phone.getByTestId("code-input").fill(await readPairingCode(tv));
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await expect(tv.getByTestId("tv-paired")).toBeVisible();
  });
});

test.describe("playing links", () => {
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

    await phone.reload(); // the list lives in the phone's storage
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

    // Left/right seek, and say by how much.
    await tv.keyboard.press("ArrowRight");
    await tv.keyboard.press("ArrowRight");
    await expect(tv.locator(".hud-toast")).toHaveText("+20s");
    await expect.poll(() => tvTime(tv)).toBeGreaterThanOrEqual(19);

    // Down steps onto the buttons; right moves along them to the speed button.
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("tv-play-btn")).toBeFocused();
    for (let i = 0; i < 8 && !(await tv.getByTestId("tv-speed-btn").evaluate((el) => el === document.activeElement)); i++) {
      await tv.keyboard.press("ArrowRight");
    }
    await expect(tv.getByTestId("tv-speed-btn")).toBeFocused();

    // OK opens the menu on the current speed; down + OK picks the next one; back closes.
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("audio-subtitles-modal")).toHaveAttribute("data-kind", "speed");
    await tv.keyboard.press("ArrowDown");
    await tv.keyboard.press("Enter");
    await expect.poll(() => tv.evaluate(() => document.querySelector("video")!.playbackRate)).toBe(1.25);
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("audio-subtitles-modal")).toHaveCount(0);
    phone.close();
  });

  test("the controls fade away while playing, stay while paused, and the big play button works", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: { title: "Sample", stream: { url: "/fixtures/sample.mp4", type: "mp4" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "visible");

    await tv.getByTestId("tv-paused-play").click(); // the big button in the middle
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "hidden", { timeout: 5_000 });

    await tv.mouse.click(640, 360); // a click on the picture pauses, and brings the controls back
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "visible");
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

    await tv.getByTestId("tv-mute-btn").click(); // the button does the same (the key press just woke the controls)
    await expect.poll(muted).toBe(false);
    await expect(tv.locator(".hud-toast")).toHaveText(en["notice.unmuted"]);
    await expect(tv.getByTestId("tv-mute-btn")).toHaveAttribute("aria-pressed", "false");
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing"); // and nothing else was touched
    phone.close();
  });

  test("subtitle language and size are remembered for the next video", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    const track = (index: number) => tv.evaluate((i) => document.querySelector("video")!.textTracks[i]?.mode, index);

    phone.cmd({ type: "LOAD", media: seriesMedia(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect.poll(() => track(1)).toBe("disabled"); // nothing chosen yet, nothing forced on

    phone.cmd({ type: "SET_SUBTITLE", track: 1 }); // Dutch
    await expect.poll(() => track(1)).toBe("hidden");

    // A different video with the same choices: Dutch comes back by itself.
    phone.cmd({ type: "LOAD", media: { ...seriesMedia(baseURL!), stream: { url: "/fixtures/sample.mp4?again=1", type: "mp4" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect.poll(() => track(1)).toBe("hidden");
    expect(await track(0)).toBe("disabled");

    // Turning them off is remembered too.
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

    const box = async () => (await modal.boundingBox())!;
    const before = await box();
    const preview = () => tv.getByTestId("subtitle-preview").locator("span");
    const fontSize = async () => parseFloat(await preview().evaluate((el) => getComputedStyle(el).fontSize));
    const mediumPx = await fontSize();

    await tv.getByRole("option", { name: /^Size/ }).focus(); // just moving onto a setting lists its choices
    for (const label of ["Large", "Small", "Medium"]) {
      await tv.getByRole("option", { name: label, exact: true }).click();
      const now = await box();
      expect([now.x, now.y, now.width, now.height]).toEqual([before.x, before.y, before.width, before.height]);
    }
    await tv.getByRole("option", { name: "Large", exact: true }).click();
    await expect.poll(fontSize).toBeGreaterThan(mediumPx); // it eases to the new size

    await tv.getByRole("option", { name: /^Text color/ }).focus();
    await tv.getByRole("option", { name: "Yellow", exact: true }).click();
    await expect.poll(() => preview().evaluate((el) => getComputedStyle(el).color)).toBe("rgb(255, 235, 59)");
    const now = await box();
    expect([now.x, now.y, now.width, now.height]).toEqual([before.x, before.y, before.width, before.height]);

    expect(JSON.parse(await tv.evaluate(() => localStorage.getItem("tv.prefs")!)).captionStyle).toMatchObject({ size: "large", color: "yellow" });
    phone.close();
  });

  test("subtitles are drawn by the page in the chosen look, and the phone sees the look", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: seriesMedia(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect(tv.getByTestId("caption")).toHaveCount(0); // none chosen yet

    phone.cmd({ type: "SET_SUBTITLE", track: 0 });
    const caption = tv.getByTestId("caption");
    await expect(caption).toHaveText("Hello, this is a subtitle test!");
    const css = (property: string) => caption.evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), property);
    const px = async (property: string) => parseFloat(await css(property));
    expect(await px("font-size")).toBeCloseTo(0.046 * 720, 0); // medium: 4.6% of a 720-pixel-high screen
    expect(await css("color")).toBe("rgb(255, 255, 255)");
    expect(await tv.evaluate(() => document.querySelector("video")!.textTracks[0]?.mode)).toBe("hidden"); // the browser doesn't paint them too

    phone.cmd({ type: "SET_CAPTION_STYLE", style: { size: "large", color: "yellow", spacing: "wide", background: "0", position: "high" } });
    await expect.poll(() => px("font-size")).toBeCloseTo(0.06 * 720, 0);
    expect(await css("color")).toBe("rgb(255, 235, 59)");
    expect(await px("word-spacing")).toBeCloseTo(0.25 * 0.06 * 720, 0);
    expect(await css("background-color")).toBe("rgba(0, 0, 0, 0)");
    await expect.poll(() => phone.states.at(-1)?.captionStyle?.color).toBe("yellow"); // the phone's sheet shows the real values

    // Playing, the controls fade; then the captions sit at the chosen height (18% up), not above the controls.
    phone.cmd({ type: "PLAY" });
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "hidden", { timeout: 6_000 });
    const bottom = () => tv.getByTestId("captions").evaluate((el) => 720 - el.getBoundingClientRect().bottom);
    await expect.poll(bottom).toBeCloseTo(0.18 * 720, -1);

    // The look is remembered for the next video.
    phone.cmd({ type: "LOAD", media: { ...seriesMedia(baseURL!), stream: { url: "/fixtures/sample.mp4?again=1", type: "mp4" } } });
    await expect(tv.getByTestId("caption")).toHaveText("Hello, this is a subtitle test!");
    expect(await css("color")).toBe("rgb(255, 235, 59)");
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
    await phone.getByTestId("subtitle-0").click(); // English
    await phone.getByTestId("open-caption-style").click();
    await expect(phone.getByTestId("captions-sheet")).toBeVisible();
    await expect(phone.getByTestId("caption-color-white")).toHaveAttribute("aria-checked", "true");

    await phone.getByTestId("caption-color-yellow").click();
    await phone.getByTestId("caption-spacing-wider").click();
    await expect(phone.getByTestId("caption-color-yellow")).toHaveAttribute("aria-checked", "true"); // the TV reported it back
    await expect(phone.getByTestId("caption-preview").locator("span")).toHaveCSS("color", "rgb(255, 235, 59)");
    const caption = tv.getByTestId("caption");
    await expect(caption).toHaveCSS("color", "rgb(255, 235, 59)");
    await expect(caption).toHaveCSS("word-spacing", `${0.5 * 0.046 * 720}px`);

    await phone.getByTestId("caption-reset").click();
    await expect(caption).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(phone.getByTestId("caption-spacing-normal")).toHaveAttribute("aria-checked", "true");
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
    await expect(card(2).locator("img")).toHaveCount(0); // its picture does not load, so the tile is a colour instead
    await expect(card(3)).toContainText("1 h 1 min"); // the length, said in hours once it is more than one
    await expect(card(2)).toContainText("Now playing"); // episode 2 is the one on
    await expect(card(2)).toHaveAttribute("aria-selected", "true");
    // The page asked about the season by the first episode's link, once.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("season=1");
    expect(asked[0]).toContain(encodeURIComponent(`${baseURL}/fixtures/pages/video.html`));

    // The remote moves down the cards and OK plays the one it stops on.
    await tv.keyboard.press("ArrowDown");
    await expect(card(3)).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-title")).toHaveText("Fixture HLS Stream", { timeout: 15_000 });
    phone.close();
  });

  test("when the library knows nothing of the episodes the list stays plain", async ({ browser, baseURL }) => {
    const tv = await openTv(browser); // the test server has no library, so it has nothing to say about a season
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

    await phone.getByTestId("episode").nth(2).click(); // Cold Open
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
    await expect(row(1)).toContainText("The Pilot"); // the library's name, over the source's "Pilot"
    await expect(row(1)).toContainText("A stranger arrives in town.");
    await expect(row(1)).toContainText("47 min");
    await expect(row(3)).toContainText("1 h 1 min");
    await expect(row(2)).toContainText("The Long Night"); // the library has nothing on it, so the source's name stays
    await expect(row(2)).toContainText("Now playing");
  });
});

test.describe("watched markers", () => {
  const third = (baseURL: string): NormalizedMedia => {
    const base = seriesMedia(baseURL);
    return { ...base, title: "The Long Night · S1 E3", stream: { url: "/fixtures/sample.mp4?third=1", type: "mp4" }, series: { ...base.series!, episode: 3 } };
  };

  type Saved = { episode: number; done: boolean; position: number };
  /** What a screen has kept of the episodes watched: nobody is signed in, so it is the browser's own (guest) copy of the profile data. */
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
    phone.cmd({ type: "LOAD", media: seriesMedia(baseURL!) }); // episode 2: watch it to the end (the sample is 30 seconds long)
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    phone.cmd({ type: "SEEK", time: 29 });
    await expect.poll(() => tvTime(tv)).toBeGreaterThan(28);
    await expect.poll(async () => (await savedOnTv(tv)).find((entry) => entry.episode === 2)?.done).toBe(true);

    phone.cmd({ type: "LOAD", media: third(baseURL!) }); // episode 3: leave it 20 seconds in
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    phone.cmd({ type: "SEEK", time: 20 });
    await expect.poll(async () => (await savedOnTv(tv)).find((entry) => entry.episode === 3)?.position ?? 0).toBeGreaterThan(19);
    phone.cmd({ type: "LOAD", media: seriesMedia(baseURL!) }); // back on episode 2
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");

    await tv.getByTestId("tv-episodes-btn").click();
    await expect(tv.getByRole("option", { name: /3\. Cold Open/ })).toContainText("1 min left");
    await expect(tv.getByRole("option", { name: /1\. Pilot/ })).not.toContainText("Watched"); // never played
    // episode 2 is the one playing, so it shows the check mark rather than a note
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
    await expect(row(2)).toHaveAttribute("data-status", "watched"); // it is the one playing, and also watched
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

    // Someone who has chosen no languages gets the site's own, English, Romanian and Italian first: Dutch comes after them.
    await expect(tv.getByText("More languages", { exact: true })).toBeVisible();
    const order = await tv.getByRole("listbox", { name: "Subtitles" }).getByRole("option").allTextContents();
    expect(order.map((text) => text.trim()).filter((text) => text !== "Off")).toEqual(["English (SDH)", "Romanian", "Dutch"]);

    await phone.getByTestId("chip-tracks").click();
    await expect(phone.getByTestId("subtitle-0")).toHaveText(/Romanian/);
    await expect(phone.getByTestId("subtitle-1")).toHaveCount(0); // Dutch is not one of the three: it is one tap away
    await phone.getByTestId("subtitle-more").click();
    await expect(phone.getByTestId("subtitle-1")).toHaveText(/Dutch/);
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

  test("when every source fails, the TV says so instead of looping", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: withSources([{ url: "/fixtures/nope-1.mp4" }, { url: "/fixtures/nope-2.mp4" }]) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "error", { timeout: 15_000 });
    await tv.waitForTimeout(1500);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "error"); // still, not trying again and again
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
    await tv.evaluate(() => void (document.querySelector("video")!.currentTime = 5)); // past the first second, when nothing is announced

    // asked for from the phone
    await phone.getByTestId("chip-speed").click();
    await phone.getByTestId("speed-1.5").click();
    await expect(tv.getByTestId("tv-toast")).toHaveText("Speed 1.5×");
    await expect(phone.getByTestId("toast")).toHaveText("Speed 1.5×");

    // asked for from the TV's own remote keys: C cycles the subtitles
    await tv.keyboard.press("c");
    await expect(tv.getByTestId("tv-toast")).toHaveText("Subtitles: English");
    await expect(phone.getByTestId("toast")).toHaveText("Subtitles: English");
    await tv.keyboard.press("c");
    await tv.keyboard.press("c");
    await expect(tv.getByTestId("tv-toast")).toHaveText("Subtitles off");
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
    phone.cmd({ type: "LOAD", media: seriesMedia(baseURL!) }); // episode 2 of 3
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

    await loadOnTv(phone, first); // episode 2
    await expect(phone.getByTestId("previous-episode")).toContainText("Pilot");
    await phone.getByTestId("previous-episode").click();
    await expect(phone.getByTestId("media-title")).toHaveText("Fixture Movie (HTML5 video)");
    await expect(tvRoot(tv)).toHaveAttribute("data-state", /playing|paused/);
  });
});

test.describe("full screen", () => {
  const isFullScreen = (tv: Page) => tv.evaluate(() => document.fullscreenElement !== null);

  test("the TV goes full screen with the first title chosen on it, and is left alone after that", async ({ browser, baseURL }) => {
    const films = { updatedAt: Date.now(), rows: [{ id: "r", title: "Films", source: "Test", items: [{ id: "a", title: "The Sample", url: sample(baseURL!) }] }] };
    const tv = await openLibrary(browser, withLibrary(films));
    expect(await isFullScreen(tv)).toBe(false); // nothing was asked of the viewer first
    await playFirst(tv);
    await expect.poll(() => isFullScreen(tv)).toBe(true);

    await tv.keyboard.press("f"); // leaving is the viewer's choice
    await expect.poll(() => isFullScreen(tv)).toBe(false);
    await tv.keyboard.press("Escape"); // back to the library, on the title it left (the film now also has a card in Continue watching, above it)
    await expect(tv.locator("[data-testid='tv-browse-tile']:focus")).toHaveAttribute("title", "The Sample");
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    expect(await isFullScreen(tv)).toBe(false); // not pulled back in for the next title
  });

  test("the phone's button leaves full screen, and asks for an OK press on the TV to come back", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.getByTestId("url-input").fill(sample(baseURL!));
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await tv.keyboard.press("f"); // a press on the TV itself is what lets it go full screen
    const button = phone.getByTestId("fullscreen");
    await expect(button).toHaveText("Exit full screen"); // the phone shows what the TV is really doing

    // A browser lets a page go full screen only for a few seconds after a click or key press on that page, and a command
    // from the phone is neither. (Playwright counts its own calls into the page as presses, so the TV is left alone until then.)
    await tv.waitForTimeout(5500);
    await button.click();
    await expect(button).toHaveText("Full screen"); // leaving needs no press

    await button.click(); // going in does: the TV says so, and so does the phone
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

  /** A phone with its TV, and a second TV that the phone has just added to watch along. */
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
    await expect(phone.getByTestId("party-code")).toHaveValue(""); // ready for another
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

  test("a follower has no controls of its own: keys do nothing, and the phone's stop ends it for both", async ({ browser, baseURL }) => {
    const { leader, phone, follower } = await party(browser);
    await phone.getByTestId("sheet-close").click();
    await phone.getByTestId("url-input").fill(sample(baseURL!));
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(follower)).toHaveAttribute("data-state", "playing");

    await follower.keyboard.press("Space"); // play/pause on any other TV
    await follower.waitForTimeout(1500);
    await expect(tvRoot(follower)).toHaveAttribute("data-state", "playing");
    await expect(leader.getByTestId("tv-play-btn")).toHaveCount(1);
    await expect(follower.getByTestId("tv-play-btn")).toHaveCount(0); // no player buttons on the follower

    await phone.getByTestId("stop").click();
    await expect(tvRoot(leader)).toHaveAttribute("data-state", "idle");
    await expect(tvRoot(follower)).toHaveAttribute("data-state", "idle");
    await expect(follower.getByTestId("tv-following")).toBeVisible(); // still in the party, waiting
    await expect(follower.getByTestId("tv-back-to-library")).toHaveCount(0); // it can't choose what plays, so no library
    await expect(follower.getByTestId("tv-browse")).toHaveCount(0);
    await expect(follower.getByTestId("tv-disconnect")).toHaveText("Stop watching along");
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
    await expect(follower.getByTestId("pairing-code")).toBeVisible(); // back to its own code
    await expect(tvRoot(leader)).toHaveAttribute("data-state", "idle");

    // Add it again, play, and leave from the TV with the remote: Down moves onto the bar, Right along it to Leave, OK presses it.
    await phone.getByTestId("party-code").fill(await readPairingCode(follower));
    await expect(phone.getByTestId("party-tv")).toHaveCount(1);
    await phone.getByTestId("sheet-close").click();
    await phone.getByTestId("url-input").fill(sample(baseURL!));
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(follower)).toHaveAttribute("data-state", "playing");
    await follower.keyboard.press("ArrowDown"); // wakes the overlay
    await follower.keyboard.press("ArrowDown"); // onto the first button of the bar (Mute)
    for (let i = 0; i < 4 && !(await follower.getByTestId("tv-leave").evaluate((el) => el === document.activeElement)); i++) {
      await follower.keyboard.press("ArrowRight");
    }
    await expect(follower.getByTestId("tv-leave")).toBeFocused();
    await follower.keyboard.press("Enter");
    await expect(follower.getByTestId("pairing-code")).toBeVisible();
    await expect(tvRoot(leader)).toHaveAttribute("data-state", "playing"); // the leader carries on
    await expect(phone.getByTestId("party-count")).toHaveCount(0);
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
    await host.getByTestId("rail-party").click();
    await host.getByTestId("tv-party-start").click();
    return codeOf(host);
  }
  /** The remote of a screen that is not in a party yet: Watch party in the menu, then Join, then the digits. */
  async function joinWith(guest: Page, code: string) {
    await guest.getByTestId("rail-party").click();
    await guest.getByTestId("tv-party-join").click();
    await guest.keyboard.type(code);
  }
  /** A host that has started a party, and a guest that has joined it by typing the code. */
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

    await host.getByTestId("tv-back-to-library").click(); // the menu goes on saying so
    await expect(host.getByTestId("rail-party")).toHaveAttribute("data-badged", "true");
  });

  test("what the host plays plays on the guest, and its pause and speed carry over", async ({ browser, baseURL }) => {
    const { host, guest } = await party(browser, baseURL!);
    await host.getByTestId("tv-back-to-library").click();
    await playFirst(host);
    await expect(tvRoot(host)).toHaveAttribute("data-state", "playing");
    await expect(tvRoot(guest)).toHaveAttribute("data-state", "playing");
    await expect(guest.getByTestId("tv-follow-bar")).toBeVisible();
    await expect(guest.getByTestId("tv-play-btn")).toHaveCount(0); // the host has the controls

    await host.keyboard.press("Space");
    await expect(tvRoot(host)).toHaveAttribute("data-state", "paused");
    await expect.poll(async () => (await video(guest)).paused).toBe(true);

    await host.mouse.move(60, 60); // wakes the controls
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
    const code = await codeOf(host);

    const guest = await screen(browser, baseURL!);
    await joinWith(guest, code);
    await expect(tvRoot(guest)).toHaveAttribute("data-state", /playing|paused/, { timeout: 15_000 });
    await expect.poll(async () => Math.abs((await video(guest)).time - (await video(host)).time), { timeout: 10_000 }).toBeLessThan(2.5);
    await expect(host.getByTestId("tv-party-member")).toHaveCount(2);

    await host.keyboard.press("Escape"); // closes the panel
    await expect(host.getByTestId("tv-party-panel")).toHaveCount(0);
    await host.mouse.move(80, 80);
    await expect(host.getByTestId("tv-party-btn")).toContainText("2 TVs");
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
    await guest.getByRole("option", { name: "English" }).click();
    await expect(guest.getByRole("option", { name: "English" })).toHaveAttribute("aria-selected", "true");
    await guest.waitForTimeout(800);
    expect(phone.states.at(-1)?.subtitles?.current).toBe(-1); // what the host shows did not change
    phone.close();
  });

  test("a code that is wrong is refused, and the number pad starts over", async ({ browser, baseURL }) => {
    const guest = await screen(browser, baseURL!);
    await joinWith(guest, "000000");
    await expect(guest.getByTestId("tv-party-error")).toHaveText("Invalid or expired code.");
    const filled = guest.getByTestId("tv-party-digits").locator('[data-filled="true"]');
    await expect(filled).toHaveCount(0);

    for (const digit of "123") await guest.getByTestId(`pad-${digit}`).click(); // the on-screen keys work as well
    await expect(filled).toHaveCount(3);
    await guest.keyboard.press("Escape"); // Back takes a digit back, and leaves when there are none
    await expect(filled).toHaveCount(2);
    await guest.keyboard.press("Escape");
    await guest.keyboard.press("Escape");
    await expect(guest.getByTestId("tv-party-start")).toHaveCount(0);
    await guest.keyboard.press("Escape");
    await expect(guest.getByTestId("tv-party-start")).toBeVisible();
  });

  test("the party's link joins a screen as soon as it is unlocked, and leaves nothing in the address", async ({ browser, baseURL }) => {
    const host = await screen(browser, baseURL!);
    const code = await startParty(host);
    const guest = await openDevice(browser, { viewport: { width: 1280, height: 720 } });
    await guest.goto(`/?party=${code}`);
    // This is the one screen that still asks for a press first (the host's video will play on it without anyone choosing anything).
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

  test("the host sends a guest away, and the guest is told and can come back with the same code", async ({ browser, baseURL }) => {
    const { host, guest, code } = await party(browser, baseURL!);
    await host.getByTestId("tv-party-remove").click();
    await expect(host.getByTestId("tv-party-member")).toHaveCount(1);
    await expect(guest.getByTestId("tv-following")).toHaveCount(0);
    await expect(guest.getByTestId("tv-flash")).toHaveText("You are no longer in the party.");
    await expect(guest.getByTestId("tv-party-start")).toBeVisible();

    await guest.getByTestId("tv-party-join").click(); // the code is still good
    await guest.keyboard.type(code);
    await expect(guest.getByTestId("tv-following")).toBeVisible();
    await expect(host.getByTestId("tv-party-member")).toHaveCount(2);
  });

  test("a guest that leaves by choice is not told it has left", async ({ browser, baseURL }) => {
    const { host, guest } = await party(browser, baseURL!);
    await guest.getByTestId("tv-disconnect").click();
    await expect(guest.getByTestId("tv-party-start")).toBeVisible();
    await expect(host.getByTestId("tv-party-member")).toHaveCount(1);
    await expect(guest.getByTestId("tv-flash")).toHaveCount(0);
  });

  test("ending the party sends everyone back to their own screen", async ({ browser, baseURL }) => {
    const { host, guest } = await party(browser, baseURL!);
    await host.getByTestId("tv-party-end").click();
    await expect(host.getByTestId("tv-party-start")).toBeVisible();
    await expect(guest.getByTestId("tv-following")).toHaveCount(0);
    await expect(guest.getByTestId("tv-flash")).toHaveText("You are no longer in the party.");
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
    await expect(phone.getByTestId("party-join-code")).toBeVisible(); // the code is still good for the next screen
    await phone.getByTestId("sheet-close").click();
    await expect(phone.getByTestId("party-count")).toHaveText("+1");
  });

  test("the phone shares the party's link, or copies it where sharing isn't there", async ({ browser }) => {
    const host = await openTv(browser);
    const phone = await openPairedPhone(browser, host);
    await phone.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const defineShare = (share: unknown) =>
      phone.evaluate((value) => {
        Object.defineProperty(navigator, "share", { configurable: true, value: value ? (data: ShareData) => ((window as unknown as { shared: ShareData }).shared = data) : undefined });
      }, share);
    await phone.getByTestId("menu").click();
    await phone.getByTestId("party-open").click();
    const code = (await phone.getByTestId("party-join-code").innerText()).replace(/\s/g, "");
    const link = new URL(`/?party=${code}`, phone.url()).href;

    await defineShare(true);
    await phone.getByTestId("party-share").click();
    await expect.poll(() => phone.evaluate(() => (window as unknown as { shared?: ShareData }).shared?.url)).toBe(link);

    await defineShare(false);
    await phone.getByTestId("party-share").click();
    await expect(phone.getByTestId("party-share")).toHaveText("Link copied");
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

  /** A phone that is paired, whose page is then shown the given answer from /api/library. */
  async function phoneWithLibrary(browser: Parameters<typeof openTv>[0], answer: Parameters<Page["route"]>[1]) {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.context().route("**/api/library", answer);
    await phone.reload();
    return { tv, phone };
  }

  test("the home screen shows rows of titles, and a tap plays one on the TV", async ({ browser }) => {
    const { tv, phone } = await phoneWithLibrary(browser, (route) => route.fulfill({ json: library }));
    await expect(phone.getByTestId("library-row")).toHaveCount(2);
    await expect(phone.getByTestId("library-row").first()).toContainText("Test films");
    await expect(phone.getByTestId("library-tile")).toHaveCount(3);
    await expect(phone.getByTestId("library")).toContainText("From Test Source");
    await expect(phone.getByTestId("library-tile").first()).toContainText("1999");

    await phone.getByTestId("library-tile").first().click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await expect(phone.getByTestId("player-state")).toBeVisible(); // the remote took over
  });

  test("a title that is a page plays through the resolver like a pasted link", async ({ browser }) => {
    const { tv, phone } = await phoneWithLibrary(browser, (route) => route.fulfill({ json: library }));
    await phone.getByTestId("library-tile").nth(1).click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", /playing|paused|loading/);
    await expect(phone.getByTestId("media-title")).toBeVisible();
  });

  test("the library is also there when changing the video", async ({ browser, baseURL }) => {
    const { tv, phone } = await phoneWithLibrary(browser, (route) => route.fulfill({ json: library }));
    await phone.getByTestId("url-input").fill(sample(baseURL!));
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await phone.getByTestId("change-video").click();
    await expect(phone.getByTestId("link-sheet").getByTestId("library-tile")).toHaveCount(3);
  });

  test("no titles, or a library that cannot be reached, leaves the home screen as it was", async ({ browser }) => {
    const empty = await phoneWithLibrary(browser, (route) => route.fulfill({ json: { rows: [], updatedAt: 0 } }));
    await expect(empty.phone.getByTestId("url-input")).toBeVisible();
    await expect(empty.phone.getByTestId("library")).toHaveCount(0);
    await expect(empty.phone.getByTestId("library-loading")).toHaveCount(0);

    for (const answer of [(route: import("@playwright/test").Route) => route.abort(), (route: import("@playwright/test").Route) => route.fulfill({ status: 500, body: "nope" }), (route: import("@playwright/test").Route) => route.fulfill({ json: { rows: "wrong" } })]) {
      const { phone } = await phoneWithLibrary(browser, answer);
      await expect(phone.getByTestId("url-input")).toBeVisible();
      await expect(phone.getByTestId("library")).toHaveCount(0);
      await expect(phone.getByTestId("library-loading")).toHaveCount(0);
    }
  });
});
