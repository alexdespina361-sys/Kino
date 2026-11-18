import { expect, type Browser, type Page } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { openDevice, openLibrary, openPairedPhone, openTv, PHONE, playFirst, pressMenuLine, test, tvRoot, withLibrary } from "./helpers";

test.use({ actionTimeout: 15_000 });

const films = Array.from({ length: 4 }, (_, i) => ({ id: `f${i}`, title: `Film number ${i + 1}`, year: 1990 + i, kind: "movie", url: `/fixtures/sample.mp4?n=${i}` }));
const withFilms = withLibrary({ updatedAt: Date.now(), rows: [{ id: "r1", title: "Classics", source: "Test Source", kind: "movie", items: films }] });

const BEFORE = "/api/health";

const hint = (phone: Page) => phone.getByTestId("exit-hint");
async function library(browser: Browser): Promise<Page> {
  const phone = await openDevice(browser, PHONE, {}, withFilms);
  await phone.goto(BEFORE);
  await phone.goto("/tv");
  await expect(phone.getByTestId("tv-browse-tile").first()).toBeVisible();
  return phone;
}
const layers = (phone: Page) => phone.evaluate(() => (history.state as { layers?: number } | null)?.layers ?? 0);
const left = (phone: Page) => expect.poll(() => new URL(phone.url()).pathname).toBe(BEFORE);

