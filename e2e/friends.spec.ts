import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import { ro } from "../src/client/i18n/ro";
import { listKey, ratingKey } from "../src/shared";
import { openDevice, openTv, PHONE, readPairingCode, test, withLibrary } from "./helpers";

/**
 * Friends, on the phone: switched on in the settings, made with a code that one profile gives and another types (or a link), and then
 * what a friend may see, send and be told is what each has turned on. Every test makes its own accounts (the server keeps them in memory).
 */

test.use({ actionTimeout: 15_000 }); // (a wrong id fails in seconds, not when the test runs out of time)

let counter = 0;
/** A name short enough to be a profile's name as it is (a profile is named after the username, 16 letters at most). */
const fresh = (name: string) => ({ email: `${name}${++counter}x${Date.now().toString(36).slice(-4)}`, password: "kino-test-pass-1" }); // (a password that is not asked about)
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

/** A line of the words of a language with its blanks filled in: `{name}` and the like. */
const say = (text: string, params: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? "");

type Box = { x: number; y: number; width: number; height: number };
const where = async (target: { boundingBox(): Promise<Box | null> }) => (await target.boundingBox())!;
const apart = (a: Box, b: Box) => a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5;
const inside = (a: Box, around: Box) => a.x >= around.x - 0.5 && a.y >= around.y - 0.5 && a.x + a.width <= around.x + around.width + 0.5 && a.y + a.height <= around.y + around.height + 0.5;

/**
 * Whether the `parts` of a `card` keep clear of each other and inside it, the first of them (the words) is at least `room` wide, and the card is inside a screen `width`
 * wide: held until it is so (a page takes a moment to settle after a resize). When it is not, what was measured is in the failure.
 */
