import { expect, type Page } from "@playwright/test";
import type { NormalizedMedia } from "../src/shared";
import { openLibrary, openTv, RawPhone, readPairingCode, test, tvRoot, withLibrary } from "./helpers";

/**
 * A screen that can only move a mouse and click (an air mouse, a TV in its pointer mode) has no wheel and no keys to scroll with, so a pointer that
 * rests against the bottom or the top edge of the screen for a second scrolls the page that way. Everybody else must not meet it: a key, the wheel,
 * a press or a finger ends it, and it needs a page that has somewhere to go.
 */

const film = (id: string, title: string) => ({ id, title, year: 2000, url: `/fixtures/sample.mp4?n=${id}` });
const rowOf = (id: string, title: string) => ({ id, title, source: "Test Source", items: Array.from({ length: 8 }, (_, i) => film(`${id}-${i}`, `${title} ${i + 1}`)) });
const tall = { updatedAt: Date.now(), rows: Array.from({ length: 14 }, (_, i) => rowOf(`r${i}`, `Row ${i + 1}`)) };
const short = { updatedAt: Date.now(), rows: [rowOf("only", "Only row")] };

/** The strip is 18 px on a 720 px screen. */
const BOTTOM = 718;
const TOP = 2;
const MIDDLE = 400;
const X = 640;

