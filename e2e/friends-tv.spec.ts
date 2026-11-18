import { expect, type Browser, type Page } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { it as italian } from "../src/client/i18n/it";
import { ro } from "../src/client/i18n/ro";
import { listKey, ratingKey } from "../src/shared";
import { openLibrary, openProfilePage, openProfilePlace, openTvSignIn, pressProfilePlace, test, tvRoot, withLibrary, type ProfilePlace, showProfilePage, nameFirstProfile, PICTURE_NAMED } from "./helpers";

test.use({ actionTimeout: 15_000 });

let counter = 0;
const fresh = (name: string) => ({ email: `${name}${++counter}x${Date.now().toString(36).slice(-4)}`, password: "kino-test-pass-1" });
type Account = ReturnType<typeof fresh>;
const nameOf = (account: Account) => account.email.charAt(0).toUpperCase() + account.email.slice(1);

interface Screen {
  page: Page;
  name: string;
}

const HD = { width: 1280, height: 720 };

const WORDS = { en, ro, it: italian };
type Language = keyof typeof WORDS;

const films = (baseURL: string) => ({
  updatedAt: Date.now(),
  rows: [{ id: "r", title: "Classics", source: "Test Source", kind: "movie", items: [{ id: "a", title: "Alpha Film", year: 1931, kind: "movie", url: `${baseURL}/fixtures/sample.mp4?n=1` }] }],
});

async function signedInScreen(browser: Browser, name: string, options: { viewport?: { width: number; height: number }; library?: unknown; language?: Language; asMade?: boolean } = {}): Promise<Screen> {
  const account = fresh(name);
  const page = await openLibrary(browser, options.library ? withLibrary(options.library) : undefined, options.viewport ?? HD, options.language ? { "kino.lang": options.language } : {});
  await openTvSignIn(page);
  await page.getByTestId("tv-signin-email").click();
  await page.getByTestId("auth-switch").click();
  await expect(page.getByTestId("auth-form")).toHaveAttribute("data-mode", "signUp");
  await page.getByTestId("auth-email").fill(account.email);
  await page.getByTestId("auth-password").fill(account.password);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", PICTURE_NAMED);
  if (options.asMade) return { page, name: (await page.getByTestId("tv-account-chip").getAttribute("aria-label"))!.match(PICTURE_NAMED)![0] };
  await nameFirstProfile(page, nameOf(account));
  await expect(page.getByTestId("tv-account-chip")).toContainText(nameOf(account));
  await showProfilePage(page);
  return { page, name: nameOf(account) };
}

const place = (page: Page, where: Exclude<ProfilePlace, "signin" | "settings">) => page.locator(`[data-entry="profile:${where}"]`);

const settingsButton = (page: Page) => page.getByTestId("tv-profile-settings");

async function screenWithFriends(browser: Browser, name: string, options: Parameters<typeof signedInScreen>[2] = {}): Promise<Screen> {
  const screen = await signedInScreen(browser, name, options);
  await showProfilePage(screen.page);
  await expect(place(screen.page, "friends")).toBeVisible();
  return screen;
}

const look = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

const tile = (page: Page, title: string) => page.locator(`.tv-tile[title="${title}"]`);

const view = (page: Page) => page.getByTestId("tv-browse");

const say = (text: string, params: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? "");

async function openFriends(page: Page) {
  await openProfilePlace(page, "friends");
  await expect(view(page)).toHaveAttribute("data-view", "friends");
}

async function meet(giver: Screen, taker: Screen, add: string = WORDS.en["friends.add"]) {
  await openFriends(giver.page);
  await tile(giver.page, add).click();
  await giver.page.getByTestId("tv-friend-give").click();
  const code = (await giver.page.getByTestId("tv-friend-code").textContent())!.trim();
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);

  await openFriends(taker.page);
  await tile(taker.page, add).click();
  await taker.page.getByTestId("tv-friend-type").click();
  await taker.page.getByTestId("tv-friend-code-input").fill(code);
  await expect(taker.page.getByTestId("tv-friend-code-name")).toHaveText(giver.name);
  await taker.page.getByTestId("tv-friend-code-add").click();
  await expect(tile(taker.page, giver.name)).toBeVisible();

  await look(giver.page);
  await expect(tile(giver.page, taker.name)).toBeVisible();
  await expect(giver.page.getByTestId("tv-friend-give-page")).toHaveCount(0);
  return code;
}

async function tellsWhatItWatches(giver: Screen, taker: Screen, words: (typeof WORDS)[Language] = WORDS.en) {
  await tile(giver.page, words["friends.settingsTile"]).click();
  await giver.page.getByTestId("tv-friends-give").click();
  await giver.page.getByTestId("tv-friend-settings-done").click();
  await tile(taker.page, words["friends.settingsTile"]).click();
  await taker.page.getByTestId("tv-friends-give").click();
  await taker.page.getByTestId("tv-friend-settings-done").click();
  const profile = await taker.page.evaluate(() => localStorage.getItem("kino.profile"));
  await expect
    .poll(async () => {
      const state = (await (await taker.page.request.get(`/api/profiles/${profile}/friends`)).json()) as { friends: Array<{ activity?: boolean }> };
      return state.friends.some((friend) => friend.activity);
    })
    .toBe(true);
  await look(taker.page);
}

async function seed(page: Page, data: Record<string, unknown[]>) {
  const profile = await page.evaluate(() => localStorage.getItem("kino.profile"));
  const response = await page.request.post(`/api/profiles/${profile}/sync`, { data: { since: 0, ...data } });
  expect(response.ok()).toBe(true);
}

const choose = (page: Page, choices: Record<string, boolean>) => seed(page, { settings: Object.entries(choices).map(([key, value]) => ({ key, at: Date.now(), value })) });

async function hadTurnedOff(page: Page, ...keys: string[]) {
  await choose(page, Object.fromEntries(keys.map((key) => [key, false])));
  await page.reload();
}

async function proposes(from: Screen, to: Screen, when: number, note?: string) {
  const profile = (page: Page) => page.evaluate(() => localStorage.getItem("kino.profile"));
  const response = await from.page.request.post(`/api/profiles/${await profile(from.page)}/friends/send`, { data: { kind: "plan", when, ...(note ? { note } : {}), to: [await profile(to.page)] } });
  expect(response.ok()).toBe(true);
}

const FILM = "https://films.example/watch/17";
const filmCards = () => {
  const at = Date.now();
  return {
    list: [{ key: listKey(FILM), at, id: "f17", title: "Alpha Film", url: FILM, year: 1931 }],
    ratings: [{ key: ratingKey(FILM), at, title: "Alpha Film", url: FILM, year: 1931, kind: "movie", score: 8, note: "Tight and clever", ratedAt: at }],
  };
};

const outsideTheScreen = (page: Page, root: string, whole = true) =>
  page.evaluate(
    ([id, wholePage]) => {
      const lost: string[] = [];
      const base = document.querySelector(`[data-testid="${id}"]`);
      if (!base) return [`(nothing is shown as ${id})`];
      for (const element of base.querySelectorAll("button, input, h1, h2, p, svg")) {
        const box = element.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        const outside = box.left < -0.5 || box.right > innerWidth + 0.5 || (wholePage && (box.top < -0.5 || box.bottom > innerHeight + 0.5));
        if (outside) lost.push(element.getAttribute("data-testid") ?? `${element.tagName.toLowerCase()} "${(element.textContent ?? "").trim().slice(0, 30)}"`);
      }
      if (document.documentElement.scrollWidth > innerWidth) lost.push("(the page scrolls sideways)");
      return lost;
    },
    [root, whole] as const,
  );

test.describe("friends are on for everybody on the TV", () => {
  test("a screen that is signed out has no friends and no switch for them or for ratings; a signed-in one has Friends on its profile page at once, also when it had turned them off before", async ({ browser }) => {
    test.setTimeout(150_000);
    const guest = await openLibrary(browser, undefined, HD);
    await openProfilePlace(guest, "settings");
    await expect(guest.getByTestId("tv-account")).toBeVisible();
    await expect(guest.getByTestId("tv-ratings-switch")).toHaveCount(0);
    await expect(guest.getByTestId("tv-friends-switch")).toHaveCount(0);
    await guest.getByTestId("tv-account-back").click();
    await expect(view(guest)).toHaveAttribute("data-view", "profile");
    await expect(place(guest, "friends")).toHaveCount(0);
    await expect(guest.getByTestId("tv-profile-signin")).toHaveCount(1);

    const ann = await signedInScreen(browser, "Ann");
    await openProfilePage(ann.page);
    await expect(place(ann.page, "friends")).toHaveCount(1);
    await expect(ann.page.getByTestId("tv-profile-signin")).toHaveCount(0);
    await settingsButton(ann.page).click();
    await expect(ann.page.getByTestId("tv-account")).toBeVisible();
    await expect(ann.page.getByTestId("tv-friends-switch")).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-ratings-switch")).toHaveCount(0);
    await ann.page.getByTestId("tv-account-back").click();

    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    await choose(ann.page, { friends: false });
    await look(ann.page);
    await openFriends(ann.page);
    await expect(tile(ann.page, bob.name)).toBeVisible();
  });
});

