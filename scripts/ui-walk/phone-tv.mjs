// A phone used as the screen: the page the TV shows (/tv, ?role=tv, a party link), on a phone, touched with a finger. Pictures go to screen-<size>/
// (the remote's pictures are phone-<size>/, see phone.mjs). Every step is a tap: no key, no hover, no click without a finger.
import { chromium, base, wait, PHONE, phoneName, openContext, step, snap, movies, series, log } from "./lib.mjs";
import { seed } from "./seed.mjs";

const device = phoneName.replace("phone", "screen");
const title = (page, name) => page.locator(`.tv-tile[title="${name}"]`).first();

const browser = await chromium.launch();
const context = await openContext(browser, PHONE, { phone: true, seed });
const page = await context.newPage();
await page.goto("/tv");
await page.getByTestId("tv-browse").waitFor();
await page.getByTestId("tv-welcome").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {}); // (the greeting, which goes by itself)
await wait(900); // (the pictures)

/** Scrolls what a finger would scroll: the page itself, or the box under the middle of the screen that scrolls. */
const scrollDown = (page, fraction = 0.8) =>
  page.evaluate((f) => {
    const scrolls = (node) => /(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 4;
    let node = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    while (node && node !== document.documentElement && !scrolls(node)) node = node.parentElement;
    (node && node !== document.documentElement ? node : document.scrollingElement).scrollBy(0, innerHeight * f);
  }, fraction);

await step(device, "s01-home", () => snap(page, device, "s01-home"));
await step(device, "s02-home-scrolled", async () => {
  await scrollDown(page);
  await wait(400);
  await snap(page, device, "s02-home-scrolled");
  await scrollDown(page, -2);
});
await step(device, "s03-section", async () => {
  // (a tap on a rail icon goes straight to its page: the labels only show on focus, which a finger never gives)
  await page.getByTestId("rail-movies").tap();
  await wait(700);
  await snap(page, device, "s03-section-movies");
});
await step(device, "s04-search", async () => {
  await page.getByTestId("rail-search").tap();
  await wait(700);
  await snap(page, device, "s04-search");
});
await step(device, "s05-detail-movie", async () => {
  await page.getByTestId("rail-home").tap();
  await wait(500);
  await title(page, movies[1].title).tap();
  await page.getByTestId("tv-detail").waitFor();
  await snap(page, device, "s05-detail-movie");
});
await step(device, "s06-detail-series", async () => {
  await page.keyboard.press("Escape");
  await title(page, series[1].title).tap();
  await page.getByTestId("tv-detail").waitFor();
  await page.getByTestId("tv-episodes").waitFor();
  await snap(page, device, "s06-detail-series", { settle: 900 });
  await scrollDown(page);
  await snap(page, device, "s07-detail-series-episodes", { settle: 700 });
  await page.keyboard.press("Escape");
});
await step(device, "s08-profile", async () => {
  await page.getByTestId("tv-account-chip").tap();
  await page.getByTestId("tv-browse").and(page.locator('[data-view="profile"]')).waitFor();
  await snap(page, device, "s08-profile");
});
await step(device, "s09-player", async () => {
  await page.keyboard.press("Escape");
  await page.getByTestId("rail-home").tap().catch(() => {});
  await title(page, movies[1].title).tap();
  await page.getByTestId("tv-detail-play").tap();
  await page.locator('[data-testid="tv"][data-state="playing"]').waitFor({ timeout: 20_000 });
  await wait(1500);
  await page.touchscreen.tap(PHONE.width / 2, PHONE.height / 2);
  await page.locator('[data-testid="tv"][data-hud="visible"]').waitFor();
  await snap(page, device, "s09-player-hud", { settle: 700 });
});
await step(device, "s10-player-menu", async () => {
  await page.getByTestId("tv-speed-btn").tap();
  await page.getByTestId("audio-subtitles-modal").waitFor();
  await snap(page, device, "s10-player-audio-menu");
  await page.keyboard.press("Escape");
});

await context.close();
await browser.close();
console.log(log.filter((line) => line.startsWith("FAIL")).length + " failed of " + log.length);
