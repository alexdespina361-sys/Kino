import { expect, type Page } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { guestStorage, openLibrary, openProfilePlace, openTvSignIn, sleepingServer, test, tvRoot, withLibrary } from "./helpers";

/**
 * The remote's Back key on the TV. Every page, menu and window that opens over the library or the film is opened (with the mouse, which is
 * quicker than walking there) and Back is pressed (Escape: it is the key a remote's Back arrives as, see tv/keys.ts). Each one goes out one step,
 * to the page it was opened from, and a window on a window is walked out of the same way. The Close and Back buttons stay for those with a mouse.
 * (The end card, the error card and the countdown to the next episode keep their Back with the player's tests in tv-screens.spec.ts.)
 */

test.use({ actionTimeout: 15_000 }); // (a wrong id fails in seconds, not when the test runs out of time)

const HD = { width: 1280, height: 720 };

const id = (testId: string) => `[data-testid="${testId}"]`;
/** The library, on the page of one view (home, the profile's...). */
const viewing = (view: string) => `[data-testid="tv-browse"][data-view="${view}"]`;
/** ...or on a list (the first is "list", any other "list:" and its name). */
const LISTS = `[data-testid="tv-browse"][data-view^="list"]`;

/** A page, menu or window that opens over what is there: how it is opened, and what shows that it is up. */
interface Level {
  open: () => Promise<unknown>;
  shown: string;
  /** What shows again after Back, where that is not the level before this one. */
  then?: string;
}

/**
 * Opens each level over the one before, then presses Back once for each and holds that the one on top went, and the one under it is there:
 * after the last it is the library, with the remote on something (a Back that lost it would leave the TV with nothing to press).
 */
async function backOut(tv: Page, levels: Level[], library = id("tv-browse")) {
  for (const level of levels) {
    await level.open();
    await expect(tv.locator(level.shown)).toBeVisible();
  }
  for (let at = levels.length - 1; at >= 0; at--) {
    await tv.keyboard.press("Escape");
    await expect(tv.locator(levels[at]!.shown)).toHaveCount(0);
    await expect(tv.locator(levels[at]!.then ?? (at > 0 ? levels[at - 1]!.shown : library))).toBeVisible();
  }
  await expect(tv.locator(":focus:not(body)")).toHaveCount(1);
}

const films = Array.from({ length: 3 }, (_, i) => ({ id: `f${i}`, title: `Film number ${i + 1}`, year: 1930 + i, kind: "movie", url: `/fixtures/sample.mp4?n=${i}` }));
const library = { updatedAt: Date.now(), rows: [{ id: "r1", title: "Classics", source: "Test Source", kind: "movie", items: films }] };

