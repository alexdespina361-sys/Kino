import { expect, type BrowserContext, type Page } from "@playwright/test";
import { openLibrary, openTvSettings, playFirst, test, withLibrary } from "./helpers";

/**
 * The cat companion (client/cat): a cat that lives on the TV's screen, only for a screen that asks for one and a host that offers it. It walks along the
 * rows of posters, rests in a corner of the film away from the controls and the subtitles, is stroked by a hand, and finds a title on the page on
 * request; it never starts anything. The tests offer the cat the way the host does (`/api/features`) and use the cat's own diagnostics (?cat=debug).
 */

const film = (id: string, title: string) => ({ id, title, year: 2001, url: `/fixtures/sample.mp4?n=${id}` });
const library = {
  updatedAt: Date.now(),
  rows: [
    { id: "comedy", title: "Comedy Movies", source: "Test Source", items: Array.from({ length: 10 }, (_, index) => film(`c${index}`, `Funny film ${index + 1}`)) },
    { id: "horror", title: "Horror Movies", source: "Test Source", items: Array.from({ length: 10 }, (_, index) => film(`h${index}`, `Scary film ${index + 1}`)) },
    { id: "trending", title: "Trending Movies", source: "Test Source", items: Array.from({ length: 10 }, (_, index) => film(`t${index}`, `Fresh film ${index + 1}`)) },
  ],
};

const offered = (yes: boolean) => (context: BrowserContext) => context.route("**/api/features", (route) => route.fulfill({ json: { cat: yes } }));
const setup = (yes = true) => async (context: BrowserContext) => {
  await offered(yes)(context);
  await withLibrary(library)(context);
};
/** A device that has turned the cat on (as its settings page does), in the way it starts: not quiet. */
const WANTS = (over: Record<string, unknown> = {}) => ({ "kino.cat": JSON.stringify({ on: true, quiet: false, films: true, ...over }) });

interface Snap {
  frame: { x: number; y: number; clip: string; appear: number; petted: boolean; grounded: boolean };
  engine: { act: string; surfaceId: string | null; mode: string; placed: boolean };
  view: string;
  why: string;
  quality: string;
  panel: boolean;
  visible: boolean;
  places: number;
  posters: number;
}
const snap = (tv: Page) => tv.evaluate(() => (window as unknown as { __kinoCat: { snapshot(): unknown } }).__kinoCat.snapshot()) as Promise<Snap>;
/** Whatever the cat itself says it is doing is told with a failure, for whoever reads it. */
const saying = async <T>(tv: Page, wait: () => Promise<T>): Promise<T> => {
  try {
    return await wait();
  } catch (error) {
    console.log("THE CAT:", JSON.stringify(await snap(tv).catch(() => null)));
    throw error;
  }
};
const catIsOnTheScreen = (tv: Page) => saying(tv, () => expect(tv.getByTestId("cat")).toHaveAttribute("data-visible", "true", { timeout: 12_000 }));
/** The cat is on a shelf of the library, in sight. */
const catIsOnTheShelves = (tv: Page) =>
  saying(tv, () =>
    expect
      .poll(async () => {
        const seen = await snap(tv);
        return seen.engine.mode === "browse" && seen.engine.placed && seen.frame.appear > 0.95 && !(seen.engine.surfaceId ?? "perch").startsWith("perch");
      }, { timeout: 12_000 })
      .toBe(true),
  );
/** The cat is on its perch in the film (it was on the shelves a moment ago, and is not there until it has been out of the library and back in). */
const catIsOnItsPerch = (tv: Page) =>
  saying(tv, () =>
    expect
      .poll(async () => {
        const seen = await snap(tv);
        return seen.engine.mode === "player" && seen.engine.placed && seen.frame.appear > 0.95 && (seen.engine.surfaceId ?? "").startsWith("perch");
      }, { timeout: 12_000 })
      .toBe(true),
  );

