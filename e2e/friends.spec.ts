import { expect, test, type Browser, type Page } from "@playwright/test";
import { listKey, ratingKey } from "../src/shared";
import { openDevice, openTv, PHONE, readPairingCode, withLibrary } from "./helpers";

/**
 * Friends, on the phone: switched on in the settings, made with a code that one profile gives and another types (or a link), and then
 * what a friend may see, send and be told is what each has turned on. Every test makes its own accounts (the server keeps them in memory).
 */

test.use({ actionTimeout: 15_000 }); // (a wrong id fails in seconds, not when the test runs out of time)

let counter = 0;
/** A name short enough to be a profile's name as it is (a profile is named after the username, 16 letters at most). */
const fresh = (name: string) => ({ email: `${name}${++counter}x${Date.now().toString(36).slice(-4)}`, password: "1" });
type Account = ReturnType<typeof fresh>;
const nameOf = (account: Account) => account.email.charAt(0).toUpperCase() + account.email.slice(1);

const newPhone = (browser: Browser) => openDevice(browser, { ...PHONE, locale: "en-US" });

async function signUp(page: Page, account: Account) {
  await page.getByTestId("account-button").click();
  await page.getByTestId("auth-switch").click();
  await expect(page.getByTestId("auth-form")).toHaveAttribute("data-mode", "signUp");
  await page.getByTestId("auth-email").fill(account.email);
  await page.getByTestId("auth-password").fill(account.password);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("account-card")).toBeVisible();
}

/** The account page is open: friends on, in the settings, and back. */
async function turnOnFriends(page: Page) {
  await page.getByTestId("menu-settings").click();
  await page.getByTestId("friends-switch").click();
  await expect(page.getByTestId("friends-switch")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape"); // (back to the account page)
  await expect(page.getByTestId("menu-friends")).toBeVisible();
}

/** The account page is open: the Friends page, once it has heard from the server. */
async function openFriends(page: Page) {
  await page.getByTestId("menu-friends").click();
  await expect(page.getByTestId("friends-page")).toBeVisible();
}

/** The page looks at its friends now, as it does when it comes back to the front (and every half minute). */
const look = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

/** A new phone, signed up, with friends on: left on the account page. */
async function phoneWithFriends(browser: Browser, name: string) {
  const account = fresh(name);
  const page = await newPhone(browser);
  await page.goto("/");
  await signUp(page, account);
  await turnOnFriends(page);
  return { page, account, name: nameOf(account) };
}

/** `giver` makes a code and `taker` types it: two profiles that are friends. Both start on the account page, and are left there. */
async function befriend(giver: Page, taker: Page) {
  await openFriends(giver);
  await giver.getByTestId("friend-make-code").click();
  const code = (await giver.getByTestId("friend-invite-code").textContent())!;
  await openFriends(taker);
  await taker.getByTestId("friend-code-input").fill(code);
  await taker.getByTestId("friend-code-add").click();
  await expect(taker.getByTestId("friend-row")).toHaveCount(1);
  await look(giver);
  await expect(giver.getByTestId("friend-row")).toHaveCount(1);
  for (const page of [giver, taker]) await page.keyboard.press("Escape");
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
    progress: [{ key: "alpha", at, title: "Alpha Film", url: FILM, year: 1931, position: 600, duration: 5400 }],
  };
};

