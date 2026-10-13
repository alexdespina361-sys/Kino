import { expect, type Browser, type Page } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { it as italian } from "../src/client/i18n/it";
import { ro } from "../src/client/i18n/ro";
import { openDevice, openLibrary, openProfilePlace, openTv, PHONE, readPairingCode, test } from "./helpers";

/**
 * The bell: a button beside the profile's picture, on the phone and on the TV. A number on it is what waits for an answer from this profile
 * (a request to be friends, an invitation, a title sent); a quiet dot is only that friends watched something. It opens a short list that
 * answers (or opens) what is in it. Each test makes its own accounts and screens.
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

/* ------------------------------ what the server is told ------------------------------ */

const profileOf = (page: Page) => page.evaluate(() => localStorage.getItem("kino.profile"));

/** `page`'s profile asks the one with this tag to be friends, as its Add button does. */
async function askBy(page: Page, tag: string) {
  const response = await page.request.post(`/api/profiles/${await profileOf(page)}/friends/requests`, { data: { tag } });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { status: string };
}

const FILM = "https://films.example/watch/17";
/** `page`'s profile is part way through a film, put on the server the way a screen does it. */
async function startsFilm(page: Page) {
  const at = Date.now();
  const card = { key: "alpha", at, title: "Alpha Film", url: FILM, year: 1931, position: 600, duration: 5400 };
  const response = await page.request.post(`/api/profiles/${await profileOf(page)}/sync`, { data: { since: 0, progress: [card] } });
  expect(response.ok()).toBe(true);
}

/** Held until the server tells `page`'s profile what a friend watches (the switches that allow it reach the server a moment after they are turned). */
const hearsActivity = (page: Page) =>
  expect
    .poll(async () => {
      const state = (await (await page.request.get(`/api/profiles/${await profileOf(page)}/friends`)).json()) as { activity: unknown[] };
      return state.activity.length;
    })
    .toBeGreaterThan(0);

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

/** The account page is shut: the phone is at its home screen. */
async function home(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("account-screen")).toHaveCount(0);
}

/** A switch of the settings, from the home screen: the account page is opened, the switch put right, and the phone is back at the home screen. */
async function setting(page: Page, id: string, on: boolean) {
  await page.getByTestId("account-button").click();
  await page.getByTestId("menu-settings").click();
  const toggle = page.getByTestId(id);
  if ((await toggle.getAttribute("aria-checked")) !== String(on)) await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", String(on));
  await page.keyboard.press("Escape");
  await home(page);
}

/** A new phone, signed up, with friends on, and at its home screen. */
async function phoneWithFriends(browser: Browser, name: string, locale = "en-US") {
  const account = fresh(name);
  const page = await openDevice(browser, { ...PHONE, locale });
  await page.goto("/");
  await signUp(page, account);
  await turnOnFriends(page);
  await home(page);
  return { page, name: nameOf(account) };
}

const bell = (page: Page) => page.getByTestId("bell-button");
const badge = (page: Page) => page.getByTestId("bell-badge");
const dot = (page: Page) => page.getByTestId("bell-dot");

/* ------------------------------ a TV ------------------------------ */

const HD = { width: 1280, height: 720 };
const SMALL = { width: 390, height: 844 };

interface Screen {
  page: Page;
  name: string;
}