test.describe("the profile's page, as what is on it changes under the remote", () => {
  const elsewhere = async (page: Page, friends: boolean) => {
    await seed(page, { settings: [{ key: "friendsOff", at: Date.now(), value: !friends }] });
    await look(page);
  };
  const places = (page: Page) => page.getByTestId("tv-category-tile").evaluateAll((all) => all.map((one) => one.getAttribute("data-entry")));
  const heard = (page: Page, key: string) =>
    page.evaluate((key) => {
      const profile = localStorage.getItem("kino.profile");
      const stored = JSON.parse(localStorage.getItem(`kino.data.${profile}`) ?? "{}") as { data?: { settings?: Array<{ key: string; value?: unknown }> } };
      return stored.data?.settings?.find((item) => item.key === key)?.value;
    }, key);

  test("the remote comes back from the settings to the Settings button, though a card has appeared below it in the meantime", async ({ browser }) => {
    const ann = await signedInScreen(browser, "Ann");
    await elsewhere(ann.page, false);
    await openProfilePage(ann.page);
    await expect.poll(() => places(ann.page)).toEqual(["profile:ratings", "profile:history", "profile:news"]);
    await pressProfilePlace(ann.page, "settings");
    await expect(ann.page.getByTestId("tv-account")).toBeVisible();

    await elsewhere(ann.page, true);
    await expect.poll(() => heard(ann.page, "friendsOff")).toBe(false);
    await ann.page.keyboard.press("Escape");
    await expect(view(ann.page)).toHaveAttribute("data-view", "profile");
    await expect.poll(() => places(ann.page)).toEqual(["profile:ratings", "profile:friends", "profile:history", "profile:news"]);
    await expect(settingsButton(ann.page)).toBeFocused();
  });

  test("the remote is not lost when the place it is on goes: it stands where that was, and OK answers", async ({ browser }) => {
    const ann = await screenWithFriends(browser, "Ann");
    await place(ann.page, "ratings").focus();
    await ann.page.keyboard.press("ArrowRight");
    await expect(place(ann.page, "friends")).toBeFocused();

    await elsewhere(ann.page, false);
    await expect(place(ann.page, "friends")).toHaveCount(0);
    await expect(place(ann.page, "history")).toBeFocused();
    await ann.page.keyboard.press("Enter");
    await expect(view(ann.page)).toHaveAttribute("data-view", "history");
  });

  test("a card says how its place stands now, not as it stood when the remote came to it", async ({ browser }) => {
    const ann = await signedInScreen(browser, "Ann", { asMade: true });
    await ann.page.getByTestId("rail-home").click();
    await openProfilePage(ann.page);
    await expect(ann.page.getByTestId("tv-profile-settings")).toBeFocused();
    await ann.page.keyboard.press("ArrowDown");
    for (let left = 0; left < 3 && (await ann.page.evaluate(() => document.activeElement?.getAttribute("data-entry"))) !== "profile:ratings"; left++) await ann.page.keyboard.press("ArrowLeft");
    await expect(place(ann.page, "ratings")).toBeFocused();
    await expect(place(ann.page, "ratings")).toContainText("The titles and seasons you gave a score.");

    await seed(ann.page, { ratings: filmCards().ratings });
    await look(ann.page);
    await expect(place(ann.page, "ratings")).toContainText("1 rating · average 8");
    await expect(place(ann.page, "ratings")).toBeFocused();
  });
});

test.describe("making friends on the TV", () => {
  test("a code one screen shows and another types makes them friends; the page that showed it closes by itself, and a code works once", async ({ browser }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    const cy = await screenWithFriends(browser, "Cy");

    await openFriends(ann.page);
    await expect(ann.page.locator(".tv-tile-category")).toHaveCount(2);
    await expect(tile(ann.page, "Friends settings")).toBeVisible();

    const code = await meet(ann, bob);
    await expect(ann.page.getByTestId("tv-account-toast")).toContainText(`You and ${bob.name} are now friends`);
    await expect(bob.page.getByTestId("tv-account-toast")).toContainText(`You and ${ann.name} are now friends`);
    await expect(ann.page.locator(".tv-tile-category")).toHaveCount(4);
    await expect(tile(ann.page, WORDS.en["friends.turnOn"])).toBeVisible();

    await openFriends(cy.page);
    await tile(cy.page, "Add a friend").click();
    await cy.page.getByTestId("tv-friend-type").click();
    await cy.page.getByTestId("tv-friend-code-input").fill(code.replace("-", "").toLowerCase());
    await expect(cy.page.getByTestId("tv-friend-code-error")).toBeVisible();
    await expect(cy.page.getByTestId("tv-friend-code-add")).toHaveCount(0);
  });

  test("the screen that made the code hears within seconds that it was used, unasked, and its bell names the new friend once", async ({ browser }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await openFriends(ann.page);
    await tile(ann.page, "Add a friend").click();
    await ann.page.getByTestId("tv-friend-give").click();
    const code = (await ann.page.getByTestId("tv-friend-code").textContent())!.trim();
    await openFriends(bob.page);
    await tile(bob.page, "Add a friend").click();
    await bob.page.getByTestId("tv-friend-type").click();
    await bob.page.getByTestId("tv-friend-code-input").fill(code);
    await bob.page.getByTestId("tv-friend-code-add").click();
    await expect(tile(bob.page, ann.name)).toBeVisible();

    await expect(ann.page.getByTestId("tv-friend-give-page")).toHaveCount(0, { timeout: 12_000 });
    await expect(ann.page.getByTestId("tv-account-toast")).toContainText(`You and ${bob.name} are now friends`);
    await expect(tile(ann.page, bob.name)).toBeVisible();
    await expect(ann.page.getByTestId("tv-bell-dot")).toBeVisible();
    await ann.page.getByTestId("tv-bell").click();
    await expect(ann.page.getByTestId("tv-bell-joined")).toContainText(bob.name);
    await expect(ann.page.getByTestId("tv-bell-joined")).toContainText(WORDS.en["bell.nowFriends"]);
    await expect(ann.page.getByTestId("tv-bell-empty")).toHaveCount(0);

    await bob.page.getByTestId("tv-bell").click();
    await expect(bob.page.getByTestId("tv-bell-page")).toBeVisible();
    await expect(bob.page.getByTestId("tv-bell-joined")).toHaveCount(0);

    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("tv-bell-dot")).toHaveCount(0);
    await ann.page.getByTestId("tv-bell").click();
    await expect(ann.page.getByTestId("tv-bell-page")).toBeVisible();
    await expect(ann.page.getByTestId("tv-bell-joined")).toHaveCount(0);
  });

  test("the other way round, the one that types needs no code of its own, and a code that is taken back is no use", async ({ browser }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");

    await openFriends(ann.page);
    await tile(ann.page, "Add a friend").click();
    await ann.page.getByTestId("tv-friend-give").click();
    const code = (await ann.page.getByTestId("tv-friend-code").textContent())!.trim();
    await ann.page.getByTestId("tv-friend-revoke").click();
    await expect(ann.page.getByTestId("tv-add-friend")).toBeVisible();

    await openFriends(bob.page);
    await tile(bob.page, "Add a friend").click();
    await bob.page.getByTestId("tv-friend-type").click();
    await bob.page.getByTestId("tv-friend-code-input").fill(code);
    await expect(bob.page.getByTestId("tv-friend-code-error")).toBeVisible();
    await bob.page.getByTestId("tv-friend-type-back").click();
    await bob.page.getByTestId("tv-friend-add-back").click();
    await expect(view(bob.page)).toHaveAttribute("data-view", "friends");
  });
});