test.describe("friends are optional", () => {
  test("they are off until the one switch in the settings is turned on; then there is a switch for each thing a friend may do, and the choices reach the server", async ({ browser }) => {
    const account = fresh("Ann");
    const page = await newPhone(browser);
    await page.goto("/");
    await signUp(page, account);
    await expect(page.getByTestId("menu-friends")).toHaveCount(0); // nothing of it on the account page...
    await page.getByTestId("menu-settings").click();
    const master = page.getByTestId("friends-switch");
    await expect(master).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("friends-lists")).toHaveCount(0); // ...and nothing to choose while it is off
    await expect(page.getByTestId("friends-open")).toHaveCount(0);

    await master.click();
    const ids = ["friends-lists", "friends-ratings", "friends-give", "friends-get", "friends-inbox-switch"];
    const states = () => Promise.all(ids.map((id) => page.getByTestId(id).getAttribute("aria-checked")));
    expect(await states()).toEqual(["true", "true", "false", "false", "true"]); // (what a friend may see is on by default; telling what is watched is not)
    await page.getByTestId("friends-give").click();
    await page.getByTestId("friends-lists").click();
    expect(await states()).toEqual(["false", "true", "true", "false", "true"]);

    // the server keeps them (it decides what a friend is shown from them)
    const profile = await page.evaluate(() => localStorage.getItem("kino.profile"));
    await expect
      .poll(async () => {
        const answer = (await (await page.request.post(`/api/profiles/${profile}/sync`, { data: { since: 0 } })).json()) as { settings: Array<{ key: string; value?: unknown }> };
        return Object.fromEntries(answer.settings.map((item) => [item.key, item.value]));
      })
      .toMatchObject({ friends: true, friendsGive: true, friendsLists: false });

    await page.getByTestId("friends-switch").click(); // off again: the rest goes away
    await expect(page.getByTestId("friends-lists")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("menu-friends")).toHaveCount(0);
  });

  test("a phone that is not signed in is told friends belong to an account", async ({ browser }) => {
    const page = await newPhone(browser);
    await page.goto("/");
    await page.getByTestId("account-button").click();
    await page.getByTestId("menu-settings").click();
    await expect(page.getByTestId("friends-sign-in")).toBeVisible();
    await expect(page.getByTestId("friends-switch")).toHaveCount(0);
  });
});

