// The TV as a guest (signed out): 1280x720 (every screen) and the other sizes (the main ones). Parts: welcome, hd, full, qhd, desktop, laptop.
import { chromium, base, wait, HD, FULL_HD, QHD, DESKTOP, LAPTOP, openContext, guestData, step, snap, pointerAway, movies, series, log } from "./lib.mjs";

const at = Date.now();
const day = (n) => at - n * 86_400_000;
const watch = (i) => `https://films.example/watch/${i}`;
const card = (i) => ({ title: movies[i].title, url: watch(i), image: movies[i].image, backdrop: movies[i].backdrop, year: movies[i].year });
const progress = (i, position, duration, extra = {}) => ({ key: `url:${watch(i)}`, at: at - (i + 1) * 600_000, position, duration, ...card(i), ...extra });
const saved = (i, list) => ({ key: list ? `${list}|url:${watch(i)}` : `url:${watch(i)}`, at: day(i % 5), ...(list ? { list } : {}), id: movies[i].id, description: movies[i].description, ...card(i) });
const rated = (i, score, note) => ({ key: `rate:${watch(i)}`, at: day(i % 6), kind: "movie", score, ratedAt: day(i % 6), ...(note ? { note } : {}), ...card(i) });

/** A guest who has been using the TV for a while: things to continue, a favourites list and two of its own, some ratings, a few finished films. */
const seed = guestData({
  progress: [
    progress(5, 2700, 6600),
    progress(7, 5000, 6000),
    progress(9, 600, 7200),
    { key: "show:The Long Night", at: at - 7_200_000, title: series[0].title, url: `${base}/fixtures/pages/video.html?s=1&e=3`, image: series[0].image, backdrop: series[0].backdrop, year: series[0].year, position: 900, duration: 2400, season: 1, episode: 3 },
    progress(13, 6100, 6200, { done: true }),
    progress(15, 5400, 5400, { done: true }),
    progress(16, 7000, 7000, { done: true }),
    progress(17, 5900, 6000, { done: true }),
  ],
  list: [6, 8, 10, 12, 18].map((i) => saved(i)).concat([14, 19].map((i) => saved(i, "lweekend"))),
  listNames: [
    { key: "lweekend", at: day(3), name: "Weekend" },
    { key: "lclassics", at: day(2), name: "Classics" },
  ],
  ratings: [rated(11, 9, "Quiet, funny, and kinder than it looks."), rated(12, 7), rated(13, 8, "The ending lands."), rated(14, 10), rated(15, 6)],
});

const tiles = (page) => page.getByTestId("tv-browse-tile");
const press = async (page, key, times = 1) => {
  for (let n = 0; n < times; n++) {
    await page.keyboard.press(key);
    await wait(120);
  }
};
const title = (page, name) => page.locator(`.tv-tile[title="${name}"]`).first();

async function openTv(browser, viewport, options = {}) {
  const context = await openContext(browser, viewport, { seed, ...options });
  const page = await context.newPage();
  await page.goto("/tv");
  await page.getByTestId("tv-browse").waitFor();
  await page.getByTestId("tv-welcome").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {}); // (the greeting, which goes by itself)
  await wait(900); // (the pictures)
  return { context, page };
}

