import { expect, type BrowserContext, type Page } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { openDevice, openLibrary, openTvSettings, openTvSignIn, PHONE, test } from "./helpers";

/*
 * The PIN of a child's profile (the owner, 16 Nov 2026): a child's profile is not left on this account's screens without a grown-up's PIN. Every way out asks for it
 * (another profile, the profiles' page, signing another screen in, signing out, Google, making it an ordinary profile again); Back drops what was waiting, the right PIN
 * does it, and the pages ask again once they were closed. A PIN that was forgotten is taken off with the account's password.
 */

const PIN = "1234";
const PASSWORD = "kino-test-pass-1";
let counter = 0;

/** An account with a child's profile (its first, named after the login) and a grown-up's one ("Grown"), and a PIN. Made on the server, from `context`: signed in there. */
async function family(context: BrowserContext, device: "tv" | "remote", { child = true, pin = true } = {}): Promise<{ login: string; first: string }> {
  const login = `pin${Date.now().toString(36)}${++counter}`;
  const made = await context.request.post("/api/auth/register", { data: { email: login, password: PASSWORD, device } });
  expect(made.ok()).toBe(true);
  const first = ((await made.json()) as { profiles: Array<{ id: string; name: string }> }).profiles[0]!;
  if (child) {
    expect((await context.request.post("/api/profiles", { data: { name: "Grown" } })).ok()).toBe(true);
    expect((await context.request.post(`/api/profiles/${first.id}/sync`, { data: { since: 0, settings: [{ key: "child", at: Date.now(), value: true }] } })).ok()).toBe(true);
  }
  if (pin) expect((await context.request.post("/api/me/child-pin", { data: { next: PIN } })).ok()).toBe(true);
  return { login, first: first.name };
}

/** Whether the account has a PIN, as the server says. */
const hasPin = async (page: Page) => (((await (await page.context().request.get("/api/me")).json()) as { me: { account: { childPin?: boolean } } }).me.account.childPin ?? false) === true;

const viewport = { width: 1280, height: 720 };

/** Typed on the TV's pad (the remote's way), one key at a time. */
async function padPin(tv: Page, pin: string): Promise<void> {
  for (const digit of pin) await tv.getByTestId(`pin-key-${digit}`).click();
}

