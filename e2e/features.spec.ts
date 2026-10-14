import { chromium, expect, type Browser, type Locator, type Page, type WebSocketRoute } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import qrcode from "qrcode-generator";
import { MAX_LINK_LENGTH, progressKey, type NormalizedMedia } from "../src/shared";
import { en } from "../src/client/i18n/en";
import { it as italian } from "../src/client/i18n/it";
import { ro } from "../src/client/i18n/ro";
import { FIRST_VISIT, guestStorage, loadOnTv, openDevice, openLibrary, openPairedPhone, openTv, PHONE, playFirst, RawPhone, readPairingCode, serverDown, serverUp, sleepingServer, test, tvRoot, tvTime, twoSizes, withLibrary } from "./helpers";

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
    await expect(phone.getByTestId("pair-notice")).toHaveCount(0); // it chose to leave: nothing was lost
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
    await expect(phone.getByTestId("pair-notice")).toHaveText("This phone is no longer connected to the TV. Enter the code on the TV to connect again.");
    await expect(phone.getByTestId("code-input")).toHaveValue(""); // the code that was typed is no use any more
    await phone.getByTestId("code-input").fill(await readPairingCode(tv));
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await expect(tv.getByTestId("tv-paired")).toBeVisible();
  });
});

test.describe("a server that is slow to answer", () => {
  // A free host that has slept takes most of a minute to wake: after ten seconds without it the page says why, in the place it already says it is waiting.
  test("the phone's first screen says the server is waking up after ten seconds, and the line goes when the server answers", async ({ browser }) => {
    const phone = await openDevice(browser, PHONE, {}, sleepingServer());
    await phone.goto("/");
    await expect(phone.getByTestId("code-input")).toBeVisible();
    await expect(phone.getByText(en["pair.reaching"])).toBeVisible();
    await expect(phone.getByTestId("server-waking")).toHaveCount(0); // a moment is not a sleeping server

    await phone.clock.fastForward(10_500);
    await expect(phone.getByTestId("server-waking")).toHaveText(en["server.waking"]);

    await serverUp(phone);
    await phone.clock.fastForward(10_500); // the connection that was never answered gives up, and the next one is
    await expect(phone.getByTestId("server-waking")).toHaveCount(0);
    await phone.getByTestId("code-input").fill("000000");
    await expect(phone.getByTestId("error")).toBeVisible(); // it is talking to the server again: the code is refused
  });

  test("a phone that knows it has no network at all does not blame the server", async ({ browser }) => {
    const phone = await openDevice(browser, PHONE, {}, sleepingServer());
    await phone.goto("/");
    await expect(phone.getByTestId("code-input")).toBeVisible();
    await phone.context().setOffline(true);
    await phone.clock.fastForward(10_500);
    await expect(phone.getByText(en["error.offline"])).toBeVisible(); // its own line for that
    await expect(phone.getByTestId("server-waking")).toHaveCount(0);
  });

  test("a paired remote that loses the server says Reconnecting first, then that it is waking up, and is back when it answers", async ({ browser }) => {
    const tv = await openTv(browser);
    const phone = await openDevice(browser, PHONE, {}, sleepingServer(true));
    await phone.goto("/");
    await phone.getByTestId("code-input").fill(await readPairingCode(tv));
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");

    await serverDown(phone);
    await expect(phone.getByTestId("tv-online")).toHaveText(en["phone.reconnecting"]);
    await expect(phone.getByTestId("server-waking")).toHaveCount(0);
    await phone.clock.fastForward(10_500);
    await expect(phone.getByTestId("server-waking")).toHaveText(en["server.waking"]);
    await expect(phone.getByTestId("tv-online")).toHaveText(en["phone.reconnecting"]); // and the header still says what is going on

    await serverUp(phone);
    await phone.clock.fastForward(10_500);
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await expect(phone.getByTestId("server-waking")).toHaveCount(0);
  });

  test("the TV's banner says the same, in place of Connecting, and goes when the server answers", async ({ browser }) => {
    const tv = await openLibrary(browser, sleepingServer());
    await expect(tv.getByTestId("tv-banner")).toHaveText(en["tv.connecting"]);

    await tv.clock.fastForward(10_500);
    await expect(tv.getByTestId("tv-banner")).toHaveText(en["server.waking"]);

    await serverUp(tv);
    await tv.clock.fastForward(10_500);
    await expect(tv.getByTestId("tv-banner")).toHaveCount(0);
  });
});

