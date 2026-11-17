import { expect, type BrowserContext, type Page } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { openDevice, openTv, readPairingCode, seeded, test, withLibrary } from "./helpers";

/*
 * The Android app, offered on a phone's browser with Android (app/GetTheApp.tsx, the owner, 17 Nov: "in profile, show a download the app banner (or website
 * wide) for phone screen"): a card on the profile's page, and the site's line at the top a few seconds after a page opens, until it is put away. The e2e
 * server keeps no app, so the release is answered here as the box answers it.
 */

const PIXEL = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const SHAPE = { viewport: { width: 412, height: 915 }, screen: { width: 412, height: 915 }, hasTouch: true, isMobile: true } as const;
const RELEASE = { versionCode: 2, versionName: "0.2.0", size: 3_141_676, sha256: "a".repeat(64), url: "/app/android/kino-2.apk", notes: "Stickers from WhatsApp" };
const films = [{ id: "filmpire-movie-603", title: "The Matrix", year: 1999, kind: "movie", url: "/fixtures/sample.mp4?n=1" }];
const withFilms = withLibrary({ updatedAt: Date.now(), rows: [{ id: "r1", title: "Classics", source: "Test Source", kind: "movie", items: films }] });

/** The library, and the release as the box says it; `asked` counts the times the page asked for it. */
function withRelease(asked: { count: number }) {
  return async (context: BrowserContext) => {
    await withFilms(context);
    await context.route("**/api/app/android", (route) => {
      asked.count++;
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

test.describe("the Android app, offered on a phone", () => {
  test("on an Android phone's browser the site's line comes a few seconds after the page opens and × puts it away for good; the profile's page has the card: which version, how big, and the newest APK", async ({ browser }) => {
    test.setTimeout(90_000);
    const asked = { count: 0 };
    const phone = await openDevice(browser, { ...SHAPE, userAgent: PIXEL, storageState: seeded() }, {}, withRelease(asked));
    await openPhone(phone);
    const strip = phone.getByTestId("get-app-strip");
    await expect(strip).toHaveCount(0); // (not the first thing over a page being drawn)
    await expect(strip).toBeVisible({ timeout: 10_000 });
    await expect(strip).toContainText(en["app.get.strip"].replace("{size}", "3 MB"));
    // (the size is not broken over two lines)
    expect(await strip.locator("p").evaluate((words) => words.textContent)).toContain("3 MB");
    expect(await inside(phone, "get-app-strip"), "the line is on the screen").toBe(true);
    const get = phone.getByTestId("get-app-strip-download");
    await expect(get).toHaveAttribute("href", "/app/kino.apk");
    await expect(get).toHaveAttribute("download", "kino.apk");
    await phone.getByTestId("get-app-strip-close").tap();
    await expect(strip).toHaveCount(0);
    await phone.reload();
    await expect(phone.getByTestId("tv-browse-tile").first()).toBeVisible();
    await phone.waitForTimeout(6_000);
    await expect(strip, "put away for good").toHaveCount(0);

    // the profile's page: the card under its head
    await phone.getByTestId("tv-account-chip").tap();
    await expect(phone.getByTestId("tv-profile-name")).toBeVisible();
    const card = phone.getByTestId("get-app");
    await expect(card).toBeVisible();
    await expect(card).toContainText(en["app.get.title"]);
    await expect(card).toContainText("0.2.0");
    await expect(card).toContainText("3 MB");
    const download = phone.getByTestId("get-app-download");
    await expect(download).toHaveAttribute("href", "/app/kino.apk");
    await expect(download).toHaveText(en["app.get.download"]);
    expect(await inside(phone, "get-app"), "the card is in the page's width").toBe(true);
    const head = await phone.getByTestId("tv-profile-settings").boundingBox();
    const at = await card.boundingBox();
    expect(at!.y, "under the profile's buttons").toBeGreaterThan(head!.y);
    expect(asked.count, "asked for once a page").toBeLessThanOrEqual(2);
  });

  test("a phone that is the remote has the card on its You page, for the same app", async ({ browser }) => {
    test.setTimeout(90_000);
    const tv = await openTv(browser);
    const code = await readPairingCode(tv);
    const phone = await openDevice(browser, { ...SHAPE, userAgent: PIXEL, storageState: seeded([{ name: "kino.role", value: "remote" }, { name: "kino.appStrip", value: "away" }]) }, {}, withRelease({ count: 0 }));
    await phone.goto(`/?code=${code}`);
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");
    await phone.getByTestId("account-button").tap();
    await expect(phone.getByTestId("account-screen")).toBeVisible();
    const card = phone.getByTestId("get-app");
    await expect(card).toBeVisible();
    await expect(card).toContainText("0.2.0");
    expect(await inside(phone, "get-app")).toBe(true);
    await expect(phone.getByTestId("get-app-strip")).toHaveCount(0);
  });

  test("nothing on an iPhone, nor in the app itself: not even the question to the site", async ({ browser }) => {
    test.setTimeout(90_000);
    for (const kind of ["iphone", "app"] as const) {
      const asked = { count: 0 };
      const phone = await openDevice(browser, { ...SHAPE, userAgent: kind === "iphone" ? IPHONE : PIXEL, storageState: seeded() }, {}, async (context) => {
        await withRelease(asked)(context);
        // (the app gives its pages `window.KinoApp`: see app/kinoApp.ts)
        if (kind === "app") await context.addInitScript(() => void ((window as unknown as { KinoApp: object }).KinoApp = { postMessage: () => undefined }));
      });
      await openPhone(phone);
      await phone.waitForTimeout(6_000);
      await expect(phone.getByTestId("get-app-strip"), kind).toHaveCount(0);
      await phone.getByTestId("tv-account-chip").tap();
      await expect(phone.getByTestId("tv-profile-name")).toBeVisible();
      await expect(phone.getByTestId("get-app"), kind).toHaveCount(0);
      expect(asked.count, kind).toBe(0);
    }
  });
});
