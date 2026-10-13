import { expect, type Page } from "@playwright/test";
import { FIRST_VISIT, openDevice, openLibrary, RawPhone, readPairingCode, test, tvRoot, withLibrary } from "./helpers";

/** What a Hisense set's browser (VIDAA) says it is: the page knows it by the "VIDAA" in it. */
const VIDAA = "Mozilla/5.0 (Linux; U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.31 Safari/537.36 VIDAA/6.0";
const TV_SIZE = { width: 1280, height: 720 };

const filmsOf = (baseURL: string) => ({
  updatedAt: Date.now(),
  rows: [{ id: "r", title: "Films", source: "Test", items: [{ id: "a", title: "The Sample", url: `${baseURL}/fixtures/sample.mp4` }] }],
});

/** Counts what the page asks of the browser for a full screen (and grants it, without the window really changing). */
const countFullscreenRequests = () => {
  (window as unknown as { __asked: number }).__asked = 0;
  Element.prototype.requestFullscreen = function () {
    (window as unknown as { __asked: number }).__asked++;
    return Promise.resolve();
  };
};
const asked = (page: Page) => page.evaluate(() => (window as unknown as { __asked: number }).__asked);

test.describe("TV browsers with a player of their own (Hisense's)", () => {
  test("the video asks for no player of the browser's own, and controls that something adds to it are taken off", async ({ browser }) => {
    const tv = await openLibrary(browser);
    const video = tv.locator("video.tv-video");
    await expect(video).toHaveAttribute("controlslist", /nofullscreen/);
    await expect(video).toHaveAttribute("controlslist", /noremoteplayback/);
    await expect(video).toHaveAttribute("disablepictureinpicture", "");
    await expect(video).toHaveAttribute("disableremoteplayback", "");
    await expect(video).toHaveAttribute("playsinline", "");
    await expect(video).toHaveAttribute("x5-video-player-type", "h5-page");
    await expect(video).not.toHaveAttribute("controls");

    await video.evaluate((element) => element.setAttribute("controls", ""));
    await expect(video).not.toHaveAttribute("controls");
    const menuIsStopped = await video.evaluate((element) => {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(menuIsStopped).toBe(true);
  });

  test("OK that comes as a key down and up with no typed Enter (as a TV browser may send it) still presses the button it is on", async ({ browser, baseURL }) => {
    const tv = await openLibrary(browser, withLibrary(filmsOf(baseURL!)));
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
    await tv.evaluate(() => {
      (window as unknown as { __clicks: number }).__clicks = 0;
      document.addEventListener("click", () => (window as unknown as { __clicks: number }).__clicks++, true);
    });
    const clicks = () => tv.evaluate(() => (window as unknown as { __clicks: number }).__clicks);

    const browserLink = await tv.context().newCDPSession(tv);
    const ok = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    await browserLink.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...ok }); // (a typed Enter would be a "keyDown", which also sends the character)
    await browserLink.send("Input.dispatchKeyEvent", { type: "keyUp", ...ok });
    await expect(tv.getByTestId("tv-detail-play")).toBeFocused(); // the title's own page is open
    expect(await clicks()).toBe(1);

    await tv.keyboard.press("Enter"); // a typed one is the browser's own press, and only that
    await expect(tvRoot(tv)).toHaveAttribute("data-state", /loading|playing/);
    await tv.waitForTimeout(300);
    expect(await clicks()).toBe(2);
  });

  test("a Hisense browser is never asked for a full screen: not at the first press, not by a key, not by the phone, and the controls have no button for it", async ({ browser, baseURL }) => {
    const tv = await openDevice(browser, { viewport: TV_SIZE, userAgent: VIDAA, storageState: FIRST_VISIT }, {}, withLibrary(filmsOf(baseURL!)));
    await tv.addInitScript(countFullscreenRequests);
    await tv.goto("/tv");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(tv.getByTestId("fullscreen-toggle")).toHaveCount(0); // (the library's corner button)
    await expect(tv.getByTestId("welcome-enter")).toHaveCount(0); // the welcome has nothing to ask
    await tv.keyboard.press("Shift"); // a first press: anywhere else it takes the page full screen
    await tv.waitForTimeout(400);
    expect(await asked(tv)).toBe(0);

    await tv.getByTestId("rail-connect").click();
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    await expect(tv.getByTestId("tv-paired")).toBeVisible();
    phone.playUrl(`${baseURL}/fixtures/sample.mp4`);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    await tv.keyboard.press("ArrowDown"); // brings the controls up
    await expect(tv.getByTestId("tv-stop-btn")).toBeVisible();
    await expect(tv.getByTestId("tv-fullscreen-btn")).toHaveCount(0); // the bar is there, without a button for a full screen

    await tv.keyboard.press("f");
    phone.cmd({ type: "TOGGLE_FULLSCREEN" }); // what the phone's button sends
    await tv.waitForTimeout(500);
    expect(await asked(tv)).toBe(0);
    await expect(tv.getByTestId("fs-prompt")).toHaveCount(0); // nor is the viewer asked to press OK for it
    phone.close();
  });

  test("?fullscreen=off keeps any browser from being asked, on this visit and the next ones, until ?fullscreen=on", async ({ browser, baseURL }) => {
    const tv = await openDevice(browser, { viewport: TV_SIZE, storageState: FIRST_VISIT }, {}, withLibrary(filmsOf(baseURL!)));
    await tv.goto("/tv?fullscreen=off");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(tv.getByTestId("fullscreen-toggle")).toHaveCount(0);
    await expect(tv.getByTestId("welcome-enter")).toHaveCount(0);

    await tv.goto("/tv"); // remembered
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(tv.getByTestId("fullscreen-toggle")).toHaveCount(0);
    await expect(tv.getByTestId("welcome-enter")).toHaveCount(0);

    await tv.goto("/tv?fullscreen=on");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(tv.getByTestId("fullscreen-toggle")).toBeVisible();
    await expect(tv.getByTestId("welcome-enter")).toBeVisible();
  });

  test("?debug shows what the browser is and what its keys do, is kept for the next visits, and ?debug=0 takes it away", async ({ browser, baseURL }) => {
    const tv = await openDevice(browser, { viewport: TV_SIZE, userAgent: VIDAA }, {}, withLibrary(filmsOf(baseURL!)));
    await tv.goto("/tv?debug=1");
    const panel = tv.locator("#kino-debug");
    await expect(panel).toContainText("KINO DEBUG");
    await expect(panel).toContainText("VIDAA/6.0");
    await expect(panel).toContainText("hisense true");
    await expect(panel).toContainText("focus-visible:Y");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    // Where the TV's id is kept, as the last four characters of it: the same after the browser was closed means it was not wiped.
    const id = await tv.evaluate(() => localStorage.getItem("tv.deviceId") ?? "");
    expect(id).toMatch(/^tv_/);
    await expect(panel).toContainText(`tv.deviceId storage ${id.slice(-4)} cookie ${id.slice(-4)}`);

    await tv.keyboard.press("ArrowRight");
    await expect(panel).toContainText(/v ArrowRight ArrowRight #39 on/);
    await expect(panel).toContainText(/\^ ArrowRight/); // (and the release)

    await tv.goto("/tv"); // kept
    await expect(tv.locator("#kino-debug")).toBeVisible();
    await tv.goto("/tv?debug=0");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(tv.locator("#kino-debug")).toHaveCount(0);
    await tv.goto("/tv");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(tv.locator("#kino-debug")).toHaveCount(0);
  });
});
