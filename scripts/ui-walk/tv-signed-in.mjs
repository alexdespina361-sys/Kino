// the TV signed in, with friends: three accounts (Ana is the one looked at; Ben is her friend; Cy has asked to be).
import { chromium, base, wait, HD, FULL_HD, openContext, step, snap, pointerAway, movies, series, log } from "./lib.mjs";

const PASSWORD = "kino-test-pass-1"; // (a made-up password for accounts that live in the memory of a test server)
const watch = (i) => `https://films.example/watch/${i}`;
const day = (n) => Date.now() - n * 86_400_000;
const card = (i) => ({ title: movies[i].title, url: watch(i), image: movies[i].image, backdrop: movies[i].backdrop, year: movies[i].year });

const tile = (page, title) => page.locator(`.tv-tile[title="${title}"]`).first();
const press = async (page, key, times = 1) => {
  for (let n = 0; n < times; n++) {
    await page.keyboard.press(key);
    await wait(120);
  }
};
/** The page looks at its friends now, as it does when it comes back to the front. */
const look = (page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
const profileOf = (page) => page.evaluate(() => localStorage.getItem("kino.profile"));

async function profilePage(page) {
  await page.getByTestId("rail-profile").click();
  await page.locator('[data-testid="tv-browse"][data-view="profile"]').waitFor();
}
async function place(page, where) {
  if ((await page.getByTestId("tv-browse").getAttribute("data-view")) !== "profile") await profilePage(page);
  await page.locator(`[data-entry="profile:${where}"]`).click();
}

/** A new screen with its own account, signed up with the form a keyboard fills in, friends switched on. */
async function screen(browser, name, { viewport = HD, shotAt } = {}) {
  const context = await openContext(browser, viewport);
  const page = await context.newPage();
  await page.goto("/tv");
  await page.getByTestId("tv-browse").waitFor();
  await page.getByTestId("tv-welcome").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
  await page.getByTestId("tv-account-chip").click();
  await page.getByTestId("tv-signin-email").click();
  await page.getByTestId("auth-switch").click();
  await page.getByTestId("auth-form").and(page.locator('[data-mode="signUp"]')).waitFor();
  await page.getByTestId("auth-email").fill(name.toLowerCase());
  await page.getByTestId("auth-password").fill(PASSWORD);
  if (shotAt) await snap(page, shotAt.device, shotAt.name);
  await page.getByTestId("auth-submit").click();
  await page.getByTestId("tv-account-chip").filter({ hasText: name }).waitFor();
  await place(page, "settings");
  await page.getByTestId("tv-friends-switch").click();
  await page.locator('[data-testid="tv-friends-switch"][aria-checked="true"]').waitFor();
  await page.getByTestId("tv-account-back").click();
  await page.locator('[data-entry="profile:friends"]').waitFor();
  return { context, page, name, profile: await profileOf(page) };
}

/** `from` asks the one with this tag to be friends, as the Add button does. */
async function ask(from, tag) {
  const response = await from.page.request.post(`/api/profiles/${from.profile}/friends/requests`, { data: { tag } });
  if (!response.ok()) throw new Error(`ask ${tag}: ${response.status()}`);
}
async function sync(who, data) {
  const response = await who.page.request.post(`/api/profiles/${who.profile}/sync`, { data: { since: 0, ...data } });
  if (!response.ok()) throw new Error(`sync: ${response.status()}`);
}

const browser = await chromium.launch();
const device = process.argv[2] === "full" ? "tv-1920-signed-in" : "tv-1280-signed-in";
const viewport = process.argv[2] === "full" ? FULL_HD : HD;

let ana;
let ben;
let cy;
await step(device, "setup-accounts", async () => {
  ana = await screen(browser, "Ana", { viewport, shotAt: { device, name: "s00-signup-form" } });
  ben = await screen(browser, "Ben");
  cy = await screen(browser, "Cy");
});
if (!ana || !ben || !cy) {
  console.log("accounts missing; stopping");
  await browser.close();
  process.exit(1);
}
const away = () => pointerAway(ana.page, viewport);

await step(device, "setup-friends", async () => {
  await ask(cy, "Ana#1");
  await ask(ben, "Ana#1");
  await look(ana.page);
  await ana.page.getByTestId("tv-bell-badge").filter({ hasText: "2" }).waitFor();
});

await step(device, "s09-bell-two-requests", async () => {
  await ana.page.getByTestId("rail-home").click();
  await away();
  await snap(ana.page, device, "s01-home-with-bell-badge", { keepToast: true });
  await ana.page.getByTestId("tv-bell").click();
  await ana.page.getByTestId("tv-bell-page").waitFor();
  await away();
  await snap(ana.page, device, "s09-bell-two-requests", { keepToast: true });
});

await step(device, "setup-accept", async () => {
  // a press on the line of Ben opens his request; Cy's stays waiting
  await ana.page.getByTestId("tv-bell-item").filter({ hasText: "Ben" }).click();
  await ana.page.getByTestId("tv-friend-request").waitFor();
  await away();
  await snap(ana.page, device, "s09b-friend-request");
  await ana.page.getByTestId("tv-friend-request-accept").click();
  await wait(1200);
  await ana.page.getByTestId("tv-friend-request").waitFor({ state: "detached" }).catch(() => {});
});

await step(device, "setup-share", async () => {
  // Ben tells what he watches; Ana listens
  await look(ben.page);
  await place(ben.page, "friends");
  await tile(ben.page, "Friends settings").click();
  await ben.page.getByTestId("tv-friends-give").click();
  await ben.page.getByTestId("tv-friend-settings-done").click();
  await look(ana.page);
  await place(ana.page, "friends");
  await tile(ana.page, "Friends settings").click();
  await ana.page.getByTestId("tv-friends-get").click();
  await ana.page.getByTestId("tv-friend-settings-done").click();
  await wait(1500);
  await sync(ben, { progress: [{ key: "show:harbour", at: Date.now(), title: series[1].title, url: `${base}/fixtures/pages/video.html?s=1&e=2`, image: series[1].image, backdrop: series[1].backdrop, year: series[1].year, position: 1200, duration: 2400, season: 1, episode: 2 }] });
  await sync(ben, { ratings: [{ key: `rate:${watch(11)}`, at: day(1), kind: "movie", score: 9, ratedAt: day(1), note: "Rewatchable.", ...card(11) }] });
  await sync(ben, { list: [6, 8, 12].map((i) => ({ key: `url:${watch(i)}`, at: day(i % 4), id: movies[i].id, description: movies[i].description, ...card(i) })) });
});

await step(device, "setup-own-data", async () => {
  await sync(ana, {
    progress: [5, 7, 9].map((i, n) => ({ key: `url:${watch(i)}`, at: Date.now() - (n + 1) * 900_000, position: 1800 + n * 900, duration: 6600, ...card(i) })).concat([13, 15, 16].map((i, n) => ({ key: `url:${watch(i)}`, at: Date.now() - (n + 5) * 3_600_000, position: 5400, duration: 5400, done: true, ...card(i) }))),
    list: [6, 8, 10, 18].map((i) => ({ key: `url:${watch(i)}`, at: day(i % 5), id: movies[i].id, description: movies[i].description, ...card(i) })),
    ratings: [11, 12, 13, 14].map((i, n) => ({ key: `rate:${watch(i)}`, at: day(n + 1), kind: "movie", score: [9, 7, 8, 10][n], ratedAt: day(n + 1), ...(n === 0 ? { note: "Quiet, funny, and kinder than it looks." } : {}), ...card(i) })),
  });
  await ana.page.reload();
  await ana.page.getByTestId("tv-browse").waitFor();
  await ana.page.getByTestId("tv-welcome").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
  await wait(1200);
});

await step(device, "s01-home", async () => {
  await away();
  await snap(ana.page, device, "s01-home");
});
await step(device, "s02-profile-hub", async () => {
  await profilePage(ana.page);
  await away();
  await snap(ana.page, device, "s02-profile-hub");
});
await step(device, "s03-friends-page", async () => {
  await place(ana.page, "friends");
  await away();
  await snap(ana.page, device, "s03-friends-page", { settle: 900 });
});
await step(device, "s04-friend-page", async () => {
  await tile(ana.page, "Ben").click();
  await away();
  await snap(ana.page, device, "s04-friend-page", { settle: 900 });
  await ana.page.keyboard.press("Escape");
});
await step(device, "s05-add-friend", async () => {
  await tile(ana.page, "Add a friend").click();
  await ana.page.getByTestId("tv-add-friend").waitFor();
  await away();
  await snap(ana.page, device, "s05-add-friend");
  await ana.page.getByTestId("tv-friend-give").click();
  await ana.page.getByTestId("tv-friend-code").waitFor();
  await snap(ana.page, device, "s06-friend-give-code");
  await ana.page.keyboard.press("Escape");
  await ana.page.getByTestId("tv-friend-tag").click();
  await ana.page.getByTestId("tv-friend-tag-page").waitFor();
  await snap(ana.page, device, "s07-friend-tag-page");
  await ana.page.keyboard.press("Escape");
  await ana.page.keyboard.press("Escape");
});
await step(device, "s08-friend-settings", async () => {
  await tile(ana.page, "Friends settings").click();
  await ana.page.getByTestId("tv-friend-settings").waitFor();
  await away();
  await snap(ana.page, device, "s08-friend-settings");
  await ana.page.keyboard.press("Escape");
});
await step(device, "s10-bell-after", async () => {
  await ana.page.getByTestId("tv-bell").click();
  await ana.page.getByTestId("tv-bell-page").waitFor();
  await away();
  await snap(ana.page, device, "s10-bell-after");
  await ana.page.keyboard.press("Escape");
});
await step(device, "s11-ratings", async () => {
  await ana.page.keyboard.press("Escape").catch(() => {});
  await place(ana.page, "ratings");
  await away();
  await snap(ana.page, device, "s11-ratings");
  await ana.page.keyboard.press("Escape");
});
await step(device, "s12-history", async () => {
  await place(ana.page, "history");
  await away();
  await snap(ana.page, device, "s12-history");
  await ana.page.keyboard.press("Escape");
});
await step(device, "s13-account-panel", async () => {
  await ana.page.getByTestId("tv-account-chip").click();
  await ana.page.getByTestId("tv-account").waitFor();
  await away();
  await snap(ana.page, device, "s13-account-panel");
  await ana.page.getByTestId("tv-manage-profiles").click();
  await ana.page.getByTestId("tv-profiles-done").waitFor();
  await snap(ana.page, device, "s14-manage-profiles");
  await ana.page.getByTestId("profile-add").click();
  await ana.page.getByTestId("profile-name-input").waitFor();
  await snap(ana.page, device, "s15-profile-add");
  await ana.page.keyboard.press("Escape");
  await ana.page.keyboard.press("Escape");
  await ana.page.getByTestId("tv-approve").click();
  await ana.page.getByTestId("tv-approve-input").waitFor();
  await snap(ana.page, device, "s16-approve-another-screen");
  await ana.page.keyboard.press("Escape");
  await ana.page.keyboard.press("Escape");
});
await step(device, "s17-party-with-friends", async () => {
  await ana.page.getByTestId("rail-home").click().catch(() => {});
  await ana.page.getByTestId("rail-party").click();
  await ana.page.getByTestId("tv-party-start").waitFor();
  await ana.page.getByTestId("tv-party-start").click();
  await ana.page.getByTestId("tv-party-code").waitFor();
  await away();
  await snap(ana.page, device, "s17-party-hosting", { settle: 900 });
  await ana.page.getByTestId("tv-party-invite-friends").click();
  await wait(500);
  await snap(ana.page, device, "s18-party-invite-friends");
  await ana.page.keyboard.press("Escape");
  await ana.page.keyboard.press("Escape");
});
await step(device, "s19-player-signed-in", async () => {
  await ana.page.getByTestId("rail-home").click().catch(() => {});
  await tile(ana.page, movies[1].title).click();
  await ana.page.getByTestId("tv-detail-play").click();
  await ana.page.locator('[data-testid="tv"][data-state="playing"]').waitFor({ timeout: 20_000 });
  await wait(1200);
  await ana.page.mouse.move(viewport.width / 2, viewport.height / 2);
  await ana.page.locator('[data-testid="tv"][data-hud="visible"]').waitFor();
  await snap(ana.page, device, "s19-player-hud-signed-in", { settle: 700 });
});

await browser.close();
console.log(log.filter((line) => line.startsWith("FAIL")).length + " failed of " + log.length);
