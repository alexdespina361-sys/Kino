import { expect, type Browser, type Page } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { it as italian } from "../src/client/i18n/it";
import { ro } from "../src/client/i18n/ro";
import { openDevice, openLibrary, openProfilePlace, openTvSignIn, PHONE, place, readPairingCode, test, showProfilePage, nameFirstProfile, PICTURE_NAMED } from "./helpers";

test.use({ actionTimeout: 15_000 });

let counter = 0;
const fresh = (name: string) => ({ email: `${name}${++counter}x${Date.now().toString(36).slice(-4)}`, password: "kino-test-pass-1" });
type Account = ReturnType<typeof fresh>;
const nameOf = (account: Account) => account.email.charAt(0).toUpperCase() + account.email.slice(1);
const tagOf = (name: string) => `${name}#1`;

const say = (text: string, params: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? "");

const look = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

const WORDS = { en, ro, it: italian };
type Language = keyof typeof WORDS;

async function signUp(page: Page, account: Account) {
  await page.getByTestId("account-button").click();
  await page.getByTestId("auth-switch").click();
  await expect(page.getByTestId("auth-form")).toHaveAttribute("data-mode", "signUp");
  await page.getByTestId("auth-email").fill(account.email);
  await page.getByTestId("auth-password").fill(account.password);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("account-card")).toBeVisible();
  await nameFirstProfile(page, nameOf(account));
  await page.getByTestId("account-button").click();
  await expect(page.getByTestId("account-card")).toBeVisible();
}

async function turnOnFriends(page: Page) {
  await expect(page.getByTestId("menu-friends")).toBeVisible();
}

async function openFriends(page: Page) {
  await page.getByTestId("menu-friends").click();
  await expect(page.getByTestId("friends-page")).toBeVisible();
}

async function phoneWithFriends(browser: Browser, name: string) {
  const account = fresh(name);
  const page = await openDevice(browser, { ...PHONE, locale: "en-US" });
  await page.goto("/");
  await signUp(page, account);
  await turnOnFriends(page);
  return { page, name: nameOf(account) };
}

const HD = { width: 1280, height: 720 };

interface Screen {
  page: Page;
  name: string;
}

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
  await expect(page.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", PICTURE_NAMED);
  await nameFirstProfile(page, nameOf(account));
  await expect(page.getByTestId("tv-account-chip")).toContainText(nameOf(account));
  await showProfilePage(page);
  await expect(page.locator('[data-entry="profile:friends"]')).toBeVisible();
  return { page, name: nameOf(account) };
}

const tile = (page: Page, title: string) => page.locator(`.tv-tile[title="${title}"]`);

async function openFriendsPage(page: Page) {
  await openProfilePlace(page, "friends");
  await expect(page.getByTestId("tv-browse")).toHaveAttribute("data-view", "friends");
}

const codeOf = async (host: Page) => (await host.getByTestId("tv-party-code").innerText()).replace(/\s/g, "");

async function startParty(host: Page): Promise<string> {
  await host.getByTestId("rail-party").click();
  await host.getByTestId("tv-party-start").click();
  return codeOf(host);
}

async function joinWith(guest: Page, code: string) {
  await guest.getByTestId("rail-party").click();
  await guest.getByTestId("tv-party-join").click();
  await guest.keyboard.type(code);
  await expect(guest.getByTestId("tv-following")).toBeVisible();
}

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