const keepClear = (card: Locator, parts: Locator[], width: number, room: number) =>
  expect
    .poll(
      async () => {
        const around = await where(card);
        const boxes = await Promise.all(parts.map(where));
        const fits =
          around.x >= 0 &&
          around.x + around.width <= width + 0.5 &&
          boxes[0]!.width >= room &&
          boxes.every((box, at) => inside(box, around) && boxes.slice(at + 1).every((other) => apart(box, other)));
        return fits ? "fits" : JSON.stringify({ around, boxes });
      },
      { message: `${width} wide` },
    )
    .toBe("fits");

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
    const ids = ["friends-lists", "friends-ratings", "friends-give", "friends-get", "friends-inbox-switch", "friends-presence"];
    const states = () => Promise.all(ids.map((id) => page.getByTestId(id).getAttribute("aria-checked")));
    expect(await states()).toEqual(["true", "true", "false", "false", "true", "true"]); // (what a friend may see is on by default, and that one is online; telling what is watched is not)
    await page.getByTestId("friends-give").click();
    await page.getByTestId("friends-lists").click();
    await page.getByTestId("friends-presence").click();
    expect(await states()).toEqual(["false", "true", "true", "false", "true", "false"]);

    // the server keeps them (it decides what a friend is shown from them)
    const profile = await page.evaluate(() => localStorage.getItem("kino.profile"));
    await expect
      .poll(async () => {
        const answer = (await (await page.request.post(`/api/profiles/${profile}/sync`, { data: { since: 0 } })).json()) as { settings: Array<{ key: string; value?: unknown }> };
        return Object.fromEntries(answer.settings.map((item) => [item.key, item.value]));
      })
      .toMatchObject({ friends: true, friendsGive: true, friendsLists: false, friendsPresence: false });

    await page.getByTestId("friends-switch").click(); // off again: the rest goes away
    await expect(page.getByTestId("friends-lists")).toHaveCount(0);
    await expect(page.getByTestId("kept-friends")).toHaveCount(0); // (no friends were made, so there is none to keep)
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("menu-friends")).toHaveCount(0);
  });

  test("turned off again, the friends are kept: the settings list them, and a friendship can be ended from there without turning anything back on", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await befriend(ann.page, bob.page);

    await ann.page.getByTestId("menu-settings").click();
    await expect(ann.page.getByTestId("kept-friends")).toHaveCount(0); // (while they are on, the page of friends is the place for them)
    await ann.page.getByTestId("friends-switch").click();
    await expect(ann.page.getByTestId("friends-lists")).toHaveCount(0);
    const kept = ann.page.getByTestId("kept-friend");
    await expect(kept).toHaveCount(1);
    await expect(kept).toContainText(bob.name);

    // it takes a second press, and then Bob is no longer a friend; friends stay off
    const remove = ann.page.getByTestId("kept-friend-remove");
    await remove.click();
    await expect(remove).toHaveAttribute("data-asking", "true");
    await remove.click();
    await expect(ann.page.getByTestId("account-toast")).toContainText(`${bob.name} is no longer your friend`);
    await expect(ann.page.getByTestId("kept-friends")).toHaveCount(0);
    await expect(ann.page.getByTestId("friends-switch")).toHaveAttribute("aria-checked", "false");

    await openFriends(bob.page);
    await look(bob.page);
    await expect(bob.page.getByTestId("friends-none")).toBeVisible();
  });

  test("a look at the kept friends that failed is tried again, so that they can still be removed once the connection is back", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await befriend(ann.page, bob.page);

    let asked = 0;
    await ann.page.route("**/friends/kept", (route) => (++asked === 1 ? route.abort("connectionfailed") : route.continue()));
    await ann.page.getByTestId("menu-settings").click();
    await ann.page.getByTestId("friends-switch").click();
    const kept = ann.page.getByTestId("kept-friend");
    await expect(kept).toHaveCount(1, { timeout: 30_000 });
    await expect(kept).toContainText(bob.name);
    expect(asked).toBeGreaterThan(1);
  });

  test("when ratings are turned off, the switch that shares them with friends goes, and friends are shown none until they are back on", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await befriend(ann.page, bob.page);
    await seed(ann.page, filmCards());
    await bob.page.getByTestId("menu-friends").click();
    await bob.page.getByTestId("friend-row").click();
    await bob.page.getByTestId("friend-tab-ratings").click();
    await expect(bob.page.getByTestId("friend-rating")).toContainText("Alpha Film");

    await ann.page.getByTestId("menu-settings").click();
    await expect(ann.page.getByTestId("friends-ratings")).toBeVisible();
    await ann.page.getByTestId("ratings-switch").click();
    await expect(ann.page.getByTestId("friends-ratings")).toHaveCount(0);
    await expect(async () => {
      await look(bob.page);
      await expect(bob.page.getByTestId("friend-not-sharing")).toContainText(`${ann.name} is not sharing their ratings`, { timeout: 1500 });
    }).toPass();

    await ann.page.getByTestId("ratings-switch").click();
    await expect(ann.page.getByTestId("friends-ratings")).toHaveAttribute("aria-checked", "true"); // (as it was)
    await expect(async () => {
      await look(bob.page);
      await expect(bob.page.getByTestId("friend-rating")).toContainText("Alpha Film", { timeout: 1500 });
    }).toPass();
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

    // Ann takes Bob off: Remove opens a sheet that asks, and only "Yes, remove" does it; then neither has the other
    await ann.page.getByTestId("friend-row").click();
    await expect(ann.page.getByTestId("friend-name")).toHaveText(bob.name);
    await ann.page.getByTestId("friend-remove").click();
    await expect(ann.page.getByTestId("friend-unfriend")).toContainText(`Remove ${bob.name}?`);
    await ann.page.getByTestId("friend-unfriend-cancel").click();
    await expect(ann.page.getByTestId("friend-unfriend")).toHaveCount(0);
    await ann.page.getByTestId("friend-remove").click();
    await ann.page.getByTestId("friend-unfriend-yes").click();
    await expect(ann.page.getByTestId("friends-none")).toBeVisible();
    await look(bob.page);
    await expect(bob.page.getByTestId("friends-none")).toBeVisible();
  });

  test("the code that is given has a small button that copies it, and what it copies is what a friend types", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await ann.page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const clipboard = () => ann.page.evaluate(() => navigator.clipboard.readText());

    await openFriends(ann.page);
    await ann.page.getByTestId("friend-make-code").click();
    const code = (await ann.page.getByTestId("friend-invite-code").textContent())!;
    const copy = ann.page.getByTestId("friend-invite-code-copy");
    await expect(copy).toHaveText("Copy code");
    await ann.page.evaluate(() => navigator.clipboard.writeText("something else"));
    await copy.click();
    await expect(copy).toHaveText("Code copied");
    expect(await clipboard()).toBe(code);
    await expect(copy).toHaveText("Copy code"); // (ready for the next time by itself)

    // a press on the code itself selects the whole of it, the dash too (a long press would take one half of it, the dash being a word's end)
    await ann.page.getByTestId("friend-invite-code").click();
    expect(await ann.page.evaluate(() => window.getSelection()?.toString())).toBe(code);

    // the link under it still copies the link, and not the code
    const copyLink = ann.page.getByTestId("friend-link-copy");
    await copyLink.click();
    await expect(copyLink).toHaveText("Link copied");
    expect(await clipboard()).toBe(await ann.page.getByTestId("friend-link-url").innerText());

    // what the code's button put on the clipboard is what a friend pastes into the field
    await copy.click();
    await expect(copy).toHaveText("Code copied");
    await openFriends(bob.page);
    await bob.page.getByTestId("friend-code-input").fill(await clipboard());
    await expect(bob.page.getByTestId("friend-code-name")).toHaveText(ann.name);
  });

  test("a phone that will not copy says so and selects the code, to be copied by hand", async ({ browser }) => {
    test.setTimeout(90_000);
    const account = fresh("Ann");
    const page = await newPhone(browser);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }); // no clipboard of its own...
      document.execCommand = () => false; // ...and the old way refused
    });
    await page.goto("/");
    await signUp(page, account);
    await turnOnFriends(page);
    await openFriends(page);
    await page.getByTestId("friend-make-code").click();
    const code = (await page.getByTestId("friend-invite-code").textContent())!;
    await page.getByTestId("friend-invite-code-copy").click();
    await expect(page.getByTestId("friend-invite").getByRole("status")).toHaveText("Could not copy: select the code and copy it");
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(code); // (the whole of it, the dash too: ready for a long press)
  });

  test("the button sits under the code, and the code, the button and the QR code keep clear of each other and inside the card, on the narrowest phone as on any", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    await openFriends(ann.page);
    await ann.page.getByTestId("friend-make-code").click();
    const card = ann.page.getByTestId("friend-invite");
    await expect(card).toBeVisible();
    for (const width of [320, 360, 375, 390, 430]) {
      await ann.page.setViewportSize({ width, height: 800 });
      await expect
        .poll(
          async () => {
            const [around, code, copy, qr] = await Promise.all([
              where(card),
              where(ann.page.getByTestId("friend-invite-code")),
              where(ann.page.getByTestId("friend-invite-code-copy")),
              where(card.getByTestId("pairing-qr")),
            ]);
            return (
              copy.y >= code.y + code.height - 0.5 && // under the code
              copy.height <= 44 && // (a small button: its icon is not the size of the QR code's)
              apart(code, qr) && // (the QR code is beside them, or under them where there is no room: never over them)
              apart(copy, qr) &&
              [code, copy, qr].every((box) => inside(box, around)) &&
              around.x >= 0 &&
              around.x + around.width <= width + 0.5 // (and the card is inside the screen)
            );
          },
          { message: `${width} wide` },
        )
        .toBe(true);
    }
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
    await expect.poll(() => bob.page.url()).not.toContain("friend="); // (nor does going back to where the page began bring it back)

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
    await bob.page.getByTestId("friend-unfriend-yes").click();
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
    await expect(bob.page.getByTestId("activity-item").locator(".lib-progress i")).toHaveAttribute("style", /width: 11%/); // (600 of 5400 seconds)
    // ...and on her page, how far she got in the titles she keeps and rates
    await bob.page.getByTestId("friend-row").click();
    await expect(bob.page.getByTestId("friend-list-card-item")).toContainText("11%");
    await bob.page.getByTestId("friend-tab-ratings").click();
    await expect(bob.page.getByTestId("friend-rating-progress")).toContainText("11%");
    await bob.page.keyboard.press("Escape"); // (back to the page of friends)
    await bob.page.keyboard.press("Escape");

    await setSwitch(ann.page, "friends-give", false); // she stops
    await seen();
    await expect(bob.page.getByTestId("friends-activity")).toHaveCount(0);
  });

  test("who is online: a friend with the page open has a green dot and 'Online', and one who turned that switch off has neither", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await befriend(ann.page, bob.page);
    await look(ann.page); // (a page that is open tells the server so each time it looks)
    await bob.page.getByTestId("menu-friends").click();
    const row = bob.page.getByTestId("friend-row");
    await expect(async () => {
      await look(bob.page);
      await expect(row).toContainText("Online", { timeout: 1500 });
    }).toPass();
    await expect(row.locator(".friend-pic")).toHaveAttribute("data-online", "true");
    await row.click();
    await expect(bob.page.getByTestId("friend-page")).toContainText("Online");
    await bob.page.keyboard.press("Escape");

    // Ann turns the switch off: Bob does not see her online any more
    await ann.page.getByTestId("menu-settings").click();
    await ann.page.getByTestId("friends-presence").click();
    await expect(ann.page.getByTestId("friends-presence")).toHaveAttribute("aria-checked", "false");
    await expect(async () => {
      await look(bob.page);
      await expect(row.locator(".friend-pic")).toHaveAttribute("data-online", "false", { timeout: 1500 });
    }).toPass();
    await expect(row).not.toContainText("Online");
  });
});

