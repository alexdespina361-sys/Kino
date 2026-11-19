import { expect, type Page } from "@playwright/test";
import { ratingKey } from "../src/shared";
import { LATEST } from "../src/client/changelog/news";
import { guestStorage, openDevice, openLibrary, openProfilePage, openProfilePlace, pressProfilePlace, test, withLibrary, type ProfilePlace } from "./helpers";

const film = (n: number) => ({ id: `f${n}`, title: `Film number ${n}`, year: 1930 + n, kind: "movie", url: `/fixtures/sample.mp4?n=${n}` });
const show = { id: "show-7", title: "The Long Night", year: 2019, kind: "series", url: "https://shows.example/watch/7?s=1&e=1" };
const library = {
  updatedAt: Date.now(),
  rows: [
    { id: "r1", title: "Classics", source: "Test Source", kind: "movie", items: [1, 2, 3, 4, 5, 6].map(film) },
    { id: "r2", title: "Shows", source: "Test Source", kind: "series", items: [show] },
  ],
};
const rated = (url: string, title: string, score: number, season?: number) => ({ key: ratingKey(url, season), at: 1, title, url, score, ratedAt: 1, ...(season ? { season } : {}) });

const tiles = (tv: Page) => tv.getByTestId("tv-browse-tile");
const tileOf = (tv: Page, title: string) => tv.locator(`[data-testid="tv-browse-tile"][title="${title}"]`);
const place = (tv: Page, where: ProfilePlace) => tv.locator(`[data-entry="profile:${where}"]`);
const places = (tv: Page) => tv.getByTestId("tv-category-tile").evaluateAll((all) => all.map((one) => one.getAttribute("data-entry")));