test.describe("the PIN of a child's profile", () => {
  test("on the TV, every way out of a child's profile asks for it; Back keeps the profile, the right PIN lets it go, and closing the settings locks it again", async ({ browser }) => {
    test.setTimeout(90_000);
    const tv = await openDevice(browser, { viewport });
    const { first } = await family(tv.context(), "tv");
    await tv.goto("/tv");
    await tv.getByTestId(`profile-${first}`).click(); // ("Who's watching?": going in to a child's profile asks nothing)
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(tv.getByTestId("rail-movies")).toHaveCount(0); // (a child's)

    await openTvSettings(tv);
    await expect(tv.getByTestId("tv-pin-setting")).toContainText(en["common.on"]);
    // Each way out: the PIN's page, and Back (or the pad's ✕) leaves everything as it was.
    for (const [way, how] of [["tv-switch-profile", "Escape"], ["tv-manage-profiles", "key"], ["tv-approve", "Escape"], ["tv-sign-out", "key"], ["tv-child", "Escape"]] as const) {
      await tv.getByTestId(way).click();
      await expect(tv.getByTestId("tv-pin-page"), way).toBeVisible();
      await expect(tv.getByTestId("tv-pin-page")).toContainText(en["pin.hint"]);
      if (how === "Escape") await tv.keyboard.press("Escape");
      else await tv.getByTestId("pin-key-back").click();
      await expect(tv.getByTestId("tv-account"), way).toBeVisible();
    }
    await expect(tv.getByTestId("tv-child")).toHaveAttribute("aria-checked", "true");
    await expect(tv.getByTestId("tv-account-name")).toHaveText(first);

    // A wrong PIN says so and starts over; Back takes a digit back before it leaves.
    await tv.getByTestId("tv-switch-profile").click();
    await tv.keyboard.type("1111");
    await expect(tv.getByTestId("tv-pin-error")).toHaveText(en["pin.wrong"]);
    await expect(tv.getByTestId("tv-pin-digits")).toHaveAttribute("data-count", "0");
    await tv.keyboard.type("12");
    await expect(tv.getByTestId("tv-pin-digits")).toHaveAttribute("data-count", "2");
    await expect(tv.getByTestId("tv-pin-digits")).not.toContainText("1"); // (dots, not the digits)
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-pin-digits")).toHaveAttribute("data-count", "1");
    await tv.keyboard.press("Escape");
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-account")).toBeVisible();

    // The right one: the profiles' page it was asked for opens.
    await tv.getByTestId("tv-manage-profiles").click();
    await padPin(tv, PIN);
    await expect(tv.getByTestId("tv-profiles")).toBeVisible();
    await expect(tv.getByTestId("tv-profiles-done")).toBeVisible(); // (managing)
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-account")).toBeVisible();
    // ...and while the settings stay open, the other ways out do not ask again.
    await tv.getByTestId("tv-approve").click();
    await expect(tv.getByTestId("tv-pin-page")).toHaveCount(0);
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-account")).toBeVisible();

    // Closed and opened again: asked again.
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("tv-account")).toHaveCount(0);
    await openTvSettings(tv);
    await tv.getByTestId("tv-switch-profile").click();
    await expect(tv.getByTestId("tv-pin-page")).toBeVisible();
    await tv.keyboard.type(PIN);
    await tv.getByTestId("profile-Grown").click();
    await expect(tv.getByTestId("rail-movies")).toBeVisible(); // (a grown-up's profile: the sections are back)
  });

  test("a TV that has not heard of a PIN set since asks the server before a child's profile is left, and keeps it when the server cannot be asked", async ({ browser }) => {
    test.setTimeout(60_000);
    const tv = await openDevice(browser, { viewport });
    const { first } = await family(tv.context(), "tv", { pin: false });
    await tv.goto("/tv");
    await tv.getByTestId(`profile-${first}`).click();
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    // A PIN is set on another screen; this one still has the account without one, and cannot reach the server.
    expect((await tv.context().request.post("/api/me/child-pin", { data: { next: PIN } })).ok()).toBe(true);
    await tv.route("**/api/me", (route) => route.abort("internetdisconnected"));
    await openTvSettings(tv);
    await tv.getByTestId("tv-switch-profile").click();
    await expect(tv.getByTestId("tv-account-toast")).toHaveText(en["pin.offline"]);
    await expect(tv.getByTestId("tv-account")).toBeVisible();
    await expect(tv.getByTestId("tv-profiles")).toHaveCount(0);
    // The server answers again: it says there is a PIN, and the PIN is asked.
    await tv.unroute("**/api/me");
    await tv.getByTestId("tv-switch-profile").click();
    await expect(tv.getByTestId("tv-pin-page")).toBeVisible();
  });

  test("on the TV, the settings set the PIN (twice the same), change it with the one there is, and take it off", async ({ browser }) => {
    const tv = await openDevice(browser, { viewport });
    await family(tv.context(), "tv", { child: false, pin: false });
    await tv.goto("/tv");
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await openTvSettings(tv);
    await expect(tv.getByTestId("tv-pin-setting")).toContainText(en["common.off"]);

    await tv.getByTestId("tv-pin-setting").click();
    await expect(tv.getByTestId("tv-pin-setup")).toContainText(en["pin.new"]);
    await tv.keyboard.type("4321");
    await expect(tv.getByTestId("tv-pin-setup")).toContainText(en["pin.again"]);
    await tv.keyboard.type("4322");
    await expect(tv.getByTestId("tv-pin-error")).toHaveText(en["pin.mismatch"]);
    await expect(tv.getByTestId("tv-pin-setup")).toContainText(en["pin.new"]);
    await tv.keyboard.type("4321");
    await tv.keyboard.type("4321");
    await expect(tv.getByTestId("tv-account")).toBeVisible();
    await expect(tv.getByTestId("tv-pin-setting")).toContainText(en["common.on"]);
    await expect(tv.getByTestId("tv-pin-setting")).toBeFocused(); // (Back from its page lands the remote on its row)
    expect(await hasPin(tv)).toBe(true);

    await tv.getByTestId("tv-pin-setting").click();
    await tv.getByTestId("tv-pin-change").click();
    await expect(tv.getByTestId("tv-pin-setup")).toContainText(en["pin.current"]);
    await tv.keyboard.type("9999");
    await expect(tv.getByTestId("tv-pin-error")).toHaveText(en["pin.wrong"]);
    await tv.keyboard.type("4321");
    await expect(tv.getByTestId("tv-pin-setup")).toContainText(en["pin.new"]);
    await tv.keyboard.type("5555");
    await tv.keyboard.type("5555");
    await expect(tv.getByTestId("tv-account")).toBeVisible();

    await tv.getByTestId("tv-pin-setting").click();
    await tv.getByTestId("tv-pin-remove").click();
    await tv.keyboard.type("5555");
    await expect(tv.getByTestId("tv-account")).toBeVisible();
    await expect(tv.getByTestId("tv-pin-setting")).toContainText(en["common.off"]);
    expect(await hasPin(tv)).toBe(false);
  });

  test("on the phone, every way out of a child's profile asks for it, and a forgotten PIN is taken off with the account's password", async ({ browser }) => {
    test.setTimeout(90_000);
    const phone = await openDevice(browser, PHONE);
    const { first } = await family(phone.context(), "remote");
    await phone.goto("/");
    await phone.getByTestId(`profile-${first}`).click(); // ("Who's watching?")
    await phone.getByTestId("account-button").click();
    await expect(phone.getByTestId("account-screen")).toBeVisible();

    for (const way of ["menu-switch", "menu-profiles", "menu-devices", "menu-security", "sign-out"]) {
      await phone.getByTestId(way).click();
      await expect(phone.getByTestId("pin-page"), way).toBeVisible();
      await phone.getByTestId("pin-cancel").click();
      await expect(phone.getByTestId("account-screen"), way).toBeVisible();
    }
    // Made an ordinary profile again, from the settings: asked too, and the phone's own Back (Escape here) keeps it a child's.
    await phone.getByTestId("menu-settings").click();
    await phone.getByTestId("child-profile").click();
    await expect(phone.getByTestId("pin-page")).toBeVisible();
    await phone.keyboard.press("Escape");
    await expect(phone.getByTestId("settings-page")).toBeVisible();
    await expect(phone.getByTestId("child-profile")).toHaveAttribute("aria-checked", "true");
    await phone.keyboard.press("Escape");
    await expect(phone.getByTestId("account-screen")).toBeVisible();
    await expect(phone.getByTestId("account-profile-name")).toHaveText(first);

    // A wrong PIN says so; the password is asked for one that was forgotten, and takes it off: what was asked for is done.
    await phone.getByTestId("menu-switch").click();
    await phone.getByTestId("pin-input").fill("1111");
    await expect(phone.getByTestId("pin-error")).toHaveText(en["pin.wrong"]);
    await phone.getByTestId("pin-forgot").click();
    await phone.getByTestId("pin-password").fill("not the password");
    await phone.getByTestId("pin-remove-password").click();
    await expect(phone.getByTestId("pin-error")).toHaveText(en["error.wrong_password"]);
    await phone.getByTestId("pin-password").fill(PASSWORD);
    await phone.getByTestId("pin-remove-password").click();
    await expect(phone.getByTestId("profile-Grown")).toBeVisible(); // (the profiles to switch to)
    expect(await hasPin(phone)).toBe(false);
    await phone.getByTestId("profile-Grown").click();
    await expect(phone.getByTestId("account-button")).toHaveAttribute("aria-label", /Grown/);
  });

  test("a TV's sign-in code opened on a phone that is on a child's profile waits for the PIN before it signs the TV in", async ({ browser }) => {
    test.setTimeout(60_000);
    const phone = await openDevice(browser, PHONE);
    const { first } = await family(phone.context(), "remote");
    await phone.goto("/");
    await phone.getByTestId(`profile-${first}`).click();
    await expect(phone.getByTestId("account-button")).toHaveAttribute("aria-label", new RegExp(first));

    const tv = await openLibrary(browser);
    await openTvSignIn(tv);
    const code = tv.getByTestId("tv-link-code");
    await expect(code).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const shown = (await code.textContent())!.trim();
    await phone.goto(`/?link=${shown.replace("-", "")}`); // (what the TV's QR code opens)
    await expect(phone.getByTestId("link-code")).toHaveText(shown);

    // The TV would choose its own profile once signed in: from a child's profile, that is a way out.
    await phone.getByTestId("link-approve-button").click();
    await expect(phone.getByTestId("pin-ask")).toBeVisible();
    await phone.getByTestId("pin-cancel").click();
    await expect(phone.getByTestId("link-approve-button")).toBeVisible();
    await phone.getByTestId("link-approve-button").click();
    await phone.getByTestId("pin-input").fill(PIN);
    await expect(phone.getByTestId("link-done")).toBeVisible();
    await expect(tv.getByTestId("tv-profiles")).toBeVisible({ timeout: 15_000 }); // (signed in: "Who's watching?")
  });

  test("on the phone, the right PIN lets the child's profile go, and the settings set, change and take off the PIN", async ({ browser }) => {
    test.setTimeout(90_000);
    const phone = await openDevice(browser, PHONE);
    const { first } = await family(phone.context(), "remote");
    await phone.goto("/");
    await phone.getByTestId(`profile-${first}`).click();
    await phone.getByTestId("account-button").click();
    await phone.getByTestId("menu-switch").click();
    await phone.getByTestId("pin-input").fill(PIN);
    await phone.getByTestId("profile-Grown").click();
    await expect(phone.getByTestId("account-button")).toHaveAttribute("aria-label", /Grown/);

    await phone.getByTestId("account-button").click();
    await phone.getByTestId("menu-settings").click();
    const setting = phone.getByTestId("pin-setting");
    await setting.getByTestId("pin-change").click();
    await phone.getByTestId("pin-setting-input").fill("0000");
    await expect(phone.getByTestId("pin-setting-error")).toHaveText(en["pin.wrong"]);
    await phone.getByTestId("pin-setting-input").fill(PIN);
    await expect(setting).toContainText(en["pin.new"]);
    await phone.getByTestId("pin-setting-input").fill("2468");
    await expect(setting).toContainText(en["pin.again"]);
    await phone.getByTestId("pin-setting-input").fill("2469");
    await expect(phone.getByTestId("pin-setting-error")).toHaveText(en["pin.mismatch"]);
    await phone.getByTestId("pin-setting-input").fill("2468");
    await phone.getByTestId("pin-setting-input").fill("2468");
    await expect(phone.getByTestId("pin-done")).toHaveText(en["pin.changed"]);

    // Taken off with the password instead of the PIN.
    await setting.getByTestId("pin-remove").click();
    await phone.getByTestId("pin-use-password").click();
    await phone.getByTestId("pin-setting-password").fill(PASSWORD);
    await phone.getByTestId("pin-setting-password-go").click();
    await expect(phone.getByTestId("pin-done")).toHaveText(en["pin.gone"]);
    expect(await hasPin(phone)).toBe(false);

    await setting.getByTestId("pin-add").click();
    await phone.getByTestId("pin-setting-input").fill("1357");
    await phone.getByTestId("pin-setting-input").fill("1357");
    await expect(phone.getByTestId("pin-done")).toHaveText(en["pin.set"]);
    expect(await hasPin(phone)).toBe(true);
  });
});
