import { expect, test, type Browser, type Page } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { it as italian } from "../src/client/i18n/it";
import { ro } from "../src/client/i18n/ro";
import { listKey, ratingKey } from "../src/shared";
import { openLibrary, withLibrary } from "./helpers";

/**
 * Friends, on the TV: switched on in the settings of the account, then a menu line of their own with the friends' page (invitations to
 * watch parties, what friends sent, what they watch, who they are), a page for each friend with their lists and ratings, the pages to
 * add a friend, to choose what is shared and to send a title or a party to friends. Each test makes its own accounts and screens (the
 * server keeps accounts in memory), and the screens are signed in with the email form, which is how a screen with a keyboard does it.
 */

test.use({ actionTimeout: 15_000 }); // (a wrong id fails in seconds, not when the test runs out of time)

let counter = 0;
/** A name short enough to be a profile's name as it is (a profile is named after the username, 16 letters at most). */
const fresh = (name: string) => ({ email: `${name}${++counter}x${Date.now().toString(36).slice(-4)}`, password: "1" });
type Account = ReturnType<typeof fresh>;
const nameOf = (account: Account) => account.email.charAt(0).toUpperCase() + account.email.slice(1);

interface Screen {
  page: Page;
  name: string;
}

const HD = { width: 1280, height: 720 };

/** The words of a language (a screen can be set to one, and its tiles are found by what they say). */
const WORDS = { en, ro, it: italian };
type Language = keyof typeof WORDS;

const films = (baseURL: string) => ({
  updatedAt: Date.now(),
  rows: [{ id: "r", title: "Classics", source: "Test Source", kind: "movie", items: [{ id: "a", title: "Alpha Film", year: 1931, kind: "movie", url: `${baseURL}/fixtures/sample.mp4?n=1` }] }],
});

/** A new screen, signed up with the email form. Friends are still off. */
async function signedInScreen(browser: Browser, name: string, options: { viewport?: { width: number; height: number }; library?: unknown; language?: Language } = {}): Promise<Screen> {
  const account = fresh(name);
  const page = await openLibrary(browser, options.library ? withLibrary(options.library) : undefined, options.viewport ?? HD, options.language ? { "kino.lang": options.language } : {});
  await page.getByTestId("tv-account-chip").click();
  await page.getByTestId("tv-signin-email").click();
  await page.getByTestId("auth-switch").click();
  await expect(page.getByTestId("auth-form")).toHaveAttribute("data-mode", "signUp");
  await page.getByTestId("auth-email").fill(account.email);
  await page.getByTestId("auth-password").fill(account.password);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("tv-account-chip")).toContainText(nameOf(account));
  return { page, name: nameOf(account) };
}

/** A signed-in screen, with the switch in the settings of the account turned on. */
async function screenWithFriends(browser: Browser, name: string, options: Parameters<typeof signedInScreen>[2] = {}): Promise<Screen> {
  const screen = await signedInScreen(browser, name, options);
  await screen.page.getByTestId("rail-settings").click();
  await screen.page.getByTestId("tv-friends-switch").click();
  await expect(screen.page.getByTestId("tv-friends-switch")).toHaveAttribute("aria-checked", "true");
  await screen.page.getByTestId("tv-account-back").click();
  await expect(screen.page.getByTestId("rail-friends")).toBeVisible();
  return screen;
}

/** The page looks at its friends now, as it does when it comes back to the front (and every half minute). */
const look = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

/** A tile of the current page, by its title. */
const tile = (page: Page, title: string) => page.locator(`.tv-tile[title="${title}"]`);

const view = (page: Page) => page.getByTestId("tv-browse");

async function openFriends(page: Page) {
  await page.getByTestId("rail-friends").click();
  await expect(view(page)).toHaveAttribute("data-view", "friends");
}

/** `giver` shows a code and `taker` types it: two screens whose profiles are friends. Both are left on the page of their friends. */
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
  await expect(giver.page.getByTestId("tv-friend-give-page")).toHaveCount(0); // (the code is spent: the page that showed it has nothing more to say)
  return code;
}

