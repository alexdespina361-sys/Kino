import { expect, type Page } from "@playwright/test";
import { ratingKey } from "../src/shared";
import { guestStorage, openDevice, openLibrary, openProfilePage, openProfilePlace, pressProfilePlace, test, withLibrary, type ProfilePlace } from "./helpers";

/**
 * The profile on the TV: one line of the menu (Profile) opens a page of the places that belong to whoever is watching (what they rated,
 * their friends, History, the settings), and what they rated shows as a score on the pictures of the titles. The friends' side of it
 * (a profile that is signed in and has them on) is in friends-tv.spec.ts, which has the accounts for it.
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

  test("is one row of places: for a guest what it rated, History, the way to sign in and the settings, each saying how it stands", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    await openProfilePage(tv);
    await expect(tv.getByTestId("rail-profile")).toHaveAttribute("aria-current", "page");
    expect(await places(tv)).toEqual(["profile:ratings", "profile:history", "profile:signin", "profile:settings"]);
    await expect(tv.locator(".tv-row-title")).toHaveText(["Guest"]);
    await expect(tv.getByTestId("tv-tile-corner")).toHaveCount(0); // (a place is no title to keep)

    // The remote is on the first place, and the banner speaks of the place it is on.
    await expect(place(tv, "ratings")).toBeFocused();
    await expect(tv.getByTestId("tv-hero-eyebrow")).toHaveText("Guest");
    await expect(tv.getByTestId("tv-hero-title")).toHaveText("My ratings");
    await expect(tv.getByTestId("tv-hero").locator(".tv-hero-meta")).toHaveText("2 ratings · average 7.5");
    await expect(place(tv, "ratings")).toContainText("2 ratings · average 7.5");
    await expect(place(tv, "history")).toContainText("1 title");
    await expect(place(tv, "signin")).toContainText("Keep your lists and ratings on every screen");
    await expect(place(tv, "settings")).toContainText("Account, language, subtitles and more");

    await tv.keyboard.press("ArrowRight");
    await expect(place(tv, "history")).toBeFocused();
    await expect(tv.getByTestId("tv-hero-title")).toHaveText("History");
    await tv.keyboard.press("ArrowLeft");
    await expect(place(tv, "ratings")).toBeFocused();
  });

  test("opens the settings and the way to sign in, and Back from either returns to it with the remote where it was", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    await openProfilePage(tv);
    await pressProfilePlace(tv, "settings");
    await expect(tv.getByTestId("tv-account")).toBeVisible();
    await tv.getByTestId("tv-account-back").click();
    await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "profile");
    await expect(place(tv, "settings")).toBeFocused();

    await tv.keyboard.press("ArrowLeft"); // (the place before it is the way to sign in)
    await expect(place(tv, "signin")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-signin-email")).toBeVisible(); // a guest signs in from here too, not only from the corner
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

  test("has no place for ratings once they are off in the settings, and the remote comes back to Settings, which has moved up a place (no sign-in once somebody has signed in: checked with the friends, in friends-tv)", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    await openProfilePlace(tv, "settings");
    await tv.getByTestId("tv-ratings-switch").click();
    await expect(tv.getByTestId("tv-ratings-switch")).toHaveAttribute("aria-checked", "false");
    await tv.getByTestId("tv-account-back").click();
    expect(await places(tv)).toEqual(["profile:history", "profile:signin", "profile:settings"]);
    await expect(place(tv, "settings")).toBeFocused(); // (the place it left from, not whatever is now in the column it was in)
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
      test(`its places and what they say fit their tiles, and the page fits the screen: ${language.name}, ${screen.name}`, async ({ browser }) => {
        const tv = await openDevice(browser, { viewport: { width: screen.width, height: screen.height }, locale: language.locale }, seed, withLibrary(library));
        await tv.goto("/tv");
        await expect(tv.getByTestId("tv-browse")).toBeVisible();
        // The menu's nine lines are all on the screen without scrolling it (a click on a line below the edge scrolls the menu to it, which would hide the fault).
        const room = await tv.getByTestId("tv-rail").evaluate((rail) => ({ needed: rail.scrollHeight, given: rail.clientHeight }));
        expect(room.needed).toBeLessThanOrEqual(room.given);
        await tv.getByTestId("rail-profile").click();
        await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "profile");
        await expect(tv.getByTestId("tv-category-tile")).toHaveCount(4);

        // Every word of a tile is inside it (a name or a note that does not fit is cut, and what is cut is not read).
        const cut = await tv.getByTestId("tv-category-tile").evaluateAll((all) =>
          all.flatMap((one) => {
            const tile = one.getBoundingClientRect();
            return [...one.querySelectorAll<HTMLElement>(".tv-category-name, .tv-category-count")]
              .filter((text) => {
                const at = text.getBoundingClientRect();
                const outside = at.top < tile.top - 0.5 || at.bottom > tile.bottom + 0.5 || at.left < tile.left - 0.5 || at.right > tile.right + 0.5;
                return outside || text.scrollWidth > text.clientWidth + 1;
              })
              .map((text) => `${one.getAttribute("data-entry")}: ${text.textContent}`);
          }),
        );
        expect(cut).toEqual([]);
        expect(await tv.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

        // The menu lines are all on the screen too, the last of them (Profile) with the rest.
        const last = (await tv.getByTestId("rail-profile").boundingBox())!;
        expect(last.y + last.height).toBeLessThanOrEqual(screen.height + 0.5);
        expect(last.y).toBeGreaterThanOrEqual(0);
      });
    }
  }
});

test.describe("the score a profile gave a title", () => {
  const seed = guestStorage({
    ratings: [
      rated(film(1).url, film(1).title, 8),
      rated(film(3).url, film(3).title, 10),
      rated(show.url, show.title, 7),
      rated(film(4).url, film(4).title, 2, 2), // (a score for one season only: the title has no score of its own to show)
    ],
  });
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

  test("is gone with ratings turned off, and back, with what was rated, once they are on", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    await expect(tv.getByTestId("score-badge")).toHaveCount(3);
    await openProfilePlace(tv, "settings");
    await tv.getByTestId("tv-ratings-switch").click();
    await expect(tv.getByTestId("tv-ratings-switch")).toHaveAttribute("aria-checked", "false");
    await tv.getByTestId("tv-account-back").click();
    await tv.getByTestId("rail-home").click();
    await expect(tiles(tv).first()).toBeVisible();
    await expect(tv.getByTestId("score-badge")).toHaveCount(0);

    await openProfilePlace(tv, "settings");
    await tv.getByTestId("tv-ratings-switch").click();
    await expect(tv.getByTestId("tv-ratings-switch")).toHaveAttribute("aria-checked", "true");
    await tv.getByTestId("tv-account-back").click();
    await tv.getByTestId("rail-home").click();
    await expect(tv.getByTestId("score-badge")).toHaveCount(3);
  });

  test("follows a score as it is given and taken back on a title's page", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library), undefined, guestStorage({}));
    await expect(tv.getByTestId("score-badge")).toHaveCount(0);
    await tileOf(tv, "Film number 2").click();
    await tv.getByTestId("tv-detail-rate").click();
    await tv.getByTestId("rate-score-9").click();
    await tv.getByTestId("rate-done").click();
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
