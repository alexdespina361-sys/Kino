import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { it as italian } from "../src/client/i18n/it";
import { ro } from "../src/client/i18n/ro";
import { openDevice, openLibrary, openProfilePlace, openTv, openTvSignIn, PHONE, place, readPairingCode, test, showProfilePage, nameFirstProfile, PICTURE_NAMED } from "./helpers";

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
  await nameFirstProfile(page, nameOf(account));
  await page.getByTestId("account-button").click();
  await expect(page.getByTestId("account-card")).toBeVisible();
}

/** The account page is open: it has Friends (they are on for everybody since 15 Nov 2026: there is no switch to turn on). */
async function turnOnFriends(page: Page) {
  await expect(page.getByTestId("menu-friends")).toBeVisible();
}

/** The account page is shut: the phone is at its home screen. (A phone that has a TV has the account as a place of its bar, You, and Home is another place of it.) */
async function home(page: Page) {
  await page.keyboard.press("Escape");
  if ((await page.getByTestId("tab-home").count()) > 0) await place(page, "home");
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
async function screenWithFriends(browser: Browser, name: string, options: { language?: Language; touch?: boolean } = {}): Promise<Screen> {
  const account = fresh(name);
  const seed: Record<string, string> = options.language ? { "kino.lang": options.language } : {};
  // (`touch`: a screen a finger can touch, as a phone that is the screen or a tablet; it starts as wide as the others, to sign in the same way.)
  const page = options.touch ? await openDevice(browser, { viewport: HD, hasTouch: true }, seed) : await openLibrary(browser, undefined, HD, seed);
  if (options.touch) {
    await page.goto("/tv");
    await expect(page.getByTestId("tv-browse")).toBeVisible();
  }
  await openTvSignIn(page);
  if (!options.touch) await page.getByTestId("tv-signin-email").click(); // (a screen that can be touched has the form at once: it is typed on)
  await page.getByTestId("auth-switch").click();
  await expect(page.getByTestId("auth-form")).toHaveAttribute("data-mode", "signUp");
  await page.getByTestId("auth-email").fill(account.email);
  await page.getByTestId("auth-password").fill(account.password);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", PICTURE_NAMED);
  await nameFirstProfile(page, nameOf(account));
  await expect(page.getByTestId("tv-account-chip")).toContainText(nameOf(account));
  await showProfilePage(page); // (friends are on for everybody: the profile's page has them at once)
  await expect(page.locator('[data-entry="profile:friends"]')).toBeVisible(); // (back on the profile's page, which has its friends now)
  return { page, name: nameOf(account) };
}

/**
 * A finger (or, with `pointerType` "mouse", a mouse) pressed on the middle of `target`, moved `by` pixels to the side in four steps and let go, as pointer
 * events. With `hold`, it is not let go: what this gives back lets it go there.
 */
async function swipe(target: Locator, by: number, pointerType: "touch" | "mouse" = "touch", hold = false): Promise<() => Promise<void>> {
  const box = await target.boundingBox();
  if (!box) throw new Error("nothing to swipe");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const at = (dx: number, buttons = 1) => ({ pointerId: 7, pointerType, isPrimary: true, bubbles: true, clientX: x + dx, clientY: y, button: 0, buttons });
  await target.dispatchEvent("pointerdown", at(0));
  for (const step of [0.25, 0.5, 0.75, 1]) await target.dispatchEvent("pointermove", at(by * step));
  const lift = () => target.dispatchEvent("pointerup", at(by, 0));
  if (!hold) await lift();
  return lift;
}

/** The remote walks up from the titles to the bell, the first of the corner's buttons. */
async function upToBell(page: Page) {
  const button = page.getByTestId("tv-bell");
  for (let step = 0; step < 4 && !(await button.evaluate((element) => element === document.activeElement)); step++) {
    // (Up reaches the corner; on a page that has the way back there, that is its first button, and the bell is the next along.)
    const inCorner = await page.evaluate(() => document.activeElement?.getAttribute("data-zone") === "top");
    await page.keyboard.press(inCorner ? "ArrowRight" : "ArrowUp");
  }
  await expect(button).toBeFocused();
}

/**
 * What is out of place in the library's corner: a button that leaves the screen, two that cover each other, or one that covers the logo.
 * (A name of the longest length makes the account button as wide as it gets, and the profile's pages have the way back there as well.)
 */
const cornerProblems = (page: Page) =>
  page.evaluate(() => {
    const problems: string[] = [];
    const parts = [...document.querySelectorAll<HTMLElement>('[data-testid="tv-page-back"], [data-testid="tv-bell"], [data-testid="tv-account-chip"], [data-testid="fullscreen-toggle"], .tv-browse-logo')].map((part) => ({
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
  test("it is there once signed in (friends are on for everybody), a request is a number on it that the list answers, and what a friend watches is only a quiet dot", async ({ browser }) => {
    test.setTimeout(180_000);
    const annAccount = fresh("Ann");
    const ann = await openDevice(browser, { ...PHONE, locale: "en-US" });
    await ann.goto("/");
    await expect(ann.getByTestId("account-button")).toBeVisible();
    await expect(bell(ann)).toHaveCount(0); // signed out
    await signUp(ann, annAccount);
    await home(ann);
    await expect(bell(ann)).toBeVisible(); // signed in: friends are on for everybody since 15 Nov 2026
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

    // Ann shares what she watches and Bob shares his too, which is how he hears it: his bell gets a dot, never a number; the list says what and by whom, and opening it puts the dot out.
    await setting(ann, "friends-give", true);
    await setting(bob.page, "friends-give", true);
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

    // A finger takes the line off the list: a short pull lets it come back, a pull to the side clears it. That is this phone's own fact, kept when the bell is opened again.
    const pull = async (by: number) => {
      const box = (await lately.boundingBox())!;
      const at = { pointerId: 7, pointerType: "touch", isPrimary: true, bubbles: true, clientY: box.y + box.height / 2 };
      await lately.dispatchEvent("pointerdown", { ...at, clientX: box.x + 40 });
      await lately.dispatchEvent("pointermove", { ...at, clientX: box.x + 40 + by / 2 });
      await lately.dispatchEvent("pointermove", { ...at, clientX: box.x + 40 + by });
      await lately.dispatchEvent("pointerup", { ...at, clientX: box.x + 40 + by });
    };
    await pull(40);
    await expect(lately).toHaveCount(1);
    await pull(180);
    await expect(lately).toHaveCount(0);
    // (Bob asked and Ann said yes on her phone: news to his, said once, under the line that is cleared)
    await expect(bob.page.getByTestId("bell-joined-item")).toContainText(annName);
    await bob.page.keyboard.press("Escape");
    await bell(bob.page).click();
    await expect(bob.page.getByTestId("bell-empty")).toBeVisible();
    await expect(bob.page.getByTestId("bell-joined-item")).toHaveCount(0);

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
        // (The TV's name and the button that opens its menu are one chip now: docs/phone-layout. The bell and the account button are the other two.)
        const boxes = [".top-tv", '[data-testid="bell-button"]', '[data-testid="account-button"]'].map((selector) => ({ selector, box: header.querySelector(selector)!.getBoundingClientRect() }));
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

    // Bob shares what he watches and Cy does too, which is how he hears it: a dot on the bell, a line in the list that opens the title.
    await setting(bob.page, "friends-give", true);
    await openProfilePlace(tv, "friends");
    await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "friends");
    await tv.locator(`.tv-tile[title="${en["friends.settingsTile"]}"]`).click();
    await tv.getByTestId("tv-friends-give").click();
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

    // With nothing left to answer, Down from the line is the list's own button. Right of the line is its cross: OK on it clears the line, the list says
    // there is nothing new, and the remote is on the button that is left. Opening the bell again does not bring the line back.
    await tv.getByTestId("tv-bell").click();
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("tv-bell-friends")).toBeFocused();
    await tv.keyboard.press("ArrowUp");
    await expect(lines).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-bell-clear")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(lines).toHaveCount(0);
    await expect(tv.getByTestId("tv-bell-empty")).toBeVisible();
    await expect(tv.getByTestId("tv-bell-friends")).toBeFocused();
    await tv.keyboard.press("Escape");
    await tv.getByTestId("tv-bell").click();
    await expect(tv.getByTestId("tv-bell-empty")).toBeVisible();
    await expect(tv.getByTestId("tv-bell-friends")).toBeFocused();

    // The list's own button goes on to the friends' page.
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

  test("a plan to watch together is a line of the list with a clock, and keeps clear of the screen's edges, in every language", async ({ browser }) => {
    test.setTimeout(240_000);
    const bob = await phoneWithFriends(browser, "Bob");
    const bobProfile = await profileOf(bob.page);
    for (const language of ["en", "ro", "it"] as const) {
      const words = WORDS[language];
      const cy = await screenWithFriends(browser, "Maximilia", { language });
      const cyProfile = await profileOf(cy.page);
      // (Bob asks to be Cy's friend and Cy says yes, as the buttons do; then Bob plans a watch together with a few words)
      await askBy(bob.page, tagOf(cy.name));
      const accepted = await cy.page.request.post(`/api/profiles/${cyProfile}/friends/requests/${bobProfile}/accept`);
      expect(accepted.ok()).toBe(true);
      const sent = await bob.page.request.post(`/api/profiles/${bobProfile}/friends/send`, {
        data: { kind: "plan", when: Date.now() + 2 * 86_400_000, note: "Un film cu multe explozii, cu floricele de porumb", to: [cyProfile] },
      });
      expect(sent.ok()).toBe(true);
      await look(cy.page);
      await expect(cy.page.getByTestId("tv-bell-badge")).toHaveText("1");
      for (const size of [HD, SMALL]) {
        const where = `${language} at ${size.width} wide`;
        await cy.page.setViewportSize(size);
        await cy.page.getByTestId("tv-bell").click();
        const list = cy.page.getByTestId("tv-bell-page");
        await expect(list).toBeVisible();
        const line = list.getByTestId("tv-bell-item");
        await expect(line).toHaveCount(1);
        await expect(line).toContainText(say(words["friends.planOf"], { name: bob.name }));
        await expect(line).toContainText("Un film cu multe explozii");
        expect(await rowProblems(cy.page, ".tv-bell-line", ".tv-bell-icon, .tv-bell-text"), `the line, ${where}`).toEqual([]);
        expect(await rowProblems(cy.page, '[data-testid="tv-bell-page"] .tv-actions', ".tv-action"), `the buttons, ${where}`).toEqual([]);
        expect(await cy.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `sideways, ${where}`).toBe(true);
        await cy.page.keyboard.press("Escape");
        await expect(list).toHaveCount(0);
      }
    }
  });
});

/* ------------------------------ clearing a line: the cross, a finger ------------------------------ */

/** `from` (a phone's profile, a friend of `to`) sends `to` these titles, as its Send button does. */
async function sends(from: Page, to: Page, titles: string[]) {
  const toId = await profileOf(to);
  for (const title of titles) {
    const sent = await from.request.post(`/api/profiles/${await profileOf(from)}/friends/send`, { data: { kind: "recommend", title, url: `${FILM}?${title.charAt(0)}`, year: 1931, to: [toId] } });
    expect(sent.ok()).toBe(true);
  }
}

/** `a` (a phone) and `b` are made friends, as a request answered. */
async function befriend(a: Page, b: { page: Page; name: string }) {
  await askBy(a, tagOf(b.name));
  expect((await b.page.request.post(`/api/profiles/${await profileOf(b.page)}/friends/requests/${await profileOf(a)}/accept`)).ok()).toBe(true);
}

/** Where a part is drawn across, as its transform says: 0 where it is not moved. */
const shiftOf = (part: Locator) => part.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform === "none" ? undefined : getComputedStyle(element).transform).m41);

/** A real finger on a touch screen, as the browser's own touch events: put on the middle of `target`, moved `by` pixels (to the side, or down) and lifted. */
async function finger(page: Page, target: Locator, by: number, direction: "side" | "down" = "side") {
  const box = await target.boundingBox();
  if (!box) throw new Error("nothing to touch");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const at = (part: number) => [{ x: direction === "side" ? x + by * part : x, y: direction === "down" ? y + by * part : y }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(0) });
  for (const part of [0.1, 0.2, 0.4, 0.6, 0.8, 1]) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(part) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

test.describe("clearing a line of the bell", () => {
  test("on the TV a card follows a finger and goes back when let go short; a mouse does not drag it; a finger far enough clears it for good", async ({ browser }) => {
    test.setTimeout(150_000);
    const cy = await screenWithFriends(browser, "Cy");
    const bob = await phoneWithFriends(browser, "Bob");
    await befriend(bob.page, cy);
    await sends(bob.page, cy.page, ["Alpha Film", "Beta Film"]);
    const tv = cy.page;
    await look(tv);
    await expect(tv.getByTestId("tv-bell-badge")).toHaveText("2");
    await tv.getByTestId("tv-bell").click();
    const lines = tv.getByTestId("tv-bell-item");
    await expect(lines).toHaveCount(2);
    const card = tv.locator(".tv-bell-row").first();

    // The card is under the finger while it is held (not pinned where it came in), and goes back when let go short of where it would go.
    const letGo = await swipe(lines.first(), -60, "touch", true);
    await expect.poll(() => shiftOf(card)).toBeLessThan(-50);
    await letGo();
    await expect.poll(() => shiftOf(card)).toBe(0);
    await expect(lines).toHaveCount(2);
    // A mouse held and moved across it does not move it (its way is the cross).
    const mouseUp = await swipe(lines.first(), -400, "mouse", true);
    expect(await shiftOf(card)).toBe(0);
    await mouseUp();
    await tv.waitForTimeout(500);
    await expect(lines).toHaveCount(2);
    // A finger past a third of it: it flies off, the list closes up, and it is gone from the server too (the bell opened again does not bring it back).
    const other = (await lines.first().innerText()).includes("Alpha") ? "Beta Film" : "Alpha Film";
    await swipe(lines.first(), -400);
    await expect(lines).toHaveCount(1);
    await expect(lines).toContainText(other);
    await tv.keyboard.press("Escape");
    await tv.getByTestId("tv-bell").click();
    await expect(lines).toHaveCount(1);
    await expect(lines).toContainText(other);

    // The cross, clicked with a mouse, clears the last one: the list says there is nothing new.
    await tv.getByTestId("tv-bell-clear").click();
    await expect(lines).toHaveCount(0);
    await expect(tv.getByTestId("tv-bell-empty")).toBeVisible();
  });

  test("on a phone that is the screen, a real finger swipes a card away; one moved up and down scrolls instead, and one let go short leaves it", async ({ browser }) => {
    test.setTimeout(150_000);
    const eve = await screenWithFriends(browser, "Eve", { touch: true });
    const bob = await phoneWithFriends(browser, "Bob");
    await befriend(bob.page, eve);
    await sends(bob.page, eve.page, ["Alpha Film", "Beta Film"]);
    const tv = eve.page;
    await tv.setViewportSize(SMALL);
    await look(tv);
    await expect(tv.getByTestId("tv-bell-badge")).toHaveText("2");
    await tv.getByTestId("tv-bell").click();
    const lines = tv.getByTestId("tv-bell-item");
    await expect(lines).toHaveCount(2);

    await finger(tv, lines.first(), 120, "down");
    await finger(tv, lines.first(), -40);
    await tv.waitForTimeout(800); // (what a swipe would have set going has had its time)
    await expect(lines).toHaveCount(2);
    await expect(tv.getByTestId("tv-friend-request")).toHaveCount(0); // (and nothing was opened by it)
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);

    const other = (await lines.first().innerText()).includes("Alpha") ? "Beta Film" : "Alpha Film";
    await finger(tv, lines.first(), 150); // (past the 110 pixels that are far enough, and still on the screen)
    await expect(lines).toHaveCount(1);
    await expect(lines).toContainText(other);
    await expect(tv.getByTestId("tv-detail")).toHaveCount(0);
  });

  test("the remote's OK twice on a cross clears that line only, and the remote goes on to the next cross; Back at once still clears it", async ({ browser }) => {
    test.setTimeout(150_000);
    const cy = await screenWithFriends(browser, "Cy");
    const bob = await phoneWithFriends(browser, "Bob");
    await befriend(bob.page, cy);
    await sends(bob.page, cy.page, ["Alpha Film", "Beta Film", "Gamma Film"]);
    const tv = cy.page;
    // (The server takes its time to answer, as a slow one does: the line is gone from the screen before it is gone from the list.)
    let dismissed = 0;
    await tv.route("**/api/profiles/*/friends/inbox/*", async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      dismissed++;
      await new Promise((done) => setTimeout(done, 900));
      await route.fallback();
    });
    await look(tv);
    await expect(tv.getByTestId("tv-bell-badge")).toHaveText("3");
    await tv.getByTestId("tv-bell").click();
    const lines = tv.getByTestId("tv-bell-item");
    await expect(lines).toHaveCount(3);
    await expect(lines.first()).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    const crosses = tv.getByTestId("tv-bell-clear");
    await expect(crosses.first()).toBeFocused();
    const second = await lines.nth(1).getAttribute("data-entry");
    await tv.keyboard.press("Enter");
    await tv.keyboard.press("Enter");
    // The remote is on the cross of the line that took its place before the server has answered, and only one line was sent away.
    await expect.poll(() => tv.evaluate(() => document.activeElement?.closest(".tv-bell-row")?.querySelector("[data-entry]")?.getAttribute("data-entry"))).toBe(second);
    await expect(tv.locator('.tv-bell-row[data-leaving="true"]')).toHaveCount(1);
    await expect(lines).toHaveCount(2);
    expect(dismissed).toBe(1);

    // OK on the next cross and Back at once: the list is shut, the remote is on the bell, and the line is cleared all the same.
    await tv.keyboard.press("Enter");
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-bell-page")).toHaveCount(0);
    await expect(tv.getByTestId("tv-bell")).toBeFocused();
    await expect.poll(() => dismissed).toBe(2);
    await tv.waitForTimeout(1200);
    await tv.getByTestId("tv-bell").click();
    await expect(lines).toHaveCount(1);
  });

  test("on the phone, a line swiped away stays away while the server takes its time, and is gone after", async ({ browser }) => {
    test.setTimeout(150_000);
    const cy = await screenWithFriends(browser, "Cy");
    const bob = await phoneWithFriends(browser, "Bob");
    await befriend(bob.page, cy);
    await sends(cy.page, bob.page, ["Alpha Film"]);
    const phone = bob.page;
    await phone.route("**/api/profiles/*/friends/inbox/*", async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      await new Promise((done) => setTimeout(done, 900));
      await route.fallback();
    });
    await look(phone);
    await expect(badge(phone)).toHaveText("1");
    await bell(phone).click();
    const line = phone.getByTestId("bell-sheet").getByTestId("inbox-recommendation");
    await expect(line).toHaveCount(1);
    await finger(phone, line, 150);
    // (Looked at every tenth of a second until it is gone: never back on the screen in the meantime.)
    const seen: number[] = [];
    for (let at = 0; at < 30 && (await line.count()) > 0; at++) {
      seen.push(await line.evaluate((element) => Number(getComputedStyle(element).opacity)).catch(() => 0));
      await phone.waitForTimeout(100);
    }
    await expect(line).toHaveCount(0);
    expect(seen.slice(3).filter((opacity) => opacity > 0.05), `opacity while the server answered: ${seen.join(" ")}`).toEqual([]);
  });
});
