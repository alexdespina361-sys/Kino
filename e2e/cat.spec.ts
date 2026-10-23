import { expect, type BrowserContext, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import { openLibrary, openTvSettings, playFirst, RawPhone, readPairingCode, test, withLibrary } from "./helpers";

/**
 * The cat companion (client/cat): a cat that lives on the TV's screen, only for a screen that asks for one and a host that offers it. It walks along the
 * rows of posters, sleeps at the foot of the film between the groups of the controls, under them and the subtitles, is stroked by a hand, and finds a title on the page on
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
 * A device that has turned the cat on (as its settings page does), in the way it starts: not quiet. It has the ginger cat (the flat one) for these tests,
 * but the ones that are about the white and grey one: a headless browser's card is a software one, so the tests of the cat's behaviour are made with the
 * ginger one (the other would only be slower).
 */
const WANTS = (over: Record<string, unknown> = {}) => ({ "kino.cat": JSON.stringify({ on: true, quiet: false, films: true, look: "ginger", ...over }) });

interface Snap {
  frame: { x: number; y: number; facing: number; clip: string; appear: number; petted: boolean; carried: boolean; grounded: boolean; struggle?: number; emote?: string };
  engine: { act: string; surfaceId: string | null; mode: string; placed: boolean; temperament: string };
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
  reads: number;
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
  await expect(chip).toHaveAttribute("aria-expanded", "false");
  await expect(chip).not.toHaveAttribute("aria-controls", /.+/);
  await tv.keyboard.press("Enter");
  const panel = tv.getByTestId("cat-panel");
  await expect(panel).toBeVisible();
  // a reader is told the button opened something, and what
  await expect(chip).toHaveAttribute("aria-expanded", "true");
  await expect(chip).toHaveAttribute("aria-controls", (await panel.getAttribute("id"))!);
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
  await expect(chip).toHaveAttribute("aria-expanded", "false");
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
  // and it is said to a reader as it is found, from a place that was already on the page (a polite one: it does not break in)
  const said = tv.getByTestId("cat-said");
  await expect(said).toHaveAttribute("role", "status");
  await expect(said).toHaveAttribute("aria-live", "polite");
  await expect(said).toContainText("Scary film");
  await expect(said).toContainText("Horror Movies");
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

test("find me something: the cat goes to the title, creeps up on it and swats at it twice, and the poster gives under the paw, before it points and sits by it", async ({ browser }) => {
  test.setTimeout(90_000);
  const tv = await openLibrary(
    browser,
    async (context) => {
      await setup()(context);
      // (what the page's elements are made to rock, by the title they are on: a swatted poster is rocked, with `rotate`, and no other thing the cat does to a poster is)
      await context.addInitScript(() => {
        const swatted: string[] = [];
        (window as unknown as { __swatted: string[] }).__swatted = swatted;
        const original = Element.prototype.animate;
        Element.prototype.animate = function (this: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions) {
          const first = Array.isArray(keyframes) ? keyframes[0] : null;
          if (first && "rotate" in first) swatted.push(this.closest("[data-entry]")?.getAttribute("data-entry") ?? "");
          return original.call(this, keyframes, options);
        } as typeof Element.prototype.animate;
      });
    },
    undefined,
    WANTS(),
  );
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await catIsOnTheScreen(tv);
  await tv.getByTestId("tv-cat-chip").click();
  await tv.getByTestId("cat-find").click();
  await tv.getByTestId("cat-mood-scary").click();
  const id = (await tv.getByTestId("cat-card").getAttribute("data-id"))!;
  expect(id).toMatch(/^h\d$/);
  const clip = () => snap(tv).then((seen) => seen.frame.clip);
  // (it creeps up on the poster, and swats: in that order, and the paw lands on the poster, which gives)
  await saying(tv, () => expect.poll(clip, { timeout: 30_000, intervals: [60] }).toBe("stalk"));
  await saying(tv, () => expect.poll(clip, { timeout: 15_000, intervals: [60] }).toBe("swat"));
  await saying(tv, () => expect.poll(() => tv.evaluate(() => (window as unknown as { __swatted: string[] }).__swatted), { timeout: 4_000 }).toContain(id));
  // (and then it points at it, and sits, with its eyes on the viewer)
  await saying(tv, () => expect.poll(clip, { timeout: 12_000, intervals: [60] }).toBe("point"));
  await saying(tv, () => expect.poll(async () => (await snap(tv)).frame.clip, { timeout: 12_000, intervals: [100] }).toBe("sit"));
  // nothing has started: it was shown, and only the viewer opens it
  await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
  await expect(tv.getByTestId("tv")).not.toHaveAttribute("data-state", "playing");
});

test("a row of posters scrolled sideways under the cat takes the cat along with them, and then it hops back to where it was", async ({ browser }) => {
  test.setTimeout(90_000);
  const tv = await openLibrary(browser, setup(), undefined, WANTS());
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await catIsOnTheShelves(tv);
  // (called to the second row, wherever it was: it is on a row of posters, and not on the floor of the screen, where what the posters do is no concern of its)
  const shelf = (await worldOf(tv)).surfaces.filter((surface) => surface.kind === "shelfTop").sort((a, b) => a.y - b.y)[1]!;
  await tellCat(tv, { type: "cat.call", at: { x: 700, y: shelf.y } });
  await saying(tv, () => expect.poll(async () => (await snap(tv)).engine.surfaceId, { timeout: 15_000 }).toBe(shelf.id));
  await catSitsAndWhere(tv);
  const start = await snap(tv);
  const L = (await worldOf(tv)).bodyLength;
  // the row the cat is on, and what it does from now on (the changes of what it is doing, as they come)
  const found = await tv.evaluate((y) => {
    const scroller = [...document.querySelectorAll<HTMLElement>(".tv-row-tiles")].find((el) => {
      const box = el.getBoundingClientRect();
      return box.top <= y + 8 && box.bottom >= y + 8;
    });
    if (!scroller) return false;
    const handle = (window as unknown as { __kinoCat: { snapshot(): { engine: { act: string } } } }).__kinoCat;
    const seen: string[] = [];
    (window as unknown as { __scroller: HTMLElement; __acts: string[] }).__scroller = scroller;
    (window as unknown as { __acts: string[] }).__acts = seen;
    scroller.style.scrollBehavior = "auto";
    setInterval(() => {
      const act = handle.snapshot().engine.act;
      if (seen[seen.length - 1] !== act) seen.push(act);
    }, 30);
    return true;
  }, start.frame.y);
  expect(found, "the row of posters under the cat").toBe(true);
  const slide = (by: number, reads: number) =>
    tv.evaluate(
      async ([step, times]) => {
        const scroller = (window as unknown as { __scroller: HTMLElement }).__scroller;
        for (let i = 0; i < times!; i++) {
          scroller.scrollLeft += step!;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      },
      [by, reads],
    );
  // a little way: the cat goes with the posters (to the left, as they go), sitting, and does not hop for that
  await slide(0.15 * L, 4);
  await saying(tv, () => expect.poll(async () => ((await snap(tv)).frame.x - start.frame.x) / L, { timeout: 4_000 }).toBeLessThan(-0.45));
  const carried = ((await snap(tv)).frame.x - start.frame.x) / L;
  expect(carried).toBeGreaterThan(-0.8);
  expect(await tv.evaluate(() => (window as unknown as { __acts: string[] }).__acts.includes("jump"))).toBe(false);
  // a good way: it hops back (or off to another shelf) and is on its feet and in sight again
  await slide(0.5 * L, 6);
  await saying(tv, () => expect.poll(() => tv.evaluate(() => (window as unknown as { __acts: string[] }).__acts.includes("jump")), { timeout: 8_000 }).toBe(true));
  await catIsOnTheShelves(tv);
});
test("a mood that no shelf of the page has finds nothing, and says so", async ({ browser }) => {
  const tv = await openLibrary(browser, setup(), undefined, WANTS());
  await catIsOnTheScreen(tv);
  await tv.getByTestId("tv-cat-chip").click();
  await tv.getByTestId("cat-find").click();
  await tv.getByTestId("cat-mood-romantic").click();
  await expect(tv.getByTestId("cat-nothing")).toBeVisible();
  await expect(tv.getByTestId("cat-said")).toHaveText(await tv.getByTestId("cat-nothing").innerText());
  await expect(tv.getByTestId("cat-card")).toHaveCount(0);
  await expect(tv.getByTestId("cat-back")).toBeFocused();
});

test("a row the library made for the viewer is where \"anything\" is found, with the library's own reason, and is no shelf of a kind", async ({ browser }) => {
  const tv = await openLibrary(browser, setup(), undefined, WANTS());
  await catIsOnTheScreen(tv);
  // (the row called Trending is made to be a row about the viewer, and the other two are hidden from the page as a row off the screen is, so that the only titles are its)
  await tv.evaluate(() => {
    for (const row of document.querySelectorAll<HTMLElement>(".tv-row")) {
      if (row.getAttribute("aria-label") === "Trending Movies") row.setAttribute("aria-label", "Because you watched Up");
      else row.setAttribute("aria-hidden", "true");
    }
  });
  await tv.getByTestId("tv-cat-chip").click();
  await tv.getByTestId("cat-find").click();
  await tv.getByTestId("cat-mood-any").click();
  const card = tv.getByTestId("cat-card");
  await expect(card).toContainText("Fresh film");
  await expect(card.locator(".cat-card-where")).toHaveText("Because you watched Up");
  await expect(tv.getByTestId("cat-said")).toContainText("Because you watched Up");
  // it is not a shelf of a kind: a viewer in the mood for something scary is not offered it for that
  await tv.getByTestId("cat-back").click();
  await tv.getByTestId("cat-mood-scary").click();
  await expect(tv.getByTestId("cat-nothing")).toBeVisible();
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

/**
 * What the cat does over `ms` (sampled by the page itself, twenty times a second): the least it was drawn (1 is fully there), how many times it came or went,
 * and how many lines of subtitles came up in that time.
 */
const watchedFor = (tv: Page, ms: number): Promise<{ least: number; changes: number; lines: number }> =>
  tv.evaluate(
    (span) =>
      new Promise<{ least: number; changes: number; lines: number }>((resolve) => {
        const handle = (window as unknown as { __kinoCat: { snapshot(): { frame: { appear: number } } } }).__kinoCat;
        const said = () => document.querySelector('[data-testid="caption"]') !== null;
        let [least, changes, lines] = [1, 0, 0];
        let [here, saying] = [handle.snapshot().frame.appear > 0.5, said()];
        const timer = setInterval(() => {
          const { appear } = handle.snapshot().frame;
          least = Math.min(least, appear);
          if (appear > 0.5 !== here) changes++;
          here = appear > 0.5;
          if (said() && !saying) lines++;
          saying = said();
        }, 50);
        setTimeout(() => {
          clearInterval(timer);
          resolve({ least, changes, lines });
        }, span);
      }),
    ms,
  );

/** Subtitles for a film of forty seconds: two long lines for two and a half seconds out of every four, as a film's are. */
const talk = () => {
  const at = (s: number) => `00:00:${s.toFixed(3).padStart(6, "0")}`;
  const lines = [
    ["I told you we should have left the harbour before the storm came in,", "but you never listen to anybody, not even the weather."],
    ["The last ferry leaves at midnight, and if we miss it again tonight", "we will be sleeping on the pier with the gulls and the nets."],
  ];
  let vtt = "WEBVTT\n\n";
  for (let i = 0, t = 1; t < 38; i++, t += 4) vtt += `${i + 1}\n${at(t)} --> ${at(t + 2.5)}\n${lines[i % lines.length]!.join("\n")}\n\n`;
  return vtt;
};

test("in a film the cat rests at the foot of the picture between the groups of the controls, and neither it nor the film is disturbed when they come up", async ({ browser }) => {
  const tv = await openLibrary(browser, setup(), undefined, WANTS());
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await catIsOnTheScreen(tv);
  await playFirst(tv);
  await expect(tv.getByTestId("tv")).toHaveAttribute("data-state", "playing");
  await catIsOnItsPerch(tv);
  // in the picture's own box, straight after the picture and no higher than the page's own level, so that everything the player draws after it is over the cat
  const place = await tv.evaluate(() => {
    const layer = document.querySelector('[data-testid="cat"]')!;
    return { parent: layer.parentElement?.getAttribute("data-testid"), after: layer.previousElementSibling?.tagName.toLowerCase(), z: getComputedStyle(layer).zIndex };
  });
  expect(place).toEqual({ parent: "tv", after: "video", z: "0" });
  const seen = await snap(tv);
  const screen = tv.viewportSize()!;
  expect(seen.frame.y).toBeGreaterThan(screen.height * 0.85); // (the foot of the picture)
  // a hand is the library's: in a film the picture is the player's (its taps, double-taps to skip and holds to speed up), so the box that takes a hand is out of the
  // way there, and a press on the patch of the picture where the cat sleeps reaches the player like a press anywhere else on it
  await expect(tv.getByTestId("cat-hit")).toHaveAttribute("data-off", "");
  expect(await tv.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest(".kino-cat-hit") != null, { x: seen.frame.x, y: seen.frame.y - 0.3 * seen.body })).toBe(false);
  // the controls' row has a stretch with no button in it between its two groups, and that is where the cat rests: its whole body is between the groups
  // (a cat behind a button's icon is clutter, even though the controls are over it), whether the controls are up or not
  const groups = await tv.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("main.tv .hud-controls > .hud-group")].map((group) => {
      const box = group.getBoundingClientRect();
      return { left: box.left, right: box.right };
    }),
  );
  expect(groups.length).toBe(2);
  expect(seen.engine.surfaceId).toBe("perch-gap");
  expect(seen.frame.x - 0.5 * seen.body).toBeGreaterThan(groups[0]!.right);
  expect(seen.frame.x + 0.5 * seen.body).toBeLessThan(groups[1]!.left);
  // it settles to sleep while the film plays, and the film is the viewer's: it is still playing
  await expect.poll(async () => (await snap(tv)).frame.clip, { timeout: 15_000 }).toMatch(/loaf|curl/);
  await expect(tv.getByTestId("tv")).toHaveAttribute("data-state", "playing");
  // the controls come up over it: it stays where it is, asleep (it covers nothing, so there is nothing to leave for), and the film plays on
  const where = await snap(tv);
  await tv.keyboard.press("ArrowDown");
  await expect(tv.getByTestId("tv")).toHaveAttribute("data-hud", "visible");
  const up = await watchedFor(tv, 2_000);
  expect(up.least).toBeGreaterThan(0.95);
  expect(up.changes).toBe(0);
  const still = await snap(tv);
  expect([Math.round(still.frame.x), Math.round(still.frame.y)]).toEqual([Math.round(where.frame.x), Math.round(where.frame.y)]);
  await expect(tv.getByTestId("tv")).not.toHaveAttribute("data-hud", "visible", { timeout: 20_000 });
  await catIsOnItsPerch(tv);
  await expect(tv.getByTestId("tv")).toHaveAttribute("data-state", "playing");
  // Back leaves the film (the first press brings the controls up, the next one leaves): the cat is on the shelves again, and takes a hand again
  await expect(async () => {
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-browse")).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  await catIsOnTheShelves(tv);
  await expect(tv.getByTestId("cat-hit")).not.toHaveAttribute("data-off", "");
});

test("the words of a film and the controls are drawn over the cat, and the lines coming and going do not make it come and go", async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const tv = await openLibrary(browser, async (context) => {
    await setup()(context);
    await context.route("**/fixtures/sample.vtt", (route) => route.fulfill({ contentType: "text/vtt", body: talk() }));
  }, undefined, WANTS());
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await catIsOnTheScreen(tv);
  await tv.getByTestId("rail-connect").click();
  const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
  phone.cmd({ type: "LOAD", media: { title: "A film with words", stream: { url: "/fixtures/long.mp4", type: "mp4" }, subtitles: [{ id: "en", label: "English", lang: "en", url: "/fixtures/sample.vtt" }] } });
  await expect(tv.getByTestId("tv")).toHaveAttribute("data-state", /paused|playing/);
  phone.cmd({ type: "SET_SUBTITLE", track: 0 });
  phone.cmd({ type: "PLAY" });
  await catIsOnItsPerch(tv);

  // at a moment when words are on the screen, what is on top of what, at a point of the words, with the cat's layer made to take the pointer as well: the words, then the cat, then the film
  await expect(tv.getByTestId("caption").first()).toBeVisible({ timeout: 10_000 });
  const stack = await tv.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = ".kino-cat, .kino-cat *, .tv-captions, .tv-captions *, .tv video { pointer-events: auto !important; }";
    document.head.append(style);
    const box = document.querySelector('[data-testid="caption"]')!.getBoundingClientRect();
    const seen = document.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    style.remove();
    const where = (match: (element: Element) => boolean) => seen.findIndex(match);
    return { words: where((element) => element.closest('[data-testid="captions"]') !== null), cat: where((element) => element.closest(".kino-cat") !== null), film: where((element) => element.tagName === "VIDEO") };
  });
  expect(stack.words).toBeGreaterThanOrEqual(0);
  expect(stack.cat).toBeGreaterThan(stack.words);
  expect(stack.film).toBeGreaterThan(stack.cat);

  // over the next stretch of the film lines come and go, and the controls come up once: the cat is there the whole time, and does not come or go
  const key = async () => {
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("tv")).toHaveAttribute("data-hud", "visible");
  };
  const [stretch] = await Promise.all([watchedFor(tv, 14_000), tv.waitForTimeout(3_000).then(key)]);
  expect(stretch.lines).toBeGreaterThanOrEqual(3);
  expect(stretch.changes).toBe(0);
  expect(stretch.least).toBeGreaterThan(0.95);
  await expect(tv.getByTestId("tv")).toHaveAttribute("data-state", "playing");
  expect((await snap(tv)).engine.surfaceId ?? "").toMatch(/^perch/);
  phone.close();
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

test("a press on the cat is the cat's and takes nothing from the page; a press on the poster beside it is the page's", async ({ browser }) => {
  test.setTimeout(60_000);
  const tv = await openLibrary(browser, setup(), undefined, WANTS());
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await catIsOnTheScreen(tv);
  const screen = tv.viewportSize()!;
  const tell = (event: unknown) => tv.evaluate((e) => (window as unknown as { __kinoCat: { send(event: unknown): void } }).__kinoCat.send(e), event);
  // (asked to the foot of the screen, which is under the last row of posters, and to sit there: its body is over a poster)
  await tell({ type: "cat.call", at: { x: screen.width / 2, y: screen.height - 8 } });
  await saying(tv, () =>
    expect
      .poll(async () => {
        const seen = await snap(tv);
        return seen.frame.grounded && seen.frame.appear > 0.95 && Math.abs(seen.frame.y - (screen.height - 8)) < 60 && !/walk|run|jump/.test(seen.frame.clip);
      }, { timeout: 20_000 })
      .toBe(true),
  );
  await tell({ type: "cat.command", command: "sit" });
  await saying(tv, () => expect.poll(async () => (await snap(tv)).frame.clip, { timeout: 10_000 }).toBe("sit"));

  const box = (await tv.getByTestId("cat-hit").boundingBox())!;
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const under = (at: { x: number; y: number }) =>
    tv.evaluate(({ x, y }) => {
      const stack = document.elementsFromPoint(x, y);
      const tile = stack.find((element) => !element.closest(".kino-cat"))?.closest('[data-testid="tv-browse-tile"]');
      const rect = tile?.getBoundingClientRect();
      return { first: stack[0]?.getAttribute("data-testid") ?? "", tile: tile?.getAttribute("data-entry") ?? null, rect: rect ? { left: rect.left, right: rect.right, top: rect.top } : null };
    }, at);
  const there = await under(middle);
  expect(there.first).toBe("cat-hit");
  expect(there.tile).not.toBeNull(); // (the poster that the cat is sitting on)
  const focused = () => tv.evaluate(() => document.activeElement?.getAttribute("data-entry") ?? document.activeElement?.tagName ?? "");
  const before = await focused();

  // a click on the cat: the cat is stroked; the poster is not opened, and the remote's focus is where it was
  await tv.mouse.click(middle.x, middle.y);
  await expect.poll(async () => (await snap(tv)).frame.petted, { timeout: 3_000 }).toBe(true);
  await tv.waitForTimeout(400);
  await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
  expect(await focused()).toBe(before);

  // a click on the same poster beside the cat (its body ends well inside the poster): the poster is opened
  const rect = there.rect!;
  const beside = { x: box.x - rect.left > rect.right - (box.x + box.width) ? rect.left + 10 : rect.right - 10, y: rect.top + 40 };
  expect((await under(beside)).first).not.toBe("cat-hit");
  expect((await under(beside)).tile).toBe(there.tile);
  await tv.mouse.click(beside.x, beside.y);
  await expect(tv.getByTestId("tv-detail")).toBeVisible();
});

test("a page that only sits there is read about twice a second: the cat's own layer does not wake the reader again and again", async ({ browser }) => {
  const tv = await openLibrary(browser, setup(), undefined, WANTS({ quiet: true }));
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await catIsOnTheScreen(tv);
  // (a cat that sits still: what it does to the posters as it moves about is the page changing, and is read for)
  await tv.evaluate(() => (window as unknown as { __kinoCat: { send(event: unknown): void } }).__kinoCat.send({ type: "cat.command", command: "sit" }));
  await expect.poll(async () => (await snap(tv)).frame.clip, { timeout: 20_000 }).toBe("sit");
  await tv.waitForTimeout(1500);
  const before = (await snap(tv)).reads;
  await tv.waitForTimeout(5000);
  const read = (await snap(tv)).reads - before;
  // (twice a second is ten; the reader waking itself ten times a second was fifty)
  expect(read).toBeGreaterThanOrEqual(5);
  expect(read).toBeLessThanOrEqual(25);
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

/* ------------------------------ a hand that takes hold of the cat ------------------------------ */

interface Surf {
  id: string;
  kind: string;
  y: number;
  x0: number;
  x1: number;
}
const worldOf = (tv: Page) => tv.evaluate(() => (window as unknown as { __kinoCat: { world(): unknown } }).__kinoCat.world()) as Promise<{ bodyLength: number; surfaces: Surf[] }>;
const tellCat = (tv: Page, event: unknown) => tv.evaluate((e) => (window as unknown as { __kinoCat: { send(event: unknown): void } }).__kinoCat.send(e), event);
/** The cat sits where it is (a cat that is about to be taken by a hand is not on its way anywhere), and the middle of the box that takes a hand. */
const catSitsAndWhere = async (tv: Page) => {
  await tellCat(tv, { type: "cat.command", command: "sit" });
  await saying(tv, () => expect.poll(async () => (await snap(tv)).frame.clip, { timeout: 20_000 }).toBe("sit"));
  await tv.waitForTimeout(400);
  const box = (await tv.getByTestId("cat-hit").boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test("a hand that takes hold of the cat carries it by the scruff, marks the shelf it would be put down on, and puts it there", async ({ browser }) => {
  test.setTimeout(90_000);
  const tv = await openLibrary(browser, setup(), undefined, WANTS());
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await catIsOnTheShelves(tv);
  const middle = await catSitsAndWhere(tv);
  const start = await snap(tv);
  const world = await worldOf(tv);
  const L = world.bodyLength;
  // the shelf the cat is not on, and the furthest from it (a whole row of posters or two, not a corner of a card)
  const here = world.surfaces.find((surface) => surface.id === start.engine.surfaceId)!;
  const target = world.surfaces
    .filter((surface) => surface.kind === "shelfTop" && Math.abs(surface.y - here.y) > 1.5 * L && surface.x1 - surface.x0 > 3 * L)
    .sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0))[0];
  expect(target, "another shelf with room on it").toBeDefined();
  const hand = { x: (target!.x0 + target!.x1) / 2, y: target!.y - 1.2 * L - 0.73 * L };

  await tv.mouse.move(middle.x, middle.y);
  await tv.mouse.down();
  // (a press does not take hold of the cat until the hand has gone a little way: it is a stroke until then)
  await tv.mouse.move(middle.x + 4, middle.y - 4);
  expect((await snap(tv)).frame.carried).toBe(false);
  await tv.mouse.move(middle.x + 30, middle.y - 30, { steps: 5 });
  await saying(tv, () => expect.poll(async () => (await snap(tv)).engine.act, { timeout: 5_000 }).toBe("carried"));
  await expect(tv.getByTestId("cat-hit")).toHaveAttribute("data-held", "");

  await tv.mouse.move(hand.x, hand.y, { steps: 30 });
  // it hangs below the hand, a little way before it, and the shelf under it is marked
  await saying(tv, () =>
    expect
      .poll(async () => {
        const seen = await snap(tv);
        return seen.frame.carried && Math.abs(seen.frame.y - (hand.y + 0.73 * L)) < 0.15 * L && Math.abs(seen.frame.x - (hand.x + 0.1 * L * seen.frame.facing)) < 0.15 * L;
      }, { timeout: 8_000 })
      .toBe(true),
  );
  await expect(tv.getByTestId("cat-spot")).toHaveAttribute("data-on", "");
  const mark = (await tv.getByTestId("cat-spot").boundingBox())!;
  const where = `mark at ${Math.round(mark.x + mark.width / 2)},${Math.round(mark.y + mark.height / 2)}, hand ${Math.round(hand.x)},${Math.round(hand.y)}, shelf ${target!.id} ${Math.round(target!.x0)}..${Math.round(target!.x1)} at ${Math.round(target!.y)}, L ${L}, cat ${JSON.stringify((await snap(tv)).frame)}`;
  expect(Math.abs(mark.y + mark.height / 2 - target!.y), where).toBeLessThan(0.2 * L);
  // (the place under it, or a little way across where the shelf has room for the cat and its keep-outs are not: never further than a fall can steer, three body lengths)
  expect(mark.x + mark.width / 2, where).toBeGreaterThan(target!.x0);
  expect(mark.x + mark.width / 2, where).toBeLessThan(target!.x1);
  expect(Math.abs(mark.x + mark.width / 2 - hand.x), where).toBeLessThan(3 * L);
  // (a hand that rests keeps the cat for as long as it is held: it is told at every frame, so it is not let go for being quiet)
  await tv.waitForTimeout(3_500);
  expect((await snap(tv)).engine.act).toBe("carried");

  await tv.mouse.up();
  await saying(tv, () =>
    expect
      .poll(async () => {
        const seen = await snap(tv);
        return !/carried|fall/.test(seen.engine.act) && seen.frame.grounded && seen.engine.surfaceId === target!.id;
      }, { timeout: 12_000 })
      .toBe(true),
  );
  await expect(tv.getByTestId("cat-hit")).not.toHaveAttribute("data-held", "");
  await expect(tv.getByTestId("cat-spot")).not.toHaveAttribute("data-on", "");
  expect(Math.abs((await snap(tv)).frame.y - target!.y)).toBeLessThan(3);
});

test("a press that only wobbles is a stroke and lifts nothing; the page under it is not opened", async ({ browser }) => {
  const tv = await openLibrary(browser, setup(), undefined, WANTS());
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await catIsOnTheShelves(tv);
  const middle = await catSitsAndWhere(tv);
  const before = await snap(tv);
  await tv.mouse.move(middle.x, middle.y);
  await tv.mouse.down();
  await tv.mouse.move(middle.x + 5, middle.y + 2, { steps: 3 });
  await tv.mouse.move(middle.x - 3, middle.y - 4, { steps: 3 });
  await tv.mouse.up();
  await expect.poll(async () => (await snap(tv)).frame.petted, { timeout: 3_000 }).toBe(true);
  const after = await snap(tv);
  expect(after.frame.carried).toBe(false);
  expect(after.engine.act).not.toMatch(/carried|fall/);
  expect(Math.abs(after.frame.x - before.frame.x)).toBeLessThan(3);
  await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
});

test("a viewer who asked for less motion, or for quiet, is not lifted, and the cursor does not offer it", async ({ browser }) => {
  test.setTimeout(60_000);
  for (const how of ["reduced motion", "quiet"] as const) {
    const tv = await openLibrary(browser, setup(), undefined, WANTS({ quiet: how === "quiet" }));
    if (how === "reduced motion") await tv.emulateMedia({ reducedMotion: "reduce" });
    await tv.goto("/tv?cat=debug");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await catIsOnTheScreen(tv);
    await tv.waitForTimeout(1_200);
    await expect(tv.getByTestId("cat-hit")).not.toHaveAttribute("data-carry", "");
    const box = (await tv.getByTestId("cat-hit").boundingBox())!;
    const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const before = await snap(tv);
    await tv.mouse.move(middle.x, middle.y);
    await tv.mouse.down();
    await tv.mouse.move(middle.x + 120, middle.y - 150, { steps: 12 });
    await tv.waitForTimeout(500);
    const during = await snap(tv);
    // (a cat that is not lifted is not shown as held: the cursor stays an open hand)
    await expect(tv.getByTestId("cat-hit"), how).not.toHaveAttribute("data-held", "");
    await tv.mouse.up();
    expect(during.frame.carried, how).toBe(false);
    expect(during.engine.act, how).not.toMatch(/carried|fall/);
    expect(Math.abs(during.frame.x - before.frame.x), how).toBeLessThan(3);
    expect(Math.abs(during.frame.y - before.frame.y), how).toBeLessThan(3);
    await tv.context().close();
  }
});

test("a hand that is lost lets the cat go: the window losing the pointer puts it down on a shelf", async ({ browser }) => {
  test.setTimeout(60_000);
  const tv = await openLibrary(browser, setup(), undefined, WANTS());
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await catIsOnTheShelves(tv);
  const middle = await catSitsAndWhere(tv);
  const L = (await worldOf(tv)).bodyLength;
  await tv.mouse.move(middle.x, middle.y);
  await tv.mouse.down();
  await tv.mouse.move(middle.x + 40, middle.y - 0.8 * L, { steps: 6 });
  await saying(tv, () => expect.poll(async () => (await snap(tv)).engine.act, { timeout: 5_000 }).toBe("carried"));
  // (the window loses the focus with the button still down: no word about the button coming up ever arrives)
  await tv.evaluate(() => window.dispatchEvent(new Event("blur")));
  await saying(tv, () =>
    expect
      .poll(async () => {
        const seen = await snap(tv);
        return !/carried|fall/.test(seen.engine.act) && seen.frame.grounded && (seen.engine.surfaceId ?? "") !== "";
      }, { timeout: 12_000 })
      .toBe(true),
  );
  await expect(tv.getByTestId("cat-hit")).not.toHaveAttribute("data-held", "");
  await tv.mouse.up();
});

/** From now on, how hard the cat fights the hand and what it feels, every few milliseconds, until `__stopFeel()`. */
const recordTheFeeling = (tv: Page) =>
  tv.evaluate(() => {
    const w = window as unknown as { __kinoCat: { snapshot(): { frame: { struggle?: number; emote?: string; carried: boolean }; engine: { act: string } } }; __feel: Array<{ t: number; struggle: number; emote: string; carried: boolean; act: string }>; __stopFeel?: () => void };
    w.__feel = [];
    const start = performance.now();
    const timer = window.setInterval(() => {
      const { frame, engine } = w.__kinoCat.snapshot();
      w.__feel.push({ t: (performance.now() - start) / 1000, struggle: frame.struggle ?? 0, emote: frame.emote ?? "none", carried: frame.carried, act: engine.act });
    }, 8);
    w.__stopFeel = () => window.clearInterval(timer);
  });
const theFeeling = async (tv: Page) => {
  await tv.evaluate(() => (window as unknown as { __stopFeel?: () => void }).__stopFeel?.());
  return tv.evaluate(() => (window as unknown as { __feel: Array<{ t: number; struggle: number; emote: string; carried: boolean; act: string }> }).__feel);
};

test("a cat that is held by the scruff hangs calm for a moment and then fights the hand; one let go of while it fought lands annoyed, and one let go of calm lands as it always did", async ({ browser }) => {
  test.setTimeout(120_000);
  const tv = await openLibrary(browser, setup(), undefined, WANTS());
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await catIsOnTheShelves(tv);
  const lift = async () => {
    const middle = await catSitsAndWhere(tv);
    await tv.mouse.move(middle.x, middle.y);
    await tv.mouse.down();
    await tv.mouse.move(middle.x + 30, middle.y - 30, { steps: 5 });
    await saying(tv, () => expect.poll(async () => (await snap(tv)).engine.act, { timeout: 5_000 }).toBe("carried"));
  };
  const landed = () => saying(tv, () => expect.poll(async () => { const seen = await snap(tv); return !/carried|fall|climb/.test(seen.engine.act) && seen.frame.grounded; }, { timeout: 12_000 }).toBe(true));

  // the first hold is short and calm: nothing is fought, and the landing is the one it has always had
  await recordTheFeeling(tv);
  await lift();
  await tv.waitForTimeout(1_200);
  await tv.mouse.up();
  await landed();
  await tv.waitForTimeout(1_500);
  const calm = await theFeeling(tv);
  expect(calm.some((beat) => beat.carried)).toBe(true);
  expect(Math.max(...calm.map((beat) => beat.struggle)), "a cat held a moment does not fight").toBeLessThan(0.05);
  expect(calm.filter((beat) => beat.emote === "annoyed" || beat.emote === "shake"), "and lands as it always did").toEqual([]);

  // the second is long: it hangs calm, then fights, and the hand does not move all the while
  await recordTheFeeling(tv);
  await lift();
  await tv.waitForTimeout(1_000);
  expect((await snap(tv)).engine.act).toBe("carried");
  expect((await snap(tv)).frame.struggle ?? 0, "calm at first").toBeLessThan(0.05);
  // (this is the ginger, which forgives a hand: it hangs calm for 3.6 s and fights at about half its strength; the ragdoll fights hard after a second)
  await saying(tv, () => expect.poll(async () => (await snap(tv)).frame.struggle ?? 0, { timeout: 10_000 }).toBeGreaterThan(0.4));
  // (the fight does not tear the cat out of the hand: it is held all the while)
  expect((await snap(tv)).engine.act).toBe("carried");
  await tv.mouse.up();
  await landed();
  await tv.waitForTimeout(2_500);
  const fight = await theFeeling(tv);
  const released = fight.findIndex((beat, index) => index > 0 && fight[index - 1]!.carried && !beat.carried);
  expect(released, "it was let go of").toBeGreaterThan(0);
  const fought = Math.max(...fight.slice(0, released).map((beat) => beat.struggle));
  expect(fought, "it fought").toBeGreaterThan(0.4);
  // gone about half a second after the hand let go, and never back
  const after = fight.slice(released);
  const quiet = after.find((beat) => beat.struggle < 0.01);
  expect(quiet, "it stops fighting").toBeDefined();
  expect(quiet!.t - after[0]!.t, "within a second of the hand letting go").toBeLessThan(1);
  expect(after.filter((beat) => beat.t > quiet!.t && beat.struggle > 0.01)).toEqual([]);
  // and what it did when it landed: it showed what it felt (annoyed, startled or shaking), not the sit and wash of a cat put down in peace
  expect(after.some((beat) => beat.emote === "annoyed" || beat.emote === "startle" || beat.emote === "shake"), "lands annoyed").toBe(true);
});

test("a hand that rests on the white and grey cat for too long: it warns the hand after a few seconds, stands up to it and walks off along the shelf, away from it", async ({ browser }) => {
  test.setTimeout(90_000);
  const tv = await openLibrary(browser, setup(), undefined, WANTS({ look: "ragdoll" }));
  await tv.goto("/tv?cat=debug&catart=classic");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await catIsOnTheShelves(tv);
  const middle = await catSitsAndWhere(tv);
  const start = await snap(tv);
  expect(start.engine.temperament).toBe("ragdoll");
  // the hand comes to the cat and rests on it: the host strokes it a third of a second after, and once a second after that
  await recordTheFeeling(tv);
  await tv.mouse.move(middle.x - 200, middle.y - 80);
  await tv.mouse.move(middle.x, middle.y, { steps: 4 });
  await saying(tv, () => expect.poll(async () => (await snap(tv)).frame.emote, { timeout: 14_000 }).toBe("annoyed"));
  // (it stands up to the hand, and goes: along the shelf, a body length or more from where the hand is)
  await saying(tv, () => expect.poll(async () => Math.abs((await snap(tv)).frame.x - start.frame.x) / start.body, { timeout: 20_000 }).toBeGreaterThan(1));
  const beats = await theFeeling(tv);
  const warned = beats.find((beat) => beat.emote === "annoyed")!;
  expect(warned.t, "it is stroked a while before it has had enough").toBeGreaterThan(3);
  expect(warned.t, "and has had enough in the end").toBeLessThan(11);
  const left = (await snap(tv)).frame.x - start.frame.x;
  // (and the hand it left is where it was: the cat is on the far side of the body length from it)
  expect(Math.abs(left)).toBeGreaterThan(start.body);
});

interface Seen {
  x: number;
  y: number;
  facing: number;
  clip: string;
  progress: number;
  grounded: boolean;
  act: string;
  surface: string | null;
  /** The box a hand is on takes no hand just now. */
  off: boolean;
}
/** From now on, the cat's frame (and whether the box a hand is on is off) every few milliseconds, in the page, where the frames are, until `__stopSeen()`. */
const recordTheCat = (tv: Page) =>
  tv.evaluate(() => {
    const w = window as unknown as { __kinoCat: { snapshot(): { frame: Omit<Seen, "act" | "surface" | "off">; engine: { act: string; surfaceId: string | null } } }; __seen: Seen[]; __stopSeen?: () => void };
    const hit = document.querySelector<HTMLElement>('[data-testid="cat-hit"]')!;
    w.__seen = [];
    const timer = window.setInterval(() => {
      const { frame, engine } = w.__kinoCat.snapshot();
      w.__seen.push({ x: frame.x, y: frame.y, facing: frame.facing, clip: frame.clip, progress: frame.progress, grounded: frame.grounded, act: engine.act, surface: engine.surfaceId, off: hit.hasAttribute("data-off") });
    }, 8);
    w.__stopSeen = () => window.clearInterval(timer);
  });
const recordingOfTheCat = async (tv: Page): Promise<Seen[]> => {
  await tv.evaluate(() => (window as unknown as { __stopSeen?: () => void }).__stopSeen?.());
  return tv.evaluate(() => (window as unknown as { __seen: Seen[] }).__seen);
};

test("a hand that lets the cat go just under the edge of a shelf: it reaches for the edge, takes hold, hangs and hauls itself up onto the shelf, and nothing takes it from there meanwhile", async ({ browser }) => {
  test.setTimeout(90_000);
  const tv = await openLibrary(browser, setup(), undefined, WANTS());
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await catIsOnTheShelves(tv);
  const middle = await catSitsAndWhere(tv);
  const start = await snap(tv);
  const world = (await worldOf(tv)) as Awaited<ReturnType<typeof worldOf>> & { keepOut: Array<{ x: number; y: number; w: number; h: number }>; viewport: { w: number; h: number } };
  const L = world.bodyLength;
  // the highest shelf, wide, with room under its edge on the screen (a shelf with the foot of the screen near under it is a fall to the foot, which is nearer), and a place along it with nothing to keep out of
  // for two body lengths and a half on either side, from the height of the cat's head to where it hangs: the hero's buttons and the focus card are over the first part of the shelf
  const openAt = (surface: Surf): number | undefined => {
    const middle = (surface.x0 + surface.x1) / 2;
    for (let step = 0; middle - step * 0.25 * L > surface.x0 + 3 * L; step++) {
      for (const x of [middle - step * 0.25 * L, middle + step * 0.25 * L]) {
        if (x > surface.x1 - 3 * L) continue;
        if (!world.keepOut.some((zone) => zone.x < x + 2.5 * L && zone.x + zone.w > x - 2.5 * L && zone.y < surface.y + 1.5 * L && zone.y + zone.h > surface.y - 1.3 * L)) return x;
      }
    }
    return undefined;
  };
  const target = world.surfaces.filter((surface) => surface.kind === "shelfTop" && surface.y + 1.8 * L < world.viewport.h && openAt(surface) !== undefined).sort((a, b) => a.y - b.y)[0];
  expect(target, "a shelf with room under its edge").toBeDefined();
  // (the feet a body length and a fifth under the line of the shelf: past what the cat springs up to, within what it reaches)
  const hand = { x: openAt(target!)!, y: target!.y + 1.2 * L - 0.73 * L };
  await tv.mouse.move(middle.x, middle.y);
  await tv.mouse.down();
  await tv.mouse.move(middle.x + 30, middle.y - 30, { steps: 5 });
  await saying(tv, () => expect.poll(async () => (await snap(tv)).engine.act, { timeout: 5_000 }).toBe("carried"));
  await tv.mouse.move(hand.x, hand.y, { steps: 30 });
  await saying(tv, () => expect.poll(async () => { const seen = await snap(tv); return seen.frame.carried && Math.abs(seen.frame.y - (hand.y + 0.73 * L)) < 0.15 * L; }, { timeout: 8_000 }).toBe(true));
  // the mark says where it would be put down: on top of that shelf, a stride along from where it hangs (or a little further, where the shelf has no room for it: a hero's buttons over it, say)
  await expect(tv.getByTestId("cat-spot")).toHaveAttribute("data-on", "");
  const mark = (await tv.getByTestId("cat-spot").boundingBox())!;
  expect(Math.abs(mark.y + mark.height / 2 - target!.y)).toBeLessThan(0.2 * L);
  expect(Math.abs(mark.x + mark.width / 2 - hand.x)).toBeLessThan(1.5 * L);

  await recordTheCat(tv);
  await tv.mouse.up();
  await saying(tv, () =>
    expect
      .poll(async () => {
        const seen = await snap(tv);
        return !/carried|fall|climb/.test(seen.engine.act) && seen.frame.grounded && seen.engine.surfaceId === target!.id;
      }, { timeout: 12_000 })
      .toBe(true),
  );
  const seen = await recordingOfTheCat(tv);
  const climb = seen.filter((beat) => beat.clip === "climb");
  // it climbed: for the length of the clip, held at the point it ends up standing at (feet on the line of the shelf), facing along the shelf
  expect(climb.length).toBeGreaterThan(100);
  for (const beat of climb) {
    expect(beat.surface === target!.id || beat.surface === start.engine.surfaceId, "on its way").toBe(true);
    expect(Math.abs(beat.y - target!.y), "the feet on the line of the shelf").toBeLessThan(1);
    expect(Math.abs(beat.x - climb[0]!.x)).toBeLessThan(1);
    expect(beat.facing).toBe(climb[0]!.facing);
  }
  // (up from nothing to one, and never back; off its feet until it is up)
  climb.reduce((before, beat) => {
    expect(beat.progress).toBeGreaterThanOrEqual(before - 1e-9);
    return beat.progress;
  }, 0);
  expect(climb[0]!.progress).toBeLessThan(0.05);
  expect(climb[climb.length - 1]!.progress).toBeGreaterThan(0.95);
  expect(climb.filter((beat) => beat.progress < 0.9).every((beat) => !beat.grounded)).toBe(true);
  // (and nothing is under a hand meanwhile: the box a hand is on is off for as long as it hangs)
  expect(climb.every((beat) => beat.off), "the hand's box is off").toBe(true);
  // the way there was a fall of a moment, and the end is the cat on its feet on the shelf, with its box back
  // (the first beats may still be of the hand that has not been heard letting go: the cat in it is not in the air of a fall)
  const before = seen.slice(0, seen.indexOf(climb[0]!)).filter((beat) => beat.act !== "carried");
  expect(before.length).toBeGreaterThan(3);
  expect(before.filter((beat) => !(beat.clip === "jump" && !beat.grounded)).map((beat) => `${beat.act} ${beat.clip} ${beat.grounded ? "ground" : "air"}`), "off its feet, and in the clip of a leap, all the way").toEqual([]);
  const end = await snap(tv);
  expect(Math.abs(end.frame.y - target!.y)).toBeLessThan(2);
  await expect(tv.getByTestId("cat-hit")).not.toHaveAttribute("data-off", "");
});

/** A library of more rows than a screen shows, so that the rows can be flung. */
const tallLibrary = { updatedAt: Date.now(), rows: Array.from({ length: 12 }, (_, row) => ({ id: `row${row}`, title: `Row ${row + 1}`, source: "Test Source", items: Array.from({ length: 10 }, (_, index) => film(`r${row}c${index}`, `Film ${row + 1}-${index + 1}`)) })) };
interface Beat {
  y: number;
  act: string;
  flung: boolean;
  surface: string | null;
  grounded: boolean;
  scroll: number;
}
/** From now on, what the cat is doing, every few milliseconds (in the page, where the frames are), until `__beats.stop()`. */
const watchTheCat = (tv: Page) =>
  tv.evaluate(() => {
    const w = window as unknown as { __kinoCat: { snapshot(): { frame: { y: number; grounded: boolean }; engine: { act: string; flung: boolean; surfaceId: string | null; scroll: number } } }; __beats: Beat[]; __stopBeats?: () => void };
    w.__beats = [];
    const timer = window.setInterval(() => {
      const seen = w.__kinoCat.snapshot();
      w.__beats.push({ y: seen.frame.y, act: seen.engine.act, flung: seen.engine.flung, surface: seen.engine.surfaceId, grounded: seen.frame.grounded, scroll: seen.engine.scroll });
    }, 8);
    w.__stopBeats = () => window.clearInterval(timer);
  });
const theBeats = (tv: Page) => tv.evaluate(() => (window as unknown as { __beats: Beat[] }).__beats);
const stopWatching = (tv: Page) => tv.evaluate(() => (window as unknown as { __stopBeats?: () => void }).__stopBeats?.());

test("a page that is flung, or scrolled too far and too fast to be a step of the remote, does not take the cat up with its shelf: it is shaken off and falls, in front of the page that goes by, and lands; a step of the remote takes it with the shelf", async ({ browser }) => {
  test.setTimeout(240_000);
  const tv = await openLibrary(browser, async (context) => {
    await offered(true)(context);
    await withLibrary(tallLibrary)(context);
  }, undefined, WANTS());
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await catIsOnTheShelves(tv);
  // (called to the highest shelf that is wholly on the screen, with room above it for the fall, and told to sit there)
  const world = await worldOf(tv);
  const L = world.bodyLength;
  const shelf = world.surfaces.filter((surface) => surface.kind === "shelfTop" && surface.y > 2.2 * L).sort((a, b) => a.y - b.y)[0]!;
  await tellCat(tv, { type: "cat.call", at: { x: (shelf.x0 + shelf.x1) / 2, y: shelf.y } });
  await saying(tv, () => expect.poll(async () => (await snap(tv)).engine.surfaceId, { timeout: 15_000 }).toBe(shelf.id));
  await catSitsAndWhere(tv);
  const start = await snap(tv);
  const rest = async () => {
    await saying(tv, () => expect.poll(async () => { const seen = await snap(tv); return seen.frame.grounded && !/fall|jump|carried/.test(seen.engine.act); }, { timeout: 15_000 }).toBe(true));
  };
  /** The library back at the top (or, with `warm`, after the first step of the remote, which folds the banner), the cat called to the highest shelf with room above it, and told to sit there. */
  const settle = async (warm = false) => {
    await tv.evaluate(() => (document.querySelector<HTMLElement>(".tv-rows")!.scrollTop = 0));
    await tv.waitForTimeout(600);
    if (warm) {
      await tv.keyboard.press("ArrowDown");
      await tv.waitForTimeout(2_500);
    }
    await catIsOnTheShelves(tv);
    const here = (await worldOf(tv)).surfaces.filter((surface) => surface.kind === "shelfTop" && surface.y > 2.2 * L).sort((a, b) => a.y - b.y)[0]!;
    await tellCat(tv, { type: "cat.call", at: { x: (here.x0 + here.x1) / 2, y: here.y } });
    await saying(tv, () => expect.poll(async () => (await snap(tv)).engine.surfaceId, { timeout: 15_000 }).toBe(here.id));
    await catSitsAndWhere(tv);
    return { sat: await snap(tv), shelf: here };
  };

  // a step of the remote (the rows go by at twenty-odd body lengths a second at the quickest): the cat goes with its shelf, and does not fall
  await watchTheCat(tv);
  await tv.evaluate((by) => document.querySelector<HTMLElement>(".tv-rows")!.scrollBy({ top: by, behavior: "smooth" }), 3 * L);
  await tv.waitForTimeout(1_200);
  await stopWatching(tv);
  const stepped = await theBeats(tv);
  expect(stepped.length).toBeGreaterThan(50);
  expect(stepped.some((beat) => beat.flung || beat.act === "fall"), "a step of the remote").toBe(false);
  await rest();
  const before = (await settle()).sat;

  // a fling (a body length a frame, sixty a second, as far as the rows go): the cat does not go up with the shelf
  await watchTheCat(tv);
  await tv.evaluate(async (step) => {
    const rows = document.querySelector<HTMLElement>(".tv-rows")!;
    for (let frame = 0; frame < 80; frame++) {
      rows.scrollTop += step;
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
  }, L);
  await saying(tv, () => expect.poll(async () => { const seen = await snap(tv); return seen.frame.grounded && !/fall|jump|carried/.test(seen.engine.act); }, { timeout: 15_000 }).toBe(true));
  await stopWatching(tv);
  const beats = await theBeats(tv);
  const first = beats.findIndex((beat) => beat.flung);
  expect(first, "it was shaken off").toBeGreaterThanOrEqual(0);
  // (it could not know the page was being flung at the first look at it, and may go up with the shelf for that one, a body length at most -- the page that is flung goes by a body length a frame -- and not a pixel after: from there on it only falls)
  expect(Math.min(...beats.map((beat) => beat.y)), "it rose with the shelf").toBeGreaterThan(before.frame.y - 1.2 * L);
  const air = beats.slice(first).filter((beat) => beat.flung);
  expect(air.length).toBeGreaterThan(5);
  for (let i = first + 1; i < beats.length && beats[i]!.flung; i++) expect(beats[i]!.y, `beat ${i}`).toBeGreaterThanOrEqual(beats[i - 1]!.y - 0.01);
  // (and it hung there, falling, while the page was flying: it was in the air for well over a tenth of a second, and was not down on anything before the page had slowed)
  const landed = beats.findIndex((beat, i) => i > first && beat.grounded);
  expect(landed).toBeGreaterThan(first);
  expect(Math.max(...beats.slice(first, landed).map((beat) => Math.abs(beat.scroll)))).toBeGreaterThan(30);
  const end = await snap(tv);
  expect(end.frame.grounded).toBe(true);
  expect(end.engine.surfaceId).not.toBe(shelf.id);
  expect(end.frame.y).toBeGreaterThan(Math.min(...air.map((beat) => beat.y)) - 1);

  // the first step of the remote from the top of the library (the banner folds up, the rows jump by a banner's half and then scroll a step): the cat goes with its shelf, as it does for any step
  const top = await settle();
  await watchTheCat(tv);
  await tv.keyboard.press("ArrowDown");
  await tv.waitForTimeout(1_500);
  await stopWatching(tv);
  expect((await theBeats(tv)).some((beat) => beat.flung || beat.act === "fall"), "the first step of the remote").toBe(false);
  expect(top.sat.frame.grounded).toBe(true);

  // a page that is not flung, but is scrolled too far and too fast to be a step of the remote -- a wheel spun, two steps of the remote one on the other's heels -- does not take the cat up with its shelf
  // for more than a step and a bit either: it is shaken off, falls (never rising once it is in the air), and lands on something else
  const fellFrom = async (what: string, ready: Awaited<ReturnType<typeof settle>>, gesture: () => Promise<void>) => {
    await watchTheCat(tv);
    await gesture();
    await tv.waitForTimeout(300);
    await rest();
    await stopWatching(tv);
    const seen = await theBeats(tv);
    const left = seen.findIndex((beat) => beat.flung);
    expect(left, `${what}: it was shaken off`).toBeGreaterThanOrEqual(0);
    expect(Math.min(...seen.map((beat) => beat.y)), `${what}: it rose with the shelf`).toBeGreaterThan(ready.sat.frame.y - 4.5 * L);
    // (a cat that had already left the ground in a leap of its own when the page was shaken -- the shelf was going under the top bar, and it had begun to leap to another -- goes on up for a moment,
    // as a cat in the air does, and falls from the top of that: what it must not do is rise again)
    const leaping = left > 0 && seen[left - 1]!.act === "jump" && !seen[left - 1]!.grounded;
    let past = !leaping;
    for (let i = left + 1; i < seen.length && seen[i]!.flung; i++) {
      if (seen[i]!.y > seen[i - 1]!.y + 0.01) past = true;
      if (past) expect(seen[i]!.y, `${what}: beat ${i}`).toBeGreaterThanOrEqual(seen[i - 1]!.y - 0.01);
    }
    expect((await snap(tv)).engine.surfaceId, `${what}: where it landed`).not.toBe(ready.shelf.id);
  };
  const spun = await settle();
  await fellFrom("a wheel spun", spun, async () => {
    const size = tv.viewportSize()!;
    await tv.mouse.move(size.width / 2, size.height * 0.55);
    for (let i = 0; i < 12; i++) {
      await tv.mouse.wheel(0, 100);
      await tv.waitForTimeout(30);
    }
  });
  const hurried = await settle(true);
  await fellFrom("two steps of the remote in a hurry", hurried, async () => {
    await tv.keyboard.press("ArrowDown");
    await tv.waitForTimeout(150);
    await tv.keyboard.press("ArrowDown");
  });
});

/**
 * The cat on the lowest shelf in sight, sitting, and then the rows scrolled up under it by a step of the remote (a smooth scroll of a body length and a half): at every
 * frame of the scroll, where the cat's feet are and where the top of a poster of its shelf is (in the page, where the frames are). What came of it: the frames in which the
 * shelf moved, the farthest the cat was from the shelf (less where it was to begin with), and the frames in which the shelf moved by more than two pixels and the cat did not.
 */
const ridesTheRows = async (tv: Page, slow: number, scroller = ".tv-rows", cards = ".tv-row .tv-tile") => {
  const lowest = async () => {
    const seen = await worldOf(tv);
    return { L: seen.bodyLength, shelf: seen.surfaces.filter((surface) => surface.kind === "shelfTop").sort((a, b) => b.y - a.y)[0]! };
  };
  const { L, shelf } = await lowest();
  // (taken by the scruff, held over the lowest shelf in sight and let go: it lands on it from wherever it was, which a call does not do from the floor of a grid)
  const middle = await catSitsAndWhere(tv);
  const hand = { x: (shelf.x0 + shelf.x1) / 2, y: shelf.y - 1.2 * L - 0.73 * L };
  await tv.mouse.move(middle.x, middle.y);
  await tv.mouse.down();
  await tv.mouse.move(middle.x + 30, middle.y - 30, { steps: 5 });
  await saying(tv, () => expect.poll(async () => (await snap(tv)).engine.act, { timeout: 5_000 }).toBe("carried"));
  await tv.mouse.move(hand.x, hand.y, { steps: 30 });
  await tv.waitForTimeout(500);
  await tv.mouse.up();
  await saying(tv, () =>
    expect
      .poll(async () => {
        const seen = await snap(tv);
        return !/carried|fall/.test(seen.engine.act) && seen.frame.grounded && seen.engine.surfaceId === (await lowest()).shelf.id;
      }, { timeout: 12_000 })
      .toBe(true),
  );
  await catSitsAndWhere(tv);
  // (the screen is slowed once the cat is there: it is the ride that is looked at, and not the way to the shelf)
  const session = await tv.context().newCDPSession(tv);
  await session.send("Emulation.setCPUThrottlingRate", { rate: slow });
  await tv.evaluate((cardsOf) => {
    const w = window as unknown as { __kinoCat: { snapshot(): { engine: { surfaceId: string | null } }; world(): { surfaces: Array<{ id: string; x0: number; x1: number; y: number }> } }; __ride: Array<{ tile: number; cat: number }>; __rideStop?: boolean };
    const hit = document.querySelector<HTMLElement>('[data-testid="cat-hit"]')!;
    const under = w.__kinoCat.world().surfaces.find((surface) => surface.id === w.__kinoCat.snapshot().engine.surfaceId)!;
    const tile = [...document.querySelectorAll<HTMLElement>(cardsOf)]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.left >= under.x0 - 1 && box.right <= under.x1 + 1;
      })
      .sort((a, b) => Math.abs(a.getBoundingClientRect().top - under.y) - Math.abs(b.getBoundingClientRect().top - under.y))[0]!;
    w.__ride = [];
    w.__rideStop = false;
    const tick = () => {
      w.__ride.push({ tile: tile.getBoundingClientRect().top, cat: hit.getBoundingClientRect().bottom });
      if (!w.__rideStop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, cards);
  await tv.waitForTimeout(200);
  await tv.evaluate(([by, selector]) => document.querySelector<HTMLElement>(selector as string)!.scrollBy({ top: by as number, behavior: "smooth" }), [1.5 * L, scroller] as const);
  await tv.waitForTimeout(1_500);
  await tv.evaluate(() => ((window as unknown as { __rideStop: boolean }).__rideStop = true));
  await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const samples = await tv.evaluate(() => (window as unknown as { __ride: Array<{ tile: number; cat: number }> }).__ride);
  const first = samples.findIndex((sample, i) => i > 0 && sample.tile !== samples[0]!.tile);
  let end = first;
  for (let i = Math.max(first, 1); i < samples.length; i++) if (samples[i]!.tile !== samples[i - 1]!.tile) end = i;
  const run = first < 0 ? [] : samples.slice(Math.max(0, first - 1), end + 1);
  const base = run.length > 0 ? run[0]!.cat - run[0]!.tile : 0;
  return {
    L,
    frames: run.length,
    off: Math.max(0, ...run.map((sample) => Math.abs(sample.cat - sample.tile - base))),
    stalls: run.slice(1).filter((sample, i) => Math.abs(sample.tile - run[i]!.tile) > 2 && Math.abs(sample.cat - run[i]!.cat) < 0.5).length,
  };
};

test("on a slow screen, a processor four times slower than this one, the cat still goes with its shelf at every frame as the rows go up under it, and is not left behind in steps", async ({ browser }) => {
  test.setTimeout(120_000);
  const tv = await openLibrary(browser, async (context) => {
    await offered(true)(context);
    await withLibrary(tallLibrary)(context);
  }, undefined, WANTS());
  // (a budget that keeps the cat as it is: this is about how often the page is read, which on a slow screen is a few times in a dozen frames)
  await tv.goto("/tv?cat=debug&catbudget=100000");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await catIsOnTheShelves(tv);
  const ride = await ridesTheRows(tv, 4);
  expect(ride.frames, "the rows were seen to go by").toBeGreaterThan(5);
  expect(ride.stalls, "frames of the scroll in which the cat did not move with the shelf").toBeLessThanOrEqual(1);
  expect(ride.off, "how far it was from its shelf").toBeLessThan(0.1 * ride.L);
});

test("and so on a grid of posters, a category: on a slow screen the cat goes with its line at every frame as the grid goes up under it", async ({ browser }) => {
  test.setTimeout(120_000);
  const long = { updatedAt: Date.now(), rows: [{ id: "long", title: "A long row", source: "Test Source", items: Array.from({ length: 90 }, (_, index) => film(`g${index}`, `Grid film ${index + 1}`)) }] };
  const tv = await openLibrary(browser, async (context) => {
    await offered(true)(context);
    await withLibrary(long)(context);
  }, undefined, WANTS());
  await tv.goto("/tv?cat=debug&catbudget=100000");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await catIsOnTheShelves(tv);
  await tv.getByTestId("rail-categories").click();
  await tv.getByTestId("tv-category-tile").filter({ hasText: "A long row" }).click();
  await expect(tv.getByTestId("tv-category")).toBeVisible();
  await saying(tv, () => expect.poll(async () => (await worldOf(tv)).surfaces.filter((surface) => surface.id.startsWith("grid")).length, { timeout: 10_000 }).toBeGreaterThan(1));
  const ride = await ridesTheRows(tv, 4, ".tv-grid", ".tv-grid .tv-tile");
  expect(ride.frames, "the grid was seen to go by").toBeGreaterThan(5);
  expect(ride.stalls, "frames of the scroll in which the cat did not move with its line").toBeLessThanOrEqual(1);
  expect(ride.off, "how far it was from its line").toBeLessThan(0.1 * ride.L);
});

test("a screen that gets thirty pictures a second still has the cat go with its shelf at every frame as the rows go up under it", async ({ browser }) => {
  test.setTimeout(120_000);
  const tv = await openLibrary(browser, async (context) => {
    await offered(true)(context);
    await withLibrary(tallLibrary)(context);
  }, undefined, WANTS({ look: "ragdoll" }));
  // (a cost told to be over the budget, and not over the budget of the next step down: the screen is held at the picture of thirty a second)
  await tv.goto("/tv?cat=debug&catbudget=1000&catslow=1500");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await artIs(tv, "solid");
  await saying(tv, () => expect.poll(async () => (await snap(tv)).quality, { timeout: 60_000 }).toBe("low"));
  await catIsOnTheShelves(tv);
  const ride = await ridesTheRows(tv, 1);
  expect((await snap(tv)).quality, "it was at thirty pictures a second throughout").toBe("low");
  expect(ride.frames, "the rows were seen to go by").toBeGreaterThan(5);
  expect(ride.stalls, "frames of the scroll in which the cat did not move with the shelf").toBeLessThanOrEqual(1);
  expect(ride.off, "how far it was from its shelf").toBeLessThan(0.1 * ride.L);
});

/** The cat's page of the settings: the settings page, then its row for the cat. */
const openCatSettings = async (tv: Page) => {
  await openTvSettings(tv);
  await tv.getByTestId("tv-cat-open").click();
  await expect(tv.getByTestId("tv-cat-settings")).toBeVisible();
};

test("the settings page has a row for the cat only on a host that offers a cat, and its page has the switch that is the cat", async ({ browser }) => {
  const tv = await openLibrary(browser, setup(false));
  await openTvSettings(tv);
  await expect(tv.getByTestId("tv-group-cat")).toHaveCount(0);

  const other = await openLibrary(browser, setup());
  await openTvSettings(other);
  const row = other.getByTestId("tv-cat-open");
  await expect(other.getByTestId("tv-group-cat")).toBeVisible();
  await expect(row).toContainText("Off");
  await row.click();
  await expect(other.getByTestId("tv-cat-settings")).toBeVisible();
  // (the author of the model the detailed cat is made from is named where the cat is chosen: the licence, CC BY 4.0, asks for that)
  await expect(other.getByTestId("tv-cat-credit")).toContainText("Meshy AI");
  await expect(other.getByTestId("tv-cat-credit")).toContainText("CC BY 4.0");
  const on = other.getByTestId("tv-cat-switch");
  await expect(on).toHaveAttribute("aria-checked", "false");
  await expect(other.getByTestId("tv-cat-quiet")).toHaveCount(0);
  await on.click();
  await expect(on).toHaveAttribute("aria-checked", "true");
  await expect(other.getByTestId("tv-cat-quiet")).toBeVisible();
  await expect(other.getByTestId("tv-cat-films")).toHaveAttribute("aria-checked", "true");
  // Back from the cat's page is the settings page, whose row says how it stands now; Back again is the library
  await other.keyboard.press("Escape");
  await expect(other.getByTestId("tv-account")).toBeVisible();
  await expect(other.getByTestId("tv-cat-open")).toContainText("On");
  // the cat comes without the page being loaded again, and goes the same way
  await other.keyboard.press("Escape");
  await expect(other.getByTestId("cat")).toHaveAttribute("data-visible", "true", { timeout: 12_000 });
  await expect(other.getByTestId("tv-cat-chip")).toBeVisible();
  await openCatSettings(other);
  await other.getByTestId("tv-cat-switch").click();
  await other.keyboard.press("Escape");
  await other.keyboard.press("Escape");
  await expect(other.getByTestId("cat")).toHaveCount(0);
  await expect(other.getByTestId("tv-cat-chip")).toHaveCount(0);
});

test("the settings page and the cat's page of it fit the screen of a TV, in each of the languages, and nothing is over their Back buttons, with the cat's switches all showing", async ({ browser }) => {
  test.setTimeout(120_000);
  // (the Romanian and Italian words, and the credit with the model's title in them, run longer than the English ones)
  for (const lang of ["en", "ro", "it"] as const) {
    const tv = await openLibrary(browser, setup(), undefined, { ...WANTS({ look: "ragdoll" }), "kino.lang": lang });
    await expect(tv.locator("html")).toHaveAttribute("lang", lang);
    for (const [width, height] of [[1280, 720], [1920, 1080], [1366, 768], [1024, 768]] as const) {
      await tv.setViewportSize({ width, height });
      await openTvSettings(tv);
      for (const page of ["tv-account", "tv-cat-settings"]) {
        if (page === "tv-cat-settings") await tv.getByTestId("tv-cat-open").click();
        await expect(tv.getByTestId(page)).toBeVisible();
        const box = await tv.evaluate(() => {
          const grid = document.querySelector(".tv-set-grid")!.getBoundingClientRect();
          const back = document.querySelector(".tv-back")!;
          const at = back.getBoundingClientRect();
          const over = document.elementFromPoint(at.left + at.width / 2, at.top + at.height / 2);
          return { top: grid.top, bottom: grid.bottom, height: innerHeight, free: over === back || back.contains(over) };
        });
        const where = `${lang} ${page} at ${width}x${height}`;
        expect(box.top, where).toBeGreaterThanOrEqual(0);
        expect(box.bottom, where).toBeLessThanOrEqual(box.height);
        expect(box.free, where).toBe(true);
      }
      await tv.keyboard.press("Escape");
      await tv.keyboard.press("Escape");
      await expect(tv.getByTestId("tv-browse")).toBeVisible();
    }
    await tv.context().close();
  }
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
  // (the ginger coat, asked for by the address: the pale ragdoll has no colour of its own to tell it from the page by, the posters have no orange)
  const tv = await openLibrary(browser, setup(), undefined, WANTS({ look: "ragdoll", quiet: true }));
  const meshes: string[] = [];
  tv.on("request", (request) => MESH.test(request.url()) && meshes.push(request.url()));
  await tv.goto("/tv?cat=debug&catbudget=100000&catcoat=ginger");
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
    WANTS({ look: "ragdoll", quiet: true }),
  );
  // (the ginger coat, asked for by the address: the pale ragdoll the device chose has no colour of its own to tell it from the page by, the posters have no orange)
  await tv.goto("/tv?cat=debug&catcoat=ginger");
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
      WANTS({ look: "ragdoll", quiet: true }),
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
  // (gone is gone: what the cat put on the page goes with it, the diagnostics handle too; so "off" is not a quality that can be read, it is the handle that has gone)
  await saying(tv, () => expect.poll(() => tv.evaluate(() => (window as unknown as { __kinoCat?: unknown }).__kinoCat === undefined), { timeout: 50_000 }).toBe(true));
  await expect(tv.getByTestId("tv-cat-chip")).toHaveCount(0);
  await expect(tv.getByTestId("cat")).toHaveCount(0);
  expect(await tv.evaluate(() => document.querySelectorAll(".kino-cat, .kino-cat-hit, .kino-cat-debug, .kino-cat-debug-map, [data-cat-pointed]").length)).toBe(0);
  await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
  await tv.keyboard.press("ArrowRight");
  await expect(tv.getByTestId("tv-browse-tile").nth(1)).toBeFocused();
  // and it does not come back by itself: the page is left as it was, with its keys and its focus
  await tv.waitForTimeout(1500);
  await expect(tv.getByTestId("cat")).toHaveCount(0);
});

test("a screen that cannot afford the detailed cat is given the simple one, and keeps it", async ({ browser }) => {
  test.setTimeout(75_000);
  const tv = await openLibrary(browser, setup(), undefined, WANTS({ look: "ragdoll" }));
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

test("the settings page offers two cats, the white and grey one and the ginger one: the choice is worn at once and kept, and it is the same cat in every place that has one", async ({ browser }) => {
  const tv = await openLibrary(browser, setup(), undefined, WANTS({ look: "ragdoll", quiet: true }));
  await tv.goto("/tv?cat=debug&catbudget=100000");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await artIs(tv, "solid");
  expect((await snap(tv)).coat).toBe("ragdoll");
  // (and the cat has the character of its coat: the grumpy, lazy one)
  expect((await snap(tv)).engine.temperament).toBe("ragdoll");
  await openCatSettings(tv);
  // exactly two cats to choose between (and no coats to pick from any more), the white and grey one chosen, and the page says it is the one that is shown
  await expect(tv.locator('[data-testid^="tv-cat-look-"][role="radio"]')).toHaveCount(2);
  await expect(tv.locator('[data-testid^="tv-cat-coat-"]')).toHaveCount(0);
  await expect(tv.getByTestId("tv-cat-detail")).toHaveCount(0);
  await expect(tv.getByTestId("tv-cat-look-ragdoll")).toHaveAttribute("aria-checked", "true");
  await expect(tv.getByTestId("tv-cat-look-ginger")).toHaveAttribute("aria-checked", "false");
  await expect(tv.getByTestId("tv-cat-shown")).toHaveAttribute("data-art", "solid");
  await expect(tv.getByTestId("tv-cat-retry")).toHaveCount(0);
  // the ginger cat is worn at once: the flat one, in its own colours, and nothing about it needs saying
  await tv.getByTestId("tv-cat-look-ginger").click();
  await expect(tv.getByTestId("tv-cat-look-ginger")).toHaveAttribute("aria-checked", "true");
  await artIs(tv, "classic", 6_000);
  await saying(tv, () => expect.poll(async () => (await snap(tv)).coat, { timeout: 6_000 }).toBe("ginger"));
  // (with its own character, the friendly one, from the moment it is worn)
  await saying(tv, () => expect.poll(async () => (await snap(tv)).engine.temperament, { timeout: 6_000 }).toBe("ginger"));
  await expect(tv.getByTestId("tv-cat-shown")).toHaveCount(0);
  await expect(tv.getByTestId("tv-cat-retry")).toHaveCount(0);
  expect(JSON.parse(await tv.evaluate(() => localStorage.getItem("kino.cat") ?? "{}"))).toMatchObject({ look: "ginger" });
  // and the white and grey one again, at once
  await tv.getByTestId("tv-cat-look-ragdoll").click();
  await artIs(tv, "solid");
  await saying(tv, () => expect.poll(async () => (await snap(tv)).coat, { timeout: 6_000 }).toBe("ragdoll"));
  await saying(tv, () => expect.poll(async () => (await snap(tv)).engine.temperament, { timeout: 6_000 }).toBe("ragdoll"));
  await expect(tv.getByTestId("tv-cat-shown")).toHaveAttribute("data-art", "solid");
});

test("a device that kept the old settings keeps its cat: the detailed one is the white and grey cat, and the simple one is the ginger", async ({ browser }) => {
  const old = (detail: boolean) => ({ "kino.cat": JSON.stringify({ on: true, quiet: true, films: true, detail, coat: detail ? "tuxedo" : "ragdoll", size: "large" }) });
  const simple = await openLibrary(browser, setup(), undefined, old(false));
  await simple.goto("/tv?cat=debug");
  await expect(simple.getByTestId("tv-browse")).toBeVisible();
  await artIs(simple, "classic");
  await saying(simple, () => expect.poll(async () => (await snap(simple)).coat, { timeout: 6_000 }).toBe("ginger"));
  const detailed = await openLibrary(browser, setup(), undefined, old(true));
  await detailed.goto("/tv?cat=debug&catbudget=100000");
  await expect(detailed.getByTestId("tv-browse")).toBeVisible();
  await artIs(detailed, "solid");
  await saying(detailed, () => expect.poll(async () => (await snap(detailed)).coat, { timeout: 6_000 }).toBe("ragdoll"));
});

test("the settings page has the cat's size: it is worn at once and kept for the device, whichever cat it is", async ({ browser }) => {
  const tv = await openLibrary(browser, setup(), undefined, WANTS({ look: "ginger", quiet: true }));
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await artIs(tv, "classic");
  const before = await snap(tv);
  expect(before.body).toBeGreaterThan(40);
  await openCatSettings(tv);
  await expect(tv.getByTestId("tv-cat-size-normal")).toHaveAttribute("aria-checked", "true");
  await tv.getByTestId("tv-cat-size-large").click();
  await saying(tv, () => expect.poll(async () => (await snap(tv)).body, { timeout: 6_000 }).toBeGreaterThan(before.body * 1.2));
  await tv.getByTestId("tv-cat-size-small").click();
  await saying(tv, () => expect.poll(async () => (await snap(tv)).body, { timeout: 6_000 }).toBeLessThan(before.body * 0.9));
  expect(JSON.parse(await tv.evaluate(() => localStorage.getItem("kino.cat") ?? "{}"))).toMatchObject({ look: "ginger", size: "small" });
  expect((await snap(tv)).art).toBe("classic");
});

test("a white and grey cat that is drawn simply is said to be, with the reason, and the settings page has a button to try the detailed one again", async ({ browser }) => {
  // (a browser that will not give the graphics, until the test says it does)
  const tv = await openLibrary(
    browser,
    async (context) => {
      await setup()(context);
      await context.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) => unknown;
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
          return /webgl/.test(kind) && (window as unknown as { __noGl?: boolean }).__noGl !== false ? null : original.call(this, kind, ...rest);
        } as typeof HTMLCanvasElement.prototype.getContext;
        (window as unknown as { __noGl?: boolean }).__noGl = true;
      });
    },
    undefined,
    WANTS({ look: "ragdoll", quiet: true }),
  );
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await artIs(tv, "classic");
  await openCatSettings(tv);
  const said = tv.getByTestId("tv-cat-shown");
  await expect(said).toHaveAttribute("data-art", "classic");
  await expect(said).toHaveAttribute("data-why", "graphics");
  await expect(said).toContainText("simply");
  const retry = tv.getByTestId("tv-cat-retry");
  await expect(retry).toBeVisible();
  // (still no graphics: it is tried and it is the simple one again, with the same reason, and nothing breaks)
  await retry.click();
  await artIs(tv, "classic");
  await expect(said).toHaveAttribute("data-why", "graphics");
  // (and now the browser gives them: another try, and it is the detailed cat)
  await tv.evaluate(() => {
    (window as unknown as { __noGl?: boolean }).__noGl = false;
  });
  await retry.click();
  await artIs(tv, "solid");
  await expect(tv.getByTestId("tv-cat-shown")).toHaveAttribute("data-art", "solid");
  await expect(tv.getByTestId("tv-cat-retry")).toHaveCount(0);
  // the ginger cat is what was asked for when it is the ginger cat that is drawn: there is nothing to be sorry for
  await tv.getByTestId("tv-cat-look-ginger").click();
  await artIs(tv, "classic", 6_000);
  await expect(tv.getByTestId("tv-cat-shown")).toHaveCount(0);
  await expect(tv.getByTestId("tv-cat-retry")).toHaveCount(0);
});

/** The browser takes the picture of the cat that is on the screen away, as a phone does when the page has been in the background or a film asks for the memory. */
const takeThePictureAway = (tv: Page) =>
  tv.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".kino-cat-canvas")!;
    canvas.dataset.old = "yes";
    canvas.getContext("webgl")!.getExtension("WEBGL_lose_context")!.loseContext();
  });