test.describe("sending things to friends", () => {
  const films = (baseURL: string) => ({
    updatedAt: Date.now(),
    rows: [{ id: "r", title: "Classics", source: "Test Source", kind: "movie", items: [{ id: "a", title: "Alpha Film", year: 1931, kind: "movie", url: `${baseURL}/fixtures/sample.mp4?n=1` }] }],
  });

  /** A phone paired to a TV, showing a one-film library, signed up with friends on (in English, unless its language is given). */
  async function pairedPhone(browser: Browser, baseURL: string, name: string, locale = "en-US") {
    const account = fresh(name);
    const tv = await openTv(browser);
    const page = await openDevice(browser, { ...PHONE, locale }, {}, withLibrary(films(baseURL)));
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
    await bob.page.getByTestId("rate-title-toggle").click(); // (Bob rates it: the score is on its card in the row, as it is on every card)
    await bob.page.getByTestId("rate-title-score-7").click();
    await bob.page.getByTestId("sheet-close").click();
    await expect(row.getByTestId("score-badge")).toHaveText("7");

    // opening the Friends page is seeing it: the dot goes, the title is in the inbox
    await bob.page.getByTestId("account-button").click();
    await openFriends(bob.page);
    await expect(bob.page.getByTestId("inbox-recommendation")).toContainText("Alpha Film");
    await expect(bob.page.getByTestId("unread-dot")).toHaveCount(0);
    // (a title opened from the inbox is a sheet over the page: Escape closes the sheet, and the page stays)
    await bob.page.getByTestId("inbox-open").click();
    await expect(bob.page.getByTestId("title-sheet")).toBeVisible();
    await bob.page.keyboard.press("Escape");
    await expect(bob.page.getByTestId("title-sheet")).toHaveCount(0);
    await expect(bob.page.getByTestId("friends-page")).toBeVisible();
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

  /** A switch of the settings, from the home screen: the account page is opened, the switch put right, and the phone is back at the home screen. */
  async function setting(page: Page, id: string, on: boolean) {
    await page.getByTestId("account-button").click();
    await page.getByTestId("menu-settings").click();
    const toggle = page.getByTestId(id);
    if ((await toggle.getAttribute("aria-checked")) !== String(on)) await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", String(on));
    for (let back = 0; back < 2; back++) await page.keyboard.press("Escape");
    await expect(page.getByTestId("account-screen")).toHaveCount(0);
  }

  test("a friend who tells what they watch can be asked to watch together; the one asked has a button that starts a party and invites the one who asked, and it fits the narrowest phone in Romanian", async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const ann = await pairedPhone(browser, baseURL!, "Ann", "ro-RO"); // (the longest words)
    const bob = await pairedPhone(browser, baseURL!, "Bob");
    await meet(bob.page, ann.page);
    await setting(ann.page, "friends-give", true); // she tells what she watches and he hears it: that is what lets him ask
    await setting(bob.page, "friends-get", true);

    // Bob asks, from her page (which is looked at again until the server's word on the two switches has reached him)
    await bob.page.getByTestId("account-button").click();
    await openFriends(bob.page);
    await bob.page.getByTestId("friend-row").click();
    await expect(async () => {
      await look(bob.page);
      await expect(bob.page.getByTestId("friend-together")).toBeVisible({ timeout: 1500 });
    }).toPass();
    await bob.page.getByTestId("friend-together").click();
    await expect(bob.page.getByTestId("account-toast")).toContainText(`Asked ${ann.name} to watch together`);
    for (let back = 0; back < 3; back++) await bob.page.keyboard.press("Escape"); // (the friend's page, the friends, the account page)
    await expect(bob.page.getByTestId("account-screen")).toHaveCount(0);

    // Ann has it as a banner on her home screen and a row on her page of friends; each keeps its words and its buttons inside it, on any phone
    await look(ann.page);
    const asks = say(ro["friends.togetherOf"], { name: bob.name });
    const banner = ann.page.getByTestId("friend-together-banner");
    const start = ann.page.getByTestId("friend-together-start");
    await expect(banner).toContainText(asks);
    for (const width of [320, 360, 390]) {
      await ann.page.setViewportSize({ width, height: 800 });
      await keepClear(banner, [banner.locator("span").first(), start, ann.page.getByTestId("friend-together-dismiss")], width, 150);
    }
    await ann.page.getByTestId("account-button").click();
    await openFriends(ann.page);
    const row = ann.page.getByTestId("inbox-together");
    await expect(row).toContainText(asks);
    for (const width of [320, 360, 390]) {
      await ann.page.setViewportSize({ width, height: 800 });
      await keepClear(row, [row.locator(".inbox-text"), row.getByTestId("inbox-start"), row.getByTestId("inbox-dismiss")], width, 150);
    }
    for (let back = 0; back < 2; back++) await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("account-screen")).toHaveCount(0);

    // Her button opens the party of her TV and invites Bob to it; the request is gone from her page, and Bob has the invitation
    await start.click();
    await expect(ann.page.getByTestId("party-sheet")).toBeVisible();
    await expect(ann.page.getByTestId("party-join-code")).toBeVisible();
    await expect(ann.page.getByTestId("account-toast")).toContainText(say(ro["friends.inviteSent"], { names: bob.name }));
    await expect(banner).toHaveCount(0);
    await look(bob.page);
    await expect(bob.page.getByTestId("friend-party-banner")).toContainText(`${ann.name} invited you to a watch party`);
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
