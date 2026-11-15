import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Kino Labs' upscaler test (labs/upscale/index.html): a video file picked on this computer is drawn bigger with Off and Sharp (FSR 1, WebGL 2), timed,
 * and judged. The Anime modes need WebGPU, which the browser of these tests may not have: here they must say so and stay out of the way. (Whether they
 * draw right is checked by hand in a browser that has WebGPU, with `kinoUpscaleLab.probe("anime-fast")`.)
 */
const SAMPLE = path.resolve(import.meta.dirname, "../fixtures/sample.mp4"); // (320 x 180, 15 fps, 30 s)

interface Probe {
  mode: string;
  width: number;
  height: number;
  difference: number;
  brightness: number;
  problem?: string;
}
const probe = (page: Page, mode: string) => page.evaluate((wanted) => (window as unknown as { kinoUpscaleLab: { probe: (mode: string) => Promise<Probe> } }).kinoUpscaleLab.probe(wanted), mode);

async function openSample(page: Page, address = "/labs/upscale/"): Promise<string[]> {
  const asked: string[] = [];
  page.on("request", (request) => asked.push(request.url()));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(address);
  await expect(page.getByRole("heading", { name: "Upscaler test" })).toBeVisible();
  await page.getByTestId("upscale-file").setInputFiles(SAMPLE);
  await expect(page.getByTestId("upscale-size")).toContainText("The video is 320 × 180; it is drawn at 1280 × 720 (4 times as big).");
  await page.waitForFunction(() => (document.querySelector("video")?.readyState ?? 0) >= 2);
  // (Five seconds in: the first frame of a video is often black.)
  await page.evaluate(() => {
    const video = document.querySelector("video")!;
    video.currentTime = 5;
    return new Promise((done) => video.addEventListener("seeked", done, { once: true }));
  });
  expect(errors).toEqual([]);
  return asked;
}