/** What a profile keeps on the server, put there the way a screen does (a film in a list, a score, what it is part way through). */
async function seed(page: Page, data: Record<string, unknown[]>) {
  const profile = await page.evaluate(() => localStorage.getItem("kino.profile"));
  const response = await page.request.post(`/api/profiles/${profile}/sync`, { data: { since: 0, ...data } });
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

/**
 * Everything under `root` that is a control or says something and does not lie inside the screen. On a narrow screen (under 900 pixels
 * wide, where the pages are one column) a page is allowed to be longer than the screen, since it scrolls: only the sides are held to it.
 */
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

test.describe("friends are optional on the TV", () => {
  test("a screen that is signed out has no switch for them; a signed-in one has it off, and its menu has Friends only once it is on; the friends are kept while it is off", async ({ browser }) => {
    test.setTimeout(150_000);
    const guest = await openLibrary(browser, undefined, HD);
    await guest.getByTestId("rail-settings").click();
    await expect(guest.getByTestId("tv-ratings-switch")).toBeVisible();
    await expect(guest.getByTestId("tv-friends-switch")).toHaveCount(0);
    await guest.getByTestId("tv-account-back").click();
    await expect(guest.getByTestId("rail-friends")).toHaveCount(0);

    const ann = await signedInScreen(browser, "Ann");
    await expect(ann.page.getByTestId("rail-friends")).toHaveCount(0);
    await ann.page.getByTestId("rail-settings").click();
    await expect(ann.page.getByTestId("tv-friends-switch")).toHaveAttribute("aria-checked", "false");
    await ann.page.getByTestId("tv-friends-switch").click();
    await expect(ann.page.getByTestId("tv-friends-switch")).toHaveAttribute("aria-checked", "true");
    await ann.page.getByTestId("tv-account-back").click();

    // with a friend, then off: the menu line goes, and the friend is there when it is back
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    await ann.page.getByTestId("rail-settings").click();
    await ann.page.getByTestId("tv-friends-switch").click();
    await expect(ann.page.getByTestId("tv-friends-switch")).toHaveAttribute("aria-checked", "false");
    await ann.page.getByTestId("tv-account-back").click();
    await expect(ann.page.getByTestId("rail-friends")).toHaveCount(0);
    await expect(view(ann.page)).toHaveAttribute("data-view", "home"); // (the page of friends was open: it goes with them)

    await ann.page.getByTestId("rail-settings").click();
    await ann.page.getByTestId("tv-friends-switch").click();
    await ann.page.getByTestId("tv-account-back").click();
    await openFriends(ann.page);
    await expect(tile(ann.page, bob.name)).toBeVisible();
  });
});

test.describe("making friends on the TV", () => {
  test("a code one screen shows and another types makes them friends; the page that showed it closes by itself, and a code works once", async ({ browser }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    const cy = await screenWithFriends(browser, "Cy");

    // nobody yet: only the two tiles that start things
    await openFriends(ann.page);
    await expect(ann.page.locator(".tv-tile-category")).toHaveCount(2);
    await expect(tile(ann.page, "Friends settings")).toBeVisible();

    const code = await meet(ann, bob);
    await expect(ann.page.getByTestId("tv-account-toast")).toContainText(`You and ${bob.name} are now friends`);
    await expect(bob.page.getByTestId("tv-account-toast")).toContainText(`You and ${ann.name} are now friends`);
    await expect(ann.page.locator(".tv-tile-category")).toHaveCount(3);

    // typed as it was read, but the code is spent
    await openFriends(cy.page);
    await tile(cy.page, "Add a friend").click();
    await cy.page.getByTestId("tv-friend-type").click();
    await cy.page.getByTestId("tv-friend-code-input").fill(code.replace("-", "").toLowerCase());
    await expect(cy.page.getByTestId("tv-friend-code-error")).toBeVisible();
    await expect(cy.page.getByTestId("tv-friend-code-add")).toHaveCount(0);
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
    await expect(ann.page.getByTestId("tv-add-friend")).toBeVisible(); // back at the question, not out of it

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

test.describe("a friend's page", () => {
  test("has their lists, then their ratings, says when they are not shared, and a first press on Remove only asks", async ({ browser }) => {
    test.setTimeout(180_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    await seed(ann.page, filmCards());

    // Bob opens Ann's tile: her lists first, the list each title is in under it
    await tile(bob.page, ann.name).click();
    await expect(view(bob.page)).toHaveAttribute("data-view", /^friend:/);
    await expect(bob.page.getByTestId("tv-view-title")).toHaveText(ann.name);
    await expect(bob.page.getByTestId("friend-tab-lists")).toHaveAttribute("aria-checked", "true");
    await expect(tile(bob.page, "Alpha Film")).toContainText("Favourites");
    await bob.page.getByTestId("friend-tab-ratings").click();
    await expect(tile(bob.page, "Alpha Film")).toContainText("8/10");

    // Ann stops sharing her ratings, in the page of what is shared; Bob is told so, not shown an empty page
    await tile(ann.page, "Friends settings").click();
    await ann.page.getByTestId("tv-friends-ratings").click();
    await expect(ann.page.getByTestId("tv-friends-ratings")).toHaveAttribute("aria-checked", "false");
    await ann.page.getByTestId("tv-friend-settings-done").click();
    await expect(async () => {
      await look(bob.page);
      await expect(bob.page.getByTestId("tv-view-empty")).toContainText(`${ann.name} is not sharing their ratings`, { timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    await bob.page.getByTestId("friend-tab-lists").click();
    await expect(tile(bob.page, "Alpha Film")).toBeVisible(); // (the lists are still shared)

    // Back is one step out, to the page of friends
    await bob.page.keyboard.press("Escape");
    await expect(view(bob.page)).toHaveAttribute("data-view", "friends");

    // Remove asks for a second press, and then neither has the other
    await tile(bob.page, ann.name).click();
    const remove = bob.page.getByTestId("friend-remove");
    await expect(remove).toHaveAttribute("data-asking", "false");
    await remove.click();
    await expect(remove).toHaveAttribute("data-asking", "true");
    await expect(remove).toContainText(`Press again to remove ${ann.name}`);
    await remove.click();
    await expect(view(bob.page)).toHaveAttribute("data-view", "friends");
    await expect(bob.page.getByTestId("tv-account-toast")).toContainText(`${ann.name} is no longer your friend`);
    await expect(tile(bob.page, ann.name)).toHaveCount(0);
    await look(ann.page);
    await expect(tile(ann.page, bob.name)).toHaveCount(0);
  });

  test("a friend who turned friends off shows nothing, and says so", async ({ browser }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    await seed(ann.page, filmCards());

    await ann.page.getByTestId("rail-settings").click();
    await ann.page.getByTestId("tv-friends-switch").click();
    await expect(ann.page.getByTestId("tv-friends-switch")).toHaveAttribute("aria-checked", "false");
    await expect(async () => {
      await look(bob.page);
      await expect(tile(bob.page, ann.name)).toContainText("Friends turned off", { timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    await tile(bob.page, ann.name).click();
    await expect(bob.page.getByTestId("tv-view-empty")).toContainText(`${ann.name} has turned friends off`);
    await expect(tile(bob.page, "Alpha Film")).toHaveCount(0);
  });
});

test.describe("what is shared", () => {
  test("each thing a friend may do has a switch on its own page, with what is seen on by default and what is told off, and the choices reach the server", async ({ browser }) => {
    test.setTimeout(120_000);
    const ann = await screenWithFriends(browser, "Ann");
    await openFriends(ann.page);
    await tile(ann.page, "Friends settings").click();
    const ids = ["tv-friends-lists", "tv-friends-ratings", "tv-friends-give", "tv-friends-get", "tv-friends-inbox"];
    const states = () => Promise.all(ids.map((id) => ann.page.getByTestId(id).getAttribute("aria-checked")));
    expect(await states()).toEqual(["true", "true", "false", "false", "true"]); // (what a friend may see is on by default; telling what is watched is not)
    await ann.page.getByTestId("tv-friends-give").click();
    await ann.page.getByTestId("tv-friends-lists").click();
    expect(await states()).toEqual(["false", "true", "true", "false", "true"]);

    const profile = await ann.page.evaluate(() => localStorage.getItem("kino.profile"));
    await expect
      .poll(async () => {
        const answer = (await (await ann.page.request.post(`/api/profiles/${profile}/sync`, { data: { since: 0 } })).json()) as { settings: Array<{ key: string; value?: unknown }> };
        return Object.fromEntries(answer.settings.map((item) => [item.key, item.value]));
      })
      .toMatchObject({ friends: true, friendsGive: true, friendsLists: false });

    // Back from the page lands where it came from
    await ann.page.keyboard.press("Escape");
    await expect(tile(ann.page, "Friends settings")).toBeFocused();
  });
});

test.describe("sending things to friends from the TV", () => {
  test("a title is sent from its own page, arrives on the other screen as a card in a row of its own and a number on the menu, and is dismissed with its button", async ({ browser, baseURL }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann", { library: films(baseURL!) });
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);

    // nobody to send to before there is a friend; with one, she is picked already
    await ann.page.getByTestId("rail-home").click();
    await tile(ann.page, "Alpha Film").click();
    await ann.page.getByTestId("tv-detail-recommend").click();
    await expect(ann.page.getByTestId("tv-friend-pick")).toHaveCount(1);
    await expect(ann.page.getByTestId("tv-friend-pick")).toHaveAttribute("aria-pressed", "true");
    await ann.page.getByTestId("tv-friend-send").click();
    await expect(ann.page.getByTestId("tv-account-toast")).toContainText(`Sent to ${bob.name}`);
    await expect(ann.page.getByTestId("tv-friend-picker")).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-detail")).toBeVisible(); // (back on the title's page)

    // Bob: told in a line, a number on the menu until he looks, then a row of its own with who sent it
    await bob.page.getByTestId("rail-home").click();
    await look(bob.page);
    await expect(bob.page.getByTestId("tv-account-toast")).toContainText(`${ann.name} sent you Alpha Film`);
    await expect(bob.page.getByTestId("rail-friends")).toHaveAttribute("data-badged", "true");
    await expect(bob.page.getByTestId("rail-friends")).toContainText("1");
    await openFriends(bob.page);
    const sent = bob.page.locator(`.tv-row[aria-label="From your friends"]`);
    await expect(sent.locator(".tv-tile")).toHaveCount(1);
    await expect(sent.locator(".tv-tile").first()).toContainText(`From ${ann.name}`);
    await expect(bob.page.getByTestId("rail-friends")).not.toHaveAttribute("data-badged", "true"); // (opening the page is seeing it)

    // the banner offers what can be done with it (the page opens where the remote was last, so it goes to the new row), and the last of them sends it away
    await sent.locator(".tv-tile").first().focus();
    await expect(bob.page.getByTestId("tv-hero-title")).toHaveText("Alpha Film");
    await expect(bob.page.getByTestId("tv-hero-play")).toBeVisible();
    await bob.page.getByTestId("tv-hero-dismiss").click();
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
    await expect(ann.page.getByTestId("tv-party")).toBeVisible(); // (back on the host's page)

    // Bob's page of friends has a row for it, and pressing it joins the party
    await look(bob.page);
    const invitation = tile(bob.page, `${ann.name}'s party`);
    await expect(invitation).toBeVisible();
    await expect(bob.page.locator(`.tv-row[aria-label="Watch parties"]`)).toBeVisible();
    await invitation.click();
    await expect(bob.page.getByTestId("tv-party-guest")).toBeVisible();
    await expect(ann.page.getByTestId("tv-party-member")).toHaveCount(2);
  });

  test("a friend who is not taking things is not offered, and the page says why", async ({ browser, baseURL }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann", { library: films(baseURL!) });
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);

    await openFriends(bob.page);
    await tile(bob.page, "Friends settings").click();
    await bob.page.getByTestId("tv-friends-inbox").click();
    await expect(bob.page.getByTestId("tv-friends-inbox")).toHaveAttribute("aria-checked", "false");

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
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tv-friend-code")).toBeVisible();
    await expect(page.getByTestId("tv-friend-give-done")).toBeFocused();
    await page.keyboard.press("Escape"); // back to the question...
    await expect(page.getByTestId("tv-add-friend")).toBeVisible();
    await page.keyboard.press("Escape"); // ...and out of it, to the tile that opened it
    await expect(page.getByTestId("tv-add-friend")).toHaveCount(0);
    await expect(tile(page, "Add a friend")).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(tile(page, "Friends settings")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tv-friends-lists")).toBeFocused();
    await page.keyboard.press("ArrowRight"); // two columns of switches: lists | ratings, give | get, inbox
    await expect(page.getByTestId("tv-friends-ratings")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("tv-friends-get")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("tv-friends-give")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("tv-friends-inbox")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(tile(page, "Friends settings")).toBeFocused();
  });
});

test.describe("walking a friend's page with the remote", () => {
  test("Up from the titles goes to the half that is shown, Right goes along the buttons, and Back goes out one step", async ({ browser }) => {
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
    await page.keyboard.press("ArrowDown"); // (nowhere to stand until the titles are there: the first press lands on the first of them)
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
    await expect(page.getByTestId("friend-tab-ratings")).toBeFocused(); // (the half that is shown, not the one above the title)
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("friend-remove")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(view(page)).toHaveAttribute("data-view", "friends");
  });
});

test.describe("everything of friends fits the screen", () => {
  for (const screen of [
    { name: "720p", width: 1280, height: 720 },
    { name: "1080p", width: 1920, height: 1080 },
    { name: "4:3", width: 1024, height: 768 },
    { name: "a small window", width: 800, height: 600 },
    { name: "a phone's width", width: 390, height: 844 },
    // (the longest words: the sizes follow the screen's width, so one shape tells for the rest)
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
      const page = ann.page;
      const wide = screen.width >= 900; // (a narrower screen has one column, and a page that is longer than it scrolls)
      const fits = async (root: string, what: string) => expect(await outsideTheScreen(page, root, wide), what).toEqual([]);

      // the account page, signed in, with the friends switch among the settings
      await page.getByTestId("rail-settings").click();
      await expect(page.getByTestId("tv-friends-switch")).toBeVisible();
      await fits("tv-account", "the account page");
      await page.getByTestId("tv-account-back").click();

      // the page of friends: the banner and the row of friends
      await openFriends(page);
      await expect(tile(page, bob.name)).toBeVisible();
      const row = await tile(page, bob.name).boundingBox();
      expect(row!.x, "the friend's tile from the left").toBeGreaterThanOrEqual(0);
      expect(row!.y + row!.height, "the friend's tile to the bottom").toBeLessThanOrEqual(screen.height + 0.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      // a friend's page, with the button asking for a second press
      await tile(page, bob.name).click();
      await expect(tile(page, "Alpha Film")).toBeVisible();
      await page.getByTestId("friend-remove").click();
      await expect(page.getByTestId("friend-remove")).toContainText(words["friends.pressAgain"].split(" {name}")[0]!);
      // (the buttons are one row, like the lists' on a narrow screen: that row slides to the one the remote is on)
      for (const id of ["friend-tab-lists", "friend-tab-ratings", "friend-remove"]) {
        await page.getByTestId(id).focus();
        await expect
          .poll(async () => {
            const at = (await page.getByTestId(id).boundingBox())!;
            return at.x >= -0.5 && at.x + at.width <= screen.width + 0.5 && at.y + at.height <= screen.height + 0.5;
          }, { message: `${id} inside the screen` })
          .toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(view(page)).toHaveAttribute("data-view", "friends");

      // adding: the question, the code that is given, the code that is typed (and who it is from)
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

      // what is shared
      await tile(page, words["friends.settingsTile"]).click();
      await fits("tv-friend-settings", "the page of what is shared");
      await page.keyboard.press("Escape");

      // sending a title
      await page.getByTestId("rail-home").click();
      await tile(page, "Alpha Film").click();
      await page.getByTestId("tv-detail-recommend").click();
      await expect(page.getByTestId("tv-friend-picker")).toBeVisible();
      await fits("tv-friend-picker", "the page that sends a title");
    });
  }
});
