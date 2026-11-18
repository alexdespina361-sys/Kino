import { chromium, base, wait, PHONE, phoneName, openContext, step, snap, movies, series, log } from "./lib.mjs";
import { seed } from "./seed.mjs";

const device = phoneName.replace("phone", "screen");
const title = (page, name) => page.locator(`.tv-tile[title="${name}"]`).first();

const browser = await chromium.launch();
const context = await openContext(browser, PHONE, { phone: true, seed });
const page = await context.newPage();
await page.goto("/tv");
await page.getByTestId("tv-browse").waitFor();
await page.getByTestId("tv-welcome").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
await wait(900);

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
const tapFirst = async (...ids) => {
  for (const id of ids) {
    const element = page.getByTestId(id);
    if ((await element.count()) > 0) return element.first().tap();
  }
  throw new Error("none of " + ids.join(", ") + " is on the screen");
};

await step(device, "s03-section", async () => {
  await tapFirst("section-movies", "rail-movies");
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

const leave = async () => {
  await page.keyboard.press("Escape");
  await wait(300);
};
const reload = async () => {
  await page.goto("/tv");
  await page.getByTestId("tv-browse").waitFor();
  await page.getByTestId("tv-welcome").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
  await wait(700);
};
await step(device, "s11-categories-and-lists", async () => {
  await reload();
  await tapFirst("rail-categories");
  await wait(600);
  await snap(page, device, "s11-categories");
  await tapFirst("rail-list");
  await wait(600);
  await snap(page, device, "s12-my-lists");
});
await step(device, "s13-profile-pages", async () => {
  await tapFirst("tv-account-chip");
  await page.getByTestId("tv-browse").and(page.locator('[data-view="profile"]')).waitFor();
  await tapFirst("tv-profile-settings");
  await wait(700);
  await snap(page, device, "s13-settings");
  await leave();
  await tapFirst("rail-party");
  await wait(700);
  await snap(page, device, "s14-party");
  await leave();
  await tapFirst("tv-profile-signin");
  await wait(700);
  await snap(page, device, "s16-sign-in");
  await leave();
  await tapFirst("rail-connect");
  await wait(700);
  await snap(page, device, "s15-use-as-remote");
});
await step(device, "s17-player-fullest", async () => {
  const tvContext = await openContext(browser, PHONE, { seed });
  const tv = await tvContext.newPage();
  try {
    await tv.goto("/tv");
    await tv.getByTestId("tv-browse").waitFor();
    await tv.getByTestId("tv-welcome").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
    await tv.getByTestId("tv-account-chip").click();
    await tv.getByTestId("rail-connect").click();
    await snap(tv, device, "s21-pairing-screen", { settle: 500 });
    const code = ((await tv.getByTestId("pairing-code").textContent()) ?? "").replace(/\s/g, "");
    const socket = new WebSocket(base.replace("http", "ws") + "/ws");
    await new Promise((resolve) => (socket.onopen = resolve));
    socket.send(JSON.stringify({ type: "CTL_HELLO" }));
    socket.send(JSON.stringify({ type: "PAIR", code }));
    await wait(600);
    const episode = (n, title) => ({ season: 1, episode: n, title, url: `${base}/fixtures/pages/video.html?e=${n}` });
    const media = {
      title: "The Long Night · S1 E2",
      stream: { url: "/fixtures/sample.mp4", type: "mp4" },
      alternates: [{ label: "Mirror server", stream: { url: "/fixtures/sample.mp4?b=1", type: "mp4" } }],
      subtitles: [
        { id: "en", label: "English", lang: "en", url: "/fixtures/sample.vtt" },
        { id: "nl", label: "Dutch", lang: "nl", url: "/fixtures/sample.vtt" },
      ],
      series: {
        season: 1,
        episode: 2,
        episodes: [episode(1, "A Very Long Name For A Pilot Episode Indeed"), episode(2, "The Long Night"), episode(3, "The Even Longer Title Of The Following Episode")],
        next: episode(3, "The Even Longer Title Of The Following Episode"),
      },
    };
    socket.send(JSON.stringify({ type: "CMD", command: { type: "LOAD", media } }));
    await tv.locator('[data-testid="tv"][data-state="paused"]').waitFor({ timeout: 20_000 });
    await snap(tv, device, "s17-player-fullest-paused", { settle: 700 });
    await tv.getByTestId("tv-episodes-btn").click();
    await tv.getByTestId("audio-subtitles-modal").waitFor();
    await snap(tv, device, "s18-player-episodes-menu", { settle: 700 });
    await tv.keyboard.press("Escape");
    await tv.getByTestId("tv-audio-sub-btn").click();
    await tv.getByTestId("audio-subtitles-modal").waitFor();
    await snap(tv, device, "s19-player-tracks-menu", { settle: 700 });
    await tv.keyboard.press("Escape");
    await tv.getByTestId("tv-party-btn").click();
    await tv.getByTestId("tv-party-panel").waitFor();
    await snap(tv, device, "s20-player-party-menu", { settle: 700 });
    await tv.keyboard.press("Escape");
    socket.send(JSON.stringify({ type: "CMD", command: { type: "SEEK", time: 27 } }));
    socket.send(JSON.stringify({ type: "CMD", command: { type: "PLAY" } }));
    await tv.getByTestId("netflix-upnext").waitFor({ timeout: 15_000 });
    await snap(tv, device, "s22-player-up-next", { settle: 200 });
    socket.close();
  } finally {
    await tvContext.close();
  }
});

await context.close();
await browser.close();
console.log(log.filter((line) => line.startsWith("FAIL")).length + " failed of " + log.length);
