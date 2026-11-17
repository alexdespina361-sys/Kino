import { expect, type BrowserContext, type Page } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { openDevice, openTv, readPairingCode, seeded, test, withLibrary } from "./helpers";

/*
 * The Android app, offered on a phone's browser with Android (app/GetTheApp.tsx, the owner, 17 Nov: "in profile, show a download the app banner (or website
 * wide) for phone screen"): a card on the profile's page, and on the other pages a line under the top that pushes the page down, until it is put away. The
 * e2e server keeps no app, so the release is answered here as the box answers it.
 */

const PIXEL = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const SHAPE = { viewport: { width: 412, height: 915 }, screen: { width: 412, height: 915 }, hasTouch: true, isMobile: true } as const;
const RELEASE = { versionCode: 2, versionName: "0.2.0", size: 3_141_676, sha256: "a".repeat(64), url: "/app/android/kino-2.apk", notes: "Stickers from WhatsApp" };
const films = [{ id: "filmpire-movie-603", title: "The Matrix", year: 1999, kind: "movie", url: "/fixtures/sample.mp4?n=1" }];
const withFilms = withLibrary({ updatedAt: Date.now(), rows: [{ id: "r1", title: "Classics", source: "Test Source", kind: "movie", items: films }] });
/** "3 MB", as the page writes it: the number and the unit kept on one line. */
const SIZE = "3 MB";

/** The library, and the release as the box says it (`late`: after that long); `asked` counts the times the page asked for it. */
function withRelease(asked: { count: number }, late = 0) {
  return async (context: BrowserContext) => {
    await withFilms(context);
    await context.route("**/api/app/android", async (route) => {
      asked.count++;
      if (late) await new Promise((resolve) => setTimeout(resolve, late));
      return route.fulfill({ json: RELEASE });
    });
  };
}

async function openPhone(page: Page) {
  await page.goto("/");
  const welcome = page.getByTestId("welcome-enter");
  if (await welcome.isVisible().catch(() => false)) await welcome.tap();
  await expect(page.getByTestId("tv-browse-tile").first()).toBeVisible();
}

const inside = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth + 0.5 && box.top >= 0;
  });

/** Whether what is under the middle of a button is that button (nothing drawn over it). */
const onTop = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((element) => {
    const box = element.getBoundingClientRect();
    const there = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return there !== null && (there === element || element.contains(there));
  });

const topOf = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!.y;