test("the remote's Back goes one step out of every page, menu and window of the TV", async ({ browser }) => {
  test.setTimeout(240_000);
  // A guest with two lists (so that a title's page asks which one).
  const tv = await openLibrary(browser, withLibrary(library), HD, guestStorage({ listNames: [{ key: "lweekend", at: Date.now() - 5000, name: "Weekend" }] }));
  await expect(tv.getByTestId("tv-welcome")).toHaveCount(0, { timeout: 6_000 });
  const tiles = tv.getByTestId("tv-browse-tile");
  const click = (testId: string) => () => tv.getByTestId(testId).click();
  const title: Level = { open: () => tiles.first().click(), shown: id("tv-detail") };

  await test.step("a title's page, which list it goes in, and the page that makes a list", () =>
    backOut(tv, [title, { open: click("tv-detail-list"), shown: id("tv-list-picker") }, { open: click("pick-new"), shown: id("tv-list-edit") }]));

  await test.step("the scores, and the note", () =>
    backOut(tv, [
      title,
      { open: click("tv-detail-rate"), shown: id("tv-rate") },
      {
        open: async () => {
          await tv.getByTestId("rate-score-8").click();
          await tv.getByTestId("rate-note-button").click();
        },
        shown: id("tv-rate-note"),
      },
    ]));

  await test.step("the lists, the page that changes one, and its question before it is removed", () =>
    backOut(tv, [
      { open: click("rail-list"), shown: LISTS },
      {
        open: async () => {
          await tv.locator('[data-testid^="list-chip-l"]').click(); // (Weekend: the first list can't be removed)
          await tv.getByTestId("list-edit").click();
        },
        shown: id("tv-list-edit"),
      },
      { open: click("list-delete"), shown: id("list-delete-confirm") },
    ], viewing("home")));

  await test.step("the profile's page, and what it opens", () =>
    backOut(tv, [
      { open: click("tv-account-chip"), shown: viewing("profile") },
      { open: () => tv.locator('[data-entry="profile:history"]').click(), shown: viewing("history") },
    ], viewing("home")));

  await test.step("a guest's sign-in, from the profile's page, with the typed form on top of the code", () =>
    backOut(tv, [
      { open: click("tv-account-chip"), shown: viewing("profile") },
      { open: click("tv-profile-signin"), shown: id("tv-link-code") },
      { open: click("tv-signin-email"), shown: id("auth-form") },
    ], viewing("home")));

  await test.step("the settings, and the sign-in they lead to (Back goes to the settings, not past them)", async () => {
    await backOut(tv, [
      { open: () => openProfilePlace(tv, "settings"), shown: id("tv-account") },
      { open: click("tv-sign-in"), shown: id("tv-link-code") },
    ], viewing("profile"));
    await tv.getByTestId("rail-home").click();
  });

  await test.step("the code of a phone to connect", () => backOut(tv, [{ open: click("rail-connect"), shown: id("pairing-code") }]));

  await test.step("the watch party, and the page for joining one", () =>
    backOut(tv, [{ open: click("rail-party"), shown: id("tv-party-start") }, { open: click("tv-party-join"), shown: id("tv-party-join-page") }]));

  await test.step("the film, and the menus over it", async () => {
    await tiles.first().click();
    await tv.getByTestId("tv-detail-play").click();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    for (const [button, menu] of [["tv-speed-btn", "audio-subtitles-modal"], ["tv-party-btn", "tv-party-panel"]] as const) {
      await tv.mouse.move(60, 60); // (wakes the controls)
      await tv.getByTestId(button).click();
      await expect(tv.locator(id(menu))).toBeVisible();
      await tv.keyboard.press("Escape");
      await expect(tv.locator(id(menu))).toHaveCount(0);
      await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing");
    }
    await tv.mouse.move(70, 70);
    await expect(tvRoot(tv)).toHaveAttribute("data-hud", "visible");
    await tv.keyboard.press("Escape"); // with the controls up, Back leaves the film
    await expect(tv.getByTestId("tv-browse")).toBeVisible();
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "idle");
  });

  let code = "";
  await test.step("a party this screen hosts", () =>
    backOut(tv, [
      {
        open: async () => {
          await tv.getByTestId("rail-party").click();
          await tv.getByTestId("tv-party-start").click();
          await expect(tv.getByTestId("tv-party-code")).toHaveText(/\d/);
          code = (await tv.getByTestId("tv-party-code").innerText()).replace(/\s/g, "");
        },
        shown: id("tv-party-end"),
      },
    ]));

  await test.step("a screen that watches the party along: Back points at the way out, OK leaves", async () => {
    const guest = await openLibrary(browser, withLibrary(library), HD);
    await guest.getByTestId("rail-party").click();
    await guest.getByTestId("tv-party-join").click();
    for (const digit of code) await guest.getByTestId(`pad-${digit}`).click();
    await expect(guest.getByTestId("tv-following")).toBeVisible();
    await tiles.first().click();
    await tv.getByTestId("tv-detail-play").click();
    await expect(tvRoot(guest)).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
    await expect(guest.getByTestId("tv-follow-bar")).toBeVisible();

    await guest.keyboard.press("Escape");
    await expect(guest.getByTestId("tv-leave")).toBeFocused();
    await expect(tvRoot(guest)).toHaveAttribute("data-state", "playing"); // Back alone leaves nothing
    await guest.keyboard.press("Enter");
    await expect(guest.getByTestId("tv-leave")).toHaveCount(0);
    await expect(tvRoot(tv)).toHaveAttribute("data-state", "playing"); // and the host carries on
  });

  await test.step("a screen that is still waiting for its code", async () => {
    const waiting = await openLibrary(browser, sleepingServer(), HD); // (the server does not answer: there is no code to show yet)
    await waiting.getByTestId("rail-connect").click();
    await expect(waiting.getByTestId("tv-connecting")).toBeVisible();
    await waiting.keyboard.press("Escape");
    await expect(waiting.getByTestId("tv-connecting")).toHaveCount(0);
    await expect(waiting.getByTestId("tv-browse")).toBeVisible();
  });
});

