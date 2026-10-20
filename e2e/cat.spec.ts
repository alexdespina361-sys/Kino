import { expect, type BrowserContext, type Page } from "@playwright/test";
import { PNG } from "pngjs";
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
/**
 * A device that has turned the cat on (as its settings page does), in the way it starts: not quiet. The detailed cat is off for these tests, but the ones
 * that are about it: a headless browser's card is a software one, so the tests of the cat's behaviour are made without it (it would only be slower).
 */
const WANTS = (over: Record<string, unknown> = {}) => ({ "kino.cat": JSON.stringify({ on: true, quiet: false, films: true, detail: false, ...over }) });

interface Snap {
  frame: { x: number; y: number; clip: string; appear: number; petted: boolean; grounded: boolean };
  engine: { act: string; surfaceId: string | null; mode: string; placed: boolean };
  view: string;
  why: string;
  art: "solid" | "classic" | "none";
  coat: string;
  body: number;
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

/* ------------------------------ the detailed (solid) cat and the simple one it falls back to ------------------------------ */

/** How many pixels of a picture are the cat's orange (the colours of the library's posters have none like it). */
const gingerIn = (picture: Buffer): number => {
  const { data } = PNG.sync.read(picture);
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (r > 170 && g > 80 && g < 190 && b < 120 && r - b > 100) count++;
  }
  return count;
};
/** A picture of the library around the cat. */
const around = async (tv: Page): Promise<Buffer> => {
  const seen = await snap(tv);
  const side = await tv.evaluate(() => document.querySelector(".kino-cat-canvas")!.getBoundingClientRect().width);
  const L = side / 4;
  const x = Math.max(0, Math.round(seen.frame.x - 1.6 * L));
  const y = Math.max(0, Math.round(seen.frame.y - 1.6 * L));
  return tv.screenshot({ clip: { x, y, width: Math.round(3.2 * L), height: Math.round(1.8 * L) } });
};
const artIs = (tv: Page, art: Snap["art"], timeout = 12_000) => saying(tv, () => expect.poll(async () => (await snap(tv)).art, { timeout }).toBe(art));
const MESH = /\.mesh(\?|$)/;

test("the detailed cat: a screen that can do WebGL gets the solid cat, painted by the card from a file that is fetched once, and it is on the screen", async ({ browser }) => {
  const tv = await openLibrary(browser, setup(), undefined, WANTS({ detail: true, quiet: true }));
  const meshes: string[] = [];
  tv.on("request", (request) => MESH.test(request.url()) && meshes.push(request.url()));
  await tv.goto("/tv?cat=debug&catbudget=100000");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await artIs(tv, "solid");
  await catIsOnTheScreen(tv);
  // a canvas that has a WebGL context can have no 2d one: this is the card's picture
  expect(await tv.evaluate(() => document.querySelector<HTMLCanvasElement>(".kino-cat-canvas")!.getContext("2d"))).toBeNull();
  await expect.poll(async () => gingerIn(await around(tv)), { timeout: 8_000 }).toBeGreaterThan(250);
  expect(meshes).toHaveLength(1);
  // the library keeps its own focus and keys under the solid cat too
  await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
  await tv.keyboard.press("ArrowRight");
  await expect(tv.getByTestId("tv-browse-tile").nth(1)).toBeFocused();
});

test("a screen without WebGL gets the simple cat, and its mesh is not asked for twice", async ({ browser }) => {
  const tv = await openLibrary(
    browser,
    async (context) => {
      await setup()(context);
      await context.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) => unknown;
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
          return /webgl/.test(kind) ? null : original.call(this, kind, ...rest);
        } as typeof HTMLCanvasElement.prototype.getContext;
      });
    },
    undefined,
    WANTS({ detail: true, quiet: true }),
  );
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await artIs(tv, "classic");
  await catIsOnTheScreen(tv);
  await expect.poll(async () => gingerIn(await around(tv)), { timeout: 8_000 }).toBeGreaterThan(150);
});