test.describe("the profile's page", () => {
  const night = { key: "url:https://films.example/night-train", at: Date.now() - 60_000, title: "Night Train", url: "https://films.example/night-train", position: 1500, duration: 6000 };
  const seed = guestStorage({ ratings: [rated(film(1).url, film(1).title, 8), rated(film(3).url, film(3).title, 7)], progress: [night] });

  test("says who is watching, with the way to sign in and Settings in its top, and for a guest a row of what it rated and History, each saying how it stands", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    await openProfilePage(tv);
    await expect(tv.getByTestId("tv-account-chip")).toHaveAttribute("aria-current", "page");
    await expect(tv.getByTestId("rail-profile")).toHaveCount(0);
    expect(await places(tv)).toEqual(["profile:ratings", "profile:history", "profile:news"]);
    await expect(tv.locator('.tv-row[data-layout="categories"]').getByTestId("tv-tile-corner")).toHaveCount(0);
    await expect(tv.getByTestId("tv-profile-name")).toHaveText("Guest");
    await expect(tv.getByTestId("tv-profile-tag")).toHaveCount(0);
    await expect(tv.getByTestId("tv-profile-tag-copy")).toHaveCount(0);
    await expect(place(tv, "news")).toContainText(`Kino ${LATEST.version} ·`);
    const recent = tv.locator('section.tv-row[aria-label="Recently watched"]');
    const best = tv.locator('section.tv-row[aria-label="Your highest rated"]');
    await expect(recent.getByTestId("tv-browse-tile")).toHaveCount(1);
    await expect(recent.getByTestId("tv-browse-tile")).toHaveAttribute("title", "Night Train");
    expect(await best.getByTestId("tv-browse-tile").evaluateAll((all) => all.map((one) => one.getAttribute("title")))).toEqual(["Film number 1", "Film number 3"]);
    await expect(tv.getByTestId("tv-profile-settings")).toBeVisible();
    await expect(place(tv, "ratings")).toContainText("2 ratings · average 7.5");
    await expect(place(tv, "history")).toContainText("1 title");

    await expect(tv.getByTestId("tv-profile-signin")).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-profile-settings")).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await expect(place(tv, "news")).toBeFocused();
    await tv.keyboard.press("ArrowLeft");
    await expect(place(tv, "history")).toBeFocused();
    await tv.keyboard.press("ArrowLeft");
    await expect(place(tv, "ratings")).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(place(tv, "history")).toBeFocused();
    await tv.keyboard.press("ArrowLeft");
    await expect(place(tv, "ratings")).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await expect(recent.getByTestId("tv-browse-tile")).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await expect(best.getByTestId("tv-browse-tile").first()).toBeFocused();
    await tv.keyboard.press("ArrowUp");
    await tv.keyboard.press("ArrowUp");
    await expect(place(tv, "ratings")).toBeFocused();
    await tv.keyboard.press("ArrowUp");
    await expect(tv.getByTestId("tv-profile-signin")).toBeFocused();
    await tv.keyboard.press("ArrowUp");
    await expect(tv.getByTestId("tv-page-back")).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-account-chip")).toBeFocused();
  });

  test("Down from any of its top buttons lands on the place under that button, not always on the first (at a TV's 1920 and a laptop's 1366)", async ({ browser }) => {
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
      const tv = await openLibrary(browser, withLibrary(library), viewport, seed);
      await openProfilePage(tv);
      const reached = new Set<string>();
      for (const id of ["tv-profile-signin", "tv-profile-settings", "tv-profile-feedback"]) {
        await tv.getByTestId(id).focus();
        await tv.keyboard.press("ArrowDown");
        const landed = await tv.evaluate((id) => {
          const from = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
          const middle = from.left + from.width / 2;
          const far = (one: Element) => Math.max(one.getBoundingClientRect().left - middle, 0, middle - one.getBoundingClientRect().right);
          const nearest = [...document.querySelectorAll('[data-entry^="profile:"]')].sort((a, b) => far(a) - far(b))[0]!;
          return { focused: document.activeElement?.getAttribute("data-entry"), nearest: nearest.getAttribute("data-entry") };
        }, id);
        expect(landed.focused, `${id} at ${viewport.width}`).toBe(landed.nearest);
        reached.add(landed.focused!);
      }
      expect(reached.has("profile:ratings"), `at ${viewport.width}`).toBe(true);
      expect(reached.size, `at ${viewport.width}`).toBeGreaterThan(1);
      await tv.context().close();
    }
  });

  test("opens the settings and the way to sign in, and Back from either returns to it with the remote where it was", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    await openProfilePage(tv);
    await pressProfilePlace(tv, "settings");
    await expect(tv.getByTestId("tv-account")).toBeVisible();
    await tv.getByTestId("tv-account-back").click();
    await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "profile");
    await expect(tv.getByTestId("tv-profile-settings")).toBeFocused();

    await tv.keyboard.press("ArrowLeft");
    await expect(tv.getByTestId("tv-profile-signin")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-signin-email")).toBeVisible();
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "profile");
  });

  test("What's new, its last place: every version, the newest first, the remote walking its lines; Back returns to the place, which says New only until opened on a screen that had seen an older one", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library), undefined, { ...seed, "kino.seenVersion": "0.0.1" });
    await openProfilePage(tv);
    await expect(place(tv, "news")).toContainText("What's new");
    await expect(place(tv, "news")).toContainText(`New: Kino ${LATEST.version}`);
    await place(tv, "news").focus();
    await tv.keyboard.press("Enter");
    const page = tv.getByTestId("tv-news");
    await expect(page).toBeVisible();
    await expect(page.locator(".news-version").first()).toHaveAttribute("data-version", LATEST.version);
    await expect(page.locator(".news-head").first()).toContainText(`Kino ${LATEST.version}`);
    const lines = page.locator(".news-lines li");
    await expect(lines.first()).toBeFocused();
    const count = await lines.count();
    expect(count).toBeGreaterThan(3);
    for (let at = 1; at < count; at++) await tv.keyboard.press("ArrowDown");
    await expect(lines.last()).toBeFocused();
    await expect(lines.last()).toBeInViewport({ ratio: 1 });
    for (let at = 1; at < count; at++) await tv.keyboard.press("ArrowUp");
    await expect(lines.first()).toBeFocused();
    await tv.keyboard.press("ArrowUp");
    await expect(tv.getByTestId("tv-news-back")).toBeFocused();
    await tv.keyboard.press("Escape");
    await expect(page).toHaveCount(0);
    await expect(place(tv, "news")).toBeFocused();
    await expect(place(tv, "news")).toContainText(`Kino ${LATEST.version} ·`);
    await expect(place(tv, "news")).not.toContainText("New:");
    expect(await tv.evaluate(() => localStorage.getItem("kino.seenVersion"))).toBe(LATEST.version);
  });

  test("What's new fits a 720p screen in Italian, and a phone's width: nothing wider than the screen, the way back on it", async ({ browser }) => {
    for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      const tv = await openDevice(browser, { viewport, locale: "it-IT" }, seed, withLibrary(library));
      await tv.goto("/tv");
      await expect(tv.getByTestId("tv-browse")).toBeVisible();
      await tv.getByTestId("tv-account-chip").click();
      await place(tv, "news").click();
      await expect(tv.getByTestId("tv-news")).toBeVisible();
      await expect(tv.locator(".news-lines li").first()).toBeVisible();
      await expect(tv.getByTestId("tv-news-back")).toBeInViewport({ ratio: 1 });
      const wide = await tv.evaluate(() => [...document.querySelectorAll<HTMLElement>(".news-lines li, .news-head")].filter((one) => one.scrollWidth > one.clientWidth + 1 || one.getBoundingClientRect().right > innerWidth + 0.5).length);
      expect(wide, `at ${viewport.width}`).toBe(0);
      expect(await tv.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await tv.context().close();
    }
  });

  test("is left with Back: to Home, and Back from Home opens the menu", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    await openProfilePage(tv);
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "home");
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-rail")).toHaveAttribute("data-open", "true");
    await expect(tv.getByTestId("rail-home")).toBeFocused();
  });

  test("keeps its place for ratings for a profile that had turned them off (they are on for everybody), and the remote comes back to Settings", async ({ browser }) => {
    const off = guestStorage({ ratings: [rated(film(1).url, film(1).title, 8)], settings: [{ key: "ratings", at: Date.now(), value: false }] });
    const tv = await openLibrary(browser, withLibrary(library), undefined, off);
    await openProfilePlace(tv, "settings");
    await expect(tv.getByTestId("tv-account")).toBeVisible();
    await expect(tv.getByTestId("tv-ratings-switch")).toHaveCount(0);
    await tv.getByTestId("tv-account-back").click();
    expect(await places(tv)).toEqual(["profile:ratings", "profile:history", "profile:news"]);
    await expect(tv.getByTestId("tv-profile-settings")).toBeFocused();
  });

  for (const language of [
    { name: "English", locale: "en-US" },
    { name: "Romanian", locale: "ro-RO" },
    { name: "Italian", locale: "it-IT" },
  ]) {
    for (const screen of [
      { name: "720p", width: 1280, height: 720 },
      { name: "1080p", width: 1920, height: 1080 },
      { name: "4:3", width: 1024, height: 768 },
      { name: "a phone's width", width: 390, height: 844 },
      { name: "a phone held sideways", width: 844, height: 390 },
      { name: "a small phone held sideways", width: 568, height: 320 },
    ]) {
      test(`its head, its places and what they say fit the screen: ${language.name}, ${screen.name}`, async ({ browser }) => {
        const tv = await openDevice(browser, { viewport: { width: screen.width, height: screen.height }, locale: language.locale }, guestStorage({}), withLibrary(library));
        await tv.goto("/tv");
        await expect(tv.getByTestId("tv-browse")).toBeVisible();
        const room = await tv.getByTestId("tv-rail").evaluate((rail) => ({ needed: rail.scrollHeight, given: rail.clientHeight }));
        expect(room.needed).toBeLessThanOrEqual(room.given);
        await tv.getByTestId("tv-account-chip").click();
        await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "profile");
        await expect(tv.getByTestId("tv-category-tile")).toHaveCount(3);

        const cut = await tv.getByTestId("tv-category-tile").evaluateAll((all) =>
          all.flatMap((one) => {
            const tile = one.getBoundingClientRect();
            return [...one.querySelectorAll<HTMLElement>(".tv-category-name, .tv-category-count")]
              .filter((text) => {
                const at = text.getBoundingClientRect();
                const outside = at.top < tile.top - 0.5 || at.bottom > tile.bottom + 0.5 || at.left < tile.left - 0.5 || at.right > tile.right + 0.5;
                return outside || text.scrollWidth > text.clientWidth + 1 || text.scrollHeight > text.clientHeight + 1;
              })
              .map((text) => `${one.getAttribute("data-entry")}: ${text.textContent}`);
          }),
        );
        expect(cut).toEqual([]);
        expect(await tv.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

        const corner = (await tv.getByTestId("tv-account-chip").boundingBox())!;
        for (const id of ["tv-profile-signin", "tv-profile-settings", "tv-profile-feedback"]) {
          await expect(tv.getByTestId(id)).toBeInViewport({ ratio: 1 });
          const box = (await tv.getByTestId(id).boundingBox())!;
          const apart = box.y >= corner.y + corner.height - 0.5 || box.y + box.height <= corner.y + 0.5 || box.x >= corner.x + corner.width - 0.5 || box.x + box.width <= corner.x + 0.5;
          expect(apart, `${id} is clear of the corner's button`).toBe(true);
        }

        const last = (await tv.getByTestId("rail-connect").boundingBox())!;
        expect(last.y + last.height).toBeLessThanOrEqual(screen.height + 0.5);
        expect(last.y).toBeGreaterThanOrEqual(0);
      });
    }
  }
});

