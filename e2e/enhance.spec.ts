import { expect, type Browser, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import type { NormalizedMedia } from "../src/shared";
import { loadOnTv, openLibrary, openPairedPhone, pressMenuLine, RawPhone, readPairingCode, test, tvRoot, twoSizes } from "./helpers";

/**
 * ✦ 2K in the player (client/enhance): the Quality list has, under a line of its own, what this screen adds to the picture. Picked, the picture the video
 * shows is redrawn at 2K by the screen's graphics chip, on a canvas over the video, and the film plays as before. These screens have no WebGPU (taken
 * away here, so it is always the same): FSR 1 draws it. Anime4K, on a screen with WebGPU, is checked by hand (the upscaler test page draws the same).
 */

const noWebGpu = () => Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined, configurable: true });

async function openTvWithoutWebGpu(browser: Browser): Promise<Page> {
  const tv = await openLibrary(browser, (context) => context.addInitScript(noWebGpu));
  await pressMenuLine(tv, "rail-connect");
  return tv;
}

/** A film of one file: the sample (320 x 180). */
const oneFile = (title: string, query = ""): NormalizedMedia => ({ title, stream: { url: `/fixtures/sample.mp4${query}`, type: "mp4" } });

/** The middle of what the screen shows of the picture, with the video itself hidden: only the canvas can be seen there then. How bright it is (0-255). */
async function canvasBrightness(tv: Page): Promise<number> {
  await tv.evaluate(() => void (document.querySelector("video")!.style.visibility = "hidden"));
  const box = (await tv.getByTestId("tv-enhance").boundingBox())!;
  const shot = PNG.sync.read(await tv.screenshot({ clip: { x: box.x + box.width / 4, y: box.y + box.height / 4, width: box.width / 2, height: box.height / 2 } }));
  await tv.evaluate(() => void (document.querySelector("video")!.style.visibility = ""));
  let sum = 0;
  for (let at = 0; at < shot.data.length; at += 4) sum += (shot.data[at]! + shot.data[at + 1]! + shot.data[at + 2]!) / 3;
  return sum / (shot.data.length / 4);
}

async function pausedAt(tv: Page, seconds: number): Promise<void> {
  await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
  await tv.evaluate((at) => {
    const video = document.querySelector("video")!;
    video.currentTime = at;
    return new Promise((done) => video.addEventListener("seeked", done, { once: true }));
  }, seconds);
}

