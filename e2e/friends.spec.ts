import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { ro } from "../src/client/i18n/ro";
import { listKey, ratingKey } from "../src/shared";
import { openDevice, openTv, PHONE, place, readPairingCode, test, withLibrary, nameFirstProfile } from "./helpers";

test.use({ actionTimeout: 15_000 });

let counter = 0;
const fresh = (name: string) => ({ email: `${name}${++counter}x${Date.now().toString(36).slice(-4)}`, password: "kino-test-pass-1" });
type Account = ReturnType<typeof fresh>;
const nameOf = (account: Account) => account.email.charAt(0).toUpperCase() + account.email.slice(1);

const newPhone = (browser: Browser, locale = "en-US") => openDevice(browser, { ...PHONE, locale });

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

const look = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

const say = (text: string, params: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? "");

type Box = { x: number; y: number; width: number; height: number };
const where = async (target: { boundingBox(): Promise<Box | null> }) => (await target.boundingBox())!;
const apart = (a: Box, b: Box) => a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5;
const inside = (a: Box, around: Box) => a.x >= around.x - 0.5 && a.y >= around.y - 0.5 && a.x + a.width <= around.x + around.width + 0.5 && a.y + a.height <= around.y + around.height + 0.5;

const keepClear = (card: Locator, parts: Locator[], width: number, room: number) =>
  expect
    .poll(
      async () => {
        const around = await where(card);
        const boxes = await Promise.all(parts.map(where));
        const fits =
          around.x >= 0 &&
          around.x + around.width <= width + 0.5 &&
          boxes[0]!.width >= room &&
          boxes.every((box, at) => inside(box, around) && boxes.slice(at + 1).every((other) => apart(box, other)));
        return fits ? "fits" : JSON.stringify({ around, boxes });
      },
      { message: `${width} wide` },
    )
    .toBe("fits");

async function phoneWithFriends(browser: Browser, name: string, locale = "en-US") {
  const account = fresh(name);
  const page = await newPhone(browser, locale);
  await page.goto("/");
  await signUp(page, account);
  await turnOnFriends(page);
  return { page, account, name: nameOf(account) };
}

async function befriend(giver: Page, taker: Page) {
  await openFriends(giver);
  await giver.getByTestId("friend-make-code").click();
  const code = (await giver.getByTestId("friend-invite-code").textContent())!;
  await openFriends(taker);
  await taker.getByTestId("friend-code-input").fill(code);
  await taker.getByTestId("friend-code-add").click();
  await expect(taker.getByTestId("friend-row")).toHaveCount(1);
  await look(giver);
  await expect(giver.getByTestId("friend-row")).toHaveCount(1);
  for (const page of [giver, taker]) await page.keyboard.press("Escape");
  return code;
}

async function seed(page: Page, data: Record<string, unknown[]>) {
  const profile = await page.evaluate(() => localStorage.getItem("kino.profile"));
  const response = await page.request.post(`/api/profiles/${profile}/sync`, { data: { since: 0, ...data } });
  expect(response.ok()).toBe(true);
}

async function chooses(page: Page, choices: Record<string, boolean>) {
  const profile = await page.evaluate(() => localStorage.getItem("kino.profile"));
  const settings = Object.entries(choices).map(([key, value]) => ({ key, at: Date.now(), value }));
  expect((await page.request.post(`/api/profiles/${profile}/sync`, { data: { since: 0, settings } })).ok()).toBe(true);
}
async function chose(page: Page, choices: Record<string, boolean>) {
  await chooses(page, choices);
  await page.reload();
}

async function kept(page: Page) {
  const profile = await page.evaluate(() => localStorage.getItem("kino.profile"));
  const answer = (await (await page.request.post(`/api/profiles/${profile}/sync`, { data: { since: 0 } })).json()) as { settings: Array<{ key: string; value?: unknown }> };
  return Object.fromEntries(answer.settings.map((item) => [item.key, item.value]));
}

async function inboxKinds(page: Page) {
  const profile = await page.evaluate(() => localStorage.getItem("kino.profile"));
  const state = (await (await page.request.get(`/api/profiles/${profile}/friends`)).json()) as { inbox: { kind: string }[] };
  return state.inbox.map((item) => item.kind);
}

