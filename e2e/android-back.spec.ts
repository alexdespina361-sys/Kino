import { expect, type Browser, type Page } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { openDevice, openLibrary, openPairedPhone, openTv, PHONE, playFirst, test, tvRoot, withLibrary } from "./helpers";

/**
 * The Back button of an Android phone (the button, the swipe from the edge of the screen). Every Back goes back a page, as a back button does, and
 * at the bottom of the site, where the next one would leave it, the first only asks ("Press Back again to leave") and a second one leaves.
 * The tests press Back as the browser does (`page.goBack()`) on a touch screen, and tell "left the site" by the page the phone was on before it.
 * What they cannot show is the browser's own rule for entries a page makes without a touch (see shared/backButton.ts): that is in the unit tests.
 */

test.use({ actionTimeout: 15_000 });

const films = Array.from({ length: 4 }, (_, i) => ({ id: `f${i}`, title: `Film number ${i + 1}`, year: 1990 + i, kind: "movie", url: `/fixtures/sample.mp4?n=${i}` }));
const withFilms = withLibrary({ updatedAt: Date.now(), rows: [{ id: "r1", title: "Classics", source: "Test Source", kind: "movie", items: films }] });

/** The page a phone is on before the site: a Back that leaves the site lands here. */
const BEFORE = "/api/health";

const hint = (phone: Page) => phone.getByTestId("exit-hint");
/** The phone's library, opened on a touch screen with a page before it. */
async function library(browser: Browser): Promise<Page> {
  const phone = await openDevice(browser, PHONE, {}, withFilms);
  await phone.goto(BEFORE);
  await phone.goto("/tv");
  await expect(phone.getByTestId("tv-browse-tile").first()).toBeVisible();
  return phone;
}
/** How many entries of the history stand for something open on the page (the guard under them is none). */
const layers = (phone: Page) => phone.evaluate(() => (history.state as { layers?: number } | null)?.layers ?? 0);
/** The page left the site: it is on the one before it. */
const left = (phone: Page) => expect.poll(() => new URL(phone.url()).pathname).toBe(BEFORE);

test.describe("the Back button of a phone", () => {
  test("a phone used as the screen: Back leaves the film for the library, closes a title's page, and asks before it leaves the site", async ({ browser }) => {
    const phone = await library(browser);
    const address = phone.url();
    const tiles = phone.getByTestId("tv-browse-tile");

    // The film was chosen from a title's page and Back leaves it, to the library: the site stays.
    await tiles.first().tap();
    await phone.getByTestId("tv-detail-play").tap();
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    await phone.goBack();
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "idle");
    await expect(phone.getByTestId("tv-browse")).toBeVisible();
    await expect(hint(phone)).toHaveCount(0);
    expect(phone.url()).toBe(address);

    // A title's page goes the same way.
    await tiles.first().tap();
    await expect(phone.getByTestId("tv-detail")).toBeVisible();
    await phone.goBack();
    await expect(phone.getByTestId("tv-detail")).toHaveCount(0);
    await expect(hint(phone)).toHaveCount(0);
    expect(phone.url()).toBe(address);

    // At the library nothing is left to go back to but the site's door: the first Back says so and stays, the second goes through it.
    await phone.goBack();
    await expect(hint(phone)).toHaveText(en["exit.press"]);
    await expect(phone.getByTestId("tv-browse")).toBeVisible();
    expect(phone.url()).toBe(address);
    await phone.goBack();
    await left(phone);
  });

  test("a question that nobody answered is over after a moment, and so is it at the next touch: the next Back asks again instead of leaving", async ({ browser }) => {
    const phone = await library(browser);
    const address = phone.url();
    const tiles = phone.getByTestId("tv-browse-tile");
    // (A page that nobody has touched has nothing to lose: the browser lets a Back go before the first touch, see the next test.)
    await tiles.first().tap();
    await phone.goBack();
    await expect(phone.getByTestId("tv-detail")).toHaveCount(0);

    await phone.goBack();
    await expect(hint(phone)).toBeVisible();
    await expect(hint(phone)).toHaveCount(0, { timeout: 6_000 }); // (it goes by itself)
    await phone.goBack(); // a Back long after the first is a first Back again
    await expect(hint(phone)).toBeVisible();
    expect(phone.url()).toBe(address);

    await tiles.nth(1).tap(); // a touch anywhere is the end of the question too, and what it opened closes with one Back
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
    await phone.goBack(); // (the entry of the title's page the earlier visit made is of no use to this one: it is passed on the way)
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
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing"); // (the film is not stopped by a Back)
    expect(phone.url()).toBe(address);

    await phone.getByTestId("playing-bar").tap();
    await expect(phone.getByTestId("media-title")).toBeVisible();
    await phone.goBack();
    await expect(phone.getByTestId("playing-bar")).toBeVisible();

    // The library of the remote is where the site's door is.
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
    await phone.getByTestId("rail-party").tap();
    await phone.getByTestId("tv-party-join").tap();
    for (const digit of code) await phone.getByTestId(`pad-${digit}`).tap();
    await expect(phone.getByTestId("tv-following")).toBeVisible();
    await expect(host.getByTestId("tv-party-member")).toHaveCount(2);
    await host.getByTestId("tv-back-to-library").click();
    await playFirst(host);
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });

    await phone.goBack(); // a Back is too easy to make by mistake for this one: it asks
    await expect(hint(phone)).toHaveText(en["exit.leaveParty"]);
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing");
    await expect(phone.getByTestId("tv-follow-bar")).toBeVisible();
    await expect.poll(() => layers(phone)).toBe(1); // (the film's entry is put back for the answer)
    await phone.goBack();
    await expect(tvRoot(phone)).not.toHaveAttribute("data-state", "playing");
    await expect(phone.getByTestId("tv-follow-bar")).toHaveCount(0);
    await expect(phone.getByTestId("tv-party-start")).toBeVisible(); // (the party's page, where leaving a party lands, as it does for the remote's key)
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
    expect(await tv.evaluate(() => history.length)).toBe(2); // (the blank page, and this one)
  });
});

