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

  test("draws films with FSRCNNX: fetches its shader file once, as served (LGPL, unchanged), and draws the picture the right way up", async ({ page, baseURL }) => {
    const asked = await openSample(page);
    await page.getByTestId("upscale-mode-film").check();
    await expect(page.getByTestId("upscale-size")).toContainText("FSRCNNX redraws its brightness at 640 × 360, then that is fitted to 1280 × 720 (bicubic)");
    const film = await probe(page, "film");
    expect(film.problem).toBeUndefined();
    expect({ width: film.width, height: film.height }).toEqual({ width: 1280, height: 720 });
    expect(film.brightness).toBeGreaterThan(10);
    expect(film.difference).toBeLessThan(15); // (a network upside down, or its sub-pixels swapped, garbles the picture far more)
    expect(asked.filter((url) => url.includes("/fsrcnnx/"))).toEqual([`${baseURL}/labs/upscale/fsrcnnx/FSRCNNX_x2_8-0-4-1.glsl`]);
    // The file the page runs is the one released (its hash is in the README next to it).
    const shader = await (await page.request.get("/labs/upscale/fsrcnnx/FSRCNNX_x2_8-0-4-1.glsl")).body();
    const { createHash } = await import("node:crypto");
    expect(createHash("sha256").update(shader).digest("hex")).toBe("e800dbc5c1c95185cc82216c597724533ff5f2880179f256eef600f03e8dc2ae");
    await expect(page.locator("footer a[href='/labs/upscale/fsrcnnx/README.txt']")).toHaveText("LGPL 3.0");
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

  test("the frame boost makes the frame between two: RIFE draws a moving square where it is at that moment, Blend shows it faintly in both places", async ({ page, baseURL }) => {
    test.setTimeout(120_000); // (RIFE on the processor here: a few seconds a frame)
    // (`rifeEp=wasm`: RIFE on the processor, as the browser of these tests may have no WebGPU; the same network and the same answer, only slower.)
    const asked = await openSample(page, "/labs/upscale/?rifeEp=wasm");
    const seen = await page.evaluate(async () => {
      const lab = (window as unknown as { kinoUpscaleLab: { interpolate: (a: string, b: string, t: number, how: string) => Promise<string> } }).kinoUpscaleLab;
      // Pictures of a white square moved to the right, on a background of grey blocks that stands still.
      const picture = (x: number, side: number): string => {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        const context = canvas.getContext("2d")!;
        let seed = 7;
        for (let by = 0; by < 180; by += 4) {
          for (let bx = 0; bx < 320; bx += 4) {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            const grey = 40 + (seed % 60);
            context.fillStyle = `rgb(${grey}, ${grey}, ${grey})`;
            context.fillRect(bx, by, 4, 4);
          }
        }
        context.fillStyle = "#fff";
        context.fillRect(x, 90 - side / 2, side, side);
        return canvas.toDataURL("image/png");
      };
      const read = async (address: string): Promise<(x: number, y: number) => number> => {
        const image = await createImageBitmap(await (await fetch(address)).blob());
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return (x, y) => context.getImageData(x, y, 1, 1).data[0]!;
      };
      const at = async (pair: string[], t: number, how: string, xs: number[]): Promise<number[]> => {
        const made = await read(await lab.interpolate(pair[0]!, pair[1]!, t, how));
        return xs.map((x) => made(x, 90));
      };
      // A big square (48 pixels) moved 24 pixels: it overlaps itself. Seen at x = 80 (where only the first had it), 112 (both), 128 and 144 (the second only).
      const big = [picture(80, 48), picture(104, 48)];
      const bigAt = [80, 112, 128, 144];
      // A small square (24 pixels) moved 40: farther than its own size, the hard case. Seen at 92 (its middle before), 112 (half way) and 132 (after).
      const small = [picture(80, 24), picture(120, 24)];
      const smallAt = [92, 112, 132];
      return {
        bigHalf: await at(big, 0.5, "rife", bigAt),
        bigQuarter: await at(big, 0.25, "rife", bigAt),
        blendHalf: await at(big, 0.5, "blend", bigAt),
        ends: await at(big, 1, "rife", bigAt),
        smallHalf: await at(small, 0.5, "rife", smallAt),
      };
    });
    // RIFE: the square is where it is at that moment (92 to 140 half way, 86 to 134 a quarter of the way); the background shows where it left.
    expect(seen.bigHalf[0]).toBeLessThan(120);
    expect(seen.bigHalf[1]).toBeGreaterThan(220);
    expect(seen.bigHalf[2]).toBeGreaterThan(220);
    expect(seen.bigHalf[3]).toBeLessThan(120);
    expect(seen.bigQuarter[0]).toBeLessThan(120);
    expect(seen.bigQuarter[1]).toBeGreaterThan(220);
    expect(seen.bigQuarter[3]).toBeLessThan(120);
    // The small fast square is half way too (not lost, not left behind).
    expect(seen.smallHalf[0]).toBeLessThan(120);
    expect(seen.smallHalf[1]).toBeGreaterThan(220);
    expect(seen.smallHalf[2]).toBeLessThan(120);
    // Blend: half of the square where only one picture had it, white where both did.
    for (const where of [0, 2, 3]) expect(seen.blendHalf[where]).toBeGreaterThan(130), expect(seen.blendHalf[where]).toBeLessThan(200);
    expect(seen.blendHalf[1]).toBeGreaterThan(220);
    // At 1, the second picture as it is.
    expect(seen.ends[3]).toBe(255);
    // The network is the site's own file (MIT, its hash in the README next to it), and ONNX Runtime comes with the page: nothing from elsewhere.
    expect(asked.filter((url) => url.endsWith(".onnx"))).toEqual([`${baseURL}/labs/upscale/rife/rife-v4.25-lite.onnx`]);
    const elsewhere = asked.filter((url) => !url.startsWith(baseURL!) && !url.startsWith("blob:") && !url.startsWith("data:"));
    expect(elsewhere).toEqual([]);
    const network = await (await page.request.get("/labs/upscale/rife/rife-v4.25-lite.onnx")).body();
    const { createHash } = await import("node:crypto");
    expect(createHash("sha256").update(network).digest("hex")).toBe("702802d0862ab78f2d72133c6bc3768e7e89b81756f7cd51d1055a2fe3d06577");
  });

  test("with the frame boost at 60, plays on the screen's rhythm, says what it does, and is timed against 60 frames a second", async ({ page }) => {
    await openSample(page, "/labs/upscale/?seconds=2");
    // (Blend: the browser of these tests may have no WebGPU for RIFE; RIFE's live boost is checked by hand on a graphics card.)
    await page.getByTestId("upscale-boost-how").selectOption("blend");
    await page.getByTestId("upscale-boost").selectOption("60");
    await expect(page.getByTestId("upscale-boost-info")).toBeVisible();
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByTestId("upscale-boost-info")).toContainText("frames a second made into 60, by Blend", { timeout: 10_000 });
    await expect(page.getByTestId("upscale-boost-info")).toContainText(/Now: \d+ new frames a second/);
    await expect(page.locator(".stage.boosted")).toHaveCount(1); // (the left side is the video's own frame of the moment shown)
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByTestId("upscale-test-one").click();
    const row = page.getByTestId("upscale-result-sharp-60-blend");
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(row).toContainText("Sharp (FSR 1) + 60 fps (Blend)");
    await expect(row).toContainText(/frames shown in time, at [\d.]+ new frames a second \(screen: \d+ Hz\)|not played: too slow to try/);
    await expect(page.getByTestId("upscale-verdict-sharp-60-blend")).toHaveText(/^(Smooth|Tight|Too slow)$/);
    // Off again: the video as it is, on the left too.
    await page.getByTestId("upscale-boost").selectOption("0");
    await expect(page.getByTestId("upscale-boost-info")).toBeHidden();
    await expect(page.locator(".stage.boosted")).toHaveCount(0);
  });

  test("where the browser has no WebGPU, says so, keeps the Anime modes and RIFE off, and tests the others", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined, configurable: true }));
    await openSample(page, "/labs/upscale/?seconds=1");
    await expect(page.getByTestId("upscale-gpu")).toContainText("No. This browser has no WebGPU");
    for (const mode of ["anime-fast", "anime-quality"]) await expect(page.getByTestId(`upscale-mode-${mode}`)).toBeDisabled();
    expect(await probe(page, "anime-fast")).toEqual({ problem: "This browser has no WebGPU (recent Chrome or Edge on a computer have it)." });
    // The frame boost's frames are made by Blend then: RIFE says why it is not there.
    await expect(page.getByTestId("upscale-boost-how")).toHaveValue("blend");
    expect(await page.locator("#boost-how option[value='rife']").evaluate((option: HTMLOptionElement) => option.disabled)).toBe(true); // (toBeDisabled does not read an option's)
    await expect(page.locator("#boost-how option[value='rife']")).toContainText("(not here:");

    await page.getByTestId("upscale-test-all").click();
    await expect(page.getByTestId("upscale-status")).toHaveText("Done.", { timeout: 60_000 });
    await expect(page.getByTestId("upscale-result-off")).toBeVisible();
    await expect(page.getByTestId("upscale-result-sharp")).toBeVisible();
    await expect(page.getByTestId("upscale-result-anime-fast")).toHaveCount(0);
    await expect(page.getByTestId("upscale-summary")).toHaveText(/^On this computer at 720p: for any video, /);
    await expect(page.getByTestId("upscale-summary")).not.toContainText("anime");
  });
});