test.describe("making friends", () => {
  test("a code one profile gives and another types makes them friends, on both sides; either can take the other off", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");

    await openFriends(ann.page);
    await expect(ann.page.getByTestId("friends-none")).toBeVisible();
    await ann.page.getByTestId("friend-make-code").click();
    const card = ann.page.getByTestId("friend-invite");
    await expect(card).toBeVisible();
    const code = (await ann.page.getByTestId("friend-invite-code").textContent())!;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    await expect(ann.page.getByTestId("friend-link-url")).toHaveText(new RegExp(`/\\?friend=${code.replace("-", "")}$`)); // (what a message holds, and the QR code too)

    await openFriends(bob.page);
    await bob.page.getByTestId("friend-code-input").fill(code.toLowerCase().replace("-", "")); // typed as it was read
    await expect(bob.page.getByTestId("friend-code-name")).toHaveText(ann.name); // who it is from, before it is used
    await bob.page.getByTestId("friend-code-add").click();
    await expect(bob.page.getByTestId("account-toast")).toContainText(`You and ${ann.name} are now friends`);
    await expect(bob.page.getByTestId("friend-row")).toHaveCount(1);
    await expect(bob.page.getByTestId("friend-row")).toContainText(ann.name);

    await look(ann.page); // (Ann's page would hear within the half minute)
    await expect(ann.page.getByTestId("friend-row")).toContainText(bob.name);
    await expect(ann.page.getByTestId("friend-invite")).toHaveCount(0); // the code is spent

    // a spent code is no use again
    await bob.page.getByTestId("friend-code-input").fill(code);
    await expect(bob.page.getByTestId("friend-code-error")).toBeVisible();

    // Ann takes Bob off: it needs a second press, and then neither has the other
    await ann.page.getByTestId("friend-row").click();
    await expect(ann.page.getByTestId("friend-name")).toHaveText(bob.name);
    await ann.page.getByTestId("friend-remove").click();
    await expect(ann.page.getByTestId("friend-remove")).toHaveAttribute("data-asking", "true");
    await ann.page.getByTestId("friend-remove").click();
    await expect(ann.page.getByTestId("friends-none")).toBeVisible();
    await look(bob.page);
    await expect(bob.page.getByTestId("friends-none")).toBeVisible();
  });

  test("a friend's link asks 'add them?' when the phone is signed in with friends on, and the code is used once", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await openFriends(ann.page);
    await ann.page.getByTestId("friend-make-code").click();
    const code = (await ann.page.getByTestId("friend-invite-code").textContent())!.replace("-", "");

    await bob.page.keyboard.press("Escape");
    await bob.page.goto(`/?friend=${code}`);
    await expect(bob.page.getByTestId("friend-link-sheet")).toBeVisible();
    expect(bob.page.url()).not.toContain("friend="); // (it is for one use: a reload does not offer it again)
    await expect(bob.page.getByTestId("friend-code-name")).toHaveText(ann.name);
    await bob.page.getByTestId("friend-code-add").click();
    await expect(bob.page.getByTestId("account-toast")).toContainText(ann.name);
    await expect(bob.page.getByTestId("friend-link-sheet")).toHaveCount(0);

    // the same link on a third phone: the code has been used
    const cy = await phoneWithFriends(browser, "Cy");
    await cy.page.goto(`/?friend=${code}`);
    await expect(cy.page.getByTestId("friend-code-error")).toBeVisible();
  });

  test("a phone that is signed out is asked to sign in, and one with friends off to turn them on, before the code is looked up", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    await openFriends(ann.page);
    await ann.page.getByTestId("friend-make-code").click();
    const code = (await ann.page.getByTestId("friend-invite-code").textContent())!.replace("-", "");

    const dee = await newPhone(browser);
    await dee.goto(`/?friend=${code}`);
    await expect(dee.getByTestId("friend-link-sheet")).toBeVisible();
    await expect(dee.getByTestId("friend-code-card")).toHaveCount(0); // (nobody is told who it is from before they are signed in)
    await dee.getByTestId("friend-link-signin").click();
    await dee.getByTestId("auth-switch").click();
    const account = fresh("Dee");
    await dee.getByTestId("auth-email").fill(account.email);
    await dee.getByTestId("auth-password").fill(account.password);
    await dee.getByTestId("auth-submit").click();
    await expect(dee.getByTestId("account-card")).toBeVisible();
    await dee.getByTestId("page-back").click(); // the account page closes, and the question is back
    await expect(dee.getByTestId("friend-link-turn-on")).toBeVisible(); // friends are off for the new profile
    await dee.getByTestId("friend-link-turn-on").click();
    await expect(dee.getByTestId("friend-code-name")).toHaveText(ann.name);
    await dee.getByTestId("friend-code-add").click();
    await expect(dee.getByTestId("friend-link-sheet")).toHaveCount(0);
    await dee.getByTestId("account-button").click();
    await openFriends(dee);
    await expect(dee.getByTestId("friend-row")).toContainText(ann.name);
  });

  test("an answer that comes late does not bring back what a newer one has already taken away", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await befriend(ann.page, bob.page);
    await openFriends(ann.page);
    await expect(ann.page.getByTestId("friend-row")).toHaveCount(1);

    // Ann's page looks, and the answer (Bob is a friend) is held up on the way
    let letGo!: () => void;
    const held = new Promise<void>((resolve) => (letGo = resolve));
    let holding!: () => void;
    const isHeld = new Promise<void>((resolve) => (holding = resolve));
    let delivered!: () => void;
    const isDelivered = new Promise<void>((resolve) => (delivered = resolve));
    let looks = 0;
    await ann.page.route("**/api/profiles/*/friends", async (route) => {
      if (route.request().method() !== "GET" || looks++ > 0) return route.continue();
      const answer = await route.fetch();
      holding();
      await held;
      await route.fulfill({ response: answer });
      delivered();
    });
    await look(ann.page);
    await isHeld;

    // Bob takes Ann off, and Ann's next look hears it
    await openFriends(bob.page);
    await bob.page.getByTestId("friend-row").click();
    await bob.page.getByTestId("friend-remove").click();
    await bob.page.getByTestId("friend-remove").click();
    await expect(bob.page.getByTestId("friends-none")).toBeVisible();
    await look(ann.page);
    await expect(ann.page.getByTestId("friends-none")).toBeVisible();

    // the old answer arrives at last, and the page does not go back to it
    letGo();
    await isDelivered;
    await ann.page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
    await expect(ann.page.getByTestId("friends-none")).toBeVisible();
    await expect(ann.page.getByTestId("friend-row")).toHaveCount(0);
  });
});

