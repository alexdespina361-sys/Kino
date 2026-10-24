import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { NormalizedMedia } from "../src/shared";
import { guestStorage, openDevice, openLibrary, openProfilePlace, openTv, PHONE, playFirst, pressMenuLine, RawPhone, readPairingCode, test, tvRoot, tvTime, twoSizes, withLibrary } from "./helpers";

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

/** A phone held upright (390 by 844, the default) or sideways (844 by 390). */
const SHAPES = [
  { how: "upright", width: 390, height: 844 },
  { how: "sideways", width: 844, height: 390 },
] as const;
type Shape = (typeof SHAPES)[number];

/** A phone used as the screen, on the library of films. */
async function openFilms(browser: Browser, { seed = {}, setup, shape }: { seed?: Record<string, string>; setup?: (context: BrowserContext) => Promise<unknown>; shape?: Shape } = {}): Promise<Page> {
  const size = shape ? { viewport: { width: shape.width, height: shape.height }, screen: { width: shape.width, height: shape.height }, hasTouch: true } : PHONE;
  const phone = await openDevice(browser, size, seed, async (context) => {
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

  test("a device with a mouse as well: a click on the big button a finger brought up pauses with it, and a click anywhere else takes the button away", async ({ browser }) => {
    const phone = await watching(browser);
    await showControls(phone); // a finger: the big button is up while the picture plays
    const button = phone.getByTestId("tv-center-btn");
    await expect(button).toBeVisible();
    await button.click(); // (a mouse: the button is not pulled out from under its own click)
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "paused");
    await button.click();
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing");
    await expect(button).toBeVisible();

    await phone.mouse.click(MIDDLE.x, MIDDLE.y); // the picture: the controls go, and what is using the screen is a mouse now
    await expect(tvRoot(phone)).toHaveAttribute("data-hud", "hidden");
    await phone.waitForTimeout(700); // (a mouse that is only settling after its click does not bring them back)
    await phone.mouse.move(120, 200);
    await phone.mouse.move(180, 260);
    await expect(tvRoot(phone)).toHaveAttribute("data-hud", "visible");
    await expect(button).toHaveCount(0); // (a mouse has the bar to pause with)
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

  test("a long run of skips keeps its total on the screen, on the narrowest phone", async ({ browser }) => {
    const phone = await watching(browser);
    await phone.setViewportSize({ width: 320, height: 568 });
    await seekTo(phone, 30);
    for (let taps = 0; taps < 13; taps++) await phone.touchscreen.tap(60, 300); // (the first two are the double tap; each one after it adds ten more)
    const toast = phone.getByTestId("tv-toast");
    await expect(toast).toHaveText("−120s");
    await phone.waitForTimeout(250); // (it grows into its size as it appears)
    const box = (await toast.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
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

  test("with the controls up, a hold puts the title aside for the pill that says 2×, and gives it back", async ({ browser }) => {
    const phone = await watching(browser);
    await showControls(phone);
    const titles = phone.locator(".hud-titles");
    await expect(titles).toHaveCSS("opacity", "1");
    const cdp = await phone.context().newCDPSession(phone);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: MIDDLE.x, y: MIDDLE.y }] });
    await expect(phone.getByTestId("tv-boost")).toBeVisible({ timeout: 3_000 });
    expect(await hud(phone)).toBe("visible"); // (a hold does not take the controls away; the title steps aside instead of lying under the pill)
    await expect(titles).toHaveCSS("opacity", "0");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(phone.getByTestId("tv-boost")).toHaveCount(0);
    await expect(titles).toHaveCSS("opacity", "1");
    phone.close();
  });

  test("a screen that leads a party does not play faster under a held finger: the others are told the speed that was chosen and would fall behind", async ({ browser }) => {
    const host = await openFilms(browser);
    await pressMenuLine(host, "rail-party", "tap");
    await host.getByTestId("tv-party-start").tap();
    const code = (await host.getByTestId("tv-party-code").innerText()).replace(/\s/g, "");
    const guest = await openLibrary(browser, withFilms);
    await guest.getByTestId("rail-party").click();
    await guest.getByTestId("tv-party-join").click();
    await guest.keyboard.type(code);
    await expect(guest.getByTestId("tv-following")).toBeVisible();
    await expect(host.getByTestId("tv-party-member")).toHaveCount(2);
    await host.getByTestId("tv-back-to-library").tap();
    await startFilm(host);
    await expect(tvRoot(guest)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });

    const cdp = await host.context().newCDPSession(host);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: MIDDLE.x, y: MIDDLE.y }] });
    await host.waitForTimeout(1_200); // (a good while longer than a hold takes)
    await expect(host.getByTestId("tv-boost")).toHaveCount(0);
    expect(await rate(host)).toBe(1);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    expect(await rate(host)).toBe(1);
    await expect(tvRoot(host)).toHaveAttribute("data-state", "playing");
    host.close();
    guest.close();
  });

  test("two taps in the middle go full screen", async ({ browser }) => {
    const phone = await watching(browser);
    expect(await isFullScreen(phone)).toBe(false);
    await phone.touchscreen.tap(MIDDLE.x, MIDDLE.y);
    await phone.touchscreen.tap(MIDDLE.x, MIDDLE.y);
    await expect.poll(() => isFullScreen(phone)).toBe(true);
    phone.close();
  });

  test("a mouse's double click in the middle of the picture goes full screen", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const remote = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    remote.cmd({ type: "LOAD", media: { title: "Sample", stream: { url: "/fixtures/long.mp4", type: "mp4" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    expect(await isFullScreen(tv)).toBe(false);
    await tv.mouse.dblclick(640, 250);
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

test.describe("a mouse on the picture", () => {
  // (a desktop's screen, 1280 by 720: the two sides of the picture, and the middle of it, above the big button)
  const SIDE_LEFT = { x: 200, y: 250 };
  const SIDE_RIGHT = { x: 1080, y: 250 };
  const CENTRE = { x: 640, y: 250 };

  /** A screen the size of a desktop's, a film of forty seconds playing from the start, and the controls gone (a move of the mouse brings them back). */
  async function playing(browser: Browser, baseURL: string | undefined) {
    const tv = await openTv(browser);
    const remote = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    remote.cmd({ type: "LOAD", media: { title: "Sample", stream: { url: "/fixtures/long.mp4", type: "mp4" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    remote.cmd({ type: "PLAY" });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "hidden", { timeout: 8_000 });
    return { tv, remote };
  }

  test("two clicks on the right side skip forward, and a click soon after goes on skipping", async ({ browser, baseURL }) => {
    const { tv, remote } = await playing(browser, baseURL);
    const toast = tv.getByTestId("tv-toast");
    await seekTo(tv, 8);
    await expect.poll(() => tvTime(tv)).toBeGreaterThanOrEqual(8);
    const at = await tvTime(tv);
    await tv.mouse.dblclick(SIDE_RIGHT.x, SIDE_RIGHT.y);
    await expect(toast).toHaveText("+10s");
    await expect(toast).toHaveClass(/side-forward/);
    await expect.poll(() => tvTime(tv)).toBeGreaterThan(at + 8);
    await tv.mouse.click(SIDE_RIGHT.x, SIDE_RIGHT.y); // one more, in the same run: it does not have to be a double itself
    await expect(toast).toHaveText("+20s");
    await expect.poll(() => tvTime(tv)).toBeGreaterThan(at + 18);
    expect(await isFullScreen(tv)).toBe(false); // (a side skips: it is only the middle that goes full screen)
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    remote.close();
  });

  test("two clicks on the left side skip back", async ({ browser, baseURL }) => {
    const { tv, remote } = await playing(browser, baseURL);
    await seekTo(tv, 25);
    await expect.poll(() => tvTime(tv)).toBeGreaterThanOrEqual(25);
    const before = await tvTime(tv);
    await tv.mouse.dblclick(SIDE_LEFT.x, SIDE_LEFT.y);
    await expect(tv.getByTestId("tv-toast")).toHaveText("−10s");
    await expect(tv.getByTestId("tv-toast")).toHaveClass(/side-back/);
    await expect.poll(() => tvTime(tv)).toBeLessThan(before - 8);
    expect(await isFullScreen(tv)).toBe(false);
    remote.close();
  });

  test("a single click is only a click, a moment late: it puts the controls away, and nothing skips", async ({ browser, baseURL }) => {
    const { tv, remote } = await playing(browser, baseURL);
    await seekTo(tv, 8);
    await expect.poll(() => tvTime(tv)).toBeGreaterThanOrEqual(8);
    const at = await tvTime(tv);
    await tv.mouse.click(SIDE_LEFT.x, SIDE_LEFT.y); // (the mouse coming to the picture brought the controls up; the click puts them away)
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "hidden", { timeout: 1_500 }); // (soon: the controls put themselves away after 2.5 s without a click, which would pass for one)
    expect(await tv.getByTestId("tv-toast").count(), "nobody is told of a skip").toBe(0); // (counted once: a toast that was shown and went would pass a wait)
    expect(await tvTime(tv)).toBeGreaterThanOrEqual(at);
    expect(await tvTime(tv)).toBeLessThan(at + 5);
    remote.close();
  });

  test("a button held down on the picture plays it at twice the speed, says so, and lets go of it when it comes up, without a click", async ({ browser, baseURL }) => {
    const { tv, remote } = await playing(browser, baseURL);
    expect(await rate(tv)).toBe(1);
    await tv.mouse.move(SIDE_RIGHT.x, SIDE_RIGHT.y);
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "visible"); // (the mouse coming to the picture brings the controls up)
    await tv.mouse.down();
    await expect(tv.getByTestId("tv-boost")).toBeVisible({ timeout: 3_000 });
    expect(await rate(tv)).toBe(2);
    await expect(tv.getByTestId("tv-toast")).toHaveCount(0); // (a hold is not a change of speed: nobody is told it is)
    await tv.mouse.up();
    await expect(tv.getByTestId("tv-boost")).toHaveCount(0);
    await expect.poll(() => rate(tv)).toBe(1);
    await tv.waitForTimeout(500); // (longer than a click is waited for: the press that was a hold is no click, which would have put the controls away)
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    expect(await hud(tv)).toBe("visible");
    remote.close();
  });

  test("the dot of the bar is picked up and dragged: the times follow the pointer, and the film goes where it is let go", async ({ browser, baseURL }) => {
    const { tv, remote } = await playing(browser, baseURL);
    await tv.mouse.move(640, 600);
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "visible");
    const bar = (await tv.locator(".hud-bar").boundingBox())!;
    const dot = (await tv.locator(".hud-bar-thumb").boundingBox())!;
    const y = dot.y + dot.height / 2;
    await tv.mouse.move(dot.x + dot.width / 2, y);
    await tv.mouse.down();
    await expect(tv.locator(".hud-bar")).toHaveAttribute("data-scrubbing", "true");
    await tv.mouse.move(bar.x + bar.width * 0.4, y, { steps: 8 });
    await tv.mouse.move(bar.x + bar.width * 0.61, y + 60, { steps: 8 }); // (off the line of the bar: the dot goes on following)
    await expect(tv.getByTestId("tv-elapsed")).toHaveText(/^0:2[34]$/); // (61% of forty seconds: the time is where the dot is)
    await expect(tv.locator(".hud-bar")).toHaveAttribute("aria-valuenow", /^2[34]$/);
    expect(await tvTime(tv)).toBeLessThan(15); // (the film has not moved yet: a drag across the bar does not ask for a picture at every pixel of it)
    await tv.mouse.up();
    await expect.poll(() => tvTime(tv)).toBeGreaterThanOrEqual(24);
    await expect(tv.locator(".hud-bar")).not.toHaveAttribute("data-scrubbing", "true");
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    remote.close();
  });

  test("a drag of the dot that the bar could not keep hold of ends where the button comes up, and takes the film there; the dot is not left to follow the mouse", async ({ browser, baseURL }) => {
    const { tv, remote } = await playing(browser, baseURL);
    await tv.mouse.move(640, 600);
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "visible");
    const bar = (await tv.locator(".hud-bar").boundingBox())!;
    const y = bar.y + bar.height / 2;
    // A pointer the browser has no record of, like one that is already gone: asking to keep hold of it is refused, so the bar is never given the end of the drag.
    const send = (type: string, x: number, atY: number, onBody = false) =>
      tv.evaluate(
        ({ type, x, atY, onBody }) => {
          const target = onBody ? document.body : document.querySelector(".hud-bar")!;
          target.dispatchEvent(new PointerEvent(type, { pointerId: 77, pointerType: "mouse", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: atY, bubbles: true, cancelable: true }));
        },
        { type, x, atY, onBody },
      );
    await send("pointerdown", bar.x + bar.width * 0.1, y);
    await send("pointermove", bar.x + bar.width * 0.6, y);
    await expect(tv.locator(".hud-bar")).toHaveAttribute("data-scrubbing", "true");
    await send("pointerup", bar.x + bar.width * 0.6, y - 200, true); // (let go above the bar, where nothing listens but the window)
    await expect(tv.locator(".hud-bar")).not.toHaveAttribute("data-scrubbing", "true", { timeout: 1_000 });
    await expect.poll(() => tvTime(tv)).toBeGreaterThanOrEqual(22);
    await tv.mouse.move(bar.x + bar.width * 0.1, y, { steps: 4 }); // (a mouse that only passes over the bar afterwards moves nothing)
    await tv.waitForTimeout(600);
    expect(await tvTime(tv)).toBeGreaterThanOrEqual(22);
    await expect(tv.locator(".hud-bar")).not.toHaveAttribute("data-scrubbing", "true");
    remote.close();
  });

  test("the dot, held still for a moment, takes the film with it, so that the picture shows what is under it", async ({ browser, baseURL }) => {
    const { tv, remote } = await playing(browser, baseURL);
    await tv.mouse.move(640, 600);
    const bar = (await tv.locator(".hud-bar").boundingBox())!;
    const dot = (await tv.locator(".hud-bar-thumb").boundingBox())!;
    const y = dot.y + dot.height / 2;
    await tv.mouse.move(dot.x + dot.width / 2, y);
    await tv.mouse.down();
    await tv.mouse.move(bar.x + bar.width * 0.7, y, { steps: 6 });
    await expect.poll(() => tvTime(tv), { timeout: 3_000 }).toBeGreaterThanOrEqual(27); // (the button is still down)
    await expect(tv.locator(".hud-bar")).toHaveAttribute("data-scrubbing", "true");
    await tv.mouse.up();
    await expect(tv.locator(".hud-bar")).not.toHaveAttribute("data-scrubbing", "true");
    expect(await tvTime(tv)).toBeGreaterThanOrEqual(27);
    remote.close();
  });

  test("a click on the bar still seeks there", async ({ browser, baseURL }) => {
    const { tv, remote } = await playing(browser, baseURL);
    await tv.mouse.move(640, 600);
    const bar = (await tv.locator(".hud-bar").boundingBox())!;
    await tv.mouse.click(bar.x + bar.width * 0.75, bar.y + bar.height / 2);
    await expect.poll(() => tvTime(tv)).toBeGreaterThanOrEqual(30);
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "visible"); // (a seek is a use of the controls, not a way out of them)
    remote.close();
  });
});

test.describe("a finger on the bars laid over the picture", () => {
  for (const shape of SHAPES) {
    test(`held ${shape.how}: a tap on the title, the clock or the time puts the controls away, like one on the picture; the progress bar still seeks`, async ({ browser }) => {
      const phone = await openFilms(browser, { shape });
      await startFilm(phone);
      for (const part of [".hud-title", ".hud-clock", '[data-testid="tv-elapsed"]']) {
        await showControls(phone);
        const box = (await phone.locator(part).first().boundingBox())!;
        await phone.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await expect(tvRoot(phone), `a tap on ${part}`).toHaveAttribute("data-hud", "hidden");
        await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing");
      }

      await showControls(phone);
      const bar = (await phone.locator(".hud-bar").boundingBox())!;
      await phone.touchscreen.tap(bar.x + bar.width * 0.7, bar.y + bar.height / 2);
      await expect.poll(() => tvTime(phone)).toBeGreaterThan(24); // (70% of forty seconds)
      expect(await hud(phone)).toBe("visible"); // a seek is a use of the controls, not a way out of them
      phone.close();
    });

    test(`held ${shape.how}: a finger drags the dot along the bar, and the film goes where it lifts`, async ({ browser }) => {
      const phone = await openFilms(browser, { shape });
      await startFilm(phone);
      await showControls(phone);
      const cdp = await phone.context().newCDPSession(phone);
      const bar = (await phone.locator(".hud-bar").boundingBox())!;
      const dot = (await phone.locator(".hud-bar-thumb").boundingBox())!;
      const y = dot.y + dot.height / 2;
      const from = dot.x + dot.width / 2;
      const to = bar.x + bar.width * 0.76;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from, y }] });
      for (let step = 1; step <= 6; step++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from + ((to - from) * step) / 6, y }] });
      }
      await expect(phone.getByTestId("tv-elapsed")).toHaveText(/^0:(29|30)$/); // (76% of forty seconds: the time is where the finger is)
      await expect(phone.locator(".hud-bar")).toHaveAttribute("data-scrubbing", "true");
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect.poll(() => tvTime(phone)).toBeGreaterThanOrEqual(29);
      expect(await hud(phone)).toBe("visible"); // (a drag is a use of the controls, not a way out of them)
      phone.close();
    });

    test(`held ${shape.how}: a screen that watches a party along has the bars too, and says what is on, how far it is and who held it`, async ({ browser }) => {
      const host = await openLibrary(browser, withFilms);
      await host.getByTestId("rail-party").click();
      await host.getByTestId("tv-party-start").click();
      const code = (await host.getByTestId("tv-party-code").innerText()).replace(/\s/g, "");
      const phone = await openFilms(browser, { shape });
      await pressMenuLine(phone, "rail-party", "tap");
      await phone.getByTestId("tv-party-join").tap();
      for (const digit of code) await phone.getByTestId(`pad-${digit}`).tap();
      await expect(phone.getByTestId("tv-following")).toBeVisible();
      await expect(host.getByTestId("tv-party-member")).toHaveCount(2);
      const hostName = await host.getByTestId("tv-party-member").first().locator(".tv-party-name").innerText();
      await host.getByTestId("tv-back-to-library").click();
      await playFirst(host);
      await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
      await expect(tvRoot(phone)).toHaveAttribute("data-hud", "hidden", { timeout: 10_000 });

      // What it was told nothing of before: the title, whose film it is, and how far along.
      const middle = { x: shape.width / 2, y: shape.height * 0.35 };
      await phone.touchscreen.tap(middle.x, middle.y);
      await expect(tvRoot(phone)).toHaveAttribute("data-hud", "visible");
      await expect(phone.getByTestId("tv-title")).toBeVisible();
      await expect(phone.getByTestId("tv-title")).toHaveText("long"); // (a link to a file is called what the file is)
      await expect(phone.getByTestId("tv-follow-line")).toContainText(hostName);
      await expect(phone.getByTestId("tv-elapsed")).toBeVisible();
      await expect(phone.locator(".hud-bar")).toHaveAttribute("role", "progressbar"); // (shown where it is, not moved: the host's film is the host's)
      await expect.poll(async () => Number(await phone.locator(".hud-bar").getAttribute("aria-valuenow"))).toBeGreaterThan(0);
      await expect(phone.getByTestId("tv-play-btn")).toHaveCount(0);

      // A tap puts the bars away and the next brings them back, which a guest could not do before; and a tap on the progress bar seeks nothing.
      await phone.touchscreen.tap(middle.x, middle.y);
      await expect(tvRoot(phone)).toHaveAttribute("data-hud", "hidden");
      await phone.touchscreen.tap(middle.x, middle.y);
      await expect(tvRoot(phone)).toHaveAttribute("data-hud", "visible");
      const bar = (await phone.locator(".hud-bar").boundingBox())!;
      const before = await tvTime(phone);
      await phone.touchscreen.tap(bar.x + bar.width * 0.9, bar.y + bar.height / 2);
      await expect(tvRoot(phone)).toHaveAttribute("data-hud", "hidden");
      expect(Math.abs((await tvTime(phone)) - before)).toBeLessThan(3);

      // Who paused it is on the card, inside the screen; and who set it going again is said once.
      await host.keyboard.press("Space");
      await expect(tvRoot(phone)).toHaveAttribute("data-state", "paused", { timeout: 10_000 });
      const held = phone.getByTestId("tv-held");
      await expect(held).toHaveText(`Paused by ${hostName}`);
      const around = (await held.boundingBox())!;
      expect(around.x).toBeGreaterThanOrEqual(0);
      expect(around.x + around.width).toBeLessThanOrEqual(shape.width);
      expect(around.y + around.height).toBeLessThanOrEqual(shape.height);
      await host.keyboard.press("Space");
      await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing", { timeout: 10_000 });
      await expect(phone.getByTestId("tv-toast")).toHaveText(`${hostName} resumed`);
      await expect(held).toHaveCount(0);
      phone.close();
      host.close();
    });
  }
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

  test("a film that ends lets go of the phone for its end card, and Watch again turns it once more", async ({ browser }) => {
    const phone = await watching(browser, { setup: recordOrientation });
    await showControls(phone);
    await phone.getByTestId("tv-fullscreen-btn").tap();
    await expect.poll(() => calls(phone)).toEqual(["lock:landscape"]);

    await phone.evaluate(() => void (document.querySelector("video")!.currentTime = document.querySelector("video")!.duration - 1.2));
    await expect(phone.getByTestId("tv-end")).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => calls(phone)).toEqual(["lock:landscape", "unlock"]);

    await phone.getByTestId("end-again").tap();
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing");
    await expect.poll(() => calls(phone)).toEqual(["lock:landscape", "unlock", "lock:landscape"]);
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

  test("a very long name is cut to a few lines: the card of what is paused stays clear of the controls on every shape of screen", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const remote = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    const long = show(baseURL!, 2);
    long.title = "The Extraordinarily Long Adventures of Professor Bartholomew Wigglesworth and the Mystery of the Missing Lighthouse Keeper · S1 E2";
    long.series!.episodes![1]!.title = "Chapter Seventeen: In Which Everybody Finally Discovers Exactly Where The Treasure Was Hidden All Along";
    remote.cmd({ type: "LOAD", media: long });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    for (const [width, height] of [[1280, 720], [1920, 1080], [844, 390], [768, 1024], [390, 844], [320, 568]] as const) {
      await tv.setViewportSize({ width, height });
      await expect
        .poll(
          async () => {
            const card = (await tv.getByTestId("tv-pause-card").boundingBox())!;
            const button = (await tv.getByTestId("tv-center-btn").boundingBox())!;
            const bar = (await tv.getByTestId("tv-elapsed").boundingBox())!;
            const upright = width <= 520 && height > width; // (the card goes above the button there, and beside it elsewhere)
            const clear = upright ? card.y + card.height <= button.y : card.x + card.width <= button.x;
            return clear && card.y >= 0 && card.y + card.height <= bar.y && card.x >= 0 && card.x + card.width <= width;
          },
          { message: `${width}x${height}` },
        )
        .toBe(true);
    }
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
    await openProfilePlace(tv, "settings");
    const tap = tv.getByTestId("tv-tap-to-pause");
    await expect(tap).toHaveAttribute("aria-checked", "false");
    await tap.click();
    await expect(tap).toHaveAttribute("aria-checked", "true");
    tv.close();
  });
});