test.describe("the score a profile gave a title", () => {
  const SCORES = [
    rated(film(1).url, film(1).title, 8),
    rated(film(3).url, film(3).title, 10),
    rated(show.url, show.title, 7),
    rated(film(4).url, film(4).title, 2, 2),
  ];
  const seed = guestStorage({ ratings: SCORES });
  const badge = (tv: Page, title: string) => tileOf(tv, title).getByTestId("score-badge");

  test("shows in the corner of its picture in the rows and the grids, and in a search; a title with none shows none", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library, (query) => [film(1), film(2), film(3), film(4)].filter((each) => each.title.toLowerCase().includes(query))), undefined, seed);
    await expect(tiles(tv).first()).toBeFocused();
    await expect(badge(tv, "Film number 1")).toHaveText("8");
    await expect(badge(tv, "Film number 3")).toHaveText("10");
    await expect(badge(tv, "Film number 2")).toHaveCount(0);
    await expect(badge(tv, "Film number 4")).toHaveCount(0);
    await expect(badge(tv, "The Long Night")).toHaveText("7");
    await expect(tv.getByTestId("score-badge")).toHaveCount(3);
    await expect(badge(tv, "Film number 1")).toHaveAttribute("title", "Your rating: 8/10");

    await tv.getByTestId("rail-categories").click();
    await tv.getByTestId("tv-category-tile").first().click();
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Classics");
    await expect(tv.getByTestId("score-badge")).toHaveText(["8", "10"]);
    await tv.getByTestId("rail-search").click();
    await tv.keyboard.type("film number");
    await expect(tv.getByTestId("tv-search-status")).toContainText("6 titles");
    await expect(tv.getByTestId("score-badge")).toHaveText(["8", "10"]);
  });

  test("is not covered by the round button a mouse gets in the opposite corner", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    const tile = tileOf(tv, "Film number 1");
    const score = (await tile.getByTestId("score-badge").boundingBox())!;
    const corner = (await tile.getByTestId("tv-tile-corner").boundingBox())!;
    const art = (await tile.locator(".tv-tile-art").boundingBox())!;
    expect(score.x + score.width).toBeLessThan(corner.x);
    expect(score.x).toBeGreaterThanOrEqual(art.x);
    expect(score.y).toBeGreaterThanOrEqual(art.y);
    expect(corner.x + corner.width).toBeLessThanOrEqual(art.x + art.width + 0.5);
  });

  test("is not on the list of ratings, where the score is under each title already", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    await openProfilePlace(tv, "ratings");
    await expect(tv.getByTestId("tv-view-title")).toHaveText("My ratings");
    await expect(tiles(tv)).toHaveCount(4);
    await expect(tv.getByTestId("score-badge")).toHaveCount(0);
    await expect(tileOf(tv, "Film number 1")).toContainText("8/10");
  });

  test("filters what was rated by kind and by score, with the remote and with a mouse: each button says how many it keeps, a title opened and left keeps the filter", async ({ browser }) => {
    const toon = { id: "t1", title: "Toon Town", year: 2001, kind: "movie", section: "cartoon", url: "https://toons.example/watch/1" };
    const withToons = { ...library, rows: [...library.rows, { id: "r3", title: "Cartoons", source: "Test Source", kind: "movie", section: "cartoon", items: [toon] }] };
    const ratings = [rated(film(1).url, film(1).title, 8), rated(film(2).url, film(2).title, 9), rated(toon.url, toon.title, 9), { ...rated(show.url, show.title, 8), kind: "series" }];
    const tv = await openLibrary(browser, withLibrary(withToons), undefined, guestStorage({ ratings }));
    await openProfilePlace(tv, "ratings");
    await expect(tiles(tv)).toHaveCount(4);
    await expect(tv.locator('[data-testid^="rating-filter-"]')).toHaveText(["All4", "Movies2", "Series1", "Cartoons1"]);
    await expect(tv.locator('[data-testid^="rating-score-"]')).toHaveText(["Any score4", "92", "82"]);

    await tiles(tv).first().focus();
    await tv.keyboard.press("ArrowUp");
    await expect(tv.getByTestId("rating-score-any")).toBeFocused();
    await tv.keyboard.press("ArrowUp");
    await expect(tv.getByTestId("rating-filter-all")).toBeFocused();
    for (let step = 0; step < 3; step++) await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("rating-filter-cartoon")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("rating-filter-cartoon")).toHaveAttribute("aria-checked", "true");
    await expect(tiles(tv)).toHaveCount(1);
    await expect(tileOf(tv, "Toon Town")).toBeVisible();
    await expect(tv.getByTestId("rating-filter-cartoon")).toBeFocused();
    await expect(tv.locator('[data-testid^="rating-score-"]')).toHaveCount(0);
    await tv.keyboard.press("ArrowDown");
    await expect(tileOf(tv, "Toon Town")).toBeFocused();

    await tv.getByTestId("rating-filter-all").click();
    await tv.getByTestId("rating-score-9").click();
    await expect(tiles(tv)).toHaveCount(2);
    await expect(tv.locator(".tv-view-meta").first()).toHaveText("2 ratings · average 9");
    await tv.getByTestId("rating-filter-movie").click();
    await expect(tiles(tv)).toHaveCount(1);
    await expect(tileOf(tv, "Film number 2")).toBeVisible();

    await tileOf(tv, "Film number 2").focus();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-detail")).toBeVisible();
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
    await expect(tv.getByTestId("rating-filter-movie")).toHaveAttribute("aria-checked", "true");
    await expect(tv.getByTestId("rating-score-9")).toHaveAttribute("aria-checked", "true");
    await expect(tiles(tv)).toHaveCount(1);
  });

  test("puts an anime that was rated under Anime, a show or a film, once the server says what it is, not under Series or Movies (the owner's report of 19 Nov)", async ({ browser }) => {
    const spy = { ...rated("https://filmpire.sc/watch/120089", "SPY x FAMILY", 9), kind: "series" };
    const zero = rated("https://filmpire.sc/watch/397567", "No Game No Life: Zero", 10);
    const boss = rated("https://filmpire.sc/watch/295693", "The Boss Baby", 8);
    const asked: string[] = [];
    const tv = await openLibrary(
      browser,
      async (context) => {
        await withLibrary(library)(context);
        await context.route(/\/api\/library\/title/, (route) => {
          const id = new URL(route.request().url()).searchParams.get("id") ?? "";
          asked.push(id);
          const anime = id === "filmpire-tv-120089" || id === "filmpire-movie-397567";
          return route.fulfill({ json: { item: { id, title: id, url: "https://filmpire.sc/watch/1", kind: id.includes("-tv-") ? "series" : "movie", ...(anime ? { section: "anime" } : {}) } } });
        });
      },
      undefined,
      guestStorage({ ratings: [spy, zero, boss] }),
    );
    await openProfilePlace(tv, "ratings");
    await expect(tv.locator('[data-testid^="rating-filter-"]')).toHaveText(["All3", "Movies1", "Anime2"]);
    expect(asked).toEqual(expect.arrayContaining(["filmpire-tv-120089", "filmpire-movie-397567", "filmpire-movie-295693"]));
    await tv.getByTestId("rating-filter-anime").click();
    await expect(tiles(tv)).toHaveCount(2);
    await expect(tileOf(tv, "No Game No Life: Zero")).toBeVisible();
    await tv.getByTestId("rating-filter-movie").click();
    await expect(tiles(tv)).toHaveCount(1);
    await expect(tileOf(tv, "The Boss Baby")).toBeVisible();
  });

  test("is there for a profile that had turned ratings off (they are on for everybody), with what was rated, and the settings have no switch for it", async ({ browser }) => {
    const off = guestStorage({ ratings: SCORES, settings: [{ key: "ratings", at: Date.now(), value: false }] });
    const tv = await openLibrary(browser, withLibrary(library), undefined, off);
    await expect(tv.getByTestId("score-badge")).toHaveCount(3);
    await openProfilePlace(tv, "settings");
    await expect(tv.getByTestId("tv-account")).toBeVisible();
    await expect(tv.getByTestId("tv-ratings-switch")).toHaveCount(0);
  });

  test("follows a score as it is given and taken back on a title's page", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library), undefined, guestStorage({}));
    await expect(tv.getByTestId("score-badge")).toHaveCount(0);
    await tileOf(tv, "Film number 2").click();
    await tv.getByTestId("tv-detail-rate").click();
    await tv.getByTestId("rate-score-9").click();
    await tv.getByTestId("tv-detail-close").click();
    await expect(badge(tv, "Film number 2")).toHaveText("9");

    await tileOf(tv, "Film number 2").click();
    await tv.getByTestId("tv-detail-rate").click();
    await tv.getByTestId("rate-remove").click();
    await tv.getByTestId("rate-done").click();
    await tv.getByTestId("tv-detail-close").click();
    await expect(tv.getByTestId("score-badge")).toHaveCount(0);
  });
});