test("the remote's Back, on a screen with a profile and friends", async ({ browser }) => {
  test.setTimeout(240_000);
  const name = `Ann${Date.now().toString(36).slice(-5)}`;
  const tv = await openLibrary(browser, withLibrary(library), HD);
  await openTvSignIn(tv);
  await tv.getByTestId("tv-signin-email").click();
  await tv.getByTestId("auth-switch").click();
  await expect(tv.getByTestId("auth-form")).toHaveAttribute("data-mode", "signUp");
  await tv.getByTestId("auth-email").fill(name);
  await tv.getByTestId("auth-password").fill("kino-test-pass-1"); // (a password that is not asked about)
  await tv.getByTestId("auth-submit").click();
  await expect(tv.getByTestId("tv-account-chip")).toContainText(name);
  await openProfilePlace(tv, "settings");
  await tv.getByTestId("tv-friends-switch").click();
  await expect(tv.getByTestId("tv-friends-switch")).toHaveAttribute("aria-checked", "true");
  await tv.getByTestId("tv-account-back").click();
  await expect(tv.locator('[data-entry="profile:friends"]')).toBeVisible();
  await tv.getByTestId("rail-home").click();
  const click = (testId: string) => () => tv.getByTestId(testId).click();
  const panel: Level = { open: () => openProfilePlace(tv, "settings"), shown: id("tv-account") }; // (the settings: the corner's button, then the one in the profile's corner)

  await test.step("the bell", () => backOut(tv, [{ open: click("tv-bell"), shown: id("tv-bell-page") }]));

  await test.step("the settings, the profiles, a profile, and the question before it is removed", () =>
    backOut(tv, [
      panel,
      { open: click("tv-manage-profiles"), shown: id("tv-profiles-done") },
      {
        open: async () => {
          await tv.getByTestId("profile-add").click();
          await tv.getByTestId("profile-name-input").fill("Kid");
          await tv.getByTestId("profile-save").click();
          await expect(tv.getByTestId("tv-profile-edit")).toHaveCount(0);
          await tv.getByTestId("profile-Kid").click();
        },
        shown: id("tv-profile-edit"),
      },
      { open: click("profile-delete"), shown: id("profile-delete-confirm") },
    ]));

  await test.step("signing another screen in", () => backOut(tv, [panel, { open: click("tv-approve"), shown: id("tv-approve-input") }]));

  await test.step("the friends' page, the question how to add one, and the page for a tag", () =>
    backOut(tv, [
      { open: () => openProfilePlace(tv, "friends"), shown: viewing("friends") },
      { open: () => tv.locator(`.tv-tile[title="${en["friends.add"]}"]`).click(), shown: id("tv-add-friend") },
      { open: click("tv-friend-tag"), shown: id("tv-friend-tag-page") },
    ], viewing("profile")));

  await test.step("the choices of what friends see", () =>
    backOut(tv, [
      { open: () => openProfilePlace(tv, "friends"), shown: viewing("friends") },
      { open: () => tv.locator('.tv-tile[title="Friends settings"]').click(), shown: id("tv-friend-settings") },
    ], viewing("profile")));
});
