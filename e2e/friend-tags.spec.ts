import { expect, type Browser, type Page } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { it as italian } from "../src/client/i18n/it";
import { ro } from "../src/client/i18n/ro";
import { openDevice, openLibrary, openProfilePlace, openTvSignIn, PHONE, place, readPairingCode, test } from "./helpers";

/**
 * Tags and requests: every profile has a tag (`Name#1`) that another types to find it, and finding it only asks: the other says yes (or no).
 * A watch party shows the profile each screen is signed in as, with a short button that asks it too. Each test makes its own accounts and screens.
 */

test.use({ actionTimeout: 15_000 }); // (a wrong id fails in seconds, not when the test runs out of time)

let counter = 0;
/** A name short enough to be a profile's name as it is (a profile is named after the username, 16 letters at most). */
const fresh = (name: string) => ({ email: `${name}${++counter}x${Date.now().toString(36).slice(-4)}`, password: "kino-test-pass-1" }); // (a password that is not asked about)
type Account = ReturnType<typeof fresh>;
const nameOf = (account: Account) => account.email.charAt(0).toUpperCase() + account.email.slice(1);
/** The tag the first profile of a name has (the names here are made new for every test). */
const tagOf = (name: string) => `${name}#1`;

/** A line of the words of a language with its blanks filled in: `{name}` and the like. */
const say = (text: string, params: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? "");

/** The page looks at its friends now, as it does when it comes back to the front (and every half minute). */
const look = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

const WORDS = { en, ro, it: italian };
type Language = keyof typeof WORDS;

/* ------------------------------ a phone ------------------------------ */

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

async function openFriends(page: Page) {
  await page.getByTestId("menu-friends").click();
  await expect(page.getByTestId("friends-page")).toBeVisible();
}

/** A new phone, signed up, with friends on: left on the account page. */
async function phoneWithFriends(browser: Browser, name: string) {
  const account = fresh(name);
  const page = await openDevice(browser, { ...PHONE, locale: "en-US" });
  await page.goto("/");
  await signUp(page, account);
  await turnOnFriends(page);
  return { page, name: nameOf(account) };
}

/* ------------------------------ a TV ------------------------------ */

const HD = { width: 1280, height: 720 };

interface Screen {
  page: Page;
  name: string;
}

/** A new screen, signed up with the email form and with friends on, left on the profile's page. */
async function screenWithFriends(browser: Browser, name: string, options: { viewport?: { width: number; height: number }; language?: Language } = {}): Promise<Screen> {
  const account = fresh(name);
  const page = await openLibrary(browser, undefined, options.viewport ?? HD, options.language ? { "kino.lang": options.language } : {});
  await openTvSignIn(page);
  await page.getByTestId("tv-signin-email").click();
  await page.getByTestId("auth-switch").click();
  await expect(page.getByTestId("auth-form")).toHaveAttribute("data-mode", "signUp");
  await page.getByTestId("auth-email").fill(account.email);
  await page.getByTestId("auth-password").fill(account.password);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("tv-account-chip")).toContainText(nameOf(account));
  await openProfilePlace(page, "settings");
  await page.getByTestId("tv-friends-switch").click();
  await expect(page.getByTestId("tv-friends-switch")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("tv-account-back").click();
  await expect(page.locator('[data-entry="profile:friends"]')).toBeVisible(); // (back on the profile's page, which has its friends now)
  return { page, name: nameOf(account) };
}

/** A tile of the current page, by its title. */
const tile = (page: Page, title: string) => page.locator(`.tv-tile[title="${title}"]`);

async function openFriendsPage(page: Page) {
  await openProfilePlace(page, "friends");
  await expect(page.getByTestId("tv-browse")).toHaveAttribute("data-view", "friends");
}

const codeOf = async (host: Page) => (await host.getByTestId("tv-party-code").innerText()).replace(/\s/g, "");

/** The menu's Watch party, then Start: the party's page, with its code. */
async function startParty(host: Page): Promise<string> {
  await host.getByTestId("rail-party").click();
  await host.getByTestId("tv-party-start").click();
  return codeOf(host);
}

/** The remote of a screen that is not in a party yet: Watch party in the menu, then Join, then the digits. */
async function joinWith(guest: Page, code: string) {
  await guest.getByTestId("rail-party").click();
  await guest.getByTestId("tv-party-join").click();
  await guest.keyboard.type(code);
  await expect(guest.getByTestId("tv-following")).toBeVisible();
}