test.describe("what a friend can see", () => {
  test("their lists and their ratings are on their page, for as long as they share them", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await befriend(ann.page, bob.page);
    await seed(ann.page, filmCards());

    await bob.page.getByTestId("menu-friends").click();
    await bob.page.getByTestId("friend-row").click();
    await expect(bob.page.getByTestId("friend-name")).toHaveText(ann.name);
    await expect(bob.page.getByTestId("friend-list-card-item")).toContainText("Alpha Film"); // lists first
    await bob.page.getByTestId("friend-tab-ratings").click();
    const rating = bob.page.getByTestId("friend-rating");
    await expect(rating).toContainText("Alpha Film");
    await expect(rating).toContainText("8/10");
    await expect(rating).toContainText("Very good");
    await expect(rating).toContainText("Tight and clever");

    // Ann stops sharing her ratings, and then her lists: Bob is told so, not shown an empty page
    await ann.page.getByTestId("menu-settings").click();
    await ann.page.getByTestId("friends-ratings").click();
    await expect(ann.page.getByTestId("friends-ratings")).toHaveAttribute("aria-checked", "false");
    await bob.page.reload();
    await bob.page.getByTestId("account-button").click();
    await openFriends(bob.page);
    await bob.page.getByTestId("friend-row").click();
    await bob.page.getByTestId("friend-tab-ratings").click();
    await expect(bob.page.getByTestId("friend-not-sharing")).toContainText(`${ann.name} is not sharing their ratings`);
    await bob.page.getByTestId("friend-tab-lists").click();
    await expect(bob.page.getByTestId("friend-list-card-item")).toContainText("Alpha Film"); // (the lists are still shared)

    // and with friends turned off altogether she shows nothing, and says so in the list
    await ann.page.getByTestId("friends-switch").click();
    await bob.page.keyboard.press("Escape");
    await look(bob.page);
    await expect(bob.page.getByTestId("friend-row")).toContainText("Friends turned off");
    await bob.page.getByTestId("friend-row").click();
    await expect(bob.page.getByTestId("friend-off")).toBeVisible();
    await expect(bob.page.getByTestId("friend-not-sharing")).toBeVisible();
    await expect(bob.page.getByTestId("friend-list-card-item")).toHaveCount(0);
  });

  test("what a friend watches is told when one gives it and the other wants it, and not otherwise", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await befriend(ann.page, bob.page);
    await seed(ann.page, filmCards());
    const seen = async () => {
      await bob.page.getByTestId("menu-friends").click();
      await look(bob.page);
      await expect(bob.page.getByTestId("friends-page")).toBeVisible();
    };
    const setSwitch = async (page: Page, id: string, on: boolean) => {
      await page.getByTestId("menu-settings").click();
      const toggle = page.getByTestId(id);
      if ((await toggle.getAttribute("aria-checked")) !== String(on)) await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", String(on));
      await page.keyboard.press("Escape");
    };

    await seen();
    await expect(bob.page.getByTestId("friends-activity")).toHaveCount(0); // nobody gives, nobody gets
    await bob.page.keyboard.press("Escape");

    await setSwitch(ann.page, "friends-give", true); // she tells...
    await seen();
    await expect(bob.page.getByTestId("friends-activity")).toHaveCount(0); // ...but he has not asked to hear
    await bob.page.keyboard.press("Escape");

    await setSwitch(bob.page, "friends-get", true); // now he hears
    await seen();
    await expect(bob.page.getByTestId("friends-activity")).toContainText("Alpha Film");
    await expect(bob.page.getByTestId("friends-activity")).toContainText(ann.name);
    await expect(bob.page.getByTestId("friend-row")).toContainText("Watching Alpha Film"); // (just now, and not to the end: "watched" is for what was a while ago)
    await bob.page.keyboard.press("Escape");

    await setSwitch(ann.page, "friends-give", false); // she stops
    await seen();
    await expect(bob.page.getByTestId("friends-activity")).toHaveCount(0);
  });
});

