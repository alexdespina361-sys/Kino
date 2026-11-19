import { expect, type Browser, type Page } from "@playwright/test";
import { AVATAR_IDS, type NormalizedMedia } from "../src/shared";
import { weakness } from "../src/client/account/password";
import { LATEST } from "../src/client/changelog/news";
import { en } from "../src/client/i18n/en";
import { it as italian } from "../src/client/i18n/it";
import { ro } from "../src/client/i18n/ro";
import { guestStorage, openDevice, openLibrary, openProfilePlace, openTv, openTvSettings, openTvSignIn, PHONE, place, pressMenuLine, RawPhone, readPairingCode, test, tvRoot, PICTURE_NAME, PICTURE_NAMED, loginName, nameFirstProfile } from "./helpers";
import { TEST_ACCOUNT, TEST_ACCOUNT_B } from "./testAccount";

let counter = 0;
const fresh = (base: { email: string; password: string } = TEST_ACCOUNT) => ({ ...base, email: base.email.replace("@", `+${Date.now().toString(36)}${++counter}@`) });

const newPhone = (browser: Browser, seed: Record<string, string> = {}, locale = "en-US") => openDevice(browser, { ...PHONE, locale }, seed);

async function signUp(page: Page, account: { email: string; password: string }, options: { asMade?: boolean } = {}) {
  await page.getByTestId("account-button").click();
  await page.getByTestId("auth-switch").click();
  await expect(page.getByTestId("auth-form")).toHaveAttribute("data-mode", "signUp");
  await page.getByTestId("auth-email").fill(account.email);
  await page.getByTestId("auth-password").fill(account.password);
  await page.getByTestId("auth-submit").click();
  if (weakness(account.email, account.password)) await page.getByTestId("auth-agree").click();
  await expect(page.getByTestId("account-profile-name")).toHaveText(PICTURE_NAME);
  if (options.asMade) return;
  await nameFirstProfile(page, loginName(account.email));
  await page.getByTestId("account-button").click();
  await expect(page.getByTestId("account-profile-name")).toHaveText(loginName(account.email));
  await expect(page.getByTestId("account-button")).toHaveAttribute("aria-label", new RegExp(loginName(account.email)));
}

async function signIn(page: Page, account: { email: string; password: string }) {
  await page.getByTestId("account-button").click();
  await page.getByTestId("auth-email").fill(account.email);
  await page.getByTestId("auth-password").fill(account.password);
  await page.getByTestId("auth-submit").click();
}

const savedToTheAccount = (page: Page) =>
  expect
    .poll(
      () =>
        page.evaluate(() => {
          const profile = localStorage.getItem("kino.profile");
          const saved = profile ? (JSON.parse(localStorage.getItem(`kino.data.${profile}`) ?? "null") as { dirty: string[]; rev: number } | null) : null;
          return saved ? { pending: saved.dirty.length, heard: saved.rev > 0 } : null;
        }),
      { timeout: 20_000 },
    )
    .toEqual({ pending: 0, heard: true });

const guestCopy = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("kino.data.guest") ?? "null") as { data: { progress: unknown[]; list: unknown[]; listNames: unknown[] } } | null);