test("a screen that did not ask for a cat has none, and the cat's file is never fetched", async ({ browser }) => {
  const tv = await (async () => {
    const asked: string[] = [];
    const page = await openLibrary(browser, async (context) => {
      await setup(true)(context);
      context.on("request", (request) => asked.push(request.url()));
    });
    await page.waitForTimeout(1500);
    expect(asked.filter((url) => /\/assets\/host-/.test(url))).toEqual([]);
    return page;
  })();
  await expect(tv.getByTestId("cat")).toHaveCount(0);
  await expect(tv.getByTestId("tv-cat-chip")).toHaveCount(0);
});

test("a host that does not offer a cat gets none, whatever the device or the address says", async ({ browser }) => {
  const tv = await openLibrary(browser, setup(false), undefined, WANTS());
  await tv.goto("/tv?cat=on");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await tv.waitForTimeout(1500);
  await expect(tv.getByTestId("cat")).toHaveCount(0);
  await expect(tv.getByTestId("tv-cat-chip")).toHaveCount(0);
});

test("a device that asked for the cat has one on the library: it walks on the rows, is a layer that the page's clicks go through, and has its button in the corner", async ({ browser }) => {
  const tv = await openLibrary(browser, setup(), undefined, WANTS());
  await catIsOnTheScreen(tv);
  await expect(tv.getByTestId("tv-cat-chip")).toBeVisible();
  const layer = tv.getByTestId("cat");
  await expect(layer).toHaveAttribute("aria-hidden", "true");
  await expect(layer).toHaveCSS("pointer-events", "none");
  await expect(layer).toHaveCSS("position", "absolute");
  // the library still has its own focus and its own keys: the cat takes neither
  await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
  await tv.keyboard.press("ArrowRight");
  await expect(tv.getByTestId("tv-browse-tile").nth(1)).toBeFocused();
  // the cat's own box takes a hand and nothing else of the page's
  expect(await tv.evaluate(() => document.querySelector(".kino-cat-canvas")!.getAttribute("tabindex"))).toBeNull();
});

test("the remote opens the cat's panel from the corner, walks it, and Back puts the remote where it was", async ({ browser }) => {
  const tv = await openLibrary(browser, setup(), undefined, WANTS());
  await catIsOnTheScreen(tv);
  const chip = tv.getByTestId("tv-cat-chip");
  for (let step = 0; step < 8 && !(await chip.evaluate((element) => element === document.activeElement)); step++) await tv.keyboard.press(step < 3 ? "ArrowUp" : "ArrowRight");
  await expect(chip).toBeFocused();
  await tv.keyboard.press("Enter");
  const panel = tv.getByTestId("cat-panel");
  await expect(panel).toBeVisible();
  await expect(tv.getByTestId("cat-find")).toBeFocused();
  // the arrows are the panel's while it is open: nothing behind it moves
  await tv.keyboard.press("ArrowDown");
  await expect(tv.getByTestId("cat-come")).toBeFocused();
  await tv.keyboard.press("ArrowRight");
  await expect(tv.getByTestId("cat-pet")).toBeFocused();
  await tv.keyboard.press("ArrowUp");
  await expect(tv.getByTestId("cat-find")).toBeFocused();
  // find me something is a screen of its own, and Back steps out of it
  await tv.keyboard.press("Enter");
  await expect(panel).toHaveAttribute("data-screen", "mood");
  await tv.keyboard.press("Escape");
  await expect(panel).toHaveAttribute("data-screen", "menu");
  await tv.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(chip).toBeFocused();
  // the panel is not a dialog: the cat was never sent away for it
  expect((await snap(tv).catch(() => null))?.why ?? "").toBe("");
});