/** The cat is on a canvas that is not the one that was marked as the old one, and that canvas has its picture. */
const theCatIsMadeAnew = (tv: Page) =>
  saying(tv, () =>
    expect
      .poll(
        () =>
          tv.evaluate(() => {
            const canvas = document.querySelector<HTMLCanvasElement>(".kino-cat-canvas");
            // (a canvas of the simple cat has a 2d context, and no WebGL one to ask)
            return canvas !== null && canvas.dataset.old === undefined && canvas.getContext("webgl")?.isContextLost() === false;
          }),
        { timeout: 8_000 },
      )
      .toBe(true),
  );

test("a browser that takes the detailed cat's picture away is not the end of it: the cat is made again from the file it has, and one that keeps doing it gets the simple cat", async ({ browser }) => {
  test.setTimeout(75_000);
  const tv = await openLibrary(browser, setup(), undefined, WANTS({ look: "ragdoll", quiet: true }));
  await tv.goto("/tv?cat=debug&catbudget=100000");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await artIs(tv, "solid");
  await catIsOnTheScreen(tv);
  // (three times in a minute is a thing that happens to a phone: the cat is the detailed one every time, and it is the same cat)
  for (let time = 1; time <= 3; time++) {
    await takeThePictureAway(tv);
    await theCatIsMadeAnew(tv);
    await artIs(tv, "solid");
    await catIsOnTheScreen(tv);
    expect((await snap(tv)).coat).toBe("ragdoll");
  }
  // (made from the file that was already there: a phone on a bad line is not asked to fetch it again. The page's own record of what it fetched, since the one
  // request of a page that was left behind by the address above is not this page's)
  expect(await tv.evaluate(() => performance.getEntriesByType("resource").filter((entry) => /\.mesh(\?|$)/.test(entry.name)).length)).toBe(1);
  // (and the settings page has nothing to be sorry for: it is the cat that was asked for)
  await openCatSettings(tv);
  await expect(tv.getByTestId("tv-cat-shown")).toHaveAttribute("data-art", "solid");
  await expect(tv.getByTestId("tv-cat-retry")).toHaveCount(0);
  await tv.keyboard.press("Escape");
  await tv.keyboard.press("Escape");
  await catIsOnTheScreen(tv);
  // (a card that takes it away again and again is not asked to go on: the fourth time in the minute the simple cat is drawn, in the same colours, and the page says why)
  await takeThePictureAway(tv);
  await artIs(tv, "classic", 8_000);
  await catIsOnTheScreen(tv);
  expect((await snap(tv)).coat).toBe("ragdoll");
  await openCatSettings(tv);
  await expect(tv.getByTestId("tv-cat-shown")).toHaveAttribute("data-art", "classic");
  await expect(tv.getByTestId("tv-cat-shown")).toHaveAttribute("data-why", "lost");
  // (and the button is another try, with the count started again)
  await tv.getByTestId("tv-cat-retry").click();
  await artIs(tv, "solid");
  await expect(tv.getByTestId("tv-cat-retry")).toHaveCount(0);
  await tv.keyboard.press("Escape");
  await tv.keyboard.press("Escape");
  await catIsOnTheScreen(tv);
  await takeThePictureAway(tv);
  await theCatIsMadeAnew(tv);
  await artIs(tv, "solid");
});

