import { expect, type Locator, type Page } from "@playwright/test";
import { clickAsAHand, guestStorage, openDevice, openLibrary, openProfileByRemote, openProfilePage, openProfilePlace, PHONE, pressProfilePlace, test, withLibrary } from "./helpers";

/**
 * A title that was clicked with a mouse, or tapped with a finger, is where the remote stands: its page closed again (by a mouse or a finger too)
 * leaves the ring on it, and the arrow keys go on from there, not from the title the remote was on before. And the pages of the profile (what it
 * rated, its History, and the profile's page itself) have a Back button in the corner, for the pointer that has no key for it.
 */

const film = (id: string, title: string) => ({ id, title, year: 2000, kind: "movie", url: `/fixtures/sample.mp4?n=${id}` });
const library = {
  updatedAt: Date.now(),
  rows: [
    { id: "top", title: "Top", source: "Test Source", kind: "movie", items: Array.from({ length: 12 }, (_, index) => film(`t${index}`, `Top film ${index + 1}`)) },
    { id: "long", title: "A long row", source: "Test Source", kind: "movie", items: Array.from({ length: 18 }, (_, index) => film(`l${index}`, `Long film ${index + 1}`)) },
    { id: "third", title: "Third", source: "Test Source", kind: "movie", items: Array.from({ length: 6 }, (_, index) => film(`h${index}`, `Third film ${index + 1}`)) },
  ],
};

const tileOf = (tv: Page, title: string) => tv.locator(`.tv-tile[title="${title}"]`);
/** The ring a title wears while the remote is on it (the picture's shadow: a white ring and a lift), which no other title has. */
const hasRing = (tile: Locator) => expect(tile.locator(".tv-tile-art")).toHaveCSS("box-shadow", /rgb\(255, 255, 255\)/);
const hasNoRing = (tile: Locator) => expect(tile.locator(".tv-tile-art")).toHaveCSS("box-shadow", "none");

test.describe("a title opened with a pointer is where the remote stands when its page closes", () => {
  test("a mouse click on a title of a lower row, then the page's Close button: the remote is on the title that was clicked, with its ring, not on the one it was on before", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
    for (let i = 0; i < 4; i++) await tv.keyboard.press("ArrowRight");
    await expect(tileOf(tv, "Top film 5")).toBeFocused();
    await hasRing(tileOf(tv, "Top film 5"));

    await clickAsAHand(tv, tileOf(tv, "Long film 3"));
    await expect(tv.getByTestId("tv-detail")).toBeVisible();
    await tv.getByTestId("tv-detail-close").click(); // (a click: the button takes the focus, and the focus a mouse gives is not the kind that shows a ring)
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);

    await expect(tileOf(tv, "Long film 3")).toBeFocused();
    await hasRing(tileOf(tv, "Long film 3"));
    await expect(tv.getByTestId("tv-hero-title")).toHaveText("Long film 3");
    await hasNoRing(tileOf(tv, "Top film 5")); // (the ring is on one title only)

    await tv.keyboard.press("ArrowRight"); // the keys go on from the title that was clicked
    await expect(tileOf(tv, "Long film 4")).toBeFocused();
    await hasRing(tileOf(tv, "Long film 4"));
  });

  test("a tap on a small screen, then the page's Close button tapped: the same", async ({ browser }) => {
    const tv = await openDevice(browser, PHONE, {}, withLibrary(library));
    await tv.goto("/tv");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(tileOf(tv, "Top film 1")).toBeFocused();

    const target = tileOf(tv, "Long film 3");
    await target.scrollIntoViewIfNeeded();
    await target.tap();
    await expect(tv.getByTestId("tv-detail")).toBeVisible();
    await tv.getByTestId("tv-detail-close").tap();
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);

    await expect(target).toBeFocused();
    await hasRing(target);
    await expect(tv.getByTestId("tv-hero-title")).toHaveText("Long film 3");
    await hasNoRing(tileOf(tv, "Top film 1"));
  });

  test("a page opened with a click starts with the remote on its first title, ring and all, and a title of its grid clicked and closed keeps it", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await tv.getByTestId("rail-categories").click();
    await tv.getByTestId("tv-category-tile").nth(1).click(); // (the second: "A long row")
    await expect(tv.getByTestId("tv-category")).toBeVisible();
    await expect(tileOf(tv, "Long film 1")).toBeFocused();
    await hasRing(tileOf(tv, "Long film 1"));

    await clickAsAHand(tv, tileOf(tv, "Long film 5"));
    await expect(tv.getByTestId("tv-detail")).toBeVisible();
    await tv.getByTestId("tv-detail-close").click();
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
    await expect(tileOf(tv, "Long film 5")).toBeFocused();
    await hasRing(tileOf(tv, "Long film 5"));
    await hasNoRing(tileOf(tv, "Long film 1"));
  });
});

