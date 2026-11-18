import { expect, type Browser, type Page } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { openDevice, openTvSettings, openTvSignIn, SEEDED, test, withLibrary } from "./helpers";
import { TEST_ACCOUNT } from "./testAccount";

/**
 * A new profile is set up by whoever uses it first (the owner, 18 Nov: the name and the picture, the subtitle languages in their order, and the sections of
 * the library the profile watches; the others are not shown on it). These run against the second server of playwright.config.ts, which asks as the site
 * does; the server every other spec uses asks nothing (PROFILE_SETUP=off), so that their accounts open on what they are testing.
 */

const ORIGIN = `http://127.0.0.1:${(Number(process.env.E2E_PORT) || 8788) + 50}`;
const stored = (more: { name: string; value: string }[] = []) => ({ cookies: [], origins: [{ origin: ORIGIN, localStorage: [...SEEDED, ...more] }] });

let counter = 0;
const fresh = () => ({ ...TEST_ACCOUNT, email: TEST_ACCOUNT.email.replace("@", `+setup${Date.now().toString(36)}${++counter}@`) });

const title = (id: string, name: string, extra: Record<string, unknown>) => ({ id, title: name, url: `/fixtures/sample.mp4?t=${id}`, ...extra });
const shelf = (id: string, name: string, kind: "movie" | "series", section?: "cartoon" | "anime") => ({
  id,
  title: name,
  source: "Test Source",
  kind,
  ...(section ? { section } : {}),
  items: [1, 2, 3].map((n) => title(`${id}-${n}`, `${name} ${n}`, { kind, ...(section ? { section } : {}) })),
});
const library = {
  updatedAt: 1,
  rows: [shelf("films", "Film Shelf", "movie"), shelf("shows", "Show Shelf", "series"), shelf("toons", "Toon Shelf", "movie", "cartoon"), shelf("anime", "Manga Shelf", "series", "anime")],
};

async function openScreen(browser: Browser, viewport = { width: 1280, height: 720 }): Promise<Page> {
  const page = await openDevice(browser, { viewport, baseURL: ORIGIN, storageState: stored() }, {}, withLibrary(library));
  await page.goto("/tv");
  await expect(page.getByTestId("tv-browse")).toBeVisible();
  return page;
}

async function signUpOnScreen(screen: Page, account: { email: string; password: string }) {
  await openTvSignIn(screen);
  await screen.getByTestId("tv-signin-create").click();
  await screen.getByTestId("auth-email").fill(account.email);
  await screen.getByTestId("auth-password").fill(account.password);
  await screen.getByTestId("auth-submit").click();
}

const step = (page: Page) => page.getByTestId("profile-setup");
/** The page fits: nothing of it is off the side, and the button that goes on is on the screen. */
async function fits(page: Page, button: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "nothing is off the side").toBe(true);
  await expect(page.getByTestId(button)).toBeInViewport();
}