test.describe("✦ 2K: the picture redrawn by the screen", () => {
  test("a film of one file gets ✦ 2K under its own line in the Quality list; picked, the picture is drawn at 2K over the video, which plays on as it was; Off takes it away", async ({ browser }) => {
    const tv = await openTvWithoutWebGpu(browser);
    const phone = await openPairedPhone(browser, tv);
    const toasts: string[] = [];
    await tv.exposeFunction("__toast", (text: string) => void toasts.push(text));
    await tv.evaluate(() => {
      new MutationObserver(() => {
        const toast = document.querySelector(".hud-toast");
        if (toast?.textContent) (window as unknown as { __toast: (text: string) => void }).__toast(toast.textContent);
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await loadOnTv(phone, oneFile("One File"));
    await pausedAt(tv, 5); // (five seconds in: the first frame is black)
    const source = await tv.evaluate(() => document.querySelector("video")!.currentSrc);

    // One file has no qualities to pick: the Quality button is there for the ✦ choice, and says it is off.
    const button = tv.getByTestId("tv-quality-btn");
    await expect(button).toHaveText("✦ Off");
    await button.click();
    const menu = tv.getByTestId("audio-subtitles-modal");
    await expect(menu).toHaveAttribute("data-kind", "quality");
    await expect(menu.locator(".tv-opt-heading")).toHaveText("✦ Enhanced by this device");
    await expect(menu.getByRole("option")).toHaveText(["✦ Off", "✦ 2K"]); // (no 60 fps yet: see useEnhance's `canBoost`)
    await expect(menu.locator("[data-key='enhance-off']")).toHaveAttribute("data-active", "true");
    await menu.locator("[data-key='enhance-2k']").click();

    const canvas = tv.getByTestId("tv-enhance");
    await expect(canvas).toHaveAttribute("data-drawn", "true"); // (a paused film is redrawn at once, not at its next frame)
    await expect(canvas).toHaveAttribute("data-tier", "sharp");
    expect(await canvas.evaluate((drawn: HTMLCanvasElement) => [drawn.width, drawn.height])).toEqual([2560, 1440]);
    expect(await canvasBrightness(tv)).toBeGreaterThan(10); // (a picture, not a black canvas)
    await expect(button).toHaveText("✦ 2K");
    await expect(phone.getByTestId("chip-quality")).toContainText("✦ 2K");
    await expect.poll(() => toasts).toContain("✦ 2K on · FSR 1");

    // The film is the same file, from where it was, and plays on with the canvas over it (which takes no taps).
    expect(await tv.evaluate(() => document.querySelector("video")!.currentSrc)).toBe(source);
    expect(await canvas.evaluate((drawn) => getComputedStyle(drawn).pointerEvents)).toBe("none");
    await phone.getByTestId("play").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await expect.poll(() => tv.evaluate(() => document.querySelector("video")!.currentTime), { timeout: 10_000 }).toBeGreaterThan(6);

    // Off from the phone: the canvas goes, the video is there as it was.
    await phone.getByTestId("chip-quality").click();
    await expect(phone.getByTestId("quality-sheet").locator(".sheet-section")).toHaveText("✦ Enhanced by this device");
    await expect(phone.getByTestId("enhance-2k")).toHaveAttribute("aria-selected", "true");
    await phone.getByTestId("enhance-off").click();
    await expect(canvas).toHaveCount(0);
    await expect(button).toHaveText("✦ Off");
    await expect.poll(() => toasts).toContain("✦ 2K off");
    expect(await tv.evaluate(() => localStorage.getItem("kino.enhance"))).toBeNull();
  });

  test("the choice stays on this screen from film to film, and a film with a 2K quality of its own is not offered it", async ({ browser }) => {
    const tv = await openTvWithoutWebGpu(browser);
    const phone = await openPairedPhone(browser, tv);
    await loadOnTv(phone, oneFile("First", "?film=1"));
    await pausedAt(tv, 5);
    await phone.getByTestId("chip-quality").click();
    await phone.getByTestId("enhance-2k").click();
    await expect(tv.getByTestId("tv-enhance")).toHaveAttribute("data-drawn", "true");
    expect(await tv.evaluate(() => localStorage.getItem("kino.enhance"))).toBe("2k");
    await phone.keyboard.press("Escape");

    // The next film: on by itself.
    await loadOnTv(phone, oneFile("Second", "?film=2"));
    await expect.poll(() => tv.evaluate(() => document.querySelector("video")!.currentSrc)).toContain("film=2");
    await pausedAt(tv, 5);
    await expect(tv.getByTestId("tv-enhance")).toHaveAttribute("data-drawn", "true");
    await expect(tv.getByTestId("tv-quality-btn")).toHaveText("✦ 2K");

    // A film that comes in 2K: its qualities, and no ✦ line (it would only add 60 fps, which is not offered yet). Nothing is drawn over it.
    await loadOnTv(phone, {
      title: "Comes in 2K",
      stream: { url: "/fixtures/sample.mp4?q=2k", type: "mp4" },
      quality: "1440p",
      alternates: [{ label: "720p", quality: "720p", stream: { url: "/fixtures/sample.mp4?q=720", type: "mp4" } }],
    });
    await expect.poll(() => tv.evaluate(() => document.querySelector("video")!.currentSrc)).toContain("q=2k");
    await pausedAt(tv, 5);
    await expect(tv.getByTestId("tv-quality-btn")).toHaveText("1440p");
    await tv.getByTestId("tv-quality-btn").click();
    const menu = tv.getByTestId("audio-subtitles-modal");
    await expect(menu.getByRole("option")).toHaveText(["1440p", "720p"]);
    await expect(menu.locator(".tv-opt-heading")).toHaveCount(0);
    await expect(tv.getByTestId("tv-enhance")).toHaveCount(0);
    // (Its 720p file is below 2K: there the ✦ choice is offered again. The list is of the whole film, though: 2K is one of its qualities.)
    expect(await tv.evaluate(() => localStorage.getItem("kino.enhance"))).toBe("2k"); // (kept for the next film below 2K)
  });

  test("a film with several qualities lists them first, then the ✦ line; picking one does not change the quality that is downloaded", async ({ browser }) => {
    const tv = await openTvWithoutWebGpu(browser);
    const phone = await openPairedPhone(browser, tv);
    const file = (name: string) => ({ url: `/fixtures/sample.mp4?${name}`, type: "mp4" as const });
    await loadOnTv(phone, { title: "Two Qualities", stream: file("q=1080"), quality: "1080p", alternates: [{ label: "720p", quality: "720p", stream: file("q=720") }] });
    await pausedAt(tv, 5);
    await expect(tv.getByTestId("tv-quality-btn")).toHaveText("1080p");
    await phone.getByTestId("chip-quality").click();
    const sheet = phone.getByTestId("quality-sheet");
    await expect(sheet.getByRole("option")).toHaveText(["1080p", "720p", "✦ Off", "✦ 2K"]);
    await phone.getByTestId("enhance-2k").click();
    await expect(tv.getByTestId("tv-enhance")).toHaveAttribute("data-drawn", "true");
    await expect(tv.getByTestId("tv-quality-btn")).toHaveText("1080p · ✦ 2K");
    await expect(phone.getByTestId("chip-quality")).toContainText("1080p · ✦ 2K");
    expect(await tv.evaluate(() => document.querySelector("video")!.currentSrc)).toContain("q=1080"); // (the same file)
    await expect(phone.getByTestId("quality-1000")).toHaveAttribute("aria-selected", "true");
  });

  test("a file the page may not read (from another site that does not allow it) is not offered it: its Quality button is not there", async ({ browser, baseURL }) => {
    const tv = await openTvWithoutWebGpu(browser);
    const phone = await openPairedPhone(browser, tv);
    // (The same server under another name is another site to the page: the file plays in the <video>, but its frames may not be read.)
    const elsewhere = `${baseURL!.replace("127.0.0.1", "localhost")}/fixtures/sample.mp4?elsewhere=1`;
    await loadOnTv(phone, { title: "Elsewhere", stream: { url: elsewhere, type: "mp4" } });
    await pausedAt(tv, 5);
    expect(await tv.evaluate(() => document.querySelector("video")!.currentSrc)).toBe(elsewhere);
    await expect(tv.getByTestId("tv-source-btn")).toHaveCount(0);
    await expect(tv.getByTestId("tv-quality-btn")).toHaveCount(0);
    await expect(phone.getByTestId("chip-quality")).toHaveCount(0);
    await expect(tv.getByTestId("tv-enhance")).toHaveCount(0);
  });

  test("a stream played by hls.js gets it too, asked for by a phone, and it stays drawn at 2K when the stream's quality changes as it plays", async ({ browser, baseURL }) => {
    const tv = await openLibrary(browser, async (context) => {
      await twoSizes(context);
      await context.addInitScript(noWebGpu);
    });
    await pressMenuLine(tv, "rail-connect");
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: { title: "Two sizes", stream: { url: "/fixtures/hls/multi.m3u8", type: "hls" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect.poll(() => phone.states.at(-1)?.enhance?.offers).toEqual(["2k"]); // (its biggest size is 720p)

    phone.cmd({ type: "SET_ENHANCE", mode: "2k" }); // (the command a phone sends: the server lets it through)
    const canvas = tv.getByTestId("tv-enhance");
    await expect(canvas).toHaveAttribute("data-drawn", "true");
    await expect.poll(() => phone.states.at(-1)?.enhance).toEqual({ offers: ["2k"], current: "2k", tier: "sharp" });

    // Played, and moved from one size to the other while it plays (hls.js: the same <video>, its picture from another stream).
    phone.cmd({ type: "PLAY" });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    const before = await tv.evaluate(() => document.querySelector("video")!.currentTime);
    phone.cmd({ type: "SET_QUALITY", level: 1 });
    await expect.poll(() => phone.states.at(-1)?.quality?.current).toBe(1);
    // (Under four seconds of it: a screen without a graphics chip, as here, would be too slow for 2K over a longer stretch, which is another test.)
    await expect.poll(() => tv.evaluate(() => document.querySelector("video")!.currentTime), { timeout: 10_000 }).toBeGreaterThan(before + 1.5);
    await expect(canvas).toHaveAttribute("data-drawn", "true");
    expect(await canvas.evaluate((drawn: HTMLCanvasElement) => [drawn.width, drawn.height])).toEqual([2560, 1440]);
    expect(phone.states.at(-1)?.enhance).toEqual({ offers: ["2k"], current: "2k", tier: "sharp" }); // (no problem said)
    phone.close();
  });
});
