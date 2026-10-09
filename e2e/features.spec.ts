import { chromium, expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import qrcode from "qrcode-generator";
import type { NormalizedMedia } from "../src/shared";
import { loadOnTv, openPairedPhone, openTv, RawPhone, readPairingCode, tvRoot, tvTime } from "./helpers";

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

test.describe("pairing", () => {
  test("the TV shows a QR code, and opening its link connects the phone without typing", async ({ browser }) => {
    const tv = await openTv(browser);
    await expect(tv.getByTestId("pairing-qr")).toBeVisible();
    const phone = await (await browser.newContext()).newPage();
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
      const context = await withCamera.newContext({ baseURL, permissions: ["camera"], viewport: { width: 390, height: 844 } });
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
    const phone = await (await browser.newContext()).newPage();
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
    await expect(button).not.toBeFocused(); // a stray OK press must not disconnect anything

    await tv.keyboard.press("ArrowDown");
    await expect(button).toBeFocused();
    await tv.keyboard.press("ArrowUp");
    await expect(button).not.toBeFocused();
    await tv.keyboard.press("Enter"); // OK also lands on it, without pressing it
    await expect(button).toBeFocused();
    await expect(tv.getByTestId("tv-paired")).toBeVisible();
    await tv.keyboard.press("Enter");

    await expect(tv.getByTestId("pairing-code")).toBeVisible();
    await expect(phone.getByTestId("code-input")).toBeVisible();
    await phone.getByTestId("code-input").fill(await readPairingCode(tv));
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await expect(tv.getByTestId("tv-paired")).toBeVisible();
  });

  test("opening another TV's QR link moves the phone over and frees the first TV", async ({ browser }) => {
    const tv1 = await openTv(browser);
    const phone = await openPairedPhone(browser, tv1);
    const tv2 = await openTv(browser);

    await phone.goto(`/?code=${await readPairingCode(tv2)}`);
    await expect(tv2.getByTestId("tv-paired")).toBeVisible();
    await expect(tv1.getByTestId("pairing-code")).toBeVisible();
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
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
    await expect(phone.getByTestId("recent-item")).toHaveCount(1);
    await phone.getByTestId("recent-play").click();
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

  test("subtitle language and size are remembered for the next video", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    const track = (index: number) => tv.evaluate((i) => document.querySelector("video")!.textTracks[i]?.mode, index);

    phone.cmd({ type: "LOAD", media: seriesMedia(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect.poll(() => track(1)).toBe("disabled"); // nothing chosen yet, nothing forced on

    phone.cmd({ type: "SET_SUBTITLE", track: 1 }); // Dutch
    await expect.poll(() => track(1)).toBe("showing");

    // A different video with the same choices: Dutch comes back by itself.
    phone.cmd({ type: "LOAD", media: { ...seriesMedia(baseURL!), stream: { url: "/fixtures/sample.mp4?again=1", type: "mp4" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect.poll(() => track(1)).toBe("showing");
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

  test("the subtitle menu previews the size and the panel doesn't move when you change it", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: seriesMedia(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");

    await tv.getByTestId("tv-audio-sub-btn").click();
    const modal = tv.getByTestId("audio-subtitles-modal");
    await expect(modal).toHaveAttribute("data-kind", "tracks");
    await expect(tv.getByRole("option", { name: "Default", exact: true })).toBeVisible();
    await expect(tv.getByTestId("subtitle-preview")).toBeVisible();

    const box = async () => (await modal.boundingBox())!;
    const before = await box();
    const sizeOf = () => tv.getByTestId("subtitle-preview").locator("span").evaluate((el) => getComputedStyle(el).fontSize);
    const mediumPx = parseFloat(await sizeOf());
    for (const label of ["Large", "Small", "Medium"]) {
      await tv.getByRole("option", { name: label, exact: true }).click();
      const now = await box();
      expect([now.x, now.y, now.width, now.height]).toEqual([before.x, before.y, before.width, before.height]);
    }
    await tv.getByRole("option", { name: "Large", exact: true }).click();
    await expect.poll(async () => parseFloat(await sizeOf())).toBeGreaterThan(mediumPx); // it eases to the new size
    // (Playwright's text matching skips <style>, so read the rule itself.)
    await expect.poll(() => tv.evaluate(() => [...document.querySelectorAll("style")].map((style) => style.textContent).join(" "))).toContain(
      "::cue { font-size: 6vh; }",
    );
    expect(await tv.evaluate(() => localStorage.getItem("tv.prefs"))).toContain('"subtitleSize":"large"');
    phone.close();
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
});
