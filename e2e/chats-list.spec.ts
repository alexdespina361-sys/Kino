import { expect, type Browser, type Page } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { nameFirstProfile, openDevice, openTvSignIn, PHONE, PICTURE_NAMED, test } from "./helpers";

test.use({ actionTimeout: 15_000 });

let counter = 0;
const fresh = (name: string) => ({ email: `${name}${++counter}c${Date.now().toString(36).slice(-4)}`, password: "kino-test-pass-1" });
type Account = ReturnType<typeof fresh>;
const nameOf = (account: Account) => account.email.charAt(0).toUpperCase() + account.email.slice(1);
const say = (text: string, params: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? "");

const look = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
const profileOf = async (page: Page) => (await page.evaluate(() => localStorage.getItem("kino.profile")))!;

interface Person {
  page: Page;
  name: string;
  id: string;
}

async function remote(browser: Browser, name: string, viewport: { width: number; height: number } = PHONE.viewport): Promise<Person> {
  const account = fresh(name);
  const page = await openDevice(browser, { ...PHONE, viewport, screen: viewport });
  await page.goto("/");
  await page.getByTestId("account-button").click();
  await page.getByTestId("auth-switch").click();
  await expect(page.getByTestId("auth-form")).toHaveAttribute("data-mode", "signUp");
  await page.getByTestId("auth-email").fill(account.email);
  await page.getByTestId("auth-password").fill(account.password);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("account-card")).toBeVisible();
  await nameFirstProfile(page, nameOf(account));
  await expect(page.getByTestId("account-button")).toBeVisible();
  return { page, name: nameOf(account), id: await profileOf(page) };
}

async function handHeld(browser: Browser, name: string, viewport = { width: 390, height: 844 }): Promise<Person> {
  const account = fresh(name);
  const page = await openDevice(browser, { viewport, screen: viewport, hasTouch: true, isMobile: true }, { "kino.role": "tv" });
  await page.goto("/tv");
  await expect(page.getByTestId("tv-browse")).toBeVisible();
  await openTvSignIn(page);
  await page.getByTestId("auth-switch").click();
  await expect(page.getByTestId("auth-form")).toHaveAttribute("data-mode", "signUp");
  await page.getByTestId("auth-email").fill(account.email);
  await page.getByTestId("auth-password").fill(account.password);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", PICTURE_NAMED);
  await nameFirstProfile(page, nameOf(account));
  await expect(page.getByTestId("tv-account-chip")).toContainText(nameOf(account));
  return { page, name: nameOf(account), id: await profileOf(page) };
}

async function befriend(giver: Person, taker: Person) {
  const invited = await giver.page.request.post(`/api/profiles/${giver.id}/friends/invites`, { data: {} });
  expect(invited.ok(), `invite: ${invited.status()}`).toBe(true);
  const { code } = (await invited.json()) as { code: string };
  const accepted = await taker.page.request.post(`/api/profiles/${taker.id}/friends/accept`, { data: { code } });
  expect(accepted.ok(), `accept: ${accepted.status()}`).toBe(true);
  await look(giver.page);
  await look(taker.page);
}

async function writes(from: Person, to: Person, text: string) {
  const response = await from.page.request.post(`/api/profiles/${from.id}/friends/${to.id}/chat`, { data: { text } });
  expect(response.status(), text).toBe(201);
}

type Box = { x: number; y: number; width: number; height: number };
const apart = (a: Box, b: Box) => a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5;

