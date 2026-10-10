import { expect, test, type Page } from "@playwright/test";
import { openDevice, openLibrary, openPairedPhone, openTv, PHONE, readPairingCode, tvRoot, withLibrary } from "./helpers";

/** Any device is a screen, and any phone can bring another screen in: the TV page on a phone or a tablet, and the QR codes between devices. */

const films = Array.from({ length: 9 }, (_, i) => ({ id: `f${i}`, title: `Film number ${i + 1}`, year: 1990 + i, url: `/fixtures/sample.mp4?n=${i}` }));
const library = { updatedAt: Date.now(), rows: [{ id: "r1", title: "Classics", source: "Test Source", items: films }] };
const search = (query: string) => films.filter((film) => film.title.toLowerCase().includes(query.toLowerCase()));
const withFilms = withLibrary(library, search);

/** How far the page sticks out sideways (nothing should). */
const sidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
/** How many titles sit side by side in the search results. */
const columns = (page: Page) => page.locator(".tv-results .tv-tile").evaluateAll((tiles) => new Set(tiles.map((tile) => Math.round(tile.getBoundingClientRect().left))).size);
/** What "Search" shows once "film" is typed, on a screen with the device's own keyboard. */
async function searchFilms(page: Page) {
  await page.getByTestId("rail-search").tap();
  await page.getByTestId("tv-query").fill("film");
  await expect(page.getByTestId("tv-browse-tile")).toHaveCount(films.length);
}

test.describe("a phone used as the screen", () => {
  test("the connect page offers it, the library fits the width, and a finger does the rest", async ({ browser }) => {
    const phone = await openDevice(browser, PHONE, {}, withFilms);
    await phone.goto("/");
    await phone.getByTestId("switch-to-tv").tap(); // "Watch on this device"
    await phone.getByTestId("unlock").tap();
    await expect(phone.getByTestId("tv-hero-title")).toHaveText("Film number 1");
    expect(await sidewaysScroll(phone)).toBeLessThanOrEqual(0);

    // Search is typed on the phone's own keyboard, and two titles fit across.
    await searchFilms(phone);
    await expect(phone.getByTestId("tv-query")).toHaveJSProperty("tagName", "INPUT");
    expect(await columns(phone)).toBe(2);
    expect(await sidewaysScroll(phone)).toBeLessThanOrEqual(0);

    // A tap plays a title; the first touch on hidden controls only brings them up, the next one pauses.
    await phone.getByTestId("tv-browse-tile").first().tap();
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    await expect(tvRoot(phone)).toHaveAttribute("data-hud", "hidden", { timeout: 10_000 });
    await phone.touchscreen.tap(195, 420);
    await expect(tvRoot(phone)).toHaveAttribute("data-hud", "visible");
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "playing");
    await phone.touchscreen.tap(195, 420);
    await expect(tvRoot(phone)).toHaveAttribute("data-state", "paused");
  });

  test("the pages that only a remote's arrow keys could leave have a Back button for a finger", async ({ browser }) => {
    const phone = await openDevice(browser, PHONE, {}, withFilms);
    await phone.goto("/tv");
    await phone.getByTestId("unlock").tap();
    await phone.getByTestId("rail-settings").tap();
    await expect(phone.getByTestId("tv-account")).toBeVisible();
    await phone.getByTestId("tv-account-back").tap();
    await expect(phone.getByTestId("tv-browse")).toBeVisible();

    await phone.getByTestId("rail-connect").tap();
    await expect(phone.getByTestId("pairing-code")).toBeVisible();
    await phone.getByTestId("tv-back-to-library").tap();
    await expect(phone.getByTestId("tv-browse")).toBeVisible();
  });

  test("a tablet gets as many titles across as fit, and a phone held sideways keeps everything on screen", async ({ browser }) => {
    const tablet = await openDevice(browser, { viewport: { width: 768, height: 1024 }, hasTouch: true }, {}, withFilms);
    await tablet.goto("/tv");
    await tablet.getByTestId("unlock").tap();
    await expect(tablet.getByTestId("tv-hero-title")).toBeVisible();
    await searchFilms(tablet);
    expect(await columns(tablet)).toBe(4);
    expect(await sidewaysScroll(tablet)).toBeLessThanOrEqual(0);

    const sideways = await openDevice(browser, { viewport: { width: 844, height: 390 }, hasTouch: true }, {}, withFilms);
    await sideways.goto("/tv");
    await sideways.getByTestId("unlock").tap();
    await expect(sideways.getByTestId("tv-hero-title")).toBeVisible();
    // The banner leaves room for a row of titles under it.
    const [heroBottom, firstRowBottom] = await sideways.evaluate(() => [document.querySelector(".tv-hero")!.getBoundingClientRect().bottom, document.querySelector(".tv-row")!.getBoundingClientRect().bottom]);
    expect(heroBottom).toBeLessThan(390 * 0.5);
    expect(firstRowBottom).toBeLessThanOrEqual(390);
    expect(await sidewaysScroll(sideways)).toBeLessThanOrEqual(0);
  });
});