test.describe("the Back button of a phone", () => {
  test("a phone used as the screen: Back leaves the film for the library, closes a title's page, and asks before it leaves the site", async ({ browser }) => {
    const phone = await library(browser);
    const address = phone.url();
    const tiles = phone.getByTestId("tv-browse-tile");

    await tiles.first().tap();
    await phone.getByTestId("tv-detail-play").tap();
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    await phone.goBack();
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "idle");
    await expect(phone.getByTestId("tv-browse")).toBeVisible();
    await expect(hint(phone)).toHaveCount(0);
    expect(phone.url()).toBe(address);

    await tiles.first().tap();
    await expect(phone.getByTestId("tv-detail")).toBeVisible();
    await phone.goBack();
    await expect(phone.getByTestId("tv-detail")).toHaveCount(0);
    await expect(hint(phone)).toHaveCount(0);
    expect(phone.url()).toBe(address);

    await phone.goBack();
    await expect(hint(phone)).toHaveText(en["exit.press"]);
    await expect(phone.getByTestId("tv-browse")).toBeVisible();
    expect(phone.url()).toBe(address);
    await phone.goBack();
    await left(phone);
  });

  test("a phone on its side: the wordmark tapped on a title's page goes home, and the next Back neither opens the title again nor leaves the site", async ({ browser }) => {
    const phone = await openDevice(browser, { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }, {}, withFilms);
    await phone.goto(BEFORE);
    await phone.goto("/tv");
    const address = phone.url();
    await phone.getByTestId("tv-browse-tile").first().tap();
    await expect(phone.getByTestId("tv-detail")).toBeVisible();
    const mark = (await phone.getByTestId("tv-logo-home").boundingBox())!;
    await phone.touchscreen.tap(mark.x + mark.width / 2, mark.y + mark.height / 2);
    await expect(phone.getByTestId("tv-detail")).toHaveCount(0);
    await expect(phone.getByTestId("tv-browse")).toHaveAttribute("data-view", "home");
    await expect.poll(() => layers(phone)).toBe(0);

    await phone.goBack();
    await expect(hint(phone)).toHaveText(en["exit.press"]);
    await expect(phone.getByTestId("tv-detail")).toHaveCount(0);
    expect(phone.url()).toBe(address);
  });

  test("a question that nobody answered is over after a moment, and so is it at the next touch: the next Back asks again instead of leaving", async ({ browser }) => {
    const phone = await library(browser);
    const address = phone.url();
    const tiles = phone.getByTestId("tv-browse-tile");
    await tiles.first().tap();
    await phone.goBack();
    await expect(phone.getByTestId("tv-detail")).toHaveCount(0);

    await phone.goBack();
    await expect(hint(phone)).toBeVisible();
    await expect(hint(phone)).toHaveCount(0, { timeout: 6_000 });
    await phone.goBack();
    await expect(hint(phone)).toBeVisible();
    expect(phone.url()).toBe(address);

    await tiles.nth(1).tap();
    await expect(phone.getByTestId("tv-detail")).toBeVisible();
    await expect(hint(phone)).toHaveCount(0);
    await phone.goBack();
    await expect(phone.getByTestId("tv-detail")).toHaveCount(0);
    await expect(hint(phone)).toHaveCount(0);
    await phone.goBack();
    await expect(hint(phone)).toBeVisible();
    expect(phone.url()).toBe(address);
    await phone.goBack();
    await left(phone);
  });

  test("a Back before the first touch is the browser's own: there is nothing to lose yet", async ({ browser }) => {
    const phone = await library(browser);
    await phone.goBack();
    await left(phone);
  });

  test("after the page is loaded again, Back goes through what the earlier visit left on the history, and still asks at the bottom", async ({ browser }) => {
    const phone = await library(browser);
    const address = phone.url();
    await phone.getByTestId("tv-browse-tile").first().tap();
    await expect(phone.getByTestId("tv-detail")).toBeVisible();
    expect(await layers(phone)).toBe(1);

    await phone.reload();
    await expect(phone.getByTestId("tv-browse-tile").first()).toBeVisible();
    await expect(phone.getByTestId("tv-detail")).toHaveCount(0);
    await phone.goBack();
    await expect(hint(phone)).toBeVisible();
    expect(phone.url()).toBe(address);
    await phone.goBack();
    await left(phone);
  });

  test("a phone that is the remote: a sheet closes first, then Back puts the remote away while the film plays on, and a tap on the line brings it back", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.getByTestId("url-input").fill(`${baseURL}/fixtures/sample.mp4`);
    await phone.getByTestId("play-url").tap();
    await expect(phone.getByTestId("player-state")).toHaveAttribute("data-state", "playing");
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    const address = phone.url();

    await phone.getByTestId("chip-speed").tap();
    await expect(phone.getByTestId("speed-sheet")).toBeVisible();
    await phone.goBack();
    await expect(phone.getByTestId("speed-sheet")).toHaveCount(0);
    await expect(phone.getByTestId("media-title")).toBeVisible();

    await phone.goBack();
    await expect(phone.getByTestId("media-title")).toHaveCount(0);
    await expect(phone.getByTestId("playing-bar")).toBeVisible();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    expect(phone.url()).toBe(address);

    await phone.getByTestId("playing-bar").tap();
    await expect(phone.getByTestId("media-title")).toBeVisible();
    await phone.goBack();
    await expect(phone.getByTestId("playing-bar")).toBeVisible();

    await phone.goBack();
    await expect(hint(phone)).toHaveText(en["exit.press"]);
    await expect(phone.getByTestId("playing-bar")).toBeVisible();
    expect(phone.url()).toBe(address);
    await phone.goBack();
    expect(phone.url()).toBe("about:blank");
  });

  test("a phone that watches a party along: Back asks before it leaves the party, and the host carries on", async ({ browser }) => {
    const host = await openLibrary(browser, withFilms);
    await host.getByTestId("rail-party").click();
    await host.getByTestId("tv-party-start").click();
    const code = (await host.getByTestId("tv-party-code").innerText()).replace(/\s/g, "");

    const phone = await library(browser);
    await pressMenuLine(phone, "rail-party", "tap");
    await phone.getByTestId("tv-party-join").tap();
    for (const digit of code) await phone.getByTestId(`pad-${digit}`).tap();
    await expect(phone.getByTestId("tv-following")).toBeVisible();
    await expect(host.getByTestId("tv-party-member")).toHaveCount(2);
    await host.getByTestId("tv-back-to-library").click();
    await playFirst(host);
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });

    await phone.goBack();
    await expect(hint(phone)).toHaveText(en["exit.leaveParty"]);
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing");
    await expect(phone.getByTestId("tv-follow-bar")).toBeVisible();
    await expect.poll(() => layers(phone)).toBe(1);
    await phone.goBack();
    await expect(tvRoot(phone)).not.toHaveAttribute("data-state", "playing");
    await expect(phone.getByTestId("tv-follow-bar")).toHaveCount(0);
    await expect(phone.getByTestId("tv-party-start")).toBeVisible();
    await expect(tvRoot(host)).toHaveAttribute("data-state", "playing");
    await phone.goBack();
    await expect(phone.getByTestId("tv-browse")).toBeVisible();
    await expect(hint(phone)).toHaveCount(0);
  });

  test("a screen that is not hand-held keeps its keys: no guard, no entry on the history, and Escape does what it did", async ({ browser }) => {
    const tv = await openLibrary(browser, withFilms);
    await tv.getByTestId("tv-browse-tile").first().click();
    await expect(tv.getByTestId("tv-detail")).toBeVisible();
    expect(await tv.evaluate(() => history.state)).toBeNull();
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
    expect(await tv.evaluate(() => history.length)).toBe(2);
  });
});

