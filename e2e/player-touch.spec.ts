import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { NormalizedMedia } from "../src/shared";
import { guestStorage, openDevice, openLibrary, openTv, PHONE, RawPhone, readPairingCode, tvRoot, tvTime, withLibrary } from "./helpers";

/** The picture under a hand: what a tap, two taps and a held finger do, the big button in the middle, the episode's name, and a phone turned sideways. */

/** (fixtures/long.mp4 is forty seconds: there is room to skip in.) */
const films = Array.from({ length: 4 }, (_, i) => ({ id: `f${i}`, title: `Film number ${i + 1}`, year: 1990 + i, url: `/fixtures/long.mp4?n=${i}` }));
const library = { updatedAt: Date.now(), rows: [{ id: "r1", title: "Classics", source: "Test Source", items: films }] };
const withFilms = withLibrary(library, (query) => films.filter((film) => film.title.toLowerCase().includes(query.toLowerCase())));

// Where a finger lands on a phone held upright (390 by 844): the two sides of the picture, and the middle of it (above the big button, which is halfway down).
const LEFT = { x: 60, y: 300 };
const RIGHT = { x: 330, y: 300 };
const MIDDLE = { x: 195, y: 300 };

const hud = (page: Page) => tvRoot(page).getAttribute("data-hud");
const seekTo = (page: Page, time: number) => page.evaluate((to) => void (document.querySelector("video")!.currentTime = to), time);
const rate = (page: Page) => page.evaluate(() => document.querySelector("video")!.playbackRate);
const isFullScreen = (page: Page) => page.evaluate(() => document.fullscreenElement !== null);

/** A phone used as the screen, on the library of films. */
async function openFilms(browser: Browser, { seed = {}, setup }: { seed?: Record<string, string>; setup?: (context: BrowserContext) => Promise<unknown> } = {}): Promise<Page> {
  const phone = await openDevice(browser, PHONE, seed, async (context) => {
    await withFilms(context);
    await setup?.(context);
  });
  await phone.goto("/tv");
  await expect(phone.getByTestId("tv-browse")).toBeVisible();
  return phone;
}

/** The first film, played; the controls have faded by the time it returns. */
async function startFilm(phone: Page): Promise<void> {
  await phone.getByTestId("rail-search").tap();
  await phone.getByTestId("tv-query").fill("film");
  await expect(phone.getByTestId("tv-browse-tile")).toHaveCount(films.length);
  await phone.getByTestId("tv-browse-tile").first().tap();
  await phone.getByTestId("tv-detail-play").tap();
  await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
  await expect(tvRoot(phone)).toHaveAttribute("data-hud", "hidden", { timeout: 10_000 });
}

const watching = async (browser: Browser, options?: Parameters<typeof openFilms>[1]): Promise<Page> => {
  const phone = await openFilms(browser, options);
  await startFilm(phone);
  return phone;
};

/** Bring the controls up with a touch, unless they are up already (a touch on them would put them away). */
async function showControls(phone: Page): Promise<void> {
  if ((await hud(phone)) === "visible") return;
  await phone.touchscreen.tap(MIDDLE.x, MIDDLE.y);
  await expect(tvRoot(phone)).toHaveAttribute("data-hud", "visible");
}

