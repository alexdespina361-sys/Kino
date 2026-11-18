import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { guestStorage, openDevice, openTvSettings, PHONE, place, pressMenuLine, readPairingCode, test, withLibrary } from "./helpers";

const watch = (n: number) => `https://filmpire.sc/watch/${n}`;
const title = (n: number, name: string, extra: Record<string, unknown>) => ({ id: `filmpire-${extra.kind === "series" ? "tv" : "movie"}-${n}`, title: name, year: 2010, url: watch(n), image: `/p${n}.jpg`, ...extra });
const kid = title(101, "Kid Cartoon", { kind: "movie", section: "cartoon", kids: true });
const grownCartoon = title(102, "Grown Cartoon", { kind: "movie", section: "cartoon" });
const kidAnime = title(103, "Kid Anime", { kind: "series", section: "anime", kids: true });
const grownFilm = title(104, "Grown Film", { kind: "movie" });
const unlistedKid = title(105, "Unlisted Kid", { kind: "movie", section: "cartoon", kids: true });
const unlistedGrown = title(106, "Unlisted Grown", { kind: "movie" });
const kidToo = title(107, "Kid Cartoon Two", { kind: "movie", section: "cartoon", kids: true });
const EVERY = [kid, grownCartoon, kidAnime, grownFilm, unlistedKid, unlistedGrown, kidToo];
const NOT_FOR_CHILDREN = ["Grown Cartoon", "Kid Anime", "Grown Film", "Unlisted Grown"];

const library = {
  updatedAt: Date.now(),
  rows: [
    { id: "toons", title: "Toon Shelf", source: "Test Source", section: "cartoon", items: [kid, grownCartoon, kidToo] },
    { id: "anime", title: "Anime Shelf", source: "Test Source", section: "anime", items: [kidAnime] },
    { id: "films", title: "Film Shelf", source: "Test Source", kind: "movie", items: [grownFilm] },
  ],
};

async function serve(context: BrowserContext): Promise<void> {
  await withLibrary(library, () => ({ items: [kid, grownCartoon, kidAnime, grownFilm, kidToo], exact: 5 }))(context);
  await context.route(/\/api\/library\/title\?/, (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    return route.fulfill({ json: { item: EVERY.find((each) => each.id === id) ?? null } });
  });
  await context.route(/\/api\/library\/about\?/, (route) =>
    route.fulfill({ json: { about: { genres: ["Animation"], directors: [], creators: [], cast: [], ages: {}, parts: [kidToo, grownCartoon], similar: [grownFilm, kidAnime, kid] } } }),
  );
}

const card = (item: { title: string; url: string }, at: number) => ({ key: `card-${item.url.slice(-3)}`, at, title: item.title, url: item.url, position: 600, duration: 5400 });
const cards = [card(kid, 4), card(grownFilm, 3), card(unlistedKid, 2), card(unlistedGrown, 1)];
const CHILD = { key: "child", at: 1, value: true };

async function recordShown(context: BrowserContext, names: readonly string[]): Promise<void> {
  await context.addInitScript((watched) => {
    const seen = new Set<string>();
    (window as unknown as { __shown: Set<string> }).__shown = seen;
    const look = () => {
      const root = document.documentElement;
      if (!root) return;
      const text = `${root.textContent ?? ""} ${[...root.querySelectorAll("[title],[aria-label]")].map((each) => `${each.getAttribute("title") ?? ""} ${each.getAttribute("aria-label") ?? ""}`).join(" ")}`;
      for (const name of watched) if (text.includes(name)) seen.add(name);
    };
    new MutationObserver(look).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  }, names);
}
const shown = (page: Page) => page.evaluate(() => [...(window as unknown as { __shown: Set<string> }).__shown]);

async function onlyForChildren(page: Page, also: readonly string[] = []): Promise<void> {
  for (const name of [...NOT_FOR_CHILDREN, ...also]) await expect(page.locator("body"), name).not.toContainText(name);
}

const viewport = { width: 1280, height: 720 };

async function childTv(browser: Browser, path = "/tv", watching = cards): Promise<Page> {
  const tv = await openDevice(browser, { viewport }, guestStorage({ settings: [CHILD], progress: watching }), serve);
  await tv.goto(path);
  await expect(tv.getByTestId("tv-browse")).toBeVisible();
  return tv;
}

