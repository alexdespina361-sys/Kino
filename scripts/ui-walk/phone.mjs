// the phone (390x844) as a remote for a TV: signed out, then signed in with friends.
import { chromium, base, wait, HD, PHONE, phoneName, openContext, guestData, step, snap, snapScrolled, movies, series, log } from "./lib.mjs";

const PASSWORD = "kino-test-pass-1"; // (a made-up password for accounts that live in the memory of a test server)
const at = Date.now();
const day = (n) => at - n * 86_400_000;
const watch = (i) => `https://films.example/watch/${i}`;
const card = (i) => ({ title: movies[i].title, url: watch(i), image: movies[i].image, backdrop: movies[i].backdrop, year: movies[i].year });
const progress = (i, position, duration, extra = {}) => ({ key: `url:${watch(i)}`, at: at - (i + 1) * 600_000, position, duration, ...card(i), ...extra });
const saved = (i, list) => ({ key: list ? `${list}|url:${watch(i)}` : `url:${watch(i)}`, at: day(i % 5), ...(list ? { list } : {}), id: movies[i].id, description: movies[i].description, ...card(i) });
const rated = (i, score, note) => ({ key: `rate:${watch(i)}`, at: day(i % 6), kind: "movie", score, ratedAt: day(i % 6), ...(note ? { note } : {}), ...card(i) });

const guestSeed = guestData({
  progress: [progress(5, 2700, 6600), progress(7, 5000, 6000), progress(9, 600, 7200), progress(13, 6100, 6200, { done: true })],
  list: [6, 8, 10, 12, 18].map((i) => saved(i)).concat([14, 19].map((i) => saved(i, "lweekend"))),
  listNames: [{ key: "lweekend", at: day(3), name: "Weekend" }],
  ratings: [rated(11, 9, "Quiet, funny, and kinder than it looks."), rated(12, 7), rated(13, 8), rated(14, 10)],
});