const edge = (tv: Page) => tv.getByTestId("tv-edge-scroll");
const rows = (tv: Page) => tv.locator(".tv-rows");
const scrolled = (tv: Page) => rows(tv).evaluate((element) => element.scrollTop);
/** The page opens, and the welcome is gone from over it. */
async function openTall(browser: Parameters<typeof openLibrary>[0]): Promise<Page> {
  const tv = await openLibrary(browser, withLibrary(tall));
  await expect(tv.getByTestId("tv-welcome")).toHaveCount(0, { timeout: 8_000 });
  expect(await rows(tv).evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(400); // (a page with somewhere to go)
  return tv;
}
/** The pointer comes into the strip from the middle of the screen, as a hand brings it. */
async function restAtBottom(tv: Page, x = X) {
  await tv.mouse.move(x, MIDDLE);
  await tv.mouse.move(x, BOTTOM);
}
/** The pointer has not moved the page for as long as it takes to be sure of it. */
async function staysPut(tv: Page, ms = 1_500) {
  const before = await scrolled(tv);
  await tv.waitForTimeout(ms);
  expect(await scrolled(tv)).toBe(before);
}

test.describe("scrolling with the pointer at the edge of the screen", () => {
  test("a pointer that rests against the bottom edge says so at once, scrolls the page after a second, and stops where it leaves", async ({ browser }) => {
    const tv = await openTall(browser);
    await restAtBottom(tv);
    await expect(edge(tv)).toHaveAttribute("data-edge", "bottom");
    await expect(edge(tv)).toHaveAttribute("data-phase", "waiting");
    await tv.waitForTimeout(500);
    expect(await scrolled(tv)).toBe(0); // (not yet: a pointer that only stopped here for a moment moves nothing)
    await expect(edge(tv)).toHaveAttribute("data-phase", "waiting");

    await expect.poll(() => scrolled(tv), { timeout: 6_000 }).toBeGreaterThan(100);
    await expect(edge(tv)).toHaveAttribute("data-phase", "moving");

    await tv.mouse.move(X, MIDDLE);
    await expect(edge(tv)).toHaveCount(0);
    await staysPut(tv, 800);
  });

  test("the top edge scrolls back up, by the same rule", async ({ browser }) => {
    const tv = await openTall(browser);
    await rows(tv).evaluate((element) => {
      element.scrollTop = 1_200;
    });
    const from = await scrolled(tv);
    expect(from).toBeGreaterThan(500);
    await tv.mouse.move(X, MIDDLE);
    await tv.mouse.move(X, TOP);
    await expect(edge(tv)).toHaveAttribute("data-edge", "top");
    await expect(edge(tv)).toHaveAttribute("data-phase", "waiting");
    await tv.waitForTimeout(500);
    expect(await scrolled(tv)).toBe(from);
    await expect.poll(() => scrolled(tv), { timeout: 6_000 }).toBeLessThan(from - 100);
    await expect(edge(tv)).toHaveAttribute("data-phase", "moving");
  });

  test("it goes on to the end of the page and no further, and says nothing where there is nothing to scroll", async ({ browser }) => {
    const tv = await openTall(browser);
    await rows(tv).evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const end = await scrolled(tv);
    await restAtBottom(tv);
    await tv.waitForTimeout(1_500);
    await expect(edge(tv)).toHaveCount(0); // (the bottom edge of a page that is at its bottom)
    expect(await scrolled(tv)).toBe(end);
    // ...and the top edge of it has somewhere to go.
    await tv.mouse.move(X, MIDDLE);
    await tv.mouse.move(X, TOP);
    await expect(edge(tv)).toHaveAttribute("data-edge", "top");
  });

  test("a pointer that only passes through the strip moves nothing", async ({ browser }) => {
    const tv = await openTall(browser);
    await restAtBottom(tv);
    await expect(edge(tv)).toHaveAttribute("data-phase", "waiting");
    await tv.waitForTimeout(300);
    await tv.mouse.move(X, MIDDLE);
    await expect(edge(tv)).toHaveCount(0);
    await staysPut(tv);
  });

  for (const [how, end] of [
    ["a key", (tv: Page) => tv.keyboard.press("Shift")],
    ["a press", async (tv: Page) => {
      await tv.mouse.down({ button: "right" });
      await tv.mouse.up({ button: "right" });
    }],
  ] as const) {
    test(`${how} ends it, and the pointer has to leave the strip and come back before it counts again`, async ({ browser }) => {
      const tv = await openTall(browser);
      await restAtBottom(tv);
      await expect(edge(tv)).toHaveAttribute("data-phase", "waiting");
      await tv.waitForTimeout(300);
      await end(tv);
      await expect(edge(tv)).toHaveCount(0);
      await staysPut(tv, 1_600);

      // Moving about inside the strip is not coming back.
      await tv.mouse.move(X + 40, BOTTOM - 3);
      await tv.mouse.move(X + 80, BOTTOM);
      await expect(edge(tv)).toHaveCount(0);
      await staysPut(tv);

      // Out of it, and in again, is.
      await tv.mouse.move(X, MIDDLE);
      await tv.mouse.move(X, BOTTOM);
      await expect(edge(tv)).toHaveAttribute("data-phase", "waiting");
      const from = await scrolled(tv);
      await expect.poll(() => scrolled(tv), { timeout: 6_000 }).toBeGreaterThan(from + 100);
    });
  }

  test("a wheel ends it for good: a screen that has one never meets it again", async ({ browser }) => {
    const tv = await openTall(browser);
    await restAtBottom(tv);
    await expect.poll(() => scrolled(tv), { timeout: 6_000 }).toBeGreaterThan(50); // (it was moving)
    await tv.mouse.wheel(0, 30);
    await expect(edge(tv)).toHaveCount(0);
    await tv.waitForTimeout(400); // (the wheel turns the page itself a little: it is where that stops that counts)
    await staysPut(tv, 1_200);
    // Out of the strip and in again, and the other strip too: nothing is offered.
    await tv.mouse.move(X, MIDDLE);
    await tv.mouse.move(X, BOTTOM);
    await tv.waitForTimeout(1_800);
    await expect(edge(tv)).toHaveCount(0);
    await staysPut(tv, 300);
    await tv.mouse.move(X, MIDDLE);
    await tv.mouse.move(X, TOP);
    await tv.waitForTimeout(1_800);
    await expect(edge(tv)).toHaveCount(0);
  });

  test("a key ends one that is already moving the page", async ({ browser }) => {
    const tv = await openTall(browser);
    await restAtBottom(tv);
    await expect.poll(() => scrolled(tv), { timeout: 6_000 }).toBeGreaterThan(50);
    await tv.keyboard.press("Shift");
    await expect(edge(tv)).toHaveCount(0);
    await staysPut(tv, 800);
  });

  for (const pointerType of ["touch", "pen"]) {
    test(`${pointerType} never starts it, and ends one that a mouse started`, async ({ browser }) => {
      const tv = await openTall(browser);
      const move = (type: string, y: number) =>
        tv.evaluate(([kind, clientY]) => window.dispatchEvent(new PointerEvent("pointermove", { pointerType: kind, clientX: 640, clientY, bubbles: true })), [type, y] as const);
      await move(pointerType, BOTTOM);
      await tv.waitForTimeout(1_500);
      await expect(edge(tv)).toHaveCount(0);
      expect(await scrolled(tv)).toBe(0);

      await restAtBottom(tv);
      await expect(edge(tv)).toHaveAttribute("data-phase", "waiting");
      await move(pointerType, MIDDLE);
      await expect(edge(tv)).toHaveCount(0);
      await staysPut(tv);
    });
  }

  test("a pointer on the menu rail, or with a button held, is not waiting for the page", async ({ browser }) => {
    const tv = await openTall(browser);
    await tv.mouse.move(30, MIDDLE);
    await tv.mouse.move(30, BOTTOM); // (the menu opens under a pointer that rests on it)
    await tv.waitForTimeout(1_500);
    await expect(edge(tv)).toHaveCount(0);
    expect(await scrolled(tv)).toBe(0);

    await tv.mouse.move(X, MIDDLE);
    await tv.mouse.down({ button: "right" });
    await tv.mouse.move(X, BOTTOM);
    await tv.waitForTimeout(1_500);
    await expect(edge(tv)).toHaveCount(0);
    expect(await scrolled(tv)).toBe(0);
    await tv.mouse.up({ button: "right" });
  });

  test("a page that has nowhere to go gets no hint, and nothing moves", async ({ browser }) => {
    // (A screen so tall that the whole of the page fits.)
    const tv = await openLibrary(browser, withLibrary(short), { width: 1280, height: 2_400 });
    await expect(tv.getByTestId("tv-welcome")).toHaveCount(0, { timeout: 8_000 });
    expect(await rows(tv).evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(12);
    await tv.mouse.move(X, 1_200);
    await tv.mouse.move(X, 2_395);
    await tv.waitForTimeout(1_500);
    await expect(edge(tv)).toHaveCount(0);
    expect(await scrolled(tv)).toBe(0);
  });

  test("it is not there while a film is on the screen", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    const media: NormalizedMedia = { title: "The Long Night", stream: { url: "/fixtures/sample.mp4", type: "mp4" } };
    phone.cmd({ type: "LOAD", media });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await tv.mouse.move(X, MIDDLE);
    await tv.mouse.move(X, BOTTOM);
    await tv.waitForTimeout(1_500);
    await expect(edge(tv)).toHaveCount(0);
    await tv.mouse.move(X, TOP);
    await tv.waitForTimeout(1_500);
    await expect(edge(tv)).toHaveCount(0);
    phone.close();
  });
});