const two = (n: number) => String(n).padStart(2, "0");
const dateValue = (at: Date) => `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
const timeValue = (at: Date) => `${two(at.getHours())}:${two(at.getMinutes())}`;

const outsideTheSides = (page: Page, ids: string[]) =>
  page.evaluate((testIds) => {
    const problems: string[] = [];
    for (const id of testIds) {
      const box = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
      if (!box) problems.push(`(no ${id})`);
      else if (box.left < -0.5 || box.right > innerWidth + 0.5) problems.push(`${id} leaves the screen`);
    }
    if (document.documentElement.scrollWidth > innerWidth) problems.push("(the page scrolls sideways)");
    return problems;
  }, ids);

const FILM = "https://films.example/watch/17";
const filmCards = () => {
  const at = Date.now();
  return {
    list: [{ key: listKey(FILM), at, id: "f17", title: "Alpha Film", url: FILM, year: 1931 }],
    ratings: [{ key: ratingKey(FILM), at, title: "Alpha Film", url: FILM, year: 1931, kind: "movie", score: 8, note: "Tight and clever", ratedAt: at }],
    progress: [{ key: "alpha", at, title: "Alpha Film", url: FILM, year: 1931, position: 600, duration: 5400 }],
  };
};

test.describe("friends are optional", () => {
  test("they are on from the start, with one switch, for sharing what is watched, and the choice reaches the server; a profile that had turned friends off shares nothing until it says so", async ({ browser }) => {
    const account = fresh("Ann");
    const page = await newPhone(browser);
    await page.goto("/");
    await signUp(page, account);
    await expect(page.getByTestId("menu-friends")).toBeVisible();
    await page.getByTestId("menu-settings").click();
    await expect(page.getByTestId("friends-switch")).toHaveCount(0);
    await expect(page.getByTestId("ratings-switch")).toHaveCount(0);
    const give = page.getByTestId("friends-give");
    await expect(give).toHaveAttribute("aria-checked", "false");
    await expect(give).toContainText(en["friends.switchGive"]);
    await expect(give).toContainText(en["friends.switchGiveHint"]);
    for (const gone of ["friends-lists", "friends-ratings", "friends-get", "friends-inbox-switch", "friends-presence", "friends-messages", "news-popups-switch"]) await expect(page.getByTestId(gone), gone).toHaveCount(0);
    await expect(page.getByTestId("friends-messages-hint")).toContainText("without encryption");
    await expect(page.getByTestId("friends-open")).toBeVisible();
    await expect(page.getByTestId("kept-friends")).toHaveCount(0);
    await give.click();
    await expect(give).toHaveAttribute("aria-checked", "true");

    await expect.poll(() => kept(page)).toMatchObject({ friendsGive: true });

    await chose(page, { friends: false });
    await page.getByTestId("account-button").click();
    await expect(page.getByTestId("menu-friends")).toBeVisible();
    await page.getByTestId("menu-settings").click();
    await expect(give).toHaveAttribute("aria-checked", "false");
    await give.click();
    await expect(give).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => kept(page)).toMatchObject({ friends: true, friendsGive: true });
  });

  test("a profile that had turned some of the others off keeps the switches for those, and only those; one turned back on stays until the page is left, and the lists it shares come back with it", async ({ browser }) => {
    test.setTimeout(120_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const page = ann.page;
    await chose(page, { friendsLists: false, friendsPresence: false, newsPopups: false });
    await page.getByTestId("account-button").click();
    await page.getByTestId("menu-settings").click();
    const lists = page.getByTestId("friends-lists");
    for (const id of ["friends-lists", "friends-presence", "news-popups-switch"]) await expect(page.getByTestId(id), id).toHaveAttribute("aria-checked", "false");
    for (const gone of ["friends-ratings", "friends-inbox-switch", "friends-messages", "friends-get"]) await expect(page.getByTestId(gone), gone).toHaveCount(0);

    await lists.click();
    await expect(lists).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => kept(page)).toMatchObject({ friendsLists: true, friendsPresence: false });

    await page.keyboard.press("Escape");
    await page.getByTestId("menu-settings").click();
    await expect(page.getByTestId("friends-lists")).toHaveCount(0);
    await expect(page.getByTestId("friends-presence")).toHaveAttribute("aria-checked", "false");
  });

  test("for a profile friends are turned off for, the friends are kept: the settings list them, and a friendship can be ended from there", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await befriend(ann.page, bob.page);

    await ann.page.getByTestId("menu-settings").click();
    await expect(ann.page.getByTestId("kept-friends")).toHaveCount(0);
    await ann.page.keyboard.press("Escape");
    await chose(ann.page, { friendsOff: true });
    await ann.page.getByTestId("account-button").click();
    await expect(ann.page.getByTestId("menu-friends")).toHaveCount(0);
    await ann.page.getByTestId("menu-settings").click();
    await expect(ann.page.getByTestId("friends-give")).toHaveCount(0);
    const kept = ann.page.getByTestId("kept-friend");
    await expect(kept).toHaveCount(1);
    await expect(kept).toContainText(bob.name);

    const remove = ann.page.getByTestId("kept-friend-remove");
    await remove.click();
    await expect(remove).toHaveAttribute("data-asking", "true");
    await remove.click();
    await expect(ann.page.getByTestId("account-toast")).toContainText(`${bob.name} is no longer your friend`);
    await expect(ann.page.getByTestId("kept-friends")).toHaveCount(0);

    await openFriends(bob.page);
    await look(bob.page);
    await expect(bob.page.getByTestId("friends-none")).toBeVisible();
  });

  test("a look at the kept friends that failed is tried again, so that they can still be removed once the connection is back", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await befriend(ann.page, bob.page);
    await chose(ann.page, { friendsOff: true });

    let asked = 0;
    await ann.page.route("**/friends/kept", (route) => (++asked === 1 ? route.abort("connectionfailed") : route.continue()));
    await ann.page.getByTestId("account-button").click();
    await ann.page.getByTestId("menu-settings").click();
    const kept = ann.page.getByTestId("kept-friend");
    await expect(kept).toHaveCount(1, { timeout: 30_000 });
    await expect(kept).toContainText(bob.name);
    expect(asked).toBeGreaterThan(1);
  });

  test("a profile that had turned ratings off shows friends none of them until it shares them again, with the switch that is there for it", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await befriend(ann.page, bob.page);
    await seed(ann.page, filmCards());
    await bob.page.getByTestId("menu-friends").click();
    await bob.page.getByTestId("friend-row").click();
    await bob.page.getByTestId("friend-tab-ratings").click();
    await expect(bob.page.getByTestId("friend-rating")).toContainText("Alpha Film");

    await chose(ann.page, { ratings: false });
    await expect(async () => {
      await look(bob.page);
      await expect(bob.page.getByTestId("friend-not-sharing")).toContainText(`${ann.name} is not sharing their ratings`, { timeout: 1500 });
    }).toPass();

    await ann.page.getByTestId("account-button").click();
    await expect(ann.page.getByTestId("menu-ratings")).toBeVisible();
    await ann.page.getByTestId("menu-settings").click();
    await expect(ann.page.getByTestId("ratings-switch")).toHaveCount(0);
    const share = ann.page.getByTestId("friends-ratings");
    await expect(share).toHaveAttribute("aria-checked", "false");
    await share.click();
    await expect.poll(() => kept(ann.page)).toMatchObject({ friendsRatings: true, ratings: true });
    await expect(async () => {
      await look(bob.page);
      await expect(bob.page.getByTestId("friend-rating")).toContainText("Alpha Film", { timeout: 1500 });
    }).toPass();
  });

  test("a phone that is not signed in is told friends belong to an account", async ({ browser }) => {
    const page = await newPhone(browser);
    await page.goto("/");
    await page.getByTestId("account-button").click();
    await page.getByTestId("menu-settings").click();
    await expect(page.getByTestId("friends-sign-in")).toBeVisible();
    await expect(page.getByTestId("friends-switch")).toHaveCount(0);
  });
});

test.describe("making friends", () => {
  test("a code one profile gives and another types makes them friends, on both sides; either can take the other off", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");

    await openFriends(ann.page);
    await expect(ann.page.getByTestId("friends-none")).toBeVisible();
    await ann.page.getByTestId("friend-make-code").click();
    const card = ann.page.getByTestId("friend-invite");
    await expect(card).toBeVisible();
    const code = (await ann.page.getByTestId("friend-invite-code").textContent())!;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    await expect(ann.page.getByTestId("friend-link-url")).toHaveText(new RegExp(`/\\?friend=${code.replace("-", "")}$`));

    await openFriends(bob.page);
    await bob.page.getByTestId("friend-code-input").fill(code.toLowerCase().replace("-", ""));
    await expect(bob.page.getByTestId("friend-code-name")).toHaveText(ann.name);
    await bob.page.getByTestId("friend-code-add").click();
    await expect(bob.page.getByTestId("account-toast")).toContainText(`You and ${ann.name} are now friends`);
    const head = await where(bob.page.locator(".page-head"));
    await expect.poll(async () => apart(await where(bob.page.getByTestId("account-toast")), head)).toBe(true);
    await expect(bob.page.getByTestId("friend-row")).toHaveCount(1);
    await expect(bob.page.getByTestId("friend-row")).toContainText(ann.name);

    await look(ann.page);
    await expect(ann.page.getByTestId("friend-row")).toContainText(bob.name);
    await expect(ann.page.getByTestId("friend-invite")).toHaveCount(0);

    await bob.page.getByTestId("friend-code-input").fill(code);
    await expect(bob.page.getByTestId("friend-code-error")).toBeVisible();

    await ann.page.getByTestId("friend-row").click();
    await expect(ann.page.getByTestId("friend-name")).toHaveText(bob.name);
    await ann.page.getByTestId("friend-remove").click();
    await expect(ann.page.getByTestId("friend-unfriend")).toContainText(`Remove ${bob.name}?`);
    await ann.page.getByTestId("friend-unfriend-cancel").click();
    await expect(ann.page.getByTestId("friend-unfriend")).toHaveCount(0);
    await ann.page.getByTestId("friend-remove").click();
    await ann.page.getByTestId("friend-unfriend-yes").click();
    await expect(ann.page.getByTestId("friends-none")).toBeVisible();
    await look(bob.page);
    await expect(bob.page.getByTestId("friends-none")).toBeVisible();
  });

  test("with five codes out the page says that another takes back the oldest, which is what it does", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    await openFriends(ann.page);
    const make = ann.page.getByTestId("friend-make-code");
    const codes = ann.page.getByTestId("friend-invite-code");
    const full = ann.page.getByTestId("friend-invites-full");

    for (let out = 1; out <= 4; out++) {
      await make.click();
      await expect(codes).toHaveCount(out);
    }
    await expect(full).toHaveCount(0);
    await make.click();
    await expect(codes).toHaveCount(5);
    await expect(full).toHaveText("You have 5 codes out. Making another takes back the oldest one.");

    const oldest = (await codes.first().textContent())!;
    await make.click();
    await expect(codes.filter({ hasText: oldest })).toHaveCount(0);
    await expect(codes).toHaveCount(5);
    await expect(full).toBeVisible();

    await ann.page.getByTestId("friend-invite-revoke").first().click();
    await expect(codes).toHaveCount(4);
    await expect(full).toHaveCount(0);
  });

  test("the code that is given has a small button that copies it, and what it copies is what a friend types", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await ann.page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const clipboard = () => ann.page.evaluate(() => navigator.clipboard.readText());

    await openFriends(ann.page);
    await ann.page.getByTestId("friend-make-code").click();
    const code = (await ann.page.getByTestId("friend-invite-code").textContent())!;
    const copy = ann.page.getByTestId("friend-invite-code-copy");
    await expect(copy).toHaveText("Copy code");
    await ann.page.evaluate(() => navigator.clipboard.writeText("something else"));
    await copy.click();
    await expect(copy).toHaveText("Code copied");
    expect(await clipboard()).toBe(code);
    await expect(copy).toHaveText("Copy code");

    await ann.page.getByTestId("friend-invite-code").click();
    expect(await ann.page.evaluate(() => window.getSelection()?.toString())).toBe(code);

    const copyLink = ann.page.getByTestId("friend-link-copy");
    await copyLink.click();
    await expect(copyLink).toHaveText("Link copied");
    expect(await clipboard()).toBe(await ann.page.getByTestId("friend-link-url").innerText());

    await copy.click();
    await expect(copy).toHaveText("Code copied");
    await openFriends(bob.page);
    await bob.page.getByTestId("friend-code-input").fill(await clipboard());
    await expect(bob.page.getByTestId("friend-code-name")).toHaveText(ann.name);
  });

  test("a phone that will not copy says so and selects the code, to be copied by hand", async ({ browser }) => {
    test.setTimeout(90_000);
    const account = fresh("Ann");
    const page = await newPhone(browser);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      document.execCommand = () => false;
    });
    await page.goto("/");
    await signUp(page, account);
    await turnOnFriends(page);
    await openFriends(page);
    await page.getByTestId("friend-make-code").click();
    const code = (await page.getByTestId("friend-invite-code").textContent())!;
    await page.getByTestId("friend-invite-code-copy").click();
    await expect(page.getByTestId("friend-invite").getByRole("status")).toHaveText("Could not copy: select the code and copy it");
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(code);
  });

  test("the button sits under the code, and the code, the button and the QR code keep clear of each other and inside the card, on the narrowest phone as on any", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    await openFriends(ann.page);
    await ann.page.getByTestId("friend-make-code").click();
    const card = ann.page.getByTestId("friend-invite");
    await expect(card).toBeVisible();
    for (const width of [320, 360, 375, 390, 430]) {
      await ann.page.setViewportSize({ width, height: 800 });
      await expect
        .poll(
          async () => {
            const [around, code, copy, qr] = await Promise.all([
              where(card),
              where(ann.page.getByTestId("friend-invite-code")),
              where(ann.page.getByTestId("friend-invite-code-copy")),
              where(card.getByTestId("pairing-qr")),
            ]);
            return (
              copy.y >= code.y + code.height - 0.5 &&
              copy.height <= 44 &&
              apart(code, qr) &&
              apart(copy, qr) &&
              [code, copy, qr].every((box) => inside(box, around)) &&
              around.x >= 0 &&
              around.x + around.width <= width + 0.5
            );
          },
          { message: `${width} wide` },
        )
        .toBe(true);
    }
  });

  test("a friend's link asks 'add them?' when the phone is signed in with friends on, and the code is used once", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await openFriends(ann.page);
    await ann.page.getByTestId("friend-make-code").click();
    const code = (await ann.page.getByTestId("friend-invite-code").textContent())!.replace("-", "");

    await bob.page.keyboard.press("Escape");
    await bob.page.goto(`/?friend=${code}`);
    await expect(bob.page.getByTestId("friend-link-sheet")).toBeVisible();
    expect(bob.page.url()).not.toContain("friend=");
    await expect(bob.page.getByTestId("friend-code-name")).toHaveText(ann.name);
    await bob.page.getByTestId("friend-code-add").click();
    await expect(bob.page.getByTestId("account-toast")).toContainText(ann.name);
    await expect(bob.page.getByTestId("friend-link-sheet")).toHaveCount(0);
    await expect.poll(() => bob.page.url()).not.toContain("friend=");

    const cy = await phoneWithFriends(browser, "Cy");
    await cy.page.goto(`/?friend=${code}`);
    await expect(cy.page.getByTestId("friend-code-error")).toBeVisible();
  });

  test("a phone that is signed out is asked to sign in, and one with friends off to turn them on, before the code is looked up", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    await openFriends(ann.page);
    await ann.page.getByTestId("friend-make-code").click();
    const code = (await ann.page.getByTestId("friend-invite-code").textContent())!.replace("-", "");

    const dee = await newPhone(browser);
    await dee.goto(`/?friend=${code}`);
    await expect(dee.getByTestId("friend-link-sheet")).toBeVisible();
    await expect(dee.getByTestId("friend-code-card")).toHaveCount(0);
    await dee.getByTestId("friend-link-signin").click();
    await dee.getByTestId("auth-switch").click();
    const account = fresh("Dee");
    await dee.getByTestId("auth-email").fill(account.email);
    await dee.getByTestId("auth-password").fill(account.password);
    await dee.getByTestId("auth-submit").click();
    await expect(dee.getByTestId("account-card")).toBeVisible();
    await dee.getByTestId("page-back").click();
    await expect(dee.getByTestId("friend-code-name")).toHaveText(ann.name);
    await dee.getByTestId("friend-code-add").click();
    await expect(dee.getByTestId("friend-link-sheet")).toHaveCount(0);
    await dee.getByTestId("account-button").click();
    await openFriends(dee);
    await expect(dee.getByTestId("friend-row")).toContainText(ann.name);
  });

  test("an answer that comes late does not bring back what a newer one has already taken away", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await befriend(ann.page, bob.page);
    await openFriends(ann.page);
    await expect(ann.page.getByTestId("friend-row")).toHaveCount(1);

    let letGo!: () => void;
    const held = new Promise<void>((resolve) => (letGo = resolve));
    let holding!: () => void;
    const isHeld = new Promise<void>((resolve) => (holding = resolve));
    let delivered!: () => void;
    const isDelivered = new Promise<void>((resolve) => (delivered = resolve));
    let looks = 0;
    await ann.page.route("**/api/profiles/*/friends", async (route) => {
      if (route.request().method() !== "GET" || looks++ > 0) return route.continue();
      const answer = await route.fetch();
      holding();
      await held;
      await route.fulfill({ response: answer });
      delivered();
    });
    await look(ann.page);
    await isHeld;

    await openFriends(bob.page);
    await bob.page.getByTestId("friend-row").click();
    await bob.page.getByTestId("friend-remove").click();
    await bob.page.getByTestId("friend-unfriend-yes").click();
    await expect(bob.page.getByTestId("friends-none")).toBeVisible();
    await look(ann.page);
    await expect(ann.page.getByTestId("friends-none")).toBeVisible();

    letGo();
    await isDelivered;
    await ann.page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
    await expect(ann.page.getByTestId("friends-none")).toBeVisible();
    await expect(ann.page.getByTestId("friend-row")).toHaveCount(0);
  });
});

test.describe("what a friend can see", () => {
  test("their lists and their ratings are on their page, for as long as they share them", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await befriend(ann.page, bob.page);
    await seed(ann.page, filmCards());

    await bob.page.getByTestId("menu-friends").click();
    await bob.page.getByTestId("friend-row").click();
    await expect(bob.page.getByTestId("friend-name")).toHaveText(ann.name);
    await expect(bob.page.getByTestId("friend-list-card-item")).toContainText("Alpha Film");
    await bob.page.getByTestId("friend-tab-ratings").click();
    const rating = bob.page.getByTestId("friend-rating");
    await expect(rating).toContainText("Alpha Film");
    await expect(rating).toContainText("8/10");
    await expect(rating).toContainText("Very good");
    await expect(rating).toContainText("Tight and clever");

    await chooses(ann.page, { friendsRatings: false });
    await ann.page.getByTestId("menu-settings").click();
    await bob.page.reload();
    await bob.page.getByTestId("account-button").click();
    await openFriends(bob.page);
    await bob.page.getByTestId("friend-row").click();
    await bob.page.getByTestId("friend-tab-ratings").click();
    await expect(bob.page.getByTestId("friend-not-sharing")).toContainText(`${ann.name} is not sharing their ratings`);
    await bob.page.getByTestId("friend-tab-lists").click();
    await expect(bob.page.getByTestId("friend-list-card-item")).toContainText("Alpha Film");

    await chooses(ann.page, { friendsOff: true });
    await bob.page.keyboard.press("Escape");
    await look(bob.page);
    await expect(bob.page.getByTestId("friend-row")).toContainText("Friends turned off");
    await bob.page.getByTestId("friend-row").click();
    await expect(bob.page.getByTestId("friend-off")).toBeVisible();
    await expect(bob.page.getByTestId("friend-not-sharing")).toBeVisible();
    await expect(bob.page.getByTestId("friend-list-card-item")).toHaveCount(0);
  });

  test("a friend's page puts first what both keep in a list, and says one's own score beside theirs", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await befriend(ann.page, bob.page);
    await seed(ann.page, filmCards());

    await bob.page.getByTestId("menu-friends").click();
    await bob.page.getByTestId("friend-row").click();
    await expect(bob.page.getByTestId("friend-list-card-item")).toContainText("Alpha Film");
    await expect(bob.page.getByTestId("friend-both")).toHaveCount(0);

    const at = Date.now();
    await seed(bob.page, { list: [{ key: listKey(FILM), at, id: "f17", title: "Alpha Film", url: FILM, year: 1931 }], ratings: [{ key: ratingKey(FILM), at, title: "Alpha Film", url: FILM, year: 1931, kind: "movie", score: 6, ratedAt: at }] });
    await bob.page.reload();
    await bob.page.getByTestId("account-button").click();
    await openFriends(bob.page);
    await bob.page.getByTestId("friend-row").click();
    await expect(bob.page.getByTestId("friend-both")).toContainText(en["friends.bothWant"]);
    await expect(bob.page.getByTestId("friend-both-card-item")).toContainText("Alpha Film");
    const both = await bob.page.getByTestId("friend-both").boundingBox();
    const theirs = await bob.page.getByTestId("friend-list").first().boundingBox();
    expect(both!.y).toBeLessThan(theirs!.y);
    await bob.page.getByTestId("friend-tab-ratings").click();
    await expect(bob.page.getByTestId("friend-rating")).toContainText("8/10");
    await expect(bob.page.getByTestId("friend-rating-mine")).toHaveText("You: 6/10");
  });

  test("what a friend watches is told when both share what they watch, and not otherwise", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await befriend(ann.page, bob.page);
    await seed(ann.page, filmCards());
    const seen = async () => {
      await bob.page.getByTestId("menu-friends").click();
      await look(bob.page);
      await expect(bob.page.getByTestId("friends-page")).toBeVisible();
    };
    const setSwitch = async (page: Page, id: string, on: boolean) => {
      await page.getByTestId("menu-settings").click();
      const toggle = page.getByTestId(id);
      if ((await toggle.getAttribute("aria-checked")) !== String(on)) await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", String(on));
      await page.keyboard.press("Escape");
    };

    await seen();
    await expect(bob.page.getByTestId("friends-activity")).toHaveCount(0);
    await bob.page.keyboard.press("Escape");

    await setSwitch(ann.page, "friends-give", true);
    await seen();
    await expect(bob.page.getByTestId("friends-activity")).toHaveCount(0);
    await bob.page.keyboard.press("Escape");

    await setSwitch(bob.page, "friends-give", true);
    await seen();
    await expect(bob.page.getByTestId("friends-activity")).toContainText("Alpha Film");
    await expect(bob.page.getByTestId("friends-activity")).toContainText(ann.name);
    await expect(bob.page.getByTestId("friend-row")).toContainText("Watching Alpha Film");
    await expect(bob.page.getByTestId("activity-item").locator(".lib-progress i")).toHaveAttribute("style", /width: 11%/);
    await bob.page.getByTestId("friend-row").click();
    await expect(bob.page.getByTestId("friend-list-card-item")).toContainText("11%");
    await bob.page.getByTestId("friend-tab-ratings").click();
    await expect(bob.page.getByTestId("friend-rating-progress")).toContainText("11%");
    await bob.page.keyboard.press("Escape");
    await bob.page.keyboard.press("Escape");

    await setSwitch(ann.page, "friends-give", false);
    await seen();
    await expect(bob.page.getByTestId("friends-activity")).toHaveCount(0);
  });

  test("the page of friends has the friends first (the one who watched last before the others), then what waits for an answer, then a row of what each friend watched", async ({ browser }) => {
    test.setTimeout(150_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    const cy = await phoneWithFriends(browser, "Cy");
    await befriend(ann.page, bob.page);
    await openFriends(cy.page);
    await cy.page.getByTestId("friend-make-code").click();
    const code = (await cy.page.getByTestId("friend-invite-code").textContent())!;
    await openFriends(bob.page);
    await bob.page.getByTestId("friend-code-input").fill(code);
    await bob.page.getByTestId("friend-code-add").click();
    await expect(bob.page.getByTestId("friend-row")).toHaveCount(2);
    for (const page of [bob.page, cy.page]) await page.keyboard.press("Escape");

    const share = async (page: Page) => {
      await page.getByTestId("menu-settings").click();
      await page.getByTestId("friends-give").click();
      await expect(page.getByTestId("friends-give")).toHaveAttribute("aria-checked", "true");
      await page.keyboard.press("Escape");
    };
    await seed(ann.page, filmCards());
    await share(ann.page);
    await share(bob.page);
    await share(cy.page);
    await seed(cy.page, { progress: [{ key: "beta", at: Date.now(), title: "Beta Film", url: "https://films.example/watch/18", year: 1940, position: 300, duration: 5400 }] });

    await openFriends(ann.page);
    await ann.page.getByTestId("friend-row").click();
    await ann.page.getByTestId("friend-together").click();
    await expect(ann.page.getByTestId("account-toast")).toContainText(`Asked ${bob.name} to watch together`);

    await look(bob.page);
    await openFriends(bob.page);
    const rows = bob.page.getByTestId("friends-activity");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute("aria-label", `What ${cy.name} watched`);
    await expect(rows.nth(0)).toContainText("Beta Film");
    await expect(rows.nth(1)).toHaveAttribute("aria-label", `What ${ann.name} watched`);
    await expect(rows.nth(1)).toContainText("Alpha Film");
    await expect(rows.nth(1)).not.toContainText("Beta Film");
    await expect(bob.page.getByTestId("friend-row").nth(0)).toContainText(cy.name);
    await expect(bob.page.getByTestId("friend-row").nth(1)).toContainText(ann.name);
    await expect(bob.page.getByTestId("inbox-together")).toContainText(`${ann.name} wants to watch together`);

    const top = async (id: string) => (await where(bob.page.getByTestId(id).first())).y;
    const [friendsAt, waitingAt, watchedAt] = [await top("friends-list"), await top("friends-inbox"), await top("friends-activity")];
    expect(friendsAt, "the friends come first").toBeLessThan(waitingAt);
    expect(waitingAt, "then what waits").toBeLessThan(watchedAt);
  });

  test("with the switches as they come, the page of friends says what friends watch is off and a button goes to the settings and back; a friend's page says why nothing of it is shown and can still be asked to watch together; with the switch on it says the friend is the one who does not tell", async ({ browser }) => {
    test.setTimeout(120_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await befriend(ann.page, bob.page);
    const page = ann.page;

    await openFriends(page);
    await expect(page.getByTestId("friends-activity-off")).toContainText("You don't see what friends watch yet");
    await page.getByTestId("friends-activity-settings").click();
    await expect(page.getByTestId("friends-give")).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("friends-page")).toBeVisible();

    await page.getByTestId("friend-row").click();
    await expect(page.getByTestId("friend-hint")).toContainText(`To see what ${bob.name} is watching, turn on “${en["friends.switchGive"]}” in the Friends settings.`);
    await page.getByTestId("friend-together").click();
    await expect(page.getByTestId("account-toast")).toContainText(`Asked ${bob.name} to watch together`);
    await openFriends(bob.page);
    await look(bob.page);
    await expect(bob.page.getByTestId("inbox-together")).toContainText(`${ann.name} wants to watch together`);

    await page.keyboard.press("Escape");
    await page.getByTestId("friends-activity-settings").click();
    await page.getByTestId("friends-give").click();
    await expect(page.getByTestId("friends-give")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("friends-page")).toBeVisible();
    await expect(page.getByTestId("friends-activity-off")).toHaveCount(0);
    await page.getByTestId("friend-row").click();
    await expect(page.getByTestId("friend-hint")).toHaveText(`${bob.name} isn't sharing what they watch.`);

    await bob.page.keyboard.press("Escape");
    await bob.page.getByTestId("menu-settings").click();
    await bob.page.getByTestId("friends-give").click();
    await expect(bob.page.getByTestId("friends-give")).toHaveAttribute("aria-checked", "true");
    await expect(async () => {
      await look(page);
      await expect(page.getByTestId("friend-hint")).toHaveCount(0, { timeout: 1500 });
    }).toPass({ timeout: 20_000 });
  });

  test("who is online: a friend with the page open has a green dot and 'Online', and one who turned that switch off has neither", async ({ browser }) => {
    test.setTimeout(90_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await befriend(ann.page, bob.page);
    await look(ann.page);
    await bob.page.getByTestId("menu-friends").click();
    const row = bob.page.getByTestId("friend-row");
    await expect(async () => {
      await look(bob.page);
      await expect(row).toContainText("Online", { timeout: 1500 });
    }).toPass();
    await expect(row.locator(".friend-pic")).toHaveAttribute("data-online", "true");
    await row.click();
    await expect(bob.page.getByTestId("friend-page")).toContainText("Online");
    await expect(bob.page.getByTestId("friend-now")).toHaveText("Online");
    await bob.page.keyboard.press("Escape");

    let away = true;
    await bob.page.route(/\/api\/profiles\/[^/]+\/friends$/, async (route) => {
      if (!away || route.request().method() !== "GET") return route.continue();
      try {
        const answer = await route.fetch();
        const state = await answer.json();
        for (const friend of state.friends ?? []) {
          delete friend.online;
          friend.lastOnline = Date.now() - 5 * 60_000;
        }
        await route.fulfill({ response: answer, json: state });
      } catch {
      }
    });
    await expect(async () => {
      await look(bob.page);
      await expect(row).toContainText("Last online 5 minutes ago", { timeout: 1500 });
    }).toPass();
    await expect(row.locator(".friend-pic")).toHaveAttribute("data-online", "false");
    await row.click();
    await expect(bob.page.getByTestId("friend-now")).toHaveText("Last online 5 minutes ago");
    await expect(bob.page.getByTestId("friend-status")).toContainText("Friends since");
    await bob.page.getByTestId("friend-chat").click();
    await expect(bob.page.getByTestId("chat-presence")).toHaveText(/^Last online (today|yesterday) at \d\d:\d\d$/);
    await expect(bob.page.getByTestId("chat-presence")).toHaveAttribute("data-online", "false");
    await bob.page.keyboard.press("Escape");
    await expect(bob.page.getByTestId("chat-sheet")).toHaveCount(0);
    await bob.page.keyboard.press("Escape");
    away = false;

    await chooses(ann.page, { friendsPresence: false });
    await expect(async () => {
      await look(bob.page);
      await expect(row.locator(".friend-pic")).toHaveAttribute("data-online", "false", { timeout: 1500 });
      await expect(row).not.toContainText("Online", { timeout: 1500 });
      await expect(row).not.toContainText("Last online", { timeout: 1500 });
    }).toPass();
  });
});