test.describe("accounts and profiles", () => {
  test("Tab goes round the page that is open, in both directions, and never out of it into the remote behind", async ({ browser }) => {
    const phone = await newPhone(browser);
    await phone.goto("/");
    await signUp(phone, fresh());
    await expect(phone.getByTestId("account-screen")).toBeVisible();
    const onThePage = () => phone.evaluate(() => document.activeElement?.closest(".page") !== null && document.activeElement !== document.body);

    for (const [row, page] of [["menu-settings", "settings-page"], ["menu-news", "news-page"], ["menu-devices", "devices-page"], ["menu-security", "security-page"]] as const) {
      await phone.getByTestId(row).click();
      await expect(phone.getByTestId(page)).toBeVisible();
      expect(await onThePage(), `${page}: the keyboard starts on the page`).toBe(true);
      const controls = await phone.locator(".page button, .page input, .page select, .page a[href]").count();
      for (const key of ["Tab", "Shift+Tab"]) {
        const where: boolean[] = [];
        for (let i = 0; i < controls + 3; i++) {
          await phone.keyboard.press(key);
          where.push(await onThePage());
        }
        expect(where, `${page}, ${key}`).not.toContain(false);
      }
      await phone.keyboard.press("Escape");
      await expect(phone.getByTestId("account-screen")).toBeVisible();
    }
  });

  test("What's new is a row of the account's menu, the newest version beside it, opening every version with the newest first", async ({ browser }) => {
    const phone = await newPhone(browser);
    await phone.goto("/");
    await signUp(phone, fresh());
    await expect(phone.getByTestId("menu-news")).toContainText(`Kino ${LATEST.version}`);
    await phone.getByTestId("menu-news").click();
    await expect(phone.getByTestId("news-page")).toBeVisible();
    await expect(phone.locator(".news-version").first()).toHaveAttribute("data-version", LATEST.version);
    await expect(phone.locator(".news-lines li").first()).toBeVisible();
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await phone.keyboard.press("Escape");
    await expect(phone.getByTestId("account-screen")).toBeVisible();
  });

  test("a guest has What's new in the account's menu too", async ({ browser }) => {
    const phone = await newPhone(browser);
    await phone.goto("/");
    await phone.getByTestId("account-button").click();
    await expect(phone.getByTestId("menu-news")).toContainText(`Kino ${LATEST.version}`);
    await phone.getByTestId("menu-news").click();
    await expect(phone.getByTestId("news-page")).toBeVisible();
    await expect(phone.locator(".news-lines li").first()).toBeVisible();
  });

  test("a nickname typed when the account is made is the first profile's name, on the phone and on the TV; only making an account asks for one", async ({ browser }) => {
    const phone = await newPhone(browser);
    await phone.goto("/");
    await phone.getByTestId("account-button").click();
    await expect(phone.getByTestId("auth-nickname")).toHaveCount(0);
    await phone.getByTestId("auth-switch").click();
    await expect(phone.getByTestId("auth-nickname")).toHaveAttribute("maxlength", "16");
    await phone.getByTestId("auth-email").fill(`nick-login-${Date.now().toString(36)}${++counter}`);
    await phone.getByTestId("auth-password").fill("kino-test-pass-1");
    await phone.getByTestId("auth-nickname").fill(" Mira ");
    await phone.getByTestId("auth-submit").click();
    await expect(phone.getByTestId("account-profile-name")).toHaveText("Mira");

    const tv = await openLibrary(browser);
    await openTvSignIn(tv);
    await tv.getByTestId("tv-signin-email").click();
    await tv.getByTestId("auth-switch").click();
    await expect(tv.getByTestId("auth-form")).toHaveAttribute("data-mode", "signUp");
    await tv.getByTestId("auth-email").fill(`nick-tv-${Date.now().toString(36)}${++counter}`);
    await tv.getByTestId("auth-password").fill("kino-test-pass-1");
    await tv.getByTestId("auth-nickname").fill("Telly");
    await tv.getByTestId("auth-submit").click();
    await expect(tv.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", /Telly/);
  });

  test("an account has a first profile, up to five can be added, and signing in again brings them all back", async ({ browser }) => {
    test.setTimeout(60_000);
    const account = { email: `Robert ${Date.now().toString(36)}${++counter}`, password: "1" };
    const phone = await newPhone(browser);
    await phone.goto("/");
    await signUp(phone, account, { asMade: true });

    await expect(phone.getByTestId("account-profile-name")).toHaveText(PICTURE_NAME);
    const first = (await phone.getByTestId("account-profile-name").innerText()).trim();

    await phone.getByTestId("menu-profiles").click();
    for (const name of ["Maya", "Sam", "Noa", "Kim"]) {
      await phone.getByTestId("profile-add").click();
      await expect(phone.locator('[data-testid^="avatar-"]')).toHaveCount(AVATAR_IDS.length);
      if (name === "Maya") {
        const picture = phone.getByTestId(`avatar-${AVATAR_IDS[7]}`);
        await picture.click();
        await expect(picture).toHaveAttribute("aria-checked", "true");
      }
      await phone.getByTestId("profile-name-input").fill(name);
      await phone.getByTestId("profile-save").click();
      await expect(phone.getByTestId(`profile-${name}`)).toBeVisible();
    }
    await expect(phone.getByTestId("profile-add")).toHaveCount(0);

    await phone.getByTestId("profile-Kim").click();
    await phone.getByTestId("profile-delete").click();
    await phone.getByTestId("profile-delete-confirm").click();
    await expect(phone.getByTestId("profile-Kim")).toHaveCount(0);
    await expect(phone.getByTestId("profile-add")).toBeVisible();

    await phone.getByTestId("page-back").click();
    await phone.getByTestId("sign-out").click();
    await expect(phone.getByTestId("account-button")).toContainText(en["account.signInPrompt"]);
    await signIn(phone, account);
    const picker = phone.getByRole("dialog", { name: en["profiles.title"] });
    await expect(picker).toBeVisible();
    for (const name of [first, "Maya", "Sam", "Noa"]) await expect(picker.getByTestId(`profile-${name}`)).toBeVisible();
    await expect(picker.getByTestId("profile-Kim")).toHaveCount(0);
    await picker.getByTestId("profile-Maya").click();
    await expect(phone.getByTestId("account-button")).toHaveAttribute("aria-label", /Maya/);
  });

  test("a sign-out that the server does not hear leaves the person signed in and says so, instead of looking signed out while the session lives on", async ({ browser }) => {
    test.setTimeout(60_000);
    const account = { email: `Robert ${Date.now().toString(36)}${++counter}`, password: "1" };
    const phone = await newPhone(browser);
    await phone.goto("/");
    await signUp(phone, account);
    await expect(phone.getByTestId("account-button")).toHaveAttribute("aria-label", /Robert/);

    await phone.route("**/api/auth/logout", (route) => route.abort());
    await phone.getByTestId("sign-out").click();
    await expect(phone.getByTestId("account-toast")).toHaveText(en["account.signOutFailed"]);
    await expect(phone.getByTestId("account-button")).toHaveAttribute("aria-label", /Robert/);
    await phone.unroute("**/api/auth/logout");
    await phone.reload();
    await expect(phone.getByTestId("account-button")).toHaveAttribute("aria-label", /Robert/);

    await phone.getByTestId("account-button").click();
    await phone.getByTestId("sign-out").click();
    await expect(phone.getByTestId("account-button")).toContainText(en["account.signInPrompt"]);
    await phone.reload();
    await expect(phone.getByTestId("account-button")).toContainText(en["account.signInPrompt"]);
  });

  test("a screen that was signed in stays that person while the server cannot be reached as its page opens, and the cookie is renewed when it can", async ({ browser }) => {
    test.setTimeout(60_000);
    const account = { email: `Robert ${Date.now().toString(36)}${++counter}`, password: "1" };
    const phone = await newPhone(browser);
    await phone.goto("/");
    await signUp(phone, account);
    await expect(phone.getByTestId("account-button")).toHaveAttribute("aria-label", /Robert/);

    await phone.route("**/api/me", (route) => route.abort());
    await phone.reload();
    await expect(phone.getByTestId("account-button")).toHaveAttribute("aria-label", /Robert/);
    await phone.unroute("**/api/me");

    const answer = await phone.evaluate(async () => {
      const response = await fetch("/api/me", { cache: "no-store" });
      return { me: ((await response.json()) as { me: { account: { email: string } } | null }).me?.account.email };
    });
    expect(answer.me).toMatch(/^robert /);
    const header = await phone.context().cookies();
    const cookie = header.find((entry) => entry.name === "kino_session");
    expect(cookie).toBeDefined();
    expect(cookie!.expires - Date.now() / 1000).toBeGreaterThan(399 * 24 * 3600);
  });

  test("deleting the account: a wrong password is called a wrong password, and afterwards the page says the account is gone, not that the person was signed out", async ({ browser }) => {
    test.setTimeout(60_000);
    const account = { email: `Robert ${Date.now().toString(36)}${++counter}`, password: "1" };
    const phone = await newPhone(browser);
    await phone.goto("/");
    await signUp(phone, account, { asMade: true });
    await expect(phone.getByTestId("account-profile-name")).toHaveText(PICTURE_NAME);
    const turnedAway: string[] = [];
    phone.on("response", (response) => {
      if (response.status() === 401) turnedAway.push(new URL(response.url()).pathname);
    });

    await phone.getByTestId("menu-security").click();
    await phone.getByTestId("delete-account").click();
    await expect(phone.getByTestId("delete-password")).toHaveCount(0);
    await expect(phone.getByTestId("delete-confirm")).toBeDisabled();
    expect(await phone.locator(".editor-actions button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-testid")))).toEqual(["delete-cancel", "delete-confirm"]);
    await phone.getByTestId("delete-word").fill("understood");
    await phone.getByTestId("delete-password").fill("2");
    await phone.getByTestId("delete-confirm").click();
    await expect(phone.getByTestId("delete-error")).toHaveText(en["error.wrong_password"]);

    await phone.getByTestId("delete-password").fill(account.password);
    await phone.getByTestId("delete-confirm").click();
    await expect(phone.getByTestId("account-toast")).toHaveText(en["account.deleted"]);
    await expect(phone.getByTestId("account-button")).toContainText(en["account.signInPrompt"]);
    await phone.waitForTimeout(800);
    expect(turnedAway).toEqual(["/api/me/delete"]);
  });

  test("an account can have no password: the empty field says what that means, the sign-up says it again and asks, and signing in with nothing opens it", async ({ browser }) => {
    test.setTimeout(60_000);
    const account = { email: `Guest ${Date.now().toString(36)}${++counter}`, password: "" };
    const phone = await newPhone(browser);
    await phone.goto("/");
    await phone.getByTestId("account-button").click();
    await phone.getByTestId("auth-switch").click();
    await phone.getByTestId("auth-email").fill(account.email);
    await expect(phone.getByTestId("auth-password-hint")).toHaveText(en["auth.noPasswordNote"]);
    await phone.getByTestId("auth-password").fill("1");
    await expect(phone.getByTestId("auth-password-hint")).toHaveText(en["auth.passwordHint"]);
    await phone.getByTestId("auth-password").fill("");
    await phone.getByTestId("auth-submit").click();

    const asking = phone.getByTestId("auth-warning");
    await expect(asking).toHaveAttribute("data-kind", "none");
    await expect(asking).toContainText(en["auth.warnNone"]);
    await expect(asking).toContainText(en["auth.warnAsk"]);
    await phone.getByTestId("auth-agree").click();
    await expect(phone.getByTestId("account-profile-name")).toHaveText(PICTURE_NAME);
    const named = (await phone.getByTestId("account-profile-name").innerText()).trim();

    await phone.getByTestId("sign-out").click();
    await expect(phone.getByTestId("account-button")).toContainText(en["account.signInPrompt"]);
    await signIn(phone, account);
    await expect(phone.getByTestId("account-profile-name")).toHaveText(named);
  });

  test("a poor password is asked about before the account is made: changing it goes back to the form as it was, a good one needs no question", async ({ browser }) => {
    test.setTimeout(60_000);
    const account = { email: `Weak ${Date.now().toString(36)}${++counter}`, password: "abc" };
    const phone = await newPhone(browser);
    await phone.goto("/");
    await phone.getByTestId("account-button").click();
    await phone.getByTestId("auth-switch").click();
    await phone.getByTestId("auth-email").fill(account.email);
    await phone.getByTestId("auth-password").fill(account.password);
    await phone.getByTestId("auth-submit").click();

    const asking = phone.getByTestId("auth-warning");
    await expect(asking).toHaveAttribute("data-kind", "weak");
    await expect(asking).toContainText(en["auth.warnWeak"]);
    await expect(phone.getByTestId("auth-form")).toHaveCount(0);
    await expect(phone.getByTestId("auth-change")).toBeFocused();
    expect(((await (await phone.request.get("/api/me")).json()) as { me: unknown }).me).toBeNull();

    await phone.getByTestId("auth-change").click();
    await expect(phone.getByTestId("auth-warning")).toHaveCount(0);
    await expect(phone.getByTestId("auth-email")).toHaveValue(account.email);
    await expect(phone.getByTestId("auth-password")).toHaveValue(account.password);
    await expect(phone.getByTestId("auth-password")).toBeFocused();

    await phone.getByTestId("auth-password").fill("kino-test-pass-1");
    await phone.getByTestId("auth-submit").click();
    await expect(phone.getByTestId("account-profile-name")).toHaveText(PICTURE_NAME);
    await expect(phone.getByTestId("auth-warning")).toHaveCount(0);
  });

  test("a wrong password is refused in plain words", async ({ browser }) => {
    const phone = await newPhone(browser);
    await phone.goto("/");
    await signIn(phone, { email: TEST_ACCOUNT_B.email, password: "not-the-password-1" });
    await expect(phone.getByTestId("auth-error")).toHaveText(en["error.invalid_credentials"]);
    await phone.getByTestId("page-back").click();
    await expect(phone.getByTestId("account-button")).toContainText(en["account.signInPrompt"]);
  });
});