test.describe("a finger on the picture", () => {
  test("a tap shows the controls, the next one puts them away, and neither pauses the film", async ({ browser }) => {
    const phone = await watching(browser);
    await phone.touchscreen.tap(MIDDLE.x, MIDDLE.y);
    await expect(tvRoot(phone)).toHaveAttribute("data-hud", "visible");
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing");
    await expect(phone.getByTestId("tv-center-btn")).toBeVisible(); // (a finger has no hover and no keys: what to pause with is big, and in the middle)

    await phone.touchscreen.tap(MIDDLE.x, MIDDLE.y);
    await expect(tvRoot(phone)).toHaveAttribute("data-hud", "hidden");
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing");
    phone.close();
  });

  test("the big button pauses and plays; a tap that misses it only shows or hides the controls", async ({ browser }) => {
    const phone = await watching(browser);
    await showControls(phone);
    const button = phone.getByTestId("tv-center-btn");
    await expect(button).toHaveAttribute("aria-label", "Pause");
    const around = (await button.boundingBox())!;
    expect(around.width).toBeGreaterThanOrEqual(80); // (it was 56)

    await button.tap();
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "paused");
    await expect(button).toHaveAttribute("aria-label", "Play");
    // Beside it, and again: nothing pauses or plays.
    const beside = { x: around.x - 20, y: around.y + around.height / 2 };
    await phone.touchscreen.tap(beside.x, beside.y);
    await expect(tvRoot(phone)).toHaveAttribute("data-hud", "hidden");
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "paused");
    await phone.touchscreen.tap(beside.x, beside.y);
    await expect(tvRoot(phone)).toHaveAttribute("data-hud", "visible");
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "paused");

    await button.tap();
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing");
    phone.close();
  });

  test("held upright, the card of what is paused sits above the big button, inside the screen", async ({ browser }) => {
    const phone = await watching(browser);
    await showControls(phone);
    await phone.getByTestId("tv-center-btn").tap();
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "paused");
    await expect
      .poll(async () => {
        const card = (await phone.getByTestId("tv-pause-card").boundingBox())!;
        const button = (await phone.getByTestId("tv-center-btn").boundingBox())!;
        return card.y + card.height <= button.y && card.x >= 0 && card.x + card.width <= 390;
      })
      .toBe(true);
    phone.close();
  });

  test("two taps on a side skip that way, run on while taps keep coming, and never bring the controls up", async ({ browser }) => {
    const phone = await watching(browser);
    const toast = phone.getByTestId("tv-toast");
    await seekTo(phone, 8);
    await expect.poll(() => tvTime(phone)).toBeGreaterThanOrEqual(8);
    const at = await tvTime(phone);

    await phone.touchscreen.tap(RIGHT.x, RIGHT.y);
    await phone.touchscreen.tap(RIGHT.x, RIGHT.y);
    await expect(toast).toHaveText("+10s");
    await expect(toast).toHaveClass(/side-forward/);
    await expect.poll(() => tvTime(phone)).toBeGreaterThan(at + 8);
    await phone.touchscreen.tap(RIGHT.x, RIGHT.y); // one more, in the same run: it does not have to be a double itself
    await expect(toast).toHaveText("+20s");
    await expect.poll(() => tvTime(phone)).toBeGreaterThan(at + 18);

    await phone.waitForTimeout(500); // (longer than a second tap is waited for: the first was never acted on as a tap of its own)
    expect(await hud(phone)).toBe("hidden");
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing");

    const before = await tvTime(phone);
    await phone.touchscreen.tap(LEFT.x, LEFT.y);
    await phone.touchscreen.tap(LEFT.x, LEFT.y);
    await expect(toast).toHaveText("−10s");
    await expect(toast).toHaveClass(/side-back/);
    await expect.poll(() => tvTime(phone)).toBeLessThan(before - 8);
    expect(await hud(phone)).toBe("hidden");
    phone.close();
  });

  test("a single tap on a side is only a tap, and two taps on different sides skip nowhere", async ({ browser }) => {
    const phone = await watching(browser);
    await seekTo(phone, 8);
    await expect.poll(() => tvTime(phone)).toBeGreaterThanOrEqual(8);
    const at = await tvTime(phone);
    await phone.touchscreen.tap(LEFT.x, LEFT.y);
    await expect(tvRoot(phone)).toHaveAttribute("data-hud", "visible");
    expect(await tvTime(phone)).toBeGreaterThanOrEqual(at); // (no skip either way: the picture just went on)
    expect(await tvTime(phone)).toBeLessThan(at + 5);
    await expect(tvRoot(phone)).toHaveAttribute("data-hud", "hidden", { timeout: 10_000 });

    const later = await tvTime(phone);
    await phone.touchscreen.tap(LEFT.x, LEFT.y);
    await phone.touchscreen.tap(RIGHT.x, RIGHT.y);
    await phone.waitForTimeout(600);
    await expect(phone.getByTestId("tv-toast")).toHaveCount(0);
    expect(await tvTime(phone)).toBeGreaterThanOrEqual(later);
    expect(await tvTime(phone)).toBeLessThan(later + 6);
    phone.close();
  });

  test("a finger held on the picture plays it at twice the speed, says so, and lets go of it without pausing or showing the controls", async ({ browser }) => {
    const phone = await watching(browser);
    const cdp = await phone.context().newCDPSession(phone);
    expect(await rate(phone)).toBe(1);

    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: MIDDLE.x, y: MIDDLE.y }] });
    await expect(phone.getByTestId("tv-boost")).toBeVisible({ timeout: 3_000 });
    expect(await rate(phone)).toBe(2);
    await expect(phone.getByTestId("tv-toast")).toHaveCount(0); // (a hold is not a change of speed: nobody is told it is)
    await phone.waitForTimeout(300);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

    await expect(phone.getByTestId("tv-boost")).toHaveCount(0);
    await expect.poll(() => rate(phone)).toBe(1);
    await phone.waitForTimeout(500);
    expect(await hud(phone)).toBe("hidden");
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing");
    phone.close();
  });

  test("a hold goes back to the speed that was chosen, not to 1", async ({ browser }) => {
    const phone = await watching(browser);
    await phone.evaluate(() => void (document.querySelector("video")!.playbackRate = 1.5));
    await expect.poll(() => rate(phone)).toBe(1.5);
    const cdp = await phone.context().newCDPSession(phone);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: MIDDLE.x, y: MIDDLE.y }] });
    await expect.poll(() => rate(phone)).toBe(2);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => rate(phone)).toBe(1.5);
    phone.close();
  });

  test("two taps in the middle go full screen", async ({ browser }) => {
    const phone = await watching(browser);
    expect(await isFullScreen(phone)).toBe(false);
    await phone.touchscreen.tap(MIDDLE.x, MIDDLE.y);
    await phone.touchscreen.tap(MIDDLE.x, MIDDLE.y);
    await expect.poll(() => isFullScreen(phone)).toBe(true);
    phone.close();
  });

  test("a mouse's double click on the picture still goes full screen", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const remote = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    remote.cmd({ type: "LOAD", media: { title: "Sample", stream: { url: "/fixtures/long.mp4", type: "mp4" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    expect(await isFullScreen(tv)).toBe(false);
    await tv.mouse.dblclick(300, 250);
    await expect.poll(() => isFullScreen(tv)).toBe(true);
    remote.close();
  });

  test("with the profile's choice on, a tap on the picture pauses and plays, and the tap that only brings the controls up does not", async ({ browser }) => {
    const phone = await watching(browser, { seed: guestStorage({ settings: [{ key: "tapToPause", at: Date.now(), value: true }] }) });
    await phone.touchscreen.tap(MIDDLE.x, MIDDLE.y);
    await expect(tvRoot(phone)).toHaveAttribute("data-hud", "visible");
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing"); // (reaching for the controls does not pause the film)
    await phone.touchscreen.tap(MIDDLE.x, MIDDLE.y);
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "paused");
    await phone.touchscreen.tap(MIDDLE.x, MIDDLE.y);
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing");
    phone.close();
  });
});

