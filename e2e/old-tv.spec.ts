import { chromium, expect, type Page } from "@playwright/test";
import { test, withLibrary } from "./helpers";

const CHROME94 = process.env.CHROME94;
const films = [
  { id: "filmpire-movie-603", title: "The Matrix", year: 1999, kind: "movie", url: "/fixtures/sample.mp4?n=1" },
  { id: "hls-1", title: "A stream", year: 2001, kind: "movie", url: "/fixtures/hls/master.m3u8" },
];
const withFilms = withLibrary({ updatedAt: Date.now(), rows: [{ id: "r1", title: "Classics", source: "Test Source", kind: "movie", items: films }] });
const TIZEN7 = "Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) 94.0.4606.31/7.0 TV Safari/537.36";

const count = (page: Page, testId: string) => page.evaluate((id) => document.querySelectorAll(`[data-testid="${id}"]`).length, testId);
const state = (page: Page) => page.evaluate(() => document.querySelector('[data-testid="tv"]')?.getAttribute("data-state") ?? "");
async function press(page: Page, testId: string, nth = 0) {
  const box = await page.evaluate(
    ([id, n]) => {
      const element = document.querySelectorAll(`[data-testid="${id}"]`)[n as number] as HTMLElement | undefined;
      if (!element) return null;
      element.scrollIntoView({ block: "center" });
      const r = element.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    [testId, nth] as const,
  );
  if (!box) throw new Error(`no ${testId}`);
  await page.mouse.click(box.x, box.y);
}

test("the site in Chromium 94: library, a title's page, an MP4 film and an HLS stream play, with no page errors", async ({ baseURL }) => {
  test.skip(!CHROME94, "CHROME94 names no Chromium 94 (see the top of this file)");
  test.setTimeout(120_000);
  const old = await chromium.launch({ executablePath: CHROME94, args: ["--autoplay-policy=no-user-gesture-required"] });
  expect(old.version()).toMatch(/^94\./);
  const context = await old.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: TIZEN7,
    baseURL,
    storageState: { cookies: [], origins: [{ origin: baseURL!, localStorage: [{ name: "kino.fullscreen.left", value: "1" }, { name: "kino.fit", value: "couch" }] }] },
  });
  await withFilms(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => message.type() === "error" && errors.push(`console: ${message.text()}`));
  try {
    await page.goto("/tv");
    await expect.poll(() => count(page, "tv-browse-tile"), { timeout: 20_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(800);
    await page.keyboard.press("Enter");
    await expect.poll(() => count(page, "tv-detail")).toBe(1);
    await page.waitForTimeout(800);
    await press(page, "tv-detail-play");
    await expect.poll(() => state(page), { timeout: 20_000 }).toBe("playing");
    await page.waitForTimeout(1_500);
    await page.keyboard.press("Escape");
    await expect.poll(() => state(page), { timeout: 10_000 }).toBe("idle");
    await expect.poll(() => count(page, "tv-browse-tile")).toBeGreaterThan(1);
    await page.waitForTimeout(800);
    await press(page, "tv-browse-tile", 1);
    await expect.poll(() => count(page, "tv-detail")).toBe(1);
    await page.waitForTimeout(800);
    await press(page, "tv-detail-play");
    await expect.poll(() => state(page), { timeout: 20_000 }).toBe("playing");
    await page.waitForTimeout(1_500);
    expect(errors).toEqual([]);
  } finally {
    await old.close();
  }
});