test.describe("finding a friend by tag on the phone", () => {
  test("the tag finds a profile whatever the capitals, only asks, and a no leaves nothing; a yes makes friends", async ({ browser }) => {
    test.setTimeout(120_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await openFriends(ann.page);
    await openFriends(bob.page);
    const [annTag, bobTag] = [tagOf(ann.name), tagOf(bob.name)];
    await expect(ann.page.getByTestId("friend-your-tag-text")).toHaveText(annTag);
    await expect(ann.page.getByTestId("friend-your-tag-copy")).toBeVisible();

    const typed = bob.page.getByTestId("friend-tag-input");
    const find = bob.page.getByTestId("friend-tag-find");
    await expect(find).toBeDisabled();
    await typed.fill("Nobody");
    await expect(find).toBeDisabled();
    await typed.fill("Nobody#9");
    await expect(bob.page.getByTestId("friend-tag-card")).toHaveCount(0);
    await find.click();
    await expect(bob.page.getByTestId("friend-tag-error")).toHaveText(en["error.tag_gone"]);
    await ann.page.getByTestId("friend-tag-input").fill(annTag);
    await ann.page.getByTestId("friend-tag-find").click();
    await expect(ann.page.getByTestId("friend-tag-error")).toHaveText(en["error.own_request"]);

    await typed.fill(annTag.toLowerCase());
    await find.click();
    await expect(bob.page.getByTestId("friend-tag-name")).toHaveText(annTag);
    await bob.page.getByTestId("friend-tag-send").click();
    await expect(bob.page.getByTestId("account-toast")).toHaveText(say(en["friends.requestSent"], { name: annTag }));
    await expect(typed).toHaveValue("");
    await expect(bob.page.getByTestId("friend-tag-card")).toHaveCount(0);
    await expect(bob.page.getByTestId("friend-row")).toHaveCount(0);

    await look(ann.page);
    await expect(ann.page.getByTestId("account-toast")).toHaveText(say(en["friends.news.request"], { name: bobTag }));
    await expect(ann.page.getByTestId("friend-request")).toHaveCount(1);
    await expect(ann.page.getByTestId("friend-request-name")).toHaveText(bobTag);
    await ann.page.getByTestId("friend-request-decline").click();
    await expect(ann.page.getByTestId("friend-request")).toHaveCount(0);
    await expect(ann.page.getByTestId("friend-row")).toHaveCount(0);

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

test.describe("finding a friend by tag on the TV", () => {
  test("a tag is typed and asks; the request is a tile on the other's page that OK opens, Back leaves waiting, and Accept makes friends", async ({ browser }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    const [annTag, bobTag] = [tagOf(ann.name), tagOf(bob.name)];

    await openFriendsPage(ann.page);
    await tile(ann.page, en["friends.add"]).click();
    await expect(ann.page.getByTestId("tv-your-tag").locator("b")).toHaveText(annTag);
    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("tv-add-friend")).toHaveCount(0);

    await openFriendsPage(bob.page);
    await tile(bob.page, en["friends.add"]).click();
    await bob.page.getByTestId("tv-friend-tag").click();
    await expect(bob.page.getByTestId("tv-friend-tag-find")).toBeDisabled();
    await bob.page.getByTestId("tv-friend-tag-input").fill(annTag.toLowerCase());
    await bob.page.getByTestId("tv-friend-tag-find").click();
    await expect(bob.page.getByTestId("tv-friend-tag-name")).toHaveText(annTag);
    await bob.page.getByTestId("tv-friend-tag-send").click();
    await expect(bob.page.getByTestId("tv-friend-tag-page")).toHaveCount(0);
    await expect(bob.page.getByTestId("tv-add-friend")).toHaveCount(0);
    await expect(bob.page.getByTestId("tv-account-toast")).toHaveText(say(en["friends.requestSent"], { name: annTag }));

    await look(ann.page);
    await expect(ann.page.getByTestId("tv-account-toast")).toHaveText(say(en["friends.news.request"], { name: bobTag }));
    await expect(tile(ann.page, bobTag)).toBeVisible();
    await tile(ann.page, bobTag).focus();
    await expect(ann.page.getByTestId("tv-hero-title")).toHaveText(bobTag);
    await expect(ann.page.getByTestId("tv-hero-play")).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-hero-list")).toHaveCount(0);
    await tile(ann.page, bobTag).click();
    await expect(ann.page.getByTestId("tv-friend-request-name")).toHaveText(bobTag);
    await expect(ann.page.getByTestId("tv-friend-request-accept")).toBeFocused();
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

test.describe("a profile's own tag on its page", () => {
  test("the TV's profile page says it under the name, and its last button copies it: OK from the remote, or a click", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await screenWithFriends(browser, "Ann");
    const page = ann.page;
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
    const copy = page.getByTestId("tv-profile-tag-copy");
    await expect(page.getByTestId("tv-profile-tag-text")).toHaveText(tagOf(ann.name));
    await expect(page.getByTestId("tv-profile-tag")).toBeInViewport({ ratio: 1 });
    await expect(copy).toBeInViewport({ ratio: 1 });
    await expect(copy).toHaveText("Copy tag");

    await page.getByTestId("tv-profile-settings").focus();
    for (let step = 0; step < 4 && !(await copy.evaluate((element) => element === document.activeElement)); step++) await page.keyboard.press("ArrowRight");
    await expect(copy).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(copy).toBeFocused();
    await page.evaluate(() => navigator.clipboard.writeText("something else"));
    await page.keyboard.press("Enter");
    await expect(copy).toHaveText("Tag copied");
    expect(await clipboard()).toBe(tagOf(ann.name));
    await expect(copy).toBeFocused();
    await expect(copy).toHaveText("Copy tag");

    await page.evaluate(() => navigator.clipboard.writeText("something else"));
    await copy.click();
    await expect(copy).toHaveText("Tag copied");
    expect(await clipboard()).toBe(tagOf(ann.name));
  });

  test("on a phone that is the screen, the tag and its button are on the screen, the button a row of its own", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await screenWithFriends(browser, "Ann", { viewport: { width: 390, height: 844 } });
    const page = ann.page;
    await expect(page.getByTestId("tv-profile-tag-text")).toHaveText(tagOf(ann.name));
    await expect(page.getByTestId("tv-profile-tag")).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId("tv-profile-tag-copy")).toBeInViewport({ ratio: 1 });
    const [copy, settings] = [(await page.getByTestId("tv-profile-tag-copy").boundingBox())!, (await page.getByTestId("tv-profile-settings").boundingBox())!];
    expect(copy.width).toBeGreaterThan(settings.width * 1.5);
    expect(copy.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test("the phone's own profile screen says it under who is signed in, with a button that copies it", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const page = ann.page;
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await expect(page.getByTestId("account-tag-text")).toHaveText(tagOf(ann.name));
    await page.evaluate(() => navigator.clipboard.writeText("something else"));
    await page.getByTestId("account-tag-copy").click();
    await expect(page.getByTestId("account-tag-copy")).toHaveText("Tag copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(tagOf(ann.name));
  });
});

test.describe("asking the profile on a screen of a watch party", () => {
  test("a screen signed in as a profile gets a short Add button; Requested waits for the answer, and asking back is friends at once", async ({ browser }) => {
    test.setTimeout(150_000);
    const host = await screenWithFriends(browser, "Hal");
    const guest = await screenWithFriends(browser, "Gus");
    const code = await startParty(host.page);
    await joinWith(guest.page, code);
    const bystander = await openLibrary(browser, undefined, HD);
    await joinWith(bystander, code);

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

    const back = guest.page.getByTestId("tv-party-add");
    await expect(back).toHaveCount(1);
    await expect(back).toHaveAttribute("aria-label", say(en["friends.partyAddAria"], { name: tagOf(host.name) }));
    await back.click();
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
    await place(phone, "home");
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

    await look(guest.page);
    await expect(guest.page.getByTestId("tv-account-toast")).toHaveText(say(en["friends.news.request"], { name: tagOf(nameOf(pam)) }));
  });

  for (const language of ["ro", "it"] as const) {
    test(`the buttons beside a guest of a party keep clear of its name and of each other, on the TV and on the phone, in ${language === "ro" ? "Romanian" : "Italian"}`, async ({ browser }) => {
      test.setTimeout(240_000);
      const words = WORDS[language];
      const host = await screenWithFriends(browser, "Hal", { language });
      const guest = await screenWithFriends(browser, "Gus");
      await host.page.getByTestId("rail-connect").click();
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

      await host.page.getByTestId("tv-back-to-library").click();
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
      await host.page.getByTestId("tv-party-add").click();
      await expect(host.page.getByTestId("tv-party-add")).toHaveText(words["friends.partyRequested"]);
      await expect.poll(() => rowProblems(host.page, '[data-testid="tv-party-member"]', ".tv-party-dot, .tv-party-name, small, .tv-party-actions button")).toEqual([]);

      await expect(phone.getByTestId("party-add")).toBeVisible();
      for (const width of [412, 390, 360, 320]) {
        await phone.setViewportSize({ width, height: 700 });
        await expect.poll(() => rowProblems(phone, '[data-testid="party-tv"]', ".party-who, .party-actions .btn"), { message: `the phone at ${width}` }).toEqual([]);
      }
      expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
});