const cornerProblems = (page: Page, ids: string[]) =>
  page.evaluate((testIds) => {
    const problems: string[] = [];
    const boxes = testIds.map((id) => [id, document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect()] as const);
    for (const [id, box] of boxes) {
      if (!box) problems.push(`(no ${id})`);
      else if (box.left < -0.5 || box.right > innerWidth + 0.5 || box.top < -0.5) problems.push(`${id} leaves the screen`);
      else if (box.width < 32 || box.height < 32) problems.push(`${id} is ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
    if (document.documentElement.scrollWidth > innerWidth) problems.push("(the page scrolls sideways)");
    return { problems, boxes: boxes.flatMap(([id, box]) => (box ? [{ id, x: box.x, y: box.y, width: box.width, height: box.height }] : [])) };
  }, ids);

async function fitsInCorner(page: Page, ids: string[]) {
  const { problems, boxes } = await cornerProblems(page, ids);
  expect(problems).toEqual([]);
  for (const [at, one] of boxes.entries()) for (const other of boxes.slice(at + 1)) expect(apart(one, other), `${one.id} and ${other.id} overlap`).toBe(true);
}

const atHome = (page: Page) =>
  page.evaluate(() => {
    const button = document.querySelector('[data-testid="account-button"]');
    if (!button) return false;
    const box = button.getBoundingClientRect();
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return top !== null && button.contains(top);
  });

test.describe("the list of chats on the phone", () => {
  test("comes with a second friend, beside the bell: the friends who wrote are counted on it and no longer on the bell, the newest first, a row opens the chat, Back goes back to the list and then home", async ({ browser }) => {
    test.setTimeout(180_000);
    const ann = await remote(browser, "Ann");
    const bob = await remote(browser, "Bob");
    const cy = await remote(browser, "Cy");

    await befriend(ann, bob);
    await writes(bob, ann, "Hello Ann");
    await look(ann.page);
    await expect(ann.page.getByTestId("bell-badge")).toHaveText("1");
    await expect(ann.page.getByTestId("chats-button")).toHaveCount(0);

    await befriend(ann, cy);
    await expect(ann.page.getByTestId("chats-button")).toBeVisible();
    await expect(ann.page.getByTestId("chats-badge")).toHaveText("1");
    await expect(ann.page.getByTestId("bell-badge")).toHaveCount(0);
    await expect(bob.page.getByTestId("chats-button")).toHaveCount(0);
    await fitsInCorner(ann.page, ["chats-button", "bell-button", "account-button"]);

    await writes(cy, ann, "Hi from Cy, see\n you at nine");
    await look(ann.page);
    await expect(ann.page.getByTestId("chats-badge")).toHaveText("2");
    await expect(ann.page.getByTestId("chats-button")).toHaveAttribute("aria-label", say(en["chats.ariaCount_other"], { count: "2" }));

    await ann.page.getByTestId("bell-button").click();
    await expect(ann.page.getByTestId("bell-sheet")).toBeVisible();
    await expect(ann.page.getByTestId("bell-chat-item")).toHaveCount(0);
    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("bell-sheet")).toHaveCount(0);

    await ann.page.getByTestId("chats-button").click();
    const page = ann.page.getByTestId("chats-page");
    await expect(page).toBeVisible();
    const rows = ann.page.getByTestId("chats-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute("data-friend", cy.id);
    await expect(rows.nth(0)).toContainText(cy.name);
    await expect(rows.nth(0).getByTestId("chats-said")).toHaveText("Hi from Cy, see you at nine");
    await expect(rows.nth(0).getByTestId("chats-count")).toHaveText("1");
    await expect(rows.nth(1)).toHaveAttribute("data-friend", bob.id);
    await expect(rows.nth(1).getByTestId("chats-said")).toHaveText("Hello Ann");

    await rows.nth(1).click();
    await expect(ann.page.getByTestId("chat")).toBeVisible();
    await expect(ann.page.getByTestId("chat-text").first()).toHaveText("Hello Ann");
    await ann.page.getByTestId("chat-input").fill("Hi Bob");
    await ann.page.getByTestId("chat-send").click();
    await expect(ann.page.getByTestId("chat-text")).toHaveCount(2);

    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("chat")).toHaveCount(0);
    await expect(page).toBeVisible();
    await expect(rows.nth(0)).toHaveAttribute("data-friend", bob.id);
    await expect(rows.nth(0).getByTestId("chats-said")).toHaveText(say(en["chats.mine"], { text: "Hi Bob" }));
    await expect(rows.nth(0).getByTestId("chats-count")).toHaveCount(0);
    await expect(rows.nth(1).getByTestId("chats-count")).toHaveText("1");
    await expect(ann.page.getByTestId("chats-badge")).toHaveText("1");

    await ann.page.keyboard.press("Escape");
    await expect(page).toHaveCount(0);
    await expect.poll(() => atHome(ann.page)).toBe(true);
  });

  test("fits the narrowest phone: the four buttons of the corner, and a list with long names and messages", async ({ browser }) => {
    test.setTimeout(150_000);
    const narrow = { width: 320, height: 640 };
    const ann = await remote(browser, "Ann", narrow);
    const bob = await remote(browser, "Wilhelmin");
    const cy = await remote(browser, "Cy");
    await befriend(ann, bob);
    await befriend(ann, cy);
    await writes(bob, ann, `${"Supercalifragilisticexpialidocious ".repeat(6)}`);
    await look(ann.page);
    await expect(ann.page.getByTestId("chats-badge")).toHaveText("1");
    await fitsInCorner(ann.page, ["chats-button", "bell-button", "account-button"]);
    await ann.page.getByTestId("chats-button").click();
    await expect(ann.page.getByTestId("chats-row")).toHaveCount(2);
    const lost = () =>
      ann.page.evaluate(() => {
        const out: string[] = [];
        for (const element of document.querySelectorAll('[data-testid="chats-page"] *')) {
          const box = element.getBoundingClientRect();
          if (box.width > 0 && (box.left < -0.5 || box.right > innerWidth + 0.5)) out.push(element.className || element.tagName);
        }
        if (document.documentElement.scrollWidth > innerWidth) out.push("(the page scrolls sideways)");
        return out;
      });
    await expect.poll(lost, { timeout: 3_000 }).toEqual([]);
  });
});

test.describe("the list of chats on a phone showing the TV's pages", () => {
  test("is a chip beside the bell from the second friend: a row opens the chat, Back goes back to the list and then to the page it was opened from; a TV has none", async ({ browser }) => {
    test.setTimeout(180_000);
    const ann = await handHeld(browser, "Ann");
    const bob = await remote(browser, "Bob");
    const cy = await remote(browser, "Cy");
    await befriend(ann, bob);
    await writes(bob, ann, "Hello Ann");
    await look(ann.page);
    await expect(ann.page.getByTestId("tv-bell-badge")).toHaveText("1");
    await expect(ann.page.getByTestId("tv-chats")).toHaveCount(0);

    await befriend(ann, cy);
    await expect(ann.page.getByTestId("tv-chats")).toBeVisible();
    await expect(ann.page.getByTestId("tv-chats-badge")).toHaveText("1");
    await expect(ann.page.getByTestId("tv-bell-badge")).toHaveCount(0);
    await fitsInCorner(ann.page, ["tv-chats", "tv-bell", "tv-account-chip"]);

    await ann.page.getByTestId("tv-chats").click();
    await expect(ann.page.getByTestId("tv-chats-page")).toBeVisible();
    const rows = ann.page.getByTestId("tv-chats-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute("data-friend", bob.id);
    await expect(rows.nth(0).getByTestId("tv-chats-said")).toHaveText("Hello Ann");
    await expect(rows.nth(0).getByTestId("tv-chats-count")).toHaveText("1");
    await expect(rows.nth(1)).toHaveAttribute("data-friend", cy.id);
    await expect(rows.nth(1).getByTestId("tv-chats-count")).toHaveCount(0);

    await rows.nth(0).click();
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await expect(ann.page.getByTestId("tv-chat-lines").getByTestId("chat-text").first()).toHaveText("Hello Ann");
    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("tv-chat")).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-chats-page")).toBeVisible();
    await expect(rows.nth(0).getByTestId("tv-chats-count")).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-chats-badge")).toHaveCount(0);

    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("tv-chats-page")).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-browse")).toBeVisible();
    await expect(ann.page.getByTestId("tv-chats")).toBeVisible();

    await ann.page.setViewportSize({ width: 844, height: 390 });
    await fitsInCorner(ann.page, ["tv-chats", "tv-bell", "tv-account-chip"]);
    await ann.page.getByTestId("tv-chats").click();
    await expect(rows).toHaveCount(2);
    await expect
      .poll(
        () =>
          ann.page.evaluate(() => {
            const out: string[] = [];
            for (const element of document.querySelectorAll('[data-testid="tv-chats-page"] button, [data-testid="tv-chats-page"] h1')) {
              const box = element.getBoundingClientRect();
              if (box.left < -0.5 || box.right > innerWidth + 0.5) out.push(element.getAttribute("data-testid") ?? element.tagName);
            }
            if (document.documentElement.scrollWidth > innerWidth) out.push("(the page scrolls sideways)");
            return out;
          }),
        { timeout: 3_000 },
      )
      .toEqual([]);
    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("tv-chats-page")).toHaveCount(0);

    const tv = await openDevice(browser, { viewport: { width: 1280, height: 720 } });
    await tv.context().addCookies(await ann.page.context().cookies());
    await tv.goto("/tv");
    await tv.evaluate((id) => localStorage.setItem("kino.profile", id), ann.id);
    await tv.reload();
    await expect(tv.getByTestId("tv-bell")).toBeVisible();
    await expect(tv.getByTestId("tv-chats")).toHaveCount(0);
  });
});