const profileOf = (page) => page.evaluate(() => localStorage.getItem("kino.profile"));
const look = (page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
const back = async (page) => {
  await page.keyboard.press("Escape");
  await wait(250);
};

/** A TV page that waits for a phone: its code. */
async function tvWithCode(browser) {
  const context = await openContext(browser, HD);
  const tv = await context.newPage();
  await tv.goto("/tv");
  await tv.getByTestId("tv-browse").waitFor();
  await tv.getByTestId("tv-welcome").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
  await tv.getByTestId("rail-connect").click();
  await tv.getByTestId("pairing-code").waitFor();
  const code = ((await tv.getByTestId("pairing-code").textContent()) ?? "").replace(/\s/g, "");
  return { tv, context, code };
}

async function newPhone(browser, seed = {}) {
  const context = await openContext(browser, PHONE, { phone: true, seed });
  const page = await context.newPage();
  await page.goto("/");
  return { page, context };
}

async function pair(phone, code) {
  await phone.getByTestId("code-input").fill(code);
  await phone.getByTestId("tv-online").filter({ hasText: "TV connected" }).waitFor();
  await phone.getByTestId("library").waitFor();
  await wait(1200); // (the pictures)
}

async function signUp(phone, name) {
  await phone.getByTestId("account-button").click();
  await phone.getByTestId("auth-switch").click();
  await phone.getByTestId("auth-form").and(phone.locator('[data-mode="signUp"]')).waitFor();
  await phone.getByTestId("auth-email").fill(name.toLowerCase());
  await phone.getByTestId("auth-password").fill(PASSWORD);
  await phone.getByTestId("auth-submit").click();
  await phone.getByTestId("account-card").waitFor();
}
async function friendsOn(phone) {
  await phone.getByTestId("menu-settings").click();
  await phone.getByTestId("friends-switch").click();
  await phone.locator('[data-testid="friends-switch"][aria-checked="true"]').waitFor();
  await back(phone);
  await phone.getByTestId("menu-friends").waitFor();
}
/** The phone's Home (the bar's first place). Before the bar there was a hub to close; the bar is there on every page of the paired phone. */
async function home(phone) {
  if ((await phone.getByTestId("tab-home").count()) > 0) await phone.getByTestId("tab-home").click();
  else await back(phone);
  await phone.getByTestId("account-screen").waitFor({ state: "detached" });
}
/** One of the bar's places: "search", "list" or "you". */
async function goTo(phone, tab) {
  await phone.getByTestId(`tab-${tab}`).click();
  await wait(350);
}
async function ask(from, tag) {
  const response = await from.request.post(`/api/profiles/${await profileOf(from)}/friends/requests`, { data: { tag } });
  if (!response.ok()) throw new Error(`ask ${tag}: ${response.status()}`);
}
async function sync(page, data) {
  const response = await page.request.post(`/api/profiles/${await profileOf(page)}/sync`, { data: { since: 0, ...data } });
  if (!response.ok()) throw new Error(`sync: ${response.status()}`);
}

const browser = await chromium.launch();
const parts = new Set((process.env.PHONE_PARTS ?? process.argv[2] ?? "guest,in").split(",")); // (PHONE_PARTS=guest: only the signed-out half, which is quicker)

/* ------------------------------ signed out ------------------------------ */
if (parts.has("guest")) {
  const device = phoneName;
  const { tv, code } = await tvWithCode(browser);
  const { page: phone } = await newPhone(browser, guestSeed);
  await step(device, "p01-pair", async () => {
    await phone.getByTestId("code-input").waitFor();
    await snap(phone, device, "p01-pair");
  });
  await step(device, "p02-home", async () => {
    await pair(phone, code);
    await snap(phone, device, "p02-home");
    await snap(phone, device, "p02b-home-full", { fullPage: true, settle: 100 });
  });
  await step(device, "p02c-see-all", async () => {
    // (a row's whole list, on a page of its own: only with the shell)
    if ((await phone.getByTestId("row-see-all").count()) === 0) return;
    await phone.getByTestId("row-see-all").first().click();
    await phone.getByTestId("row-page").waitFor();
    await wait(900); // (the pictures)
    await snap(phone, device, "p02c-see-all");
    await back(phone);
    await phone.getByTestId("row-page").waitFor({ state: "detached" });
  });
  await step(device, "p02d-my-lists", async () => {
    // (the lists are a place of the bar of their own: only with the shell)
    if ((await phone.getByTestId("tab-list").count()) === 0) return;
    await goTo(phone, "list");
    await wait(700); // (the pictures)
    await snap(phone, device, "p02d-my-lists");
    await snap(phone, device, "p02e-my-lists-full", { fullPage: true, settle: 100 });
    await goTo(phone, "home");
  });
  await step(device, "p03-search", async () => {
    // (the box is the bar's second place; before the bar it was on Home, under the link box)
    if ((await phone.getByTestId("tab-search").count()) > 0) {
      await goTo(phone, "search");
      await snap(phone, device, "p03a-search-empty");
    }
    await phone.getByTestId("library-search-input").fill("har");
    await wait(900);
    await snap(phone, device, "p03-search");
    await phone.getByTestId("library-search-input").fill("");
    if ((await phone.getByTestId("tab-home").count()) > 0) await goTo(phone, "home");
  });
  await step(device, "p04-title-sheet", async () => {
    await phone.getByTestId("library-tile").filter({ hasText: movies[1].title }).first().click();
    await phone.getByTestId("title-sheet").waitFor();
    await snap(phone, device, "p04-title-sheet");
    await phone.getByTestId("title-list").click();
    await phone.getByTestId("list-picker").waitFor();
    await snap(phone, device, "p05-list-picker");
    await back(phone);
    await back(phone);
  });
  await step(device, "p06-title-series", async () => {
    await phone.getByTestId("library-tile").filter({ hasText: series[1].title }).first().click();
    await phone.getByTestId("title-sheet").waitFor();
    await phone.getByTestId("title-episodes").waitFor();
    await snapScrolled(phone, '[data-testid="title-sheet"]', device, "p06-title-series", { settle: 900 });
    await back(phone);
  });
  await step(device, "p07-menu", async () => {
    await phone.getByTestId("menu").click();
    await phone.getByTestId("menu-sheet").waitFor();
    await snap(phone, device, "p07-menu");
    if ((await phone.getByTestId("control-open").count()) > 0) {
      // (with the shell the code for another phone is behind its own row)
      await phone.getByTestId("control-open").click();
      await wait(300);
      await snap(phone, device, "p07b-menu-code");
      await phone.getByTestId("control-open").click();
    }
    await phone.getByTestId("tvs-open").click();
    await phone.getByTestId("tvs-sheet").waitFor();
    await snap(phone, device, "p08-tvs-sheet");
    await back(phone);
    await back(phone);
    await phone.getByTestId("menu").click();
    await phone.getByTestId("party-open").click();
    await phone.getByTestId("party-sheet").waitFor();
    await snap(phone, device, "p09-party-sheet");
    await back(phone);
    await back(phone);
  });
  await step(device, "p10-account-guest", async () => {
    await phone.getByTestId("account-button").click();
    await phone.getByTestId("account-screen").waitFor();
    await snap(phone, device, "p10-account-guest");
    await phone.getByTestId("menu-settings").click();
    await snapScrolled(phone, null, device, "p11-settings-guest");
    await back(phone);
    await home(phone);
  });
  await step(device, "p12-remote", async () => {
    await phone.getByTestId("library-tile").filter({ hasText: movies[1].title }).first().click();
    await phone.getByTestId("title-play").click();
    await phone.locator('[data-testid="player-state"]').filter({ hasText: /play/i }).first().waitFor({ timeout: 25_000 });
    await wait(1500);
    await snap(phone, device, "p12-remote-playing");
  });
  await step(device, "p12b-mini-remote", async () => {
    // (with the shell the remote can step aside: what plays stays as a line above the bar on every place of it, and a tap on the line brings the remote back)
    if ((await phone.getByTestId("remote-back").count()) === 0) return;
    await phone.getByTestId("remote-back").click();
    await phone.getByTestId("mini-remote").waitFor();
    await wait(600);
    await snap(phone, device, "p12b-mini-home");
    await goTo(phone, "search");
    await snap(phone, device, "p12c-mini-search");
    await goTo(phone, "home");
    await phone.getByTestId("playing-bar").click();
    await phone.getByTestId("media-title").waitFor();
    await wait(400);
  });
  await step(device, "p13-tracks-sheet", async () => {
    // (the made-up film has one soundtrack and no subtitles, and then the page rightly shows no chip for them)
    if ((await phone.getByTestId("chip-tracks").count()) === 0) return;
    await phone.getByTestId("chip-tracks").click({ timeout: 5_000 });
    await phone.getByTestId("tracks-sheet").waitFor();
    await snap(phone, device, "p13-tracks-sheet");
    await back(phone);
  });
  await step(device, "p14-speed-sheet", async () => {
    await phone.getByTestId("chip-speed").click({ timeout: 5_000 });
    await phone.getByTestId("speed-sheet").waitFor();
    await snap(phone, device, "p14-speed-sheet");
    await back(phone);
  });
  await step(device, "p15-menu-while-playing", async () => {
    await phone.getByTestId("menu").click({ timeout: 5_000 });
    await phone.getByTestId("menu-sheet").waitFor();
    await snap(phone, device, "p15-menu-while-playing");
    await back(phone);
  });
  await step(device, "p16-subtitles", async () => {
    // (the made-up film has no subtitles: a title that has some is put on, as the TV says it, and the page is opened again on it)
    await phone.evaluate(async () => {
      const media = {
        title: "The Long Night",
        stream: { url: "/fixtures/sample.mp4", type: "mp4" },
        subtitles: [
          { id: "en", label: "English", lang: "en", url: "/fixtures/sample.vtt" },
          { id: "nl", label: "Dutch", lang: "nl", url: "/fixtures/sample.vtt" },
          { id: "ro", label: "Romanian", lang: "ro", url: "/fixtures/sample.vtt" },
        ],
      };
      const socket = new WebSocket(`ws://${location.host}/ws`);
      await new Promise((resolve) => (socket.onopen = resolve));
      socket.send(JSON.stringify({ type: "CTL_HELLO", controllerId: localStorage.getItem("controller.id") }));
      socket.send(JSON.stringify({ type: "CMD", command: { type: "LOAD", media } }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      socket.close();
    });
    await phone.reload();
    await phone.getByTestId("media-title").waitFor({ timeout: 15_000 });
    await wait(800);
    await phone.getByTestId("chip-tracks").click({ timeout: 5_000 });
    await phone.getByTestId("tracks-sheet").waitFor();
    await snap(phone, device, "p16-tracks-sheet");
    await phone.getByTestId("subtitle-0").click();
    await wait(300);
    await phone.getByTestId("open-caption-style").click();
    await phone.getByTestId("captions-sheet").waitFor();
    await snapScrolled(phone, '[data-testid="captions-sheet"]', device, "p17-caption-style");
    await back(phone);
    await back(phone);
  });
}

/* ------------------------------ signed in, with friends ------------------------------ */
if (parts.has("in")) {
  const device = `${phoneName}-signed-in`;
  let dana;
  let eli;
  let fay;
  await step(device, "setup", async () => {
    const make = async (name) => {
      const { page, context } = await newPhone(browser);
      await page.getByTestId("code-input").waitFor();
      await signUp(page, name);
      await friendsOn(page);
      return { page, context, name };
    };
    dana = await make("Dana");
    eli = await make("Eli");
    fay = await make("Fay");
    await home(eli.page);
    await home(fay.page);
    await ask(fay.page, "Dana#1");
    await ask(eli.page, "Dana#1");
  });
  if (!dana || !eli || !fay) {
    console.log("accounts missing; stopping");
    await browser.close();
    process.exit(1);
  }
  const phone = dana.page;
  await step(device, "setup-own-data", async () => {
    await sync(phone, {
      progress: [5, 7, 9].map((i, n) => ({ key: `url:${watch(i)}`, at: Date.now() - (n + 1) * 900_000, position: 1800 + n * 900, duration: 6600, ...card(i) })),
      list: [6, 8, 10, 18].map((i) => ({ key: `url:${watch(i)}`, at: day(i % 5), id: movies[i].id, description: movies[i].description, ...card(i) })),
      ratings: [11, 12, 13, 14].map((i, n) => ({ key: `rate:${watch(i)}`, at: day(n + 1), kind: "movie", score: [9, 7, 8, 10][n], ratedAt: day(n + 1), ...card(i) })),
    });
  });
  await step(device, "setup-pair", async () => {
    const { code } = await tvWithCode(browser);
    await home(phone);
    await pair(phone, code);
    await look(phone);
    await wait(800);
  });
  await step(device, "p20-home-signed-in", async () => {
    await snap(phone, device, "p20-home-signed-in");
    await snap(phone, device, "p20b-home-signed-in-full", { fullPage: true, settle: 100 });
  });
  await step(device, "p21-bell", async () => {
    await phone.getByTestId("bell-button").click();
    await phone.getByTestId("bell-sheet").waitFor();
    await snap(phone, device, "p21-bell-two-requests", { keepToast: true });
    // answer Eli's request, leave Fay's waiting
    await phone.getByTestId("friend-request").filter({ hasText: "Eli" }).getByTestId("friend-request-accept").click();
    await wait(900);
    await snap(phone, device, "p22-bell-after-one-answer");
    await back(phone);
  });
  await step(device, "setup-share", async () => {
    // Eli tells what he watches; Dana listens
    await eli.page.getByTestId("account-button").click();
    await eli.page.getByTestId("menu-settings").click();
    await eli.page.getByTestId("friends-give").click();
    await back(eli.page);
    await home(eli.page);
    await phone.getByTestId("account-button").click();
    await phone.getByTestId("menu-settings").click();
    await phone.getByTestId("friends-get").click();
    await snapScrolled(phone, null, device, "p23-settings-signed-in");
    await back(phone);
    await sync(eli.page, { progress: [{ key: "show:harbour", at: Date.now(), title: series[1].title, url: `${base}/fixtures/pages/video.html?s=1&e=2`, image: series[1].image, backdrop: series[1].backdrop, year: series[1].year, position: 1200, duration: 2400, season: 1, episode: 2 }] });
    await sync(eli.page, { ratings: [{ key: `rate:${watch(11)}`, at: day(1), kind: "movie", score: 9, ratedAt: day(1), note: "Rewatchable.", ...card(11) }] });
    await wait(1500);
    await look(phone);
  });
  await step(device, "p24-account", async () => {
    await phone.getByTestId("account-screen").waitFor();
    await snapScrolled(phone, null, device, "p24-account-hub");
  });
  await step(device, "p25-friends", async () => {
    await phone.getByTestId("menu-friends").click();
    await phone.getByTestId("friends-page").waitFor();
    await snapScrolled(phone, null, device, "p25-friends-page");
    await phone.getByTestId("friend-row").first().click();
    await snapScrolled(phone, null, device, "p26-friend-page");
    await back(phone);
    await phone.getByTestId("friend-make-code").click();
    await wait(900);
    await snap(phone, device, "p27-friend-code");
    await back(phone);
    await back(phone);
  });
  const accountPage = async () => {
    if ((await phone.getByTestId("account-screen").count()) === 0) await phone.getByTestId("account-button").click();
    await phone.getByTestId("account-screen").waitFor();
  };
  await step(device, "p28-ratings", async () => {
    await accountPage();
    await phone.getByTestId("menu-ratings").click();
    await phone.getByTestId("ratings-sheet").waitFor();
    await snap(phone, device, "p28-ratings-sheet");
    await back(phone);
  });
  await step(device, "p29-profiles-devices-security", async () => {
    await accountPage();
    await phone.getByTestId("menu-profiles").click();
    await snapScrolled(phone, null, device, "p29-profiles");
    await back(phone);
    await phone.getByTestId("menu-devices").click();
    await snapScrolled(phone, null, device, "p30-devices");
    await back(phone);
    await phone.getByTestId("menu-security").click();
    await snapScrolled(phone, null, device, "p31-security");
    await back(phone);
    await home(phone);
  });
  await step(device, "p32-lists", async () => {
    if ((await phone.getByTestId("tab-list").count()) > 0) {
      await goTo(phone, "list"); // (the lists and the ratings are the bar's third place; before the bar they were rows of Home)
      await snap(phone, device, "p33-my-lists");
      await snap(phone, device, "p33b-my-lists-full", { fullPage: true, settle: 100 });
    } else if ((await phone.getByTestId("lists-manage").count()) === 0) await home(phone);
    await phone.getByTestId("lists-manage").click();
    await phone.getByTestId("lists-sheet").waitFor();
    await snap(phone, device, "p32-lists-sheet");
    await back(phone);
  });
}

await browser.close();
console.log(log.filter((line) => line.startsWith("FAIL")).length + " failed of " + log.length);