test.describe("sending things to friends", () => {
  const films = (baseURL: string) => ({
    updatedAt: Date.now(),
    rows: [{ id: "r", title: "Classics", source: "Test Source", kind: "movie", items: [{ id: "a", title: "Alpha Film", year: 1931, kind: "movie", url: `${baseURL}/fixtures/sample.mp4?n=1` }] }],
  });

  async function pairedPhone(browser: Browser, baseURL: string, name: string, locale = "en-US", fakeClock = false) {
    const account = fresh(name);
    const tv = await openTv(browser);
    const page = await openDevice(browser, { ...PHONE, locale }, {}, async (context) => {
      if (fakeClock) await context.clock.install();
      await withLibrary(films(baseURL))(context);
    });
    await page.goto("/");
    await page.getByTestId("code-input").fill(await readPairingCode(tv));
    await expect(page.getByTestId("tv-online")).toHaveClass(/\bok\b/);
    await signUp(page, account);
    await turnOnFriends(page);
    await backHome(page);
    return { page, tv, account, name: nameOf(account) };
  }

  async function backHome(page: Page) {
    await page.keyboard.press("Escape");
    if ((await page.getByTestId("tab-home").count()) > 0) await place(page, "home");
    await expect(page.getByTestId("account-screen")).toHaveCount(0);
  }

  async function meet(giver: Page, taker: Page) {
    for (const page of [giver, taker]) await page.getByTestId("account-button").click();
    await befriend(giver, taker);
    for (const page of [giver, taker]) await backHome(page);
  }

  test("a title is recommended with a few words, arrives in the other's inbox and on their home screen, and is dismissed with its cross", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const ann = await pairedPhone(browser, baseURL!, "Ann");
    const bob = await pairedPhone(browser, baseURL!, "Bob");
    await meet(bob.page, ann.page);

    await ann.page.locator('[data-testid="library-tile"][title="Alpha Film"]').click();
    await ann.page.getByTestId("title-recommend").click();
    await expect(ann.page.getByTestId("friend-pick")).toHaveCount(1);
    await expect(ann.page.getByTestId("friend-send")).toBeEnabled();
    await ann.page.getByTestId("friend-note").fill("You will like the ending");
    await ann.page.getByTestId("friend-send").click();
    await expect(ann.page.getByTestId("account-toast")).toContainText(`Sent to ${bob.name}`);
    await expect(ann.page.getByTestId("friend-picker")).toHaveCount(0);

    await look(bob.page);
    await expect(bob.page.getByTestId("account-toast")).toContainText(`${ann.name} sent you Alpha Film`);
    await expect(bob.page.getByTestId("bell-badge")).toHaveText("1");
    const row = bob.page.getByTestId("friends-row");
    await expect(row).toContainText("Alpha Film");
    await expect(row).toContainText(`From ${ann.name}`);
    await bob.page.getByTestId("friends-play").click();
    await expect(bob.page.getByTestId("title-sheet")).toContainText("You will like the ending");
    await bob.page.getByTestId("rate-title-score-7").click();
    await bob.page.getByTestId("title-back").click();
    await expect(row.getByTestId("score-badge")).toHaveText("7");

    await bob.page.getByTestId("account-button").click();
    await openFriends(bob.page);
    await expect(bob.page.getByTestId("inbox-recommendation")).toContainText("Alpha Film");
    await expect(bob.page.getByTestId("bell-badge")).toHaveCount(0);
    await bob.page.getByTestId("inbox-open").click();
    await expect(bob.page.getByTestId("title-sheet")).toBeVisible();
    await bob.page.keyboard.press("Escape");
    await expect(bob.page.getByTestId("title-sheet")).toHaveCount(0);
    await expect(bob.page.getByTestId("friends-page")).toBeVisible();
    await bob.page.getByTestId("inbox-dismiss").click();
    await expect(bob.page.getByTestId("inbox-recommendation")).toHaveCount(0);
    await bob.page.keyboard.press("Escape");
    await bob.page.keyboard.press("Escape");
    await expect(bob.page.getByTestId("friends-row")).toHaveCount(0);
  });

  test("an invitation to a watch party carries its code and a button that joins; one that is not wanted is sent away", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const ann = await pairedPhone(browser, baseURL!, "Ann");
    const bob = await pairedPhone(browser, baseURL!, "Bob");
    await meet(bob.page, ann.page);

    await ann.page.getByTestId("menu").click();
    await ann.page.getByTestId("party-open").click();
    await expect(ann.page.getByTestId("party-join-code")).toBeVisible();
    const code = ((await ann.page.getByTestId("party-join-code").textContent()) ?? "").replace(/\D/g, "");
    expect(code).toHaveLength(6);
    await ann.page.getByTestId("party-invite-friends").click();
    await ann.page.getByTestId("friend-send").click();
    await expect(ann.page.getByTestId("account-toast")).toContainText(`Invited ${bob.name}`);

    await look(bob.page);
    const banner = bob.page.getByTestId("friend-party-banner");
    await expect(banner).toContainText(`${ann.name} invited you to a watch party`);
    await expect(bob.page.getByTestId("friend-party-join")).toHaveAttribute("href", new RegExp(`/\\?party=${code}$`));
    await bob.page.getByTestId("friend-party-dismiss").click();
    await expect(banner).toHaveCount(0);
  });

  async function setting(page: Page, id: string, on: boolean) {
    await page.getByTestId("account-button").click();
    await page.getByTestId("menu-settings").click();
    const toggle = page.getByTestId(id);
    if ((await toggle.getAttribute("aria-checked")) !== String(on)) await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", String(on));
    await page.keyboard.press("Escape");
    await backHome(page);
  }

  test("a friend who tells what they watch can be asked to watch together; the one asked has a button that starts a party and invites the one who asked, and it fits the narrowest phone in Romanian", async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const ann = await pairedPhone(browser, baseURL!, "Ann", "ro-RO");
    const bob = await pairedPhone(browser, baseURL!, "Bob");
    await meet(bob.page, ann.page);
    await setting(ann.page, "friends-give", true);
    await setting(bob.page, "friends-give", true);

    await bob.page.getByTestId("account-button").click();
    await openFriends(bob.page);
    await bob.page.getByTestId("friend-row").click();
    await expect(async () => {
      await look(bob.page);
      await expect(bob.page.getByTestId("friend-together")).toBeVisible({ timeout: 1500 });
    }).toPass();
    await bob.page.getByTestId("friend-together").click();
    await expect(bob.page.getByTestId("account-toast")).toContainText(`Asked ${ann.name} to watch together`);
    for (let back = 0; back < 2; back++) await bob.page.keyboard.press("Escape");
    await backHome(bob.page);

    await look(ann.page);
    const asks = say(ro["friends.togetherOf"], { name: bob.name });
    const banner = ann.page.getByTestId("friend-together-banner");
    const start = ann.page.getByTestId("friend-together-start");
    await expect(banner).toContainText(asks);
    for (const width of [320, 360, 390]) {
      await ann.page.setViewportSize({ width, height: 800 });
      await keepClear(banner, [banner.locator("span").first(), start, ann.page.getByTestId("friend-together-dismiss")], width, 150);
    }
    await ann.page.getByTestId("account-button").click();
    await openFriends(ann.page);
    const row = ann.page.getByTestId("inbox-together");
    await expect(row).toContainText(asks);
    for (const width of [320, 360, 390]) {
      await ann.page.setViewportSize({ width, height: 800 });
      await keepClear(row, [row.locator(".inbox-text"), row.getByTestId("inbox-start"), row.getByTestId("inbox-dismiss")], width, 150);
    }
    await ann.page.keyboard.press("Escape");
    await backHome(ann.page);

    await start.click();
    await expect(ann.page.getByTestId("party-sheet")).toBeVisible();
    await expect(ann.page.getByTestId("party-join-code")).toBeVisible();
    await expect(ann.page.getByTestId("account-toast")).toContainText(say(ro["friends.inviteSent"], { names: bob.name }));
    await expect(banner).toHaveCount(0);
    await look(bob.page);
    await expect(bob.page.getByTestId("friend-party-banner")).toContainText(`${ann.name} invited you to a watch party`);
  });

  test("a friend who is not taking things is told apart: they are not offered, and the page says why", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const ann = await pairedPhone(browser, baseURL!, "Ann");
    const bob = await pairedPhone(browser, baseURL!, "Bob");
    await meet(bob.page, ann.page);
    await chooses(bob.page, { friendsInbox: false });

    await ann.page.locator('[data-testid="library-tile"][title="Alpha Film"]').click();
    await expect.poll(() => takesThings(ann.page, bob.name)).toBe(false);
    await ann.page.getByTestId("title-recommend").click();
    await expect(ann.page.getByTestId("friend-pick")).toHaveCount(0);
    await expect(ann.page.getByTestId("friend-picker-none")).toContainText("None of your friends is taking titles");
  });

  async function takesThings(page: Page, friend: string) {
    const profile = await page.evaluate(() => localStorage.getItem("kino.profile"));
    const state = (await (await page.request.get(`/api/profiles/${profile}/friends`)).json()) as { friends: { name: string; inbox: boolean }[] };
    return state.friends.find((one) => one.name === friend)?.inbox;
  }

  test("a title that nobody chosen takes any more keeps the sheet open with the words typed, and the friend is not offered again", async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const ann = await pairedPhone(browser, baseURL!, "Ann");
    const bob = await pairedPhone(browser, baseURL!, "Bob");
    const cy = await pairedPhone(browser, baseURL!, "Cy");
    await meet(bob.page, ann.page);
    await meet(cy.page, ann.page);

    await ann.page.locator('[data-testid="library-tile"][title="Alpha Film"]').click();
    await ann.page.getByTestId("title-recommend").click();
    const sheet = ann.page.getByTestId("friend-picker");
    await expect(sheet.getByTestId("friend-pick")).toHaveCount(2);
    await sheet.getByTestId("friend-pick").filter({ hasText: bob.name }).click();
    await sheet.getByTestId("friend-note").fill("You will like the ending");
    await chooses(bob.page, { friendsInbox: false });
    await expect.poll(() => takesThings(ann.page, bob.name)).toBe(false);

    await sheet.getByTestId("friend-send").click();
    await expect(sheet.getByRole("alert")).toContainText(`${bob.name}: not taking things right now`);
    await expect(sheet.getByTestId("friend-note")).toHaveValue("You will like the ending");
    await expect(sheet.getByTestId("friend-pick")).toHaveCount(1);
    await expect(sheet.getByTestId("friend-pick")).toContainText(cy.name);
    await expect(sheet.getByTestId("friend-pick")).toHaveAttribute("aria-checked", "false");
    await expect(sheet.getByTestId("friend-send")).toBeDisabled();

    await sheet.getByTestId("friend-pick").click();
    await sheet.getByTestId("friend-send").click();
    await expect(ann.page.getByTestId("account-toast")).toContainText(`Sent to ${cy.name}`);
    await expect(sheet).toHaveCount(0);
    await look(cy.page);
    await cy.page.getByTestId("friends-play").click();
    await expect(cy.page.getByTestId("title-sheet")).toContainText("You will like the ending");
  });

  test("a plan that is on says when its time has come, with a button that starts a party and invites the friend; the sheet that plans and the lines that tell it fit the narrowest phone in Romanian", async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const ann = await pairedPhone(browser, baseURL!, "Ann", "ro-RO", true);
    const bob = await pairedPhone(browser, baseURL!, "Bob", "ro-RO");
    await meet(bob.page, ann.page);

    await bob.page.getByTestId("account-button").click();
    await openFriends(bob.page);
    await bob.page.getByTestId("friend-row").click();
    await bob.page.getByTestId("friend-plan").click();
    const sheet = bob.page.getByTestId("plan-sheet");
    await expect(sheet).toBeVisible();
    const when = new Date(Date.now() + 10 * 60_000);
    when.setSeconds(0, 0);
    await sheet.getByTestId("plan-date").fill(dateValue(when));
    await sheet.getByTestId("plan-time").fill(timeValue(when));
    await sheet.getByTestId("plan-note").fill("Cu floricele de porumb");
    for (const width of [320, 360, 390]) {
      await bob.page.setViewportSize({ width, height: 800 });
      await expect.poll(() => outsideTheSides(bob.page, ["plan-date", "plan-time", "plan-summary", "plan-note", "plan-notice", "plan-send"]), { message: `the sheet, ${width} wide` }).toEqual([]);
    }
    await sheet.getByTestId("plan-send").click();
    await expect(bob.page.getByTestId("account-toast")).toContainText(say(ro["friends.planSent"], { name: ann.name }));
    await expect(sheet).toHaveCount(0);
    for (let back = 0; back < 2; back++) await bob.page.keyboard.press("Escape");
    await backHome(bob.page);

    await look(ann.page);
    await ann.page.getByTestId("account-button").click();
    await openFriends(ann.page);
    const row = ann.page.getByTestId("inbox-plan");
    await expect(row).toContainText(say(ro["friends.planOf"], { name: bob.name }));
    await expect(row).toContainText("Cu floricele de porumb");
    await expect(row).toContainText(timeValue(when));
    for (const width of [320, 360, 390]) {
      await ann.page.setViewportSize({ width, height: 800 });
      await keepClear(row, [row.locator(".inbox-text"), row.getByTestId("plan-accept"), row.getByTestId("plan-decline")], width, 150);
    }
    await row.getByTestId("plan-accept").click();
    await expect(row).toHaveAttribute("data-status", "agreed");
    await expect(row).toContainText(say(ro["friends.planAgreed"], { name: bob.name }));
    await ann.page.keyboard.press("Escape");
    await backHome(ann.page);

    const banner = ann.page.getByTestId("friend-plan-banner");
    await expect(banner).toHaveCount(0);
    await expect(ann.page.getByTestId("bell-badge")).toHaveCount(0);
    await ann.page.clock.fastForward(12 * 60_000);
    await expect(banner).toContainText(say(ro["friends.planDue"], { name: bob.name }));
    await expect(ann.page.getByTestId("bell-badge")).toHaveText("1");
    await expect(ann.page.getByTestId("account-toast")).toContainText(say(ro["friends.news.planDue"], { name: bob.name }));
    const start = ann.page.getByTestId("friend-plan-start");
    for (const width of [320, 360, 390]) {
      await ann.page.setViewportSize({ width, height: 800 });
      await keepClear(banner, [banner.locator("span").first(), start, ann.page.getByTestId("friend-plan-dismiss")], width, 150);
    }

    await start.click();
    await expect(ann.page.getByTestId("party-sheet")).toBeVisible();
    await expect(ann.page.getByTestId("party-join-code")).toBeVisible();
    await expect(ann.page.getByTestId("account-toast")).toContainText(say(ro["friends.inviteSent"], { names: bob.name }));
    await expect(banner).toHaveCount(0);
    await expect(ann.page.getByTestId("bell-badge")).toHaveCount(0);
    await expect.poll(() => inboxKinds(bob.page)).toEqual(["party"]);
    await look(bob.page);
    await expect(bob.page.getByTestId("friend-party-banner")).toBeVisible();
  });
});