test.describe("a phone that has a TV scans another one", () => {
  /** A phone with its TV, and a second TV showing its code: what its QR code opens on the phone is this address. */
  async function scanned(browser: Parameters<typeof openTv>[0]) {
    const first = await openTv(browser);
    const phone = await openPairedPhone(browser, first);
    const second = await openTv(browser);
    await phone.goto(`/?code=${await readPairingCode(second)}`);
    await expect(phone.getByTestId("other-tv-sheet")).toBeVisible();
    return { first, phone, second };
  }

  test("it asks first, and the other TV can join the watch party", async ({ browser }) => {
    const { first, phone, second } = await scanned(browser);
    await expect(phone.getByTestId("other-tv-sheet")).toContainText(await phone.getByTestId("tv-name").innerText());
    await phone.getByTestId("other-add").click();
    await expect(phone.getByTestId("party-tv")).toHaveCount(1);
    await expect(second.getByTestId("tv-following")).toBeVisible();
    await expect(first.getByTestId("tv-paired")).toBeVisible(); // the phone still has its own TV
  });

  test("or the phone can move over to it, and the first TV is let go", async ({ browser }) => {
    const { first, phone, second } = await scanned(browser);
    await phone.getByTestId("other-switch").click();
    await expect(second.getByTestId("tv-paired")).toBeVisible();
    await expect(first.getByTestId("pairing-code")).toBeVisible();
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
  });

  test("moving over says what it costs when the first TV leads a watch party", async ({ browser }) => {
    const { phone } = await scanned(browser);
    await expect(phone.getByTestId("other-tv-sheet")).not.toContainText("watch party it leads");
    await phone.getByTestId("other-add").click();
    await expect(phone.getByTestId("party-tv")).toHaveCount(1);

    const third = await openTv(browser);
    await phone.goto(`/?code=${await readPairingCode(third)}`);
    await expect(phone.getByTestId("other-tv-sheet")).toContainText("The watch party it leads ends, too.");
  });

  test("or nothing happens at all", async ({ browser }) => {
    const { first, phone, second } = await scanned(browser);
    await phone.getByTestId("other-cancel").click();
    await expect(phone.getByTestId("other-tv-sheet")).toHaveCount(0);
    await expect(phone.getByTestId("party-count")).toHaveCount(0);
    await expect(first.getByTestId("tv-paired")).toBeVisible();
    await expect(second.getByTestId("pairing-code")).toBeVisible();
  });

  test("scanning the QR code of the TV it already has changes nothing", async ({ browser }) => {
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    await phone.getByTestId("menu").click();
    const code = (await phone.getByTestId("control-code").innerText()).replace(/\s/g, "");
    await phone.goto(`/?control=${code}`);
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await expect(phone.getByTestId("other-tv-sheet")).toHaveCount(0);
  });

  test("a TV that has a phone of its own can only be moved over to: there is no party to add it to", async ({ browser }) => {
    const first = await openTv(browser);
    const phone = await openPairedPhone(browser, first);
    const second = await openTv(browser);
    const other = await openPairedPhone(browser, second);
    const code = (await second.getByTestId("tv-join-code").innerText()).replace(/\s/g, "");

    await phone.goto(`/?control=${code}`); // what scanning the QR code on the second TV opens
    await expect(phone.getByTestId("other-tv-sheet")).toBeVisible();
    await expect(phone.getByTestId("other-add")).toHaveCount(0);
    await expect(phone.getByTestId("other-switch")).toBeVisible();

    await phone.getByTestId("other-switch").click();
    await expect(first.getByTestId("pairing-code")).toBeVisible(); // its only phone left, so it is free again
    await expect(second.getByTestId("tv-flash")).toHaveText("A phone is connected.");
    await phone.getByTestId("menu").click();
    await expect(phone.getByTestId("control-card")).toContainText("2 connected");
    await other.close();
  });
});