test("find me something: the cat picks a title from a shelf of that mood, points at it, and only the viewer opens it", async ({ browser }) => {
  const tv = await openLibrary(browser, setup(), undefined, WANTS());
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await catIsOnTheScreen(tv);
  await tv.getByTestId("tv-cat-chip").click();
  await tv.getByTestId("cat-find").click();
  await tv.getByTestId("cat-mood-scary").click();
  const card = tv.getByTestId("cat-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Scary film"); // (from the Horror shelf, and from no other, and it says which)
  await expect(card).toContainText("Horror Movies");
  const id = await card.getAttribute("data-id");
  expect(id).toMatch(/^h\d$/);
  // the poster glows, and the cat goes to it (briskly: somebody waits) and puts a paw out
  await expect(tv.locator(`[data-entry="${id}"][data-cat-pointed]`)).toHaveCount(1);
  await saying(tv, () => expect.poll(async () => (await snap(tv)).frame.clip, { timeout: 25_000 }).toBe("point"));
  // another one is another title
  await tv.getByTestId("cat-another").click();
  await expect(card).not.toHaveAttribute("data-id", id!);
  // nothing has started: the library is still where it was
  await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
  await expect(tv.getByTestId("tv")).not.toHaveAttribute("data-state", "playing");
  // Open it opens the title's page, like OK on its poster does, and the glow is gone
  await tv.getByTestId("cat-open").click();
  await expect(tv.getByTestId("tv-detail")).toBeVisible();
  await expect(tv.locator("[data-cat-pointed]")).toHaveCount(0);
  await expect(tv.getByTestId("tv")).not.toHaveAttribute("data-state", "playing");
});

test("a mood that no shelf of the page has finds nothing, and says so", async ({ browser }) => {
  const tv = await openLibrary(browser, setup(), undefined, WANTS());
  await catIsOnTheScreen(tv);
  await tv.getByTestId("tv-cat-chip").click();
  await tv.getByTestId("cat-find").click();
  await tv.getByTestId("cat-mood-romantic").click();
  await expect(tv.getByTestId("cat-nothing")).toBeVisible();
  await expect(tv.getByTestId("cat-card")).toHaveCount(0);
  await expect(tv.getByTestId("cat-back")).toBeFocused();
});

test("a title's page over the library sends the cat away, and it is back when the page is closed", async ({ browser }) => {
  const tv = await openLibrary(browser, setup(), undefined, WANTS());
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await catIsOnTheScreen(tv);
  await tv.getByTestId("tv-browse-tile").first().click();
  await expect(tv.getByTestId("tv-detail")).toBeVisible();
  await expect(tv.getByTestId("cat")).toHaveAttribute("data-mode", "away");
  await expect.poll(async () => (await snap(tv)).frame.appear, { timeout: 5_000 }).toBeLessThan(0.05);
  await expect(tv.getByTestId("cat")).toBeHidden();
  await tv.keyboard.press("Escape");
  await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
  await expect(tv.getByTestId("cat")).toHaveAttribute("data-mode", "browse");
  await catIsOnTheShelves(tv);
});