test.describe("the code a screen shows to a friend can be copied", () => {
  async function showingACode(browser: Browser, name: string) {
    const screen = await screenWithFriends(browser, name);
    await openFriends(screen.page);
    await tile(screen.page, "Add a friend").click();
    await screen.page.getByTestId("tv-friend-give").click();
    await expect(screen.page.getByTestId("tv-friend-code")).toBeVisible();
    return screen;
  }

  test("a small button under it copies it: OK on it from the remote, or a click, and it says so", async ({ browser }) => {
    test.setTimeout(150_000);
    const ann = await showingACode(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    const page = ann.page;
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
    const code = (await page.getByTestId("tv-friend-code").textContent())!.trim();
    const copy = page.getByTestId("tv-friend-code-copy");

    await expect(copy).toHaveText("Copy code");
    await expect(page.getByTestId("tv-friend-give-done")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(copy).toBeFocused();
    await page.evaluate(() => navigator.clipboard.writeText("something else"));
    await page.keyboard.press("Enter");
    await expect(copy).toHaveText("Code copied");
    expect(await clipboard()).toBe(code);
    await expect(copy).toBeFocused();
    await expect(copy).toHaveText("Copy code");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("tv-friend-give-done")).toBeFocused();

    await page.evaluate(() => navigator.clipboard.writeText("something else"));
    await copy.click();
    await expect(copy).toHaveText("Code copied");
    expect(await clipboard()).toBe(code);

    await page.getByTestId("tv-friend-code").click();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(code);

    await openFriends(bob.page);
    await tile(bob.page, "Add a friend").click();
    await bob.page.getByTestId("tv-friend-type").click();
    await bob.page.getByTestId("tv-friend-code-input").fill(await clipboard());
    await expect(bob.page.getByTestId("tv-friend-code-name")).toHaveText(ann.name);
  });

  test("a browser that will not copy says so, and selects the code for the keys", async ({ browser }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann");
    const page = ann.page;
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      document.execCommand = () => false;
    });
    await page.reload();
    await openFriends(page);
    await tile(page, "Add a friend").click();
    await page.getByTestId("tv-friend-give").click();
    const code = (await page.getByTestId("tv-friend-code").textContent())!.trim();
    await page.getByTestId("tv-friend-code-copy").click();
    await expect(page.getByTestId("tv-friend-give-page").getByRole("status")).toHaveText("Could not copy: select the code and copy it");
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(code);
    expect(await outsideTheScreen(page, "tv-friend-give-page")).toEqual([]);
  });
});