test.describe("a phone turned sideways", () => {
  /** Remember what the page asks of the screen's orientation. */
  const recordOrientation = (context: BrowserContext) =>
    context.addInitScript(() => {
      const calls: string[] = [];
      (window as unknown as { __orientation: string[] }).__orientation = calls;
      Object.defineProperty(screen.orientation, "lock", { configurable: true, value: (to: string) => (calls.push(`lock:${to}`), Promise.resolve()) });
      Object.defineProperty(screen.orientation, "unlock", { configurable: true, value: () => void calls.push("unlock") });
    });
  const calls = (page: Page) => page.evaluate(() => (window as unknown as { __orientation: string[] }).__orientation);

  test("going full screen with a film on turns it landscape, and leaving full screen lets go of it", async ({ browser }) => {
    const phone = await watching(browser, { setup: recordOrientation });
    expect(await calls(phone)).toEqual([]); // (upright, and not full screen: left alone)

    await showControls(phone);
    await phone.getByTestId("tv-fullscreen-btn").tap();
    await expect.poll(() => isFullScreen(phone)).toBe(true);
    await expect.poll(() => calls(phone)).toEqual(["lock:landscape"]);

    await showControls(phone);
    await phone.getByTestId("tv-fullscreen-btn").tap();
    await expect.poll(() => isFullScreen(phone)).toBe(false);
    await expect.poll(() => calls(phone)).toEqual(["lock:landscape", "unlock"]);
    phone.close();
  });

  test("full screen on the library does not turn the phone: only a film does, and it lets go when the film is stopped", async ({ browser }) => {
    const phone = await openFilms(browser, { setup: recordOrientation });
    await phone.evaluate(() => document.documentElement.requestFullscreen());
    await expect.poll(() => isFullScreen(phone)).toBe(true);
    await phone.waitForTimeout(300);
    expect(await calls(phone)).toEqual([]);

    await startFilm(phone);
    await expect.poll(() => calls(phone)).toEqual(["lock:landscape"]);

    await showControls(phone);
    await phone.getByTestId("tv-stop-btn").tap();
    await expect(phone.getByTestId("tv-browse")).toBeVisible();
    await expect.poll(() => calls(phone)).toEqual(["lock:landscape", "unlock"]);
    phone.close();
  });

  test("a desktop is never asked to turn", async ({ browser, baseURL }) => {
    const tv = await openLibrary(browser, recordOrientation);
    await tv.getByTestId("rail-connect").click();
    const remote = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    remote.cmd({ type: "LOAD", media: { title: "Sample", stream: { url: "/fixtures/long.mp4", type: "mp4" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await tv.evaluate(() => document.documentElement.requestFullscreen());
    await expect.poll(() => isFullScreen(tv)).toBe(true);
    await tv.waitForTimeout(300);
    expect(await calls(tv)).toEqual([]);
    remote.close();
  });
});

test.describe("the episode's name", () => {
  const episodes = (baseURL: string) => [
    { season: 1, episode: 1, title: "Pilot", url: `${baseURL}/fixtures/pages/video.html` },
    { season: 1, episode: 2, title: "The Second One", url: `${baseURL}/fixtures/pages/none.html` },
    { season: 1, episode: 3, title: "S1:E3", url: `${baseURL}/fixtures/pages/hls.html` },
  ];
  const show = (baseURL: string, episode: number): NormalizedMedia => ({
    title: `Parts · S1 E${episode}`,
    stream: { url: "/fixtures/long.mp4", type: "mp4" },
    series: { season: 1, episode, episodes: episodes(baseURL) },
  });

  test("is under the show's name and its numbers while the controls are up, and on the card while it is paused", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const remote = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    remote.cmd({ type: "LOAD", media: show(baseURL!, 2) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect(tv.getByTestId("tv-title")).toHaveText("Parts");
    await expect(tv.getByTestId("tv-episode-name")).toHaveText("The Second One");
    await expect(tv.getByTestId("tv-pause-card")).toContainText("Season 1, Episode 2");
    await expect(tv.getByTestId("tv-pause-card")).toContainText("The Second One");

    remote.cmd({ type: "PLAY" });
    await expect(tv.getByTestId("tv-pause-card")).toHaveCount(0);
    await expect(tv.getByTestId("tv-episode-name")).toHaveText("The Second One");
    remote.close();
  });

  test("is left out when the source only has the number for a name, and for a film", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const remote = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    remote.cmd({ type: "LOAD", media: show(baseURL!, 3) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect(tv.getByTestId("tv-title")).toHaveText("Parts");
    await expect(tv.getByTestId("tv-episode-name")).toHaveCount(0);

    remote.cmd({ type: "LOAD", media: { title: "A film", stream: { url: "/fixtures/long.mp4", type: "mp4" } } });
    await expect(tv.getByTestId("tv-title")).toHaveText("A film");
    await expect(tv.getByTestId("tv-episode-name")).toHaveCount(0);
    remote.close();
  });

  test("is the library's when it knows one, and the source's when it does not", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    await tv.route(/\/api\/library\/episodes/, (route) => route.fulfill({ json: { episodes: [{ season: 1, episode: 3, title: "Known to the library" }] } }));
    const remote = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    remote.cmd({ type: "LOAD", media: show(baseURL!, 3) }); // (the source called it by its number only)
    await expect(tv.getByTestId("tv-episode-name")).toHaveText("Known to the library");
    remote.cmd({ type: "LOAD", media: show(baseURL!, 2) }); // (the library has nothing for this one)
    await expect(tv.getByTestId("tv-episode-name")).toHaveText("The Second One");
    remote.close();
  });
});

test.describe("the profile's choice of what a tap does", () => {
  test("is a switch in the phone's Settings, off to begin with, and kept", async ({ browser }) => {
    const phone = await openDevice(browser, PHONE);
    await phone.goto("/");
    const open = async () => {
      await phone.getByTestId("account-button").click();
      await phone.getByTestId("menu-settings").click();
      return phone.getByTestId("tap-to-pause");
    };
    const tap = await open();
    await expect(tap).toHaveAttribute("aria-checked", "false");
    await tap.click();
    await expect(tap).toHaveAttribute("aria-checked", "true");

    await phone.reload();
    await expect(await open()).toHaveAttribute("aria-checked", "true");
    phone.close();
  });

  test("is a switch on the TV's own account page too", async ({ browser }) => {
    const tv = await openLibrary(browser, withFilms);
    await tv.getByTestId("rail-settings").click();
    const tap = tv.getByTestId("tv-tap-to-pause");
    await expect(tap).toHaveAttribute("aria-checked", "false");
    await tap.click();
    await expect(tap).toHaveAttribute("aria-checked", "true");
    tv.close();
  });
});