/**
 * What of the rows under `rows` is out of place: a part (`parts`) that leaves its row, two that cover each other, a row that leaves the
 * screen's sides. The row may be taller than a line (the buttons go under the words where they do not fit beside them).
 */
const rowProblems = (page: Page, rows: string, parts: string) =>
  page.evaluate(
    ([rowSelector, partSelector]) => {
      const problems: string[] = [];
      const found = document.querySelectorAll(rowSelector);
      if (found.length === 0) problems.push(`(no ${rowSelector} on the page)`);
      found.forEach((row, index) => {
        const around = row.getBoundingClientRect();
        if (around.left < -0.5 || around.right > innerWidth + 0.5) problems.push(`row ${index} leaves the screen`);
        const boxes = [...row.querySelectorAll(partSelector)]
          .map((part) => ({ name: (part.getAttribute("data-testid") ?? part.textContent ?? "").trim().slice(0, 20), box: part.getBoundingClientRect() }))
          .filter(({ box }) => box.width > 0 && box.height > 0);
        boxes.forEach(({ name, box }, at) => {
          if (box.left < around.left - 0.5 || box.right > around.right + 0.5 || box.top < around.top - 0.5 || box.bottom > around.bottom + 0.5) problems.push(`${name} of row ${index} leaves the row`);
          for (const other of boxes.slice(at + 1)) {
            const covers = box.left < other.box.right - 0.5 && other.box.left < box.right - 0.5 && box.top < other.box.bottom - 0.5 && other.box.top < box.bottom - 0.5;
            if (covers) problems.push(`${name} and ${other.name} of row ${index} cover each other`);
          }
        });
      });
      return problems;
    },
    [rows, parts] as const,
  );

/* ------------------------------ on a phone ------------------------------ */