test.describe("playing links", () => {
  test("a link that is too long for the server to read is said to be too long, not blamed on the server's version", async ({ browser }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.getByTestId("url-input").fill(`http://example.com/${"a".repeat(MAX_LINK_LENGTH)}`); // (a signed link of a file host can be that long)
    await phone.getByTestId("play-url").click();
    await expect(phone.getByTestId("error")).toHaveText(en["phone.linkTooLong"]);
    await expect(phone.getByTestId("resolve-status")).toHaveCount(0); // nothing was asked of the server
    await phone.getByTestId("url-input").fill("http://example.com/short"); // and a link that fits goes on as before
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

  test("Down brings back controls that have faded and lands on Play; the arrows keep to the bar and never wrap, and the bar waits for whoever is choosing", async ({ browser, baseURL }) => {
    test.setTimeout(45_000);
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: { title: "Sample", stream: { url: "/fixtures/sample.mp4", type: "mp4" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    phone.cmd({ type: "PLAY" });
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "hidden", { timeout: 8_000 });

    await tv.keyboard.press("ArrowDown"); // the buttons were not there to be focused: Down brings them back, and lands on the first
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "visible");
    await expect(tv.getByTestId("tv-play-btn")).toBeFocused();

    // One row of buttons: nothing before the first, nothing under the row, nothing after the last.
    await tv.keyboard.press("ArrowLeft");
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("tv-play-btn")).toBeFocused();
    for (let i = 0; i < 12; i++) await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-stop-btn")).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-stop-btn")).toBeFocused();

    // The remote resting on a button gets longer than the viewer who is only watching (that is 2.5 seconds); then the bar goes, and the focus with it.
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

    await tv.keyboard.press("ArrowDown"); // the remote lands on Play, and the name of a button with only a picture is said above it
    await expect(play).toBeFocused();
    const label = (await play.getAttribute("aria-label"))!;
    expect(label.length).toBeGreaterThan(0);
    expect(await nameAbove()).toBe(`"${label}"`);
    await tv.keyboard.press("ArrowRight"); // (the arrows walk the buttons while one has the focus)
    await expect(play).not.toBeFocused();
    await expect(focusedControls).toHaveCount(1);
    await tv.keyboard.press("ArrowLeft");
    await expect(play).toBeFocused();

    // A hand presses it: the video plays, and the focus is not left behind, nor the name. (Asked at once, not waited for: the bar fades after
    // a few seconds and lets go of the focus by itself, which would hide a button that kept it.)
    await play.click();
    expect(await play.evaluate((button) => button === document.activeElement)).toBe(false);
    expect(await nameAbove()).not.toContain(label);
    // So the arrows skip, and walk no buttons, until the remote asks for them again.
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
    await expect(subtitles).toBeFocused(); // the focus was not lost with the menu

    await tv.keyboard.press("Enter");
    await tv.getByRole("option", { name: "Subtitle style…" }).click();
    await expect(modal).toHaveAttribute("data-kind", "captions");
    await tv.keyboard.press("Escape");
    await expect(modal).toHaveAttribute("data-kind", "tracks"); // one page back, not out of the menu
    await expect(tv.getByRole("option", { name: "Subtitle style…" })).toBeFocused(); // on the entry it came from
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

    await tv.getByTestId("tv-center-btn").click(); // the big button in the middle
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

    // (The mouse coming to the picture brings the controls up; the click that follows puts them away. Neither stops the film.)
    await tv.mouse.click(640, 360);
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "hidden");
    await tv.waitForTimeout(800);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");

    await tv.waitForTimeout(700); // (the mouse settling after the click does not bring them back; a move later does)
    await tv.mouse.move(500, 300);
    await tv.mouse.move(520, 320);
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "visible");
    await expect(tv.getByTestId("tv-center-btn")).toHaveCount(0); // (a mouse has the bar; the big button is for a finger, and for a picture that is held)
    await tv.getByTestId("tv-play-btn").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "visible");

    await tv.mouse.click(1000, 250); // the picture beside the big button is not a play button either: held, the controls go too, and the picture is left clean
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

    await tv.mouse.click(1000, 250); // a click on the picture pauses, and brings the controls back
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
    expect(button.width).toBeGreaterThanOrEqual(1280 * 0.14); // (it was 7% of the width)
    expect(button.width).toBeLessThanOrEqual(1280 * 0.2); // (and a third of it would cover the picture)
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

  test("on a screen held upright the subtitles are sized and placed for the picture, which is a strip across the middle of it", async ({ browser, baseURL }) => {
    const tv = await openTv(browser, { width: 390, height: 844 });
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: seriesMedia(baseURL!) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    phone.cmd({ type: "SET_SUBTITLE", track: 0 });
    const caption = tv.getByTestId("caption");
    await expect(caption).toHaveText("Hello, this is a subtitle test!");

    // The picture is 390 × 219 here. 4.6% of the screen's height would be a caption of 39 px on a 390-px screen; 4.6% of the picture
    // would be 10 px: the text is the least that can be read, and it sits on the picture, not on the black below it.
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

test.describe("the subtitle delay", () => {
  test("is offered for subtitles that are on, and not while there are none", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await loadOnTv(phone, seriesMedia(baseURL!));
    await expect(phone.getByTestId("media-title")).toBeVisible();

    await phone.getByTestId("chip-tracks").click();
    await expect(phone.getByTestId("subtitle-0")).toBeVisible();
    await expect(phone.getByTestId("subtitle-delay")).toHaveCount(0);
    await phone.getByTestId("subtitle-0").click(); // English
    await expect(phone.getByTestId("subtitle-delay")).toBeVisible();
    await phone.getByTestId("subtitle--1").click(); // off
    await expect(phone.getByTestId("subtitle-delay")).toHaveCount(0);
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

  test("the source that takes over starts where the video was told to start, and stays held when it was put back held", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    // (What the server sends a TV whose page was opened again: the video and the place, and no PLAY behind it.)
    phone.cmd({ type: "LOAD", media: withSources([{ url: "/fixtures/does-not-exist.mp4" }, { label: "Mirror", url: "/fixtures/sample.mp4" }]), startAt: 9 });
    await expect(tv.getByTestId("tv-source-btn")).toHaveText("Mirror", { timeout: 15_000 });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect.poll(() => tvTime(tv), { timeout: 10_000 }).toBeGreaterThan(8);
    await tv.waitForTimeout(1000);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused"); // not set going by the hand-over
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
    await tv.evaluate(() => void document.querySelector("video")!.dispatchEvent(new Event("error"))); // (a video that gave out part of the way)
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
    // (hls.js asks the film's pieces from the server: with the page offline they get no answer at all, which is what a server that is away looks like.)
    phone.cmd({ type: "LOAD", media: { title: "Streamed", stream: { url: "/fixtures/hls/master.m3u8", type: "hls" } } });
    phone.cmd({ type: "PLAY" });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    await tv.evaluate(() => void (document.querySelector("video")!.currentTime = 0.5));
    // A video that gave out for want of a connection: the error that the player raises for it (an answer with a 404 is another thing, covered above).
    await tv.evaluate(() => {
      Object.defineProperty(document.querySelector("video")!, "error", { configurable: true, get: () => ({ code: 2 }) });
      document.querySelector("video")!.dispatchEvent(new Event("error"));
    });
    await expect(tv.getByTestId("tv-error")).toBeVisible();
    await expect(tv.getByTestId("tv-error")).toContainText("The connection to the video was lost.");
    // Still connected to the server, so a moment later the picture is tried again without anybody pressing anything.
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
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "error"); // still, not trying again and again
    await expect(tv.getByTestId("tv-error")).toBeVisible(); // a card with the way on, in place of controls that are of no use
    await expect(tv.getByTestId("tv-play-btn")).toHaveCount(0);
    await expect(tv.getByTestId("error-retry")).toBeFocused(); // so OK is all it takes to try again
    phone.close();
  });

  test("on the card of a video that would not play, OK tries again and Back leaves for the library", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    let broken = true;
    await tv.route("**/fixtures/flaky.mp4", (route) => (broken ? route.fulfill({ status: 404, body: "gone" }) : route.continue({ url: `${baseURL}/fixtures/sample.mp4` })));
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: withSources([{ url: "/fixtures/flaky.mp4" }]) });
    await expect(tv.getByTestId("tv-error")).toBeVisible({ timeout: 15_000 });

    broken = false; // a bad moment, over
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-error")).toHaveCount(0);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", /playing|paused/, { timeout: 15_000 });

    phone.cmd({ type: "LOAD", media: withSources([{ url: "/fixtures/nope.mp4" }]) });
    await expect(tv.getByTestId("tv-error")).toBeVisible({ timeout: 15_000 });
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle");
    await expect.poll(() => phone.states.at(-1)?.state).toBe("idle"); // the phone is not left looking at a video that is not there
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

    // asked for from the phone: the sheet it was asked in lights the choice, so the phone says nothing on top of it
    await phone.getByTestId("chip-speed").click();
    await phone.getByTestId("speed-1.5").click();
    await expect(tv.getByTestId("tv-toast")).toHaveText("Speed 1.5×");
    await expect(phone.getByTestId("speed-1.5")).toHaveAttribute("aria-selected", "true");
    await expect(phone.getByTestId("toast")).toHaveCount(0);
    await phone.getByTestId("sheet-close").click();

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

  const filmsOf = (baseURL: string) => ({ updatedAt: Date.now(), rows: [{ id: "r", title: "Films", source: "Test", items: [{ id: "a", title: "The Sample", url: sample(baseURL) }] }] });
  /** The library on a device that has never opened the page (the config's pages start as if full screen had been left). */
  async function firstVisit(browser: Browser, baseURL: string) {
    const tv = await openDevice(browser, { viewport: { width: 1280, height: 720 }, storageState: FIRST_VISIT }, {}, withLibrary(filmsOf(baseURL)));
    await tv.goto("/tv");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    return tv;
  }

  test("a screen's welcome waits with a button for the press that takes it full screen, and it is left alone after that", async ({ browser, baseURL }) => {
    const tv = await firstVisit(browser, baseURL!);
    const welcome = tv.getByTestId("tv-welcome");
    await expect(welcome).toBeVisible();
    await expect(tv.getByTestId("welcome-enter")).toHaveText(en["tv.welcomeStart"]);
    await tv.waitForTimeout(2400); // longer than a welcome stays when it asks nothing: this one waits (something that does not happen)
    await expect(welcome).toBeVisible();
    expect(await isFullScreen(tv)).toBe(false); // nothing is done before the viewer presses

    await tv.keyboard.press("Enter"); // OK is the button's: the title that has the library's focus under the welcome is not pressed
    await expect.poll(() => isFullScreen(tv)).toBe(true);
    await expect(welcome).toHaveCount(0, { timeout: 4_000 });
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();

    await playFirst(tv);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing"); // (F is the player's key: nothing hears it while a video is still being found)

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

  test("a click anywhere on the waiting welcome goes full screen too, and does not press what is under it", async ({ browser, baseURL }) => {
    const tv = await firstVisit(browser, baseURL!);
    await expect(tv.getByTestId("welcome-enter")).toBeVisible();
    const tile = (await tv.getByTestId("tv-browse-tile").first().boundingBox())!;
    await tv.mouse.click(tile.x + tile.width / 2, tile.y + tile.height / 2); // right over the first title, which the welcome hides
    await expect.poll(() => isFullScreen(tv)).toBe(true);
    await expect(tv.getByTestId("tv-welcome")).toHaveCount(0, { timeout: 4_000 });
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
  });

  test("Back lets the waiting welcome go, and the library is as it was", async ({ browser, baseURL }) => {
    const tv = await firstVisit(browser, baseURL!);
    await expect(tv.getByTestId("welcome-enter")).toBeVisible();
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-welcome")).toHaveCount(0, { timeout: 4_000 });
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
  });

  test("on a phone the welcome's button fits the screen, and a tap on it goes full screen", async ({ browser, baseURL }) => {
    const phone = await openDevice(browser, { viewport: { width: 390, height: 844 }, hasTouch: true, storageState: FIRST_VISIT }, {}, withLibrary(filmsOf(baseURL!)));
    await phone.goto("/tv");
    const button = phone.getByTestId("welcome-enter");
    await expect(button).toBeInViewport({ ratio: 1 });
    await button.tap();
    await expect.poll(() => isFullScreen(phone)).toBe(true);
    await expect(phone.getByTestId("tv-welcome")).toHaveCount(0, { timeout: 4_000 });
  });

  test("a video that a phone starts while the welcome waits takes the screen from it", async ({ browser, baseURL }) => {
    const tv = await openTv(browser); // (starts as if full screen had been left: no button yet)
    const phone = await openPairedPhone(browser, tv);
    await tv.evaluate(() => localStorage.removeItem("kino.fullscreen.left"));
    await tv.reload(); // still paired, and now a first visit as far as full screen goes
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
    await tv.reload(); // the next visit: left as it was (there is nothing to wait for, it is something that does not happen)
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await tv.keyboard.press("ArrowRight");
    await tv.waitForTimeout(600);
    expect(await isFullScreen(tv)).toBe(false);

    await tv.getByTestId("fullscreen-toggle").click(); // in again by choice
    await expect.poll(() => isFullScreen(tv)).toBe(true);
    await tv.reload(); // (leaving full screen because the page went away is no choice of the viewer's)
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await tv.keyboard.press("ArrowRight");
    await expect.poll(() => isFullScreen(tv)).toBe(true);
  });

  test("the library's corner has a full screen button beside the account button, and the arrow keys reach it", async ({ browser, baseURL }) => {
    const tv = await openLibrary(browser, withLibrary(filmsOf(baseURL!)));
    const chip = tv.getByTestId("tv-account-chip");
    const button = tv.getByTestId("fullscreen-toggle");
    const [chipBox, buttonBox] = [(await chip.boundingBox())!, (await button.boundingBox())!];
    expect(buttonBox.x).toBeGreaterThanOrEqual(chipBox.x + chipBox.width); // to its right, as tall and level with it
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
    const first = await openDevice(browser, { ...PHONE, storageState: FIRST_VISIT });
    await first.goto("/");
    await first.getByTestId("code-input").tap(); // where a code gets typed: no surprises
    await first.waitForTimeout(600);
    expect(await isFullScreen(first)).toBe(false);
    const [toggleBox, accountBox] = [(await first.getByTestId("fullscreen-toggle").boundingBox())!, (await first.getByTestId("account-button").boundingBox())!];
    expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(accountBox.x); // beside the account button
    await first.getByTestId("fullscreen-toggle").tap();
    await expect.poll(() => isFullScreen(first)).toBe(true);
    await expect(first.getByTestId("fullscreen-toggle")).toHaveAttribute("aria-label", "Exit full screen");

    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.getByTestId("menu").click();
    const row = phone.getByTestId("menu-sheet").getByTestId("fullscreen-toggle");
    await expect(row).toHaveText(en["phone.fullscreen"]); // (the sheet is the TV's: the words say it is about this phone)
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
    await expect.poll(() => pings.length).toBeGreaterThan(0); // (the first is sent as soon as the page has said hello, not 15 s later)
    // (The page checks the link again when it comes back to the front: that PING carries what the first one took.)
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
    // (A server that says every report took 1.5 s to arrive: the guest should be that far ahead of the host's last position, which is the host's now.)
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
    // (The server answers a join with TV_FOLLOWING and, a millisecond later, the host's LOAD. Over a slow link, or behind a proxy that passes frames on together,
    // both reach the page before it has drawn once: here the test plays the server for those two.)
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
    await expect(tvRoot(tv)).toHaveAttribute("data-state", /paused|playing/, { timeout: 15_000 }); // (not "idle": a picture that was stopped and never loaded again)
    expect(await tv.evaluate(() => document.querySelector("video")!.currentSrc)).toContain("/fixtures/sample.mp4");
    phone.close();
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

    // Up is as good a way onto the bar as Down, and it lands on the bar's first button; the card says when the host has stopped the picture.
    await follower.keyboard.press("ArrowUp");
    await expect(follower.locator(".hud-controls button").first()).toBeFocused();
    await phone.getByTestId("pause").click();
    await expect(follower.getByTestId("tv-held")).toHaveText(/^Paused by TV /); // (the screen the phone controls is the host of the party)

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
    await follower.keyboard.press("ArrowDown"); // wakes the bar and lands on its first button, even with the bar faded away
    await expect(follower.locator(".hud-controls button").first()).toBeFocused();
    for (let i = 0; i < 4 && !(await follower.getByTestId("tv-leave").evaluate((el) => el === document.activeElement)); i++) {
      await follower.keyboard.press("ArrowRight");
    }
    await expect(follower.getByTestId("tv-leave")).toBeFocused();
    await follower.keyboard.press("Enter");
    await expect(follower.getByTestId("pairing-code")).toBeVisible();
    await expect(tvRoot(leader)).toHaveAttribute("data-state", "playing"); // the leader carries on
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
    await expect(tvRoot(leader)).toHaveAttribute("data-state", "paused"); // the phone's TV did it
    await expect(phone.getByTestId("play")).toBeVisible(); // and the phone knows

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
    await expect(follower.getByTestId("pairing-code")).toBeVisible(); // back to its own code
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
    await expect(host.getByTestId("tv-party-done")).toBeFocused(); // never on the button that ends the party: OK on a panel that has just changed must not do that
    const code = await codeOf(host);

    const guest = await screen(browser, baseURL!);
    await joinWith(guest, code);
    await expect(tvRoot(guest)).toHaveAttribute("data-state", /playing|paused/, { timeout: 15_000 });
    await expect.poll(async () => Math.abs((await video(guest)).time - (await video(host)).time), { timeout: 10_000 }).toBeLessThan(2.5);
    await expect(host.getByTestId("tv-party-member")).toHaveCount(2);

    await host.keyboard.press("Escape"); // closes the panel
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

    // The page: the whole link under the code, and OK on its button puts it on the clipboard and says so, then it says Copy link again.
    await expect(host.getByTestId("tv-party-link-url")).toHaveText(link);
    await expect(host.getByTestId("tv-back-to-library")).toBeFocused();
    await host.keyboard.press("ArrowUp");
    await expect(copy).toBeFocused();
    await host.keyboard.press("Enter");
    await expect(copy).toHaveText("Link copied");
    expect(await clipboard()).toBe(link);
    await expect(copy).toBeFocused(); // the remote kept its place
    await expect(copy).toHaveText("Copy link"); // and the button is ready for the next time by itself

    // Over a film: the left column of the panel, which the arrow keys cross over to from Done and back.
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
    await expect(host.getByTestId("tv-party-link")).toHaveCount(0); // nothing is shown before there is a party (the question comes first)

    await host.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }); // no clipboard of its own...
      document.execCommand = () => false; // ...and the old way refused
    });
    await host.reload();
    await host.getByTestId("rail-party").click();
    await host.getByTestId("tv-party-start").click();
    await host.getByTestId("tv-party-link-copy").click();
    await expect(host.getByTestId("tv-party-link").getByRole("status")).toHaveText("Could not copy: select the link and copy it");
    expect(await host.evaluate(() => window.getSelection()?.toString())).toBe(await host.getByTestId("tv-party-link-url").innerText()); // it is selected, for the keys
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
    await expect(quality).toHaveText(/^Auto/); // (its own picture chooses until it is told otherwise)
    await quality.click();
    await guest.getByRole("option", { name: "720p" }).click();
    await expect(quality).toHaveText("720p");
    await expect.poll(() => phone.states.at(-1)?.quality?.current).toBe(-1); // what the host shows is still on Auto

    await guest.getByRole("option", { name: "Auto" }).click(); // (the list stays up for another pick)
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

    phone.cmd({ type: "LOAD", media: { ...seriesMedia(baseURL!), page: `${baseURL}/fixtures/pages/none.html` } }); // (a video that says where it came from is one that can be continued)
    await expect(tvRoot(guest)).toHaveAttribute("data-state", "paused", { timeout: 15_000 });
    const cards = (tv: Page) => tv.evaluate(() => (JSON.parse(localStorage.getItem("kino.data.guest") ?? "null") as { data: { progress: unknown[] } } | null)?.data.progress.length ?? 0);
    await expect.poll(() => cards(host), { timeout: 10_000 }).toBe(1); // (the host's own row has it)
    await guest.waitForTimeout(1500); // (a screen writes a moment after a change)
    expect(await cards(guest)).toBe(0);
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
    // A guest comes for the party: the library's welcome is not for it, not even for the moment before the party takes the screen in.
    await guest.addInitScript(() => {
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="tv-welcome"]')) (window as unknown as { welcomed: boolean }).welcomed = true;
      }).observe(document, { childList: true, subtree: true });
    });
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

  test("the host makes a guest an admin: its buttons and keys steer the film for everyone, and taking that back puts them away", async ({ browser, baseURL }) => {
    const { host, guest } = await party(browser, baseURL!);
    await expect(guest.getByTestId("tv-party-admin")).toHaveCount(0); // a guest has no say in who is one
    await host.getByTestId("tv-party-admin").click();
    await expect(host.getByTestId("tv-party-member").nth(1)).toContainText("Admin");
    await expect(host.getByTestId("tv-party-admin")).toHaveText("Remove admin");
    await expect(guest.getByTestId("tv-party-member").nth(1)).toContainText("Admin"); // everyone sees who is one

    await host.getByTestId("tv-back-to-library").click();
    await playFirst(host);
    await expect(tvRoot(guest)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    await expect(guest.getByTestId("tv-play-btn")).toHaveCount(0); // (still a screen that watches along)

    // Its buttons ask the host's screen, which does it, and the guest follows it.
    await guest.mouse.move(60, 60); // brings the bars up
    await guest.getByTestId("tv-admin-play").click();
    await expect(tvRoot(host)).toHaveAttribute("data-state", "paused");
    await expect.poll(async () => (await video(guest)).paused).toBe(true);
    const paused = await tvTime(host);
    await guest.getByTestId("tv-admin-forward").click();
    await expect.poll(() => tvTime(host)).toBeGreaterThan(paused + 8);
    await expect.poll(async () => Math.abs((await video(guest)).time - (await tvTime(host))), { timeout: 10_000 }).toBeLessThan(1.5);

    // Its keys do the same, with nothing on the bar focused (a click leaves the focus alone).
    await guest.keyboard.press("Space");
    await expect(tvRoot(host)).toHaveAttribute("data-state", "playing");
    await expect.poll(async () => (await video(guest)).paused).toBe(false);
    const playing = await tvTime(host);
    await guest.keyboard.press("ArrowLeft");
    await expect.poll(() => tvTime(host), { timeout: 10_000 }).toBeLessThan(playing - 6);

    // Down lands on Play.
    await guest.keyboard.press("ArrowDown");
    await expect(guest.getByTestId("tv-admin-play")).toBeFocused();

    // Taken back from the panel over the film, the bar is gone and the keys are the host's alone again.
    await host.mouse.move(60, 60);
    await host.getByTestId("tv-party-btn").click();
    await host.getByTestId("tv-party-admin").click();
    await expect(host.getByTestId("tv-party-admin")).toHaveText("Make admin");
    await expect(guest.getByTestId("tv-admin-bar")).toHaveCount(0);
    await expect(guest.getByTestId("tv-follow-bar")).toBeVisible();
    await guest.keyboard.press("Space");
    await guest.waitForTimeout(1500);
    await expect(tvRoot(host)).toHaveAttribute("data-state", "playing");

    // Given again, Stop is for everyone: the guest that asked is stopped too.
    await host.getByTestId("tv-party-admin").click();
    await guest.mouse.move(60, 60);
    await guest.getByTestId("tv-admin-stop").click();
    await expect(tvRoot(host)).toHaveAttribute("data-state", "idle");
    await expect(tvRoot(guest)).toHaveAttribute("data-state", "idle");
    await expect(guest.getByTestId("tv-following")).toBeVisible(); // still in the party, waiting
  });

  test("a guest has the bars any screen has, but only to be read: what is on, whom it follows, how far it is; and its own things stay its own", async ({ browser, baseURL }) => {
    const { host, guest } = await party(browser, baseURL!);
    const hostName = await host.getByTestId("tv-party-member").first().locator(".tv-party-name").innerText();
    await host.getByTestId("tv-back-to-library").click();
    await playFirst(host);
    await expect(tvRoot(guest)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });

    await guest.mouse.move(60, 60); // brings the bars up
    await expect(guest.getByTestId("tv-title")).toHaveText("sample"); // (a link to a file is called what the file is)
    await expect(guest.getByTestId("tv-follow-line")).toContainText(hostName);
    await expect(guest.getByTestId("tv-elapsed")).toHaveText(/^\d+:\d\d$/);
    await expect(guest.locator(".hud-bar")).toHaveAttribute("role", "progressbar");
    await expect.poll(async () => Number(await guest.locator(".hud-bar").getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    await expect(guest.getByTestId("tv-play-btn")).toHaveCount(0); // the host has the controls
    await expect(guest.getByTestId("tv-admin-bar")).toHaveCount(0);

    // A click on the bar moves nothing: the host's film is the host's.
    const at = await tvTime(host);
    const bar = (await guest.locator(".hud-bar").boundingBox())!;
    await guest.mouse.click(bar.x + bar.width * 0.9, bar.y + bar.height / 2);
    await guest.waitForTimeout(600);
    expect(Math.abs((await tvTime(host)) - at)).toBeLessThan(3);

    // What is its own is: the sound, the party, the way out (and the subtitles, where the film has some).
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
    await host.getByTestId("tv-party-admin").first().click(); // the first guest to have joined
    await expect(admin.getByTestId("tv-party-member").nth(1)).toContainText("Admin");
    await host.getByTestId("tv-back-to-library").click();
    await playFirst(host);
    for (const tv of [admin, other]) await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });

    // The host's own pause and play.
    await host.keyboard.press("Space");
    for (const tv of [admin, other]) await expect(tv.getByTestId("tv-held")).toHaveText(`Paused by ${hostName}`);
    await host.keyboard.press("Space");
    for (const tv of [admin, other]) await expect(tv.getByTestId("tv-held")).toHaveCount(0);
    await expect(other.getByTestId("tv-toast")).toHaveText(`${hostName} resumed`);

    // The admin's: "you" to itself, its name to the others, and the host is told too, though it was its own screen that did it.
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

  // The buttons that came with the admin (on a member of the list, and a group of their own on the bar of a guest's film) go where there is room for them.
  for (const size of [
    { name: "a TV (1280×720) in Italian", width: 1280, height: 720, language: "it" },
    { name: "a phone in Romanian", width: 390, height: 844, language: "ro" },
    { name: "a small phone in Romanian", width: 320, height: 568, language: "ro" },
  ]) {
    test(`with an admin in the party, the list and the bars fit ${size.name}`, async ({ browser, baseURL }) => {
      const viewport = { width: size.width, height: size.height };
      const seed = { "kino.lang": size.language };
      const words = size.language === "ro" ? ro : italian;
      /** Of the party's list: what sticks out of the screen or out of its own row, the buttons that lie over one another, and a name cut short. */
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
            for (const name of member.querySelectorAll<HTMLElement>(".tv-party-name")) if (name.scrollWidth > name.clientWidth + 1) wrong++; // (a short name is whole: the buttons go under it, not over it)
          }
          return wrong;
        });
      const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

      // The host's list, on the page and in the panel over a film: the admin's button is beside Remove, and the row takes two lines where it must.
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

      // The guest: the film and the bar every screen has, the admin's buttons first on it, all of its buttons on the screen.
      await expect(tvRoot(admin)).toHaveAttribute("data-state", /playing|paused/, { timeout: 15_000 });
      await admin.mouse.move(60, 60);
      await expect(admin.getByTestId("tv-admin-bar")).toBeInViewport();
      const bar = await admin.evaluate(() => {
        const inside = (box: DOMRect) => box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
        const elements = [...document.querySelectorAll<HTMLElement>(".hud-bottom, .hud-bottom button")];
        return { outside: elements.filter((element) => !inside(element.getBoundingClientRect())).length, buttons: elements.length - 1 };
      });
      expect(bar.outside).toBe(0);
      expect(bar.buttons).toBeGreaterThanOrEqual(6); // (the admin's play, back, forward, stop, and the party, the sound and the way out)
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
      await guest.keyboard.press("Escape"); // (a busy machine can show the page a moment before its Back key is listened for)
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
    await host.keyboard.press("ArrowRight");
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
    await expect(phone.getByTestId("party-join-code")).toBeVisible(); // the code is still good for the next screen
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

    // A phone has a share sheet: Share link is there beside the link and its button.
    await defineShare(true);
    let link = await openSheet();
    await expect(phone.getByTestId("party-link-url")).toHaveText(link);
    await phone.getByTestId("party-share").click();
    await expect.poll(() => phone.evaluate(() => (window as unknown as { shared?: ShareData }).shared?.url)).toBe(link);
    await copy.click();
    await expect(copy).toHaveText("Link copied");
    expect(await phone.evaluate(() => navigator.clipboard.readText())).toBe(link);
    await expect(copy).toHaveText("Copy link"); // ready for the next time by itself

    // Where there is none, the link and its button are the way.
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

  test("the home screen shows rows of titles, and a tap opens a title's page, where Play starts it on the TV", async ({ browser }) => {
    const { tv, phone } = await phoneWithLibrary(browser, (route) => route.fulfill({ json: library }));
    await expect(phone.getByTestId("library-row")).toHaveCount(2);
    await expect(phone.getByTestId("library-row").first()).toContainText("Test films");
    await expect(phone.getByTestId("library-tile")).toHaveCount(3);
    await expect(phone.getByTestId("library")).toContainText("From Test Source");
    await expect(phone.getByTestId("library-tile").first()).toContainText("1999");

    await phone.getByTestId("library-tile").first().click();
    const page = phone.getByTestId("title-sheet");
    await expect(page).toContainText("The Sample");
    await expect(page.getByTestId("title-meta")).toHaveText("1999");
    await expect(page.getByTestId("title-play")).toHaveText("Play");
    await expect(tvRoot(tv)).not.toHaveAttribute("data-state", "playing"); // a tap alone starts nothing

    await page.getByTestId("title-play").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await expect(phone.getByTestId("player-state")).toBeVisible(); // the remote took over
    await expect(phone.getByTestId("title-sheet")).toHaveCount(0);
  });

  test("a title that is a page plays through the resolver like a pasted link", async ({ browser }) => {
    const { tv, phone } = await phoneWithLibrary(browser, (route) => route.fulfill({ json: library }));
    await phone.getByTestId("library-tile").nth(1).click();
    await phone.getByTestId("title-play").click();
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

  test("Escape closes the sheet on top, and the one under it the next time", async ({ browser, baseURL }) => {
    const { tv, phone } = await phoneWithLibrary(browser, (route) => route.fulfill({ json: library }));
    // two lists, so that the round button on a title asks which
    await phone.getByTestId("library-list-toggle").first().click();
    await phone.getByTestId("lists-manage").click();
    await phone.getByTestId("list-new").click();
    await phone.getByTestId("list-name-input").fill("Weekend");
    await phone.getByTestId("list-save").click();
    await phone.getByTestId("sheet-close").click();

    // the library in the sheet of "Change video", and a list picker on top of it
    await phone.getByTestId("url-input").fill(sample(baseURL!));
    await phone.getByTestId("play-url").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await phone.getByTestId("change-video").click();
    await phone.getByTestId("link-sheet").getByTestId("library-list-toggle").first().click();
    await expect(phone.getByTestId("list-picker")).toBeVisible();
    await phone.keyboard.press("Escape");
    await expect(phone.getByTestId("list-picker")).toHaveCount(0);
    await expect(phone.getByTestId("link-sheet")).toBeVisible();
    await phone.keyboard.press("Escape");
    await expect(phone.getByTestId("link-sheet")).toHaveCount(0);
  });

  test("the round button on a title saves it in Favourites; once there is a second list it asks which, and a cross takes a title off one list", async ({ browser }) => {
    const { phone } = await phoneWithLibrary(browser, (route) => route.fulfill({ json: library }));
    await expect(phone.getByTestId("list-row")).toHaveCount(0); // nothing saved: no row, and no button for lists yet
    await expect(phone.getByTestId("lists-manage")).toHaveCount(0);

    const toggle = (n: number) => phone.getByTestId("library-list-toggle").nth(n);
    await expect(toggle(0)).toHaveAccessibleName("Add to Favourites: The Sample");
    await toggle(0).click();
    await expect(toggle(0)).toHaveAccessibleName("In Favourites — tap to remove: The Sample");
    await expect(phone.getByRole("region", { name: "Favourites" })).toContainText("The Sample");

    // A second list, made in the sheet that the row's button opens.
    await phone.getByTestId("lists-manage").click();
    await expect(phone.getByTestId("lists-sheet")).toContainText("1 title");
    await phone.getByTestId("list-new").click();
    await phone.getByTestId("list-name-input").fill("Weekend");
    await phone.getByTestId("list-save").click();
    await expect(phone.getByTestId("lists-sheet")).toContainText("Weekend");
    await phone.getByTestId("sheet-close").click();
    await expect(phone.getByTestId("lists-sheet")).toHaveCount(0);

    // With two lists the button asks: a tap on a list puts the title in it, and the title is "in your lists".
    await expect(toggle(1)).toHaveAccessibleName("Add to a list: The Other One");
    await toggle(1).click();
    const picker = phone.getByTestId("list-picker");
    await expect(picker).toContainText("The Other One");
    await expect(picker.getByRole("button", { name: "Weekend" })).toHaveAttribute("aria-pressed", "false");
    await picker.getByRole("button", { name: "Weekend" }).click();
    await expect(picker.getByRole("button", { name: "Weekend" })).toHaveAttribute("aria-pressed", "true");
    await picker.getByRole("button", { name: "Favourites" }).click();
    await expect(picker.getByRole("button", { name: "Favourites" })).toHaveAttribute("aria-pressed", "true");
    await phone.getByTestId("sheet-close").click();
    await expect(toggle(1)).toHaveAccessibleName("In your lists: The Other One");
    await expect(phone.getByRole("region", { name: "Favourites" })).toContainText("The Sample");
    await expect(phone.getByRole("region", { name: "Favourites" })).toContainText("The Other One");
    await expect(phone.getByRole("region", { name: "Weekend" })).toContainText("The Other One");
    await expect(phone.getByRole("region", { name: "Weekend" })).not.toContainText("The Sample");

    // The cross on a card takes the title off that list only.
    await phone.getByRole("region", { name: "Weekend" }).getByTestId("list-remove").click();
    await expect(phone.getByRole("region", { name: "Weekend" })).toHaveCount(0); // an empty list has no row
    await expect(phone.getByRole("region", { name: "Favourites" })).toContainText("The Other One");
    await expect(toggle(1)).toHaveAccessibleName("In your lists: The Other One"); // still in the first
  });

  test("a list is made from the picker with the title in it, then renamed, and deleted with the titles in it; the first list is renamed but not deleted", async ({ browser }) => {
    const { phone } = await phoneWithLibrary(browser, (route) => route.fulfill({ json: library }));
    const toggle = (n: number) => phone.getByTestId("library-list-toggle").nth(n);
    await toggle(0).click(); // Favourites
    await phone.getByTestId("lists-manage").click();
    await phone.getByTestId("list-new").click();
    await phone.getByTestId("list-name-input").fill("Weekend");
    await phone.getByTestId("list-save").click();
    await phone.getByTestId("sheet-close").click();

    // "New list" in the picker makes the list and puts the title in it.
    await toggle(2).click();
    const picker = phone.getByTestId("list-picker");
    await picker.getByTestId("pick-new").click();
    await expect(picker.getByTestId("list-editor")).toBeVisible();
    await phone.getByTestId("list-name-input").fill("weekend"); // another list's name, in other letters
    await phone.getByTestId("list-save").click();
    await expect(phone.getByTestId("list-error")).toHaveText("You already have a list with that name.");
    await phone.getByTestId("list-name-input").fill("Classics");
    await expect(phone.getByTestId("list-error")).toHaveCount(0);
    await phone.getByTestId("list-save").click();
    await expect(picker.getByRole("button", { name: "Classics" })).toHaveAttribute("aria-pressed", "true");
    await phone.getByTestId("sheet-close").click();
    await expect(phone.getByRole("region", { name: "Classics" })).toContainText("Third");

    // Another name for it.
    await phone.getByTestId("lists-manage").click();
    const sheet = phone.getByTestId("lists-sheet");
    await expect(sheet).toContainText("Classics");
    await sheet.getByRole("button", { name: /^Classics/ }).click();
    await expect(phone.getByTestId("list-name-input")).toHaveValue("Classics");
    await phone.getByTestId("list-name-input").fill("Old films");
    await phone.getByTestId("list-save").click();
    await expect(sheet.getByRole("button", { name: /^Old films/ })).toContainText("1 title");
    await expect(phone.getByRole("region", { name: "Old films" })).toContainText("Third");

    // Deleted, after a question; the title in it goes with it.
    await sheet.getByRole("button", { name: /^Old films/ }).click();
    await phone.getByTestId("list-delete").click();
    await expect(phone.getByTestId("list-editor")).toContainText("Delete “Old films”?");
    await phone.getByTestId("list-delete-cancel").click();
    await phone.getByTestId("list-delete").click();
    await phone.getByTestId("list-delete-confirm").click();
    await expect(sheet).not.toContainText("Old films");
    await expect(phone.getByRole("region", { name: "Old films" })).toHaveCount(0);
    await expect(toggle(2)).toHaveAccessibleName("Add to a list: Third");

    // The first list has no Delete, but takes another name.
    await sheet.getByRole("button", { name: /^Favourites/ }).click();
    await expect(phone.getByTestId("list-delete")).toHaveCount(0);
    await phone.getByTestId("list-name-input").fill("Watch later");
    await phone.getByTestId("list-save").click();
    await expect(sheet.getByRole("button", { name: /^Watch later/ })).toBeVisible();
    await phone.getByTestId("sheet-close").click();
    await expect(phone.getByRole("region", { name: "Watch later" })).toContainText("The Sample");
  });

  test("the lists are put in the order wanted from the sheet that manages them: a list moves one place, never the first, and a new name keeps its place", async ({ browser }) => {
    const { phone } = await phoneWithLibrary(browser, (route) => route.fulfill({ json: library }));
    await phone.getByTestId("library-list-toggle").first().click(); // Favourites: now there is a button for the lists
    await phone.getByTestId("lists-manage").click();
    const sheet = phone.getByTestId("lists-sheet");
    const order = () => sheet.locator('[data-testid^="manage-"] > span:first-child').allTextContents();
    const make = async (name: string) => {
      await phone.getByTestId("list-new").click();
      await phone.getByTestId("list-name-input").fill(name);
      await phone.getByTestId("list-save").click();
    };
    const open = (name: string) => sheet.getByRole("button", { name: new RegExp(`^${name}`) }).click();

    // One list besides the first: nothing to change places with.
    await make("Weekend");
    await open("Weekend");
    await expect(phone.getByTestId("list-name-input")).toHaveValue("Weekend");
    await expect(phone.getByTestId("list-move-earlier")).toHaveCount(0);
    await phone.getByTestId("list-cancel").click();

    await make("Kids");
    await make("Date night");
    await expect.poll(order).toEqual(["Favourites", "Weekend", "Kids", "Date night"]);

    // The first list stays first.
    await open("Favourites");
    await expect(phone.getByTestId("list-move-earlier")).toHaveCount(0);
    await phone.getByTestId("list-cancel").click();

    await open("Date night");
    await expect(phone.getByTestId("list-move-later")).toHaveAttribute("aria-disabled", "true");
    await expect(phone.getByTestId("list-move-earlier")).toHaveAccessibleName("Move up");
    await phone.getByTestId("list-move-earlier").click();
    await phone.getByTestId("list-move-earlier").click();
    await expect(phone.getByTestId("list-move-earlier")).toHaveAttribute("aria-disabled", "true"); // the first of the others
    await phone.getByTestId("list-move-earlier").click({ force: true }); // nothing happens (a dimmed button can still be pressed)
    await expect(phone.getByTestId("list-name-input")).toHaveValue("Date night"); // (and the sheet is still on this list)
    await phone.getByTestId("list-cancel").click();
    await expect.poll(order).toEqual(["Favourites", "Date night", "Weekend", "Kids"]);

    // Another name keeps the place, and moving down is the other way.
    await open("Date night");
    await phone.getByTestId("list-move-later").click();
    await phone.getByTestId("list-name-input").fill("Late night");
    await phone.getByTestId("list-save").click();
    await expect.poll(order).toEqual(["Favourites", "Weekend", "Late night", "Kids"]);

    // A list that is made after that comes last, and one that is removed leaves the others as they were.
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
    await phone.getByTestId("library-search-input").fill("zzz");
    await expect(phone.getByTestId("library-search-results")).toContainText("Search can't be reached right now");
    await phone.getByTestId("library-search-input").fill("Sample"); // a title that is on the page needs no server
    await expect(phone.getByTestId("library-search-results")).toContainText("Results for “Sample”");
    await expect(phone.getByTestId("library-search-results")).toContainText("the rest of the search can't be reached"); // (what the server could add is missing, and it says so)
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
  /** A phone whose storage has not been told to show the box for pasting a link (as a new phone's). */
  const withoutLinkBox = (baseURL: string) => ({ cookies: [], origins: [{ origin: new URL(baseURL).origin, localStorage: [{ name: "kino.fullscreen.left", value: "1" }] }] });

  let searches = 0;
  /** A TV, and a phone paired to it that is shown the library: two seasons of three episodes for the show (pages that play), and a search over the films. */
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
    await expect(phone.getByTestId("tv-online")).toHaveClass(/\bok\b/); // (whatever language it says so in)
    return { tv, phone };
  }
  const tile = (phone: Page, title: string) => phone.locator(`[data-testid="library-tile"][title="${title}"]`);

  /** A finger that stays on a title (the mouse here), then lets go. */
  async function hold(phone: Page, target: ReturnType<Page["locator"]>) {
    const box = (await target.boundingBox())!;
    await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await phone.mouse.down();
    await phone.waitForTimeout(700);
    await phone.mouse.up();
  }

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
    await expect(episodes.first()).toHaveAttribute("data-target", "true"); // what Play starts
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

  test("a title's page keeps the title in a list, and its Close puts it away", async ({ browser, baseURL }) => {
    const { phone } = await connect(browser, baseURL!);
    await tile(phone, "Film number 1").click();
    const page = phone.getByTestId("title-sheet");
    await expect(page.getByTestId("title-list")).toHaveText("Favourites");
    await expect(page.getByTestId("title-list")).toHaveAccessibleName("Add to Favourites");
    await page.getByTestId("title-list").click();
    await expect(page.getByTestId("title-list")).toHaveAccessibleName("Remove from Favourites");
    await expect(page.getByTestId("title-list")).toHaveAttribute("aria-pressed", "true");
    await phone.getByTestId("sheet-close").click();
    await expect(phone.getByTestId("title-sheet")).toHaveCount(0);
    await expect(phone.getByRole("region", { name: "Favourites" })).toContainText("Film number 1");

    // From the list a tap opens the page too, which says where the title is kept.
    await phone.getByRole("region", { name: "Favourites" }).getByTestId("list-play").click();
    await expect(phone.getByTestId("title-list")).toHaveAttribute("aria-pressed", "true");
  });

  test("a hold on a title puts it in a list, as the round button does; a tap after a hold is still a tap", async ({ browser, baseURL }) => {
    const { phone } = await connect(browser, baseURL!);
    const first = phone.getByTestId("library-tile").first();
    await hold(phone, first);
    await expect(phone.getByTestId("library-list-toggle").first()).toHaveAccessibleName("In Favourites — tap to remove: Film number 1");
    await expect(phone.getByRole("region", { name: "Favourites" })).toContainText("Film number 1");
    await expect(phone.getByTestId("title-sheet")).toHaveCount(0); // the let-go that ends a hold is not a tap
    await expect(phone.getByTestId("toast")).toHaveText("Added to Favourites"); // the + is a corner away from the finger: a line says what the hold did

    await hold(phone, first);
    await expect(phone.getByTestId("library-list-toggle").first()).toHaveAccessibleName("Add to Favourites: Film number 1");
    await expect(phone.getByTestId("toast")).toHaveText("Removed from Favourites");
    await first.click();
    await expect(phone.getByTestId("title-sheet")).toBeVisible();
  });

  test("with several lists a hold asks which", async ({ browser, baseURL }) => {
    const { phone } = await connect(browser, baseURL!);
    await phone.getByTestId("library-list-toggle").first().click();
    await phone.getByTestId("lists-manage").click();
    await phone.getByTestId("list-new").click();
    await phone.getByTestId("list-name-input").fill("Weekend");
    await phone.getByTestId("list-save").click();
    await phone.getByTestId("sheet-close").click();

    await hold(phone, tile(phone, "Film number 2"));
    await expect(phone.getByTestId("list-picker")).toContainText("Film number 2");
    await expect(phone.getByTestId("title-sheet")).toHaveCount(0);
  });

  test("a search lists what it finds one under another, and is still there after something is played and stopped", async ({ browser, baseURL }) => {
    const { tv, phone } = await connect(browser, baseURL!);
    await phone.getByTestId("library-search-input").fill("film");
    const results = phone.getByTestId("library-result");
    await expect(results).toHaveCount(12);
    await expect(phone.getByTestId("library-search-results")).toContainText("Results for “film”");
    await expect(results.first()).toContainText("1930 · Movie");
    await expect(phone.locator(".lib-scroller")).toHaveCount(0); // (the rows of the library are not there: only the list)

    // one under another, not side by side
    const first = (await results.nth(0).boundingBox())!;
    const second = (await results.nth(1).boundingBox())!;
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height - 1);
    expect(Math.abs(second.x - first.x)).toBeLessThan(2);

    // down the list, to one that is played
    await phone.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(() => phone.evaluate(() => window.scrollY)).toBeGreaterThan(300);
    const before = (await results.nth(5).boundingBox())!.y;
    await results.nth(5).click();
    await expect(phone.getByTestId("title-sheet")).toContainText("Film number 6");
    await phone.getByTestId("title-play").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await phone.getByTestId("stop").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle");

    // Back on the home screen: the words, the list, and the place in it (a card for what was played now lies above, and has not pushed it away).
    await expect(phone.getByTestId("library-search-input")).toHaveValue("film");
    await expect(results).toHaveCount(12);
    await expect(phone.getByTestId("continue-item")).toHaveCount(1);
    await expect.poll(async () => Math.abs((await results.nth(5).boundingBox())!.y - before)).toBeLessThan(4);
    expect(searches).toBe(1); // what the library said is not asked again
  });

  test("a search forgives a slip of the fingers, an unfinished word and spaces left out: a title on the page is found, and the answer from the library adds nothing wrong", async ({ browser, baseURL }) => {
    const { phone } = await connect(browser, baseURL!);
    const results = phone.getByTestId("library-result");
    await phone.getByTestId("library-search-input").fill("long nigth"); // two letters swapped
    await expect(results).toHaveCount(1);
    await expect(results.first()).toContainText("The Long Night");
    await expect.poll(() => searches).toBe(1); // the library was asked, and knew no such film
    await expect(results).toHaveCount(1);

    await phone.getByTestId("library-search-input").fill("thelongnight"); // the title as one word
    await expect(results).toHaveCount(1);
    await phone.getByTestId("library-search-input").fill("the lon nig");
    await expect(results).toHaveCount(1);
    await expect(results.first()).toContainText("The Long Night");
  });

  test("a short word brings a long list, the likeliest titles first (what the page has and what the library knows together), down to its end", async ({ browser, baseURL }) => {
    const rows = [{ id: "r", title: "Classics", source: "Test Source", kind: "movie", items: [{ id: "w", title: "Welcome to the Boondocks", url: "/fixtures/sample.mp4?w=1" }, { id: "n", title: "Boonie Bears", url: "/fixtures/sample.mp4?n=1" }] }];
    const server = [
      { id: "far", title: "Baboon", url: "/fixtures/sample.mp4?far=1" }, // (the word is inside another)
      ...Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, title: `Zed ${i + 1} Boone Story`, url: `/fixtures/sample.mp4?s=${i}` })), // (a word of the title begins with it)
      { id: "d", title: "The Boondocks", url: "/fixtures/sample.mp4?d=1" }, // (the title begins with it)
      { id: "b", title: "Boon", url: "/fixtures/sample.mp4?b=1" }, // (it is the title)
    ];
    const { phone } = await connect(browser, baseURL!, { library: { updatedAt: Date.now(), rows }, find: (query) => (query.includes("boon") ? server : []) });
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

  test("Continue watching is a row of big cards that snap one at a time, each with a + and a cross; a tap resumes", async ({ browser, baseURL }) => {
    const now = Date.now();
    const progress = [0, 1, 2].map((i) => ({ key: `url:${baseURL}/fixtures/sample.mp4?n=${i}`, at: now - (i + 1) * 60_000, title: `Film number ${i + 1}`, url: `${baseURL}/fixtures/sample.mp4?n=${i}`, position: 1500, duration: 6000 }));
    const { tv, phone } = await connect(browser, baseURL!, { seed: guestStorage({ progress }) });
    const cards = phone.getByTestId("continue-item");
    await expect(cards).toHaveCount(3);
    await expect(phone.getByTestId("continue-row")).toContainText("Film number 3");

    const first = (await cards.nth(0).boundingBox())!;
    const next = (await cards.nth(1).boundingBox())!;
    expect(first.width).toBeGreaterThan(200); // big cards...
    expect(next.x).toBeLessThan(390); // ...with the next one showing at the edge
    expect(next.x + next.width).toBeGreaterThan(390);
    for (const id of ["continue-list-toggle", "continue-remove"]) {
      const box = (await phone.getByTestId(id).first().boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(36); // thumb sized
      expect(box.height).toBeGreaterThanOrEqual(36);
    }

    const toggle = phone.getByTestId("continue-list-toggle").first();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(phone.getByRole("region", { name: "Favourites" })).toContainText("Film number 1");
    await phone.getByTestId("continue-remove").nth(1).click();
    await expect(cards).toHaveCount(2);
    await expect(phone.getByTestId("continue-row")).not.toContainText("Film number 2");

    await phone.getByTestId("continue-play").first().click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
  });

  test("the box for pasting a link is off on a new phone, comes back from the menu and stays", async ({ browser, baseURL }) => {
    const { phone } = await connect(browser, baseURL!, { device: { storageState: withoutLinkBox(baseURL!) } });
    await expect(phone.getByTestId("library")).toBeVisible();
    await expect(phone.getByTestId("url-input")).toHaveCount(0);
    await expect(phone.getByTestId("play-url")).toHaveCount(0);

    await phone.getByTestId("menu").click();
    const toggle = phone.getByTestId("link-box-toggle");
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await phone.getByTestId("sheet-close").click();
    await expect(phone.getByTestId("url-input")).toBeVisible();
    await expect(phone.getByTestId("play-url")).toBeVisible();

    await phone.reload();
    await expect(phone.getByTestId("url-input")).toBeVisible(); // kept

    await phone.getByTestId("menu").click();
    await phone.getByTestId("link-box-toggle").click();
    await phone.getByTestId("sheet-close").click();
    await expect(phone.getByTestId("url-input")).toHaveCount(0);
  });

  test("the box is a switch in Settings too (\"Paste a link\"), the same one as the TV menu's", async ({ browser, baseURL }) => {
    const { phone } = await connect(browser, baseURL!, { device: { storageState: withoutLinkBox(baseURL!) } });
    await expect(phone.getByTestId("library")).toBeVisible();
    await expect(phone.getByTestId("url-input")).toHaveCount(0);

    const inSettings = async () => {
      await phone.getByTestId("account-button").click();
      await phone.getByTestId("menu-settings").click();
      return phone.getByTestId("link-box-setting");
    };
    const box = await inSettings();
    await expect(box).toHaveAttribute("aria-checked", "false");
    await box.click();
    await expect(box).toHaveAttribute("aria-checked", "true");
    await phone.getByTestId("page-back").click(); // (the settings, then the account)
    await phone.getByTestId("page-back").click();
    await expect(phone.getByTestId("account-screen")).toHaveCount(0);
    await expect(phone.getByTestId("url-input")).toBeVisible();

    await phone.getByTestId("menu").click(); // the TV's menu says the same, and turns it off from there
    await expect(phone.getByTestId("link-box-toggle")).toHaveAttribute("aria-checked", "true");
    await phone.getByTestId("link-box-toggle").click();
    await phone.getByTestId("sheet-close").click();
    await expect(phone.getByTestId("url-input")).toHaveCount(0);
    await expect(await inSettings()).toHaveAttribute("aria-checked", "false");
  });

  test("without the box, a title that cannot be played still says so", async ({ browser, baseURL }) => {
    const { phone } = await connect(browser, baseURL!, { device: { storageState: withoutLinkBox(baseURL!) } });
    await tile(phone, "No video here").click();
    await phone.getByTestId("title-play").click();
    await expect(phone.getByTestId("resolve-status")).toHaveAttribute("data-phase", "failed");
    await expect(phone.getByTestId("url-input")).toHaveCount(0);
    await expect(phone.getByTestId("toast")).toHaveText(await phone.getByTestId("resolve-status").innerText()); // (also down where the thumb is: the page's own line is at the top of a library that may be scrolled away)
  });

  test("a title whose video is not there is gone from the phone's library once the server stops offering it", async ({ browser, baseURL }) => {
    const library = libraryOf(baseURL!);
    const { phone } = await connect(browser, baseURL!, { device: { storageState: withoutLinkBox(baseURL!) }, library });
    await expect(tile(phone, "No video here")).toHaveCount(1);
    await tile(phone, "No video here").click();
    library.rows[0]!.items = library.rows[0]!.items.filter((item) => item.id !== "nv"); // (what the real server does once the video has not been found)
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
      await expect(phone.getByTestId("play-url")).toBeVisible();
    }
  });

  test.describe("ratings", () => {
    /** Noon in October, the same day in any time zone (and a month whose short name is the same in every English). */
    const day = (date: number) => Date.UTC(2026, 9, date, 12);
    const RATED_TODAY = /^Rated \d{1,2} [A-Za-z]{3,4} \d{4}$/;
    const facts = (phone: Page, id = "rate-title") => phone.getByTestId(`${id}-facts`).locator("li");

    /** A rating box, opened if it was folded. */
    async function open(phone: Page, id = "rate-title") {
      const toggle = phone.getByTestId(`${id}-toggle`);
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
    }
    /** What the phone has kept of its ratings: the notes, in the order they were rated. */
    const notesKept = (phone: Page) =>
      phone.evaluate(() => {
        const kept = JSON.parse(localStorage.getItem("kino.data.guest") ?? "{}") as { data?: { ratings?: Array<{ note?: string; deleted?: boolean }> } };
        return (kept.data?.ratings ?? []).filter((rating) => !rating.deleted).map((rating) => rating.note ?? "");
      });
    /** A rating a phone already had, as it is kept. */
    const given = (baseURL: string, n: number, score: number, date: number, extra: Record<string, unknown> = {}) => ({
      key: `rate:${baseURL}/fixtures/sample.mp4?n=${n}`,
      at: day(date),
      title: `Film number ${n + 1}`,
      url: `${baseURL}/fixtures/sample.mp4?n=${n}`,
      score,
      ratedAt: day(date),
      ...extra,
    });
    /** Films with links that are whole (a title's watching is found by its link, which a relative one cannot be matched with). */
    const wholeLibrary = (baseURL: string) => ({
      updatedAt: Date.now(),
      rows: [{ id: "r", title: "Classics", source: "Test Source", kind: "movie", items: films.map((film) => ({ ...film, url: `${baseURL}${film.url}` })) }],
    });

    test("one tap on a score is a rating, with the word for it and the day; another tap changes it, and it is still there when the page is opened again", async ({ browser, baseURL }) => {
      const { phone } = await connect(browser, baseURL!);
      await tile(phone, "Film number 1").click();
      const box = phone.getByTestId("rate-title");
      await expect(box).toHaveAttribute("data-rated", "false");
      await expect(phone.getByTestId("rate-title-value")).toHaveText("Rate");
      await expect(phone.getByTestId("rate-title-score-8")).toHaveCount(0); // (folded: one line until it is wanted)

      await open(phone);
      await expect(phone.getByTestId("rate-title-word")).toHaveText("Pick a score out of 10");
      await expect(phone.getByTestId("rate-title-note")).toBeDisabled(); // (a note is for a score that is there)
      await expect(phone.getByTestId("rate-title-facts")).toHaveCount(0);
      await expect(phone.getByTestId("rate-title-remove")).toHaveCount(0);
      await expect(phone.getByTestId("ratings-row")).toHaveCount(0);

      await phone.getByTestId("rate-title-score-8").click(); // (that is all it takes)
      await expect(box).toHaveAttribute("data-rated", "true");
      await expect(phone.getByTestId("rate-title-value")).toHaveText("8/10");
      await expect(phone.getByTestId("rate-title-score-8")).toHaveAttribute("aria-checked", "true");
      await expect(phone.getByTestId("rate-title-score-7")).toHaveAttribute("aria-checked", "false");
      await expect(phone.getByTestId("rate-title-word")).toHaveText("Very good");
      await expect(facts(phone)).toHaveText([RATED_TODAY]); // (a title never played here has no watching to tell of)
      await expect(phone.getByTestId("rate-title-note")).toBeEnabled();

      await phone.getByTestId("rate-title-score-3").click();
      await expect(phone.getByTestId("rate-title-value")).toHaveText("3/10");
      await expect(phone.getByTestId("rate-title-word")).toHaveText("Very bad");
      await expect(phone.getByTestId("rate-title-score-8")).toHaveAttribute("aria-checked", "false");

      // The one score in ten is a short way down the hand's reach: each is a thumb-sized press.
      for (const score of [1, 5, 10]) {
        const press = (await phone.getByTestId(`rate-title-score-${score}`).boundingBox())!;
        expect(press.width).toBeGreaterThanOrEqual(36);
        expect(press.height).toBeGreaterThanOrEqual(36);
      }

      await phone.getByTestId("sheet-close").click();
      await expect(phone.getByTestId("ratings-row")).toContainText("Film number 1");
      await expect(phone.getByTestId("ratings-row").getByTestId("rating-item").locator(".lib-year")).toHaveText(["3/10"]);
      await phone.reload();
      await expect(phone.getByTestId("ratings-row")).toContainText("Film number 1");
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
      await expect.poll(() => notesKept(phone)).toEqual(["Too long, but the ending paid off."]); // (kept a moment after the last letter, the box still open)
      await expect(facts(phone)).toHaveText([RATED_TODAY]); // (a note does not make it rated again)

      await note.fill("Too long, but the ending paid off. Twice.");
      await phone.getByTestId("sheet-close").click(); // (straight away: what was just typed is not lost)
      await expect(phone.getByTestId("ratings-row")).toBeVisible();
      await tile(phone, "Film number 2").click();
      await open(phone);
      await expect(phone.getByTestId("rate-title-note")).toHaveValue("Too long, but the ending paid off. Twice.");
      await expect(phone.getByTestId("rate-title-value")).toHaveText("6/10");

      // Near the end of what a note can hold, the field counts.
      await expect(phone.locator(".rating-count")).toHaveCount(0);
      await phone.getByTestId("rate-title-note").fill("x".repeat(320));
      await expect(phone.locator(".rating-count")).toHaveText("320/400");

      // Taking the rating back takes the note with it, and a new one starts clean.
      await phone.getByTestId("rate-title-remove").click();
      await expect(phone.getByTestId("rate-title")).toHaveAttribute("data-rated", "false");
      await expect(phone.getByTestId("rate-title-value")).toHaveText("Rate");
      await expect(phone.getByTestId("rate-title-note")).toBeDisabled();
      await expect(phone.getByTestId("rate-title-note")).toHaveValue("");
      await expect.poll(() => notesKept(phone)).toEqual([]);
      await expect(phone.getByTestId("ratings-row")).toHaveCount(0);
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
      const progress = [card(0, 5800, day(3)), card(1, 3720, day(4))]; // 96.7% and 62%
      const { phone } = await connect(browser, baseURL!, { library: wholeLibrary(baseURL!), seed: guestStorage({ progress }) });

      await tile(phone, "Film number 1").click();
      await open(phone);
      await phone.getByTestId("rate-title-score-9").click();
      await expect(facts(phone)).toHaveText([RATED_TODAY, "Watched all of it", "Finished 3 Oct 2026"]);
      await phone.getByTestId("sheet-close").click();

      await tile(phone, "Film number 2").click();
      await open(phone);
      await phone.getByTestId("rate-title-score-7").click();
      await expect(facts(phone)).toHaveText([RATED_TODAY, "62% watched", "Last watched 4 Oct 2026"]);
      await phone.getByTestId("sheet-close").click();

      await tile(phone, "Film number 3").click(); // never played here
      await open(phone);
      await phone.getByTestId("rate-title-score-5").click();
      await expect(facts(phone)).toHaveText([RATED_TODAY]);
    });

    test("each season of a show is rated on its own, apart from the show; the episodes seen are counted out of the season's", async ({ browser, baseURL }) => {
      const seen = (episode: number, season: number) => ({ key: `The Long Night|${season}x${episode}`, at: day(episode + (season - 1) * 3), show: "The Long Night", season, episode, position: 2400, duration: 2400, done: true });
      const { phone } = await connect(browser, baseURL!, { seed: guestStorage({ watched: [seen(1, 1), seen(2, 1), seen(1, 2)] }) });
      await tile(phone, "The Long Night").click();

      await open(phone); // the show as a whole
      await expect(phone.getByTestId("rate-title-toggle")).toContainText("Your rating");
      await phone.getByTestId("rate-title-score-9").click();
      await expect(facts(phone)).toHaveText([RATED_TODAY, "3 episodes watched", "Last watched 4 Oct 2026"]);

      await expect(phone.getByTestId("rate-season-toggle")).toContainText("Season 1 rating");
      await expect(phone.getByTestId("rate-season-value")).toHaveText("Rate"); // (not rated just because the show is)
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
      await phone.getByTestId("rate-season-remove").click(); // (taking back a season's rating leaves the others)
      await expect(phone.getByTestId("rate-season-value")).toHaveText("Rate");
      await expect(phone.getByTestId("rate-title-value")).toHaveText("9/10");
      await phone.getByTestId("title-season-2").click();
      await expect(phone.getByTestId("rate-season-value")).toHaveText("5/10");

      await phone.getByTestId("sheet-close").click();
      await expect(phone.getByTestId("ratings-row").getByTestId("rating-item").locator(".lib-year")).toHaveText(["Season 2 · 5/10", "9/10"]); // (the newest first)
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

      await entries.first().click(); // a tap opens the title, where the score can be changed
      const page = phone.getByTestId("title-sheet");
      await expect(page).toContainText("Film number 2");
      await expect(page.getByTestId("rate-title-value")).toHaveText("9/10");
      await page.getByTestId("sheet-close").click();
      await expect(phone.getByTestId("ratings-sheet")).toBeVisible(); // (back to the list it was opened from)
      await sheet.getByTestId("sheet-close").click();
      await expect(phone.getByTestId("ratings-sheet")).toHaveCount(0);
    });

    test("Settings has a switch for ratings: off, every sign of them is gone and what was rated is kept; on again, it is all back", async ({ browser, baseURL }) => {
      const { phone } = await connect(browser, baseURL!, { library: wholeLibrary(baseURL!), seed: guestStorage({ ratings: [given(baseURL!, 0, 8, 2)] }) });
      await expect(phone.getByTestId("ratings-row")).toBeVisible();
      await tile(phone, "Film number 2").click();
      await expect(phone.getByTestId("rate-title")).toBeVisible();
      await phone.getByTestId("sheet-close").click();

      const toggle = async (to: "true" | "false") => {
        await phone.getByTestId("account-button").click();
        await phone.getByTestId("menu-settings").click();
        const rate = phone.getByTestId("ratings-switch");
        await expect(rate).toHaveAttribute("aria-checked", to === "true" ? "false" : "true");
        await rate.click();
        await expect(rate).toHaveAttribute("aria-checked", to);
        await phone.getByTestId("page-back").click();
        await phone.getByTestId("page-back").click();
        await expect(phone.getByTestId("account-screen")).toHaveCount(0);
      };

      await toggle("false");
      await expect(phone.getByTestId("ratings-row")).toHaveCount(0);
      await tile(phone, "Film number 2").click();
      await expect(phone.getByTestId("title-sheet")).toBeVisible();
      await expect(phone.getByTestId("rate-title")).toHaveCount(0);
      await phone.getByTestId("sheet-close").click();
      await phone.reload();
      await expect(phone.getByTestId("library")).toBeVisible();
      await expect(phone.getByTestId("ratings-row")).toHaveCount(0); // (kept off)

      await toggle("true");
      await expect(phone.getByTestId("ratings-row")).toContainText("Film number 1");
      await tile(phone, "Film number 1").click();
      await expect(phone.getByTestId("rate-title-value")).toHaveText("8/10");
    });

    test("a rated title shows its score in the corner of its picture, in the rows, a search, Continue watching and a list; one not rated shows none, and with ratings off nothing does", async ({ browser, baseURL }) => {
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

      // The rows of the library: the score is in the picture's corner, worded by its tooltip; a season's score is no score of the title's own.
      await expect(badge(tile(phone, "Film number 1"))).toHaveText("8");
      await expect(badge(tile(phone, "Film number 1"))).toHaveAttribute("title", "Your rating: 8/10");
      // A screen reader says it once, with the title (in the name of the button the picture is in: a card's own name gets it added).
      await expect(tile(phone, "Film number 1")).toHaveAccessibleName(/Your rating: 8\/10/);
      await expect(tile(phone, "Film number 2")).not.toHaveAccessibleName(/Your rating/);
      await expect(phone.getByTestId("continue-play")).toHaveAccessibleName(/Your rating: 6\/10/);
      await expect(badge(tile(phone, "Film number 2"))).toHaveCount(0);
      await expect(badge(tile(phone, "Film number 3"))).toHaveCount(0);
      // The cards of Continue watching and of a list; the row of what was rated has its scores under the titles already.
      await expect(badge(phone.getByTestId("continue-item"))).toHaveText("6");
      await expect(badge(phone.getByTestId("list-item"))).toHaveText("9");
      await expect(badge(phone.getByTestId("ratings-row"))).toHaveCount(0);

      // It is in the corner opposite the round button, so the two do not cover each other (and the button is still what a tap there reaches).
      const score = (await badge(tile(phone, "Film number 1")).boundingBox())!;
      const round = (await tile(phone, "Film number 1").locator("xpath=..").locator(".lib-round").boundingBox())!;
      expect(score.x + score.width).toBeLessThan(round.x);

      // A search: the same on the line of each title.
      await phone.getByTestId("library-search-input").fill("film number 1");
      const found = (title: string) => phone.locator(`[data-testid="library-result"][title="${title}"]`);
      await expect(found("Film number 1")).toBeVisible();
      await expect(badge(found("Film number 1"))).toHaveText("8");
      await expect(found("Film number 10")).toBeVisible();
      await expect(badge(found("Film number 10"))).toHaveCount(0);
      await phone.getByTestId("library-search-input").fill("");

      // A score given on the title's page is on its picture when the page is closed, and gone when the rating is taken back.
      await tile(phone, "Film number 3").click();
      await open(phone);
      await phone.getByTestId("rate-title-score-4").click();
      await phone.getByTestId("sheet-close").click();
      await expect(badge(tile(phone, "Film number 3"))).toHaveText("4");
      await tile(phone, "Film number 3").click();
      await open(phone);
      await phone.getByTestId("rate-title-remove").click();
      await phone.getByTestId("sheet-close").click();
      await expect(badge(tile(phone, "Film number 3"))).toHaveCount(0);

      // With ratings off in the settings there is none anywhere.
      await phone.getByTestId("account-button").click();
      await phone.getByTestId("menu-settings").click();
      await phone.getByTestId("ratings-switch").click();
      await expect(phone.getByTestId("ratings-switch")).toHaveAttribute("aria-checked", "false");
      await phone.getByTestId("page-back").click();
      await phone.getByTestId("page-back").click();
      await expect(phone.getByTestId("account-screen")).toHaveCount(0);
      await expect(tile(phone, "Film number 1")).toBeVisible();
      await expect(phone.getByTestId("score-badge")).toHaveCount(0);
    });

    test("the account page has My ratings among the profile's places, for a guest too, saying how many; it opens the list over the page, and a title opened from it shows over the list", async ({ browser, baseURL }) => {
      const url = baseURL!;
      const { phone } = await connect(browser, url, { library: wholeLibrary(url), seed: guestStorage({ ratings: [given(url, 0, 8, 2), given(url, 1, 5, 3)] }) });
      await phone.getByTestId("account-button").click(); // (nobody is signed in)
      const row = phone.getByTestId("menu-ratings");
      await expect(row).toContainText("My ratings");
      await expect(row).toContainText("2");
      await row.click();
      const sheet = phone.getByTestId("ratings-sheet");
      await expect(sheet.getByTestId("ratings-summary")).toHaveText("2 ratings · average 6.5");
      await expect(sheet.getByTestId("rating-entry").locator(".rating-name")).toHaveText(["Film number 2", "Film number 1"]);

      await sheet.getByTestId("rating-entry").first().click(); // (the library's page is under the account page: the title opens over both)
      const page = phone.getByTestId("title-sheet");
      await expect(page).toContainText("Film number 2");
      await expect(page.getByTestId("rate-title-value")).toHaveText("5/10");
      await page.getByTestId("sheet-close").click();
      await expect(sheet).toBeVisible(); // (back to the list it was opened from)
      await sheet.getByTestId("sheet-close").click();
      await expect(sheet).toHaveCount(0);
      await expect(phone.getByTestId("account-screen")).toBeVisible();

      // Off in the settings, the place is gone from the page; what was rated is kept.
      await phone.getByTestId("menu-settings").click();
      await phone.getByTestId("ratings-switch").click();
      await phone.getByTestId("page-back").click();
      await expect(phone.getByTestId("account-screen")).toBeVisible();
      await expect(phone.getByTestId("menu-ratings")).toHaveCount(0);
    });

    test("My ratings works on a phone with no TV: the keyboard is in the sheet, a title opens from it (with no Play), its rating can be taken back, and with none the sheet says what to do", async ({ browser, baseURL }) => {
      const url = baseURL!;
      const phone = await openDevice(browser, PHONE, guestStorage({ ratings: [given(url, 0, 8, 2)] }), withLibrary(wholeLibrary(url), () => []));
      await phone.goto("/");
      await expect(phone.getByTestId("code-input")).toBeVisible(); // (no TV: the first screen)
      await phone.getByTestId("account-button").click();
      const row = phone.getByTestId("menu-ratings");
      await row.click();
      const sheet = phone.getByTestId("ratings-sheet");
      await expect(sheet).toBeFocused(); // (not left on the row behind it, where the next Tab would carry on under the sheet)

      await sheet.getByTestId("rating-entry").click();
      const page = phone.getByTestId("title-sheet");
      await expect(page).toContainText("Film number 1");
      await expect(page.getByTestId("title-play")).toHaveCount(0); // (nothing to play it on)
      await expect(page.getByTestId("rate-title-value")).toHaveText("8/10");
      await open(phone);
      await page.getByTestId("rate-title-remove").click();
      await page.getByTestId("sheet-close").click();
      await expect(sheet.getByTestId("ratings-empty")).toBeVisible();
      await expect(sheet.getByTestId("ratings-sort-new")).toHaveCount(0);
      await sheet.getByTestId("sheet-close").click();
      await expect(row).toBeFocused(); // (and back on the row it was opened from)
    });
  });
});