test("a mesh that is missing, or is not a mesh, gives the simple cat and the page carries on", async ({ browser }) => {
  for (const answer of [{ status: 500, body: "no" }, { status: 200, body: "<!doctype html><title>Kino</title>" }]) {
    const tv = await openLibrary(
      browser,
      async (context) => {
        await setup()(context);
        await context.route(MESH, (route) => route.fulfill({ ...answer, contentType: "application/octet-stream" }));
      },
      undefined,
      WANTS({ detail: true, quiet: true }),
    );
    await tv.goto("/tv?cat=debug");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await artIs(tv, "classic");
    await catIsOnTheScreen(tv);
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
  }
});

test("a cat's file that does not come leaves the library whole, and a page that is a whole page", async ({ browser }) => {
  const problems: string[] = [];
  const tv = await openLibrary(
    browser,
    async (context) => {
      await setup()(context);
      await context.route(/\/assets\/host-[^/]*\.js(\?|$)/, (route) => route.abort());
    },
    undefined,
    WANTS(),
  );
  const refused: string[] = [];
  tv.on("pageerror", (error) => problems.push(error.message));
  tv.on("requestfailed", (request) => /\/assets\/host-/.test(request.url()) && refused.push(request.url()));
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
  await expect.poll(() => refused.length, { timeout: 8_000 }).toBeGreaterThan(0);
  await tv.waitForTimeout(1000);
  await expect(tv.getByTestId("cat")).toHaveCount(0);
  // (the corner's button only opens the cat's panel: with no cat to open it for, it is taken away rather than left to do nothing)
  await expect(tv.getByTestId("tv-cat-chip")).toHaveCount(0);
  await tv.keyboard.press("ArrowRight");
  await expect(tv.getByTestId("tv-browse-tile").nth(1)).toBeFocused();
  expect(problems).toEqual([]);
});

test("a screen that cannot spare even the simple cat has none, and no button in the corner that would open a panel for it", async ({ browser }) => {
  test.setTimeout(75_000);
  const tv = await openLibrary(browser, setup(), undefined, WANTS());
  // (a budget nothing can keep to: the cost is over it for a stretch, at the lower quality for another, and the cat is no more)
  await tv.goto("/tv?cat=debug&catbudget=0.0001");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await expect(tv.getByTestId("tv-cat-chip")).toBeVisible();
  await saying(tv, () => expect.poll(async () => (await snap(tv)).quality, { timeout: 50_000 }).toBe("off"));
  await expect(tv.getByTestId("tv-cat-chip")).toHaveCount(0);
  await expect(tv.getByTestId("cat")).toBeHidden();
  await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
  await tv.keyboard.press("ArrowRight");
  await expect(tv.getByTestId("tv-browse-tile").nth(1)).toBeFocused();
});

test("a screen that cannot afford the detailed cat is given the simple one, and keeps it", async ({ browser }) => {
  test.setTimeout(75_000);
  const tv = await openLibrary(browser, setup(), undefined, WANTS({ detail: true }));
  await tv.goto("/tv?cat=debug&catslow=40");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await artIs(tv, "solid");
  // (the cost is told every frame: two stretches of being over budget, the second at the lower quality, and the detailed cat is no more)
  await artIs(tv, "classic", 50_000);
  await catIsOnTheScreen(tv);
  await tv.waitForTimeout(3000);
  const later = await snap(tv);
  expect(later.art).toBe("classic");
  expect(later.quality).toBe("full");
  expect(later.visible).toBe(true);
});

test("the settings page has a switch for the detailed cat: off is the simple cat at once, and on is the detailed one again", async ({ browser }) => {
  const tv = await openLibrary(browser, setup(), undefined, WANTS({ detail: true }));
  await tv.goto("/tv?cat=debug&catbudget=100000");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await artIs(tv, "solid");
  await openTvSettings(tv);
  const detail = tv.getByTestId("tv-cat-detail");
  await expect(detail).toHaveAttribute("aria-checked", "true");
  await detail.click();
  await expect(detail).toHaveAttribute("aria-checked", "false");
  await artIs(tv, "classic", 6_000);
  await detail.click();
  await expect(detail).toHaveAttribute("aria-checked", "true");
  await artIs(tv, "solid");
});