test.describe("finding a friend by tag on the phone", () => {
  test("the tag finds a profile whatever the capitals, only asks, and a no leaves nothing; a yes makes friends", async ({ browser }) => {
    test.setTimeout(120_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await openFriends(ann.page);
    await openFriends(bob.page);
    const [annTag, bobTag] = [tagOf(ann.name), tagOf(bob.name)];
    await expect(ann.page.getByTestId("friend-your-tag-text")).toHaveText(annTag); // (the page says what to give: the tag, and a button that copies it)
    await expect(ann.page.getByTestId("friend-your-tag-copy")).toBeVisible();

    // Nothing is looked for while it is typed, and Find is for a tag only (a name alone, or nothing, is no tag).
    const typed = bob.page.getByTestId("friend-tag-input");
    const find = bob.page.getByTestId("friend-tag-find");
    await expect(find).toBeDisabled();
    await typed.fill("Nobody");
    await expect(find).toBeDisabled();
    await typed.fill("Nobody#9");
    await expect(bob.page.getByTestId("friend-tag-card")).toHaveCount(0);
    await find.click();
    await expect(bob.page.getByTestId("friend-tag-error")).toHaveText(en["error.tag_gone"]);
    await ann.page.getByTestId("friend-tag-input").fill(annTag); // one's own tag is no use to find
    await ann.page.getByTestId("friend-tag-find").click();
    await expect(ann.page.getByTestId("friend-tag-error")).toHaveText(en["error.own_request"]);

    // Found (as typed in small letters), asked: the form is clear again and Bob is told in a line. Ann is not a friend yet.
    await typed.fill(annTag.toLowerCase());
    await find.click();
    await expect(bob.page.getByTestId("friend-tag-name")).toHaveText(annTag);
    await bob.page.getByTestId("friend-tag-send").click();
    await expect(bob.page.getByTestId("account-toast")).toHaveText(say(en["friends.requestSent"], { name: annTag }));
    await expect(typed).toHaveValue("");
    await expect(bob.page.getByTestId("friend-tag-card")).toHaveCount(0);
    await expect(bob.page.getByTestId("friend-row")).toHaveCount(0);

    // Ann: a dot on her picture before she looks, a line, a request with Bob's tag; a no, and nobody is made her friend.
    await look(ann.page);
    await expect(ann.page.getByTestId("account-toast")).toHaveText(say(en["friends.news.request"], { name: bobTag }));
    await expect(ann.page.getByTestId("friend-request")).toHaveCount(1);
    await expect(ann.page.getByTestId("friend-request-name")).toHaveText(bobTag);
    await ann.page.getByTestId("friend-request-decline").click();
    await expect(ann.page.getByTestId("friend-request")).toHaveCount(0);
    await expect(ann.page.getByTestId("friend-row")).toHaveCount(0);

    // Bob may ask again; this time it is a yes: friends on both sides, and the request is gone.
    await look(bob.page);
    await typed.fill(annTag);
    await find.click();
    await bob.page.getByTestId("friend-tag-send").click();
    await look(ann.page);
    await expect(ann.page.getByTestId("friend-request")).toHaveCount(1);
    await ann.page.getByTestId("friend-request-accept").click();
    await expect(ann.page.getByTestId("account-toast")).toHaveText(say(en["friends.added"], { name: bob.name }));
    await expect(ann.page.getByTestId("friend-row")).toHaveCount(1);
    await expect(ann.page.getByTestId("friend-request")).toHaveCount(0);
    await look(bob.page);
    await expect(bob.page.getByTestId("friend-row")).toHaveCount(1);
  });

  test("two profiles that ask each other are friends at once, with no one to say yes", async ({ browser }) => {
    test.setTimeout(120_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await openFriends(ann.page);
    await openFriends(bob.page);
    await bob.page.getByTestId("friend-tag-input").fill(tagOf(ann.name));
    await bob.page.getByTestId("friend-tag-find").click();
    await bob.page.getByTestId("friend-tag-send").click();
    await expect(bob.page.getByTestId("account-toast")).toHaveText(say(en["friends.requestSent"], { name: tagOf(ann.name) }));

    // (Ann has not looked yet: she types Bob's tag, and the answer is that they are friends)
    await ann.page.getByTestId("friend-tag-input").fill(tagOf(bob.name));
    await ann.page.getByTestId("friend-tag-find").click();
    await ann.page.getByTestId("friend-tag-send").click();
    await expect(ann.page.getByTestId("account-toast")).toHaveText(say(en["friends.added"], { name: bob.name }));
    await expect(ann.page.getByTestId("friend-row")).toHaveCount(1);
    await expect(ann.page.getByTestId("friend-request")).toHaveCount(0);
    await look(bob.page);
    await expect(bob.page.getByTestId("friend-row")).toHaveCount(1);
  });
});

/* ------------------------------ on a TV ------------------------------ */

test.describe("finding a friend by tag on the TV", () => {
  test("a tag is typed and asks; the request is a tile on the other's page that OK opens, Back leaves waiting, and Accept makes friends", async ({ browser }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    const [annTag, bobTag] = [tagOf(ann.name), tagOf(bob.name)];

    await openFriendsPage(ann.page);
    await tile(ann.page, en["friends.add"]).click();
    await expect(ann.page.getByTestId("tv-your-tag").locator("b")).toHaveText(annTag); // (the question says what to give: the tag)
    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("tv-add-friend")).toHaveCount(0);

    await openFriendsPage(bob.page);
    await tile(bob.page, en["friends.add"]).click();
    await bob.page.getByTestId("tv-friend-tag").click();
    await expect(bob.page.getByTestId("tv-friend-tag-find")).toBeDisabled(); // (nothing typed)
    await bob.page.getByTestId("tv-friend-tag-input").fill(annTag.toLowerCase());
    await bob.page.getByTestId("tv-friend-tag-find").click();
    await expect(bob.page.getByTestId("tv-friend-tag-name")).toHaveText(annTag);
    await bob.page.getByTestId("tv-friend-tag-send").click();
    await expect(bob.page.getByTestId("tv-friend-tag-page")).toHaveCount(0); // (asked: the pages are shut)
    await expect(bob.page.getByTestId("tv-add-friend")).toHaveCount(0);
    await expect(bob.page.getByTestId("tv-account-toast")).toHaveText(say(en["friends.requestSent"], { name: annTag }));

    // Ann: a line, and a tile for the request in a row of its own above the friends. Back from it leaves it waiting.
    await look(ann.page);
    await expect(ann.page.getByTestId("tv-account-toast")).toHaveText(say(en["friends.news.request"], { name: bobTag }));
    await expect(tile(ann.page, bobTag)).toBeVisible();
    await tile(ann.page, bobTag).focus();
    await expect(ann.page.getByTestId("tv-hero-title")).toHaveText(bobTag);
    await expect(ann.page.getByTestId("tv-hero-play")).toHaveCount(0); // (the banner has nothing to play or keep for somebody who asks)
    await expect(ann.page.getByTestId("tv-hero-list")).toHaveCount(0);
    await tile(ann.page, bobTag).click();
    await expect(ann.page.getByTestId("tv-friend-request-name")).toHaveText(bobTag);
    await expect(ann.page.getByTestId("tv-friend-request-accept")).toBeFocused(); // (where the remote starts: OK says yes)
    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("tv-friend-request")).toHaveCount(0);
    await expect(tile(ann.page, bobTag)).toBeVisible();
    await expect(tile(ann.page, bob.name)).toHaveCount(0);

    await tile(ann.page, bobTag).click();
    await ann.page.keyboard.press("Enter");
    await expect(ann.page.getByTestId("tv-friend-request")).toHaveCount(0);
    await expect(tile(ann.page, bob.name)).toBeVisible();
    await expect(tile(ann.page, bobTag)).toHaveCount(0);
    await look(bob.page);
    await expect(tile(bob.page, ann.name)).toBeVisible();
  });

  test("Decline puts a request away and nobody is a friend of whoever asked", async ({ browser }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await openFriendsPage(bob.page);
    await tile(bob.page, en["friends.add"]).click();
    await bob.page.getByTestId("tv-friend-tag").click();
    await bob.page.getByTestId("tv-friend-tag-input").fill(tagOf(ann.name));
    await bob.page.getByTestId("tv-friend-tag-find").click();
    await bob.page.getByTestId("tv-friend-tag-send").click();
    await expect(bob.page.getByTestId("tv-add-friend")).toHaveCount(0);

    await look(ann.page);
    await openFriendsPage(ann.page);
    await tile(ann.page, tagOf(bob.name)).click();
    await ann.page.getByTestId("tv-friend-request-decline").click();
    await expect(ann.page.getByTestId("tv-friend-request")).toHaveCount(0);
    await expect(tile(ann.page, tagOf(bob.name))).toHaveCount(0);
    await expect(tile(ann.page, bob.name)).toHaveCount(0);
    await look(bob.page);
    await expect(tile(bob.page, ann.name)).toHaveCount(0);
  });
});