test.describe("Kino Labs: the upscaler test page", () => {
  test("draws a file picked on this computer at 720p, plainly and with FSR 1, the right way up, and asks the server for nothing but its own code", async ({ page, baseURL }) => {
    const asked = await openSample(page, "/labs/upscale"); // (without the last slash: sent on to the page)
    await expect(page).toHaveURL(/\/labs\/upscale\/$/);
    await expect(page.getByTestId("upscale-gl")).toContainText("Yes");

    const plain = await probe(page, "off");
    const sharp = await probe(page, "sharp");
    for (const drawn of [plain, sharp]) {
      expect(drawn.problem).toBeUndefined();
      expect({ width: drawn.width, height: drawn.height }).toEqual({ width: 1280, height: 720 });
      expect(drawn.brightness).toBeGreaterThan(10); // (a picture, not a black canvas)
    }
    // Drawn as the browser draws the same frame, give or take: sharper edges move it a little, a picture upside down or garbled a lot.
    expect(plain.difference).toBeLessThan(6);
    expect(sharp.difference).toBeLessThan(15);
    expect(sharp.difference).toBeGreaterThan(plain.difference); // (and FSR does change the picture)

    // The film is played from this computer: every request is the page's own (or the file's blob: address).
    const elsewhere = asked.filter((url) => !url.startsWith(baseURL!) && !url.startsWith("blob:") && !url.startsWith("data:"));
    expect(elsewhere).toEqual([]);
  });

  test("plays one of its own free clips for whoever has no video file at hand, and draws it at 720p", async ({ page, baseURL }) => {
    const asked: string[] = [];
    page.on("request", (request) => asked.push(request.url()));
    await page.goto("/labs/upscale/");
    await expect(page.getByText("Sintel, © Blender Foundation")).toBeVisible(); // (CC BY: the credit is on the page)
    await page.getByTestId("upscale-sample-sintel").click();
    await expect(page.getByTestId("upscale-size")).toContainText("The video is 854 × 480; it is drawn at 1280 × 720 (1.5 times as big).", { timeout: 15_000 });
    await expect(page.locator("#file-name")).toHaveText("sintel-480p-45s.mp4 (3.7 MB, a free clip of this page)");
    await page.waitForFunction(() => (document.querySelector("video")?.readyState ?? 0) >= 2);
    const sharp = await probe(page, "sharp");
    expect({ width: sharp.width, height: sharp.height }).toEqual({ width: 1280, height: 720 });
    expect(sharp.difference).toBeLessThan(15);
    expect(asked.filter((url) => url.includes("/labs/upscale/clips/"))).toEqual([`${baseURL}/labs/upscale/clips/sintel-480p-45s.mp4`]);

    await page.getByTestId("upscale-sample-tears").click();
    await expect(page.getByTestId("upscale-size")).toContainText("The video is 854 × 356; it is drawn at 1280 × 534", { timeout: 15_000 });
  });

  test("draws at 2K and 4K too, says when the page shows the picture smaller than it is drawn, and lets the line between the two follow the mouse", async ({ page }) => {
    await openSample(page);
    await page.getByTestId("upscale-target").selectOption("1440");
    await expect(page.getByTestId("upscale-size")).toContainText("The video is 320 × 180; it is drawn at 2560 × 1440 (8 times as big).");
    // (The page's column is about 1000 pixels wide: a 2K picture is shrunk to it, and the page says so.)
    await expect(page.getByTestId("upscale-shown")).toContainText(/^Shown at \d+ × \d+ screen pixels now: smaller than it is drawn/);
    const sharp = await probe(page, "sharp");
    expect({ width: sharp.width, height: sharp.height }).toEqual({ width: 2560, height: 1440 });
    expect(sharp.difference).toBeLessThan(15);
    await page.getByTestId("upscale-target").selectOption("2160");
    await expect(page.getByTestId("upscale-size")).toContainText("it is drawn at 3840 × 2160 (12 times as big).");

    // The line follows the mouse: a quarter of the way across the picture puts it at 25%, and the slider with it.
    const stage = page.locator("#stage");
    const box = (await stage.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
    await expect(stage).toHaveAttribute("style", /--split: 25%/);
    await expect(page.locator("#compare")).toHaveValue("25");
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 4 });
    await expect(page.locator("#compare")).toHaveValue("80");
    // The slider still moves it by hand.
    await page.locator("#compare").fill("40");
    await expect(stage).toHaveAttribute("style", /--split: 40%/);

    // Full screen shows the picture as big as the screen allows, and keys choose the modes.
    await page.getByTestId("upscale-fullscreen").click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe("stage-scroll");
    await page.keyboard.press("1");
    await expect(page.getByTestId("upscale-mode-off")).toBeChecked();
    await expect(page.locator("#split-mode")).toHaveText("Off");
    await page.keyboard.press("2");
    await expect(page.getByTestId("upscale-mode-sharp")).toBeChecked();
    await expect(page.locator("#split-mode")).toHaveText("Sharp (FSR 1)");
    await page.keyboard.press("f");
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  });

  test("times the chosen mode, plays it through, and says whether this computer keeps up", async ({ page }) => {
    await openSample(page, "/labs/upscale/?seconds=1");
    await expect(page.getByTestId("upscale-mode-sharp")).toBeChecked();
    await page.getByTestId("upscale-test-one").click();
    const row = page.getByTestId("upscale-result-sharp");
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(/\d+(\.\d)? ms \(9 in 10 under \d+(\.\d)? ms\)/);
    await expect(row).toContainText(/(\d+ of \d+ frames drawn.* at 15 fps)|not played: too slow to try/);
    await expect(page.getByTestId("upscale-verdict-sharp")).toHaveText(/^(Smooth|Tight|Too slow)$/);
    await expect(page.getByTestId("upscale-status")).toHaveText("Done.");
    await expect(page.getByTestId("upscale-test-one")).toBeEnabled();
  });

  test("where the browser has no WebGPU, says so, keeps the Anime modes off, and tests the others", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined, configurable: true }));
    await openSample(page, "/labs/upscale/?seconds=1");
    await expect(page.getByTestId("upscale-gpu")).toContainText("No. This browser has no WebGPU");
    for (const mode of ["anime-fast", "anime-quality"]) await expect(page.getByTestId(`upscale-mode-${mode}`)).toBeDisabled();
    expect(await probe(page, "anime-fast")).toEqual({ problem: "This browser has no WebGPU (recent Chrome or Edge on a computer have it)." });

    await page.getByTestId("upscale-test-all").click();
    await expect(page.getByTestId("upscale-status")).toHaveText("Done.", { timeout: 60_000 });
    await expect(page.getByTestId("upscale-result-off")).toBeVisible();
    await expect(page.getByTestId("upscale-result-sharp")).toBeVisible();
    await expect(page.getByTestId("upscale-result-anime-fast")).toHaveCount(0);
    await expect(page.getByTestId("upscale-summary")).toHaveText(/^On this computer at 720p: for any video, /);
    await expect(page.getByTestId("upscale-summary")).not.toContainText("anime");
  });
});
