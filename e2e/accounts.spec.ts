import { expect, test, type Browser, type Page } from "@playwright/test";
import { AVATAR_IDS, type NormalizedMedia } from "../src/shared";
import { en } from "../src/client/i18n/en";
import { it as italian } from "../src/client/i18n/it";
import { ro } from "../src/client/i18n/ro";
import { guestStorage, openDevice, openLibrary, openTv, PHONE, RawPhone, readPairingCode, tvRoot } from "./helpers";
import { TEST_ACCOUNT, TEST_ACCOUNT_B } from "./testAccount";

/**
 * Accounts, profiles, saved progress and the three languages. The server these run against keeps accounts in memory only
 * (DATA_DIR=memory) and allows a few sign-ups an hour from one address, so a test makes at most one account, with its own address.
 */

let counter = 0;
const fresh = (base: { email: string; password: string } = TEST_ACCOUNT) => ({ ...base, email: base.email.replace("@", `+${Date.now().toString(36)}${++counter}@`) });

const newPhone = (browser: Browser, seed: Record<string, string> = {}, locale = "en-US") => openDevice(browser, { ...PHONE, locale }, seed);

async function signUp(page: Page, account: { email: string; password: string }) {
  await page.getByTestId("account-button").click();
  await page.getByTestId("auth-switch").click();
  await expect(page.getByTestId("auth-form")).toHaveAttribute("data-mode", "signUp");
  await page.getByTestId("auth-email").fill(account.email);
  await page.getByTestId("auth-password").fill(account.password);
  await page.getByTestId("auth-submit").click();
}

async function signIn(page: Page, account: { email: string; password: string }) {
  await page.getByTestId("account-button").click();
  await page.getByTestId("auth-email").fill(account.email);
  await page.getByTestId("auth-password").fill(account.password);
  await page.getByTestId("auth-submit").click();
}