test.describe("a second phone", () => {
  test("joins from a QR code on the first phone's menu, and can bring another TV into the party", async ({ browser }) => {
    const tv = await openTv(browser);
    const first = await openPairedPhone(browser, tv);
    await first.getByTestId("menu").click();
    const card = first.getByTestId("control-card");
    await expect(card.getByTestId("pairing-qr")).toBeVisible();
    const code = (await card.getByTestId("control-code").innerText()).replace(/\s/g, "");

    const second = await (await browser.newContext(PHONE)).newPage();
    await second.goto(`/?control=${code}`); // what scanning that QR code opens
    await expect(second.getByTestId("tv-online")).toHaveText("TV connected");
    await expect(card).toContainText("2 connected"); // the first phone is told

    const guest = await openTv(browser);
    await second.getByTestId("menu").click();
    await second.getByTestId("party-open").click();
    await second.getByTestId("party-code").fill(await readPairingCode(guest));
    await expect(second.getByTestId("party-tv")).toHaveCount(1);
    await expect(guest.getByTestId("tv-following")).toBeVisible();
  });

  test("joins from the QR code on the TV itself, and the TV says so", async ({ browser }) => {
    const tv = await openTv(browser);
    const first = await openPairedPhone(browser, tv);
    const join = tv.getByTestId("tv-join");
    await expect(join).toBeVisible();
    await expect(join.getByTestId("pairing-qr")).toBeVisible();
    const code = (await tv.getByTestId("tv-join-code").innerText()).replace(/\s/g, "");
    expect(code).toMatch(/^\d{6}$/);

    await first.getByTestId("menu").click(); // the first phone's own card holds the same code
    expect((await first.getByTestId("control-code").innerText()).replace(/\s/g, "")).toBe(code);

    const second = await (await browser.newContext(PHONE)).newPage();
    await second.goto(`/?control=${code}`); // what scanning the QR code on the TV opens
    await expect(second.getByTestId("tv-online")).toHaveText("TV connected");
    await expect(tv.getByTestId("tv-flash")).toHaveText("A phone is connected."); // the page does not change, so a line says it
    await expect(join).toBeVisible();
    await expect(first.getByTestId("control-card")).toContainText("2 connected");
  });

  test("a code typed on the phone works as well as the QR code does", async ({ browser }) => {
    const tv = await openTv(browser);
    await openPairedPhone(browser, tv);
    const code = (await tv.getByTestId("tv-join-code").innerText()).replace(/\s/g, "");
    const second = await (await browser.newContext(PHONE)).newPage();
    await second.goto("/");
    await second.getByTestId("code-input").fill(code);
    await expect(second.getByTestId("tv-online")).toHaveText("TV connected");
  });

  test("the TV asks for that code only while the page that shows it is open", async ({ browser }) => {
    const tv = await openLibrary(browser, (context) =>
      context.addInitScript(() => {
        const counted = window as unknown as { asked: number };
        counted.asked = 0;
        const send = WebSocket.prototype.send;
        WebSocket.prototype.send = function (data) {
          if (typeof data === "string" && data.includes("TV_NEW_CODE")) counted.asked += 1;
          return send.call(this, data);
        };
      }),
    );
    const asked = () => tv.evaluate(() => (window as unknown as { asked: number }).asked);
    await tv.getByTestId("rail-connect").click();
    await openPairedPhone(browser, tv);
    await expect(tv.getByTestId("tv-join-code")).toHaveText(/\d/);
    expect(await asked()).toBe(1);

    await tv.keyboard.press("Escape"); // back to the library: nobody is looking at the code
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await tv.waitForTimeout(600);
    expect(await asked()).toBe(1);

    await tv.getByTestId("rail-connect").click();
    await expect(tv.getByTestId("tv-join-code")).toHaveText(/\d/);
    expect(await asked()).toBe(2);
  });
});