test.describe("a new profile is set up before anything else", () => {
  test("on a TV: the name and the picture, the subtitle languages in their order, the sections; then a library of those sections only", async ({ browser }) => {
    test.setTimeout(90_000);
    const tv = await openScreen(browser);
    await signUpOnScreen(tv, fresh());

    // 1 of 3: who it is. There is no way round it: Back leaves it where it is.
    await expect(step(tv)).toHaveAttribute("data-step", "who");
    await expect(tv.getByTestId("tv-setup")).toContainText(en["setup.welcome"]);
    await tv.keyboard.press("Escape");
    await expect(step(tv)).toHaveAttribute("data-step", "who");
    await expect(tv.getByTestId("profile-cancel")).toHaveCount(0);
    await fits(tv, "profile-save");
    await tv.getByTestId("profile-name-input").fill("Mia");
    const picture = tv.getByTestId("avatar-dragon");
    await picture.click();
    await expect(picture).toHaveAttribute("aria-checked", "true");
    await tv.getByTestId("profile-save").click();

    // 2 of 3: the subtitles. What a profile has without choosing is there to begin with (the page's language, then the site's others); a language pressed
    // is taken out, and pressed again it is the last in the order.
    await expect(step(tv)).toHaveAttribute("data-step", "subtitles");
    const order = tv.getByTestId("setup-subtitle-order");
    await expect(order).toHaveText(`${en["setup.main"]}: English  ·  ${en["setup.second"]}: Romanian  ·  ${en["setup.also"]}: Italian`);
    await tv.getByTestId("setup-lang-ro").click();
    await expect(order).toHaveText(`${en["setup.main"]}: English  ·  ${en["setup.second"]}: Italian`);
    await expect(tv.getByTestId("setup-lang-ro")).toHaveAttribute("aria-pressed", "false");
    await tv.getByTestId("setup-lang-ro").click();
    await expect(order).toHaveText(`${en["setup.main"]}: English  ·  ${en["setup.second"]}: Italian  ·  ${en["setup.also"]}: Romanian`);
    await expect(tv.getByTestId("setup-lang-ro")).toHaveAttribute("aria-pressed", "true");
    await fits(tv, "setup-next");
    await tv.getByTestId("setup-next").click();

    // 3 of 3: the sections. All four to begin with; the last one left cannot be turned off.
    await expect(step(tv)).toHaveAttribute("data-step", "sections");
    for (const section of ["movie", "series", "cartoon", "anime"]) await expect(tv.getByTestId(`section-choice-${section}`)).toHaveAttribute("aria-pressed", "true");
    for (const section of ["series", "cartoon", "anime"]) await tv.getByTestId(`section-choice-${section}`).click();
    await expect(tv.getByTestId("section-choice-movie")).toHaveAttribute("aria-disabled", "true");
    await tv.getByTestId("section-choice-movie").click({ force: true }); // (it says it cannot be pressed, and a press does nothing)
    await expect(tv.getByTestId("section-choice-movie")).toHaveAttribute("aria-pressed", "true");
    await tv.getByTestId("section-choice-series").click();
    // (Back is the page before, which has kept what was chosen; and this one keeps it too)
    await tv.getByTestId("setup-back").click();
    await expect(order).toContainText("Romanian");
    await tv.getByTestId("setup-next").click();
    await expect(tv.getByTestId("section-choice-cartoon")).toHaveAttribute("aria-pressed", "false");
    await fits(tv, "setup-next");
    await tv.getByTestId("setup-next").click();

    // The library, as the profile that was just made: its name, and only Movies and Series.
    await expect(step(tv)).toHaveCount(0);
    await expect(tv.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", /Mia/);
    await tv.getByTestId("rail-home").click();
    await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "home");
    await expect(tv.getByTestId("rail-movies")).toBeVisible();
    await expect(tv.getByTestId("rail-series")).toBeVisible();
    await expect(tv.getByTestId("rail-cartoons")).toHaveCount(0);
    await expect(tv.getByTestId("rail-anime")).toHaveCount(0);
    await expect(tv.getByText("Film Shelf", { exact: true }).first()).toBeVisible();
    await expect(tv.getByText("Show Shelf", { exact: true }).first()).toBeVisible();
    await expect(tv.getByText("Toon Shelf")).toHaveCount(0);
    await expect(tv.getByText("Manga Shelf")).toHaveCount(0);

    // It is asked once: the page opened again is the library.
    await tv.reload();
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(tv.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", /Mia/);
    await expect(step(tv)).toHaveCount(0);
    await expect(tv.getByTestId("rail-cartoons")).toHaveCount(0);

    // The settings have the same choice: Anime turned on there is in the menu and among the rows.
    await openTvSettings(tv);
    const line = tv.getByTestId("tv-sections-setting");
    await expect(line).toContainText("Movies, Series");
    await line.click();
    await expect(tv.getByTestId("tv-sections-settings")).toBeVisible();
    await tv.getByTestId("section-choice-anime").click();
    await tv.getByTestId("tv-sections-back").click();
    await expect(line).toContainText("Movies, Series, Anime");
    await tv.getByTestId("tv-account-back").click();
    await tv.getByTestId("rail-home").click();
    await expect(tv.getByTestId("rail-anime")).toBeVisible();
    await expect(tv.getByTestId("rail-cartoons")).toHaveCount(0);
    await expect(tv.getByText("Manga Shelf", { exact: true }).first()).toBeVisible();

    // A profile that is added has its name and picture already: it is asked the other two, the first time it is used, and watches everything unless it says.
    await openTvSettings(tv);
    await tv.getByTestId("tv-manage-profiles").click();
    await tv.getByTestId("profile-add").click();
    await tv.getByTestId("profile-name-input").fill("Noa");
    await tv.getByTestId("profile-save").click();
    await expect(tv.getByTestId("profile-Noa")).toBeVisible();
    await expect(step(tv)).toHaveCount(0); // (Mia is still the one in use)
    await tv.getByTestId("tv-profiles-done").click();
    await tv.getByTestId("tv-switch-profile").click();
    await tv.getByTestId("profile-Noa").click();
    await expect(step(tv)).toHaveAttribute("data-step", "subtitles");
    await expect(tv.getByTestId("setup-back")).toHaveCount(0);
    await tv.getByTestId("setup-next").click();
    await expect(step(tv)).toHaveAttribute("data-step", "sections");
    await tv.getByTestId("setup-next").click();
    await expect(step(tv)).toHaveCount(0);
    await expect(tv.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", /Noa/);
    await tv.getByTestId("rail-home").click();
    for (const id of ["rail-movies", "rail-series", "rail-cartoons", "rail-anime"]) await expect(tv.getByTestId(id)).toBeVisible();
  });

  test("with a TV's remote alone: the arrows and OK get through every page, and from the one section that cannot be turned off", async ({ browser }) => {
    test.setTimeout(60_000);
    const tv = await openScreen(browser);
    await signUpOnScreen(tv, fresh());
    const focused = (id: string) => tv.getByTestId(id).evaluate((element) => element === document.activeElement);
    /** Down until the remote is on `id` (a page's way on is under everything else on it). */
    const downTo = async (id: string) => {
      for (let press = 0; press < 12 && !(await focused(id)); press++) await tv.keyboard.press("ArrowDown");
      await expect(tv.getByTestId(id)).toBeFocused();
    };

    // The name (which has the remote), the pictures under it, Continue under those.
    await expect(step(tv)).toHaveAttribute("data-step", "who");
    await expect(tv.getByTestId("profile-name-input")).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await expect(tv.locator('[data-testid^="avatar-"]:focus')).toHaveCount(1);
    await tv.keyboard.press("ArrowRight");
    await tv.keyboard.press("Enter");
    await expect(tv.locator('[data-testid^="avatar-"]:focus')).toHaveAttribute("aria-checked", "true");
    await downTo("profile-save");
    await tv.keyboard.press("Enter");

    // The languages, and Continue under them; Back is beside it and is the page before.
    await expect(step(tv)).toHaveAttribute("data-step", "subtitles");
    await expect(tv.locator('[data-testid^="setup-lang-"]:focus')).toHaveCount(1);
    await downTo("setup-next");
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("setup-back")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(step(tv)).toHaveAttribute("data-step", "who");
    await downTo("profile-save");
    await tv.keyboard.press("Enter");
    await expect(step(tv)).toHaveAttribute("data-step", "subtitles");
    await downTo("setup-next");
    await tv.keyboard.press("Enter");

    // The sections: OK turns the one under the remote off, Right is the next; the last one left stays on, and Down from it is Done.
    await expect(step(tv)).toHaveAttribute("data-step", "sections");
    await expect(tv.getByTestId("section-choice-movie")).toBeFocused();
    for (const section of ["movie", "series", "cartoon"]) {
      await expect(tv.getByTestId(`section-choice-${section}`)).toBeFocused();
      await tv.keyboard.press("Enter");
      await expect(tv.getByTestId(`section-choice-${section}`)).toHaveAttribute("aria-pressed", "false");
      await tv.keyboard.press("ArrowRight");
    }
    await expect(tv.getByTestId("section-choice-anime")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("section-choice-anime")).toHaveAttribute("aria-pressed", "true");
    // (Down from the last section is the button nearest under it, which is Back; Done is beside it.)
    await tv.keyboard.press("ArrowDown");
    await expect(tv.locator('[data-testid="setup-next"]:focus, [data-testid="setup-back"]:focus')).toHaveCount(1);
    await tv.keyboard.press("ArrowLeft");
    await expect(tv.getByTestId("setup-next")).toBeFocused();
    await tv.keyboard.press("Enter");

    await expect(step(tv)).toHaveCount(0);
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(tv.getByTestId("rail-anime")).toBeVisible();
    await expect(tv.getByTestId("rail-movies")).toHaveCount(0);
    // (the remote is somewhere on the page: the next press of an arrow does something)
    expect(await tv.evaluate(() => document.activeElement !== null && document.activeElement !== document.body)).toBe(true);
  });

  test("a nickname typed when the account is made is the name the first page offers; the longer form fits the narrowest phone in Romanian and a 720p TV", async ({ browser }) => {
    const phone = await openDevice(
      browser,
      { viewport: { width: 320, height: 640 }, screen: { width: 320, height: 640 }, hasTouch: true, baseURL: ORIGIN, storageState: stored([{ name: "kino.lang", value: "ro" }]) },
      {},
      withLibrary(library),
    );
    await phone.goto("/");
    await expect(phone.getByTestId("tv-browse")).toBeVisible();
    await phone.getByTestId("tv-account-chip").tap();
    await phone.getByTestId("tv-profile-signin").tap();
    await phone.getByTestId("auth-switch").tap();
    const account = fresh();
    await phone.getByTestId("auth-email").fill(account.email);
    await phone.getByTestId("auth-password").fill(account.password);
    await phone.getByTestId("auth-nickname").fill("Ionuț");
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "nothing is off the side").toBe(true);
    for (const id of ["auth-email", "auth-password", "auth-nickname", "auth-submit"]) {
      const box = (await phone.getByTestId(id).boundingBox())!;
      expect(box.x, id).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, id).toBeLessThanOrEqual(320 + 0.5);
    }
    await phone.getByTestId("auth-submit").tap();
    await expect(step(phone)).toHaveAttribute("data-step", "who");
    await expect(phone.getByTestId("profile-name-input")).toHaveValue("Ionuț");

    const tv = await openScreen(browser);
    await openTvSignIn(tv);
    await tv.getByTestId("tv-signin-create").click();
    const other = fresh();
    await tv.getByTestId("auth-email").fill(other.email);
    await tv.getByTestId("auth-password").fill(other.password);
    await tv.getByTestId("auth-nickname").fill("Telly");
    await fits(tv, "auth-submit");
    await tv.getByTestId("auth-submit").click();
    await expect(step(tv)).toHaveAttribute("data-step", "who");
    await expect(tv.getByTestId("profile-name-input")).toHaveValue("Telly");
  });

  test("on a phone held upright: the three pages fit it, and the library has buttons for its sections only", async ({ browser }) => {
    test.setTimeout(60_000);
    const phone = await openDevice(
      browser,
      { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, hasTouch: true, baseURL: ORIGIN, storageState: stored() },
      {},
      withLibrary(library),
    );
    await phone.goto("/");
    await expect(phone.getByTestId("tv-browse")).toBeVisible();
    // (a phone that is the screen signs in with the typed form first)
    const account = fresh();
    await phone.getByTestId("tv-account-chip").tap();
    await phone.getByTestId("tv-profile-signin").tap();
    await phone.getByTestId("auth-switch").tap();
    await expect(phone.getByTestId("auth-form")).toHaveAttribute("data-mode", "signUp");
    await phone.getByTestId("auth-email").fill(account.email);
    await phone.getByTestId("auth-password").fill(account.password);
    await phone.getByTestId("auth-submit").tap();

    await expect(step(phone)).toHaveAttribute("data-step", "who");
    await fits(phone, "profile-name-input");
    await phone.getByTestId("profile-name-input").fill("Ana");
    await phone.getByTestId("profile-save").click();
    await expect(step(phone)).toHaveAttribute("data-step", "subtitles");
    await fits(phone, "setup-next");
    await phone.getByTestId("setup-next").click();
    await expect(step(phone)).toHaveAttribute("data-step", "sections");
    await fits(phone, "setup-next");
    await phone.getByTestId("section-choice-movie").click();
    await phone.getByTestId("section-choice-series").click();
    await phone.getByTestId("setup-next").click();
    await expect(step(phone)).toHaveCount(0);

    await phone.getByTestId("rail-home").click();
    await expect(phone.getByTestId("tv-browse")).toHaveAttribute("data-view", "home");
    const sections = phone.locator(".tv-sections");
    await expect(sections).toContainText(en["tv.cartoons"]);
    await expect(sections).toContainText(en["tv.anime"]);
    await expect(sections).not.toContainText(en["tv.movies"]);
    await expect(sections).not.toContainText(en["tv.series"]);
    await expect(phone.getByText("Toon Shelf", { exact: true }).first()).toBeVisible();
    await expect(phone.getByText("Film Shelf")).toHaveCount(0);
  });

  test("on a phone that is a remote: asked there too, before the remote", async ({ browser }) => {
    test.setTimeout(60_000);
    const phone = await openDevice(browser, { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, hasTouch: true, baseURL: ORIGIN, storageState: stored([{ name: "kino.role", value: "remote" }]) });
    await phone.goto("/");
    const account = fresh();
    await phone.getByTestId("account-button").click();
    await phone.getByTestId("auth-switch").click();
    await phone.getByTestId("auth-email").fill(account.email);
    await phone.getByTestId("auth-password").fill(account.password);
    await phone.getByTestId("auth-submit").click();

    await expect(phone.getByTestId("setup-profile")).toBeVisible();
    await expect(step(phone)).toHaveAttribute("data-step", "who");
    await fits(phone, "profile-name-input");
    await phone.getByTestId("profile-name-input").fill("Remo");
    await phone.getByTestId("avatar-popcorn").click();
    await phone.getByTestId("profile-save").click();
    await expect(step(phone)).toHaveAttribute("data-step", "subtitles");
    await phone.getByTestId("setup-lang-it").click();
    await fits(phone, "setup-next");
    await phone.getByTestId("setup-next").click();
    await expect(step(phone)).toHaveAttribute("data-step", "sections");
    await phone.getByTestId("section-choice-anime").click();
    await fits(phone, "setup-next");
    await phone.getByTestId("setup-next").click();
    await expect(phone.getByTestId("setup-profile")).toHaveCount(0);

    // The settings of the account have what was chosen.
    await phone.getByTestId("account-button").click();
    await expect(phone.getByTestId("account-screen")).toContainText("Remo");
    await phone.getByTestId("menu-settings").click();
    await expect(phone.getByTestId("settings-page")).toBeVisible();
    await expect(phone.getByTestId("section-choice-anime")).toHaveAttribute("aria-pressed", "false");
    await expect(phone.getByTestId("section-choice-movie")).toHaveAttribute("aria-pressed", "true");
  });
});
