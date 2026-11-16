import { expect, type Page } from "@playwright/test";
import { ratingKey } from "../src/shared";
import { guestStorage, openDevice, openLibrary, openProfilePage, openProfilePlace, pressProfilePlace, test, withLibrary, type ProfilePlace } from "./helpers";

/**
 * The profile on the TV: the button in the corner opens a page of who is watching and the places that belong to them (what they rated, their
 * friends, History), with Settings in the page's own corner, and what they rated shows as a score on the pictures of the titles. The friends' side
 * of it (a profile that is signed in and has them on) is in friends-tv.spec.ts, which has the accounts for it.
 */

const film = (n: number) => ({ id: `f${n}`, title: `Film number ${n}`, year: 1930 + n, kind: "movie", url: `/fixtures/sample.mp4?n=${n}` });
const show = { id: "show-7", title: "The Long Night", year: 2019, kind: "series", url: "https://shows.example/watch/7?s=1&e=1" };
const library = {
  updatedAt: Date.now(),
  rows: [
    { id: "r1", title: "Classics", source: "Test Source", kind: "movie", items: [1, 2, 3, 4, 5, 6].map(film) },
    { id: "r2", title: "Shows", source: "Test Source", kind: "series", items: [show] },
  ],
};
/** A rating as a profile keeps it (`season`: of one season of a show only). */
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
    await expect(tv.getByTestId("rail-profile")).toHaveCount(0); // (who is watching is the corner's button, not a line of the menu)
    expect(await places(tv)).toEqual(["profile:ratings", "profile:history"]);
    await expect(tv.locator('.tv-row[data-layout="categories"]').getByTestId("tv-tile-corner")).toHaveCount(0); // (a place is no title to keep)
    await expect(tv.getByTestId("tv-profile-name")).toHaveText("Guest");
    await expect(tv.getByTestId("tv-profile-tag")).toHaveCount(0); // (a guest has no tag: friends are for a profile)
    await expect(tv.getByTestId("tv-profile-tag-copy")).toHaveCount(0);
    // Under the places, a look at what was watched last and what was liked best (the highest first).
    const recent = tv.locator('section.tv-row[aria-label="Recently watched"]');
    const best = tv.locator('section.tv-row[aria-label="Your highest rated"]');
    await expect(recent.getByTestId("tv-browse-tile")).toHaveCount(1);
    await expect(recent.getByTestId("tv-browse-tile")).toHaveAttribute("title", "Night Train");
    expect(await best.getByTestId("tv-browse-tile").evaluateAll((all) => all.map((one) => one.getAttribute("title")))).toEqual(["Film number 1", "Film number 3"]);
    await expect(tv.getByTestId("tv-profile-settings")).toBeVisible();
    await expect(place(tv, "ratings")).toContainText("2 ratings · average 7.5");
    await expect(place(tv, "history")).toContainText("1 title");

    // A guest came for one thing: the remote starts on the way to sign in; Right of it is Settings, Down from either the place nearest under it.
    await expect(tv.getByTestId("tv-profile-signin")).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-profile-settings")).toBeFocused();
    await tv.keyboard.press("ArrowDown"); // (Settings is on the right: History, not My ratings at the far left)
    await expect(place(tv, "history")).toBeFocused();
    await tv.keyboard.press("ArrowLeft");
    await expect(place(tv, "ratings")).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(place(tv, "history")).toBeFocused();
    await tv.keyboard.press("ArrowLeft");
    await expect(place(tv, "ratings")).toBeFocused();
    await tv.keyboard.press("ArrowDown"); // (Down from the places, the rows under them)
    await expect(recent.getByTestId("tv-browse-tile")).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await expect(best.getByTestId("tv-browse-tile").first()).toBeFocused();
    await tv.keyboard.press("ArrowUp");
    await tv.keyboard.press("ArrowUp");
    await expect(place(tv, "ratings")).toBeFocused();
    await tv.keyboard.press("ArrowUp");
    await expect(tv.getByTestId("tv-profile-signin")).toBeFocused();
    await tv.keyboard.press("ArrowUp"); // (and above the top buttons, the corner's: the way back is the first of them, the account button the next)
    await expect(tv.getByTestId("tv-page-back")).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-account-chip")).toBeFocused();
  });

  test("Down from any of its top buttons lands on the place under that button, not always on the first (at a TV's 1920 and a laptop's 1366)", async ({ browser }) => {
    // (The judge, 16 Nov: from Settings or Feedback, on the right, Down went to My ratings at the far left, with History right under them.)
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
          const far = (one: Element) => Math.max(one.getBoundingClientRect().left - middle, 0, middle - one.getBoundingClientRect().right); // (0: right under it)
          const nearest = [...document.querySelectorAll('[data-entry^="profile:"]')].sort((a, b) => far(a) - far(b))[0]!;
          return { focused: document.activeElement?.getAttribute("data-entry"), nearest: nearest.getAttribute("data-entry") };
        }, id);
        expect(landed.focused, `${id} at ${viewport.width}`).toBe(landed.nearest);
        reached.add(landed.focused!);
      }
      expect([...reached].sort(), `at ${viewport.width}`).toEqual(["profile:history", "profile:ratings"]); // (the buttons on the right lead to the place on the right)
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

    await tv.keyboard.press("ArrowLeft"); // (the button before it is the way to sign in)
    await expect(tv.getByTestId("tv-profile-signin")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-signin-email")).toBeVisible(); // a guest signs in from here
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "profile");
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
    expect(await places(tv)).toEqual(["profile:ratings", "profile:history"]);
    await expect(tv.getByTestId("tv-profile-settings")).toBeFocused(); // (the button it left from)
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
        // (A profile with nothing yet: its places then say what they are for, the longest words they have, two lines.)
        const tv = await openDevice(browser, { viewport: { width: screen.width, height: screen.height }, locale: language.locale }, guestStorage({}), withLibrary(library));
        await tv.goto("/tv");
        await expect(tv.getByTestId("tv-browse")).toBeVisible();
        // The menu's lines are all on the screen without scrolling it (a click on a line below the edge scrolls the menu to it, which would hide the fault).
        const room = await tv.getByTestId("tv-rail").evaluate((rail) => ({ needed: rail.scrollHeight, given: rail.clientHeight }));
        expect(room.needed).toBeLessThanOrEqual(room.given);
        await tv.getByTestId("tv-account-chip").click();
        await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "profile");
        await expect(tv.getByTestId("tv-category-tile")).toHaveCount(2);

        // Every word of a tile is inside it (a name or a note that does not fit is cut, and what is cut is not read), the bottom of its letters too: a card of a
        // fixed height squeezed its name under a note of two lines, and "My ratings" lost the foot of its g (the owner's report of 15 Nov).
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

        // The head: its buttons (Sign in, Settings, Feedback) are on the screen and do not lie over the corner's buttons.
        const corner = (await tv.getByTestId("tv-account-chip").boundingBox())!;
        for (const id of ["tv-profile-signin", "tv-profile-settings", "tv-profile-feedback"]) {
          await expect(tv.getByTestId(id)).toBeInViewport({ ratio: 1 });
          const box = (await tv.getByTestId(id).boundingBox())!;
          const apart = box.y >= corner.y + corner.height - 0.5 || box.y + box.height <= corner.y + 0.5 || box.x >= corner.x + corner.width - 0.5 || box.x + box.width <= corner.x + 0.5;
          expect(apart, `${id} is clear of the corner's button`).toBe(true);
        }

        // The menu lines are all on the screen too, the last of them with the rest.
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
    rated(film(4).url, film(4).title, 2, 2), // (a score for one season only: the title has no score of its own to show)
  ];
  const seed = guestStorage({ ratings: SCORES });
  const badge = (tv: Page, title: string) => tileOf(tv, title).getByTestId("score-badge");

  test("shows in the corner of its picture in the rows and the grids, and in a search; a title with none shows none", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library, (query) => [film(1), film(2), film(3), film(4)].filter((each) => each.title.toLowerCase().includes(query))), undefined, seed);
    await expect(tiles(tv).first()).toBeFocused();
    await expect(badge(tv, "Film number 1")).toHaveText("8");
    await expect(badge(tv, "Film number 3")).toHaveText("10");
    await expect(badge(tv, "Film number 2")).toHaveCount(0);
    await expect(badge(tv, "Film number 4")).toHaveCount(0); // (a season's score is on the title's page)
    await expect(badge(tv, "The Long Night")).toHaveText("7");
    await expect(tv.getByTestId("score-badge")).toHaveCount(3);
    await expect(badge(tv, "Film number 1")).toHaveAttribute("title", "Your rating: 8/10");

    // a category's grid, and a search
    await tv.getByTestId("rail-categories").click();
    await tv.getByTestId("tv-category-tile").first().click();
    await expect(tv.getByTestId("tv-view-title")).toHaveText("Classics");
    await expect(tv.getByTestId("score-badge")).toHaveText(["8", "10"]);
    await tv.getByTestId("rail-search").click();
    await tv.keyboard.type("film number");
    await expect(tv.getByTestId("tv-search-status")).toContainText("6 titles"); // (the six of the page; the library adds nothing it has not)
    await expect(tv.getByTestId("score-badge")).toHaveText(["8", "10"]);
  });

  test("is not covered by the round button a mouse gets in the opposite corner", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    const tile = tileOf(tv, "Film number 1");
    const score = (await tile.getByTestId("score-badge").boundingBox())!;
    const corner = (await tile.getByTestId("tv-tile-corner").boundingBox())!;
    const art = (await tile.locator(".tv-tile-art").boundingBox())!;
    expect(score.x + score.width).toBeLessThan(corner.x); // side by side, not over each other
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
    // (the owner: "In ratings, add a simple filter around rating (filters for stuff rated a specific number plus series/anime/movie/cartoon filter)")
    const toon = { id: "t1", title: "Toon Town", year: 2001, kind: "movie", section: "cartoon", url: "https://toons.example/watch/1" };
    const withToons = { ...library, rows: [...library.rows, { id: "r3", title: "Cartoons", source: "Test Source", kind: "movie", section: "cartoon", items: [toon] }] };
    const ratings = [rated(film(1).url, film(1).title, 8), rated(film(2).url, film(2).title, 9), rated(toon.url, toon.title, 9), { ...rated(show.url, show.title, 8), kind: "series" }];
    const tv = await openLibrary(browser, withLibrary(withToons), undefined, guestStorage({ ratings }));
    await openProfilePlace(tv, "ratings");
    await expect(tiles(tv)).toHaveCount(4);
    // (the cartoon was rated with no word of it: the library lists its link as a cartoon's)
    await expect(tv.locator('[data-testid^="rating-filter-"]')).toHaveText(["All4", "Movies2", "Series1", "Cartoons1"]);
    await expect(tv.locator('[data-testid^="rating-score-"]')).toHaveText(["Any score4", "92", "82"]);

    // The remote: up from the titles to the scores, up again to the kinds; a kind is chosen and the remote stays on it.
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
    await expect(tv.locator('[data-testid^="rating-score-"]')).toHaveCount(0); // (one score among the cartoons: nothing to choose)
    await tv.keyboard.press("ArrowDown");
    await expect(tileOf(tv, "Toon Town")).toBeFocused();

    // A mouse: a score, then a kind as well; the line under the title counts what is shown.
    await tv.getByTestId("rating-filter-all").click();
    await tv.getByTestId("rating-score-9").click();
    await expect(tiles(tv)).toHaveCount(2);
    await expect(tv.locator(".tv-view-meta").first()).toHaveText("2 ratings · average 9");
    await tv.getByTestId("rating-filter-movie").click();
    await expect(tiles(tv)).toHaveCount(1);
    await expect(tileOf(tv, "Film number 2")).toBeVisible();

    // A title opened from there and left: the same filter.
    await tileOf(tv, "Film number 2").focus();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-detail")).toBeVisible();
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
    await expect(tv.getByTestId("rating-filter-movie")).toHaveAttribute("aria-checked", "true");
    await expect(tv.getByTestId("rating-score-9")).toHaveAttribute("aria-checked", "true");
    await expect(tiles(tv)).toHaveCount(1);
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
    await tv.getByTestId("rate-score-9").click(); // (one press: rated, and back on the title's page)
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