/** The server has everything this screen kept for the profile in use: nothing is left to send, and it has answered. */
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
  test("an account has a first profile, up to five can be added, and signing in again brings them all back", async ({ browser }) => {
    test.setTimeout(60_000);
    // A name and a password of one character: what somebody who only wants to watch types.
    const account = { email: `Robert ${Date.now().toString(36)}${++counter}`, password: "1" };
    const phone = await newPhone(browser);
    await phone.goto("/");
    await signUp(phone, account);

    // The first profile is named after the name; a single profile is simply used.
    await expect(phone.getByTestId("account-profile-name")).toHaveText(/^Robert/);
    const first = (await phone.getByTestId("account-profile-name").innerText()).trim();

    await phone.getByTestId("menu-profiles").click();
    for (const name of ["Maya", "Sam", "Noa", "Kim"]) {
      await phone.getByTestId("profile-add").click();
      await expect(phone.locator('[data-testid^="avatar-"]')).toHaveCount(12); // twelve pictures to choose from
      if (name === "Maya") {
        const picture = phone.getByTestId(`avatar-${AVATAR_IDS[7]}`);
        await picture.click();
        await expect(picture).toHaveAttribute("aria-checked", "true");
      }
      await phone.getByTestId("profile-name-input").fill(name);
      await phone.getByTestId("profile-save").click();
      await expect(phone.getByTestId(`profile-${name}`)).toBeVisible();
    }
    await expect(phone.getByTestId("profile-add")).toHaveCount(0); // five is the most

    // One removed makes room for another.
    await phone.getByTestId("profile-Kim").click();
    await phone.getByTestId("profile-delete").click();
    await phone.getByTestId("profile-delete-confirm").click();
    await expect(phone.getByTestId("profile-Kim")).toHaveCount(0);
    await expect(phone.getByTestId("profile-add")).toBeVisible();

    // Signing out and in: nobody has been picked on this screen yet, so it asks who is watching.
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

  test("a screen that was signed in stays that person while the server cannot be reached as its page opens, and the cookie is renewed when it can", async ({ browser }) => {
    test.setTimeout(60_000);
    const account = { email: `Robert ${Date.now().toString(36)}${++counter}`, password: "1" };
    const phone = await newPhone(browser);
    await phone.goto("/");
    await signUp(phone, account);
    await expect(phone.getByTestId("account-button")).toHaveAttribute("aria-label", /Robert/);

    // The page is opened again while the server does not answer: still Robert, not a guest who has to sign in.
    await phone.route("**/api/me", (route) => route.abort());
    await phone.reload();
    await expect(phone.getByTestId("account-button")).toHaveAttribute("aria-label", /Robert/);
    await phone.unroute("**/api/me");

    // And when it does answer, the cookie has a full term again (the session itself is kept sliding on the server).
    const answer = await phone.evaluate(async () => {
      const response = await fetch("/api/me", { cache: "no-store" });
      return { me: ((await response.json()) as { me: { account: { email: string } } | null }).me?.account.email };
    });
    expect(answer.me).toMatch(/^robert /);
    const header = await phone.context().cookies();
    const cookie = header.find((entry) => entry.name === "kino_session");
    expect(cookie).toBeDefined();
    expect(cookie!.expires - Date.now() / 1000).toBeGreaterThan(399 * 24 * 3600); // (the browser caps a cookie's life at 400 days)
  });

  test("an account can have no password: the empty field says what that means, and signing in with nothing opens it", async ({ browser }) => {
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
    await expect(phone.getByTestId("account-profile-name")).toHaveText(/^Guest/);

    await phone.getByTestId("sign-out").click();
    await expect(phone.getByTestId("account-button")).toContainText(en["account.signInPrompt"]);
    await signIn(phone, account);
    await expect(phone.getByTestId("account-profile-name")).toHaveText(/^Guest/);
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
  // A list of its own, with a title in it.
  const weekend = { key: "lweekend", at: Date.now() - 110_000, name: "Weekend" };
  const picked = { key: "lweekend|url:https://films.example/picked", at: Date.now() - 100_000, list: "lweekend", id: "p1", title: "Weekend Pick", url: "https://films.example/picked" };

  test("what a guest watched joins the account on signing in, and another device carries on from there", async ({ browser }) => {
    test.setTimeout(60_000);
    const account = fresh();

    // Device A has been used without an account.
    const first = await newPhone(browser, guestStorage({ progress: [night], list: [saved, picked], listNames: [weekend] }));
    await first.goto("/");
    await signUp(first, account);
    await expect(first.getByTestId("account-toast")).toContainText("Viewer");
    await savedToTheAccount(first);
    // It is the profile's now, not counted twice: the guest copy is empty.
    const left = await guestCopy(first);
    expect(left?.data.progress).toHaveLength(0);
    expect(left?.data.list).toHaveLength(0);
    expect(left?.data.listNames).toHaveLength(0);

    // Device B, another browser, signs in; paired with a TV (that is where the rows are) it has the same history.
    const tv = await openTv(browser);
    const second = await newPhone(browser);
    await second.goto("/");
    await signIn(second, account);
    await expect(second.getByTestId("account-profile-name")).toHaveText("Viewer");
    await second.getByTestId("page-back").click();
    await second.getByTestId("code-input").fill(await readPairingCode(tv));
    await expect(second.getByTestId("tv-online")).toHaveText("TV connected");

    const continuing = second.getByTestId("continue-row");
    await expect(continuing).toContainText("Night Train");
    await expect(continuing).toContainText("1 h 15 min left"); // 6000 - 1500 seconds
    await expect(second.getByRole("region", { name: "Favourites" })).toContainText("Saved For Later");
    await expect(second.getByRole("region", { name: "Weekend" })).toContainText("Weekend Pick"); // the lists and their names come along too

    // Signing every other device out: the first finds out the next time it talks to the server, and says why it is a guest again.
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
    // Nobody is signed in: the screen holds only what a guest watched here, and the account's copy is gone from it.
    await expect.poll(() => phone.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("kino.data.")))).toEqual(["kino.data.guest"]);
    expect((await guestCopy(phone))?.data.progress).toHaveLength(0);
  });
});