test("the address can ask for the coat and the size, whatever the device says", async ({ browser }) => {
  const usual = await openLibrary(browser, setup(), undefined, WANTS({ look: "ragdoll", quiet: true }));
  await usual.goto("/tv?cat=debug&catbudget=100000");
  await expect(usual.getByTestId("tv-browse")).toBeVisible();
  await artIs(usual, "solid");
  const normal = await snap(usual);
  const asked = await openLibrary(browser, setup(), undefined, WANTS({ look: "ragdoll", quiet: true, size: "normal" }));
  await asked.goto("/tv?cat=debug&catbudget=100000&catcoat=calico&catsize=large");
  await expect(asked.getByTestId("tv-browse")).toBeVisible();
  await artIs(asked, "solid");
  await saying(asked, () => expect.poll(async () => (await snap(asked)).coat, { timeout: 6_000 }).toBe("calico"));
  await saying(asked, () => expect.poll(async () => (await snap(asked)).body, { timeout: 6_000 }).toBeGreaterThan(normal.body * 1.2));
  // (a coat that is neither of the two cats is the cat as it always was, whatever the settings say; the usual one has the character of its coat)
  expect((await snap(asked)).engine.temperament).toBe("baseline");
  expect(normal.engine.temperament).toBe("ragdoll");
});