test("in a film the cat rests in a corner of the picture, out of the controls' way, and the film plays on", async ({ browser }) => {
  const tv = await openLibrary(browser, setup(), undefined, WANTS());
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await catIsOnTheScreen(tv);
  await playFirst(tv);
  await expect(tv.getByTestId("tv")).toHaveAttribute("data-state", "playing");
  await catIsOnItsPerch(tv);
  // in the picture's own box, straight after the picture, so that every control and every line of the subtitles is drawn over the cat
  const place = await tv.evaluate(() => {
    const layer = document.querySelector('[data-testid="cat"]')!;
    return { parent: layer.parentElement?.getAttribute("data-testid"), after: layer.previousElementSibling?.tagName.toLowerCase() };
  });
  expect(place).toEqual({ parent: "tv", after: "video" });
  const seen = await snap(tv);
  const screen = tv.viewportSize()!;
  expect(seen.frame.y).toBeGreaterThan(screen.height * 0.85); // (the foot of the picture, in a corner)
  expect(seen.frame.x < screen.width * 0.4 || seen.frame.x > screen.width * 0.6).toBe(true);
  // it settles to sleep while the film plays, and the film is the viewer's: it is still playing
  await expect.poll(async () => (await snap(tv)).frame.clip, { timeout: 15_000 }).toMatch(/loaf|curl/);
  await expect(tv.getByTestId("tv")).toHaveAttribute("data-state", "playing");
  // the controls come up: the cat is gone from where they are (nothing of the film's is covered), and it is back when they have gone
  await tv.keyboard.press("ArrowDown");
  await expect(tv.getByTestId("tv")).toHaveAttribute("data-hud", "visible");
  await expect.poll(async () => (await snap(tv)).frame.appear, { timeout: 5_000 }).toBeLessThan(0.05);
  await expect(tv.getByTestId("tv")).not.toHaveAttribute("data-hud", "visible", { timeout: 20_000 });
  await catIsOnItsPerch(tv);
  await expect(tv.getByTestId("tv")).toHaveAttribute("data-state", "playing");
  // Back leaves the film (the first press brings the controls up, the next one leaves): the cat is on the shelves again
  await expect(async () => {
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-browse")).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  await catIsOnTheShelves(tv);
});

test("a device that asked for no cat in films has the cat on the shelves only", async ({ browser }) => {
  const tv = await openLibrary(browser, setup(), undefined, WANTS({ films: false }));
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await catIsOnTheScreen(tv);
  await playFirst(tv);
  await expect(tv.getByTestId("tv")).toHaveAttribute("data-state", "playing");
  await expect(tv.getByTestId("cat")).toBeHidden({ timeout: 6_000 });
  expect((await snap(tv)).why).toBe("films off");
});

test("a hand rests on the cat and it is stroked; a pointer that only passes over it is not", async ({ browser }) => {
  const tv = await openLibrary(browser, setup(), undefined, WANTS({ quiet: true }));
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await catIsOnTheScreen(tv);
  await tv.waitForTimeout(1500);
  const where = async () => {
    const box = (await tv.getByTestId("cat-hit").boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  let at = await where();
  await tv.mouse.move(at.x - 300, at.y - 100);
  await tv.mouse.move(at.x, at.y, { steps: 4 });
  await tv.mouse.move(at.x - 300, at.y - 100, { steps: 4 });
  await tv.waitForTimeout(500);
  expect((await snap(tv)).frame.petted).toBe(false);
  at = await where();
  await tv.mouse.move(at.x, at.y, { steps: 3 });
  await expect.poll(async () => (await snap(tv)).frame.petted, { timeout: 4_000 }).toBe(true);
  await tv.mouse.move(at.x - 300, at.y - 100, { steps: 3 });
  await expect.poll(async () => (await snap(tv)).frame.petted, { timeout: 4_000 }).toBe(false);
});

test("a viewer who asked for less motion has a cat that rests where it is", async ({ browser }) => {
  const tv = await openLibrary(browser, setup(), undefined, WANTS());
  await tv.emulateMedia({ reducedMotion: "reduce" });
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await catIsOnTheScreen(tv);
  const first = await snap(tv);
  await tv.waitForTimeout(6000);
  const later = await snap(tv);
  expect(Math.abs(later.frame.x - first.frame.x)).toBeLessThan(2);
  expect(later.frame.clip).not.toMatch(/walk|run|jump/);
});

test("the settings page has the cat's switches only on a host that offers a cat, and the switch is the cat", async ({ browser }) => {
  const tv = await openLibrary(browser, setup(false));
  await openTvSettings(tv);
  await expect(tv.getByTestId("tv-group-cat")).toHaveCount(0);

  const other = await openLibrary(browser, setup());
  await openTvSettings(other);
  const group = other.getByTestId("tv-group-cat");
  await expect(group).toBeVisible();
  const on = other.getByTestId("tv-cat-switch");
  await expect(on).toHaveAttribute("aria-checked", "false");
  await expect(other.getByTestId("tv-cat-quiet")).toHaveCount(0);
  await on.click();
  await expect(on).toHaveAttribute("aria-checked", "true");
  await expect(other.getByTestId("tv-cat-quiet")).toBeVisible();
  await expect(other.getByTestId("tv-cat-films")).toHaveAttribute("aria-checked", "true");
  // the cat comes without the page being loaded again, and goes the same way
  await other.keyboard.press("Escape");
  await expect(other.getByTestId("cat")).toHaveAttribute("data-visible", "true", { timeout: 12_000 });
  await expect(other.getByTestId("tv-cat-chip")).toBeVisible();
  await openTvSettings(other);
  await other.getByTestId("tv-cat-switch").click();
  await other.keyboard.press("Escape");
  await expect(other.getByTestId("cat")).toHaveCount(0);
  await expect(other.getByTestId("tv-cat-chip")).toHaveCount(0);
});