test.describe("how soon a friend's news comes (there is no push: each screen asks)", () => {
  async function phoneWithClock(browser: Browser, name: string) {
    const account = fresh(name);
    const page = await openDevice(browser, PHONE, {}, async (context) => context.clock.install());
    await page.goto("/");
    await signUp(page, account);
    await turnOnFriends(page);
    return { page, account, name: nameOf(account) };
  }
  const profileOf = async (page: Page) => (await page.evaluate(() => localStorage.getItem("kino.profile")))!;
  async function sendTitle(from: Page, to: string, title: string) {
    const url = `https://films.example/watch/${encodeURIComponent(title)}`;
    const answer = await from.request.post(`/api/profiles/${await profileOf(from)}/friends/send`, { data: { kind: "recommend", title, url, to: [to] } });
    expect(answer.ok()).toBe(true);
  }

  test("a friend on the site is heard within 15 s, the next news within 8 s, and with nobody on and nothing going on it is still every half minute", async ({ browser }) => {
    test.setTimeout(120_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithClock(browser, "Bob");
    await befriend(ann.page, bob.page);
    const bobId = await profileOf(bob.page);
    const toast = bob.page.getByTestId("account-toast");
    await bob.page.clock.fastForward(3 * 60_000 + 1000);
    await expect(async () => {
      await look(bob.page);
      await bob.page.getByTestId("menu-friends").click();
      await expect(bob.page.getByTestId("friend-row")).toContainText("Online", { timeout: 1500 });
    }).toPass();
    await bob.page.keyboard.press("Escape");

    await look(bob.page);
    await sendTitle(ann.page, bobId, "Alpha Film");
    await bob.page.clock.fastForward(16_000);
    await expect(toast).toContainText(`${ann.name} sent you Alpha Film`, { timeout: 4000 });

    await chooses(ann.page, { friendsPresence: false });
    await sendTitle(ann.page, bobId, "Beta Film");
    await bob.page.clock.fastForward(9000);
    await expect(toast).toContainText(`${ann.name} sent you Beta Film`, { timeout: 3000 });

    await bob.page.clock.fastForward(3 * 60_000 + 1000);
    await look(bob.page);
    await sendTitle(ann.page, bobId, "Gamma Film");
    await bob.page.clock.fastForward(16_000);
    await bob.page.waitForTimeout(2000);
    expect((await toast.allTextContents()).join(" ")).not.toContain("Gamma Film");
    await bob.page.clock.fastForward(15_000);
    await expect(toast).toContainText(`${ann.name} sent you Gamma Film`, { timeout: 4000 });
  });
});

test.describe("plans to watch together", () => {
  const inDays = (days: number, hour: number, minute = 0) => {
    const at = new Date();
    at.setDate(at.getDate() + days);
    at.setHours(hour, minute, 0, 0);
    return at;
  };
  const wordsFor = (at: Date) => `${at.toLocaleDateString("en-GB", { weekday: "long" })} at ${timeValue(at)}`;

  async function planners(browser: Browser) {
    const ann = await phoneWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await befriend(bob.page, ann.page);
    return { ann, bob };
  }

  async function friendPage(page: Page) {
    await openFriends(page);
    await page.getByTestId("friend-row").click();
    await expect(page.getByTestId("friend-plan")).toBeVisible();
  }

  test("a plan is proposed from a friend's page, answered in the bell and on the page of friends, and what the friend said comes back to the one who proposed", async ({ browser }) => {
    test.setTimeout(180_000);
    const { ann, bob } = await planners(browser);
    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("account-screen")).toHaveCount(0);
    const saturday = inDays(2, 19, 30);
    const sunday = inDays(3, 21);

    await friendPage(bob.page);
    await bob.page.getByTestId("friend-plan").click();
    const sheet = bob.page.getByTestId("plan-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("plan-summary")).toBeVisible();
    await expect(sheet.getByTestId("plan-notice")).toContainText(`${ann.name} sees this`);
    await expect(sheet.getByTestId("plan-notice")).toContainText("no push messages or emails");
    const put = async (at: Date) => {
      await sheet.getByTestId("plan-date").fill(dateValue(at));
      await sheet.getByTestId("plan-time").fill(timeValue(at));
    };
    await put(new Date(Date.now() - 3_600_000));
    await sheet.getByTestId("plan-send").click();
    await expect(sheet.getByTestId("plan-error")).toHaveText(en["error.plan_soon"]);
    await put(inDays(45, 20));
    await sheet.getByTestId("plan-send").click();
    await expect(sheet.getByTestId("plan-error")).toHaveText(en["error.plan_far"]);
    await put(saturday);
    await expect(sheet.getByTestId("plan-summary")).toHaveText(wordsFor(saturday));
    await sheet.getByTestId("plan-note").fill("Bring snacks");
    await sheet.getByTestId("plan-send").click();
    await expect(bob.page.getByTestId("account-toast")).toContainText(`Plan sent to ${ann.name}`);
    await expect(sheet).toHaveCount(0);

    await look(ann.page);
    await expect(ann.page.getByTestId("account-toast")).toContainText(`${bob.name} proposes to watch together: ${wordsFor(saturday)}`);
    await expect(ann.page.getByTestId("bell-badge")).toHaveText("1");
    await ann.page.getByTestId("bell-button").click();
    const inBell = ann.page.getByTestId("bell-sheet").getByTestId("inbox-plan");
    await expect(inBell).toHaveAttribute("data-status", "asks");
    await expect(inBell.getByTestId("inbox-plan-heading")).toHaveText(`${bob.name} proposes to watch together`);
    await expect(inBell.getByTestId("inbox-plan-detail")).toHaveText(`${wordsFor(saturday)} · Bring snacks`);
    await expect(inBell.getByTestId("plan-accept")).toBeVisible();
    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("bell-sheet")).toHaveCount(0);

    await ann.page.getByTestId("account-button").click();
    await openFriends(ann.page);
    const row = ann.page.getByTestId("friends-inbox").getByTestId("inbox-plan");
    await expect(row).toHaveAttribute("data-status", "asks");
    await row.getByTestId("plan-accept").click();
    await expect(row).toHaveAttribute("data-status", "agreed");
    await expect(row.getByTestId("inbox-plan-heading")).toHaveText(`Watching together with ${bob.name}`);
    await expect(row.getByTestId("inbox-plan-detail")).toHaveText(`${wordsFor(saturday)} · Bring snacks`);
    await expect(row.getByTestId("plan-accept")).toHaveCount(0);

    await look(bob.page);
    await expect(bob.page.getByTestId("account-toast")).toContainText(`${ann.name} said yes to watching together: ${wordsFor(saturday)}`);
    await bob.page.keyboard.press("Escape");
    const bobsRow = bob.page.getByTestId("friends-inbox").getByTestId("inbox-plan");
    await expect(bobsRow).toHaveAttribute("data-status", "agreed");
    await expect(bobsRow.getByTestId("inbox-plan-heading")).toHaveText(`Watching together with ${ann.name}`);
    await expect(bobsRow.getByTestId("inbox-plan-detail")).toHaveText(wordsFor(saturday));

    await bob.page.keyboard.press("Escape");
    await expect(bob.page.getByTestId("menu-friends")).toBeVisible();
    await friendPage(bob.page);
    await bob.page.getByTestId("friend-plan").click();
    await put(sunday);
    await bob.page.getByTestId("plan-send").click();
    await expect(bob.page.getByTestId("account-toast")).toContainText(`Plan sent to ${ann.name}`);
    await look(ann.page);
    await expect(ann.page.getByTestId("friends-inbox").getByTestId("inbox-plan")).toHaveCount(2);
    const asks = ann.page.getByTestId("friends-inbox").locator('[data-testid="inbox-plan"][data-status="asks"]');
    await expect(asks.getByTestId("inbox-plan-detail")).toHaveText(wordsFor(sunday));
    await asks.getByTestId("plan-decline").click();
    await expect(ann.page.getByTestId("friends-inbox").getByTestId("inbox-plan")).toHaveCount(1);
    await expect(ann.page.getByTestId("friends-inbox").getByTestId("inbox-plan")).toHaveAttribute("data-status", "agreed");

    await look(bob.page);
    await expect(bob.page.getByTestId("account-toast")).toContainText(`${ann.name} can't make it: ${wordsFor(sunday)}`);
    await bob.page.keyboard.press("Escape");
    const declined = bob.page.getByTestId("friends-inbox").locator('[data-testid="inbox-plan"][data-status="declined"]');
    await expect(declined.getByTestId("inbox-plan-heading")).toHaveText(`${ann.name} can't make it`);
    await expect(declined.getByTestId("inbox-plan-detail")).toHaveText(wordsFor(sunday));
    await declined.getByTestId("inbox-dismiss").click();
    await expect(declined).toHaveCount(0);
    await expect(bob.page.getByTestId("friends-inbox").getByTestId("inbox-plan")).toHaveCount(1);
  });
});