/** The main screens, at one size. `deep` also takes the quieter ones (the lists, the ratings, each form). */
async function guestTv(browser, viewport, device, deep) {
  const { context, page } = await openTv(browser, viewport);
  const away = () => pointerAway(page, viewport);
  await away();

  await step(device, "02-home", () => snap(page, device, "02-home"));
  await step(device, "03-home-scrolled", async () => {
    await press(page, "ArrowDown", 2);
    await snap(page, device, "03-home-scrolled");
    await press(page, "ArrowUp", 2);
  });
  await step(device, "04-rail-open", async () => {
    await press(page, "ArrowLeft");
    await page.getByTestId("tv-rail").waitFor();
    await snap(page, device, "04-rail-open");
    await press(page, "ArrowRight");
  });

  if (deep) {
    await step(device, "05-movies", async () => {
      await page.getByTestId("rail-movies").click();
      await away();
      await snap(page, device, "05-movies");
    });
    await step(device, "06-series", async () => {
      await page.getByTestId("rail-series").click();
      await away();
      await snap(page, device, "06-series");
    });
    await step(device, "07-categories", async () => {
      await page.getByTestId("rail-categories").click();
      await away();
      await snap(page, device, "07-categories");
    });
    await step(device, "08-search", async () => {
      await page.getByTestId("rail-search").click();
      await page.keyboard.type("har");
      await wait(900);
      await away();
      await snap(page, device, "08-search");
    });
    await step(device, "09-lists", async () => {
      await page.getByTestId("rail-list").click();
      await away();
      await snap(page, device, "09-lists-favourites");
    });
    await step(device, "10-list-weekend", async () => {
      await page.locator('[data-testid^="list-chip-l"]').first().click();
      await away();
      await snap(page, device, "10-list-weekend");
    });
    await page.getByTestId("rail-home").click();
  }

  await step(device, "11-detail-movie", async () => {
    await page.getByTestId("rail-home").click().catch(() => {});
    await title(page, movies[1].title).click();
    await page.getByTestId("tv-detail").waitFor();
    await away();
    await snap(page, device, "11-detail-movie");
  });

  if (deep) {
    await step(device, "13-rate", async () => {
      await page.getByTestId("tv-detail-rate").click();
      await page.getByTestId("tv-rate").waitFor();
      await snap(page, device, "13-rate");
      await page.getByTestId("rate-score-8").click();
      await page.getByTestId("rate-note-button").click();
      await page.getByTestId("tv-rate-note").waitFor();
      await snap(page, device, "14-rate-note");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    });
    await step(device, "15-list-picker", async () => {
      await page.getByTestId("tv-detail-list").click();
      await page.getByTestId("tv-list-picker").waitFor();
      await snap(page, device, "15-list-picker");
      await page.getByTestId("pick-new").click();
      await page.getByTestId("tv-list-edit").waitFor();
      await snap(page, device, "16-list-edit");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    });
    await page.keyboard.press("Escape"); // (off the title's page)
  }

  await step(device, "12-detail-series", async () => {
    const detail = await page.getByTestId("tv-detail").count();
    if (detail) await page.keyboard.press("Escape");
    await title(page, series[1].title).click();
    await page.getByTestId("tv-detail").waitFor();
    await page.getByTestId("tv-episodes").waitFor();
    await away();
    await snap(page, device, "12-detail-series", { settle: 900 });
    await press(page, "ArrowDown", 2); // (the page scrolls to the seasons, then the episodes)
    await snap(page, device, "12b-detail-series-episodes", { settle: 700 });
    await page.keyboard.press("Escape");
  });

  await step(device, "17-profile-guest", async () => {
    await page.getByTestId("rail-profile").click();
    await page.getByTestId("tv-browse").and(page.locator('[data-view="profile"]')).waitFor();
    await away();
    await snap(page, device, "17-profile-guest");
  });
  if (deep) {
    await step(device, "18-history", async () => {
      await page.locator('[data-entry="profile:history"]').click();
      await away();
      await snap(page, device, "18-history");
      await page.keyboard.press("Escape");
    });
    await step(device, "19-ratings", async () => {
      await page.locator('[data-entry="profile:ratings"]').click();
      await away();
      await snap(page, device, "19-ratings");
      await page.keyboard.press("Escape");
    });
    await step(device, "20-settings", async () => {
      await page.locator('[data-entry="profile:settings"]').click();
      await page.getByTestId("tv-account").waitFor();
      await away();
      await snap(page, device, "20-settings");
      await page.getByTestId("tv-sign-in").click();
      await page.getByTestId("tv-link-code").waitFor();
      await away();
      await snap(page, device, "21-signin-code");
      await page.getByTestId("tv-signin-email").click();
      await page.getByTestId("auth-form").waitFor();
      await snap(page, device, "22-signin-form");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    });
  }

  await step(device, "23-connect", async () => {
    await page.getByTestId("rail-home").click().catch(() => {});
    await page.getByTestId("rail-connect").click();
    await page.getByTestId("pairing-code").waitFor();
    await away();
    await snap(page, device, "23-connect", { settle: 900 });
    await page.keyboard.press("Escape");
  });
  await step(device, "24-party-start", async () => {
    await page.getByTestId("rail-party").click();
    await page.getByTestId("tv-party-start").waitFor();
    await away();
    await snap(page, device, "24-party-start");
    if (deep) {
      await page.getByTestId("tv-party-join").click();
      await page.getByTestId("tv-party-join-page").waitFor();
      await snap(page, device, "25-party-join");
      await page.keyboard.press("Escape");
    }
    await page.keyboard.press("Escape");
  });

  await step(device, "26-player", async () => {
    await page.getByTestId("rail-home").click().catch(() => {});
    await title(page, movies[1].title).click();
    await page.getByTestId("tv-detail-play").click();
    await page.locator('[data-testid="tv"][data-state="playing"]').waitFor({ timeout: 20_000 });
    await wait(1500);
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.locator('[data-testid="tv"][data-hud="visible"]').waitFor();
    await snap(page, device, "26-player-hud", { settle: 700 });
    // (the same, over the real frame of the film: one to look at for how the controls read over a picture; not one to compare)
    if (deep) await snap(page, device, "26b-player-hud-live", { settle: 100, live: true });
    if (deep) {
      await page.getByTestId("tv-speed-btn").click();
      await page.getByTestId("audio-subtitles-modal").waitFor();
      await snap(page, device, "27-player-audio-menu");
      await page.keyboard.press("Escape");
      await page.mouse.move(viewport.width / 2 + 10, viewport.height / 2 + 6);
      await page.getByTestId("tv-party-btn").click();
      await page.getByTestId("tv-party-panel").waitFor();
      await snap(page, device, "28-player-party-panel");
      await page.keyboard.press("Escape");
    }
    await away();
    await page.locator('[data-testid="tv"][data-hud="hidden"]').waitFor({ timeout: 20_000 });
    await snap(page, device, "29-player-clean", { settle: 700 });
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.keyboard.press("Escape");
  });

  await context.close();
}

const browser = await chromium.launch();
const only = new Set((process.argv[2] ?? "welcome,hd,full").split(","));

if (only.has("welcome")) {
  await step("tv-1280", "01-welcome", async () => {
    const context = await openContext(browser, HD, { first: true });
    const page = await context.newPage();
    await page.goto("/tv");
    await page.getByTestId("tv-welcome").waitFor();
    await snap(page, "tv-1280", "01-welcome", { settle: 900 });
    await context.close();
  });
}
if (only.has("hd")) await guestTv(browser, HD, "tv-1280", true);
if (only.has("full")) await guestTv(browser, FULL_HD, "tv-1920", false);
if (only.has("qhd")) await guestTv(browser, QHD, "tv-2560", false);
if (only.has("desktop")) await guestTv(browser, DESKTOP, "tv-1440x900", false);
if (only.has("laptop")) await guestTv(browser, LAPTOP, "tv-1366x768", false);

await browser.close();
console.log(log.filter((line) => line.startsWith("FAIL")).length + " failed of " + log.length);
