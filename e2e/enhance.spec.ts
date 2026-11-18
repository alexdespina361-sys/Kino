import { expect, type Browser, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import type { NormalizedMedia } from "../src/shared";
import { loadOnTv, openLibrary, openPairedPhone, pressMenuLine, RawPhone, readPairingCode, test, tvRoot, twoSizes } from "./helpers";

const noWebGpu = () => Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined, configurable: true });

async function openTvWithoutWebGpu(browser: Browser): Promise<Page> {
  const tv = await openLibrary(browser, (context) => context.addInitScript(noWebGpu));
  await pressMenuLine(tv, "rail-connect");
  return tv;
}

const oneFile = (title: string, query = ""): NormalizedMedia => ({ title, stream: { url: `/fixtures/sample.mp4${query}`, type: "mp4" } });

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
    await pausedAt(tv, 5);
    const source = await tv.evaluate(() => document.querySelector("video")!.currentSrc);

    const button = tv.getByTestId("tv-quality-btn");
    await expect(button).toHaveText("✦ Off");
    await button.click();
    const menu = tv.getByTestId("audio-subtitles-modal");
    await expect(menu).toHaveAttribute("data-kind", "quality");
    await expect(menu.locator(".tv-opt-heading")).toHaveText("✦ Enhanced by this device");
    await expect(menu.getByRole("option")).toHaveText(["✦ Off", "✦ 2K"]);
    await expect(menu.locator("[data-key='enhance-off']")).toHaveAttribute("data-active", "true");
    await menu.locator("[data-key='enhance-2k']").click();

    const canvas = tv.getByTestId("tv-enhance");
    await expect(canvas).toHaveAttribute("data-drawn", "true");
    await expect(canvas).toHaveAttribute("data-tier", "sharp");
    expect(await canvas.evaluate((drawn: HTMLCanvasElement) => [drawn.width, drawn.height])).toEqual([2560, 1440]);
    expect(await canvasBrightness(tv)).toBeGreaterThan(10);
    await expect(button).toHaveText("✦ 2K");
    await expect(phone.getByTestId("chip-quality")).toContainText("✦ 2K");
    await expect.poll(() => toasts).toContain("✦ 2K on · FSR 1");

    expect(await tv.evaluate(() => document.querySelector("video")!.currentSrc)).toBe(source);
    expect(await canvas.evaluate((drawn) => getComputedStyle(drawn).pointerEvents)).toBe("none");
    await phone.getByTestId("play").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await expect.poll(() => tv.evaluate(() => document.querySelector("video")!.currentTime), { timeout: 10_000 }).toBeGreaterThan(6);

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

    await loadOnTv(phone, oneFile("Second", "?film=2"));
    await expect.poll(() => tv.evaluate(() => document.querySelector("video")!.currentSrc)).toContain("film=2");
    await pausedAt(tv, 5);
    await expect(tv.getByTestId("tv-enhance")).toHaveAttribute("data-drawn", "true");
    await expect(tv.getByTestId("tv-quality-btn")).toHaveText("✦ 2K");

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
    expect(await tv.evaluate(() => localStorage.getItem("kino.enhance"))).toBe("2k");
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
    expect(await tv.evaluate(() => document.querySelector("video")!.currentSrc)).toContain("q=1080");
    await expect(phone.getByTestId("quality-1000")).toHaveAttribute("aria-selected", "true");
  });

  test("a file the page may not read (from another site that does not allow it) is not offered it: its Quality button is not there", async ({ browser, baseURL }) => {
    const tv = await openTvWithoutWebGpu(browser);
    const phone = await openPairedPhone(browser, tv);
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
    await expect.poll(() => phone.states.at(-1)?.enhance?.offers).toEqual(["2k"]);

    phone.cmd({ type: "SET_ENHANCE", mode: "2k" });
    const canvas = tv.getByTestId("tv-enhance");
    await expect(canvas).toHaveAttribute("data-drawn", "true");
    await expect.poll(() => phone.states.at(-1)?.enhance).toEqual({ offers: ["2k"], current: "2k", tier: "sharp" });

    phone.cmd({ type: "PLAY" });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    const before = await tv.evaluate(() => document.querySelector("video")!.currentTime);
    phone.cmd({ type: "SET_QUALITY", level: 1 });
    await expect.poll(() => phone.states.at(-1)?.quality?.current).toBe(1);
    await expect.poll(() => tv.evaluate(() => document.querySelector("video")!.currentTime), { timeout: 10_000 }).toBeGreaterThan(before + 1.5);
    await expect(canvas).toHaveAttribute("data-drawn", "true");
    expect(await canvas.evaluate((drawn: HTMLCanvasElement) => [drawn.width, drawn.height])).toEqual([2560, 1440]);
    expect(phone.states.at(-1)?.enhance).toEqual({ offers: ["2k"], current: "2k", tier: "sharp" });
    phone.close();
  });
});