test("the settings page has the cat's coat and size: they are worn at once and kept for the device, and the simple cat has no coat to choose", async ({ browser }) => {
  const tv = await openLibrary(browser, setup(), undefined, WANTS({ detail: true, quiet: true }));
  await tv.goto("/tv?cat=debug&catbudget=100000");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await artIs(tv, "solid");
  const before = await snap(tv);
  expect(before.coat).toBe("ginger");
  expect(before.body).toBeGreaterThan(40);
  await openTvSettings(tv);
  await expect(tv.getByTestId("tv-cat-coat-ginger")).toHaveAttribute("aria-checked", "true");
  await expect(tv.getByTestId("tv-cat-size-normal")).toHaveAttribute("aria-checked", "true");
  await tv.getByTestId("tv-cat-coat-tuxedo").click();
  await expect(tv.getByTestId("tv-cat-coat-tuxedo")).toHaveAttribute("aria-checked", "true");
  await expect(tv.getByTestId("tv-cat-coat-ginger")).toHaveAttribute("aria-checked", "false");
  await saying(tv, () => expect.poll(async () => (await snap(tv)).coat, { timeout: 6_000 }).toBe("tuxedo"));
  await tv.getByTestId("tv-cat-size-large").click();
  await saying(tv, () => expect.poll(async () => (await snap(tv)).body, { timeout: 6_000 }).toBeGreaterThan(before.body * 1.2));
  await tv.getByTestId("tv-cat-size-small").click();
  await saying(tv, () => expect.poll(async () => (await snap(tv)).body, { timeout: 6_000 }).toBeLessThan(before.body * 0.9));
  // (kept by the device, and the cat is still there and still the detailed one)
  expect(JSON.parse(await tv.evaluate(() => localStorage.getItem("kino.cat") ?? "{}"))).toMatchObject({ coat: "tuxedo", size: "small", detail: true });
  expect((await snap(tv)).art).toBe("solid");
  // the simple cat has the one coat, so there is none to choose; the size is still there
  await tv.getByTestId("tv-cat-detail").click();
  await expect(tv.getByTestId("tv-cat-coat-grey")).toHaveCount(0);
  await expect(tv.getByTestId("tv-cat-size-large")).toBeVisible();
});

test("the address can ask for the coat and the size, whatever the device says", async ({ browser }) => {
  const usual = await openLibrary(browser, setup(), undefined, WANTS({ detail: true, quiet: true }));
  await usual.goto("/tv?cat=debug&catbudget=100000");
  await expect(usual.getByTestId("tv-browse")).toBeVisible();
  await artIs(usual, "solid");
  const normal = await snap(usual);
  const asked = await openLibrary(browser, setup(), undefined, WANTS({ detail: true, quiet: true, coat: "ginger", size: "normal" }));
  await asked.goto("/tv?cat=debug&catbudget=100000&catcoat=calico&catsize=large");
  await expect(asked.getByTestId("tv-browse")).toBeVisible();
  await artIs(asked, "solid");
  await saying(asked, () => expect.poll(async () => (await snap(asked)).coat, { timeout: 6_000 }).toBe("calico"));
  await saying(asked, () => expect.poll(async () => (await snap(asked)).body, { timeout: 6_000 }).toBeGreaterThan(normal.body * 1.2));
});

test("the address can ask for either cat, whatever the device says", async ({ browser }) => {
  const simple = await openLibrary(browser, setup(), undefined, WANTS({ detail: true }));
  await simple.goto("/tv?cat=debug&catart=classic");
  await expect(simple.getByTestId("tv-browse")).toBeVisible();
  await artIs(simple, "classic");
  const solid = await openLibrary(browser, setup(), undefined, WANTS({ detail: false }));
  await solid.goto("/tv?cat=debug&catart=solid&catbudget=100000");
  await expect(solid.getByTestId("tv-browse")).toBeVisible();
  await artIs(solid, "solid");
});
