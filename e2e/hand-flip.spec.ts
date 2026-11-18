import { expect } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { FIRST_VISIT, NEW_PHONE, openDevice, openTv, readPairingCode, test, tvRoot, withLibrary } from "./helpers";

const films = [
  { id: "filmpire-movie-603", title: "The Matrix", year: 1999, kind: "movie", url: "/fixtures/sample.mp4?n=1" },
  { id: "filmpire-movie-604", title: "The Matrix Reloaded", year: 2003, kind: "movie", url: "/fixtures/sample.mp4?n=2" },
];
const withFilms = withLibrary({ updatedAt: Date.now(), rows: [{ id: "r1", title: "Classics", source: "Test Source", kind: "movie", items: films }] });
const PIXEL = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36";

test.describe("a phone that comes here", () => {
  test("for the first time opens on the library, not on the remote's code: a title's page has Play here and Play on TV", async ({ browser }) => {
    const phone = await openDevice(browser, NEW_PHONE, {}, withFilms);
    await phone.goto("/");
    await expect(phone.getByTestId("tv-browse-tile").first()).toBeVisible();
    await expect(phone.getByTestId("code-input")).toHaveCount(0);
    await phone.getByTestId("tv-browse-tile").first().tap();
    await expect(phone.getByTestId("tv-detail")).toBeVisible();
    await expect(phone.getByTestId("tv-detail-play")).toBeVisible();
    await expect(phone.getByTestId("tv-detail-tv")).toHaveText(en["tv.playOnTv"]);
    const computer = await openDevice(browser, { viewport: { width: 1280, height: 720 } }, {}, withFilms);
    await computer.goto("/");
    await computer.getByTestId("tv-browse-tile").first().click();
    await expect(computer.getByTestId("tv-detail-play")).toBeVisible();
    await expect(computer.getByTestId("tv-detail-tv")).toHaveCount(0);
  });

  test("for the very first time, as a real phone says it is, is a screen too: the welcome, then the library", async ({ browser }) => {
    const phone = await openDevice(browser, { viewport: { width: 412, height: 915 }, screen: { width: 412, height: 915 }, hasTouch: true, isMobile: true, userAgent: PIXEL, storageState: FIRST_VISIT }, {}, withFilms);
    await phone.goto("/");
    await expect(phone.getByTestId("code-input")).toHaveCount(0);
    const welcome = phone.getByTestId("welcome-enter");
    if (await welcome.isVisible().catch(() => false)) await welcome.tap();
    await expect(phone.getByTestId("tv-browse-tile").first()).toBeVisible();
  });

  test("signs in with the typed form first, not with a code for another phone: the code is a press away", async ({ browser }) => {
    const phone = await openDevice(browser, NEW_PHONE, {}, withFilms);
    await phone.goto("/");
    await phone.getByTestId("tv-account-chip").tap();
    await phone.getByTestId("tv-profile-signin").tap();
    await expect(phone.getByTestId("auth-form")).toBeVisible();
    await expect(phone.getByTestId("tv-link-code")).toHaveCount(0);
    await phone.getByTestId("tv-signin-phone").tap();
    await expect(phone.getByTestId("tv-link-code")).toBeVisible();
  });

  test("that is somebody's remote today stays the remote: paired by the TV's code, it opens on the remote again", async ({ browser }) => {
    const tv = await openTv(browser);
    const code = await readPairingCode(tv);
    const phone = await openDevice(browser, NEW_PHONE, {}, withFilms);
    await phone.goto(`/?code=${code}`);
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await phone.goto("/");
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await expect(phone.getByTestId("tv-browse")).toHaveCount(0);
  });

  test("Play on TV: the phone becomes the TV's remote, the TV plays the title, and the phone still opens on the library afterwards", async ({ browser }) => {
    const tv = await openTv(browser);
    const code = await readPairingCode(tv);
    const phone = await openDevice(browser, NEW_PHONE, {}, withFilms);
    await phone.goto("/");
    await phone.getByTestId("tv-browse-tile").first().tap();
    await phone.getByTestId("tv-detail-tv").tap();
    await phone.getByTestId("code-input").fill(code);
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    expect(await tv.locator("video").first().evaluate((video: HTMLVideoElement) => video.currentSrc)).toContain("/fixtures/sample.mp4?n=1");
    await phone.goto("/");
    await expect(phone.getByTestId("tv-browse-tile").first()).toBeVisible();
    await expect(phone.getByTestId("code-input")).toHaveCount(0);
  });
});
