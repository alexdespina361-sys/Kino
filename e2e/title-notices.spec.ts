import { expect, type BrowserContext, type Page } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { openDevice, openLibrary, openTvSignIn, PHONE, PICTURE_NAMED, test } from "./helpers";
import { TEST_ACCOUNT } from "./testAccount";

let counter = 0;
const fresh = () => ({ ...TEST_ACCOUNT, email: TEST_ACCOUNT.email.replace("@", `+news${Date.now().toString(36)}${++counter}@`) });

const episode = { id: "tv-7", at: Date.now() - 60_000, what: "episode", title: "The Show", url: "https://filmpire.sc/watch/7?s=1&e=1", year: 2024, season: 2, episode: 4, read: false };
const film = { id: "movie-102", at: Date.now() - 120_000, what: "film", title: "Part Three", url: "https://filmpire.sc/watch/102", year: 2026, like: "Part One", read: false };

function notices() {
  const state = { items: [episode, film] as Array<typeof episode | typeof film>, asked: [] as string[] };
  const setup = async (context: BrowserContext) => {
    await context.route(/\/api\/profiles\/[^/]+\/title-notices(\/\w+)?$/, async (route) => {
      const request = route.request();
      const what = new URL(request.url()).pathname.split("/title-notices")[1] || "/";
      state.asked.push(`${request.method()} ${what}`);
      if (what === "/seen") state.items = state.items.map((item) => ({ ...item, read: true }));
      if (what === "/dismiss") state.items = state.items.filter((item) => item.id !== (request.postDataJSON() as { id: string }).id);
      await route.fulfill({ json: { items: state.items } });
    });
  };
  return { state, setup };
}

async function signUpOnTv(tv: Page) {
  const account = fresh();
  await openTvSignIn(tv);
  await tv.getByTestId("tv-signin-create").click();
  await tv.getByTestId("auth-email").fill(account.email);
  await tv.getByTestId("auth-password").fill(account.password);
  await tv.getByTestId("auth-submit").click();
  await expect(tv.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", PICTURE_NAMED);
}

test.describe("what is new of the titles a profile watches", () => {
  test("is in the TV's bell: counted until looked at, a line each that opens the title, cleared with its cross", async ({ browser }) => {
    const { state, setup } = notices();
    const tv = await openLibrary(browser, setup);
    await signUpOnTv(tv);

    await expect(tv.getByTestId("tv-bell-badge")).toHaveText("2");
    await tv.getByTestId("tv-bell").click();
    await expect(tv.getByTestId("tv-bell-page")).toBeVisible();
    const lines = tv.getByTestId("tv-bell-titles").getByTestId("tv-bell-title");
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toContainText("The Show");
    await expect(lines.nth(0)).toContainText("New episode: season 2, episode 4");
    await expect(lines.nth(1)).toContainText("Part Three");
    await expect(lines.nth(1)).toContainText("A new film, after Part One");
    await expect(tv.getByTestId("tv-bell-empty")).toHaveCount(0);

    await expect.poll(() => state.asked).toContain("POST /seen");
    await tv.getByTestId("tv-bell-back").click();
    await expect(tv.getByTestId("tv-bell-page")).toHaveCount(0);
    await expect(tv.getByTestId("tv-bell-badge")).toHaveCount(0);

    await tv.getByTestId("tv-bell").click();
    await tv.getByTestId("tv-bell-titles").getByTestId("tv-bell-clear").first().click();
    await expect(lines).toHaveCount(1);
    await expect.poll(() => state.asked).toContain("POST /dismiss");
    expect(state.items.map((item) => item.id)).toEqual(["movie-102"]);

    await lines.first().click();
    await expect(tv.getByTestId("tv-detail-title")).toContainText("Part Three");
  });

  test("is in the phone's bell, above what friends sent", async ({ browser }) => {
    const { state, setup } = notices();
    const phone = await openDevice(browser, PHONE, {}, setup);
    await phone.goto("/");
    const account = fresh();
    await phone.getByTestId("account-button").click();
    await phone.getByTestId("auth-switch").click();
    await phone.getByTestId("auth-email").fill(account.email);
    await phone.getByTestId("auth-password").fill(account.password);
    await phone.getByTestId("auth-submit").click();
    await expect(phone.getByTestId("account-screen")).toBeVisible();
    await phone.keyboard.press("Escape");

    await expect(phone.getByTestId("bell-badge")).toHaveText("2");
    await phone.getByTestId("bell-button").click();
    const rows = phone.getByTestId("bell-titles").getByTestId("bell-title-item");
    await expect(rows).toHaveCount(2);
    await expect(phone.getByTestId("bell-sheet")).toContainText(en["bell.newTitles"]);
    await expect(rows.nth(0)).toContainText("The Show");
    await expect(rows.nth(0)).toContainText("New episode: season 2, episode 4");
    await expect(rows.nth(1)).toContainText("A new film, after Part One");
    await expect(phone.getByTestId("bell-empty")).toHaveCount(0);
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect.poll(() => state.asked).toContain("POST /seen");

    await rows.nth(0).getByTestId("bell-title-clear").click();
    await expect(rows).toHaveCount(1);
    await expect.poll(() => state.items.map((item) => item.id)).toEqual(["movie-102"]);
    await rows.first().getByTestId("bell-title-open").click();
    await expect(phone.getByTestId("bell-sheet")).toHaveCount(0);
  });
});