test.describe("the Android app, offered on a phone", () => {
  test("on an Android phone's browser the line is in the page under its top, pushing the rows down and over none of the top's buttons; a press the moment it came does nothing; × puts it away for good; the profile's page has the card instead", async ({ browser }) => {
    test.setTimeout(90_000);
    const asked = { count: 0 };
    const phone = await openDevice(browser, { ...SHAPE, userAgent: PIXEL, storageState: seeded() }, {}, async (context) => {
      await withRelease(asked)(context);
      // (A press the moment the line came in: on its buttons as soon as they are there, and whether the page let that press do what it does.)
      await context.addInitScript(() => {
        const early: Record<string, boolean> = {};
        (window as unknown as { early: typeof early }).early = early;
        const pressed = new Set<string>();
        new MutationObserver(() => {
          for (const id of ["get-app-strip-download", "get-app-strip-close"]) {
            const button = document.querySelector<HTMLElement>(`[data-testid='${id}']`);
            if (!button || pressed.has(id)) continue;
            pressed.add(id);
            const heard = (event: Event) => {
              early[id] = event.defaultPrevented;
            };
            window.addEventListener("click", heard, { once: true });
            button.click();
          }
        }).observe(document, { childList: true, subtree: true });
      });
    });
    await openPhone(phone);
    const strip = phone.getByTestId("get-app-strip");
    await expect(strip).toBeVisible({ timeout: 10_000 });
    // the two presses that came at once did nothing: no download, and the line is still there
    expect(await phone.evaluate(() => (window as unknown as { early: Record<string, boolean> }).early)).toEqual({ "get-app-strip-download": true, "get-app-strip-close": true });
    await expect(strip).toBeVisible();
    expect(await phone.evaluate(() => localStorage.getItem("kino.appStrip"))).toBeNull();

    await expect(strip.locator("p b")).toHaveText(en["app.get.title"]);
    await expect(strip.locator("p span")).toHaveText(en["app.get.stripSize"].replace("{size}", SIZE));
    expect(await inside(phone, "get-app-strip"), "the line is on the screen").toBe(true);
    // in the page: under the top, over none of its buttons, and the rows under it
    const top = (await phone.locator(".tv-browse-top").boundingBox())!;
    const line = (await strip.boundingBox())!;
    expect(line.y, "under the top").toBeGreaterThanOrEqual(top.y + top.height - 0.5);
    for (const button of ["tv-account-chip", "tv-logo-home"]) expect(await onTop(phone, button), `${button} is not covered`).toBe(true);
    expect(await topOf(phone, ".tv-rows"), "the rows are under it").toBeGreaterThanOrEqual(line.y + line.height - 0.5);
    const get = phone.getByTestId("get-app-strip-download");
    await expect(get).toHaveAttribute("href", "/app/kino.apk");
    await expect(get).toHaveAttribute("download", "kino.apk");
    await expect(phone.getByTestId("get-app-strip-close")).toHaveAttribute("aria-label", en["app.get.stripClose"]);
    await expect(phone.getByRole("complementary", { name: en["app.get.title"] })).toBeVisible();

    // a phone held sideways has no room for it
    await phone.setViewportSize({ width: 915, height: 412 });
    await expect(strip).toBeHidden();
    await phone.setViewportSize({ width: 412, height: 915 });
    await expect(strip).toBeVisible();

    // the profile's page has the card, and no line over it
    await phone.getByTestId("tv-account-chip").tap();
    await expect(phone.getByTestId("tv-profile-name")).toBeVisible();
    const card = phone.getByTestId("get-app");
    await expect(card).toBeVisible();
    await expect(strip).toHaveCount(0);
    await expect(card).toContainText(en["app.get.title"]);
    await expect(card).toContainText("0.2.0");
    await expect(card).toContainText(SIZE);
    const download = phone.getByTestId("get-app-download");
    await expect(download).toHaveAttribute("href", "/app/kino.apk");
    await expect(download).toHaveText(en["app.get.download"]);
    expect(await inside(phone, "get-app"), "the card is in the page's width").toBe(true);
    const head = await phone.getByTestId("tv-profile-settings").boundingBox();
    const at = await card.boundingBox();
    expect(at!.y, "under the profile's buttons").toBeGreaterThan(head!.y);
    // back home, the line is drawn with the page at once
    await phone.getByTestId("tv-logo-home").tap();
    await expect(strip).toBeVisible({ timeout: 1_000 });
    await phone.waitForTimeout(600);
    await phone.getByTestId("get-app-strip-close").tap();
    await expect(strip).toHaveCount(0);
    await phone.reload();
    await expect(phone.getByTestId("tv-browse-tile").first()).toBeVisible();
    await phone.waitForTimeout(4_000);
    await expect(strip, "put away for good").toHaveCount(0);
    expect(asked.count, "asked for once a page").toBeLessThanOrEqual(2);
  });

  test("the line does not come in under a finger: while one is down it waits, and it comes a moment after the page was let go", async ({ browser }) => {
    test.setTimeout(90_000);
    const phone = await openDevice(browser, { ...SHAPE, userAgent: PIXEL, storageState: seeded() }, {}, withRelease({ count: 0 }, 2_500));
    await openPhone(phone);
    const strip = phone.getByTestId("get-app-strip");
    await expect(strip).toHaveCount(0);
    // a finger down on the top, where nothing is pressed, held past the moment the release came
    const top = (await phone.locator(".tv-browse-top").boundingBox())!;
    const cdp = await phone.context().newCDPSession(phone);
    const at = { x: Math.round(top.x + top.width / 2), y: Math.round(top.y + top.height / 2) };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
    await phone.waitForTimeout(4_000);
    await expect(strip, "not while the finger is down").toHaveCount(0);
    const rows = await topOf(phone, ".tv-rows");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const lifted = Date.now();
    await phone.waitForTimeout(1_000);
    await expect(strip, "not at once after it").toHaveCount(0);
    expect(await topOf(phone, ".tv-rows"), "nothing moved under the finger").toBe(rows);
    await expect(strip).toBeVisible({ timeout: 6_000 });
    expect(Date.now() - lifted, "a moment after the page was let go").toBeGreaterThanOrEqual(1_800);
  });

  test("a phone that is the remote has the line under its top, which stays while the box for a link is typed in, and the card on its You page instead", async ({ browser }) => {
    test.setTimeout(90_000);
    const tv = await openTv(browser);
    const code = await readPairingCode(tv);
    const phone = await openDevice(browser, { ...SHAPE, userAgent: PIXEL, storageState: seeded([{ name: "kino.role", value: "remote" }]) }, {}, withRelease({ count: 0 }));
    await phone.goto(`/?code=${code}`);
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    const strip = phone.getByTestId("get-app-strip");
    await expect(strip).toBeVisible({ timeout: 10_000 });
    const top = (await phone.locator("header.top").boundingBox())!;
    expect((await strip.boundingBox())!.y, "under the top").toBeGreaterThanOrEqual(top.y + top.height - 0.5);
    expect(await onTop(phone, "account-button"), "the account's button is not covered").toBe(true);
    // (once in, it stays: typing does not take it away and move the page under the finger)
    const box = phone.getByTestId("url-input");
    const before = (await box.boundingBox())!.y;
    await box.tap();
    await box.fill("https://example.com/film.mp4");
    await phone.waitForTimeout(1_200);
    await expect(strip).toBeVisible();
    expect((await box.boundingBox())!.y, "the box did not move").toBe(before);
    await box.fill("");

    await phone.getByTestId("account-button").tap();
    await expect(phone.getByTestId("account-screen")).toBeVisible();
    const card = phone.getByTestId("get-app");
    await expect(card).toBeVisible();
    await expect(card).toContainText("0.2.0");
    expect(await inside(phone, "get-app")).toBe(true);
    await expect(strip).toHaveCount(0);
  });

  test("nothing on an iPhone, nor in the app itself (by its bridge or by its user agent), nor in another app's window onto the web: not even the question to the site", async ({ browser }) => {
    test.setTimeout(150_000);
    const agents = { iphone: IPHONE, app: PIXEL, "app's agent": `${PIXEL} KinoApp/0.2.0`, "a WebView": PIXEL.replace("Pixel 9)", "Pixel 9; wv)") };
    for (const [kind, userAgent] of Object.entries(agents)) {
      const asked = { count: 0 };
      const phone = await openDevice(browser, { ...SHAPE, userAgent, storageState: seeded() }, {}, async (context) => {
        await withRelease(asked)(context);
        // (the app gives its pages `window.KinoApp`: see app/kinoApp.ts)
        if (kind === "app") await context.addInitScript(() => void ((window as unknown as { KinoApp: object }).KinoApp = { postMessage: () => undefined }));
      });
      await openPhone(phone);
      await phone.waitForTimeout(3_000);
      await expect(phone.getByTestId("get-app-strip"), kind).toHaveCount(0);
      await phone.getByTestId("tv-account-chip").tap();
      await expect(phone.getByTestId("tv-profile-name")).toBeVisible();
      await expect(phone.getByTestId("get-app"), kind).toHaveCount(0);
      expect(asked.count, kind).toBe(0);
    }
  });
});