test.describe("signing a TV in from the phone", () => {
  /** A signed-in phone, and a TV showing the code that asks to be signed in. */
  async function askToSignIn(browser: Browser) {
    const phone = await newPhone(browser);
    await phone.goto("/");
    await signUp(phone, fresh());
    await expect(phone.getByTestId("account-profile-name")).toHaveText("Viewer");

    const tv = await openLibrary(browser);
    await tv.getByTestId("tv-account-chip").click(); // nobody is signed in, so the button leads straight to signing in
    const code = tv.getByTestId("tv-link-code");
    await expect(code).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/); // (until the TV has been given one it shows dots)
    const shown = (await code.textContent())!.trim();

    // What the TV's QR code opens on the phone: a page that asks whether to sign that TV in.
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

    await tv.getByTestId("rail-connect").click(); // the same phone goes with this TV
    await phone.goto("/");
    await phone.getByTestId("code-input").fill(await readPairingCode(tv));
    await expect(phone.getByTestId("tv-online")).toHaveText("TV connected");

    await phone.getByTestId("account-button").click();
    await phone.getByTestId("menu-devices").click();
    await expect(phone.getByTestId("device")).toHaveCount(2); // this phone, and the TV

    // A device is called what its owner likes: its name opens a field, Enter keeps what was typed, Escape drops it (and is not the page's own Escape).
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
    // (The TV's own exchange is up to 45 seconds away: this is the phone telling it.)
    await expect(tv.getByTestId("tv-account-toast")).toHaveText(en["error.signed_out"], { timeout: 10_000 });
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

/** A computer's screen page that has made an account with the email form, which is how a screen with a keyboard signs in. */
async function signedInScreen(browser: Browser, account = fresh()) {
  const screen = await openLibrary(browser);
  await screen.getByTestId("tv-account-chip").click();
  await screen.getByTestId("tv-signin-email").click();
  await screen.getByTestId("auth-switch").click();
  await expect(screen.getByTestId("auth-form")).toHaveAttribute("data-mode", "signUp");
  await expect(screen.locator(".tv-headline").first()).toHaveText(en["auth.signUp"]); // the page says what the form now does, not "Sign in"
  await screen.getByTestId("auth-email").fill(account.email);
  await screen.getByTestId("auth-password").fill(account.password);
  await screen.getByTestId("auth-submit").click();
  await expect(screen.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", /Viewer/);
  return screen;
}

test.describe("signing a screen in from another screen", () => {
  /** Another screen that is not signed in, showing the code that asks for it. */
  async function screenAskingToSignIn(browser: Browser) {
    const other = await openLibrary(browser);
    await other.getByTestId("tv-account-chip").click();
    const code = other.getByTestId("tv-link-code");
    await expect(code).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    return { other, shown: (await code.textContent())!.trim() };
  }

  const openApprove = async (screen: Page) => {
    await screen.getByTestId("tv-account-chip").click();
    await screen.getByTestId("tv-approve").click();
  };

  test("the code is typed as it was read, the request names the code, and only then does the other screen get signed in", async ({ browser }) => {
    const screen = await signedInScreen(browser);
    const { other, shown } = await screenAskingToSignIn(browser);

    await openApprove(screen);
    await screen.getByTestId("tv-approve-input").pressSequentially(shown.replace("-", "").toLowerCase());
    await expect(screen.getByTestId("tv-approve-code")).toHaveText(shown);

    // Nothing has the focus yet, so a stray OK only lands on the first button; the second press is the answer.
    await expect(screen.getByTestId("tv-approve-yes")).not.toBeFocused();
    await screen.keyboard.press("Enter");
    await expect(screen.getByTestId("tv-approve-yes")).toBeFocused();
    await expect(other.getByTestId("tv-signin")).toBeVisible();
    await screen.keyboard.press("Enter");

    await expect(screen.getByTestId("tv-approve-done")).toContainText(en["link.approved"]);
    await expect(other.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", /Viewer/, { timeout: 15_000 });
    await screen.getByTestId("tv-approve-close").click();
    await expect(screen.getByTestId("tv-account")).toBeVisible(); // back on the account page
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

test.describe("profiles made and changed on the TV itself", () => {
  test("the account page makes, renames and removes them with the remote, and 'Who's watching?' on the next sign-in is the same page", async ({ browser }) => {
    test.setTimeout(75_000);
    const account = fresh();
    const tv = await signedInScreen(browser, account);
    const profiles = tv.getByTestId("tv-profiles");

    // One profile: nobody to switch to, but profiles are managed from here all the same.
    await tv.getByTestId("tv-account-chip").click();
    await expect(tv.getByTestId("tv-switch-profile")).toHaveCount(0);

    // The page is two columns, and Up and Down keep to the one the remote is in: the top of the first does not jump across to the settings.
    const inColumn = (name: "who" | "settings") => tv.locator(`.tv-panel-${name} :focus`);
    await expect(inColumn("who")).toHaveCount(1);
    await tv.keyboard.press("ArrowUp");
    await expect(inColumn("who")).toHaveCount(1);
    await tv.keyboard.press("ArrowRight");
    await expect(inColumn("settings")).toHaveCount(1);
    for (let i = 0; i < 5; i++) await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("tv-friends-switch")).toBeFocused(); // the last of the settings (friends belong to an account), and Down from it goes nowhere
    await tv.keyboard.press("ArrowLeft");
    await expect(inColumn("who")).toHaveCount(1);

    await tv.getByTestId("tv-manage-profiles").click();
    await expect(profiles).toContainText("1 of 5 profiles");
    await expect(tv.getByTestId("profile-Viewer")).toBeFocused();

    // A new one: a picture chosen, a name typed.
    await tv.getByTestId("profile-add").click();
    await expect(tv.getByTestId("tv-profile-edit")).toBeVisible();
    const picture = tv.getByTestId(`avatar-${AVATAR_IDS[7]}`);
    await picture.click();
    await expect(picture).toHaveAttribute("aria-checked", "true");
    await tv.getByTestId("profile-name-input").fill("Maya");
    await tv.getByTestId("profile-save").click();
    await expect(tv.getByTestId("profile-Maya")).toBeVisible();
    await expect(profiles).toContainText("2 of 5 profiles");

    // Changed: OK in the name field saves it.
    await tv.getByTestId("profile-Maya").click();
    await expect(tv.getByTestId("profile-name-input")).toHaveValue("Maya");
    await tv.getByTestId("profile-name-input").fill("Noa");
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("profile-Noa")).toBeVisible();
    await expect(tv.getByTestId("profile-Maya")).toHaveCount(0);

    // Removed: the question lands the remote on the answer that keeps it, and that answer is the way back.
    await tv.getByTestId("profile-Noa").click();
    await tv.getByTestId(`avatar-${AVATAR_IDS[7]}`).focus();
    await tv.keyboard.press("ArrowDown"); // from the pictures to Save or Cancel, not past them to the wide Delete
    await expect(tv.locator('[data-testid="profile-save"]:focus, [data-testid="profile-cancel"]:focus')).toHaveCount(1);
    await tv.getByTestId("profile-delete").click();
    await expect(tv.getByTestId("profile-delete-cancel")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("profile-delete-confirm")).toHaveCount(0);
    await tv.getByTestId("profile-delete").click();
    await tv.getByTestId("profile-delete-confirm").click();
    await expect(tv.getByTestId("profile-Noa")).toHaveCount(0);
    await expect(profiles).toContainText("1 of 5 profiles");

    // The only profile left has no Delete: it can't be removed.
    await tv.getByTestId("profile-Viewer").click();
    await expect(tv.getByTestId("tv-profile-edit")).toBeVisible();
    await expect(tv.getByTestId("profile-delete")).toHaveCount(0);
    await tv.getByTestId("profile-cancel").click();

    // Made again with the keys alone: Right to the new-profile tile, OK, the name, OK.
    await expect(tv.getByTestId("profile-Viewer")).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("profile-add")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("profile-name-input")).toBeFocused();
    await tv.keyboard.type("Kim");
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("profile-Kim")).toBeVisible();

    // Done: back on the account page, which can now switch to the other profile.
    await tv.getByTestId("tv-profiles-done").click();
    await tv.getByTestId("tv-switch-profile").click();
    await tv.getByTestId("profile-Kim").click();
    await expect(tv.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", /Kim/);

    // Signing in again asks who is watching, with a way to add or change profiles on that very page; there is no way round it.
    await tv.getByTestId("tv-account-chip").click();
    await tv.getByTestId("tv-sign-out").click();
    await expect(tv.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", en["account.signInPrompt"]);
    await tv.getByTestId("tv-account-chip").click();
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
    await expect(phone.getByTestId("connect")).toHaveText(ro["pair.connect"]); // the rest of the screen too, not only the title

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

  test("the TV's own account page changes it too, and the player speaks it", async ({ browser, baseURL }) => {
    const tv = await openLibrary(browser);
    await tv.getByTestId("rail-settings").click(); // settings are in the menu, for a guest too
    await expect(tv.getByTestId("tv-account-name")).toHaveText(en["tv.notSignedIn"]);
    await tv.getByTestId("tv-lang-it").click();
    await expect(tv.getByTestId("tv-account-name")).toHaveText(italian["tv.notSignedIn"]);
    await tv.keyboard.press("Escape"); // Back
    await tv.getByTestId("rail-connect").click();

    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: { title: "A film", stream: { url: "/fixtures/sample.mp4", type: "mp4" } } });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await expect(tv.getByTestId("tv-pause-card")).toContainText(italian["hud.watching"]);
    phone.close();
  });
});

/** A video with subtitles in four languages, for the lists a profile arranges. */
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

  /** The TV has the video loaded and its audio and subtitles menu open. */
  async function openMenu(tv: Page, baseURL: string) {
    const phone = await RawPhone.connect(baseURL, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: subtitled() });
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "paused");
    await tv.getByTestId("tv-audio-sub-btn").click();
    return phone;
  }

  test("they come first, in the order chosen, with every other language under a heading", async ({ browser, baseURL }) => {
    const tv = await openTv(browser, undefined, guestStorage({ settings: [{ key: "subtitleLanguages", at: Date.now(), value: ["nl", "fr"] }] }));
    const phone = await openMenu(tv, baseURL!);
    await expect.poll(() => optionsOf(tv)).toEqual(["Off", "Dutch", "French", "English", "Romanian"]);
    await expect(tv.getByText(en["player.moreLanguages"], { exact: true })).toBeVisible();
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

  test("someone who chose nothing gets the languages of the site first", async ({ browser, baseURL }) => {
    const tv = await openTv(browser);
    const phone = await openMenu(tv, baseURL!);
    await expect.poll(() => optionsOf(tv)).toEqual(["Off", "English", "Romanian", "French", "Dutch"]);
    phone.close();
  });
});

test.describe("playing the next episode", () => {
  /** An episode that ends in a few seconds and has one after it. */
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

  /** Let the episode play its last second or so. */
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
    await expect(tv.getByTestId("tv-end")).toHaveCount(0); // the countdown is the card at this moment, not the end card
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

    await tv.waitForTimeout(6_500); // longer than the five seconds the countdown would have taken
    await expect(card).toBeVisible(); // still waiting to be asked
    await tv.getByTestId("upnext-play-btn").click(); // and it plays when asked
    await expect(card).toHaveCount(0);
    phone.close();
  });
});