test.describe("sending things to friends", () => {
  const films = (baseURL: string) => ({
    updatedAt: Date.now(),
    rows: [{ id: "r", title: "Classics", source: "Test Source", kind: "movie", items: [{ id: "a", title: "Alpha Film", year: 1931, kind: "movie", url: `${baseURL}/fixtures/sample.mp4?n=1` }] }],
  });

  /** A phone paired to a TV, showing a one-film library, signed up with friends on. */
  async function pairedPhone(browser: Browser, baseURL: string, name: string) {
    const account = fresh(name);
    const tv = await openTv(browser);
    const page = await openDevice(browser, { ...PHONE, locale: "en-US" }, {}, withLibrary(films(baseURL)));
    await page.goto("/");
    await page.getByTestId("code-input").fill(await readPairingCode(tv));
    await expect(page.getByTestId("tv-online")).toHaveClass(/\bok\b/);
    await signUp(page, account);
    await turnOnFriends(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("account-screen")).toHaveCount(0);
    return { page, tv, account, name: nameOf(account) };
  }

  /** Both phones are at their home screens: `giver` makes a code and `taker` types it, and they are back at home. */
  async function meet(giver: Page, taker: Page) {
    for (const page of [giver, taker]) await page.getByTestId("account-button").click();
    await befriend(giver, taker);
    for (const page of [giver, taker]) {
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("account-screen")).toHaveCount(0);
    }
  }

  test("a title is recommended with a few words, arrives in the other's inbox and on their home screen, and is dismissed with its cross", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const ann = await pairedPhone(browser, baseURL!, "Ann");
    const bob = await pairedPhone(browser, baseURL!, "Bob");
    await meet(bob.page, ann.page); // Bob gives a code on his page, Ann types it

    // before they are friends there would be nobody to pick; now Bob is on the list
    await ann.page.locator('[data-testid="library-tile"][title="Alpha Film"]').click();
    await ann.page.getByTestId("title-recommend").click();
    await expect(ann.page.getByTestId("friend-pick")).toHaveCount(1);
    await expect(ann.page.getByTestId("friend-send")).toBeEnabled(); // (the only friend is picked already)
    await ann.page.getByTestId("friend-note").fill("You will like the ending");
    await ann.page.getByTestId("friend-send").click();
    await expect(ann.page.getByTestId("account-toast")).toContainText(`Sent to ${bob.name}`);
    await expect(ann.page.getByTestId("friend-picker")).toHaveCount(0);

    // Bob: told in a line, a dot on his picture, a row on his home screen with the title
    await look(bob.page);
    await expect(bob.page.getByTestId("account-toast")).toContainText(`${ann.name} sent you Alpha Film`);
    await expect(bob.page.getByTestId("unread-dot")).toBeVisible();
    const row = bob.page.getByTestId("friends-row");
    await expect(row).toContainText("Alpha Film");
    await expect(row).toContainText(`From ${ann.name}`);
    await bob.page.getByTestId("friends-play").click(); // a tap opens the title's page, with the note
    await expect(bob.page.getByTestId("title-sheet")).toContainText("You will like the ending");
    await bob.page.getByTestId("sheet-close").click();

    // opening the Friends page is seeing it: the dot goes, the title is in the inbox
    await bob.page.getByTestId("account-button").click();
    await openFriends(bob.page);
    await expect(bob.page.getByTestId("inbox-recommendation")).toContainText("Alpha Film");
    await expect(bob.page.getByTestId("unread-dot")).toHaveCount(0);
    await bob.page.getByTestId("inbox-dismiss").click();
    await expect(bob.page.getByTestId("inbox-recommendation")).toHaveCount(0);
    await bob.page.keyboard.press("Escape");
    await bob.page.keyboard.press("Escape");
    await expect(bob.page.getByTestId("friends-row")).toHaveCount(0);
  });

  test("an invitation to a watch party carries its code and a button that joins; one that is not wanted is sent away", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const ann = await pairedPhone(browser, baseURL!, "Ann");
    const bob = await pairedPhone(browser, baseURL!, "Bob");
    await meet(bob.page, ann.page);

    await ann.page.getByTestId("menu").click();
    await ann.page.getByTestId("party-open").click();
    await expect(ann.page.getByTestId("party-join-code")).toBeVisible();
    const code = ((await ann.page.getByTestId("party-join-code").textContent()) ?? "").replace(/\D/g, "");
    expect(code).toHaveLength(6);
    await ann.page.getByTestId("party-invite-friends").click();
    await ann.page.getByTestId("friend-send").click();
    await expect(ann.page.getByTestId("account-toast")).toContainText(`Invited ${bob.name}`);

    await look(bob.page);
    const banner = bob.page.getByTestId("friend-party-banner");
    await expect(banner).toContainText(`${ann.name} invited you to a watch party`);
    await expect(bob.page.getByTestId("friend-party-join")).toHaveAttribute("href", new RegExp(`/\\?party=${code}$`));
    await bob.page.getByTestId("friend-party-dismiss").click();
    await expect(banner).toHaveCount(0);
  });

  test("a friend who is not taking things is told apart: they are not offered, and the page says why", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const ann = await pairedPhone(browser, baseURL!, "Ann");
    const bob = await pairedPhone(browser, baseURL!, "Bob");
    await meet(bob.page, ann.page);
    // Bob turns off "friends can send me titles and invitations"
    await bob.page.getByTestId("account-button").click();
    await bob.page.getByTestId("menu-settings").click();
    await bob.page.getByTestId("friends-inbox-switch").click();
    await expect(bob.page.getByTestId("friends-inbox-switch")).toHaveAttribute("aria-checked", "false");

    await ann.page.locator('[data-testid="library-tile"][title="Alpha Film"]').click();
    await look(ann.page);
    await ann.page.getByTestId("title-recommend").click();
    await expect(ann.page.getByTestId("friend-pick")).toHaveCount(0);
    await expect(ann.page.getByTestId("friend-picker-none")).toContainText("None of your friends is taking titles");
  });
});