/* ------------------------------ in a watch party ------------------------------ */

test.describe("asking the profile on a screen of a watch party", () => {
  test("a screen signed in as a profile gets a short Add button; Requested waits for the answer, and asking back is friends at once", async ({ browser }) => {
    test.setTimeout(150_000);
    const host = await screenWithFriends(browser, "Hal");
    const guest = await screenWithFriends(browser, "Gus");
    const code = await startParty(host.page);
    await joinWith(guest.page, code);
    const bystander = await openLibrary(browser, undefined, HD); // a screen nobody is signed in on
    await joinWith(bystander, code);

    // The host's list: three screens, and a button for the one that is a profile (not for itself, not for the screen nobody is on).
    await expect(host.page.getByTestId("tv-party-member")).toHaveCount(3);
    const add = host.page.getByTestId("tv-party-add");
    await expect(add).toHaveCount(1);
    await expect(add).toHaveText(en["friends.partyAdd"]);
    await expect(add).toHaveAttribute("aria-label", say(en["friends.partyAddAria"], { name: tagOf(guest.name) }));
    expect(await rowProblems(host.page, '[data-testid="tv-party-member"]', ".tv-party-dot, .tv-party-name, small, .tv-party-actions button")).toEqual([]);
    await add.click();
    await expect(add).toHaveText(en["friends.partyRequested"]);
    await expect(add).toHaveAttribute("data-state", "asked");
    await expect(add).toHaveAttribute("aria-disabled", "true");
    await expect(host.page.getByTestId("tv-account-toast")).toHaveText(say(en["friends.requestSent"], { name: tagOf(guest.name) }));

    // The guest's list has the host's button (the profile on a screen is told by the server, not by what the screen says), and the guest's own screen has none.
    const back = guest.page.getByTestId("tv-party-add");
    await expect(back).toHaveCount(1);
    await expect(back).toHaveAttribute("aria-label", say(en["friends.partyAddAria"], { name: tagOf(host.name) }));
    await back.click(); // (the host asked first: friends at once)
    await expect(guest.page.getByTestId("tv-account-toast")).toHaveText(say(en["friends.added"], { name: host.name }));
    await expect(back).toHaveCount(0);
    await look(host.page);
    await expect(add).toHaveCount(0);
  });

  test("the host's phone lists the profile on each screen of the party with the same button", async ({ browser }) => {
    test.setTimeout(150_000);
    const tv = await openLibrary(browser, undefined, HD);
    await tv.getByTestId("rail-connect").click();
    const phone = await openDevice(browser, { ...PHONE, locale: "en-US" });
    await phone.goto("/");
    await phone.getByTestId("code-input").fill(await readPairingCode(tv));
    await expect(phone.getByTestId("tv-online")).toHaveClass(/\bok\b/);
    const pam = fresh("Pam");
    await signUp(phone, pam);
    await turnOnFriends(phone);
    await phone.keyboard.press("Escape");
    await place(phone, "home"); // (a paired phone has the account as one of the places of its bar)
    await expect(phone.getByTestId("account-screen")).toHaveCount(0);

    const guest = await screenWithFriends(browser, "Gus");
    await phone.getByTestId("menu").click();
    await phone.getByTestId("party-open").click();
    await expect(phone.getByTestId("party-join-code")).toBeVisible();
    await joinWith(guest.page, ((await phone.getByTestId("party-join-code").textContent()) ?? "").replace(/\D/g, ""));

    await expect(phone.getByTestId("party-tv")).toHaveCount(1);
    const add = phone.getByTestId("party-add");
    await expect(add).toHaveText(en["friends.partyAdd"]);
    await add.click();
    await expect(add).toHaveText(en["friends.partyRequested"]);
    await expect(add).toBeDisabled();
    await expect(phone.getByTestId("account-toast")).toHaveText(say(en["friends.requestSent"], { name: tagOf(guest.name) }));

    await look(guest.page); // (the guest's screen waits on the party's page: it is told in a line)
    await expect(guest.page.getByTestId("tv-account-toast")).toHaveText(say(en["friends.news.request"], { name: tagOf(nameOf(pam)) }));
  });

  for (const language of ["ro", "it"] as const) {
    test(`the buttons beside a guest of a party keep clear of its name and of each other, on the TV and on the phone, in ${language === "ro" ? "Romanian" : "Italian"}`, async ({ browser }) => {
      test.setTimeout(240_000);
      const words = WORDS[language];
      const host = await screenWithFriends(browser, "Hal", { language });
      const guest = await screenWithFriends(browser, "Gus");
      await host.page.getByTestId("rail-connect").click(); // (a phone of the host's, to see the same list on it)
      const phone = await openDevice(browser, { ...PHONE, locale: language === "ro" ? "ro-RO" : "it-IT" });
      await phone.goto("/");
      await phone.getByTestId("code-input").fill(await readPairingCode(host.page));
      await expect(phone.getByTestId("tv-online")).toHaveClass(/\bok\b/);
      await signUp(phone, fresh("Pam"));
      await turnOnFriends(phone);
      await phone.keyboard.press("Escape");

      await phone.getByTestId("menu").click();
      await phone.getByTestId("party-open").click();
      await expect(phone.getByTestId("party-join-code")).toBeVisible();
      await joinWith(guest.page, ((await phone.getByTestId("party-join-code").textContent()) ?? "").replace(/\D/g, ""));

      // The TV: the longest the row can be (an admin, so its button says Remove admin), at several shapes of screen.
      await host.page.getByTestId("tv-back-to-library").click(); // (a TV with a phone on it waits for a video until it is sent back)
      await host.page.getByTestId("rail-party").click();
      await host.page.getByTestId("tv-party-admin").click();
      await expect(host.page.getByTestId("tv-party-admin")).toHaveText(words["party.removeAdmin"]);
      await expect(host.page.getByTestId("tv-party-add")).toHaveText(words["friends.partyAdd"]);
      for (const size of [HD, { width: 1920, height: 1080 }, { width: 1024, height: 768 }, { width: 800, height: 600 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
        await host.page.setViewportSize(size);
        await expect
          .poll(() => rowProblems(host.page, '[data-testid="tv-party-member"]', ".tv-party-dot, .tv-party-name, small, .tv-party-actions button"), { message: `the TV at ${size.width} by ${size.height}` })
          .toEqual([]);
      }
      await host.page.getByTestId("tv-party-add").click(); // (and the longer word of the button once it is asked)
      await expect(host.page.getByTestId("tv-party-add")).toHaveText(words["friends.partyRequested"]);
      await expect.poll(() => rowProblems(host.page, '[data-testid="tv-party-member"]', ".tv-party-dot, .tv-party-name, small, .tv-party-actions button")).toEqual([]);

      // The phone: the two buttons and the word go under the name where they do not fit beside it, down to the narrowest phones.
      await expect(phone.getByTestId("party-add")).toBeVisible();
      for (const width of [412, 390, 360, 320]) {
        await phone.setViewportSize({ width, height: 700 });
        await expect.poll(() => rowProblems(phone, '[data-testid="party-tv"]', ".party-who, .party-actions .btn"), { message: `the phone at ${width}` }).toEqual([]);
      }
      expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
});
