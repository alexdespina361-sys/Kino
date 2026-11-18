import { expect, type Page } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { openDevice, openLibrary, PHONE, test } from "./helpers";

const hint = (page: Page) => page.getByTestId("update-hint");

async function asks(page: Page, build?: string) {
  await page.unroute("**/api/build");
  if (build) await page.route("**/api/build", (route) => route.fulfill({ json: { build }, headers: { "cache-control": "no-store" } }));
  const answered = page.waitForResponse("**/api/build");
  await page.evaluate(() => window.dispatchEvent(new Event("vite:preloadError")));
  await answered;
}

const film = (page: Page, on: boolean) =>
  page.evaluate((show) => {
    document.getElementById("e2e-film")?.remove();
    if (!show) return;
    const video = document.createElement("video");
    video.id = "e2e-film";
    video.style.cssText = "position:fixed;inset:0;width:100%;height:100%;background:#000";
    document.body.append(video);
  }, on);

test.describe("a new Kino while a page is open (the owner's ask, 17 Nov)", () => {
  test("on a phone: a bar at the top says so, × puts it off until yet another is out, it waits while a film is on the screen, and Reload reloads", async ({ browser }) => {
    const phone = await openDevice(browser, PHONE);
    await phone.goto("/");
    await phone.waitForLoadState("networkidle");
    const real = await phone.evaluate(async () => ((await (await fetch("/api/build", { cache: "no-store" })).json()) as { build: unknown }).build);
    const mine = await phone.evaluate(() => /\/assets\/(index-[\w-]+)\.js/.exec([...document.scripts].map((script) => script.src).find((src) => /\/assets\/index-/.test(src)) ?? "")?.[1]);
    expect(real).toMatch(/^index-[\w-]+$/);
    expect(real).toBe(mine);
    await asks(phone);
    await phone.waitForTimeout(300);
    await expect(hint(phone)).toHaveCount(0);

    await asks(phone, "index-e2eNew1");
    await expect(hint(phone)).toBeVisible();
    await expect(hint(phone)).toContainText(en["update.ready"]);
    const box = (await hint(phone).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y).toBeLessThan(80);

    await phone.getByTestId("update-later").click();
    await expect(hint(phone)).toHaveCount(0);
    await asks(phone, "index-e2eNew1");
    await phone.waitForTimeout(300);
    await expect(hint(phone)).toHaveCount(0);

    await film(phone, true);
    await asks(phone, "index-e2eNew2");
    await phone.waitForTimeout(2500);
    await expect(hint(phone)).toHaveCount(0);
    await film(phone, false);
    await expect(hint(phone)).toBeVisible();

    const reloaded = phone.waitForEvent("load");
    await phone.getByTestId("update-reload").click();
    await reloaded;
    await phone.waitForTimeout(500);
    await expect(hint(phone)).toHaveCount(0);
  });

  test("on a TV that is only a remote: asked once the remote has been put down for a minute, the question has the remote's keys, Back is Later and gives the focus back", async ({ browser }) => {
    const tv = await openLibrary(browser, (context) => context.clock.install());
    await tv.waitForLoadState("networkidle");
    await tv.keyboard.press("ArrowDown");
    const before = await tv.evaluate(() => document.activeElement?.outerHTML.slice(0, 200) ?? "");

    await asks(tv, "index-e2eNew1");
    await tv.clock.fastForward(5_000);
    await expect(hint(tv)).toHaveCount(0);
    await tv.evaluate(() => window.addEventListener("keydown", () => ((window as unknown as { heard: boolean }).heard = true), true));
    await tv.clock.fastForward(60_000);
    await expect(hint(tv)).toBeVisible();
    await expect(tv.getByTestId("update-later")).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("update-later")).toBeFocused();
    await tv.keyboard.press("ArrowLeft");
    await expect(tv.getByTestId("update-reload")).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("update-reload")).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("update-later")).toBeFocused();
    expect(await tv.evaluate(() => (window as unknown as { heard?: boolean }).heard)).toBeUndefined();
    await tv.keyboard.press("Escape");
    await expect(hint(tv)).toHaveCount(0);
    expect(await tv.evaluate(() => document.activeElement?.outerHTML.slice(0, 200) ?? "")).toBe(before);

    await asks(tv, "index-e2eNew2");
    await tv.evaluate(() => {
      const box = document.createElement("input");
      box.id = "e2e-box";
      document.body.append(box);
      box.focus();
    });
    await tv.clock.fastForward(61_000);
    await tv.waitForTimeout(300);
    await expect(hint(tv)).toHaveCount(0);
    await tv.evaluate(() => {
      document.getElementById("e2e-box")?.remove();
      const open = document.createElement("div");
      open.id = "e2e-window";
      open.setAttribute("aria-modal", "true");
      document.body.append(open);
    });
    await tv.clock.fastForward(3_000);
    await tv.waitForTimeout(300);
    await expect(hint(tv)).toHaveCount(0);
    await tv.evaluate(() => document.getElementById("e2e-window")?.remove());
    await tv.clock.fastForward(3_000);
    await expect(hint(tv)).toBeVisible();

    await expect(tv.getByTestId("update-later")).toBeFocused();
    await tv.clock.fastForward(5_000);
    await tv.clock.pauseAt((await tv.evaluate(() => Date.now())) + 100);
    await tv.keyboard.press("Enter");
    await expect(hint(tv)).toBeVisible();
    await tv.keyboard.press("ArrowLeft");
    await tv.keyboard.press("Enter");
    await expect(hint(tv)).toBeVisible();
    await tv.clock.fastForward(1_500);
    await expect(tv.getByTestId("update-reload")).toBeFocused();
    const reloaded = tv.waitForEvent("load");
    await tv.keyboard.press("Enter");
    await reloaded;
  });
});