/** A new screen, signed up with the email form and with friends on, left on the profile's page. */
async function screenWithFriends(browser: Browser, name: string, options: { language?: Language } = {}): Promise<Screen> {
  const account = fresh(name);
  const page = await openLibrary(browser, undefined, HD, options.language ? { "kino.lang": options.language } : {});
  await page.getByTestId("tv-account-chip").click();
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

/** The remote walks up from the titles to the bell, the first of the corner's buttons. */
async function upToBell(page: Page) {
  const button = page.getByTestId("tv-bell");
  for (let step = 0; step < 4 && !(await button.evaluate((element) => element === document.activeElement)); step++) await page.keyboard.press("ArrowUp");
  await expect(button).toBeFocused();
}

/**
 * What is out of place in the library's corner: a button that leaves the screen, two that cover each other, or one that covers the logo.
 * (A name of the longest length makes the account button as wide as it gets.)
 */
const cornerProblems = (page: Page) =>
  page.evaluate(() => {
    const problems: string[] = [];
    const parts = [...document.querySelectorAll<HTMLElement>('[data-testid="tv-bell"], [data-testid="tv-account-chip"], [data-testid="fullscreen-toggle"], .tv-browse-logo')].map((part) => ({
      name: part.getAttribute("data-testid") ?? "logo",
      box: part.getBoundingClientRect(),
    }));
    if (parts.length < 3) problems.push(`(only ${parts.map((part) => part.name).join(", ")} in the corner)`);
    parts.forEach(({ name, box }, at) => {
      if (box.left < -0.5 || box.right > innerWidth + 0.5) problems.push(`${name} leaves the screen`);
      for (const other of parts.slice(at + 1)) {
        const covers = box.left < other.box.right - 0.5 && other.box.left < box.right - 0.5 && box.top < other.box.bottom - 0.5 && other.box.top < box.bottom - 0.5;
        if (covers) problems.push(`${name} and ${other.name} cover each other`);
      }
    });
    return problems;
  });

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

test.describe("the bell on the phone", () => {
  test("it is there with friends on, a request is a number on it that the list answers, and what a friend watches is only a quiet dot", async ({ browser }) => {
    test.setTimeout(180_000);
    const annAccount = fresh("Ann");
    const ann = await openDevice(browser, { ...PHONE, locale: "en-US" });
    await ann.goto("/");
    await expect(ann.getByTestId("account-button")).toBeVisible();
    await expect(bell(ann)).toHaveCount(0); // signed out
    await signUp(ann, annAccount);
    await home(ann);
    await expect(bell(ann)).toHaveCount(0); // signed in, with friends off
    await ann.getByTestId("account-button").click();
    await turnOnFriends(ann);
    await home(ann);
    await expect(bell(ann)).toBeVisible();
    await expect(badge(ann)).toHaveCount(0);
    await expect(dot(ann)).toHaveCount(0);

    // Bob asks to be her friend: a number on her bell, and the list has him with the buttons that answer. Looking does not answer.
    const bob = await phoneWithFriends(browser, "Bob");
    const annName = nameOf(annAccount);
    expect(await askBy(bob.page, tagOf(annName))).toMatchObject({ status: "sent" });
    await look(ann);
    await expect(badge(ann)).toHaveText("1");
    await expect(bell(ann)).toHaveAttribute("aria-label", say(en["bell.ariaCount"], { count: "1" }));
    await bell(ann).click();
    const sheet = ann.getByTestId("bell-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("friend-request")).toContainText(bob.name);
    await expect(badge(ann)).toHaveText("1");
    await sheet.getByTestId("friend-request-accept").click();
    await expect(sheet.getByTestId("friend-request")).toHaveCount(0);
    await expect(sheet.getByTestId("bell-empty")).toBeVisible();
    await expect(badge(ann)).toHaveCount(0);
    await ann.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);

    // Ann tells what she watches and Bob hears it: his bell gets a dot, never a number; the list says what and by whom, and opening it puts the dot out.
    await setting(ann, "friends-give", true);
    await setting(bob.page, "friends-get", true);
    await startsFilm(ann);
    await hearsActivity(bob.page);
    await look(bob.page);
    await expect(dot(bob.page)).toBeVisible();
    await expect(badge(bob.page)).toHaveCount(0);
    await bell(bob.page).click();
    const lately = bob.page.getByTestId("bell-lately-item");
    await expect(lately).toHaveCount(1);
    await expect(lately).toContainText("Alpha Film");
    await expect(lately).toContainText(annName);
    await expect(dot(bob.page)).toHaveCount(0);

    // The list's last button goes on to the Friends page, and Back from there is straight home.
    await bob.page.getByTestId("bell-open-friends").click();
    await expect(bob.page.getByTestId("friends-page")).toBeVisible();
    await expect(bob.page.getByTestId("friend-row")).toHaveCount(1);
    await bob.page.keyboard.press("Escape");
    await expect(bob.page.getByTestId("account-screen")).toHaveCount(0);
    await expect(dot(bob.page)).toHaveCount(0);
  });

  test("beside the TV's name and the picture the bell keeps clear of both, on the narrowest phone, in Romanian", async ({ browser }) => {
    test.setTimeout(120_000);
    const account = fresh("Maximilia");
    const tv = await openTv(browser);
    const page = await openDevice(browser, { ...PHONE, locale: "ro-RO" });
    await page.goto("/");
    await page.getByTestId("code-input").fill(await readPairingCode(tv));
    await expect(page.getByTestId("tv-online")).toHaveClass(/\bok\b/);
    await signUp(page, account);
    await turnOnFriends(page);
    await home(page);
    await expect(bell(page)).toBeVisible();
    await bell(page).evaluate((button) => button.insertAdjacentHTML("beforeend", '<b class="bell-badge">9+</b>')); // (the widest number it can show: it hangs off the button, and must not push anything)

    const problems = () =>
      page.evaluate(() => {
        const problems: string[] = [];
        const header = document.querySelector("header.top")!;
        const around = header.getBoundingClientRect();
        if (document.documentElement.scrollWidth > innerWidth) problems.push("the page sticks out sideways");
        const boxes = [".top-tv", '[data-testid="bell-button"]', '[data-testid="account-button"]', '[data-testid="menu"]'].map((selector) => ({ selector, box: header.querySelector(selector)!.getBoundingClientRect() }));
        boxes.forEach(({ selector, box }, at) => {
          if (box.left < around.left - 0.5 || box.right > around.right + 0.5) problems.push(`${selector} leaves the header`);
          for (const other of boxes.slice(at + 1)) if (box.left < other.box.right - 0.5 && other.box.left < box.right - 0.5) problems.push(`${selector} and ${other.selector} are side by side too closely`);
        });
        if (boxes[0]!.box.width < 100) problems.push(`the TV's name has ${Math.round(boxes[0]!.box.width)}px`);
        const status = header.querySelector<HTMLElement>('[data-testid="tv-online"]')!;
        if (status.scrollWidth > status.clientWidth + 1) problems.push("the status is cut");
        return problems;
      });
    for (const width of [320, 360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await expect.poll(problems, { message: `${width} wide` }).toEqual([]);
    }
  });
});

/* ------------------------------ on a TV ------------------------------ */

test.describe("the bell on the TV", () => {
  test("the remote reaches it first in the corner, the list answers a request, tells what a friend watches, and Back shuts it", async ({ browser }) => {
    test.setTimeout(240_000);
    const cy = await screenWithFriends(browser, "Cy");
    const bob = await phoneWithFriends(browser, "Bob");
    const tv = cy.page;
    const button = tv.getByTestId("tv-bell");
    const list = tv.getByTestId("tv-bell-page");
    const lines = tv.getByTestId("tv-bell-item");
    await expect(button).toBeVisible();
    await expect(tv.getByTestId("tv-bell-badge")).toHaveCount(0);

    // A request is a number on the bell. Up from the titles reaches the bell, then the profile's picture, and back.
    expect(await askBy(bob.page, tagOf(cy.name))).toMatchObject({ status: "sent" });
    await look(tv);
    await expect(tv.getByTestId("tv-bell-badge")).toHaveText("1");
    await upToBell(tv);
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-account-chip")).toBeFocused();
    await tv.keyboard.press("ArrowLeft");
    await expect(button).toBeFocused();

    // OK opens the list with the remote on its first line; Back shuts it and the remote is on the bell again.
    await tv.keyboard.press("Enter");
    await expect(list).toBeVisible();
    await expect(lines).toHaveCount(1);
    await expect(lines).toContainText(bob.name);
    await expect(lines).toBeFocused();
    await tv.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(button).toBeFocused();

    // The line is the question of the friends page: Back from it keeps the request waiting (and the remote is on the bell), OK on Accept answers it.
    await tv.keyboard.press("Enter");
    await expect(lines).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-friend-request")).toBeVisible();
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-friend-request")).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(tv.getByTestId("tv-bell-badge")).toHaveText("1");
    await tv.keyboard.press("Enter");
    await expect(lines).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-friend-request-accept")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-friend-request")).toHaveCount(0);
    await expect(tv.getByTestId("tv-bell-badge")).toHaveCount(0);
    await expect(button).toBeFocused();

    // Bob tells what he watches and Cy hears it: a dot on the bell, a line in the list that opens the title.
    await setting(bob.page, "friends-give", true);
    await tv.getByTestId("rail-profile").click();
    await tv.locator('[data-entry="profile:friends"]').click();
    await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "friends");
    await tv.locator(`.tv-tile[title="${en["friends.settingsTile"]}"]`).click();
    await tv.getByTestId("tv-friends-get").click();
    await tv.getByTestId("tv-friend-settings-done").click();
    await startsFilm(bob.page);
    await hearsActivity(tv);
    await look(tv);
    await expect(tv.getByTestId("tv-bell-dot")).toBeVisible();
    await expect(tv.getByTestId("tv-bell-badge")).toHaveCount(0);
    await tv.getByTestId("tv-bell").click();
    await expect(lines).toHaveCount(1);
    await expect(lines).toContainText("Alpha Film");
    await expect(lines).toContainText(bob.name);
    await expect(tv.getByTestId("tv-bell-dot")).toHaveCount(0);
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-detail")).toBeVisible();
    await expect(tv.getByTestId("tv-detail-title")).toHaveText("Alpha Film");
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);

    // With nothing left to answer, the list's own button goes on to the friends' page.
    await tv.getByTestId("tv-bell").click();
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("tv-bell-friends")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(list).toHaveCount(0);
    await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "friends");
  });

  test("the corner and the list fit a screen of any size, with the longest name, in every language", async ({ browser }) => {
    test.setTimeout(240_000);
    const bob = await phoneWithFriends(browser, "Bob");
    for (const language of ["en", "ro", "it"] as const) {
      const words = WORDS[language];
      const cy = await screenWithFriends(browser, "Maximilia", { language }); // (fifteen letters or so: as wide as the account button gets)
      await askBy(bob.page, tagOf(cy.name));
      await look(cy.page);
      await expect(cy.page.getByTestId("tv-bell-badge")).toHaveText("1");
      for (const size of [HD, SMALL]) {
        const where = `${language} at ${size.width} wide`;
        await cy.page.setViewportSize(size);
        await expect.poll(() => cornerProblems(cy.page), { message: `the corner, ${where}` }).toEqual([]);
        await cy.page.getByTestId("tv-bell").click();
        const list = cy.page.getByTestId("tv-bell-page");
        await expect(list).toBeVisible();
        await expect(list.getByTestId("tv-bell-friends")).toHaveText(words["bell.openFriends"]);
        await expect(list.getByTestId("tv-bell-item")).toContainText(words["friends.requestWants"]);
        expect(await rowProblems(cy.page, ".tv-bell-line", ".tv-bell-icon, .tv-bell-text"), `the list, ${where}`).toEqual([]);
        expect(await rowProblems(cy.page, '[data-testid="tv-bell-page"] .tv-actions', ".tv-action"), `the buttons, ${where}`).toEqual([]);
        const cut = await cy.page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".tv-bell-text b, .tv-bell-text small")].filter((part) => part.scrollWidth > part.clientWidth + 1).map((part) => part.textContent));
        expect(cut, `words cut off, ${where}`).toEqual([]);
        expect(await cy.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `sideways, ${where}`).toBe(true);
        await cy.page.keyboard.press("Escape");
        await expect(list).toHaveCount(0);
      }
    }
  });
});