test("the address can ask for either cat, whatever the device says", async ({ browser }) => {
  const simple = await openLibrary(browser, setup(), undefined, WANTS({ look: "ragdoll" }));
  await simple.goto("/tv?cat=debug&catart=classic");
  await expect(simple.getByTestId("tv-browse")).toBeVisible();
  await artIs(simple, "classic");
  const solid = await openLibrary(browser, setup(), undefined, WANTS({ look: "ginger" }));
  await solid.goto("/tv?cat=debug&catart=solid&catbudget=100000");
  await expect(solid.getByTestId("tv-browse")).toBeVisible();
  await artIs(solid, "solid");
});

/* ------------------------------ what the independent review found ------------------------------ */

test("a grid of posters that scrolls under the cat keeps the names of its lines, so a cat on one is not on a shelf that has gone at every few pixels", async ({ browser }) => {
  test.setTimeout(90_000);
  const long = { updatedAt: Date.now(), rows: [library.rows[0]!, { id: "long", title: "A long row", source: "Test Source", items: Array.from({ length: 60 }, (_, index) => film(`g${index}`, `Grid film ${index + 1}`)) }] };
  const tv = await openLibrary(
    browser,
    async (context) => {
      await offered(true)(context);
      await withLibrary(long)(context);
    },
    undefined,
    WANTS(),
  );
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await catIsOnTheShelves(tv);
  await tv.getByTestId("rail-categories").click();
  await tv.getByTestId("tv-category-tile").filter({ hasText: "A long row" }).click();
  await expect(tv.getByTestId("tv-category")).toBeVisible();
  const lines = async () => (await worldOf(tv)).surfaces.filter((surface) => surface.id.startsWith("grid"));
  const scrolled = () => tv.evaluate(() => document.querySelector<HTMLElement>(".tv-grid")!.scrollTop);
  await saying(tv, () => expect.poll(async () => (await lines()).length, { timeout: 10_000 }).toBeGreaterThan(1));
  const before = await lines();
  const start = await scrolled();
  // the grid scrolls by itself a little (the viewer's mouse wheel, the remote going down a line): the lines still in sight are the same shelves, a little higher
  await tv.evaluate(() => {
    document.querySelector<HTMLElement>(".tv-grid")!.scrollTop += 37;
  });
  await saying(tv, () =>
    expect
      .poll(async () => {
        const moved = (await scrolled()) - start;
        const now = await lines();
        const same = before.filter((line) => now.some((one) => one.id === line.id));
        // (at most the line that went out at the top is not there any more)
        return moved > 20 && same.length >= before.length - 1 && same.every((line) => Math.abs(now.find((one) => one.id === line.id)!.y - (line.y - moved)) < 2);
      }, { timeout: 6_000, message: `lines before: ${before.map((line) => line.id).join(" ")}` })
      .toBe(true),
  );
  // and back: the very same names again, none left over from the way
  await tv.evaluate((to) => {
    document.querySelector<HTMLElement>(".tv-grid")!.scrollTop = to;
  }, start);
  await saying(tv, () => expect.poll(async () => (await lines()).map((line) => line.id).join(" "), { timeout: 6_000 }).toBe(before.map((line) => line.id).join(" ")));
});