test.describe("the profile's choice of letting the picture's quality follow the connection", () => {
  test("is a switch in the phone's Settings, on to begin with, and the choice to turn it off is kept", async ({ browser }) => {
    const phone = await openDevice(browser, PHONE);
    await phone.goto("/");
    const open = async () => {
      await phone.getByTestId("account-button").click();
      await phone.getByTestId("menu-settings").click();
      return phone.getByTestId("adaptive-quality");
    };
    const adaptive = await open();
    await expect(adaptive).toHaveAttribute("aria-checked", "true");
    await adaptive.click();
    await expect(adaptive).toHaveAttribute("aria-checked", "false");

    await phone.reload();
    await expect(await open()).toHaveAttribute("aria-checked", "false");
    phone.close();
  });

  test("is a switch on the TV's own account page too", async ({ browser }) => {
    const tv = await openLibrary(browser, withFilms);
    await openProfilePlace(tv, "settings");
    const adaptive = tv.getByTestId("tv-adaptive-quality");
    await expect(adaptive).toHaveAttribute("aria-checked", "true");
    await adaptive.click();
    await expect(adaptive).toHaveAttribute("aria-checked", "false");
    tv.close();
  });

  /** A screen that is told, by a phone, to play a film that comes in two sizes (the bigger one listed first); the phone has every state the screen reported. */
  async function playTwoSizes(browser: Browser, baseURL: string, seed: Record<string, string>) {
    const tv = await openLibrary(browser, twoSizes, undefined, seed);
    await tv.getByTestId("rail-connect").click();
    const phone = await RawPhone.connect(baseURL, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: { title: "Two sizes", stream: { url: "/fixtures/hls/multi.m3u8", type: "hls" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    phone.cmd({ type: "PLAY" });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    return { tv, phone };
  }
  /** What the screen said of the quality when the first piece was playing. */
  const firstPiece = (phone: RawPhone) => phone.states.find((state) => state.quality?.active !== undefined)?.quality;

  test("on: the first piece of a film is the smallest size, though the film lists a bigger one first, and the button says what it has chosen", async ({ browser, baseURL }) => {
    const { tv, phone } = await playTwoSizes(browser, baseURL!, {});
    await expect.poll(() => firstPiece(phone)).toBeTruthy();
    expect(firstPiece(phone)).toMatchObject({ current: -1, active: 0 }); // (the connection's to choose, and the smallest of the two is the first in the list the screen shows)
    await tv.mouse.move(60, 60);
    await expect(tv.getByTestId("tv-quality-btn")).toHaveText(/^Auto · (180p|720p)$/);
    phone.close();
  });

  test("off: every piece is the biggest size, as it was before the choice", async ({ browser, baseURL }) => {
    const { tv, phone } = await playTwoSizes(browser, baseURL!, guestStorage({ settings: [{ key: "adaptiveQuality", at: Date.now(), value: false }] }));
    await expect.poll(() => firstPiece(phone)).toBeTruthy();
    expect(firstPiece(phone)).toMatchObject({ current: 1, active: 1 });
    await tv.mouse.move(60, 60);
    await expect(tv.getByTestId("tv-quality-btn")).toHaveText("720p");
    phone.close();
  });
});