test.describe("a friend's page", () => {
  test("has their lists, then their ratings, says when they are not shared, and Remove asks first, in a window of its own", async ({ browser }) => {
    test.setTimeout(180_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    await seed(ann.page, filmCards());

    await tile(bob.page, ann.name).click();
    await expect(view(bob.page)).toHaveAttribute("data-view", /^friend:/);
    await expect(bob.page.getByTestId("tv-view-title")).toHaveText(ann.name);
    await expect(bob.page.getByTestId("friend-tab-lists")).toHaveAttribute("aria-checked", "true");
    await expect(bob.page.getByTestId("tv-grid-heading")).toHaveText(en["list.favourites"]);
    await expect(tile(bob.page, "Alpha Film")).toBeVisible();
    await expect(tile(bob.page, "Alpha Film")).not.toContainText(en["list.favourites"]);
    await bob.page.getByTestId("friend-tab-ratings").click();
    await expect(tile(bob.page, "Alpha Film")).toContainText("8/10");

    await choose(ann.page, { friendsRatings: false });
    await expect(async () => {
      await look(bob.page);
      await expect(bob.page.getByTestId("tv-view-empty")).toContainText(`${ann.name} is not sharing their ratings`, { timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    await bob.page.getByTestId("friend-tab-lists").click();
    await expect(tile(bob.page, "Alpha Film")).toBeVisible();

    await bob.page.keyboard.press("Escape");
    await expect(view(bob.page)).toHaveAttribute("data-view", "friends");

    await tile(bob.page, ann.name).click();
    await bob.page.getByTestId("friend-remove").click();
    await expect(bob.page.getByTestId("tv-friend-unfriend")).toContainText(`Remove ${ann.name}?`);
    await bob.page.getByTestId("tv-friend-unfriend-cancel").click();
    await expect(tile(bob.page, "Alpha Film")).toBeVisible();
    await bob.page.getByTestId("friend-remove").click();
    await bob.page.getByTestId("tv-friend-unfriend-yes").click();
    await expect(view(bob.page)).toHaveAttribute("data-view", "friends");
    await expect(bob.page.getByTestId("tv-account-toast")).toContainText(`${ann.name} is no longer your friend`);
    await expect(tile(bob.page, ann.name)).toHaveCount(0);
    await look(ann.page);
    await expect(tile(ann.page, bob.name)).toHaveCount(0);
  });

  test("puts first what both keep in a list, as a section above their lists, and a title both rated says one's own score after theirs", async ({ browser }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    await seed(ann.page, filmCards());
    const at = Date.now();
    await seed(bob.page, { list: [{ key: listKey(FILM), at, id: "f17", title: "Alpha Film", url: FILM, year: 1931 }], ratings: [{ key: ratingKey(FILM), at, title: "Alpha Film", url: FILM, year: 1931, kind: "movie", score: 6, ratedAt: at }] });
    await bob.page.reload();

    const page = bob.page;
    await openFriends(page);
    await tile(page, ann.name).click();
    await expect(view(page)).toHaveAttribute("data-view", /^friend:/);
    await expect(page.getByTestId("tv-grid-heading")).toHaveText([en["friends.bothWant"], en["list.favourites"]]);
    await expect(tile(page, "Alpha Film")).toHaveCount(2);
    await page.getByTestId("friend-tab-ratings").click();
    await expect(tile(page, "Alpha Film")).toContainText(`8/10 · ${en["friends.yourScore"].replace("{score}", "6")}`);
  });

  test("shows each of their lists as a section of its own, one under the other under its name (a title in two lists in both), and the remote walks from one section to the next", async ({ browser }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    const BETA = "https://films.example/watch/18";
    const at = Date.now();
    await seed(ann.page, {
      listNames: [{ key: "lweekend", at, name: "Weekend" }],
      list: [
        ...filmCards().list,
        { key: listKey(BETA, "lweekend"), at, list: "lweekend", id: "f18", title: "Beta Film", url: BETA, year: 1940 },
        { key: listKey(FILM, "lweekend"), at, list: "lweekend", id: "f17", title: "Alpha Film", url: FILM, year: 1931 },
      ],
    });

    const page = bob.page;
    await tile(page, ann.name).click();
    await expect(view(page)).toHaveAttribute("data-view", /^friend:/);
    await expect(page.getByTestId("tv-grid-heading")).toHaveText([en["list.favourites"], "Weekend"]);
    await expect(tile(page, "Alpha Film")).toHaveCount(2);
    await expect(tile(page, "Beta Film")).toHaveCount(1);
    const order = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".tv-grid .tv-grid-heading, .tv-grid .tv-tile")].map((one) => (one.classList.contains("tv-grid-heading") ? `# ${one.textContent}` : `${one.title}@${one.dataset.row}`)),
    );
    expect(order.slice(0, 3)).toEqual([`# ${en["list.favourites"]}`, "Alpha Film@0", "# Weekend"]);
    expect(order.slice(3).sort()).toEqual(["Alpha Film@1", "Beta Film@1"]);
    const [first, second] = await page.getByTestId("tv-grid-heading").evaluateAll((all) => all.map((one) => one.getBoundingClientRect().top));
    const top = (title: string, which: "first" | "last") => tile(page, title)[which]().evaluate((one) => one.getBoundingClientRect().top);
    expect(first!).toBeLessThan(await top("Alpha Film", "first"));
    expect(await top("Alpha Film", "first")).toBeLessThan(second!);
    expect(second!).toBeLessThan(await top("Beta Film", "first"));

    await tile(page, "Alpha Film").first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".tv-tile:focus")).toHaveAttribute("data-row", "1");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("friend-remove")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(page.locator(".tv-tile:focus")).toHaveAttribute("data-row", "1");
    await page.keyboard.press("ArrowUp");
    await expect(tile(page, "Alpha Film").first()).toBeFocused();
  });

  test("a friend's tile has their picture with a green dot while they are online, and their page has a Back button and, when they tell what they watch, how far they got on their titles", async ({ browser }) => {
    test.setTimeout(180_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    await seed(ann.page, { ...filmCards(), progress: [{ key: "alpha", at: Date.now(), title: "Alpha Film", url: FILM, year: 1931, position: 600, duration: 5400 }] });
    await tile(ann.page, "Friends settings").click();
    await ann.page.getByTestId("tv-friends-give").click();
    await ann.page.getByTestId("tv-friend-settings-done").click();
    await tile(bob.page, "Friends settings").click();
    await bob.page.getByTestId("tv-friends-give").click();
    await bob.page.getByTestId("tv-friend-settings-done").click();

    const her = tile(bob.page, ann.name);
    await expect(async () => {
      await look(ann.page);
      await look(bob.page);
      await expect(her.locator(".tv-person-pic")).toHaveAttribute("data-online", "true", { timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    await expect(her.locator(".avatar")).toBeVisible();

    await her.click();
    await expect(tile(bob.page, "Alpha Film")).toContainText("11%");
    await expect(tile(bob.page, "Alpha Film").locator(".tv-tile-progress i")).toHaveAttribute("style", /width: 11%/);
    await bob.page.getByTestId("friend-tab-ratings").click();
    await expect(tile(bob.page, "Alpha Film")).toContainText("11%");

    await tile(ann.page, "Friends settings").click();
    await ann.page.getByTestId("tv-friends-give").click();
    await ann.page.getByTestId("tv-friend-settings-done").click();
    await expect(async () => {
      await look(bob.page);
      await expect(tile(bob.page, "Alpha Film")).not.toContainText("11%", { timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    await expect(tile(bob.page, "Alpha Film").locator(".tv-tile-progress")).toHaveCount(0);
    await expect(tile(bob.page, "Alpha Film")).toContainText("8/10");

    await bob.page.getByTestId("tv-friend-back").click();
    await expect(view(bob.page)).toHaveAttribute("data-view", "friends");
  });

  test("the window that asks about removing a friend closes by itself when the friend is gone already", async ({ browser }) => {
    test.setTimeout(180_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    await seed(ann.page, filmCards());
    await tile(bob.page, ann.name).click();
    await bob.page.getByTestId("friend-remove").click();
    await expect(bob.page.getByTestId("tv-friend-unfriend")).toBeVisible();

    await tile(ann.page, bob.name).click();
    await ann.page.getByTestId("friend-remove").click();
    await ann.page.getByTestId("tv-friend-unfriend-yes").click();
    await expect(async () => {
      await look(bob.page);
      await expect(bob.page.getByTestId("tv-friend-unfriend")).toHaveCount(0, { timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    await expect(view(bob.page)).toHaveAttribute("data-view", "friends");
    await expect(tile(bob.page, ann.name)).toHaveCount(0);
  });

  test("a friend who turned friends off shows nothing, and says so", async ({ browser }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    await seed(ann.page, filmCards());

    await choose(ann.page, { friendsOff: true });
    await expect(async () => {
      await look(bob.page);
      await expect(tile(bob.page, ann.name)).toContainText("Friends turned off", { timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    await tile(bob.page, ann.name).click();
    await expect(bob.page.getByTestId("tv-view-empty")).toContainText(`${ann.name} has turned friends off`);
    await expect(tile(bob.page, "Alpha Film")).toHaveCount(0);
  });

  test("with the switches as they come, the page of friends says what friends watch is off and a tile turns it on; a friend's page says why nothing of it is shown and can still be asked to watch together; with the switch on it says the friend is the one who does not tell", async ({ browser }) => {
    test.setTimeout(180_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    const hint = ann.page.getByTestId("tv-view-hint");

    const turnOn = tile(ann.page, en["friends.turnOn"]);
    await expect(turnOn).toBeVisible();
    await expect(turnOn).toContainText(en["friends.switchGive"]);
    await expect(tile(ann.page, bob.name)).toBeVisible();

    await tile(ann.page, bob.name).click();
    await expect(hint).toContainText(`To see what ${bob.name} is watching, turn on “${en["friends.switchGive"]}” in the Friends settings.`);
    await ann.page.getByTestId("friend-together").click();
    await expect(ann.page.getByTestId("tv-account-toast")).toContainText(`Asked ${bob.name} to watch together`);
    await look(bob.page);
    await expect(tile(bob.page, `${ann.name} wants to watch together`)).toBeVisible();

    await ann.page.getByTestId("tv-friend-back").click();
    await turnOn.click();
    await ann.page.getByTestId("tv-friends-give").click();
    await expect(ann.page.getByTestId("tv-friends-give")).toHaveAttribute("aria-checked", "true");
    await ann.page.getByTestId("tv-friend-settings-done").click();
    await expect(turnOn).toHaveCount(0);
    await tile(ann.page, bob.name).click();
    await expect(hint).toHaveText(`${bob.name} isn't sharing what they watch.`);

    await tile(bob.page, en["friends.settingsTile"]).click();
    await bob.page.getByTestId("tv-friends-give").click();
    await bob.page.getByTestId("tv-friend-settings-done").click();
    await expect(async () => {
      await look(ann.page);
      await expect(hint).toHaveCount(0, { timeout: 1500 });
    }).toPass({ timeout: 20_000 });
  });
});

test.describe("what is shared", () => {
  const kept = async (page: Page) => {
    const profile = await page.evaluate(() => localStorage.getItem("kino.profile"));
    const answer = (await (await page.request.post(`/api/profiles/${profile}/sync`, { data: { since: 0 } })).json()) as { settings: Array<{ key: string; value?: unknown }> };
    return Object.fromEntries(answer.settings.map((item) => [item.key, item.value]));
  };

  test("the one thing to choose is whether what is watched is shared (off to begin with), with what a chat is kept as said under it; the switches that are on for everybody are not there; the choice reaches the server", async ({ browser }) => {
    test.setTimeout(120_000);
    const ann = await screenWithFriends(browser, "Ann");
    await openFriends(ann.page);
    await tile(ann.page, "Friends settings").click();
    const give = ann.page.getByTestId("tv-friends-give");
    await expect(give).toHaveAttribute("aria-checked", "false");
    await expect(give).toContainText(en["friends.switchGive"]);
    await expect(ann.page.getByTestId("tv-friends-give-hint")).toHaveText(en["friends.switchGiveHint"]);
    await expect(ann.page.getByTestId("tv-friends-messages-hint")).toContainText("without encryption");
    for (const gone of ["lists", "ratings", "get", "inbox", "presence", "messages", "popups"]) await expect(ann.page.getByTestId(`tv-friends-${gone}`), gone).toHaveCount(0);
    await give.click();
    await expect(give).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => kept(ann.page)).toMatchObject({ friendsGive: true });

    await ann.page.keyboard.press("Escape");
    await expect(tile(ann.page, "Friends settings")).toBeFocused();
  });

  test("a profile that had turned some of the others off keeps the switches for those, and only those; one turned back on stays under the remote until the page is left", async ({ browser }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann");
    await hadTurnedOff(ann.page, "friendsLists", "friendsPresence", "newsPopups");
    await openFriends(ann.page);
    await tile(ann.page, "Friends settings").click();
    const lists = ann.page.getByTestId("tv-friends-lists");
    for (const id of ["tv-friends-lists", "tv-friends-presence", "tv-friends-popups"]) await expect(ann.page.getByTestId(id), id).toHaveAttribute("aria-checked", "false");
    for (const gone of ["ratings", "inbox", "messages", "get"]) await expect(ann.page.getByTestId(`tv-friends-${gone}`), gone).toHaveCount(0);

    await lists.click();
    await expect(lists).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => kept(ann.page)).toMatchObject({ friendsLists: true, friendsPresence: false });

    await ann.page.keyboard.press("Escape");
    await tile(ann.page, "Friends settings").click();
    await expect(ann.page.getByTestId("tv-friends-lists")).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-friends-presence")).toHaveAttribute("aria-checked", "false");
  });

  test("a profile that had turned ratings off is shown the switch that shares them with friends, off; turned on, it says ratings are on again too", async ({ browser }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann");
    await hadTurnedOff(ann.page, "ratings");
    await openFriends(ann.page);
    await tile(ann.page, "Friends settings").click();
    await expect(ann.page.getByTestId("tv-friends-give")).toBeVisible();
    const share = ann.page.getByTestId("tv-friends-ratings");
    await expect(share).toHaveAttribute("aria-checked", "false");
    await share.click();
    await expect(share).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => kept(ann.page)).toMatchObject({ friendsRatings: true, ratings: true });
  });
});

test.describe("sending things to friends from the TV", () => {
  test("a title is sent from its own page, arrives on the other screen as a card in a row of its own and a number on the menu, and is dismissed with its button", async ({ browser, baseURL }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann", { library: films(baseURL!) });
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);

    await ann.page.getByTestId("rail-home").click();
    await tile(ann.page, "Alpha Film").click();
    await ann.page.getByTestId("tv-detail-recommend").click();
    await expect(ann.page.getByTestId("tv-friend-pick")).toHaveCount(1);
    await expect(ann.page.getByTestId("tv-friend-pick")).toHaveAttribute("aria-pressed", "true");
    await ann.page.getByTestId("tv-friend-send").click();
    await expect(ann.page.getByTestId("tv-account-toast")).toContainText(`Sent to ${bob.name}`);
    await expect(ann.page.getByTestId("tv-friend-picker")).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-detail")).toBeVisible();

    await bob.page.getByTestId("rail-home").click();
    await look(bob.page);
    await expect(bob.page.getByTestId("tv-account-toast")).toContainText(`${ann.name} sent you Alpha Film`);
    await expect(bob.page.getByTestId("tv-bell-badge")).toHaveText("1");
    await openProfilePage(bob.page);
    await expect(place(bob.page, "friends")).toContainText("1 unread");
    await openFriends(bob.page);
    const sent = bob.page.locator(`.tv-row[aria-label="From your friends"]`);
    await expect(sent.locator(".tv-tile")).toHaveCount(1);
    await expect(sent.locator(".tv-tile").first()).toContainText(`From ${ann.name}`);
    await expect(bob.page.getByTestId("tv-bell-badge")).toHaveCount(0);

    await sent.locator(".tv-tile").first().focus();
    await expect(bob.page.getByTestId("tv-hero-title")).toHaveText("Alpha Film");
    await expect(bob.page.getByTestId("tv-hero-play")).toBeHidden();
    await sent.locator(".tv-tile").first().click();
    await expect(bob.page.getByTestId("tv-detail-play")).toBeVisible();
    await bob.page.getByTestId("tv-detail-dismiss").click();
    await expect(sent.locator(".tv-tile")).toHaveCount(0);
  });

  test("a screen that hosts a party invites its friends; a friend's screen joins it from the invitation", async ({ browser }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);

    await ann.page.getByTestId("rail-party").click();
    await ann.page.getByTestId("tv-party-start").click();
    await expect(ann.page.getByTestId("tv-party-code")).toBeVisible();
    await ann.page.getByTestId("tv-party-invite-friends").click();
    await expect(ann.page.getByTestId("tv-friend-pick")).toHaveAttribute("aria-pressed", "true");
    await ann.page.getByTestId("tv-friend-send").click();
    await expect(ann.page.getByTestId("tv-account-toast")).toContainText(`Invited ${bob.name}`);
    await expect(ann.page.getByTestId("tv-party")).toBeVisible();

    await look(bob.page);
    const invitation = tile(bob.page, `${ann.name}'s party`);
    await expect(invitation).toBeVisible();
    await expect(bob.page.locator(`.tv-row[aria-label="Watch parties"]`)).toBeVisible();
    await expect(bob.page.getByTestId("tv-row-group")).toHaveCount(1);
    await expect(bob.page.getByTestId("tv-row-group")).toHaveText("Waiting for you");
    await expect(bob.page.locator(`.tv-row[aria-label="Watch parties"] .tv-row-group`)).toBeVisible();
    await expect(bob.page.locator(`.tv-row[aria-label="Watch parties"]`)).toHaveAttribute("data-grouped", "true");
    await expect(bob.page.locator(`.tv-row[aria-label="Your friends"]`)).not.toHaveAttribute("data-grouped", "true");
    await invitation.click();
    await expect(bob.page.getByTestId("tv-party-guest")).toBeVisible();
    await expect(ann.page.getByTestId("tv-party-member")).toHaveCount(2);

    await bob.page.getByTestId("tv-disconnect").click();
    await expect(bob.page.getByTestId("tv-party-start")).toBeVisible();
    await expect(ann.page.getByTestId("tv-party-member")).toHaveCount(1);
    await bob.page.getByTestId("tv-party-join").click();
    await expect(bob.page.getByTestId("tv-party-digits")).toBeVisible();
    await expect(bob.page.getByTestId("tv-party-digits").locator('[data-filled="true"]')).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-party-member")).toHaveCount(1);
  });

  test("an invitation to a party that has ended is a question: ask to watch together; the friend asked starts a party, and the one who asked is invited to it", async ({ browser }) => {
    test.setTimeout(180_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    await tellsWhatItWatches(ann, bob);

    await ann.page.getByTestId("rail-party").click();
    await ann.page.getByTestId("tv-party-start").click();
    await ann.page.getByTestId("tv-party-invite-friends").click();
    await ann.page.getByTestId("tv-friend-send").click();
    await expect(ann.page.getByTestId("tv-account-toast")).toContainText(`Invited ${bob.name}`);
    await look(bob.page);
    const card = tile(bob.page, `${ann.name}'s party`);
    await expect(card).toBeVisible();
    await expect(card).not.toContainText("That party has ended");

    await ann.page.getByTestId("tv-party-end").click();
    await expect(ann.page.getByTestId("tv-party-start")).toBeVisible();
    await card.click();
    await expect(bob.page.getByTestId("tv-flash")).toHaveText("That party is not open any more.");
    await expect(view(bob.page)).toHaveAttribute("data-view", "friends");
    await expect(card).toContainText("That party has ended");
    await card.click();
    await expect(bob.page.getByTestId("tv-account-toast")).toContainText(`Asked ${ann.name} to watch together`);
    await expect(card).toHaveCount(0);

    await ann.page.getByTestId("tv-back-to-library").click();
    await expect(view(ann.page)).toHaveAttribute("data-view", "friends");
    await look(ann.page);
    const asked = tile(ann.page, `${bob.name} wants to watch together`);
    await expect(asked).toBeVisible();
    await asked.click();
    await expect(ann.page.getByTestId("tv-party-code")).toBeVisible();
    await expect(ann.page.getByTestId("tv-account-toast")).toContainText(`Invited ${bob.name}`);

    await look(bob.page);
    await expect(card).toBeVisible();
    await expect(card).not.toContainText("That party has ended");
    await card.click();
    await expect(bob.page.getByTestId("tv-party-guest")).toBeVisible();
    await expect(ann.page.getByTestId("tv-party-member")).toHaveCount(2);
  });

  test("a friend who does not take invitations is not asked: the ended party's card is gone, not a question", async ({ browser }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    await choose(ann.page, { friendsInbox: false });

    await ann.page.getByTestId("rail-party").click();
    await ann.page.getByTestId("tv-party-start").click();
    await ann.page.getByTestId("tv-party-invite-friends").click();
    await ann.page.getByTestId("tv-friend-send").click();
    await expect(ann.page.getByTestId("tv-account-toast")).toContainText(`Invited ${bob.name}`);
    await look(bob.page);
    await expect(tile(bob.page, `${ann.name}'s party`)).toBeVisible();

    await ann.page.getByTestId("tv-party-end").click();
    await expect(ann.page.getByTestId("tv-party-start")).toBeVisible();
    await expect(async () => {
      await look(bob.page);
      await expect(tile(bob.page, `${ann.name}'s party`)).toHaveCount(0, { timeout: 1500 });
    }).toPass({ timeout: 20_000 });
  });

  async function panelOverFilm(screen: Screen) {
    const page = screen.page;
    await page.getByTestId("rail-home").click();
    await tile(page, "Alpha Film").click();
    await page.getByTestId("tv-detail-play").click();
    await expect(tvRoot(page)).toHaveAttribute("data-state", "playing");
    await page.mouse.move(60, 60);
    await page.getByTestId("tv-party-btn").click();
    await expect(page.getByTestId("tv-party-panel")).toBeVisible();
  }

  test("the panel over a film has Invite friends too: it opens a page of the friends in the panel, Back goes to the panel, and a friend's screen joins from the invitation", async ({ browser, baseURL }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann", { library: films(baseURL!) });
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    const page = ann.page;
    const panel = page.getByTestId("tv-party-panel");
    const invite = page.getByTestId("tv-party-invite-friends");

    await panelOverFilm(ann);
    await expect(invite).toHaveCount(0);
    await page.getByTestId("tv-party-start").click();
    await expect(page.getByTestId("tv-party-code")).toBeVisible();
    await expect(page.getByTestId("tv-party-done")).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(invite).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tv-friend-picker")).toBeVisible();
    await expect(panel.locator("h2")).toHaveText("Invite friends");
    await expect(page.getByTestId("tv-party-code")).toHaveCount(0);
    await expect(page.getByTestId("tv-friend-pick")).toBeFocused();
    await expect(page.getByTestId("tv-friend-pick")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tv-friend-picker")).toHaveCount(0);
    await expect(panel.locator("h2")).toHaveText("Watch party");
    await expect(invite).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);

    await page.mouse.move(80, 80);
    await page.getByTestId("tv-party-btn").click();
    await invite.click();
    await page.getByTestId("tv-friend-send").click();
    await expect(page.getByTestId("tv-account-toast")).toContainText(`Invited ${bob.name}`);
    await expect(page.getByTestId("tv-friend-picker")).toHaveCount(0);
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("tv-party-code")).toBeVisible();
    await expect(invite).toBeFocused();

    await look(bob.page);
    const invitation = tile(bob.page, `${ann.name}'s party`);
    await expect(invitation).toBeVisible();
    await invitation.click();
    await expect(tvRoot(bob.page)).toHaveAttribute("data-state", /playing|paused/, { timeout: 15_000 });
    await expect(bob.page.getByTestId("tv-follow-bar")).toBeVisible();
    await expect(page.getByTestId("tv-party-member")).toHaveCount(2);
  });

  test("with several friends none is picked yet: Send does nothing until one is, and only the ones picked are told", async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const ann = await screenWithFriends(browser, "Ann", { library: films(baseURL!) });
    const bob = await screenWithFriends(browser, "Bob");
    const cy = await screenWithFriends(browser, "Cy");
    await meet(ann, bob);
    await meet(ann, cy);
    const page = ann.page;

    await panelOverFilm(ann);
    await page.getByTestId("tv-party-start").click();
    await expect(page.getByTestId("tv-party-code")).toBeVisible();
    await page.getByTestId("tv-party-invite-friends").click();
    const picks = page.getByTestId("tv-friend-pick");
    const send = page.getByTestId("tv-friend-send");
    await expect(picks).toHaveCount(2);
    await expect(picks.first()).toBeFocused();
    await expect(page.locator('[data-testid="tv-friend-pick"][aria-pressed="true"]')).toHaveCount(0);
    await expect(send).toHaveAttribute("aria-disabled", "true");
    expect(await outsideTheScreen(page, "tv-party-panel")).toEqual([]);

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(send).toBeFocused();
    const askedServer = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/friends/send"), { timeout: 1500 }).then(
      () => true,
      () => false,
    );
    await page.keyboard.press("Enter");
    expect(await askedServer).toBe(false);
    await expect(page.getByTestId("tv-friend-picker")).toBeVisible();
    await expect(page.getByTestId("tv-account-toast")).toHaveCount(0);
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("tv-friend-cancel")).toBeFocused();
    await page.keyboard.press("ArrowUp");

    const cyPick = picks.filter({ hasText: cy.name });
    await cyPick.click();
    await expect(cyPick).toHaveAttribute("aria-pressed", "true");
    await expect(send).toHaveAttribute("aria-disabled", "false");
    await cyPick.click();
    await expect(send).toHaveAttribute("aria-disabled", "true");
    await cyPick.click();
    await send.click();
    await expect(page.getByTestId("tv-account-toast")).toContainText(`Invited ${cy.name}`);
    await look(cy.page);
    await expect(tile(cy.page, `${ann.name}'s party`)).toBeVisible();
    await look(bob.page);
    await expect(tile(bob.page, `${ann.name}'s party`)).toHaveCount(0);
  });

  test("a friend who is not taking things is not offered, and the page says why", async ({ browser, baseURL }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann", { library: films(baseURL!) });
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);

    await choose(bob.page, { friendsInbox: false });

    await ann.page.getByTestId("rail-home").click();
    await tile(ann.page, "Alpha Film").click();
    await expect(async () => {
      await look(ann.page);
      await ann.page.getByTestId("tv-detail-recommend").click();
      await expect(ann.page.getByTestId("tv-friend-picker-none")).toContainText("None of your friends is taking titles", { timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    await expect(ann.page.getByTestId("tv-friend-pick")).toHaveCount(0);
  });
});

test.describe("friends' news while something plays", () => {
  async function looks(page: Page) {
    const answer = page.waitForResponse((response) => response.request().method() === "GET" && /\/api\/profiles\/[^/]+\/friends$/.test(response.url()));
    await look(page);
    await answer;
    await page.waitForTimeout(400);
  }

  async function playsTheFilm(screen: Screen) {
    await screen.page.getByTestId("rail-home").click();
    await tile(screen.page, "Alpha Film").click();
    await screen.page.getByTestId("tv-detail-play").click();
    await expect(tvRoot(screen.page)).toHaveAttribute("data-state", "playing");
  }

  async function stops(screen: Screen) {
    await screen.page.mouse.move(60, 60);
    await screen.page.getByTestId("tv-stop-btn").click();
    await expect(view(screen.page)).toBeVisible();
  }

  async function sendsTheTitle(screen: Screen) {
    await screen.page.getByTestId("rail-home").click();
    await tile(screen.page, "Alpha Film").click();
    await screen.page.getByTestId("tv-detail-recommend").click();
    await screen.page.getByTestId("tv-friend-send").click();
    await expect(screen.page.getByTestId("tv-account-toast")).toContainText("Sent to");
  }

  async function invitesToAParty(screen: Screen, to: Screen) {
    await screen.page.keyboard.press("Escape");
    await expect(screen.page.getByTestId("tv-detail")).toHaveCount(0);
    await screen.page.getByTestId("rail-party").click();
    await screen.page.getByTestId("tv-party-start").click();
    await screen.page.getByTestId("tv-party-invite-friends").click();
    await screen.page.getByTestId("tv-friend-send").click();
    await expect(screen.page.getByTestId("tv-account-toast")).toContainText(`Invited ${to.name}`);
  }

  test("over a film only an invitation is let through, as a small note in the corner that goes by itself; a title sent waits in the bell", async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const ann = await screenWithFriends(browser, "Ann", { library: films(baseURL!) });
    const bob = await screenWithFriends(browser, "Bob", { library: films(baseURL!) });
    await meet(ann, bob);
    const page = bob.page;
    await playsTheFilm(bob);

    await sendsTheTitle(ann);
    await looks(page);
    await expect(page.getByTestId("tv-account-toast")).toHaveCount(0);
    await expect(tvRoot(page)).toHaveAttribute("data-state", "playing");

    await invitesToAParty(ann, bob);
    await looks(page);
    const note = page.getByTestId("tv-account-toast");
    await expect(note).toContainText(`${ann.name} invited you to a watch party`);
    await expect(note).toHaveClass(/tv-note/);
    const at = (await note.boundingBox())!;
    const screen = page.viewportSize()!;
    expect(at.x + at.width / 2, "in the right half").toBeGreaterThan(screen.width / 2);
    expect(at.y + at.height, "in the upper third").toBeLessThan(screen.height / 3);
    expect(at.width, "a small one").toBeLessThan(screen.width / 3);
    await expect(tvRoot(page)).toHaveAttribute("data-state", "playing");
    await expect(note).toHaveCount(0, { timeout: 8000 });

    await stops(bob);
    await expect(page.getByTestId("tv-bell-badge")).toHaveText("2");
  });

  test("the same news with nothing playing is a line over the library, as before", async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const ann = await screenWithFriends(browser, "Ann", { library: films(baseURL!) });
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    await bob.page.getByTestId("rail-home").click();
    await sendsTheTitle(ann);
    await looks(bob.page);
    const toast = bob.page.getByTestId("tv-account-toast");
    await expect(toast).toContainText(`${ann.name} sent you Alpha Film`);
    await expect(toast).toHaveClass(/tv-toast/);
  });

  test("a profile that turned friends' news off before keeps that choice: nothing is said over a film or a library, the bell still counts, and the switch is there to turn it on again", async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const ann = await screenWithFriends(browser, "Ann", { library: films(baseURL!) });
    const bob = await screenWithFriends(browser, "Bob", { library: films(baseURL!) });
    await meet(ann, bob);
    const page = bob.page;
    const popups = page.getByTestId("tv-friends-popups");

    await hadTurnedOff(page, "newsPopups");
    await openFriends(page);
    await tile(page, "Friends settings").click();
    await expect(popups).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Escape");

    await page.getByTestId("rail-home").click();
    await sendsTheTitle(ann);
    await looks(page);
    await expect(page.getByTestId("tv-account-toast")).toHaveCount(0);
    await expect(page.getByTestId("tv-bell-badge")).toBeVisible();

    await playsTheFilm(bob);
    await invitesToAParty(ann, bob);
    await looks(page);
    await expect(page.getByTestId("tv-account-toast")).toHaveCount(0);
    await stops(bob);
    await expect(page.getByTestId("tv-bell-badge")).toHaveText("2");

    await openFriends(page);
    await tile(page, "Friends settings").click();
    await popups.click();
    await expect(popups).toHaveAttribute("aria-checked", "true");
  });
});

test.describe("walking the friends' pages with the remote", () => {
  test("OK opens the pages over the library, Back closes them to the tile they came from, and the remote starts on the first button of each", async ({ browser }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann");
    const page = ann.page;
    await openFriends(page);
    await expect(tile(page, "Add a friend")).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tv-friend-give")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("tv-friend-type")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("tv-friend-tag")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tv-friend-code")).toBeVisible();
    await expect(page.getByTestId("tv-friend-give-done")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tv-add-friend")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tv-add-friend")).toHaveCount(0);
    await expect(tile(page, "Add a friend")).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(tile(page, "Friends settings")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tv-friends-give")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("tv-friend-settings-done")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId("tv-friends-give")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(tile(page, "Friends settings")).toBeFocused();
  });

  test("the friends' page has a Back button in the corner, first before the bell and the account button; a click on it, or OK on it, goes to the profile's page, on the card it came from", async ({ browser }) => {
    const ann = await screenWithFriends(browser, "Ann");
    const page = ann.page;
    await openFriends(page);
    const back = page.getByTestId("tv-page-back");
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute("data-col", "0");
    await expect(page.getByTestId("tv-bell")).toHaveAttribute("data-col", "1");
    await expect(page.getByTestId("tv-account-chip")).toHaveAttribute("data-col", "2");

    await back.click();
    await expect(view(page)).toHaveAttribute("data-view", "profile");
    await expect(place(page, "friends")).toBeFocused();

    await place(page, "friends").click();
    await expect(view(page)).toHaveAttribute("data-view", "friends");
    await page.keyboard.press("ArrowUp");
    await expect(back).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("tv-bell")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    await expect(view(page)).toHaveAttribute("data-view", "profile");
    await expect(place(page, "friends")).toBeFocused();
  });
});

test.describe("walking a friend's page with the remote", () => {
  test("Up from the titles goes to the half that is shown, Right goes along the buttons, Remove is alone under the titles, and Back goes out one step", async ({ browser }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    await seed(bob.page, filmCards());
    const page = ann.page;

    await tile(page, bob.name).focus();
    await page.keyboard.press("Enter");
    await expect(view(page)).toHaveAttribute("data-view", /^friend:/);
    await expect(tile(page, "Alpha Film")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(tile(page, "Alpha Film")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId("friend-tab-lists")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("friend-tab-ratings")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("friend-tab-ratings")).toHaveAttribute("aria-checked", "true");
    await expect(tile(page, "Alpha Film")).toContainText("8/10");
    await page.keyboard.press("ArrowDown");
    await expect(tile(page, "Alpha Film")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId("friend-tab-ratings")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("tv-friend-back")).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("friend-remove")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tv-friend-unfriend-cancel")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tv-friend-unfriend")).toHaveCount(0);
    await expect(page.getByTestId("friend-remove")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(tile(page, "Alpha Film")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(view(page)).toHaveAttribute("data-view", "friends");
  });
});

test.describe("plans to watch together on the TV", () => {
  const wordsFor = (days: number, hour: number) => {
    const at = new Date();
    at.setDate(at.getDate() + days);
    return `${at.toLocaleDateString("en-GB", { weekday: "long" })} at ${String(hour).padStart(2, "0")}:00`;
  };
  const focusedId = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("data-testid"));

  test("the remote plans with the arrow keys; the friend answers with OK from the page of friends and from the bell; the one who planned is told", async ({ browser }) => {
    test.setTimeout(240_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    const page = ann.page;
    const planned = wordsFor(2, 19);

    await tile(page, bob.name).click();
    const chip = page.getByTestId("friend-plan");
    await expect(chip).toBeVisible();
    await expect(page.getByTestId("friend-together")).toBeVisible();
    await chip.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tv-plan-picker")).toBeVisible();
    const chosen = page.locator('[data-testid="tv-plan-day"][aria-checked="true"]');
    await expect(chosen).toBeFocused();
    await expect(page.getByTestId("tv-plan-day")).toHaveCount(7);

    const day = (n: number) => page.locator(`[data-testid="tv-plan-day"][data-day="${n}"]`);
    for (let step = Number(await chosen.getAttribute("data-day")); step < 2; step++) await page.keyboard.press("ArrowRight");
    await expect(day(2)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(day(2)).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowDown");
    expect(await focusedId(page)).toBe("tv-plan-hour");
    const seven = page.locator('[data-testid="tv-plan-hour"][data-hour="19"]');
    await seven.focus();
    await page.keyboard.press("Enter");
    await expect(seven).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("tv-plan-summary")).toHaveText(planned);
    await expect(page.getByTestId("tv-plan-notice")).toContainText(`${bob.name} sees this`);

    await page.keyboard.press("ArrowDown");
    if ((await focusedId(page)) !== "tv-plan-send") await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("tv-plan-send")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tv-account-toast")).toContainText(`Plan sent to ${bob.name}`);
    await expect(page.getByTestId("tv-plan-picker")).toHaveCount(0);
    await expect(chip).toBeFocused();

    await look(bob.page);
    await expect(bob.page.getByTestId("tv-account-toast")).toContainText(`${ann.name} proposes to watch together: ${planned}`);
    const asked = tile(bob.page, `${ann.name} proposes to watch together`);
    await expect(asked).toBeVisible();
    await expect(asked).toContainText(planned);

    await asked.click();
    const question = bob.page.getByTestId("tv-plan");
    await expect(question).toBeVisible();
    await expect(question.getByTestId("tv-plan-heading")).toHaveText(`${ann.name} proposes to watch together`);
    await expect(question.getByTestId("tv-plan-detail")).toHaveText(planned);
    await expect(question.getByTestId("tv-plan-accept")).toBeFocused();
    await bob.page.keyboard.press("Escape");
    await expect(question).toHaveCount(0);
    await expect(asked).toBeVisible();
    await asked.focus();
    await bob.page.keyboard.press("Enter");
    await expect(question.getByTestId("tv-plan-accept")).toBeFocused();
    await bob.page.keyboard.press("Enter");
    await expect(question).toHaveCount(0);
    await expect(asked).toHaveCount(0);
    await expect(tile(bob.page, `Watching together with ${ann.name}`)).toContainText(planned);

    await look(ann.page);
    await expect(ann.page.getByTestId("tv-account-toast")).toContainText(`${bob.name} said yes to watching together: ${planned}`);
    await page.keyboard.press("Escape");
    await expect(view(page)).toHaveAttribute("data-view", "friends");
    await expect(tile(page, `Watching together with ${bob.name}`)).toContainText(planned);
    await page.getByTestId("tv-bell").click();
    const line = page.getByTestId("tv-bell-item");
    await expect(line).toHaveCount(1);
    await expect(line).toContainText(`Watching together with ${bob.name}`);
    await line.click();
    const mine = page.getByTestId("tv-plan");
    await expect(mine.getByTestId("tv-plan-heading")).toHaveText(`Watching together with ${bob.name}`);
    await expect(mine.getByTestId("tv-plan-accept")).toHaveCount(0);
    await expect(mine.getByTestId("tv-plan-ok")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(mine).toHaveCount(0);
    await expect(page.getByTestId("tv-bell")).toBeFocused();
  });

  test("a no is a window with Decline, and the news of it can be read and sent away; a plan whose friendship ends is gone with it", async ({ browser }) => {
    test.setTimeout(240_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    const day = 3;
    const when = new Date();
    when.setDate(when.getDate() + day);
    when.setHours(21, 0, 0, 0);
    const planned = wordsFor(day, 21);

    await proposes(ann, bob, when.getTime(), "Bring snacks");
    await look(bob.page);
    const asked = tile(bob.page, `${ann.name} proposes to watch together`);
    await expect(asked).toContainText(`${planned} · Bring snacks`);
    await asked.click();
    await expect(bob.page.getByTestId("tv-plan-detail")).toHaveText(`${planned} · Bring snacks`);
    await bob.page.getByTestId("tv-plan-decline").click();
    await expect(bob.page.getByTestId("tv-plan")).toHaveCount(0);
    await expect(asked).toHaveCount(0);

    await look(ann.page);
    await expect(ann.page.getByTestId("tv-account-toast")).toContainText(`${bob.name} can't make it: ${planned}`);
    const news = tile(ann.page, `${bob.name} can't make it`);
    await expect(news).toContainText(planned);
    await news.click();
    await expect(ann.page.getByTestId("tv-plan-ok")).toBeFocused();
    await ann.page.getByTestId("tv-plan-dismiss").click();
    await expect(ann.page.getByTestId("tv-plan")).toHaveCount(0);
    await expect(news).toHaveCount(0);

    await proposes(ann, bob, when.getTime());
    await look(bob.page);
    await tile(bob.page, `${ann.name} proposes to watch together`).click();
    await expect(bob.page.getByTestId("tv-plan")).toBeVisible();
    const profile = await ann.page.evaluate(() => localStorage.getItem("kino.profile"));
    const bobsProfile = await bob.page.evaluate(() => localStorage.getItem("kino.profile"));
    const parted = await ann.page.request.delete(`/api/profiles/${profile}/friends/${bobsProfile}`);
    expect(parted.ok()).toBe(true);
    await look(bob.page);
    await expect(bob.page.getByTestId("tv-plan")).toHaveCount(0);
    await expect(tile(bob.page, `${ann.name} proposes to watch together`)).toHaveCount(0);
  });
});

test.describe("the page of friends starts at the top", () => {
  for (const screen of [
    { name: "720p", width: 1280, height: 720 },
    { name: "1080p", width: 1920, height: 1080 },
  ]) {
    test(`its heading is just under the top, and the row of what a friend watched shows at least half under the friends: ${screen.name}`, async ({ browser }) => {
      test.setTimeout(150_000);
      const viewport = { width: screen.width, height: screen.height };
      const ann = await screenWithFriends(browser, "Ann", { viewport });
      const bob = await screenWithFriends(browser, "Bob", { viewport });
      await meet(ann, bob);
      await tellsWhatItWatches(bob, ann);
      await seed(bob.page, { progress: [{ key: "beta", at: Date.now(), title: "Beta Film", url: "https://films.example/watch/18", year: 1940, position: 300, duration: 5400 }] });
      await look(ann.page);
      const page = ann.page;
      await openFriends(page);
      const watched = page.locator(`section.tv-row[aria-label="What ${bob.name} watched"]`);
      await expect(watched).toHaveCount(1);
      await expect(tile(page, bob.name)).toBeVisible();

      const box = async (target: ReturnType<Page["locator"]>) => (await target.boundingBox())!;
      const corner = await box(page.getByTestId("tv-account-chip"));
      const heading = await box(page.getByTestId("tv-friends-title"));
      const row = await box(watched);
      if (process.env.SHOT_DIR) {
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `${process.env.SHOT_DIR}/friends-${screen.name}.png` });
      }
      console.log(`friends page ${screen.name}: top bar ends ${Math.round(corner.y + corner.height)}, heading at ${Math.round(heading.y)}, watched row ${Math.round(row.y)}..${Math.round(row.y + row.height)}`);
      expect(heading.y - (corner.y + corner.height), "the space over the heading").toBeLessThan(screen.height * 0.06);
      expect(row.y + row.height / 2, "half of the row of what a friend watched").toBeLessThanOrEqual(screen.height);
    });
  }
});

test.describe("everything of friends fits the screen", () => {
  for (const screen of [
    { name: "720p", width: 1280, height: 720 },
    { name: "1080p", width: 1920, height: 1080 },
    { name: "4:3", width: 1024, height: 768 },
    { name: "a small window", width: 800, height: 600 },
    { name: "a phone's width", width: 390, height: 844 },
    { name: "a phone held sideways", width: 844, height: 390 },
    { name: "720p in Romanian", width: 1280, height: 720, language: "ro" as Language },
    { name: "720p in Italian", width: 1280, height: 720, language: "it" as Language },
  ]) {
    test(`the account page with its friends switch, the pages of friends and the pages over the library are all on the screen: ${screen.name}`, async ({ browser, baseURL }) => {
      test.setTimeout(240_000);
      const viewport = { width: screen.width, height: screen.height };
      const words = WORDS[screen.language ?? "en"];
      const language = screen.language ? { language: screen.language } : {};
      const ann = await screenWithFriends(browser, "Ann", { viewport, library: films(baseURL!), ...language });
      const bob = await screenWithFriends(browser, "Bob", { viewport, ...language });
      const cy = await screenWithFriends(browser, "Cy", { viewport, ...language });
      await meet(ann, bob, words["friends.add"]);
      await seed(bob.page, filmCards());
      await tellsWhatItWatches(bob, ann, words);
      const page = ann.page;
      const wide = screen.width >= 900;
      const fits = async (root: string, what: string) => expect(await outsideTheScreen(page, root, wide), what).toEqual([]);

      await openProfilePlace(page, "settings");
      await expect(page.getByTestId("tv-account")).toBeVisible();
      await fits("tv-account", "the account page");
      await page.getByTestId("tv-account-back").click();

      await openFriends(page);
      await expect(tile(page, bob.name)).toBeVisible();
      const row = await tile(page, bob.name).boundingBox();
      expect(row!.x, "the friend's tile from the left").toBeGreaterThanOrEqual(0);
      expect(row!.y + row!.height, "the friend's tile to the bottom").toBeLessThanOrEqual(screen.height + 0.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      await tile(page, bob.name).click();
      await expect(tile(page, "Alpha Film")).toBeVisible();
      for (const id of ["tv-friend-back", "friend-tab-lists", "friend-tab-ratings", "friend-together", "friend-plan", "friend-remove"]) {
        await page.getByTestId(id).focus();
        await expect
          .poll(async () => {
            const at = (await page.getByTestId(id).boundingBox())!;
            return at.x >= -0.5 && at.x + at.width <= screen.width + 0.5 && at.y + at.height <= screen.height + 0.5;
          }, { message: `${id} inside the screen` })
          .toBe(true);
      }
      await page.getByTestId("friend-plan").click();
      await expect(page.getByTestId("tv-plan-picker")).toBeVisible();
      await fits("tv-plan-picker", "the page that plans a watch together");
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("tv-plan-picker")).toHaveCount(0);
      await page.getByTestId("friend-remove").click();
      await fits("tv-friend-unfriend", "the question before a friend goes");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(view(page)).toHaveAttribute("data-view", "friends");

      await openFriends(cy.page);
      await tile(cy.page, words["friends.add"]).click();
      await cy.page.getByTestId("tv-friend-give").click();
      const code = (await cy.page.getByTestId("tv-friend-code").textContent())!.trim();

      await tile(page, words["friends.add"]).click();
      await fits("tv-add-friend", "the question");
      await page.getByTestId("tv-friend-give").click();
      await expect(page.getByTestId("tv-friend-code")).toBeVisible();
      await fits("tv-friend-give-page", "the code that is given");
      await page.keyboard.press("Escape");
      await page.getByTestId("tv-friend-type").click();
      await page.getByTestId("tv-friend-code-input").fill(code);
      await expect(page.getByTestId("tv-friend-found")).toBeVisible();
      await fits("tv-friend-type-page", "the code that is typed");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      await tile(page, words["friends.settingsTile"]).click();
      await fits("tv-friend-settings", "the page of what is shared");
      await page.keyboard.press("Escape");

      await page.getByTestId("rail-home").click();
      await tile(page, "Alpha Film").click();
      await page.getByTestId("tv-detail-recommend").click();
      await expect(page.getByTestId("tv-friend-picker")).toBeVisible();
      await fits("tv-friend-picker", "the page that sends a title");
    });
  }

  for (const screen of [
    { name: "720p in Romanian", width: 1280, height: 720, language: "ro" as Language },
    { name: "a phone's width in Italian", width: 390, height: 844, language: "it" as Language },
  ]) {
    test(`the tile that turns on what friends watch and the line that says why a friend's is not shown are on the screen: ${screen.name}`, async ({ browser }) => {
      test.setTimeout(180_000);
      const viewport = { width: screen.width, height: screen.height };
      const words = WORDS[screen.language];
      const ann = await screenWithFriends(browser, "Ann", { viewport, language: screen.language });
      const bob = await screenWithFriends(browser, "Bob", { viewport, language: screen.language });
      await meet(ann, bob, words["friends.add"]);
      const page = ann.page;
      const wide = screen.width >= 900;

      const turnOn = tile(page, words["friends.turnOn"]);
      await expect(turnOn).toBeVisible();
      for (const target of [turnOn, tile(page, bob.name)]) {
        const at = (await target.boundingBox())!;
        expect(at.x, "the tile from the left").toBeGreaterThanOrEqual(0);
        if (wide) expect(at.y + at.height, "the tile to the bottom").toBeLessThanOrEqual(screen.height + 0.5);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      await tile(page, bob.name).click();
      await expect(page.getByTestId("tv-view-hint")).toContainText(say(words["friends.hintMine"], { name: bob.name, switch: words["friends.switchGive"] }));
      const line = (await page.getByTestId("tv-view-hint").boundingBox())!;
      expect(line.x, "the line from the left").toBeGreaterThanOrEqual(0);
      expect(line.x + line.width, "the line to the right").toBeLessThanOrEqual(screen.width + 0.5);
      expect(line.y + line.height, "the line to the bottom").toBeLessThanOrEqual(screen.height + 0.5);
      if (wide) expect(await outsideTheScreen(page, "tv-browse"), "the page of a friend").toEqual([]);
      for (const id of ["tv-friend-back", "friend-tab-lists", "friend-tab-ratings", "friend-together", "friend-plan", "friend-remove"]) {
        await page.getByTestId(id).focus();
        await expect
          .poll(async () => {
            const at = (await page.getByTestId(id).boundingBox())!;
            return at.x >= -0.5 && at.x + at.width <= screen.width + 0.5 && at.y + at.height <= screen.height + 0.5;
          }, { message: `${id} inside the screen` })
          .toBe(true);
      }
    });
  }

  for (const screen of [
    { name: "720p", width: 1280, height: 720 },
    { name: "720p in Romanian", width: 1280, height: 720, language: "ro" as Language },
    { name: "a small window in Italian", width: 800, height: 600, language: "it" as Language },
    { name: "a phone's width in Romanian", width: 390, height: 844, language: "ro" as Language },
  ]) {
    test(`a plan to answer, as a tile and as a window, is on the screen: ${screen.name}`, async ({ browser }) => {
      test.setTimeout(180_000);
      const viewport = { width: screen.width, height: screen.height };
      const words = WORDS[screen.language ?? "en"];
      const language = screen.language ? { language: screen.language } : {};
      const ann = await screenWithFriends(browser, "Ann", { viewport, ...language });
      const bob = await screenWithFriends(browser, "Bob", { viewport, ...language });
      await meet(ann, bob, words["friends.add"]);
      const page = ann.page;
      const wide = screen.width >= 900;
      const when = new Date();
      when.setDate(when.getDate() + 2);
      when.setHours(19, 0, 0, 0);
      await proposes(bob, ann, when.getTime(), "Ne uităm la un film cu multe explozii, cu floricele de porumb și suc, și vorbim după aceea despre ce ne-a plăcut");
      await look(page);

      const asked = tile(page, say(words["friends.planOf"], { name: bob.name }));
      await expect(asked).toBeVisible();
      const at = (await asked.boundingBox())!;
      expect(at.x, "the plan's tile from the left").toBeGreaterThanOrEqual(0);
      expect(at.x + at.width, "the plan's tile to the right").toBeLessThanOrEqual(screen.width + 0.5);
      if (wide) expect(at.y + at.height, "the plan's tile to the bottom").toBeLessThanOrEqual(screen.height + 0.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      await asked.click();
      await expect(page.getByTestId("tv-plan-heading")).toHaveText(say(words["friends.planOf"], { name: bob.name }));
      expect(await outsideTheScreen(page, "tv-plan", wide), "the window that answers a plan").toEqual([]);
      for (const id of ["tv-plan-accept", "tv-plan-decline", "tv-plan-back"]) {
        await page.getByTestId(id).focus();
        const box = (await page.getByTestId(id).boundingBox())!;
        expect(box.x, `${id} from the left`).toBeGreaterThanOrEqual(-0.5);
        expect(box.x + box.width, `${id} to the right`).toBeLessThanOrEqual(screen.width + 0.5);
      }
    });
  }
});