test.describe("what was watched follows the person", () => {
  const night = { key: "url:https://films.example/night-train", at: Date.now() - 60_000, title: "Night Train", url: "https://films.example/night-train", position: 1500, duration: 6000 };
  const saved = { key: "url:https://films.example/saved", at: Date.now() - 120_000, id: "s1", title: "Saved For Later", url: "https://films.example/saved" };
  const weekend = { key: "lweekend", at: Date.now() - 110_000, name: "Weekend" };
  const picked = { key: "lweekend|url:https://films.example/picked", at: Date.now() - 100_000, list: "lweekend", id: "p1", title: "Weekend Pick", url: "https://films.example/picked" };

  test("what a guest watched joins the account on signing in, and another device carries on from there", async ({ browser }) => {
    test.setTimeout(60_000);
    const account = fresh();

    const first = await newPhone(browser, guestStorage({ progress: [night], list: [saved, picked], listNames: [weekend] }));
    await first.goto("/");
    await signUp(first, account, { asMade: true });
    const named = (await first.getByTestId("account-profile-name").innerText()).trim();
    await expect(first.getByTestId("account-toast")).toContainText(named);
    await savedToTheAccount(first);
    const left = await guestCopy(first);
    expect(left?.data.progress).toHaveLength(0);
    expect(left?.data.list).toHaveLength(0);
    expect(left?.data.listNames).toHaveLength(0);

    const tv = await openTv(browser);
    const second = await newPhone(browser);
    await second.goto("/");
    await signIn(second, account);
    await expect(second.getByTestId("account-profile-name")).toHaveText(named);
    await second.getByTestId("page-back").click();
    await second.getByTestId("code-input").fill(await readPairingCode(tv));
    await expect(second.getByTestId("tv-online")).toHaveText("TV connected");

    const continuing = second.getByTestId("continue-row");
    await expect(continuing).toContainText("Night Train");
    await expect(continuing).toContainText("1 h 15 min left");
    await place(second, "list");
    await expect(second.getByRole("region", { name: "Favourites" })).toContainText("Saved For Later");
    await expect(second.getByRole("region", { name: "Weekend" })).toContainText("Weekend Pick");

    await second.getByTestId("account-button").click();
    await second.getByTestId("menu-devices").click();
    await second.getByTestId("signout-others").click();
    await expect(second.getByRole("status").filter({ hasText: en["account.signedOutOthers"] })).toBeVisible();
    await first.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(first.getByTestId("account-toast")).toHaveText(en["error.signed_out"]);
    await expect(first.getByTestId("account-button")).toContainText(en["account.signInPrompt"]);
  });

  test("signing out leaves nothing of the account on the screen", async ({ browser }) => {
    const account = fresh();
    const phone = await newPhone(browser, guestStorage({ progress: [night] }));
    await phone.goto("/");
    await signUp(phone, account);
    await expect(phone.getByTestId("account-profile-name")).toHaveText("Viewer");
    await savedToTheAccount(phone);

    await phone.getByTestId("sign-out").click();
    await expect(phone.getByTestId("account-button")).toContainText(en["account.signInPrompt"]);
    await expect.poll(() => phone.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("kino.data.")))).toEqual(["kino.data.guest"]);
    expect((await guestCopy(phone))?.data.progress).toHaveLength(0);
  });
});