test("a second hand, a finger while the mouse has the cat, is not the one that lets it go", async ({ browser }) => {
  test.setTimeout(60_000);
  const tv = await openLibrary(browser, setup(), undefined, WANTS());
  await tv.goto("/tv?cat=debug");
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await catIsOnTheShelves(tv);
  const middle = await catSitsAndWhere(tv);
  const L = (await worldOf(tv)).bodyLength;
  await tv.mouse.move(middle.x, middle.y);
  await tv.mouse.down();
  await tv.mouse.move(middle.x + 40, middle.y - 0.8 * L, { steps: 6 });
  await saying(tv, () => expect.poll(async () => (await snap(tv)).engine.act, { timeout: 5_000 }).toBe("carried"));
  // a finger comes down on the cat, moves a good way and comes up, with the mouse still down
  await tv.getByTestId("cat-hit").evaluate((box) => {
    const at = box.getBoundingClientRect();
    const finger = (type: string, dx = 0) =>
      box.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: "touch", isPrimary: true, button: 0, bubbles: true, cancelable: true, clientX: at.left + at.width / 2 + dx, clientY: at.top + at.height / 2 }));
    finger("pointerdown");
    finger("pointermove", 120);
    finger("pointerup", 120);
  });
  await tv.waitForTimeout(300);
  expect((await snap(tv)).engine.act).toBe("carried");
  await expect(tv.getByTestId("cat-hit")).toHaveAttribute("data-held", "");
  // the mouse is the hand that has it, and it is the mouse that lets it go
  await tv.mouse.up();
  await saying(tv, () =>
    expect
      .poll(async () => {
        const seen = await snap(tv);
        return !/carried|fall/.test(seen.engine.act) && seen.frame.grounded;
      }, { timeout: 12_000 })
      .toBe(true),
  );
  await expect(tv.getByTestId("cat-hit")).not.toHaveAttribute("data-held", "");
});

test("a TV that started before its network was up gets its cat when the line comes back, and its button with it, without a new load", async ({ browser }) => {
  test.setTimeout(60_000);
  let asked = 0;
  const tv = await openLibrary(
    browser,
    async (context) => {
      await withLibrary(library)(context);
      // (the first question and the two that follow it, a moment apart, get no answer: a line that is not up yet)
      await context.route("**/api/features", (route) => (++asked <= 3 ? route.abort("failed") : route.fulfill({ json: { cat: true } })));
    },
    undefined,
    WANTS(),
  );
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  await expect.poll(() => asked, { timeout: 15_000 }).toBe(3);
  await tv.waitForTimeout(800);
  await expect(tv.getByTestId("cat")).toHaveCount(0);
  await expect(tv.getByTestId("tv-cat-chip")).toHaveCount(0);
  // the line comes back: the page is told, asks again, and the cat is there
  await tv.evaluate(() => window.dispatchEvent(new Event("online")));
  await catIsOnTheScreen(tv);
  await expect(tv.getByTestId("tv-cat-chip")).toBeVisible();
  expect(asked).toBeGreaterThanOrEqual(4);
});