test.describe("the way back from the profile's pages", () => {
  const now = Date.now();
  const seed = guestStorage({
    progress: [{ key: "url:https://films.example/night-train", at: now - 60_000, title: "Night Train", url: "https://films.example/night-train", position: 1500, duration: 6000 }],
    ratings: [{ key: "rate:https://films.example/1", at: now - 2000, title: "Rated 1", url: "https://films.example/1", score: 8, ratedAt: now - 2000 }],
  });
  const view = (tv: Page) => tv.getByTestId("tv-browse");
  const back = (tv: Page) => tv.getByTestId("tv-page-back");
  const place = (tv: Page, name: "ratings" | "history") => tv.locator(`[data-entry="profile:${name}"]`);

  test("My ratings, History and the profile's page each have a Back button in the corner, a click on it goes one step out, and the remote is on the card it came from", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
    await expect(back(tv)).toHaveCount(0); // (Home is as far back as it goes)

    await openProfilePage(tv);
    await expect(back(tv)).toBeVisible();
    await expect(back(tv)).toHaveText("Back");
    await place(tv, "ratings").click();
    await expect(view(tv)).toHaveAttribute("data-view", "ratings");
    await expect(back(tv)).toBeVisible();
    await back(tv).click();
    await expect(view(tv)).toHaveAttribute("data-view", "profile");
    await expect(place(tv, "ratings")).toBeFocused();

    await place(tv, "history").click();
    await expect(view(tv)).toHaveAttribute("data-view", "history");
    await back(tv).click();
    await expect(view(tv)).toHaveAttribute("data-view", "profile");
    await expect(place(tv, "history")).toBeFocused();

    await back(tv).click(); // the profile's page goes back to Home, to the title the remote was on
    await expect(view(tv)).toHaveAttribute("data-view", "home");
    await expect(back(tv)).toHaveCount(0);
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
  });

  test("a page with nothing on it (no History yet) has its Back button too, and the remote reaches it with Up", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library));
    await openProfilePlace(tv, "history");
    await expect(tv.getByTestId("tv-view-empty")).toHaveText("Nothing watched yet.");
    await expect(back(tv)).toBeVisible();
    await tv.keyboard.press("ArrowUp"); // (nowhere to stand on this page: Up goes to the top, whose first button is Back)
    await expect(back(tv)).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(view(tv)).toHaveAttribute("data-view", "profile");
    await expect(place(tv, "history")).toBeFocused();
  });

  test("with the remote: Up from the titles lands on Back, Right goes along the corner and Left comes back, OK goes out one step, and the key Back still does the same", async ({ browser }) => {
    const tv = await openLibrary(browser, withLibrary(library), undefined, seed);
    await openProfileByRemote(tv);
    await pressProfilePlace(tv, "ratings");
    await expect(view(tv)).toHaveAttribute("data-view", "ratings");
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();

    await tv.keyboard.press("ArrowUp");
    await expect(back(tv)).toBeFocused();
    await expect(back(tv)).toHaveAttribute("data-col", "0");
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-account-chip")).toBeFocused();
    await tv.keyboard.press("ArrowLeft");
    await expect(back(tv)).toBeFocused();
    await tv.keyboard.press("ArrowDown"); // back down to the title
    await expect(tv.getByTestId("tv-browse-tile").first()).toBeFocused();
    await tv.keyboard.press("ArrowUp");
    await tv.keyboard.press("Enter");
    await expect(view(tv)).toHaveAttribute("data-view", "profile");
    await expect(place(tv, "ratings")).toBeFocused();

    await pressProfilePlace(tv, "history");
    await expect(view(tv)).toHaveAttribute("data-view", "history");
    await tv.keyboard.press("Escape"); // (the key does what the button does)
    await expect(view(tv)).toHaveAttribute("data-view", "profile");
    await expect(place(tv, "history")).toBeFocused();
  });
});