test.describe("a child's profile on the TV", () => {
  test("has only the cartoons for children: Home, its own cards, the search, the categories, a title's page and the rows under it", async ({ browser }) => {
    const tv = await childTv(browser);
    const browse = tv.getByTestId("tv-browse");
    await expect(browse).toContainText("Kid Cartoon");
    await expect(browse).toContainText("Unlisted Kid");
    await onlyForChildren(tv, ["Anime Shelf", "Film Shelf"]);
    for (const line of ["rail-movies", "rail-series", "rail-cartoons", "rail-anime", "rail-party"]) await expect(tv.getByTestId(line)).toHaveCount(0);
    await expect(tv.getByTestId("rail-search")).toHaveCount(1);

    await tv.getByTestId("rail-search").click();
    await expect(tv.getByTestId("tv-search")).toBeVisible();
    await tv.keyboard.type("cartoon");
    await expect(tv.getByTestId("tv-search")).toContainText("Kid Cartoon Two");
    await onlyForChildren(tv);

    await tv.getByTestId("rail-categories").click();
    await expect(tv.getByTestId("tv-view-title")).toHaveText(en["tv.cartoonCategories"]);
    await onlyForChildren(tv, ["Anime Shelf", "Film Shelf"]);

    await tv.getByTestId("rail-home").click();
    await tv.locator('[data-testid="tv-browse-tile"][title="Kid Cartoon"]').first().click();
    await expect(tv.getByTestId("tv-detail")).toContainText("Kid Cartoon");
    await expect(tv.getByTestId("tv-detail")).toContainText("Kid Cartoon Two");
    await onlyForChildren(tv);
  });

  test("opens a title's link for children, and says so of any other one over its Home", async ({ browser }) => {
    const tv = await childTv(browser, "/tv?title=movie-104");
    await expect(tv.getByTestId("tv-browse")).toContainText(en["notice.notForChild"]);
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
    await onlyForChildren(tv);

    const again = await childTv(browser, "/tv?title=movie-101");
    await expect(again.getByTestId("tv-detail")).toContainText("Kid Cartoon");
  });

  test("is turned on and off from the TV's own settings, and what was open of the rest closes", async ({ browser }) => {
    const tv = await openDevice(browser, { viewport }, guestStorage({ progress: cards }), serve);
    await tv.goto("/tv");
    await tv.getByTestId("rail-movies").click();
    await expect(tv.getByTestId("tv-browse")).toContainText("Grown Film");

    await openTvSettings(tv);
    await expect(tv.getByTestId("tv-child-help")).toHaveText(en["settings.childNote"]);
    await tv.getByTestId("tv-child").click();
    await expect(tv.getByTestId("tv-child")).toHaveAttribute("aria-checked", "true");
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-account")).toHaveCount(0);
    await expect(tv.getByTestId("tv-browse")).toContainText("Kid Cartoon");
    await onlyForChildren(tv, ["Anime Shelf", "Film Shelf"]);

    await openTvSettings(tv);
    await tv.getByTestId("tv-child").click();
    await expect(tv.getByTestId("tv-child")).toHaveAttribute("aria-checked", "false");
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("rail-movies")).toBeVisible();
    await expect(tv.getByTestId("tv-browse")).toContainText("Grown Film");
  });

  test("signed in on a screen new to it, shows nothing that is not for children while its settings are on their way", async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    await serve(context);
    await recordShown(context, NOT_FOR_CHILDREN);
    const name = `child${Date.now().toString(36)}`;
    const made = await context.request.post("/api/auth/register", { data: { email: name, password: "kino-test-pass-1", device: "tv" } });
    expect(made.ok()).toBe(true);
    const profile = ((await made.json()) as { profiles: Array<{ id: string }> }).profiles[0]!.id;
    const at = Date.now();
    const sync = await context.request.post(`/api/profiles/${profile}/sync`, { data: { since: 0, settings: [{ key: "child", at, value: true }], progress: cards.map((each) => ({ ...each, at: at - each.at })) } });
    expect(sync.ok()).toBe(true);
    for (const slow of [/\/api\/me$/, /\/api\/profiles\/[^/]+\/sync/]) {
      await context.route(slow, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        await route.continue();
      });
    }
    const tv = await context.newPage();
    await tv.goto("/tv");
    await expect(tv.getByTestId("tv-browse")).toContainText("Kid Cartoon");
    await expect(tv.getByTestId("tv-browse")).toContainText("Unlisted Kid");
    await expect(tv.getByTestId("rail-movies")).toHaveCount(0);
    expect(await shown(tv)).toEqual([]);
  });
});

test.describe("a child's profile on the phone", () => {
  test("has only the cartoons for children: Home, the search, See all, a title's page, and no watch party or box for links", async ({ browser }) => {
    const tv = await openDevice(browser, { viewport }, {}, serve);
    await tv.goto("/tv");
    await pressMenuLine(tv, "rail-connect");
    const phone = await openDevice(browser, PHONE, { ...guestStorage({ settings: [CHILD], progress: cards }), "kino.linkbox": "1" }, serve);
    await phone.goto("/");
    await phone.getByTestId("code-input").fill(await readPairingCode(tv));
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");

    await expect(phone.getByTestId("home-panel")).toContainText("Kid Cartoon");
    await expect(phone.getByTestId("home-panel")).toContainText("Unlisted Kid");
    await onlyForChildren(phone, ["Anime Shelf", "Film Shelf"]);
    await expect(phone.getByTestId("filter-movies")).toHaveCount(0);
    await expect(phone.getByTestId("url-input")).toHaveCount(0);

    await phone.getByTestId("row-see-all").first().click();
    await expect(phone.getByTestId("row-page")).toContainText("Kid Cartoon Two");
    await onlyForChildren(phone);
    await phone.getByTestId("page-back").click();

    await place(phone, "search");
    await phone.getByTestId("library-search-input").fill("cartoon");
    await expect(phone.getByTestId("library-search-results")).toContainText("Kid Cartoon Two");
    await onlyForChildren(phone);
    await phone.getByTestId("library-result").first().click();
    await expect(phone.getByTestId("title-sheet")).toContainText("Kid Cartoon");
    await expect(phone.getByTestId("title-sheet")).toContainText("Kid Cartoon Two");
    await onlyForChildren(phone);

    await phone.getByTestId("title-back").click();
    await phone.getByTestId("menu").click();
    await expect(phone.getByTestId("tvs-open")).toBeVisible();
    await expect(phone.getByTestId("party-open")).toHaveCount(0);
  });
});