test.describe("signing a TV in from the phone", () => {
  async function askToSignIn(browser: Browser) {
    const phone = await newPhone(browser);
    await phone.goto("/");
    await signUp(phone, fresh());
    await expect(phone.getByTestId("account-profile-name")).toHaveText("Viewer");

    const tv = await openLibrary(browser);
    await openTvSignIn(tv);
    const code = tv.getByTestId("tv-link-code");
    await expect(code).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const shown = (await code.textContent())!.trim();

    await phone.goto(`/?link=${shown.replace("-", "")}`);
    await expect(phone.getByTestId("link-code")).toHaveText(shown);
    return { phone, tv };
  }

  test("the TV shows a code, a signed-in phone approves it, and the TV is signed in", async ({ browser }) => {
    const { phone, tv } = await askToSignIn(browser);
    await phone.getByTestId("link-approve-button").click();
    await expect(phone.getByTestId("link-done")).toBeVisible();
    await expect(tv.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", /Viewer/, { timeout: 15_000 });
  });

  test("signing the other devices out reaches the TV that goes with the phone at once, not at its next exchange with the server", async ({ browser }) => {
    test.setTimeout(60_000);
    const { phone, tv } = await askToSignIn(browser);
    await phone.getByTestId("link-approve-button").click();
    await expect(tv.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", /Viewer/, { timeout: 15_000 });

    await tv.getByTestId("rail-connect").click();
    await phone.goto("/");
    await phone.getByTestId("code-input").fill(await readPairingCode(tv));
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");

    await phone.getByTestId("account-button").click();
    await phone.getByTestId("menu-devices").click();
    await expect(phone.getByTestId("device")).toHaveCount(2);

    const tvRow = phone.locator('[data-testid="device"][data-current="false"]');
    const name = tvRow.getByTestId("device-name-input");
    await tvRow.getByTestId("device-rename").click();
    await name.fill("Living room TV");
    await name.press("Enter");
    await expect(tvRow.getByTestId("device-rename")).toContainText("Living room TV");
    await tvRow.getByTestId("device-rename").click();
    await name.fill("Never mind");
    await name.press("Escape");
    await expect(tvRow.getByTestId("device-rename")).toContainText("Living room TV");
    await expect(phone.getByTestId("devices-page")).toBeVisible();

    await phone.getByTestId("signout-others").click();
    await expect(tv.getByTestId("tv-account-toast")).toHaveText(en["error.signed_out"], { timeout: 10_000 });
  });

  test("the Devices page holds every device: a TV's code typed there signs it in, Back comes back to the page, and one device can be signed out alone", async ({ browser }) => {
    test.setTimeout(60_000);
    const phone = await newPhone(browser);
    await phone.goto("/");
    await signUp(phone, fresh());
    await expect(phone.getByTestId("account-profile-name")).toHaveText("Viewer");
    await expect(phone.getByTestId("menu-link")).toHaveCount(0);

    const tv = await openLibrary(browser);
    await openTvSignIn(tv);
    const code = tv.getByTestId("tv-link-code");
    await expect(code).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const shown = (await code.textContent())!.trim();

    await phone.getByTestId("menu-devices").click();
    await expect(phone.getByTestId("devices-page")).toBeVisible();
    await expect(phone.getByTestId("device")).toHaveCount(1);
    await expect(phone.getByTestId("devices-tvs")).toHaveCount(0);
    await phone.getByTestId("link-code-input").fill(shown);
    await expect(phone.getByTestId("approve-page")).toBeVisible();
    await expect(phone.getByTestId("link-code")).toHaveText(shown);
    await phone.getByTestId("link-approve-button").click();
    await expect(phone.getByTestId("link-done")).toBeVisible();
    await expect(tv.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", /Viewer/, { timeout: 15_000 });

    await phone.getByTestId("link-close").click();
    await expect(phone.getByTestId("devices-page")).toBeVisible();
    await expect(phone.getByTestId("device")).toHaveCount(2);
    await phone.locator('[data-testid="device"][data-current="false"]').getByTestId("device-signout").click();
    await expect(phone.getByTestId("device")).toHaveCount(1);
    await tv.reload();
    await expect(tv.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", en["account.signInPrompt"], { timeout: 15_000 });
    await expect(phone.getByTestId("devices-page")).toBeVisible();
  });

  test("on a phone that controls a TV, the Devices page has a row for its TVs, which opens the same list as the TV's menu", async ({ browser }) => {
    const phone = await newPhone(browser);
    await phone.goto("/");
    await signUp(phone, fresh());
    await expect(phone.getByTestId("account-profile-name")).toHaveText("Viewer");
    const tv = await openTv(browser);
    await phone.goto("/");
    await phone.getByTestId("code-input").fill(await readPairingCode(tv));
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");

    await phone.getByTestId("account-button").click();
    await phone.getByTestId("menu-devices").click();
    await expect(phone.getByTestId("devices-tvs")).toContainText(en["menu.tvs"]);
    await phone.getByTestId("devices-tvs").click();
    await expect(phone.getByTestId("tvs-sheet")).toBeVisible();
    await expect(phone.getByTestId("tv-row")).toHaveCount(1);
    await phone.keyboard.press("Escape");
    await expect(phone.getByTestId("tvs-sheet")).toHaveCount(0);
    await expect(phone.getByTestId("devices-page")).toBeVisible();
  });

  test("a phone that says no leaves the TV signed out", async ({ browser }) => {
    const { phone, tv } = await askToSignIn(browser);
    await phone.getByTestId("link-deny-button").click();
    await expect(phone.getByTestId("link-done")).toBeVisible();
    await expect(tv.getByTestId("tv-signin-status")).toContainText(en["link.denied"], { timeout: 10_000 });
    await tv.getByTestId("tv-signin-back").click();
    await expect(tv.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", en["account.signInPrompt"]);
  });
});

test.describe("a TV that nobody is at", () => {
  test("asks for a second code, and then rests until the button is pressed", async ({ browser }) => {
    const FIVE_MINUTES = 5 * 60_000;
    let starts = 0;
    let polls = 0;
    const tv = await openLibrary(browser, async (context) => {
      await context.clock.install();
      await context.route("**/api/link/start", async (route) => {
        starts += 1;
        const now = await route.request().frame().evaluate(() => Date.now());
        await route.fulfill({ status: 201, json: { code: `TEST000${starts}`, secret: "s", expiresAt: now + FIVE_MINUTES } });
      });
      await context.route("**/api/link/poll", (route) => {
        polls += 1;
        return route.fulfill({ json: { status: "waiting" } });
      });
    });
    await openTvSignIn(tv);
    await expect(tv.getByTestId("tv-link-code")).toHaveText("TEST-0001");
    await expect(tv.getByTestId("tv-signin-again")).toHaveCount(0);

    await tv.clock.fastForward(FIVE_MINUTES + 2500);
    await expect(tv.getByTestId("tv-link-code")).toHaveText("TEST-0002");
    await expect(tv.getByTestId("tv-signin-again")).toHaveCount(0);

    await tv.clock.fastForward(FIVE_MINUTES + 2500);
    await expect(tv.getByTestId("tv-signin-status")).toHaveText(en["link.rested"]);
    await expect(tv.getByTestId("tv-signin-again")).toHaveText(en["link.newCode"]);
    await expect(tv.getByTestId("tv-signin-again")).toBeFocused();
    await expect(tv.getByTestId("tv-link-code")).not.toHaveText("TEST-0002");

    const [startsThen, pollsThen] = [starts, polls];
    await tv.clock.fastForward(60 * 60_000);
    await tv.waitForTimeout(300);
    expect([starts, polls]).toEqual([startsThen, pollsThen]);

    await tv.getByTestId("tv-signin-again").click();
    await expect(tv.getByTestId("tv-link-code")).toHaveText(`TEST-000${startsThen + 1}`);
    await expect(tv.getByTestId("tv-signin-again")).toHaveCount(0);
    await expect(tv.getByTestId("tv-signin-status")).toContainText(en["link.waiting"]);
  });

  test("keeps the code it was given when its own clock is minutes ahead of the server's", async ({ browser }) => {
    let starts = 0;
    const tv = await openLibrary(browser, async (context) => {
      await context.route("**/api/link/start", async (route) => {
        starts += 1;
        const now = await route.request().frame().evaluate(() => Date.now());
        await route.fulfill({ status: 201, json: { code: `TEST000${starts}`, secret: "s", expiresAt: now - 5 * 60_000 } });
      });
      await context.route("**/api/link/poll", (route) => route.fulfill({ json: { status: "waiting" } }));
    });
    await openTvSignIn(tv);
    await expect(tv.getByTestId("tv-link-code")).toHaveText("TEST-0001");
    await tv.waitForTimeout(4500);
    expect(starts).toBe(1);
    await expect(tv.getByTestId("tv-link-code")).toHaveText("TEST-0001");
    await expect(tv.getByTestId("tv-signin-status")).toContainText(en["link.waiting"]);
  });
});

async function signedInScreen(browser: Browser, account = fresh()) {
  const screen = await openLibrary(browser);
  await openTvSignIn(screen);
  await screen.getByTestId("tv-signin-create").click();
  await expect(screen.getByTestId("auth-form")).toHaveAttribute("data-mode", "signUp");
  await expect(screen.locator(".tv-headline").first()).toHaveText(en["auth.signUp"]);
  await screen.getByTestId("auth-email").fill(account.email);
  await screen.getByTestId("auth-password").fill(account.password);
  await screen.getByTestId("auth-submit").click();
  await expect(screen.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", PICTURE_NAMED);
  await nameFirstProfile(screen, loginName(account.email));
  await expect(screen.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", new RegExp(loginName(account.email)));
  return screen;
}

test.describe("signing a screen in from another screen", () => {
  async function screenAskingToSignIn(browser: Browser) {
    const other = await openLibrary(browser);
    await openTvSignIn(other);
    const code = other.getByTestId("tv-link-code");
    await expect(code).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    return { other, shown: (await code.textContent())!.trim() };
  }

  const openApprove = async (screen: Page) => {
    await openTvSettings(screen);
    await screen.getByTestId("tv-approve").click();
  };

  test("the code is typed as it was read, the request names the code, and only then does the other screen get signed in", async ({ browser }) => {
    const screen = await signedInScreen(browser);
    const { other, shown } = await screenAskingToSignIn(browser);

    await openApprove(screen);
    await screen.getByTestId("tv-approve-input").pressSequentially(shown.replace("-", "").toLowerCase());
    await expect(screen.getByTestId("tv-approve-code")).toHaveText(shown);

    await expect(screen.getByTestId("tv-approve-yes")).not.toBeFocused();
    await screen.keyboard.press("Enter");
    await expect(screen.getByTestId("tv-approve-yes")).toBeFocused();
    await expect(other.getByTestId("tv-signin")).toBeVisible();
    await screen.keyboard.press("Enter");

    await expect(screen.getByTestId("tv-approve-done")).toContainText(en["link.approved"]);
    await expect(other.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", /Viewer/, { timeout: 15_000 });
    await screen.getByTestId("tv-approve-close").click();
    await expect(screen.getByTestId("tv-account")).toBeVisible();
  });

  test("a code nobody is showing is refused in words, and a request turned down leaves the other screen signed out", async ({ browser }) => {
    const screen = await signedInScreen(browser);
    await openApprove(screen);

    await screen.getByTestId("tv-approve-input").fill("ZZZZ-ZZZZ");
    await expect(screen.getByTestId("tv-approve-error")).toContainText(en["error.link_gone"]);
    await expect(screen.getByTestId("tv-approve-yes")).toHaveCount(0);
    await screen.getByTestId("tv-approve-again").click();
    await expect(screen.getByTestId("tv-approve-input")).toHaveValue("");

    const { other, shown } = await screenAskingToSignIn(browser);
    await screen.getByTestId("tv-approve-input").fill(shown);
    await screen.getByTestId("tv-approve-no").click();
    await expect(screen.getByTestId("tv-approve-done")).toContainText(en["link.denied"]);
    await expect(other.getByTestId("tv-signin-status")).toContainText(en["link.denied"], { timeout: 10_000 });
  });
});

test.describe("a poor password on the TV's own form", () => {
  test("the question comes before the account, the remote's Back is 'change the password', and OK on 'I agree' makes it", async ({ browser }) => {
    test.setTimeout(60_000);
    const account = { email: `Tvguest ${Date.now().toString(36)}${++counter}`, password: "12" };
    const tv = await openLibrary(browser);
    await openTvSignIn(tv);
    await tv.getByTestId("tv-signin-email").click();
    await expect(tv.locator(".tv-headline").first()).toHaveText(en["auth.signIn"]);
    await tv.getByTestId("auth-switch").click();
    await expect(tv.locator(".tv-headline").first()).toHaveText(en["auth.signUp"]);
    await tv.getByTestId("auth-email").fill(account.email);
    await tv.getByTestId("auth-password").fill(account.password);
    await tv.getByTestId("auth-submit").click();

    await expect(tv.getByTestId("auth-warning")).toHaveAttribute("data-kind", "weak");
    await expect(tv.getByTestId("auth-change")).toBeFocused();

    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("auth-warning")).toHaveCount(0);
    await expect(tv.getByTestId("tv-signin")).toBeVisible();
    await expect(tv.getByTestId("auth-form")).toHaveAttribute("data-mode", "signUp");
    await expect(tv.getByTestId("auth-password")).toHaveValue(account.password);

    await tv.getByTestId("auth-submit").click();
    await expect(tv.getByTestId("auth-warning")).toBeVisible();
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("auth-agree")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", PICTURE_NAMED);
  });
});

test.describe("profiles made and changed on the TV itself", () => {
  test("the settings page makes, renames and removes them with the remote, and 'Who's watching?' on the next sign-in is the same page", async ({ browser }) => {
    test.setTimeout(75_000);
    const account = fresh();
    const tv = await signedInScreen(browser, account);
    const profiles = tv.getByTestId("tv-profiles");

    await openTvSettings(tv);
    await expect(tv.getByTestId("tv-switch-profile")).toHaveCount(0);

    const inColumn = (index: number) => tv.locator(".tv-set-col").nth(index).locator(":focus");
    await expect(inColumn(0)).toHaveCount(1);
    await tv.keyboard.press("ArrowUp");
    await expect(tv.getByTestId("tv-account-back")).toBeFocused();
    await tv.getByTestId("tv-manage-profiles").focus();
    await expect(inColumn(0)).toHaveCount(1);
    await tv.keyboard.press("ArrowRight");
    await expect(inColumn(1)).toHaveCount(1);
    for (let i = 0; i < 8; i++) await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("tv-delete-account")).toBeFocused();
    await tv.keyboard.press("ArrowUp");
    await expect(inColumn(1)).toHaveAttribute("data-testid", "tv-autoskip");
    await tv.keyboard.press("ArrowLeft");
    await expect(inColumn(0)).toHaveCount(1);

    await tv.getByTestId("tv-manage-profiles").click();
    await expect(profiles).toContainText("1 of 5 profiles");
    await expect(tv.getByTestId("profile-Viewer")).toBeFocused();

    await tv.getByTestId("profile-add").click();
    await expect(tv.getByTestId("tv-profile-edit")).toBeVisible();
    const picture = tv.getByTestId(`avatar-${AVATAR_IDS[7]}`);
    await picture.click();
    await expect(picture).toHaveAttribute("aria-checked", "true");
    await tv.getByTestId("profile-name-input").fill("Maya");
    await tv.getByTestId("profile-save").click();
    await expect(tv.getByTestId("profile-Maya")).toBeVisible();
    await expect(profiles).toContainText("2 of 5 profiles");

    await tv.getByTestId("profile-Maya").click();
    await expect(tv.getByTestId("profile-name-input")).toHaveValue("Maya");
    await tv.getByTestId("profile-name-input").fill("Noa");
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("profile-Noa")).toBeVisible();
    await expect(tv.getByTestId("profile-Maya")).toHaveCount(0);

    await tv.getByTestId("profile-Noa").click();
    await tv.getByTestId(`avatar-${AVATAR_IDS[AVATAR_IDS.length - 1]}`).focus();
    await tv.keyboard.press("ArrowDown");
    await expect(tv.locator('[data-testid="profile-save"]:focus, [data-testid="profile-cancel"]:focus')).toHaveCount(1);
    await tv.getByTestId("profile-delete").click();
    await expect(tv.getByTestId("profile-delete-cancel")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("profile-delete-confirm")).toHaveCount(0);
    await tv.getByTestId("profile-delete").click();
    await tv.getByTestId("profile-delete-confirm").click();
    await expect(tv.getByTestId("profile-Noa")).toHaveCount(0);
    await expect(profiles).toContainText("1 of 5 profiles");

    await tv.getByTestId("profile-Viewer").click();
    await expect(tv.getByTestId("tv-profile-edit")).toBeVisible();
    await expect(tv.getByTestId("profile-delete")).toHaveCount(0);
    await tv.getByTestId("profile-cancel").click();

    await expect(tv.getByTestId("profile-Viewer")).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("profile-add")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("profile-name-input")).toBeFocused();
    await tv.keyboard.type("Kim");
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("profile-Kim")).toBeVisible();

    await tv.getByTestId("tv-profiles-done").click();
    await tv.getByTestId("tv-switch-profile").click();
    await tv.getByTestId("profile-Kim").click();
    await expect(tv.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", /Kim/);

    await openTvSettings(tv);
    await tv.getByTestId("tv-sign-out").click();
    await expect(tv.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", en["account.signInPrompt"]);
    await openTvSignIn(tv);
    await tv.getByTestId("tv-signin-email").click();
    await tv.getByTestId("auth-email").fill(account.email);
    await tv.getByTestId("auth-password").fill(account.password);
    await tv.getByTestId("auth-submit").click();
    await expect(profiles).toBeVisible();
    await expect(tv.getByTestId("profile-Viewer")).toBeVisible();
    await expect(tv.getByTestId("profile-Kim")).toBeVisible();
    await expect(tv.getByTestId("profile-add")).toBeVisible();
    await expect(tv.getByTestId("tv-profiles-back")).toHaveCount(0);
    await tv.getByTestId("tv-profiles-manage").click();
    await expect(profiles).toContainText("2 of 5 profiles");
    await tv.getByTestId("tv-profiles-done").click();
    await tv.getByTestId("profile-Viewer").click();
    await expect(tv.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", /Viewer/);
  });
});

test.describe("English, Romanian and Italian", () => {
  test("the switch on the connect screen changes the whole page, and the page remembers it", async ({ browser }) => {
    const phone = await newPhone(browser);
    await phone.goto("/");
    const heading = phone.getByRole("heading", { level: 1 });
    await expect(heading).toHaveText(en["pair.title"]);

    await phone.getByTestId("switch-lang-ro").click();
    await expect(heading).toHaveText(ro["pair.title"]);
    await expect(phone.locator("html")).toHaveAttribute("lang", "ro");
    await expect(phone.getByTestId("connect")).toHaveText(ro["pair.connect"]);

    await phone.reload();
    await expect(heading).toHaveText(ro["pair.title"]);

    await phone.getByTestId("switch-lang-it").click();
    await expect(heading).toHaveText(italian["pair.title"]);
    await expect(phone.getByTestId("connect")).toHaveText(italian["pair.connect"]);
  });

  test("a first visit follows the language of the browser", async ({ browser }) => {
    const phone = await newPhone(browser, {}, "ro-RO");
    await phone.goto("/");
    await expect(phone.getByRole("heading", { level: 1 })).toHaveText(ro["pair.title"]);

    const tv = await openDevice(browser, { viewport: { width: 1280, height: 720 }, locale: "it-IT" });
    await tv.goto("/tv");
    await expect(tv.getByTestId("tv-welcome").locator("p")).toHaveText(italian["tv.welcome"]);
    await expect(tv.getByTestId("rail-home")).toHaveText(italian["tv.home"]);
  });

  test("the settings page changes the language too, for someone who is not signed in", async ({ browser }) => {
    const phone = await newPhone(browser);
    await phone.goto("/");
    await phone.getByTestId("account-button").click();
    await phone.getByTestId("menu-settings").click();
    await phone.getByTestId("lang-ro").click();
    await expect(phone.getByTestId("settings-page")).toContainText(ro["settings.language"]);
  });

  test("a profile that chose no language leaves the screen in the one it had, instead of keeping the language of the profile before it", async ({ browser }) => {
    test.setTimeout(60_000);
    const account = { email: `Robert ${Date.now().toString(36)}${++counter}`, password: "1" };
    const phone = await newPhone(browser);
    await phone.goto("/");
    await signUp(phone, account);
    const first = (await phone.getByTestId("account-profile-name").innerText()).trim();
    await phone.getByTestId("menu-profiles").click();
    await phone.getByTestId("profile-add").click();
    await phone.getByTestId("profile-name-input").fill("Maya");
    await phone.getByTestId("profile-save").click();
    await expect(phone.getByTestId("profile-Maya")).toBeVisible();

    const origin = new URL(phone.url()).origin;
    const { me } = (await (await phone.context().request.get(`${origin}/api/me`)).json()) as { me: { profiles: Array<{ id: string; name: string }> } };
    const robert = me.profiles.find((profile) => profile.name === first)!.id;
    await phone.context().request.post(`${origin}/api/profiles/${robert}/sync`, { data: { since: 0, settings: [{ key: "lang", at: Date.now(), value: "ro" }] } });
    await phone.reload();
    await expect(phone.locator("html")).toHaveAttribute("lang", "ro");

    await phone.getByTestId("account-button").click();
    await phone.getByTestId("menu-switch").click();
    await phone.getByTestId("profile-Maya").click();
    await expect(phone.locator("html")).toHaveAttribute("lang", "en");
    await expect(phone.getByTestId("account-button")).toHaveAttribute("aria-label", /Maya/);

    await phone.getByTestId("account-button").click();
    await phone.getByTestId("sign-out").click();
    await expect(phone.getByTestId("account-button")).toContainText(en["account.signInPrompt"]);
    await expect(phone.locator("html")).toHaveAttribute("lang", "en");
  });

  test("the TV's own account page changes it too, and the player speaks it", async ({ browser, baseURL }) => {
    const tv = await openLibrary(browser);
    await openProfilePlace(tv, "settings");
    await expect(tv.getByTestId("tv-account-name")).toHaveText(en["tv.notSignedIn"]);
    await tv.getByTestId("tv-lang-it").click();
    await expect(tv.getByTestId("tv-account-name")).toHaveText(italian["tv.notSignedIn"]);
    await tv.keyboard.press("Escape");
    await tv.getByTestId("rail-connect").click();

    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: { title: "A film", stream: { url: "/fixtures/sample.mp4", type: "mp4" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect(tv.getByTestId("tv-pause-card")).toContainText(italian["hud.watching"]);
    phone.close();
  });

  for (const [width, unit] of [[320, 9], [360, 9], [390, 9], [412, 9], [320, 12], [360, 12], [412, 12], [412, 14], [600, 9], [899, 9], [1280, 9]] as const) {
    test(`the three languages share one line on the TV's settings page, ${width}px wide, text ${unit}px`, async ({ browser }) => {
      const tv = await openLibrary(browser, undefined, { width, height: 800 });
      if (unit !== 9) await tv.addStyleTag({ content: `.tv { --em: ${unit}px !important; }` });
      await openProfilePlace(tv, "settings");
      await expect(tv.getByTestId("tv-account")).toBeVisible();
      const boxes = await Promise.all(["en", "ro", "it"].map(async (code) => (await tv.getByTestId(`tv-lang-${code}`).boundingBox())!));
      for (const box of boxes) expect(Math.abs(box.y - boxes[0]!.y)).toBeLessThan(1);
      expect(boxes[0]!.x).toBeGreaterThanOrEqual(0);
      expect(boxes[2]!.x + boxes[2]!.width).toBeLessThanOrEqual(width);
      expect(await tv.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
});

const subtitled = (): NormalizedMedia => ({
  title: "Four Tongues",
  stream: { url: "/fixtures/sample.mp4", type: "mp4" },
  subtitles: [
    { id: "fr", label: "French", lang: "fr", url: "/fixtures/sample.vtt" },
    { id: "en", label: "English", lang: "en", url: "/fixtures/sample.vtt" },
    { id: "nl", label: "Dutch", lang: "nl", url: "/fixtures/sample.vtt" },
    { id: "ro", label: "Romanian", lang: "ro", url: "/fixtures/sample.vtt" },
  ],
});

test.describe("the subtitle languages a profile chose", () => {
  const optionsOf = async (tv: Page) => (await tv.getByRole("listbox", { name: "Subtitles" }).getByRole("option").allTextContents()).map((text) => text.trim());
  const FOLDED = (count: number) => `${en["player.moreLanguages"]}${count}`;

  async function openMenu(tv: Page, baseURL: string) {
    const phone = await RawPhone.connect(baseURL, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: subtitled() });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await tv.getByTestId("tv-audio-sub-btn").click();
    return phone;
  }

  test("they come first, in the order chosen, and every other language waits behind More languages, then under a heading", async ({ browser, baseURL }) => {
    const tv = await openTv(browser, undefined, guestStorage({ settings: [{ key: "subtitleLanguages", at: Date.now(), value: ["nl", "fr"] }] }));
    const phone = await openMenu(tv, baseURL!);
    await expect.poll(() => optionsOf(tv)).toEqual(["Off", "Dutch", "French", FOLDED(2)]);
    await tv.locator("[data-key='more-languages-open']").focus();
    await tv.keyboard.press("Enter");
    await expect.poll(() => optionsOf(tv)).toEqual(["Off", "Dutch", "French", "English", "Romanian"]);
    await expect(tv.getByText(en["player.moreLanguages"], { exact: true })).toBeVisible();
    await expect(tv.getByRole("option", { name: "English", exact: true })).toBeFocused();
    phone.close();
  });

  test("with 'only these' the others are one OK away", async ({ browser, baseURL }) => {
    const settings = [
      { key: "subtitleLanguages", at: Date.now(), value: ["nl"] },
      { key: "onlySubtitleLanguages", at: Date.now(), value: true },
    ];
    const tv = await openTv(browser, undefined, guestStorage({ settings }));
    const phone = await openMenu(tv, baseURL!);
    await expect.poll(() => optionsOf(tv)).toEqual(["Off", "Dutch", en["player.showAll"]]);

    await tv.getByRole("option", { name: en["player.showAll"] }).click();
    await expect.poll(() => optionsOf(tv)).toEqual(["Off", "Dutch", "French", "English", "Romanian"]);
    phone.close();
  });

  test("chosen on the TV's own settings with the remote, they come first in the order they were pressed; pressed again, one is taken out", async ({ browser, baseURL }) => {
    const tv = await openLibrary(browser);
    await openTvSettings(tv);
    const line = tv.getByTestId("tv-subtitle-languages");
    await expect(line.locator(".tv-line-value")).toHaveCount(0);
    await line.focus();
    await tv.keyboard.press("Enter");
    const page = tv.getByTestId("tv-subtitle-settings");
    await expect(page).toBeVisible();
    await expect(page.getByTestId("tv-subtitle-order")).toHaveText("Shown first now: English, Romanian, Italian.");
    const lang = (code: string) => page.getByTestId(`tv-subtitle-lang-${code}`);
    await expect(lang("en")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(lang("en")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("tv-subtitle-order")).toHaveText("1. English");
    await tv.keyboard.press("Enter");
    await expect(lang("en")).toHaveAttribute("aria-pressed", "false");
    await expect(lang("en")).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await tv.keyboard.press("ArrowDown");
    await expect(lang("nl")).toBeFocused();
    await tv.keyboard.press("Enter");
    await tv.keyboard.press("ArrowUp");
    await tv.keyboard.press("ArrowUp");
    for (let step = 0; step < 4; step++) await tv.keyboard.press("ArrowRight");
    await expect(lang("fr")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(page.getByTestId("tv-subtitle-order")).toHaveText("1. Dutch  ·  2. French");
    await expect(lang("nl").locator(".tv-lang-rank")).toHaveText("1");
    await expect(lang("fr").locator(".tv-lang-rank")).toHaveText("2");

    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-account")).toBeVisible();
    await expect(line).toBeFocused();
    await expect(line).toContainText("Dutch +1");
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-account")).toHaveCount(0);

    await pressMenuLine(tv, "rail-connect");
    const phone = await openMenu(tv, baseURL!);
    await expect.poll(() => optionsOf(tv)).toEqual(["Off", "Dutch", "French", FOLDED(2)]);
    phone.close();
  });

  test("twelve at most on the TV: the rest wait, and taking one out makes room", async ({ browser }) => {
    const twelve = ["en", "ro", "it", "es", "fr", "de", "pt", "hu", "bg", "el", "tr", "pl"];
    const tv = await openLibrary(browser, undefined, undefined, guestStorage({ settings: [{ key: "subtitleLanguages", at: Date.now(), value: twelve }] }));
    await openTvSettings(tv);
    await expect(tv.getByTestId("tv-subtitle-languages")).toContainText("English +11");
    await tv.getByTestId("tv-subtitle-languages").click();
    const lang = (code: string) => tv.getByTestId(`tv-subtitle-lang-${code}`);
    await expect(lang("nl")).toHaveAttribute("aria-disabled", "true");
    await lang("nl").click({ force: true });
    await expect(lang("nl")).toHaveAttribute("aria-pressed", "false");
    await lang("it").click();
    await expect(lang("nl")).not.toHaveAttribute("aria-disabled", "true");
    await lang("nl").click();
    await expect(lang("nl").locator(".tv-lang-rank")).toHaveText("12");
    await expect(lang("hu").locator(".tv-lang-rank")).toHaveText("7");
  });

  test("someone who chose nothing gets the languages of the site first", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openMenu(tv, baseURL!);
    await expect.poll(() => optionsOf(tv)).toEqual(["Off", "English", "Romanian", FOLDED(2)]);
    phone.close();
  });
});

test.describe("playing the next episode", () => {
  const twoParts = (baseURL: string): NormalizedMedia => ({
    title: "Two Parts · S1 E1",
    stream: { url: "/fixtures/sample.mp4", type: "mp4" },
    series: {
      season: 1,
      episode: 1,
      episodes: [
        { season: 1, episode: 1, title: "One", url: `${baseURL}/fixtures/pages/video.html` },
        { season: 1, episode: 2, title: "Two", url: `${baseURL}/fixtures/pages/hls.html` },
      ],
      next: { season: 1, episode: 2, title: "Two", url: `${baseURL}/fixtures/pages/hls.html` },
    },
  });

  async function playToTheEnd(tv: Page, baseURL: string) {
    const phone = await RawPhone.connect(baseURL, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: twoParts(baseURL) });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await tv.evaluate(() => {
      const video = document.querySelector("video")!;
      video.currentTime = video.duration - 1.5;
    });
    phone.cmd({ type: "PLAY" });
    return phone;
  }

  test("by default the card counts down to it", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await playToTheEnd(tv, baseURL!);
    const card = tv.getByTestId("netflix-upnext");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toHaveAttribute("data-counting", "true");
    await expect(card).toContainText(/\ds/);
    await expect(tv.getByTestId("tv-end")).toHaveCount(0);
    phone.close();
  });

  test("a profile that plays the next episode only on request gets the card without a countdown", async ({ browser, baseURL }) => {
    test.setTimeout(45_000);
    const tv = await openTv(browser, undefined, guestStorage({ settings: [{ key: "autoplayNext", at: Date.now(), value: false }] }));
    const phone = await playToTheEnd(tv, baseURL!);
    const card = tv.getByTestId("netflix-upnext");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toHaveAttribute("data-counting", "false");
    await expect(card).not.toContainText(/\ds/);

    await tv.waitForTimeout(6_500);
    await expect(card).toBeVisible();
    await tv.getByTestId("upnext-play-btn").click();
    await expect(card).toHaveCount(0);
    phone.close();
  });
});

test.describe("the account deleted from the TV's settings", () => {
  test("a quiet line at the very bottom opens it: the word typed first, then the password; a wrong one is called so, Back returns to the line, and then the account is gone", async ({ browser }) => {
    test.setTimeout(75_000);
    const account = fresh();
    const tv = await signedInScreen(browser, account);
    await openTvSettings(tv);
    const line = tv.getByTestId("tv-delete-account");
    await expect(line).toHaveText(en["account.delete"]);
    const lowest = await tv.locator("[data-testid='tv-account'] [data-nav]").evaluateAll((all) => Math.max(...all.map((one) => one.getBoundingClientRect().bottom)));
    expect((await line.boundingBox())!.y + (await line.boundingBox())!.height).toBeGreaterThanOrEqual(lowest - 1);
    expect(await line.evaluate((element) => Number(getComputedStyle(element).opacity))).toBeLessThan(1);

    await line.click();
    const page = tv.getByTestId("tv-delete");
    await expect(page).toBeVisible();
    await expect(page).toContainText(en["account.deleteAll"]);
    const confirm = tv.getByTestId("delete-confirm");
    await expect(confirm).toBeDisabled();
    await expect(tv.getByTestId("delete-password")).toHaveCount(0);
    await expect(page.locator(".editor-actions button")).toHaveText([en["common.cancel"], en["account.deleteConfirm"]]);
    await tv.getByTestId("delete-word").fill("Understoo");
    await expect(confirm).toBeDisabled();
    await tv.getByTestId("delete-word").fill(" understood ");
    await expect(confirm).toBeEnabled();
    await tv.getByTestId("delete-password").fill("not it");
    await confirm.click();
    await expect(tv.getByTestId("delete-error")).toHaveText(en["error.wrong_password"]);

    await tv.keyboard.press("Escape");
    await expect(page).toHaveCount(0);
    await expect(line).toBeFocused();
    await line.click();
    await tv.getByTestId("delete-word").fill("Understood");
    await tv.getByTestId("delete-password").fill(account.password);
    await confirm.click();
    await expect(page).toHaveCount(0);
    await expect(tv.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", en["account.signInPrompt"]);
    await openTvSignIn(tv);
    await tv.getByTestId("tv-signin-email").click();
    await tv.getByTestId("auth-email").fill(account.email);
    await tv.getByTestId("auth-password").fill(account.password);
    await tv.getByTestId("auth-submit").click();
    await expect(tv.getByTestId("auth-error")).toBeVisible();
  });

  test("the Romanian word may be typed without its marks, and a guest has no such line", async ({ browser }) => {
    const guest = await openLibrary(browser);
    await openTvSettings(guest);
    await expect(guest.getByTestId("tv-account")).toBeVisible();
    await expect(guest.getByTestId("tv-delete-account")).toHaveCount(0);
    await guest.context().close();

    const tv = await signedInScreen(browser, fresh());
    await openTvSettings(tv);
    await tv.getByTestId("tv-lang-ro").click();
    await expect(tv.getByTestId("tv-delete-account")).toHaveText(ro["account.delete"]);
    await tv.getByTestId("tv-delete-account").click();
    await expect(tv.getByTestId("tv-delete")).toContainText(ro["account.deleteType"].replace("{word}", ro["account.deleteWord"]));
    await tv.getByTestId("delete-word").fill("inteleg");
    await expect(tv.getByTestId("delete-confirm")).toBeEnabled();
  });
});

test.describe("the anime voice in the settings", () => {
  test("is offered only while Anime is one of the sections shown, on the TV and on the phone", async ({ browser }) => {
    test.setTimeout(60_000);
    const tv = await signedInScreen(browser, fresh());
    await openTvSettings(tv);
    await expect(tv.getByTestId("tv-anime-audio-jp")).toBeVisible();
    await tv.getByTestId("tv-sections-setting").click();
    await tv.getByTestId("section-choice-anime").click();
    await expect(tv.getByTestId("section-choice-anime")).toHaveAttribute("aria-pressed", "false");
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-account")).toBeVisible();
    await expect(tv.getByTestId("tv-anime-audio-jp")).toHaveCount(0);
    await expect(tv.getByTestId("tv-autoskip")).toBeVisible();
    await tv.getByTestId("tv-sections-setting").click();
    await tv.getByTestId("section-choice-anime").click();
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-anime-audio-jp")).toBeVisible();

    const phone = await newPhone(browser);
    await phone.goto("/");
    await signUp(phone, fresh());
    await phone.getByTestId("menu-settings").click();
    await expect(phone.getByTestId("anime-audio-jp")).toBeVisible();
    await phone.getByTestId("section-choice-anime").click();
    await expect(phone.getByTestId("anime-audio-jp")).toHaveCount(0);
  });
});
