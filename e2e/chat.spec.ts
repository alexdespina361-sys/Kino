import { expect, type Browser, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import sharp from "sharp";
import { en } from "../src/client/i18n/en";
import { it as italian } from "../src/client/i18n/it";
import { ro } from "../src/client/i18n/ro";
import { CHAT_REPORT_LINES, CHAT_TEXT_MAX, ratingKey } from "../src/shared";
import { FEEDBACK_TOKEN } from "./feedbackToken";
import { openDevice, openLibrary, openProfilePlace, openTvSignIn, PHONE, seeded, test, showProfilePage, nameFirstProfile, PICTURE_NAMED } from "./helpers";

test.use({ actionTimeout: 15_000 });

let counter = 0;
const fresh = (name: string) => ({ email: `${name}${++counter}x${Date.now().toString(36).slice(-4)}`, password: "kino-test-pass-1" });
type Account = ReturnType<typeof fresh>;
const nameOf = (account: Account) => account.email.charAt(0).toUpperCase() + account.email.slice(1);

const say = (text: string, params: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? "");

const look = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

const profileOf = (page: Page) => page.evaluate(() => localStorage.getItem("kino.profile"));

async function kept(page: Page) {
  const answer = (await (await page.request.post(`/api/profiles/${await profileOf(page)}/sync`, { data: { since: 0 } })).json()) as { settings: Array<{ key: string; value?: unknown }> };
  return Object.fromEntries(answer.settings.map((item) => [item.key, item.value]));
}

async function chose(page: Page, choices: Record<string, boolean>) {
  const settings = Object.entries(choices).map(([key, value]) => ({ key, at: Date.now(), value }));
  expect((await page.request.post(`/api/profiles/${await profileOf(page)}/sync`, { data: { since: 0, settings } })).ok()).toBe(true);
  await page.reload();
}

const WORDS = { en, ro, it: italian };
type Language = keyof typeof WORDS;

const SOON = { timeout: 12_000 };

async function writes(from: Page, to: Page, text: string) {
  const response = await from.request.post(`/api/profiles/${await profileOf(from)}/friends/${await profileOf(to)}/chat`, { data: { text } });
  expect(response.status(), text).toBe(201);
}

const AUTH = { authorization: `Bearer ${FEEDBACK_TOKEN}` };
interface Report {
  id: string;
  kind: string;
  area: string;
  answerable: boolean;
  attachments: Array<{ id: string; name: string; mime: string; role: string }>;
}
async function reportsAbout(page: Page, word: string): Promise<Report[]> {
  const listed = await page.request.get(`/api/admin/feedback?q=${encodeURIComponent(word)}&limit=20`, { headers: AUTH });
  expect(listed.status()).toBe(200);
  const items = ((await listed.json()) as { items: Array<{ id: string }> }).items;
  return Promise.all(items.map(async (item) => (await (await page.request.get(`/api/admin/feedback/${item.id}`, { headers: AUTH })).json()) as Report));
}

const LONG = `Ne uităm la un film cu multe explozii și vorbim după aceea despre ce ne-a plăcut, ${"Supercalifragilisticexpialidocios".repeat(2)} și apoi mâncăm floricele de porumb cu suc de portocale, ${"și tot așa ".repeat(60)}`.slice(0, CHAT_TEXT_MAX);

type Box = { x: number; y: number; width: number; height: number };
const where = async (target: { boundingBox(): Promise<Box | null> }) => (await target.boundingBox())!;
const apart = (a: Box, b: Box) => a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5;

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

async function openFriendsPage(page: Page) {
  await page.getByTestId("menu-friends").click();
  await expect(page.getByTestId("friends-page")).toBeVisible();
}

async function home(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("account-screen")).toHaveCount(0);
}

async function openFriendPage(page: Page) {
  await page.getByTestId("account-button").click();
  await openFriendsPage(page);
  await page.getByTestId("friend-row").click();
  await expect(page.getByTestId("friend-page")).toBeVisible();
}

async function openChat(page: Page) {
  await openFriendPage(page);
  await page.getByTestId("friend-chat").click();
  await expect(page.getByTestId("chat")).toBeVisible();
}

const atHome = (page: Page) =>
  page.evaluate(() => {
    const button = document.querySelector('[data-testid="account-button"]');
    if (!button) return false;
    const box = button.getBoundingClientRect();
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return top !== null && button.contains(top);
  });

async function backHome(page: Page) {
  for (let back = 0; back < 6 && !(await atHome(page)); back++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
  await expect.poll(() => atHome(page)).toBe(true);
}

async function phoneWithFriends(browser: Browser, name: string, locale = "en-US") {
  const account = fresh(name);
  const page = await newPhone(browser, locale);
  await page.goto("/");
  await signUp(page, account);
  await turnOnFriends(page);
  return { page, account, name: nameOf(account) };
}
type Phone = Awaited<ReturnType<typeof phoneWithFriends>>;

async function befriend(giver: Page, taker: Page) {
  await openFriendsPage(giver);
  await giver.getByTestId("friend-make-code").click();
  const code = (await giver.getByTestId("friend-invite-code").textContent())!;
  await openFriendsPage(taker);
  await taker.getByTestId("friend-code-input").fill(code);
  await taker.getByTestId("friend-code-add").click();
  await expect(taker.getByTestId("friend-row")).toHaveCount(1);
  await look(giver);
  await expect(giver.getByTestId("friend-row")).toHaveCount(1);
  for (const page of [giver, taker]) {
    await page.keyboard.press("Escape");
    await home(page);
  }
}

async function twoFriends(browser: Browser, locale = "en-US") {
  const ann = await phoneWithFriends(browser, "Ann", locale);
  const bob = await phoneWithFriends(browser, "Bob", locale);
  await befriend(ann.page, bob.page);
  return { ann, bob };
}

async function write(page: Page, text: string) {
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("chat-send").click();
}

async function fromMenu(page: Page, testId: string) {
  await page.getByTestId("chat-more").click();
  await expect(page.getByTestId("chat-menu")).toBeVisible();
  await page.getByTestId("chat-menu").getByTestId(testId).click();
  await expect(page.getByTestId("chat-menu")).toBeHidden();
}

async function openPanel(page: Page, tab: "titles" | "gifs" | "stickers", prefix: "chat" | "tv-chat" = "chat") {
  const panel = page.getByTestId(`${prefix}-panel`);
  if ((await panel.count()) === 0) await page.getByTestId(`${prefix}-panel-btn`).click();
  await expect(panel).toBeVisible();
  const chosen = panel.locator(`[role='tab'][data-tab='${tab}']`);
  if ((await chosen.getAttribute("aria-selected")) !== "true") await chosen.click();
  await expect(panel).toHaveAttribute("data-tab", tab);
  return panel;
}

const bell = (page: Page) => page.getByTestId("bell-button");
const badge = (page: Page) => page.getByTestId("bell-badge");
const lines = (page: Page) => page.getByTestId("chat-line");
const texts = (page: Page) => page.getByTestId("chat-text");

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

test.describe("the chat on the phone", () => {
  test("a message reaches the open chat of a friend within seconds, and waits quietly for one who is not looking: a line on the friends page, a number on the bell, a row in it that opens the chat", async ({ browser }) => {
    test.setTimeout(150_000);
    const { ann, bob } = await twoFriends(browser);

    await openChat(ann.page);
    await expect(ann.page.getByTestId("chat-empty")).toBeVisible();
    await expect(ann.page.getByTestId("chat-privacy")).toContainText("without encryption");

    await write(ann.page, "  Hello Bob  ");
    await expect(lines(ann.page)).toHaveCount(1);
    await expect(lines(ann.page).first()).toHaveAttribute("data-mine", "true");
    await expect(texts(ann.page).first()).toHaveText("Hello Bob");
    await expect(ann.page.getByTestId("chat-input")).toHaveText("");
    await expect(ann.page.getByTestId("chat-input")).toBeFocused();

    await look(bob.page);
    await expect(badge(bob.page)).toHaveText("1");
    await expect(bob.page.getByTestId("account-toast")).toHaveCount(0);

    await openFriendPage(bob.page);
    await expect(bob.page.getByTestId("friend-chat-unread")).toHaveText(say(en["chat.unreadShort_one"], { count: "1" }));
    await bob.page.keyboard.press("Escape");
    await expect(bob.page.getByTestId("friend-unread")).toHaveText(say(en["chat.unreadShort_one"], { count: "1" }));
    await bob.page.keyboard.press("Escape");
    await home(bob.page);

    await bell(bob.page).click();
    const row = bob.page.getByTestId("bell-chat-item");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveText(say(en["chat.unread_one"], { count: "1", name: ann.name }));
    await row.getByTestId("bell-chat-open").click();
    await expect(bob.page.getByTestId("bell-sheet")).toHaveCount(0);
    await expect(bob.page.getByTestId("chat")).toBeVisible();
    await expect(lines(bob.page)).toHaveCount(1);
    await expect(lines(bob.page).first()).toHaveAttribute("data-mine", "false");
    await expect(texts(bob.page).first()).toHaveText("Hello Bob");

    await write(bob.page, "Hi Ann");
    await expect(lines(ann.page)).toHaveCount(2, SOON);
    await expect(lines(ann.page).nth(1)).toHaveAttribute("data-mine", "false");
    await expect(texts(ann.page).nth(1)).toHaveText("Hi Ann");

    await bob.page.keyboard.press("Escape");
    await expect(bob.page.getByTestId("chat")).toHaveCount(0);
    await backHome(bob.page);
    await expect(badge(bob.page)).toHaveCount(0);
    await ann.page.keyboard.press("Escape");
    await backHome(ann.page);
    await expect(badge(ann.page)).toHaveCount(0);
  });

  test("the bell's cross on a friend who wrote marks the chat read without opening it: the number goes, and the message is in the chat", async ({ browser }) => {
    test.setTimeout(150_000);
    const { ann, bob } = await twoFriends(browser);
    await writes(ann.page, bob.page, "Are you there?");
    await backHome(bob.page);
    await look(bob.page);
    await expect(badge(bob.page)).toHaveText("1");
    await bell(bob.page).click();
    await expect(bob.page.getByTestId("bell-chat-item")).toHaveCount(1);
    await bob.page.getByTestId("bell-chat-clear").click();
    await expect(bob.page.getByTestId("bell-chat-item")).toHaveCount(0);
    await expect(bob.page.getByTestId("bell-sheet")).toBeVisible();
    await backHome(bob.page);
    await look(bob.page);
    await expect(badge(bob.page)).toHaveCount(0);
    await openFriendPage(bob.page);
    await expect(bob.page.getByTestId("friend-chat-unread")).toHaveCount(0);
    await bob.page.getByTestId("friend-chat").click();
    await expect(lines(bob.page)).toHaveCount(1);
    await expect(texts(bob.page).first()).toHaveText("Are you there?");
  });

  test("what is typed while a message is on its way stays in the box when the message has been sent", async ({ browser }) => {
    test.setTimeout(150_000);
    const { ann } = await twoFriends(browser);
    await openChat(ann.page);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await ann.page.route(/\/friends\/[^/]+\/chat(\?|$)/, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await held;
      return route.continue();
    });
    const input = ann.page.getByTestId("chat-input");
    await input.fill("first message");
    await ann.page.getByTestId("chat-send").click();
    await input.pressSequentially("second one typed meanwhile");
    release();
    await expect(texts(ann.page)).toHaveText(["first message"]);
    await expect(input).toHaveText("second one typed meanwhile");
    await ann.page.getByTestId("chat-send").click();
    await expect(texts(ann.page)).toHaveText(["first message", "second one typed meanwhile"]);
    await expect(input).toHaveText("");
  });

  test("a message of one's own can be taken back, and is gone for both; a friend can be muted without being told, and the messages are in the chat when it is opened", async ({ browser }) => {
    test.setTimeout(150_000);
    const { ann, bob } = await twoFriends(browser);
    await openChat(ann.page);
    await openChat(bob.page);
    await look(bob.page);

    await write(ann.page, "Oops, wrong chat");
    await expect(lines(bob.page)).toHaveCount(1, SOON);
    await bob.page.getByTestId("chat-bubble").click();
    await expect(bob.page.getByTestId("chat-react-bar")).toBeVisible();
    await expect(bob.page.getByTestId("chat-takeback")).toHaveCount(0);
    await ann.page.getByTestId("chat-bubble").click();
    await ann.page.getByTestId("chat-takeback").click();
    await expect(lines(ann.page)).toHaveCount(0);
    await expect(ann.page.getByTestId("chat-empty")).toBeVisible();
    await expect(lines(bob.page)).toHaveCount(0, SOON);

    await fromMenu(bob.page, "chat-mute");
    await expect(bob.page.getByTestId("chat-muted")).toContainText(say(en["chat.muted"], { name: ann.name }));
    await expect(bob.page.getByTestId("chat-mute")).toHaveText(en["chat.unmute"]);
    await expect(bob.page.getByTestId("chat-presence")).toContainText(en["chat.mutedShort"]);
    await write(ann.page, "Are you there?");
    await expect(lines(ann.page)).toHaveCount(1);
    await expect(ann.page.getByTestId("chat-muted")).toHaveCount(0);
    await expect(lines(bob.page)).toHaveCount(1, SOON);

    await bob.page.keyboard.press("Escape");
    await expect(bob.page.getByTestId("chat")).toHaveCount(0);
    await bob.page.keyboard.press("Escape");
    await expect(bob.page.getByTestId("friend-row")).toBeVisible();
    await write(ann.page, "Hello?");
    await expect(lines(ann.page)).toHaveCount(2);
    await look(bob.page);
    await expect(bob.page.getByTestId("friend-row")).toBeVisible();
    await expect(bob.page.getByTestId("friend-unread")).toHaveCount(0);
    await backHome(bob.page);
    await expect(badge(bob.page)).toHaveCount(0);

    await openChat(bob.page);
    await expect(lines(bob.page)).toHaveCount(2);
    await fromMenu(bob.page, "chat-mute");
    await expect(bob.page.getByTestId("chat-muted")).toHaveCount(0);
    await expect(bob.page.getByTestId("chat-mute")).toHaveText(en["chat.mute"]);
    await expect(bob.page.getByTestId("chat-presence")).not.toContainText(en["chat.mutedShort"]);
  });

  test("friends can message a profile with no switch for it (the settings say what a chat is kept as); a friend who turned it off before is not written to (the chat says so, in a plain line), has the switch to turn it on, and the box comes back when it is on again", async ({ browser }) => {
    test.setTimeout(180_000);
    const { ann, bob } = await twoFriends(browser);

    await bob.page.getByTestId("account-button").click();
    await bob.page.getByTestId("menu-settings").click();
    await expect(bob.page.getByTestId("friends-messages")).toHaveCount(0);
    await expect(bob.page.getByTestId("friends-messages-hint")).toContainText("without encryption");
    await bob.page.keyboard.press("Escape");
    await home(bob.page);

    await openChat(ann.page);
    await expect(ann.page.getByTestId("chat-compose")).toBeVisible();
    await expect(ann.page.getByTestId("chat-closed")).toHaveCount(0);
    await ann.page.route(/\/friends\/[^/]+\/chat(\?|$)/, (route) => (route.request().method() === "GET" ? route.abort("connectionfailed") : route.continue()));

    await chose(bob.page, { friendsMessages: false });
    await expect.poll(() => kept(bob.page)).toMatchObject({ friendsMessages: false });

    await write(ann.page, "Are you free tonight?");
    await expect(ann.page.getByTestId("chat-closed")).toHaveText(say(en["chat.closed"], { name: bob.name }));
    await expect(ann.page.getByTestId("chat-problem")).toHaveCount(0);
    await expect(ann.page.getByTestId("chat-compose")).toHaveCount(0);
    await expect(lines(ann.page)).toHaveCount(0);

    await openChat(bob.page);
    await expect(bob.page.getByTestId("chat-mine-off")).toHaveText(say(en["chat.mineOff"], { name: ann.name }));

    await backHome(bob.page);
    await bob.page.getByTestId("account-button").click();
    await bob.page.getByTestId("menu-settings").click();
    const messages = bob.page.getByTestId("friends-messages");
    await expect(messages).toHaveAttribute("aria-checked", "false");
    await expect(messages).toContainText(en["chat.settingsSwitch"]);
    await messages.click();
    await expect(messages).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => kept(bob.page)).toMatchObject({ friendsMessages: true });
    await ann.page.unroute(/\/friends\/[^/]+\/chat(\?|$)/);
    await expect(ann.page.getByTestId("chat-compose")).toBeVisible(SOON);
    await write(ann.page, "Are you free tonight?");
    await expect(lines(ann.page)).toHaveCount(1);
  });

  test("a report shows exactly the last messages it would send, sends nothing before the button, and then the team has them with the names and nothing else; the friend is not told", async ({ browser }) => {
    test.setTimeout(180_000);
    const { ann, bob } = await twoFriends(browser);
    for (let at = 1; at <= 22; at++) await writes(at % 2 === 1 ? ann.page : bob.page, at % 2 === 1 ? bob.page : ann.page, `m${String(at).padStart(2, "0")} ${at % 2 === 1 ? "from Ann" : "from Bob"}`);

    await openChat(bob.page);
    await expect(lines(bob.page)).toHaveCount(22);
    await fromMenu(bob.page, "chat-report");
    const sheet = bob.page.getByTestId("chat-report-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(say(en["chat.reportLead"], { name: ann.name }));
    const shown = sheet.getByTestId("chat-report-lines").getByTestId("chat-line");
    await expect(shown).toHaveCount(CHAT_REPORT_LINES);
    await expect(shown.first()).toContainText("m03");
    await expect(shown.last()).toContainText("m22");
    expect(await reportsAbout(bob.page, bob.name)).toHaveLength(0);

    await bob.page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    expect(await reportsAbout(bob.page, bob.name)).toHaveLength(0);

    await fromMenu(bob.page, "chat-report");
    await expect(shown).toHaveCount(CHAT_REPORT_LINES);
    await bob.page.getByTestId("chat-report-send").click();
    await expect(bob.page.getByTestId("chat-report-sent")).toHaveText(en["chat.reportSent"]);
    await bob.page.getByTestId("chat-report-done").click();
    await expect(sheet).toHaveCount(0);

    const reports = await reportsAbout(bob.page, bob.name);
    expect(reports).toHaveLength(1);
    const report = reports[0]!;
    expect(report).toMatchObject({ kind: "bug", area: "friends", answerable: false });
    const attachment = report.attachments.find((each) => each.name === "chat.txt");
    expect(attachment, "the messages are in a file of their own").toBeTruthy();
    const transcript = (await (await bob.page.request.get(`/api/admin/feedback/${report.id}/files/${attachment!.id}`, { headers: AUTH })).text());
    expect(transcript).toContain(`Reported by: ${bob.name}`);
    expect(transcript).toContain(`About: ${ann.name}`);
    expect(transcript).toContain("m22 from Bob");
    expect(transcript).toContain("m03 from Ann");
    expect(transcript).not.toContain("m02 from Bob");
    expect(transcript).not.toContain("m01 from Ann");

    await openChat(ann.page);
    await expect(lines(ann.page)).toHaveCount(22);
    await expect(ann.page.getByTestId("chat-muted")).toHaveCount(0);
    await expect(ann.page.getByTestId("chat-problem")).toHaveCount(0);
  });

  test("a chat whose friend is no friend any more says so and has no box; the friends page forgets the number", async ({ browser }) => {
    test.setTimeout(150_000);
    const { ann, bob } = await twoFriends(browser);
    await openChat(bob.page);
    await write(bob.page, "Still there?");
    await expect(lines(bob.page)).toHaveCount(1);

    await openFriendPage(ann.page);
    await ann.page.getByTestId("friend-remove").click();
    await ann.page.getByTestId("friend-unfriend-yes").click();
    await expect(ann.page.getByTestId("friend-row")).toHaveCount(0);

    await expect(bob.page.getByTestId("chat-ended")).toBeVisible(SOON);
    await expect(bob.page.getByTestId("chat-compose")).toHaveCount(0);
    await bob.page.keyboard.press("Escape");
    await expect(bob.page.getByTestId("friends-none")).toBeVisible(SOON);
  });

  test("every part of the chat is on the screen of the narrowest phone in Romanian: the Chat button with its number, the line of the friends page, the bell's row, the chat with a message as long as can be, the report, the setting", async ({ browser }) => {
    test.setTimeout(240_000);
    const { ann, bob } = await twoFriends(browser, "ro-RO");
    await away(bob.page, 10 * 86_400_000);
    const lastOnline = ro["friends.lastOnlineDay"].replace("{day}", "").trim();
    const widths = [320, 360, 390];
    const fit = async (ids: string[], what: string) => {
      for (const width of widths) {
        await bob.page.setViewportSize({ width, height: 700 });
        await expect.poll(() => outsideTheSides(bob.page, ids), { message: `${what}, ${width} wide` }).toEqual([]);
      }
    };

    await openChat(bob.page);
    await expect(bob.page.getByTestId("chat-privacy")).toBeVisible();
    await expect(bob.page.getByTestId("chat-presence")).toHaveText(new RegExp(`^${ro["chat.lastOnlineAt"].replace("{day}", ".+").replace("{time}", "\\d\\d[:.]\\d\\d")}$`));
    await fit(["chat-sheet", "chat", "chat-presence", "chat-more", "chat-empty", "chat-privacy", "chat-compose", "chat-input", "chat-send"], "the empty chat");
    await bob.page.getByTestId("chat-more").click();
    await fit(["chat-menu", "chat-search-open", "chat-media-open", "chat-mute", "chat-report"], "the ⋮'s menu");
    for (const width of widths) {
      await bob.page.setViewportSize({ width, height: 700 });
      await expect.poll(async () => apart(await where(bob.page.getByTestId("chat-mute")), await where(bob.page.getByTestId("chat-report"))), { message: `Mute and Report, ${width} wide` }).toBe(true);
      await expect.poll(async () => apart(await where(bob.page.getByTestId("chat-search-open")), await where(bob.page.getByTestId("chat-media-open"))), { message: `Search and GIFs and stickers, ${width} wide` }).toBe(true);
    }
    await bob.page.keyboard.press("Escape");
    await expect(bob.page.getByTestId("chat-menu")).toBeHidden();
    await expect(bob.page.getByTestId("chat")).toBeVisible();
    await fromMenu(bob.page, "chat-search-open");
    await fit(["chat-search", "chat-search-box", "chat-search-older", "chat-search-newer", "chat-search-close"], "the search");
    await bob.page.keyboard.press("Escape");
    await expect(bob.page.getByTestId("chat-search")).toHaveCount(0);
    await bob.page.keyboard.press("Escape");
    await backHome(bob.page);

    await writes(ann.page, bob.page, LONG);
    await look(bob.page);
    await expect(badge(bob.page)).toHaveText("1");
    await bell(bob.page).click();
    await expect(bob.page.getByTestId("bell-chat-item")).toHaveText(say(ro["chat.unread_one"], { count: "1", name: ann.name }));
    await fit(["bell-sheet", "bell-waiting", "bell-chat-item"], "the bell");
    await bob.page.getByTestId("bell-chat-item").getByTestId("bell-chat-open").click();
    await expect(lines(bob.page)).toHaveCount(1);
    await fit(["chat-sheet", "chat", "chat-more", "chat-compose", "chat-input", "chat-send"], "the chat");
    await expect(lines(bob.page).first().getByTestId("chat-text")).toHaveText(LONG);
    const overflow = await bob.page.getByTestId("chat-lines").evaluate((box) => [...box.querySelectorAll<HTMLElement>('[data-testid="chat-text"], .chat-bubble')].filter((part) => part.scrollWidth > part.clientWidth + 1).map((part) => part.className));
    expect(overflow, "text that runs out of its bubble").toEqual([]);

    await fromMenu(bob.page, "chat-report");
    await expect(bob.page.getByTestId("chat-report-lines")).toBeVisible();
    await fit(["chat-report-sheet", "chat-report-lines", "chat-report-send"], "the report");
    await bob.page.keyboard.press("Escape");
    await bob.page.keyboard.press("Escape");
    await backHome(bob.page);

    await writes(ann.page, bob.page, "Cu plăcere, și mulțumesc pentru ieri!");
    await look(bob.page);
    await openFriendPage(bob.page);
    await expect(bob.page.getByTestId("friend-chat-unread")).toHaveText(say(ro["chat.unreadShort_one"], { count: "1" }));
    await expect(bob.page.getByTestId("friend-now")).toContainText(lastOnline);
    await fit(["friend-page", "friend-now", "friend-status", "friend-chat", "friend-chat-unread"], "the page of a friend");
    await bob.page.keyboard.press("Escape");
    await expect(bob.page.getByTestId("friend-unread")).toHaveText(say(ro["chat.unreadShort_one"], { count: "1" }));
    await expect(bob.page.getByTestId("friend-row")).toContainText(lastOnline);
    await fit(["friends-list", "friend-row", "friend-unread"], "the friends");

    await bob.page.keyboard.press("Escape");
    await bob.page.getByTestId("menu-settings").click();
    await expect(bob.page.getByTestId("friends-messages-hint")).toBeVisible();
    await fit(["friends-give", "friends-messages-hint"], "the setting");
  });
});

interface Screen {
  page: Page;
  name: string;
}

const HD = { width: 1280, height: 720 };

async function screenWithFriends(browser: Browser, name: string, options: { viewport?: { width: number; height: number }; language?: Language; desk?: boolean } = {}): Promise<Screen> {
  const account = fresh(name);
  const words: Record<string, string> = options.language ? { "kino.lang": options.language } : {};
  const page = options.desk
    ? await openDevice(browser, { viewport: options.viewport ?? HD, storageState: seeded([{ name: "kino.fit", value: "desk" }], ["kino.fit"]) }, words)
    : await openLibrary(browser, undefined, options.viewport ?? HD, words);
  if (options.desk) {
    await page.goto("/tv");
    await expect(page.getByTestId("tv-browse")).toBeVisible();
  }
  await openTvSignIn(page);
  await page.getByTestId("tv-signin-email").click();
  await page.getByTestId("auth-switch").click();
  await expect(page.getByTestId("auth-form")).toHaveAttribute("data-mode", "signUp");
  await page.getByTestId("auth-email").fill(account.email);
  await page.getByTestId("auth-password").fill(account.password);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("tv-account-chip")).toHaveAttribute("aria-label", PICTURE_NAMED);
  await nameFirstProfile(page, nameOf(account));
  await expect(page.getByTestId("tv-account-chip")).toContainText(nameOf(account));
  await showProfilePage(page);
  await expect(page.locator('[data-entry="profile:friends"]')).toBeVisible();
  return { page, name: nameOf(account) };
}

const tile = (page: Page, title: string) => page.locator(`.tv-tile[title="${title}"]`);
const view = (page: Page) => page.getByTestId("tv-browse");

async function openFriendsView(page: Page) {
  await openProfilePlace(page, "friends");
  await expect(view(page)).toHaveAttribute("data-view", "friends");
}

async function meet(giver: Screen, taker: Screen, add: string = en["friends.add"]) {
  await openFriendsView(giver.page);
  await tile(giver.page, add).click();
  await giver.page.getByTestId("tv-friend-give").click();
  const code = (await giver.page.getByTestId("tv-friend-code").textContent())!.trim();
  await openFriendsView(taker.page);
  await tile(taker.page, add).click();
  await taker.page.getByTestId("tv-friend-type").click();
  await taker.page.getByTestId("tv-friend-code-input").fill(code);
  await expect(taker.page.getByTestId("tv-friend-code-name")).toHaveText(giver.name);
  await taker.page.getByTestId("tv-friend-code-add").click();
  await expect(tile(taker.page, giver.name)).toBeVisible();
  await look(giver.page);
  await expect(tile(giver.page, taker.name)).toBeVisible();
  await expect(giver.page.getByTestId("tv-friend-give-page")).toHaveCount(0);
}

async function meetPhone(screen: Screen, phone: Phone) {
  await openFriendsView(screen.page);
  await tile(screen.page, en["friends.add"]).click();
  await screen.page.getByTestId("tv-friend-give").click();
  const code = (await screen.page.getByTestId("tv-friend-code").textContent())!.trim();
  await openFriendsPage(phone.page);
  await phone.page.getByTestId("friend-code-input").fill(code);
  await phone.page.getByTestId("friend-code-add").click();
  await expect(phone.page.getByTestId("friend-row")).toHaveCount(1);
  await phone.page.keyboard.press("Escape");
  await home(phone.page);
  await look(screen.page);
  await expect(tile(screen.page, phone.name)).toBeVisible();
  await expect(screen.page.getByTestId("tv-friend-give-page")).toHaveCount(0);
}

async function tellsWhatItWatches(giver: Screen, taker: Screen, words: (typeof WORDS)[Language] = en) {
  await tile(giver.page, words["friends.settingsTile"]).click();
  await giver.page.getByTestId("tv-friends-give").click();
  await giver.page.getByTestId("tv-friend-settings-done").click();
  await tile(taker.page, words["friends.settingsTile"]).click();
  await taker.page.getByTestId("tv-friends-give").click();
  await taker.page.getByTestId("tv-friend-settings-done").click();
  const profile = await profileOf(taker.page);
  await expect
    .poll(async () => {
      const state = (await (await taker.page.request.get(`/api/profiles/${profile}/friends`)).json()) as { friends: Array<{ activity?: boolean }> };
      return state.friends.some((friend) => friend.activity);
    })
    .toBe(true);
  await look(taker.page);
}

const outsideTheScreen = (page: Page, root: string, whole = true) =>
  page.evaluate(
    ([id, wholePage]) => {
      const lost: string[] = [];
      const base = document.querySelector(`[data-testid="${id}"]`);
      if (!base) return [`(nothing is shown as ${id})`];
      const scroller = (element: Element) => {
        for (let up = element.parentElement; up && up !== base.parentElement; up = up.parentElement) {
          const { overflowY } = getComputedStyle(up);
          if ((overflowY === "auto" || overflowY === "scroll") && up.scrollHeight > up.clientHeight + 1) return up;
        }
        return null;
      };
      for (const element of base.querySelectorAll("button, input, h1, h2, p, svg")) {
        const box = element.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        const upDown = scroller(element)?.getBoundingClientRect() ?? box;
        const outside = box.left < -0.5 || box.right > innerWidth + 0.5 || (wholePage && (upDown.top < -0.5 || upDown.bottom > innerHeight + 0.5));
        if (outside) lost.push(element.getAttribute("data-testid") ?? `${element.tagName.toLowerCase()} "${(element.textContent ?? "").trim().slice(0, 30)}"`);
      }
      if (document.documentElement.scrollWidth > innerWidth) lost.push("(the page scrolls sideways)");
      return lost;
    },
    [root, whole] as const,
  );

const tvLines = (page: Page) => page.getByTestId("tv-chat-lines").getByTestId("chat-line");

async function tvReport(page: Page) {
  await page.getByTestId("tv-chat-more").click();
  await page.getByTestId("tv-chat-report").click();
}

async function tvWrite(page: Page, text: string) {
  await page.getByTestId("tv-chat-write").click();
  await page.getByTestId("tv-chat-input").fill(text);
  await page.getByTestId("tv-chat-send").click();
  await expect(page.getByTestId("tv-chat")).toBeVisible();
}

test.describe("the chat on the TV", () => {
  test("the bell's line of a friend who wrote has a cross: it marks the chat read, and the remote goes on to what is left", async ({ browser }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    await writes(ann.page, bob.page, "Film tonight?");
    await look(bob.page);
    await expect(bob.page.getByTestId("tv-bell-badge")).toHaveText("1");
    await bob.page.getByTestId("tv-bell").click();
    const line = bob.page.getByTestId("tv-bell-item").filter({ hasText: ann.name });
    await expect(line).toHaveCount(1);
    await bob.page.getByTestId("tv-bell-clear").first().focus();
    await bob.page.keyboard.press("Enter");
    await expect(line).toHaveCount(0);
    await expect(bob.page.getByTestId("tv-bell-friends")).toBeFocused();
    await bob.page.keyboard.press("Escape");
    await look(bob.page);
    await expect(bob.page.getByTestId("tv-bell-badge")).toHaveCount(0);
    await tile(bob.page, ann.name).click();
    await bob.page.getByTestId("friend-chat").click();
    await expect(tvLines(bob.page)).toHaveCount(1);
    await expect(tvLines(bob.page).first().getByTestId("chat-text")).toHaveText("Film tonight?");
  });

  test("the remote walks to the Chat chip and into the chat; Write opens the page with the keys, Send puts the message in the chat, Back goes back a page at a time, and a message from the other screen comes to an open chat within seconds", async ({ browser }) => {
    test.setTimeout(240_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);

    await tile(ann.page, bob.name).click();
    await expect(ann.page.getByTestId("friend-chat")).toBeVisible();
    await ann.page.getByTestId("tv-friend-back").focus();
    for (let step = 0; step < 5; step++) await ann.page.keyboard.press("ArrowRight");
    await expect(ann.page.getByTestId("friend-chat")).toBeFocused();
    await ann.page.keyboard.press("Enter");

    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await expect(ann.page.getByTestId("tv-chat-empty")).toBeVisible();
    await expect(ann.page.getByTestId("tv-chat-privacy")).toContainText("without encryption");
    await expect(ann.page.getByTestId("tv-chat-write")).toBeFocused();
    await ann.page.keyboard.press("Enter");

    await expect(ann.page.getByTestId("tv-chat-compose")).toBeVisible();
    const field = ann.page.getByTestId("tv-chat-input");
    await field.fill("Hello Bob");
    await ann.page.getByTestId("name-key-!").click();
    await expect(field).toHaveValue("Hello Bob!");
    await ann.page.getByTestId("tv-chat-cancel").click();
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await ann.page.getByTestId("tv-chat-write").click();
    await expect(field).toHaveValue("Hello Bob!");
    await ann.page.getByTestId("tv-chat-send").click();

    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await expect(tvLines(ann.page)).toHaveCount(1);
    await expect(tvLines(ann.page).first().getByTestId("chat-text")).toHaveText("Hello Bob!");
    await expect(tvLines(ann.page).first()).toHaveAttribute("data-mine", "true");
    await expect(ann.page.getByTestId("tv-chat-write")).toBeFocused();

    await look(bob.page);
    await expect(tile(bob.page, ann.name)).toContainText(say(en["chat.unreadShort_one"], { count: "1" }));
    await expect(bob.page.getByTestId("tv-bell-badge")).toHaveText("1");
    await tile(bob.page, ann.name).click();
    await expect(bob.page.getByTestId("friend-chat-unread")).toContainText("1");
    await bob.page.getByTestId("friend-chat").click();
    await expect(tvLines(bob.page)).toHaveCount(1);
    await expect(tvLines(bob.page).first().getByTestId("chat-text")).toHaveText("Hello Bob!");
    await expect(tvLines(bob.page).first()).toHaveAttribute("data-mine", "false");

    await tvWrite(bob.page, "Hi Ann");
    await expect(tvLines(ann.page)).toHaveCount(2, SOON);
    await expect(tvLines(ann.page).nth(1).getByTestId("chat-text")).toHaveText("Hi Ann");

    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("tv-chat")).toHaveCount(0);
    await expect(ann.page.getByTestId("friend-chat")).toBeFocused();
    await expect(ann.page.getByTestId("friend-chat-unread")).toHaveCount(0);
    await bob.page.keyboard.press("Escape");
    await expect(bob.page.getByTestId("tv-chat")).toHaveCount(0);
    await expect(bob.page.getByTestId("friend-chat")).toBeFocused();
    await expect(bob.page.getByTestId("friend-chat-unread")).toHaveCount(0);
  });

  test("a message from a phone waits quietly on a screen: a line on the friend's tile, a number on the bell and the chip, a line in the bell that opens the chat; reading it clears them", async ({ browser }) => {
    test.setTimeout(240_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await meetPhone(ann, bob);
    await openChat(bob.page);
    await write(bob.page, "Hello TV");
    await expect(lines(bob.page)).toHaveCount(1);
    await write(bob.page, "Anybody there?");
    await expect(lines(bob.page)).toHaveCount(2);

    await look(ann.page);
    await expect(tile(ann.page, bob.name)).toContainText(say(en["chat.unreadShort_other"], { count: "2" }));
    await expect(ann.page.getByTestId("tv-bell-badge")).toHaveText("1");
    await expect(ann.page.getByTestId("tv-chat")).toHaveCount(0);

    await ann.page.getByTestId("tv-bell").click();
    const line = ann.page.getByTestId("tv-bell-item");
    await expect(line).toHaveCount(1);
    await expect(line).toHaveAttribute("data-entry", `chat:${await profileOf(bob.page)}`);
    await expect(line).toContainText(say(en["chat.unread_other"], { count: "2", name: bob.name }));
    await line.click();
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await expect(tvLines(ann.page)).toHaveCount(2);
    await expect(ann.page.getByTestId("tv-chat-write")).toBeFocused();

    await tvWrite(ann.page, "Yes, hello!");
    await expect(lines(bob.page)).toHaveCount(3, SOON);
    await expect(texts(bob.page).nth(2)).toHaveText("Yes, hello!");

    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("tv-chat")).toHaveCount(0);
    await look(ann.page);
    await expect(ann.page.getByTestId("tv-bell-badge")).toHaveCount(0);
    await ann.page.getByTestId("rail-home").click();
    await openFriendsView(ann.page);
    await expect(tile(ann.page, bob.name)).toBeVisible();
    await expect(tile(ann.page, bob.name)).not.toContainText("new message");
  });

  test("friends can message a profile with no switch for it (what is shared says what a chat is kept as); a friend who turned it off before is not written to, the chat says so, and the switch is there to turn it on again", async ({ browser }) => {
    test.setTimeout(240_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);

    await tile(bob.page, en["friends.settingsTile"]).click();
    await expect(bob.page.getByTestId("tv-friends-messages")).toHaveCount(0);
    await expect(bob.page.getByTestId("tv-friends-messages-hint")).toContainText("without encryption");
    await bob.page.keyboard.press("Escape");

    await chose(bob.page, { friendsMessages: false });
    await expect.poll(() => kept(bob.page)).toMatchObject({ friendsMessages: false });

    await tile(ann.page, bob.name).click();
    await ann.page.getByTestId("friend-chat").click();
    await expect(ann.page.getByTestId("tv-chat-closed")).toHaveText(say(en["chat.closed"], { name: bob.name }));
    await expect(ann.page.getByTestId("tv-chat-write")).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-chat-back")).toBeFocused();

    await openFriendsView(bob.page);
    await tile(bob.page, ann.name).click();
    await bob.page.getByTestId("friend-chat").click();
    await expect(bob.page.getByTestId("tv-chat-mine-off")).toHaveText(say(en["chat.mineOff"], { name: ann.name }));

    await bob.page.keyboard.press("Escape");
    await bob.page.keyboard.press("Escape");
    await tile(bob.page, en["friends.settingsTile"]).click();
    await expect(bob.page.getByTestId("tv-friends-messages")).toHaveAttribute("aria-checked", "false");
    await bob.page.getByTestId("tv-friends-messages").click();
    await expect(bob.page.getByTestId("tv-friends-messages")).toHaveAttribute("aria-checked", "true");
    await expect(ann.page.getByTestId("tv-chat-write")).toBeVisible(SOON);
    await expect(ann.page.getByTestId("tv-chat-closed")).toHaveCount(0);
  });

  test("on a computer the chat has a box to type in: Enter sends and the box is ready for the next; taking back, muting and reporting are behind the ⋯, which Back shuts", async ({ browser }) => {
    test.setTimeout(240_000);
    const ann = await screenWithFriends(browser, "Ann", { desk: true });
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    expect(await ann.page.evaluate(() => document.documentElement.dataset.fit)).toBe("desk");
    await tile(ann.page, bob.name).click();
    await ann.page.getByTestId("friend-chat").click();
    await expect(ann.page.getByTestId("tv-chat-name")).toHaveText(bob.name);

    const box = ann.page.getByTestId("tv-chat-box");
    await expect(box).toBeFocused();
    await expect(ann.page.getByTestId("tv-chat-write")).toHaveCount(0);
    await ann.page.keyboard.type("Hello from the laptop");
    await ann.page.keyboard.press("Enter");
    await expect(tvLines(ann.page)).toHaveCount(1);
    await expect(tvLines(ann.page).first().getByTestId("chat-text")).toHaveText("Hello from the laptop");
    await expect(box).toHaveValue("");
    await expect(box).toBeFocused();
    await ann.page.keyboard.type("And a second");
    await ann.page.getByTestId("tv-chat-box-send").click();
    await expect(tvLines(ann.page)).toHaveCount(2);
    await expect(box).toBeFocused();

    await look(bob.page);
    await tile(bob.page, ann.name).click();
    await bob.page.getByTestId("friend-chat").click();
    await expect(tvLines(bob.page)).toHaveCount(2);

    await expect(ann.page.getByTestId("tv-chat-mute")).toBeHidden();
    await ann.page.getByTestId("tv-chat-more").click();
    await expect(ann.page.getByTestId("tv-chat-takeback")).toBeFocused();
    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("tv-chat-menu")).toBeHidden();
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await expect(ann.page.getByTestId("tv-chat-more")).toBeFocused();

    await ann.page.getByTestId("tv-chat-more").click();
    await ann.page.getByTestId("tv-chat-takeback").click();
    await expect(tvLines(ann.page)).toHaveCount(1);
    await expect(ann.page.getByTestId("tv-chat-menu")).toBeHidden();
    await expect(tvLines(bob.page)).toHaveCount(1, SOON);

    await ann.page.getByTestId("tv-chat-more").click();
    await ann.page.getByTestId("tv-chat-mute").click();
    await expect(ann.page.getByTestId("tv-chat-status")).toContainText(en["chat.mutedShort"]);
    await expect(ann.page.getByTestId("tv-chat-muted")).toBeVisible();
  });

  test("a chat can be reported from the screen: the page shows what would be sent, the remote lands on Cancel and not on Send, and nothing is sent before Send", async ({ browser }) => {
    test.setTimeout(240_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    await writes(bob.page, ann.page, "First from Bob");
    await writes(ann.page, bob.page, "Then from Ann");

    await tile(ann.page, bob.name).click();
    await ann.page.getByTestId("friend-chat").click();
    await expect(tvLines(ann.page)).toHaveCount(2);
    await tvReport(ann.page);
    await expect(ann.page.getByTestId("tv-chat-reporting")).toBeVisible();
    await expect(ann.page.getByTestId("tv-chat-report-lines").getByTestId("chat-line")).toHaveCount(2);
    await expect(ann.page.getByTestId("tv-chat-report-cancel")).toBeFocused();
    await expect(ann.page.getByTestId("tv-chat-report-send")).toBeEnabled();
    expect(await reportsAbout(ann.page, ann.name)).toHaveLength(0);
    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("tv-chat-reporting")).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    expect(await reportsAbout(ann.page, ann.name)).toHaveLength(0);

    await tvReport(ann.page);
    await ann.page.getByTestId("tv-chat-report-send").click();
    await expect(ann.page.getByTestId("tv-chat-report-sent")).toHaveText(en["chat.reportSent"]);
    expect(await reportsAbout(ann.page, ann.name)).toHaveLength(1);
    await ann.page.getByTestId("tv-chat-report-cancel").click();
    await expect(ann.page.getByTestId("tv-chat-reporting")).toHaveCount(0);
  });

  for (const screen of [
    { name: "720p", width: 1280, height: 720, language: "en" as Language },
    { name: "720p in Romanian", width: 1280, height: 720, language: "ro" as Language },
    { name: "720p in Italian", width: 1280, height: 720, language: "it" as Language },
    { name: "a small window in Italian", width: 800, height: 600, language: "it" as Language },
    { name: "a phone's width in Romanian", width: 390, height: 844, language: "ro" as Language },
    { name: "the narrowest phone in Romanian", width: 320, height: 640, language: "ro" as Language },
  ]) {
    test(`the friend's page with its Chat chip, the chat, the page that writes, the report and the switch are on the screen: ${screen.name}`, async ({ browser }) => {
      test.setTimeout(300_000);
      const viewport = { width: screen.width, height: screen.height };
      const words = WORDS[screen.language];
      const ann = await screenWithFriends(browser, "Ann", { viewport, language: screen.language });
      const bob = await screenWithFriends(browser, "Bob", { viewport, language: screen.language });
      await meet(ann, bob, words["friends.add"]);
      const page = ann.page;
      const wide = screen.width >= 900;
      const fits = async (root: string, what: string) => expect(await outsideTheScreen(page, root, wide), what).toEqual([]);
      await away(page, 10 * 86_400_000);
      await writes(ann.page, bob.page, LONG);
      for (let at = 0; at < 3; at++) await writes(bob.page, ann.page, at === 0 ? LONG : `${words["chat.compose"]} ${at}`);

      await look(page);
      const upright = screen.width < 600;
      if (upright) {
        await expect(tile(page, words["friends.add"])).toBeVisible();
        const offTheSide = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('.tv-browse[data-view="friends"] .tv-tile')]
            .filter((one) => one.getBoundingClientRect().left < -0.5 || one.getBoundingClientRect().right > innerWidth + 0.5)
            .map((one) => one.title),
        );
        expect(offTheSide, "the friends' page, off the screen sideways").toEqual([]);
      }
      await tile(page, bob.name).click();
      if (upright) {
        await expect(page.getByTestId("friend-chat")).toBeVisible();
        for (const id of ["tv-friend-back", "friend-tab-lists", "friend-tab-ratings", "friend-together", "friend-plan", "friend-chat"]) {
          const at = (await page.getByTestId(id).boundingBox())!;
          expect(at.x >= -0.5 && at.x + at.width <= screen.width + 0.5, `${id} in view without sliding`).toBe(true);
        }
      }
      await expect(page.getByTestId("friend-chat-unread")).toContainText("3");
      const lastOnline = words["friends.lastOnlineDay"].replace("{day}", "").trim();
      const meta = page.locator(".tv-friend-head .tv-view-meta");
      await expect(meta).toContainText(lastOnline);
      const head = await meta.evaluate((line) => ({ left: line.getBoundingClientRect().left, right: line.getBoundingClientRect().right, cut: line.scrollWidth > line.clientWidth + 1 }));
      expect(head.left, "when he was last online, from the left").toBeGreaterThanOrEqual(-0.5);
      expect(head.right, "when he was last online, to the right").toBeLessThanOrEqual(screen.width + 0.5);
      expect(head.cut, "when he was last online, cut").toBe(false);
      const chips = ["tv-friend-back", "friend-tab-lists", "friend-tab-ratings", "friend-together", "friend-plan", "friend-chat", "friend-remove"];
      for (const id of chips) {
        await page.getByTestId(id).focus();
        await expect
          .poll(async () => {
            const at = (await page.getByTestId(id).boundingBox())!;
            return at.x >= -0.5 && at.x + at.width <= screen.width + 0.5 && at.y + at.height <= screen.height + 0.5;
          }, { message: `${id} inside the screen` })
          .toBe(true);
      }
      await page.getByTestId("tv-friend-back").focus();
      for (let step = 0; step < 5; step++) await page.keyboard.press("ArrowRight");
      await expect(page.getByTestId("friend-chat")).toBeFocused();
      await page.keyboard.press("Enter");

      await expect(page.getByTestId("tv-chat")).toBeVisible();
      await expect(tvLines(page)).toHaveCount(4);
      await expect(page.getByTestId("tv-chat-status")).toHaveText(new RegExp(`^${words["chat.lastOnlineAt"].replace("{day}", ".+").replace("{time}", "\\d\\d[:.]\\d\\d")}$`));
      await fits("tv-chat", "the chat");
      await page.getByTestId("tv-chat-more").click();
      await expect(page.getByTestId("tv-chat-report")).toBeVisible();
      await fits("tv-chat", "the chat with the ⋯ open");
      const menu = await page.getByTestId("tv-chat-menu").evaluate((box) => ({
        width: box.getBoundingClientRect().width,
        tall: [...box.querySelectorAll("button")].filter((button) => button.getBoundingClientRect().height > parseFloat(getComputedStyle(button).fontSize) * 5.5).map((button) => button.textContent),
      }));
      expect(menu.width, "the ⋯ is as wide as what it says").toBeGreaterThan(Math.min(200, screen.width - 40));
      expect(menu.tall, "a line of the ⋯ that takes more than three lines").toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("tv-chat-menu")).toBeHidden();
      await expect(page.getByTestId("tv-chat")).toBeVisible();
      const cut = await page.getByTestId("tv-chat-lines").evaluate((box) => [...box.querySelectorAll<HTMLElement>(".chat-text, .chat-bubble")].filter((part) => part.scrollWidth > part.clientWidth + 1).map((part) => part.className));
      expect(cut, "text that runs out of its bubble").toEqual([]);

      if (wide) {
        await page.getByTestId("tv-chat-write").click();
        await expect(page.getByTestId("tv-chat-compose")).toBeVisible();
        await page.getByTestId("tv-chat-input").fill(LONG);
        await fits("tv-chat-compose", "the page that writes");
        await page.keyboard.press("Escape");
      } else {
        await expect(page.getByTestId("tv-chat-write")).toHaveCount(0);
        await page.getByTestId("tv-chat-box").fill(LONG);
        await fits("tv-chat", "the chat with a message as long as can be in its box");
        await page.getByTestId("tv-chat-box").fill("");
      }

      await tvReport(page);
      await expect(page.getByTestId("tv-chat-report-lines")).toBeVisible();
      await fits("tv-chat-reporting", "the report");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("friend-chat")).toBeFocused();

      await page.getByTestId("tv-friend-back").click();
      await expect(view(page)).toHaveAttribute("data-view", "friends");
      await tile(page, words["friends.settingsTile"]).click();
      await expect(page.getByTestId("tv-friends-give")).toBeVisible();
      await expect(page.getByTestId("tv-friends-messages-hint")).toBeVisible();
      await fits("tv-friend-settings", "the page of what is shared");
      for (const id of ["tv-friends-give", "tv-friends-messages-hint"]) {
        await page.getByTestId(id).scrollIntoViewIfNeeded();
        const at = (await page.getByTestId(id).boundingBox())!;
        expect(at.x, `${id} from the left`).toBeGreaterThanOrEqual(-0.5);
        expect(at.x + at.width, `${id} to the right`).toBeLessThanOrEqual(screen.width + 0.5);
      }
    });
  }
});

async function away(page: Page, gone = 5 * 60_000) {
  await page.route(/\/api\/profiles\/[^/]+\/friends$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    try {
      const answer = await route.fetch();
      const state = await answer.json();
      for (const friend of state.friends ?? []) {
        delete friend.online;
        friend.lastOnline = Date.now() - gone;
      }
      await route.fulfill({ response: answer, json: state });
    } catch {
    }
  });
}

const MATRIX = { id: "filmpire-movie-603", title: "The Matrix", year: 1999, kind: "movie", url: "/fixtures/sample.mp4?n=1" };
const SAVED = [
  { id: MATRIX.id, title: MATRIX.title, year: MATRIX.year, url: MATRIX.url },
  { id: "filmpire-tv-1399", title: "A Long Show", year: 2011, url: "/fixtures/sample.mp4?n=2" },
  { id: "pasted", title: "Something pasted", url: "https://example.com/film.mp4" },
];

async function knowsTitles(page: Page) {
  await page.route(/\/api\/library\/title\?/, (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    return route.fulfill({ json: { item: id === MATRIX.id ? MATRIX : null } });
  });
}

const SHOW = { id: "filmpire-tv-1399", title: "A Long Show", year: 2011, kind: "series", url: "https://films.example/watch/1399" };

async function knowsShow(page: Page) {
  await page.route(/\/api\/library\/title\?/, (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    return route.fulfill({ json: { item: id === MATRIX.id ? MATRIX : id === SHOW.id ? SHOW : null } });
  });
  await page.route(/\/api\/library\/seasons\?/, (route) => route.fulfill({ json: { seasons: [1, 2] } }));
  await page.route(/\/api\/library\/about\?/, (route) => route.fulfill({ json: { about: null } }));
  await page.route(/\/api\/library\/episodes\?/, (route) => {
    const season = Number(new URL(route.request().url()).searchParams.get("season"));
    const episodes = Array.from({ length: season === 2 ? 6 : 3 }, (_, at) => ({ season, episode: at + 1, title: `Chapter ${at + 1}`, runtime: 45, url: `/fixtures/sample.mp4?s=${season}&e=${at + 1}` }));
    return route.fulfill({ json: { episodes } });
  });
}

async function rates(page: Page, title: typeof SHOW, score: number) {
  const now = Date.now();
  const ratings = [{ key: ratingKey(title.url), at: now, title: title.title, url: title.url, kind: title.kind, score, ratedAt: now }];
  expect((await page.request.post(`/api/profiles/${await profileOf(page)}/sync`, { data: { since: 0, ratings } })).ok()).toBe(true);
}

async function saves(page: Page, titles: typeof SAVED) {
  const now = Date.now();
  const list = titles.map((title, at) => ({ key: `saved-${title.id}`, at: now - at * 1000, ...title }));
  expect((await page.request.post(`/api/profiles/${await profileOf(page)}/sync`, { data: { since: 0, list } })).ok()).toBe(true);
  await page.reload();
}

test.describe("a title sent in a chat", () => {
  test("on the phone: the panel's Titles lists what was saved (nothing without an address on the site), a press sends it and keeps what was being typed, and the friend's card opens the title's page", async ({ browser }) => {
    test.setTimeout(150_000);
    const { ann, bob } = await twoFriends(browser);
    for (const page of [ann.page, bob.page]) await knowsTitles(page);
    await saves(ann.page, SAVED);
    await expect.poll(() => atHome(ann.page)).toBe(true);
    await openChat(ann.page);
    await ann.page.getByTestId("chat-input").fill("half typed");
    await expect(ann.page.getByTestId("chat-tools")).toHaveCount(0);
    const panel = await openPanel(ann.page, "titles");
    await expect(ann.page.getByTestId("chat-input"), "the keyboard went down: the panel is in its place").not.toBeFocused();
    const picks = panel.getByTestId("chat-pick");
    await expect(picks).toHaveCount(2);
    await expect(picks.first()).toContainText("The Matrix");
    await expect(picks.nth(1)).toContainText("A Long Show");
    await picks.first().click();
    await expect(panel, "sent: the panel goes with it").toHaveCount(0);
    await expect(lines(ann.page)).toHaveCount(1);
    await expect(ann.page.getByTestId("chat-card")).toContainText("The Matrix");
    await expect(texts(ann.page)).toHaveText(["The Matrix (1999)"]);
    await expect(ann.page.getByTestId("chat-input")).toHaveText("half typed");

    await openChat(bob.page);
    const card = bob.page.getByTestId("chat-card");
    await expect(card).toContainText("The Matrix");
    await card.click();
    await expect(bob.page.getByTestId("chat")).toHaveCount(0);
    await expect(bob.page.getByTestId("title-sheet")).toBeVisible();
    await expect(bob.page.getByTestId("title-name")).toHaveText("The Matrix");
  });

  test("on the phone a title's card is drawn aside to answer it and held to react, as its message is, and neither opens the title (the owner, 17 Nov)", async ({ browser }) => {
    test.setTimeout(150_000);
    const { ann, bob } = await twoFriends(browser);
    for (const page of [ann.page, bob.page]) await knowsTitles(page);
    await saves(ann.page, SAVED);
    await expect.poll(() => atHome(ann.page)).toBe(true);
    await openChat(ann.page);
    await (await openPanel(ann.page, "titles")).getByTestId("chat-pick").first().click();
    await openChat(bob.page);
    const card = bob.page.getByTestId("chat-card");
    await expect(card).toContainText("The Matrix", SOON);
    const strip = bob.page.getByTestId("chat-reply-strip");
    const cdp = await bob.page.context().newCDPSession(bob.page);
    const touch = async (dx: number, rest = 0) => {
      const spot = await where(card);
      const from = { x: Math.round(spot.x + 30), y: Math.round(spot.y + spot.height / 2) };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
      if (rest) await bob.page.waitForTimeout(rest);
      for (const part of dx ? [0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 1] : []) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: Math.round(from.x + dx * part), y: from.y }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    await touch(100);
    await expect(strip).toBeVisible();
    await expect(strip).toContainText("The Matrix");
    await bob.page.waitForTimeout(300);
    await expect(bob.page.getByTestId("title-sheet")).toHaveCount(0);
    await bob.page.getByTestId("chat-reply-cancel").click();
    await touch(0, 900);
    await expect(bob.page.getByTestId("chat-react-bar")).toBeVisible();
    await bob.page.waitForTimeout(300);
    await expect(bob.page.getByTestId("title-sheet")).toHaveCount(0);
  });

  test("on the TV: the remote goes from the box to the panel's button, along its tabs to the posters, OK sends one; the friend's remote steps from the box onto the list and the card, and OK opens the title's page", async ({ browser }) => {
    test.setTimeout(240_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    for (const screen of [ann, bob]) await knowsTitles(screen.page);
    await meet(ann, bob);
    await writes(ann.page, bob.page, "Look at this one");
    await saves(ann.page, SAVED);
    await expect(view(ann.page)).toBeVisible();
    await openFriendsView(ann.page);
    await tile(ann.page, bob.name).click();
    await ann.page.getByTestId("friend-chat").click();
    await expect(ann.page.getByTestId("tv-chat-write")).toBeFocused();
    await ann.page.keyboard.press("ArrowLeft");
    await expect(ann.page.getByTestId("tv-chat-panel-btn")).toBeFocused();
    await ann.page.keyboard.press("Enter");
    const panel = ann.page.getByTestId("tv-chat-panel");
    await expect(panel).toHaveAttribute("data-tab", "stickers");
    await expect(panel.getByTestId("chat-sticker-pick").first()).toBeFocused();
    const tabs = panel.getByTestId("tv-chat-panel-tab");
    await expect(tabs).toHaveCount(2);
    for (let press = 0; press < 12 && !(await tabs.evaluateAll((all) => all.some((one) => one === document.activeElement))); press++) await ann.page.keyboard.press("ArrowDown");
    if (await panel.locator("[data-tab='stickers'][role='tab']").evaluate((tab) => tab === document.activeElement)) await ann.page.keyboard.press("ArrowLeft");
    await expect(panel.locator("[data-tab='titles'][role='tab']")).toBeFocused();
    await ann.page.keyboard.press("Enter");
    await expect(panel).toHaveAttribute("data-tab", "titles");
    await expect(panel.locator("[data-tab='titles'][role='tab']")).toBeFocused();
    const picks = ann.page.getByTestId("tv-chat-pick");
    await expect(picks).toHaveCount(2);
    await ann.page.keyboard.press("ArrowUp");
    const inTitles = () => panel.locator("[data-testid='tv-chat-pick'], [data-testid='tv-chat-pick-more']").evaluateAll((all) => all.some((one) => one === document.activeElement));
    await expect.poll(inTitles).toBe(true);
    for (let press = 0; press < 4 && !(await picks.first().evaluate((pick) => pick === document.activeElement)); press++) await ann.page.keyboard.press("ArrowLeft");
    await expect(picks.first()).toBeFocused();
    await ann.page.keyboard.press("ArrowRight");
    await expect(panel.getByTestId("tv-chat-pick-more").first()).toBeFocused();
    await ann.page.keyboard.press("ArrowRight");
    await expect(picks.nth(1)).toBeFocused();
    await ann.page.keyboard.press("ArrowLeft");
    await ann.page.keyboard.press("ArrowLeft");
    await expect(picks.first()).toBeFocused();
    await ann.page.keyboard.press("Enter");
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await expect(panel, "sent: the panel goes with it").toHaveCount(0);
    await expect(ann.page.getByTestId("tv-chat-write"), "and the remote is back on Write").toBeFocused();
    await expect(tvLines(ann.page)).toHaveCount(2);
    await expect(ann.page.getByTestId("tv-chat-lines").getByTestId("chat-card")).toContainText("The Matrix");
    await ann.page.keyboard.press("ArrowLeft");
    await ann.page.keyboard.press("Enter");
    await expect(panel).toHaveAttribute("data-tab", "titles");
    await expect(picks.first()).toBeFocused();
    await ann.page.keyboard.press("ArrowRight");
    const more = panel.locator("[data-testid='tv-chat-pick-more'][data-address='movie-603']");
    await expect(more).toBeFocused();
    await ann.page.keyboard.press("Enter");
    const step = panel.getByTestId("tv-chat-extras");
    await expect(step.locator("[data-testid='tv-chat-extras-time'][data-minutes='1']")).toBeFocused();
    await expect(step.getByTestId("tv-chat-extras-from")).toContainText("From the beginning");
    await ann.page.keyboard.press("Enter");
    await expect(step.getByTestId("tv-chat-extras-from")).toContainText("From 1:00");
    await ann.page.keyboard.press("Escape");
    await expect(step).toHaveCount(0);
    await expect(panel).toBeVisible();
    await expect(more).toBeFocused();
    await ann.page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await expect(ann.page.getByTestId("tv-chat-panel-btn")).toBeFocused();
    await expect(tvLines(ann.page)).toHaveCount(2);

    await look(bob.page);
    await tile(bob.page, ann.name).click();
    await bob.page.getByTestId("friend-chat").click();
    const card = bob.page.getByTestId("tv-chat-lines").getByTestId("chat-card");
    await expect(card).toContainText("The Matrix");
    await expect(bob.page.getByTestId("tv-chat-write")).toBeFocused();
    await bob.page.keyboard.press("ArrowUp");
    await expect(bob.page.getByTestId("tv-chat-lines")).toBeFocused();
    await bob.page.keyboard.press("ArrowUp");
    await expect(card).toBeFocused();
    await bob.page.keyboard.press("ArrowLeft");
    await expect(bob.page.getByTestId("tv-chat-lines")).toBeFocused();
    await bob.page.keyboard.press("ArrowUp");
    await expect(card).toBeFocused();
    await bob.page.keyboard.press("Enter");
    await expect(bob.page.getByTestId("tv-chat")).toHaveCount(0);
    await expect(bob.page.getByTestId("tv-detail")).toContainText("The Matrix");

    await bob.page.keyboard.press("Escape");
    await expect(bob.page.getByTestId("tv-detail")).toHaveCount(0);
    await bob.page.getByTestId("friend-chat").click();
    await expect(card).toHaveCount(1);
    await bob.page.keyboard.press("ArrowUp");
    await bob.page.keyboard.press("ArrowUp");
    await expect(card).toBeFocused();
    await ann.page.getByTestId("tv-chat-more").click();
    await ann.page.getByTestId("tv-chat-takeback").click();
    await expect(card).toHaveCount(0, SOON);
    await expect(bob.page.getByTestId("tv-chat-lines")).toBeFocused();
  });

  test("on the phone: the button beside a title opens its send step - one episode, from a time, with the rating - and the friend's card says them and opens the title at that episode", async ({ browser }) => {
    test.setTimeout(180_000);
    const { ann, bob } = await twoFriends(browser);
    for (const page of [ann.page, bob.page]) await knowsShow(page);
    await rates(ann.page, SHOW, 8);
    await saves(ann.page, [{ id: SHOW.id, title: SHOW.title, year: SHOW.year, url: SHOW.url }, SAVED[0]!]);
    await expect.poll(() => atHome(ann.page)).toBe(true);
    await openChat(ann.page);
    const panel = await openPanel(ann.page, "titles");
    await expect(panel.getByTestId("chat-pick")).toHaveCount(2);
    await panel.locator("[data-testid='chat-pick-more'][data-address='movie-603']").click();
    const step = panel.getByTestId("chat-extras");
    await expect(step).toContainText("The Matrix (1999)");
    await expect(step.getByTestId("chat-extras-whole")).toHaveCount(0);
    await expect(step.getByTestId("chat-extras-from")).toContainText("From the beginning");
    await expect(step.getByTestId("chat-extras-rating"), "not rated: nothing to add").toHaveCount(0);
    await step.getByTestId("chat-extras-back").click();
    await expect(panel.getByTestId("chat-pick")).toHaveCount(2);
    await panel.locator("[data-testid='chat-pick-more'][data-address='tv-1399']").click();
    await expect(step).toContainText("A Long Show (2011)");
    await ann.page.keyboard.press("Escape");
    await expect(step).toHaveCount(0);
    await expect(panel, "Back shut the step first").toBeVisible();
    await panel.locator("[data-testid='chat-pick-more'][data-address='tv-1399']").click();
    await expect(step.getByTestId("chat-extras-whole")).toHaveAttribute("aria-checked", "true");
    await expect(step.getByTestId("chat-extras-from"), "a whole show has no time to start at").toHaveCount(0);
    await expect(step.getByTestId("chat-extras-rating")).toHaveAttribute("aria-pressed", "false");
    await step.getByTestId("chat-extras-one").click();
    await expect(step.getByTestId("chat-extras-season")).toContainText("Season 1");
    await expect(step.getByTestId("chat-extras-episode")).toContainText("Episode 1");
    await expect(step.getByTestId("chat-extras-season-back")).toHaveAttribute("aria-disabled", "true");
    await step.getByTestId("chat-extras-season-on").click();
    await expect(step.getByTestId("chat-extras-season")).toContainText("Season 2");
    await expect(step.getByTestId("chat-extras-season-on"), "the show has two").toHaveAttribute("aria-disabled", "true");
    for (let press = 0; press < 4; press++) await step.getByTestId("chat-extras-episode-on").click();
    await expect(step.getByTestId("chat-extras-episode")).toContainText("Episode 5");
    await step.locator("[data-testid='chat-extras-time'][data-minutes='10']").click();
    await expect(step.getByTestId("chat-extras-from")).toContainText("From 10:00");
    await step.getByTestId("chat-extras-typed").fill("12:34");
    await expect(step.getByTestId("chat-extras-from")).toContainText("From 12:34");
    await step.getByTestId("chat-extras-rating").click();
    await expect(step.getByTestId("chat-extras-rating")).toHaveAttribute("aria-pressed", "true");
    await step.getByTestId("chat-extras-go").click();
    await expect(panel, "sent: the panel goes with it").toHaveCount(0);
    await expect(texts(ann.page)).toHaveText(["A Long Show (2011)"]);
    await expect(ann.page.getByTestId("chat-card-where")).toHaveText("2011 · S2:E5 · from 12:34");
    await expect(ann.page.getByTestId("chat-card-score")).toContainText("You gave it 8/10");

    await openChat(bob.page);
    const card = bob.page.getByTestId("chat-card");
    await expect(card.getByTestId("chat-card-where")).toHaveText("2011 · S2:E5 · from 12:34");
    await expect(card.getByTestId("chat-card-score")).toContainText(`${ann.name} gave it 8/10`);
    await card.click();
    await expect(bob.page.getByTestId("title-sheet")).toBeVisible();
    await expect(bob.page.getByTestId("title-season-2")).toHaveAttribute("aria-selected", "true");
    await expect(bob.page.locator("[data-testid='title-episode'][data-episode='5']")).toHaveAttribute("data-target", "true");
  });

  test("on the TV: a link and a card open the title at the episode and the time they name, Play says so and starts there; a film's card from its time", async ({ browser }) => {
    test.setTimeout(240_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await knowsShow(bob.page);
    await meet(ann, bob);
    const origin = new URL(bob.page.url()).origin;
    await writes(ann.page, bob.page, `The Matrix (1999) ${origin}/tv?title=movie-603&t=3600`);
    await writes(ann.page, bob.page, `A Long Show (2011) ${origin}/tv?title=tv-1399&s=2&e=5&t=754&r=8`);
    const played: string[] = [];
    bob.page.on("websocket", (socket) =>
      socket.on("framesent", (frame) => {
        if (typeof frame.payload === "string" && frame.payload.includes('"TV_PLAY_URL"')) played.push(frame.payload);
      }),
    );
    await bob.page.goto(`${origin}/tv?title=tv-1399&s=2&e=5&t=754&r=8`);
    await expect(bob.page.getByTestId("tv-detail")).toContainText("A Long Show");
    await expect(bob.page.getByTestId("tv-detail-play")).toHaveText("Play S2:E5 from 12:34");
    await expect(bob.page.getByTestId("tv-detail-play")).not.toHaveAttribute("aria-disabled", "true");
    await expect(bob.page.getByTestId("tv-season-2")).toHaveAttribute("aria-checked", "true");
    await expect(bob.page.locator("[data-testid='tv-episode'][data-episode='5']")).toHaveAttribute("data-target", "true");
    await bob.page.getByTestId("tv-detail-close").click();
    await expect(bob.page.getByTestId("tv-detail")).toHaveCount(0);

    await openFriendsView(bob.page);
    await look(bob.page);
    await tile(bob.page, ann.name).click();
    await bob.page.getByTestId("friend-chat").click();
    const cards = bob.page.getByTestId("tv-chat-lines").getByTestId("chat-card");
    await expect(cards).toHaveCount(2);
    await expect(cards.first().getByTestId("chat-card-where")).toHaveText("1999 · from 1:00:00");
    await expect(cards.nth(1).getByTestId("chat-card-where")).toHaveText("2011 · S2:E5 · from 12:34");
    await expect(cards.nth(1).getByTestId("chat-card-score")).toContainText(`${ann.name} gave it 8/10`);
    await cards.first().click();
    await expect(bob.page.getByTestId("tv-detail")).toContainText("The Matrix");
    await expect(bob.page.getByTestId("tv-detail-play")).toHaveText("Play from 1:00:00");
    await bob.page.getByTestId("tv-detail-close").click();

    await bob.page.getByTestId("friend-chat").click();
    await cards.nth(1).click();
    await expect(bob.page.getByTestId("tv-detail")).toContainText("A Long Show");
    await expect(bob.page.getByTestId("tv-detail-play")).toHaveText("Play S2:E5 from 12:34");
    await expect(bob.page.locator("[data-testid='tv-episode'][data-episode='5']")).toHaveAttribute("data-target", "true");
    await bob.page.getByTestId("tv-detail-play").click();
    await expect.poll(() => played.length).toBe(1);
    const command = JSON.parse(played[0]!) as { url: string; startAt?: number };
    expect(command.startAt).toBe(754);
    expect(new URL(command.url).search).toBe("?s=2&e=5");
  });

  test("a title the server could say nothing about is the text it was sent as, and a card once it is asked about again a minute later, with the chat open all along", async ({ browser }) => {
    test.setTimeout(150_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const account = fresh("Bob");
    const page = await openDevice(browser, PHONE, {}, async (context) => context.clock.install());
    await page.goto("/");
    await signUp(page, account);
    const bob = { page, account, name: nameOf(account) };
    await befriend(ann.page, bob.page);
    let asks = 0;
    await bob.page.route(/\/api\/library\/title\?/, (route) => (++asks === 1 ? route.fulfill({ status: 502, body: "" }) : route.fulfill({ json: { item: MATRIX } })));
    const text = `The Matrix (1999) ${new URL(bob.page.url()).origin}/tv?title=movie-603`;
    await writes(ann.page, bob.page, text);
    await openChat(bob.page);
    await expect(texts(bob.page)).toHaveText([text]);
    await expect.poll(() => asks).toBe(1);
    await expect(bob.page.getByTestId("chat-card")).toHaveCount(0);
    await bob.page.clock.fastForward(61_000);
    await expect(bob.page.getByTestId("chat-card")).toContainText("The Matrix");
    expect(asks).toBe(2);
    await expect(texts(bob.page)).toHaveText(["The Matrix (1999)"]);
  });
});

test.describe("the chat on a hand-held screen that shows the TV's pages", () => {
  test("is typed in its own box at the bottom, as in any messenger: no page that writes, the keyboard does not come up by itself, Enter sends and the box stays ready for the next one", async ({ browser }) => {
    test.setTimeout(180_000);
    const viewport = { width: 390, height: 844 };
    const ann = await screenWithFriends(browser, "Ann", { viewport });
    const bob = await screenWithFriends(browser, "Bob", { viewport });
    await meet(ann, bob);
    const page = ann.page;
    await page.evaluate(() => {
      const view = Object.assign(new EventTarget(), { height: innerHeight, width: innerWidth, offsetTop: 0 });
      Object.defineProperty(window, "visualViewport", { configurable: true, value: view });
      (window as unknown as { keys: (height: number, top: number) => void }).keys = (height, top) => {
        Object.assign(view, { height, offsetTop: top });
        view.dispatchEvent(new Event("resize"));
      };
    });
    const keys = (height: number, top: number) => page.evaluate(([h, y]) => (window as unknown as { keys: (height: number, top: number) => void }).keys(h!, y!), [height, top]);
    await tile(page, bob.name).click();
    await page.getByTestId("friend-chat").click();
    await expect(page.getByTestId("tv-chat")).toBeVisible();
    const box = page.getByTestId("tv-chat-box");
    await expect(box).toBeVisible();
    await expect(page.getByTestId("tv-chat-write")).toHaveCount(0);
    await expect(box).not.toBeFocused();
    const at = await where(box);
    expect(at.y + at.height, "the box is at the bottom of the screen").toBeGreaterThan(viewport.height - 110);
    expect(await box.evaluate((element) => [element.tagName, (element as HTMLElement).isContentEditable, element.getAttribute("role")])).toEqual(["DIV", true, "textbox"]);
    await expect(page.getByTestId("tv-chat-box-form").locator("input, textarea")).toHaveCount(0);
    await box.fill("Hello from the phone");
    await box.press("Enter");
    await expect(tvLines(page)).toHaveCount(1);
    await expect(tvLines(page).first().getByTestId("chat-text")).toHaveText("Hello from the phone");
    await expect(box).toHaveText("");
    await expect(box).toBeFocused();
    await expect(page.getByTestId("tv-chat-compose")).toHaveCount(0);
    await box.pressSequentially("Second one");
    await page.getByTestId("tv-chat-box-send").click();
    await expect(tvLines(page)).toHaveCount(2);
    await expect(tvLines(page).last().getByTestId("chat-text")).toHaveText("Second one");
    await expect(box).toHaveText("");
    await expect(box).toBeFocused();
    await box.evaluate((element) => {
      const data = new DataTransfer();
      data.setData("text/plain", "line one\nline two");
      data.setData("text/html", "<b>line one</b><br><img src=x>");
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(box).toHaveText("line one line two");
    expect(await box.evaluate((element) => element.querySelectorAll("b, img, br").length)).toBe(0);
    await box.fill("x".repeat(600));
    await expect.poll(() => box.evaluate((element) => element.textContent?.length)).toBe(500);
    await box.fill("y".repeat(498));
    await box.pressSequentially("abcd");
    await expect.poll(() => box.evaluate((element) => element.textContent)).toBe(`${"y".repeat(498)}ab`);
    await box.fill("");
    await expect(box).toHaveText("");
    await expect(page.getByTestId("tv-chat-box-send")).toBeDisabled();
    expect(await outsideTheScreen(page, "tv-chat", false)).toEqual([]);

    await keys(480, 120);
    await expect.poll(async () => Math.round((await where(box)).y + (await where(box)).height)).toBeLessThanOrEqual(600);
    expect((await where(box)).y + (await where(box)).height, "the box is right over the keys").toBeGreaterThan(600 - 90);
    expect((await where(page.getByTestId("tv-chat-name"))).y, "the friend's name is in view").toBeGreaterThanOrEqual(119);
    const newest = await where(tvLines(page).last());
    expect(newest.y + newest.height, "the newest message is over the box").toBeLessThanOrEqual((await where(box)).y + 1);
    expect(newest.y, "the newest message is in view").toBeGreaterThanOrEqual(120);
    await keys(viewport.height, 0);
    await expect.poll(async () => Math.round((await where(box)).y + (await where(box)).height)).toBeGreaterThan(viewport.height - 110);

    await look(bob.page);
    await tile(bob.page, ann.name).click();
    await bob.page.getByTestId("friend-chat").click();
    await expect(tvLines(bob.page).first().getByTestId("chat-text")).toHaveText("Hello from the phone");
  });
});

const STICKER_COUNT = 28;
const stickerLoaded = (picture: ReturnType<Page["getByTestId"]>) => picture.evaluate((element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth);
const bubbleOf = (picture: ReturnType<Page["getByTestId"]>) => picture.evaluate((element) => getComputedStyle(element.closest(".chat-bubble")!).backgroundColor);

test.describe("stickers in a chat", () => {
  test("on the phone: the panel opens on the whole set, a press sends one and the friend sees the picture; Back sends nothing; an emoji of the set typed alone is a sticker too, one in words stays words", async ({ browser }) => {
    test.setTimeout(150_000);
    const { ann, bob } = await twoFriends(browser);
    await openChat(ann.page);
    const button = ann.page.getByTestId("chat-panel-btn");
    await button.click();
    const sheet = ann.page.getByTestId("chat-panel");
    await expect(sheet).toBeVisible();
    await expect(sheet, "the first time: the stickers").toHaveAttribute("data-tab", "stickers");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(button).toHaveAttribute("aria-label", en["chat.panel"]);
    const picks = ann.page.getByTestId("chat-sticker-pick");
    await expect(picks).toHaveCount(STICKER_COUNT);
    await expect(picks.first()).toHaveAttribute("data-sticker", "popcorn");
    expect(await gridFaults(picks), "the stickers: squares, none over another").toEqual([]);
    expect(await outsideTheScreen(ann.page, "chat-sheet", false)).toEqual([]);
    await ann.page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(ann.page.getByTestId("chat-sheet"), "one Back: the panel, not the chat").toBeVisible();
    await expect(lines(ann.page)).toHaveCount(0);
    await button.click();
    await expect(sheet).toBeVisible();
    await button.click();
    await expect(sheet).toHaveCount(0);
    await expect(ann.page.getByTestId("chat-input")).toBeFocused();
    await button.click();
    await expect(sheet).toBeVisible();
    await ann.page.getByTestId("chat-input").click();
    await expect(sheet).toHaveCount(0);

    await button.click();
    await ann.page.locator('[data-testid="chat-sticker-pick"][data-sticker="heart-eyes"]').click();
    await expect(sheet).toHaveCount(0);
    await expect(lines(ann.page)).toHaveCount(1);
    const mine = lines(ann.page).first().getByTestId("chat-sticker");
    await expect(mine).toHaveAttribute("src", "/stickers/heart-eyes.webp");
    await expect.poll(() => stickerLoaded(mine)).toBeGreaterThan(0);
    const bubble = lines(ann.page).first().getByTestId("chat-bubble");
    expect(await bubble.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    await expect(mine).toHaveAttribute("alt", "\u{1F60D}");

    await openChat(bob.page);
    const theirs = lines(bob.page).first().getByTestId("chat-sticker");
    await expect(theirs).toHaveAttribute("src", "/stickers/heart-eyes.webp");
    await expect.poll(() => stickerLoaded(theirs)).toBeGreaterThan(0);
    expect(await bubbleOf(theirs), "a friend's sticker has no bubble either").toBe("rgba(0, 0, 0, 0)");
    await write(bob.page, "\u{1F525}");
    await expect(lines(ann.page)).toHaveCount(2, SOON);
    await expect(lines(ann.page).nth(1).getByTestId("chat-sticker")).toHaveAttribute("src", "/stickers/fire.webp");
    await write(bob.page, "\u{1F525} that ending");
    await expect(lines(ann.page)).toHaveCount(3, SOON);
    await expect(lines(ann.page).nth(2).getByTestId("chat-sticker")).toHaveCount(0);
    await expect(lines(ann.page).nth(2).getByTestId("chat-text")).toHaveText("\u{1F525} that ending");
  });

  test("the grid waits while a message is on its way (a press then is not lost), and a picture that does not come is its emoji, big, in the grid and in the chat", async ({ browser }) => {
    test.setTimeout(150_000);
    const { ann, bob } = await twoFriends(browser);
    let hold: (() => void) | undefined;
    await ann.page.route(/\/friends\/[^/]+\/chat$/, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await new Promise<void>((done) => (hold = done));
      await route.continue();
    });
    await openChat(ann.page);
    await ann.page.getByTestId("chat-input").fill("Popcorn ready?");
    await ann.page.getByTestId("chat-send").click();
    await expect.poll(() => hold !== undefined).toBe(true);
    await openPanel(ann.page, "stickers");
    const picks = ann.page.getByTestId("chat-sticker-pick");
    await expect(picks.first()).toBeDisabled();
    hold!();
    await expect(lines(ann.page)).toHaveCount(1);
    await expect(picks.first(), "the panel opened while it went stays").toBeEnabled();
    await expect(ann.page.getByTestId("chat-input"), "and the box was not given the keyboard over it").not.toBeFocused();
    hold = undefined;
    await ann.page.unroute(/\/friends\/[^/]+\/chat$/);
    await picks.first().click();
    await expect(lines(ann.page)).toHaveCount(2);
    await expect(lines(ann.page).nth(1).getByTestId("chat-sticker")).toHaveAttribute("src", "/stickers/popcorn.webp");

    await bob.page.route(/\/stickers\/.+\.webp$/, (route) => route.abort());
    await openChat(bob.page);
    const emoji = lines(bob.page).nth(1).getByTestId("chat-sticker-emoji");
    await expect(emoji).toHaveText("\u{1F37F}");
    expect((await where(emoji)).height, "as big as the picture").toBeGreaterThan(100);
    await openPanel(bob.page, "stickers");
    await expect(bob.page.getByTestId("chat-sticker-pick").first().locator(".chat-sticker-emoji")).toHaveText("\u{1F37F}");
    await expect(bob.page.getByTestId("chat-sticker-pick").first().locator("img")).toHaveCount(0);
  });

  test("on a TV that is only a remote: the button beside the box opens the panel on the set, the remote walks it and OK sends one; the friend on the narrowest hand-held screen sees it and has the set under the bar, one list that scrolls", async ({ browser }) => {
    test.setTimeout(180_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob", { viewport: { width: 320, height: 640 } });
    await meet(ann, bob);
    await tile(ann.page, bob.name).click();
    await ann.page.getByTestId("friend-chat").click();
    await expect(ann.page.getByTestId("tv-chat-write")).toBeFocused();
    await ann.page.keyboard.press("ArrowLeft");
    await expect(ann.page.getByTestId("tv-chat-panel-btn")).toBeFocused();
    await ann.page.keyboard.press("Enter");
    const panel = ann.page.getByTestId("tv-chat-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-tab", "stickers");
    const picks = ann.page.getByTestId("chat-sticker-pick");
    await expect(picks).toHaveCount(STICKER_COUNT);
    await expect(picks.first()).toBeFocused();
    expect(await gridFaults(picks), "the stickers: squares, none over another").toEqual([]);
    expect(await outsideTheScreen(ann.page, "tv-chat")).toEqual([]);
    await expect(ann.page.getByTestId("tv-chat-empty"), "the chat stays in view over the panel").toBeInViewport();
    await ann.page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await expect(ann.page.getByTestId("tv-chat-empty")).toBeVisible();
    await expect(ann.page.getByTestId("tv-chat-panel-btn")).toBeFocused();
    await ann.page.keyboard.press("Enter");
    await expect(picks.first()).toBeFocused();
    await ann.page.keyboard.press("ArrowRight");
    await expect(picks.nth(1)).toBeFocused();
    await ann.page.keyboard.press("ArrowDown");
    await expect(picks.nth(8)).toBeFocused();
    await ann.page.keyboard.press("Enter");
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await expect(panel).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-chat-write")).toBeFocused();
    await expect(tvLines(ann.page)).toHaveCount(1);
    await ann.page.keyboard.press("ArrowLeft");
    await ann.page.keyboard.press("Enter");
    await expect(picks.first()).toBeFocused();
    for (let press = 0; press < 3; press++) await ann.page.keyboard.press("ArrowDown");
    await expect(picks.nth(21)).toBeFocused();
    await expect(picks.nth(21)).toBeInViewport();
    await ann.page.keyboard.press("ArrowDown");
    await expect(panel.locator("[role='tab']:focus"), "the tabs, at the panel's foot").toHaveCount(1);
    await ann.page.keyboard.press("ArrowUp");
    await expect(panel.locator("[data-testid='chat-sticker-pick']:focus"), "back up into the set").toHaveCount(1);
    await ann.page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(tvLines(ann.page)).toHaveCount(1);
    await expect(tvLines(ann.page).first().getByTestId("chat-sticker")).toHaveAttribute("src", "/stickers/heart-eyes.webp");
    await ann.page.getByTestId("tv-chat-write").click();
    await expect(ann.page.getByTestId("tv-chat-quote")).toContainText(say(en["chat.stickerSaid"], { emoji: "\u{1F60D}" }));
    await ann.page.keyboard.press("Escape");

    await look(bob.page);
    await tile(bob.page, ann.name).click();
    await bob.page.getByTestId("friend-chat").click();
    const theirs = tvLines(bob.page).first().getByTestId("chat-sticker");
    await expect(theirs).toHaveAttribute("src", "/stickers/heart-eyes.webp");
    await expect.poll(() => stickerLoaded(theirs)).toBeGreaterThan(0);
    expect(await bubbleOf(theirs), "a friend's sticker has no bubble").toBe("rgba(0, 0, 0, 0)");
    expect(await outsideTheScreen(bob.page, "tv-chat", false)).toEqual([]);
    expect((await where(bob.page.getByTestId("tv-chat-box"))).width, "the box has the bar, but for the one button beside it").toBeGreaterThan(170);
    const theirPanel = await openPanel(bob.page, "stickers", "tv-chat");
    await expect(bob.page.getByTestId("tv-chat-box"), "a hand-held screen lands on nothing: no keyboard comes over the panel").not.toBeFocused();
    const theirPicks = bob.page.getByTestId("chat-sticker-pick");
    await expect(theirPicks).toHaveCount(STICKER_COUNT);
    expect(await gridFaults(theirPicks), "on the narrowest screen: squares, none over another").toEqual([]);
    expect((await where(theirPicks.first())).width, "five or so to a row, each bigger than a finger").toBeGreaterThan(48);
    expect(await outsideTheScreen(bob.page, "tv-chat", false)).toEqual([]);
    await theirPicks.last().scrollIntoViewIfNeeded();
    await expect(theirPicks.last()).toBeInViewport();
    await expect(bob.page.getByTestId("tv-chat-back")).toBeInViewport();
    await expect(theirPanel.locator("[role='tab'][data-tab='stickers']")).toBeInViewport();
    await expect(tvLines(bob.page).first()).toBeInViewport();
    await theirPicks.last().click();
    await expect(theirPanel).toHaveCount(0);
    await expect(bob.page.getByTestId("tv-chat")).toBeVisible();
    await expect(tvLines(bob.page)).toHaveCount(2);
    await expect(tvLines(bob.page).last().getByTestId("chat-sticker")).toHaveAttribute("src", "/stickers/alarm.webp");
    await expect(tvLines(ann.page)).toHaveCount(2, SOON);
  });
});

const FIRE = "\u{1F525}";
const HEART = "\u{2764}\u{FE0F}";
const JOY = "\u{1F602}";
const reactionsOn = (line: ReturnType<Page["getByTestId"]>) => line.getByTestId("chat-reaction").evaluateAll((all) => all.map((chip) => `${chip.getAttribute("data-who")}:${chip.getAttribute("data-reaction")}`));
const reactWith = (page: Page, reaction: string) => page.locator(`[data-testid="chat-react"][data-reaction="${reaction}"]`);

test.describe("reactions in a chat", () => {
  test("on the phone: a friend's message is pressed and a reaction picked; both see it under the message, it can be changed and taken away, and each can put their own", async ({ browser }) => {
    test.setTimeout(150_000);
    const { ann, bob } = await twoFriends(browser);
    await openChat(ann.page);
    await openChat(bob.page);
    await write(bob.page, "Tonight at eight?");
    await expect(lines(ann.page)).toHaveCount(1, SOON);

    await lines(ann.page).first().getByTestId("chat-bubble").click();
    const bar = ann.page.getByTestId("chat-react-bar");
    await expect(bar).toBeVisible();
    await expect(bar.getByTestId("chat-react")).toHaveCount(6);
    await expect(bar.locator('[aria-pressed="true"]')).toHaveCount(0);
    await expect(ann.page.getByTestId("chat-takeback")).toHaveCount(0);
    await reactWith(ann.page, FIRE).click();
    await expect(bar).toHaveCount(0);
    await expect.poll(() => reactionsOn(lines(ann.page).first())).toEqual([`mine:${FIRE}`]);
    const chip = lines(ann.page).first().getByTestId("chat-reaction").locator("img");
    await expect(chip).toHaveAttribute("src", "/stickers/fire.webp");
    await expect.poll(() => stickerLoaded(chip)).toBeGreaterThan(0);
    const bubble = await where(lines(ann.page).first().getByTestId("chat-bubble"));
    const chips = await where(lines(ann.page).first().getByTestId("chat-reactions"));
    expect(chips.y, "under the bubble").toBeGreaterThan(bubble.y + bubble.height / 2);
    expect(chips.x, "on the friend's side").toBeLessThan(bubble.x + bubble.width / 2);
    expect(chips.height).toBeLessThan(40);
    await expect.poll(() => reactionsOn(lines(bob.page).first()), SOON).toEqual([`theirs:${FIRE}`]);

    await lines(ann.page).first().getByTestId("chat-bubble").click();
    await expect(reactWith(ann.page, FIRE)).toHaveAttribute("aria-pressed", "true");
    await reactWith(ann.page, HEART).click();
    await expect.poll(() => reactionsOn(lines(ann.page).first())).toEqual([`mine:${HEART}`]);
    await expect.poll(() => reactionsOn(lines(bob.page).first()), SOON).toEqual([`theirs:${HEART}`]);

    await lines(bob.page).first().getByTestId("chat-bubble").click();
    await expect(bob.page.getByTestId("chat-takeback")).toBeVisible();
    await reactWith(bob.page, JOY).click();
    await expect.poll(() => reactionsOn(lines(bob.page).first())).toEqual([`theirs:${HEART}`, `mine:${JOY}`]);
    await expect.poll(() => reactionsOn(lines(ann.page).first()), SOON).toEqual([`theirs:${JOY}`, `mine:${HEART}`]);

    await lines(ann.page).first().getByTestId("chat-bubble").click();
    await reactWith(ann.page, HEART).click();
    await expect.poll(() => reactionsOn(lines(ann.page).first())).toEqual([`theirs:${JOY}`]);
    await expect.poll(() => reactionsOn(lines(bob.page).first()), SOON).toEqual([`mine:${JOY}`]);

    await fromMenu(ann.page, "chat-report");
    const report = ann.page.getByTestId("chat-report-lines");
    await expect(report.getByTestId("chat-line")).toHaveCount(1);
    await expect(report.getByTestId("chat-reaction")).toHaveCount(0);
  });

  test("on a TV that is only a remote, 'React to Bob's last message' behind the ⋯ opens a page of six; on a computer the message is clicked", async ({ browser }) => {
    test.setTimeout(240_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob", { desk: true });
    await meet(ann, bob);
    await look(bob.page);
    await tile(bob.page, ann.name).click();
    await bob.page.getByTestId("friend-chat").click();
    await expect(bob.page.getByTestId("tv-chat-box")).toBeFocused();
    await bob.page.keyboard.type("Popcorn?");
    await bob.page.keyboard.press("Enter");
    await expect(tvLines(bob.page)).toHaveCount(1);

    await look(ann.page);
    await tile(ann.page, bob.name).click();
    await ann.page.getByTestId("friend-chat").click();
    await expect(tvLines(ann.page)).toHaveCount(1);
    await expect(ann.page.getByTestId("tv-chat-lines").getByTestId("chat-bubble")).toHaveCount(0);
    await ann.page.getByTestId("tv-chat-more").focus();
    await ann.page.keyboard.press("Enter");
    await expect(ann.page.getByTestId("tv-chat-reply-last")).toBeFocused();
    await expect(ann.page.getByTestId("tv-chat-reply-last")).toHaveText(say(en["chat.replyLast"], { name: bob.name }));
    await ann.page.keyboard.press("ArrowDown");
    await expect(ann.page.getByTestId("tv-chat-react-last")).toBeFocused();
    await expect(ann.page.getByTestId("tv-chat-react-last")).toHaveText(say(en["chat.reactLast"], { name: bob.name }));
    await ann.page.keyboard.press("Enter");
    const page = ann.page.getByTestId("tv-chat-react-page");
    await expect(page).toBeVisible();
    await expect(ann.page.getByTestId("tv-chat-react-quote")).toContainText("Popcorn?");
    const six = ann.page.getByTestId("tv-chat-react");
    await expect(six).toHaveCount(6);
    await expect(six.first()).toBeFocused();
    await expect(ann.page.getByTestId("tv-chat-react-remove")).toHaveCount(0);
    expect(await outsideTheScreen(ann.page, "tv-chat-react-page")).toEqual([]);
    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await expect(tvLines(ann.page).first().getByTestId("chat-reaction")).toHaveCount(0);
    await ann.page.getByTestId("tv-chat-more").click();
    await ann.page.getByTestId("tv-chat-react-last").click();
    await expect(six.first()).toBeFocused();
    for (let step = 0; step < 5; step++) await ann.page.keyboard.press("ArrowRight");
    await expect(six.last()).toBeFocused();
    await expect(six.last()).toHaveAttribute("data-reaction", FIRE);
    await ann.page.keyboard.press("Enter");
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await expect(ann.page.getByTestId("tv-chat-write")).toBeFocused();
    await expect.poll(() => reactionsOn(tvLines(ann.page).first())).toEqual([`mine:${FIRE}`]);

    await expect.poll(() => reactionsOn(tvLines(bob.page).first()), SOON).toEqual([`theirs:${FIRE}`]);
    await tvLines(bob.page).first().getByTestId("chat-bubble").click();
    await expect(bob.page.getByTestId("chat-react-bar")).toBeVisible();
    await expect(bob.page.getByTestId("chat-takeback")).toBeVisible();
    const head = await where(bob.page.locator(".tv-chat-head"));
    const take = await where(bob.page.getByTestId("chat-takeback"));
    expect(take.y >= head.y && take.y + take.height <= head.y + head.height, "Take back is in the top of the chat").toBe(true);
    await bob.page.getByTestId("tv-chat-more").focus();
    await bob.page.keyboard.press("ArrowLeft");
    await expect(bob.page.getByTestId("chat-takeback")).toBeFocused();
    await reactWith(bob.page, JOY).click();
    await expect(bob.page.getByTestId("chat-react-bar")).toHaveCount(0);
    await expect.poll(() => reactionsOn(tvLines(bob.page).first())).toEqual([`theirs:${FIRE}`, `mine:${JOY}`]);
    await expect.poll(() => reactionsOn(tvLines(ann.page).first()), SOON).toEqual([`theirs:${JOY}`, `mine:${FIRE}`]);

    await ann.page.getByTestId("tv-chat-more").click();
    await ann.page.getByTestId("tv-chat-react-last").click();
    await expect(six.last()).toBeFocused();
    await expect(six.last()).toHaveAttribute("aria-pressed", "true");
    await ann.page.getByTestId("tv-chat-react-remove").click();
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await expect.poll(() => reactionsOn(tvLines(ann.page).first())).toEqual([`theirs:${JOY}`]);
    await expect.poll(() => reactionsOn(tvLines(bob.page).first()), SOON).toEqual([`mine:${JOY}`]);
  });

  test("on a computer the keyboard reaches them: Tab stops on the newest message, Up and Down go between messages, Enter opens the six and Right walks them, Escape shuts them before the chat; a message taken back while its six are open takes them, and the keys go to the one before (the judge, 17 Nov)", async ({ browser }) => {
    test.setTimeout(240_000);
    const ann = await screenWithFriends(browser, "Ann", { desk: true });
    const bob = await screenWithFriends(browser, "Bob", { desk: true });
    await meet(ann, bob);
    await writes(bob.page, ann.page, "First");
    await writes(bob.page, ann.page, "Second");
    await look(ann.page);
    await tile(ann.page, bob.name).click();
    await ann.page.getByTestId("friend-chat").click();
    await expect(tvLines(ann.page)).toHaveCount(2);
    const list = ann.page.getByTestId("tv-chat-lines");
    const bubbles = list.getByTestId("chat-bubble");
    const bar = ann.page.getByTestId("chat-react-bar");
    const six = bar.getByTestId("chat-react");

    await list.focus();
    await ann.page.keyboard.press("Tab");
    await expect(bubbles.last()).toBeFocused();
    await ann.page.keyboard.press("ArrowUp");
    await expect(bubbles.first()).toBeFocused();
    await ann.page.keyboard.press("ArrowDown");
    await expect(bubbles.last()).toBeFocused();

    await ann.page.keyboard.press("Enter");
    await expect(bar).toBeVisible();
    await expect(bubbles.last()).toBeFocused();
    await expect(bubbles.last()).toHaveAttribute("aria-expanded", "true");
    await ann.page.keyboard.press("ArrowRight");
    await expect(six.first()).toBeFocused();
    await ann.page.keyboard.press("ArrowRight");
    await expect(six.nth(1)).toBeFocused();
    await expect(six.nth(1)).toHaveAttribute("data-reaction", JOY);
    await ann.page.keyboard.press("Enter");
    await expect(bar).toHaveCount(0);
    await expect(bubbles.last()).toBeFocused();
    await expect.poll(() => reactionsOn(tvLines(ann.page).last())).toEqual([`mine:${JOY}`]);
    await expect.poll(async () => (await openFriendsChatOf(bob.page, ann.page)).lines.at(-1)?.theirReaction).toBe(JOY);

    await ann.page.keyboard.press("Enter");
    await expect(bar).toBeVisible();
    await ann.page.keyboard.press("Escape");
    await expect(bar).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await expect(bubbles.last()).toBeFocused();
    await ann.page.keyboard.press("Space");
    await expect(bar).toBeVisible();
    await ann.page.keyboard.press("Space");
    await expect(bar).toHaveCount(0);
    await expect(bubbles.last()).toBeFocused();

    await ann.page.keyboard.press("Enter");
    await ann.page.keyboard.press("ArrowRight");
    await expect(six.first()).toBeFocused();
    const newest = (await openFriendsChatOf(bob.page, ann.page)).lines.at(-1)!.id;
    expect((await bob.page.request.delete(`${await chatAddress(bob.page, ann.page)}/${newest}`)).ok()).toBe(true);
    await expect(tvLines(ann.page)).toHaveCount(1, SOON);
    await expect(bar).toHaveCount(0);
    await expect(bubbles.first()).toBeFocused();
    await ann.page.keyboard.press("Enter");
    await expect(bar).toBeVisible();
    await expect(bubbles.first()).toHaveAttribute("aria-expanded", "true");

    await chose(bob.page, { friendsMessages: false });
    await expect(ann.page.getByTestId("tv-chat-closed")).toBeVisible(SOON);
    await expect(bar).toHaveCount(0);
    await chose(bob.page, { friendsMessages: true });
    await expect(ann.page.getByTestId("tv-chat-box")).toBeVisible(SOON);
    await expect(bubbles).toHaveCount(1);
    await expect(bubbles.first()).toHaveAttribute("aria-expanded", "false");
    await expect(bar).toHaveCount(0);

    await ann.page.getByTestId("tv-chat-box").click();
    await ann.page.keyboard.type("Mine");
    await ann.page.keyboard.press("Enter");
    await expect(tvLines(ann.page)).toHaveCount(2);
    await list.focus();
    await ann.page.keyboard.press("Tab");
    await ann.page.keyboard.press("ArrowDown");
    await expect(bubbles.last()).toBeFocused();
    await ann.page.keyboard.press("Enter");
    await expect(bar).toBeVisible();
    for (let step = 0; step < 6; step++) await ann.page.keyboard.press("ArrowRight");
    await expect(six.last()).toBeFocused();
    await ann.page.keyboard.press("ArrowRight");
    await expect(bar.getByTestId("chat-react-more")).toBeFocused();
    const answer = ann.page.getByTestId("chat-reply");
    const take = ann.page.getByTestId("chat-takeback");
    await ann.page.keyboard.press("ArrowRight");
    await expect(answer).toBeFocused();
    await ann.page.keyboard.press("ArrowRight");
    await expect(take).toBeFocused();
    await ann.page.keyboard.press("ArrowLeft");
    await expect(answer).toBeFocused();
    await ann.page.keyboard.press("ArrowLeft");
    await expect(bubbles.last()).toBeFocused();
    await expect(bar).toBeVisible();
    for (let step = 0; step < 9; step++) await ann.page.keyboard.press("ArrowRight");
    await expect(take).toBeFocused();
    await ann.page.keyboard.press("Escape");
    await expect(take).toHaveCount(0);
    await expect(bar).toHaveCount(0);
    await expect(bubbles.last()).toBeFocused();
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
  });

  test("a TV's page of six, open when the friend stopped taking messages, does not come back by itself when they take them again: the chat is shown (the judge, 17 Nov)", async ({ browser }) => {
    test.setTimeout(240_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    await writes(bob.page, ann.page, "Popcorn?");
    await look(ann.page);
    await tile(ann.page, bob.name).click();
    await ann.page.getByTestId("friend-chat").click();
    await expect(tvLines(ann.page)).toHaveCount(1);
    await ann.page.getByTestId("tv-chat-more").click();
    await ann.page.getByTestId("tv-chat-react-last").click();
    await expect(ann.page.getByTestId("tv-chat-react-page")).toBeVisible();

    await chose(bob.page, { friendsMessages: false });
    await expect(ann.page.getByTestId("tv-chat-closed")).toBeVisible(SOON);
    await expect(ann.page.getByTestId("tv-chat-react-page")).toHaveCount(0);
    await chose(bob.page, { friendsMessages: true });
    await expect(ann.page.getByTestId("tv-chat-write")).toBeVisible(SOON);
    await expect(ann.page.getByTestId("tv-chat-react-page")).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
  });

  test("the + after the six brings sixteen more; one of them is put on, both see it, and the message opens with them all shown", async ({ browser }) => {
    test.setTimeout(150_000);
    const POPCORN = "\u{1F37F}";
    const { ann, bob } = await twoFriends(browser);
    await openChat(ann.page);
    await openChat(bob.page);
    await write(bob.page, "Film night?");
    await expect(lines(ann.page)).toHaveCount(1, SOON);

    await lines(ann.page).first().getByTestId("chat-bubble").click();
    const bar = ann.page.getByTestId("chat-react-bar");
    await expect(bar.getByTestId("chat-react")).toHaveCount(6);
    await bar.getByTestId("chat-react-more").click();
    await expect(bar.getByTestId("chat-react")).toHaveCount(22);
    await expect(bar.getByTestId("chat-react-more")).toHaveCount(0);
    expect(await outsideTheSides(ann.page, ["chat-react-bar"]), "the bar of all of them, on a phone").toEqual([]);
    await reactWith(ann.page, POPCORN).click();
    await expect(bar).toHaveCount(0);
    await expect.poll(() => reactionsOn(lines(ann.page).first())).toEqual([`mine:${POPCORN}`]);
    await expect.poll(() => reactionsOn(lines(bob.page).first()), SOON).toEqual([`theirs:${POPCORN}`]);
    await lines(ann.page).first().getByTestId("chat-bubble").click();
    await expect(bar.getByTestId("chat-react")).toHaveCount(22);
    await expect(reactWith(ann.page, POPCORN)).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("answering a message", () => {
  test("on the phone: Reply on a selected message says 'Replying to Bob' over the box; what is sent next answers it, both see the quote, a press on it shows the message, and a message taken back is quoted nowhere", async ({ browser }) => {
    test.setTimeout(150_000);
    const { ann, bob } = await twoFriends(browser);
    await openChat(ann.page);
    await openChat(bob.page);
    await write(bob.page, "Pizza tonight?");
    await expect(lines(ann.page)).toHaveCount(1, SOON);

    await lines(ann.page).first().getByTestId("chat-bubble").click();
    await ann.page.getByTestId("chat-reply").click();
    const strip = ann.page.getByTestId("chat-reply-strip");
    await expect(strip).toBeVisible();
    await expect(strip).toContainText(say(en["chat.replyingTo"], { name: bob.name }));
    await expect(strip).toContainText("Pizza tonight?");
    await expect(ann.page.getByTestId("chat-react-bar")).toHaveCount(0);
    await expect(ann.page.getByTestId("chat-reply")).toHaveCount(0);
    await expect(ann.page.getByTestId("chat-input")).toBeFocused();
    expect(await outsideTheSides(ann.page, ["chat-reply-strip", "chat-input", "chat-send"])).toEqual([]);
    await ann.page.keyboard.type("Ye");
    await ann.page.keyboard.press("Escape");
    await expect(strip).toHaveCount(0);
    await expect(ann.page.getByTestId("chat")).toBeVisible();
    await expect(ann.page.getByTestId("chat-input")).toHaveText("Ye");
    await ann.page.getByTestId("chat-input").fill("");
    await lines(ann.page).first().getByTestId("chat-bubble").click();
    await ann.page.getByTestId("chat-reply").click();
    await expect(strip).toBeVisible();
    await expect(ann.page.getByTestId("chat-input")).toBeFocused();
    await ann.page.keyboard.type("Yes!");
    await ann.page.getByTestId("chat-send").click();
    await expect(lines(ann.page)).toHaveCount(2);
    await expect(strip).toHaveCount(0);
    const quote = lines(ann.page).nth(1).getByTestId("chat-quote");
    await expect(quote).toContainText("Pizza tonight?");
    await expect(quote).toContainText(bob.name);
    await expect(quote).toHaveAttribute("data-of", "theirs");
    const over = await where(quote);
    const under = await where(lines(ann.page).nth(1).getByTestId("chat-bubble"));
    expect(over.y + over.height, "the quote is over the bubble").toBeLessThanOrEqual(under.y + 1);
    await write(ann.page, "See you");
    await expect(lines(ann.page)).toHaveCount(3);
    await expect(lines(ann.page).nth(2).getByTestId("chat-quote")).toHaveCount(0);

    await expect(lines(bob.page)).toHaveCount(3, SOON);
    const his = lines(bob.page).nth(1).getByTestId("chat-quote");
    await expect(his).toContainText("Pizza tonight?");
    await expect(his).toContainText(en["chat.you"]);
    await expect(his).toHaveAttribute("data-of", "mine");
    await his.click();
    await expect(lines(bob.page).first()).toHaveAttribute("data-shown", "true");
    await expect(bob.page.getByTestId("chat-react-bar")).toHaveCount(0);
    await expect(lines(bob.page).first()).not.toHaveAttribute("data-shown", "true", { timeout: 4_000 });

    await lines(bob.page).first().getByTestId("chat-bubble").click();
    await bob.page.getByTestId("chat-takeback").click();
    await expect(lines(bob.page)).toHaveCount(2);
    await expect(bob.page.getByTestId("chat-quote")).toHaveCount(0);
    await expect(lines(ann.page)).toHaveCount(2, SOON);
    await expect(ann.page.getByTestId("chat-quote")).toHaveCount(0);
    await expect(texts(ann.page)).toHaveText(["Yes!", "See you"]);
  });

  test("on the phone a message drawn to the right with a finger is answered; one drawn up or down is not, and the × leaves it unanswered", async ({ browser }) => {
    test.setTimeout(150_000);
    const { ann, bob } = await twoFriends(browser);
    await openChat(ann.page);
    await writes(bob.page, ann.page, "Which one?");
    await expect(lines(ann.page)).toHaveCount(1, SOON);
    const bubble = lines(ann.page).first().getByTestId("chat-bubble");
    const strip = ann.page.getByTestId("chat-reply-strip");
    const cdp = await ann.page.context().newCDPSession(ann.page);
    const draw = async (dx: number, dy: number, beforeLifting?: () => Promise<void>) => {
      const spot = await where(bubble);
      const from = { x: Math.round(spot.x + Math.min(40, spot.width / 3)), y: Math.round(spot.y + spot.height / 2) };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
      for (const part of [0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 1]) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: Math.round(from.x + dx * part), y: Math.round(from.y + dy * part) }] });
      }
      await beforeLifting?.();
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };

    await draw(4, -90);
    await ann.page.waitForTimeout(300);
    await expect(strip).toHaveCount(0);
    await expect(lines(ann.page).first()).not.toHaveAttribute("data-swipe");
    await draw(40, 0);
    await expect(strip).toHaveCount(0);
    await expect(lines(ann.page).first()).not.toHaveAttribute("data-swipe");
    await expect.poll(() => lines(ann.page).first().evaluate((item) => (item as HTMLElement).style.getPropertyValue("--swipe"))).toBe("");
    const dayBefore = await where(ann.page.getByTestId("chat-day").first());
    const bubbleBefore = await where(bubble);
    await draw(100, 4, async () => {
      await expect(lines(ann.page).first()).toHaveAttribute("data-swipe", "ready");
      expect((await where(ann.page.getByTestId("chat-day").first())).x).toBeCloseTo(dayBefore.x, 0);
      expect((await where(bubble)).x).toBeGreaterThan(bubbleBefore.x + 40);
      expect(await ann.page.getByTestId("chat-lines").evaluate((list) => list.scrollLeft)).toBe(0);
    });
    await expect(strip).toBeVisible();
    await expect(strip).toContainText(say(en["chat.replyingTo"], { name: bob.name }));
    await expect(strip).toContainText("Which one?");
    await expect(lines(ann.page).first()).not.toHaveAttribute("data-swipe");
    await expect(ann.page.getByTestId("chat-react-bar")).toHaveCount(0);
    await ann.page.getByTestId("chat-reply-cancel").click();
    await expect(strip).toHaveCount(0);
    await write(ann.page, "The second");
    await expect(lines(ann.page)).toHaveCount(2);
    await expect(ann.page.getByTestId("chat-quote")).toHaveCount(0);
    await bubble.click();
    await expect(ann.page.getByTestId("chat-react-bar")).toBeVisible();
  });

  test("on a TV that is only a remote, 'Reply to Bob's last message' is first behind the ⋯ and opens the page that writes, saying what is answered; Back keeps the answer over Write, with an × that lets it go", async ({ browser }) => {
    test.setTimeout(240_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    await writes(bob.page, ann.page, "Popcorn?");
    await writes(ann.page, bob.page, "Maybe");
    await look(ann.page);
    await tile(ann.page, bob.name).click();
    await ann.page.getByTestId("friend-chat").click();
    await expect(tvLines(ann.page)).toHaveCount(2);

    await ann.page.getByTestId("tv-chat-more").focus();
    await ann.page.keyboard.press("Enter");
    await expect(ann.page.getByTestId("tv-chat-reply-last")).toBeFocused();
    await ann.page.keyboard.press("Enter");
    const compose = ann.page.getByTestId("tv-chat-compose");
    await expect(compose).toBeVisible();
    const quote = ann.page.getByTestId("tv-chat-quote");
    await expect(quote).toHaveAttribute("data-replying", "true");
    await expect(quote).toContainText(say(en["chat.replyingTo"], { name: bob.name }));
    await expect(quote).toContainText("Popcorn?");
    expect(await outsideTheScreen(ann.page, "tv-chat-compose")).toEqual([]);

    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    const strip = ann.page.getByTestId("chat-reply-strip");
    await expect(strip).toBeVisible();
    await expect(strip).toContainText("Popcorn?");
    await ann.page.getByTestId("chat-reply-cancel").click();
    await expect(strip).toHaveCount(0);

    await ann.page.getByTestId("tv-chat-more").click();
    await ann.page.getByTestId("tv-chat-reply-last").click();
    await ann.page.getByTestId("tv-chat-input").fill("Yes, salted");
    await ann.page.getByTestId("tv-chat-send").click();
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await expect(tvLines(ann.page)).toHaveCount(3);
    await expect(strip).toHaveCount(0);
    const answer = tvLines(ann.page).nth(2).getByTestId("chat-quote");
    await expect(answer).toContainText("Popcorn?");
    await expect(answer).toHaveAttribute("role", "note");
    await look(bob.page);
    await tile(bob.page, ann.name).click();
    await bob.page.getByTestId("friend-chat").click();
    await expect(tvLines(bob.page)).toHaveCount(3);
    await expect(tvLines(bob.page).nth(2).getByTestId("chat-quote")).toContainText(en["chat.you"]);

    await ann.page.getByTestId("tv-chat-more").click();
    await ann.page.getByTestId("tv-chat-react-last").click();
    const reacts = ann.page.getByTestId("tv-chat-react");
    await expect(reacts).toHaveCount(6);
    for (let step = 0; step < 6; step++) await ann.page.keyboard.press("ArrowRight");
    await expect(ann.page.getByTestId("tv-chat-react-more")).toBeFocused();
    await ann.page.keyboard.press("Enter");
    await expect(reacts).toHaveCount(22);
    await expect(reacts.nth(6)).toBeFocused();
    expect(await outsideTheScreen(ann.page, "tv-chat-react-page")).toEqual([]);
  });

  test("on a computer Reply at the top puts the keys in the box, with the strip over it; what is sent answers the message", async ({ browser }) => {
    test.setTimeout(240_000);
    const ann = await screenWithFriends(browser, "Ann", { desk: true });
    const bob = await screenWithFriends(browser, "Bob", { desk: true });
    await meet(ann, bob);
    await writes(bob.page, ann.page, "Sunday?");
    await look(ann.page);
    await tile(ann.page, bob.name).click();
    await ann.page.getByTestId("friend-chat").click();
    await expect(tvLines(ann.page)).toHaveCount(1);

    await tvLines(ann.page).first().getByTestId("chat-bubble").click();
    const answer = ann.page.getByTestId("chat-reply");
    await expect(answer).toBeVisible();
    const head = await where(ann.page.locator(".tv-chat-head"));
    const at = await where(answer);
    expect(at.y >= head.y && at.y + at.height <= head.y + head.height, "Reply is in the top of the chat").toBe(true);
    await answer.click();
    await expect(ann.page.getByTestId("tv-chat-box")).toBeFocused();
    await expect(ann.page.getByTestId("chat-reply-strip")).toContainText("Sunday?");
    await expect(ann.page.getByTestId("chat-reply-cancel")).toHaveAttribute("data-nav", "true");
    await ann.page.keyboard.type("Sunday");
    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("chat-reply-strip")).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await expect(ann.page.getByTestId("tv-chat-box")).toHaveValue("Sunday");
    await expect(ann.page.getByTestId("tv-chat-box")).toBeFocused();
    await tvLines(ann.page).first().getByTestId("chat-bubble").click();
    await ann.page.getByTestId("chat-reply").click();
    await expect(ann.page.getByTestId("tv-chat-box")).toBeFocused();
    await ann.page.keyboard.type(" it is");
    await ann.page.keyboard.press("Enter");
    await expect(tvLines(ann.page)).toHaveCount(2);
    await expect(ann.page.getByTestId("chat-reply-strip")).toHaveCount(0);
    await expect(tvLines(ann.page).nth(1).getByTestId("chat-quote")).toContainText("Sunday?");
    const said = (await openFriendsChatOf(bob.page, ann.page)).lines;
    expect(said).toHaveLength(2);
    expect(said[1]!.replyTo).toBe(said[0]!.id);
  });
});

test.describe("the ticks on one's own messages", () => {
  const ticks = (line: ReturnType<Page["getByTestId"]>) => line.getByTestId("chat-ticks");

  test("on the phone: none while the friend's screens have not asked, one once one of them has the message, two once the friend opened the chat; the friend's messages have none, and an open chat sees at once (the owner, 17 Nov)", async ({ browser }) => {
    test.setTimeout(150_000);
    const { ann, bob } = await twoFriends(browser);
    await openChat(ann.page);
    await write(ann.page, "Are you there?");
    await expect(lines(ann.page)).toHaveCount(1);
    await ann.page.waitForTimeout(4_000);
    await expect(ticks(lines(ann.page).first())).toHaveCount(0);

    await look(bob.page);
    await expect(badge(bob.page)).toHaveText("1");
    const one = ticks(lines(ann.page).first());
    await expect(one).toHaveAttribute("data-ticks", "1", SOON);
    await expect(one).toHaveAttribute("aria-label", en["chat.received"]);
    await expect(one).not.toHaveClass(/chat-ticks-seen/);

    await bell(bob.page).click();
    await bob.page.getByTestId("bell-chat-open").click();
    await expect(lines(bob.page)).toHaveCount(1);
    await expect(ticks(lines(bob.page).first())).toHaveCount(0);
    await expect(one).toHaveAttribute("data-ticks", "2", SOON);
    await expect(one).toHaveAttribute("aria-label", en["chat.seen"]);
    await expect(one).toHaveClass(/chat-ticks-seen/);

    await write(bob.page, "Yes!");
    await expect(lines(ann.page)).toHaveCount(2, SOON);
    await expect(ticks(lines(ann.page).nth(1))).toHaveCount(0);
    await expect(ticks(lines(bob.page).nth(1))).toHaveAttribute("data-ticks", "2", SOON);
    await expect(one).toHaveAttribute("data-ticks", "2");
  });

  test("on the TV's pages: the same ticks beside the time of one's own messages", async ({ browser }) => {
    test.setTimeout(240_000);
    const ann = await screenWithFriends(browser, "Ann", { desk: true });
    const bob = await screenWithFriends(browser, "Bob", { desk: true });
    await meet(ann, bob);
    await tile(ann.page, bob.name).click();
    await ann.page.getByTestId("friend-chat").click();
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await ann.page.getByTestId("tv-chat-box").click();
    await ann.page.keyboard.type("Sunday?");
    await ann.page.keyboard.press("Enter");
    await expect(tvLines(ann.page)).toHaveCount(1);
    await expect(ticks(tvLines(ann.page).first())).toHaveCount(0);

    await look(bob.page);
    await expect(ticks(tvLines(ann.page).first())).toHaveAttribute("data-ticks", "1", SOON);
    await tile(bob.page, ann.name).click();
    await bob.page.getByTestId("friend-chat").click();
    await expect(tvLines(bob.page)).toHaveCount(1);
    await expect(ticks(tvLines(ann.page).first())).toHaveAttribute("data-ticks", "2", SOON);
    const time = tvLines(ann.page).first().locator(".chat-time");
    await expect(time.getByTestId("chat-ticks")).toHaveCount(1);
  });
});

const chatAddress = async (from: Page, to: Page) => `/api/profiles/${await profileOf(from)}/friends/${await profileOf(to)}/chat`;
async function openFriendsChatOf(from: Page, to: Page): Promise<{ lines: Array<{ id: number; theirReaction?: string; replyTo?: number }> }> {
  const response = await from.request.get(await chatAddress(from, to));
  expect(response.ok()).toBe(true);
  return response.json();
}

function widePicture(): Buffer {
  const picture = new PNG({ width: 300, height: 200 });
  for (let y = 0; y < 200; y++) {
    for (let x = 0; x < 300; x++) {
      const at = (y * 300 + x) * 4;
      const [r, g, b] = x < 50 ? [0, 200, 0] : x >= 250 ? [0, 0, 220] : [220, 30, 30];
      picture.data[at] = r;
      picture.data[at + 1] = g;
      picture.data[at + 2] = b;
      picture.data[at + 3] = 255;
    }
  }
  return PNG.sync.write(picture);
}

function stickerSquare(): string {
  const picture = new PNG({ width: 192, height: 192 });
  for (let at = 0; at < picture.data.length; at += 4) picture.data.set([220, 30, 30, 255], at);
  return PNG.sync.write(picture).toString("base64");
}

function colourAt(picture: PNG, x: number, y: number): string {
  const at = (y * picture.width + x) * 4;
  const [r, g, b] = [picture.data[at]!, picture.data[at + 1]!, picture.data[at + 2]!];
  return r > 150 && g < 90 && b < 90 ? "red" : g > 150 && r < 90 ? "green" : b > 150 && r < 90 ? "blue" : `rgb(${r}, ${g}, ${b})`;
}

const pictureAt = async (page: Page, address: string) => {
  const answer = await page.request.get(address);
  expect(answer.status(), address).toBe(200);
  return PNG.sync.read(await answer.body());
};

const askAfresh = (page: Page) => page.route(/\/stickers\//, (route) => route.continue());

async function movingFile(format: "webp" | "gif", colours: Array<[number, number, number]>, delays: number[]): Promise<Buffer> {
  const side = 64;
  const raw = Buffer.alloc(side * side * 4 * colours.length);
  colours.forEach(([r, g, b], page) => {
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) raw.set((x - 31.5) ** 2 + (y - 31.5) ** 2 <= 30 ** 2 ? [r, g, b, 255] : [0, 0, 0, 0], ((page * side + y) * side + x) * 4);
    }
  });
  const pictures = sharp(raw, { raw: { width: side, height: side * colours.length, channels: 4, pageHeight: side } });
  return (format === "webp" ? pictures.webp({ lossless: true, loop: 0, delay: delays }) : pictures.gif({ loop: 0, delay: delays })).toBuffer();
}

async function movingAt(page: Page, address: string) {
  const answer = await page.request.get(address);
  expect(answer.status(), address).toBe(200);
  const body = await answer.body();
  const about = await sharp(body, { animated: true }).metadata();
  const { data, info } = await sharp(body, { animated: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pages = about.pages ?? 1;
  const height = info.height / pages;
  const size = info.width * height * 4;
  const pictures = Array.from({ length: pages }, (_, at) => ({ width: info.width, height, data: data.subarray(at * size, (at + 1) * size) }) as unknown as PNG);
  return { type: answer.headers()["content-type"], pages, delays: about.delay ?? [], loop: about.loop, pictures };
}

const seeThrough = (picture: PNG, x: number, y: number) => picture.data[(y * picture.width + x) * 4 + 3]! < 16;

test.describe("personal stickers in a chat", () => {
  test("while the host has them off (every host, until its owner turns them on): the phone's sheet and a computer's page are Kino's alone, as they were, and nothing is asked about them", async ({ browser }) => {
    test.setTimeout(240_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const dee = await screenWithFriends(browser, "Dee", { desk: true });
    const asked: string[] = [];
    for (const page of [ann.page, dee.page]) {
      await page.route("**/api/features", async (route) => {
        const answer = await route.fetch();
        const { stickers: _on, ...features } = (await answer.json()) as Record<string, unknown>;
        await route.fulfill({ response: answer, json: features });
      });
      page.on("request", (request) => {
        if (/\/api\/profiles\/[^?#]*\/stickers/.test(request.url())) asked.push(request.url());
      });
    }
    await meetPhone(dee, ann);

    await openChat(ann.page);
    const sheet = await openPanel(ann.page, "stickers");
    await expect(sheet.getByTestId("chat-sticker-pick")).toHaveCount(STICKER_COUNT);
    expect(await gridFaults(sheet.getByTestId("chat-sticker-pick")), "the phone's stickers: squares, none over another").toEqual([]);
    await expect(sheet.getByTestId("chat-stickers-yours")).toHaveCount(0);
    await expect(sheet.locator(".chat-stickers-head")).toHaveCount(0);
    await expect(sheet.getByTestId("chat-sticker-file")).toHaveCount(0);
    await ann.page.keyboard.press("Escape");

    await tile(dee.page, ann.name).click();
    await dee.page.getByTestId("friend-chat").click();
    await dee.page.getByTestId("tv-chat-panel-btn").click();
    const page = dee.page.getByTestId("tv-chat-panel");
    const picks = page.getByTestId("chat-sticker-pick");
    await expect(picks).toHaveCount(STICKER_COUNT);
    await expect(dee.page.getByTestId("tv-chat-box"), "a click leaves the keys in the box").toBeFocused();
    expect(await gridFaults(picks), "the computer's stickers: squares, none over another").toEqual([]);
    expect(await outsideTheScreen(dee.page, "tv-chat")).toEqual([]);
    await expect(page.getByTestId("chat-stickers-yours")).toHaveCount(0);
    await expect(page.locator(".chat-stickers-head, .with-yours")).toHaveCount(0);
    await picks.first().click();
    await expect(tvLines(dee.page)).toHaveCount(1);
    await expect(tvLines(dee.page).first().getByTestId("chat-sticker")).toHaveAttribute("src", "/stickers/popcorn.webp");
    expect(asked, "nothing asked of personal stickers").toEqual([]);
  });

  test("on the phone: a picture of one's own is made a sticker (its middle square, 192 by 192), sent, and seen by the friend, who keeps it and sends it on; a report has its picture; the maker letting it go leaves the friend's, and once nobody has it, it is gone for both", async ({ browser }) => {
    test.setTimeout(240_000);
    const { ann, bob } = await twoFriends(browser);
    await openChat(ann.page);
    const sheet = await openPanel(ann.page, "stickers");
    await expect(sheet.getByTestId("chat-stickers-yours")).toBeVisible();
    await expect(sheet.getByTestId("chat-stickers-none")).toHaveText(en["chat.stickersNone"]);
    await expect(sheet.getByTestId("chat-stickers-edit")).toHaveCount(0);
    await expect(sheet.getByTestId("chat-sticker-pick")).toHaveCount(STICKER_COUNT);

    const file = ann.page.getByTestId("chat-sticker-file");
    await file.setInputFiles({ name: "notes.png", mimeType: "image/png", buffer: Buffer.from("these are not the pixels of anything") });
    await expect(sheet.getByTestId("chat-sticker-problem")).toHaveText(en["chat.stickerNotPicture"]);
    await expect(sheet.getByTestId("chat-sticker-mine")).toHaveCount(0);

    await file.setInputFiles({ name: "wide.png", mimeType: "image/png", buffer: widePicture() });
    const mine = sheet.getByTestId("chat-sticker-mine");
    await expect(mine).toHaveCount(1);
    await expect(sheet.getByTestId("chat-sticker-problem")).toHaveCount(0);
    await expect(sheet.getByTestId("chat-stickers-none")).toHaveCount(0);
    const id = (await mine.getAttribute("data-personal"))!;
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const made = await pictureAt(ann.page, (await mine.locator("img").getAttribute("src"))!);
    expect([made.width, made.height]).toEqual([192, 192]);
    expect([colourAt(made, 96, 96), colourAt(made, 3, 96), colourAt(made, 188, 96), colourAt(made, 96, 3)]).toEqual(["red", "red", "red", "red"]);
    await expect.poll(() => stickerLoaded(mine.locator("img"))).toBe(192);

    await mine.click();
    await expect(sheet).toHaveCount(0);
    await expect(lines(ann.page)).toHaveCount(1);
    const sent = lines(ann.page).first().getByTestId("chat-personal-sticker");
    await expect.poll(() => stickerLoaded(sent)).toBe(192);
    expect(await bubbleOf(sent)).toBe("rgba(0, 0, 0, 0)");

    await openChat(bob.page);
    const theirs = lines(bob.page).first().getByTestId("chat-personal-sticker");
    await expect.poll(() => stickerLoaded(theirs)).toBe(192);
    await expect(theirs).toHaveAttribute("alt", say(en["chat.stickerOf"], { name: ann.name }));
    const bubble = lines(bob.page).first().getByTestId("chat-bubble");
    const save = bob.page.getByTestId("chat-sticker-save");
    const view = bob.page.getByTestId("chat-view");
    await bubble.click();
    await expect(view).toBeVisible();
    await expect(save).toHaveCount(0);
    const screen = bob.page.viewportSize()!;
    const larger = (await bob.page.getByTestId("chat-view-picture").boundingBox())!;
    expect(larger.width, "larger than in the chat").toBeGreaterThan(250);
    expect(Math.abs(larger.x + larger.width / 2 - screen.width / 2), "in the middle, sideways").toBeLessThan(2);
    expect(Math.abs(larger.y + larger.height / 2 - screen.height / 2), "in the middle, up and down").toBeLessThan(2);
    expect(larger.x >= 0 && larger.y >= 0 && larger.x + larger.width <= screen.width && larger.y + larger.height <= screen.height, "inside the screen").toBe(true);
    await expect(bob.page.getByTestId("chat-view-close")).toBeFocused();
    await bob.page.keyboard.press("Escape");
    await expect(view).toHaveCount(0);
    await expect(bob.page.getByTestId("chat")).toBeVisible();
    await bubble.click();
    await expect(view).toBeVisible();
    await bob.page.waitForTimeout(450);
    await view.click({ position: { x: 8, y: 8 } });
    await expect(view).toHaveCount(0);
    await expect(bob.page.getByTestId("chat")).toBeVisible();
    await bubble.click({ delay: 650 });
    await expect(save).toHaveText(en["chat.stickerSave"]);
    await expect(view, "the press that ended the hold is not one more press").toHaveCount(0);
    await expect(bob.page.getByTestId("chat-react-bar")).toBeVisible();
    expect((await save.boundingBox())!.y, "at the top of the chat").toBeLessThan((await bob.page.getByTestId("chat-lines").boundingBox())!.y);
    await save.click();
    await expect(bob.page.getByTestId("chat-sticker-note")).toHaveText(en["chat.stickerSavedNote"]);
    await expect(save, "saved: nothing is selected any more").toHaveCount(0);
    await bubble.click({ delay: 650 });
    await expect(save).toBeDisabled();
    await expect(save).toHaveText(en["chat.stickerSaved"]);
    await bob.page.keyboard.press("Escape");
    await expect(save).toHaveCount(0);
    await expect(bob.page.getByTestId("chat")).toBeVisible();
    await bubble.click({ button: "right" });
    await expect(save).toBeVisible();
    await bob.page.getByTestId("chat-lines").click({ position: { x: 4, y: 4 } });
    await expect(save).toHaveCount(0);
    await lines(ann.page).first().getByTestId("chat-bubble").click({ delay: 650 });
    await expect(ann.page.getByTestId("chat-takeback")).toBeVisible();
    await expect(ann.page.getByTestId("chat-sticker-save")).toHaveCount(0);
    await lines(ann.page).first().getByTestId("chat-bubble").click();
    await expect(ann.page.getByTestId("chat-takeback")).toHaveCount(0);
    await expect(ann.page.getByTestId("chat-view")).toHaveCount(0);

    await openPanel(bob.page, "stickers");
    const his = bob.page.getByTestId("chat-panel").getByTestId("chat-sticker-mine");
    await expect(his).toHaveCount(1);
    await expect(his).toHaveAttribute("data-personal", id);
    await expect(his).toHaveAttribute("aria-label", en["chat.stickerSavedOne"]);
    await his.click();
    await expect(lines(bob.page)).toHaveCount(2);
    await expect.poll(() => stickerLoaded(lines(bob.page).nth(1).getByTestId("chat-personal-sticker"))).toBe(192);
    await expect(lines(ann.page)).toHaveCount(2, SOON);
    await expect.poll(() => stickerLoaded(lines(ann.page).nth(1).getByTestId("chat-personal-sticker"))).toBe(192);

    await fromMenu(bob.page, "chat-report");
    const shown = bob.page.getByTestId("chat-report-lines");
    await expect(shown.getByTestId("chat-line")).toHaveCount(2);
    await expect.poll(() => stickerLoaded(shown.getByTestId("chat-personal-sticker").first())).toBe(192);
    await bob.page.getByTestId("chat-report-send").click();
    await expect(bob.page.getByTestId("chat-report-sent")).toHaveText(en["chat.reportSent"]);
    await bob.page.getByTestId("chat-report-done").click();
    const [report] = await reportsAbout(bob.page, bob.name);
    expect(report?.attachments.map((each) => `${each.name} ${each.role}`)).toEqual(["chat.txt file", "sticker1.png photo"]);
    const transcript = await (await bob.page.request.get(`/api/admin/feedback/${report!.id}/files/${report!.attachments[0]!.id}`, { headers: AUTH })).text();
    expect(transcript).toContain(`[personal sticker ${id}: picture in sticker1.png]`);
    expect(transcript).toContain("node scripts/stickers.mjs remove");
    const reported = PNG.sync.read(await (await bob.page.request.get(`/api/admin/feedback/${report!.id}/files/${report!.attachments[1]!.id}`, { headers: AUTH })).body());
    expect([reported.width, colourAt(reported, 96, 96)]).toEqual([192, "red"]);

    await openPanel(ann.page, "stickers");
    await sheet.getByTestId("chat-stickers-edit").click();
    await expect(sheet.getByTestId("chat-sticker-add")).toHaveCount(0);
    await sheet.getByTestId("chat-sticker-remove").click();
    await expect(mine).toHaveCount(0);
    await expect(sheet.getByTestId("chat-stickers-none")).toBeVisible();
    await expect(sheet.getByTestId("chat-sticker-add")).toBeVisible();
    await ann.page.keyboard.press("Escape");
    const address = (await sent.getAttribute("src"))!;
    expect((await ann.page.request.get(address)).status(), "Bob keeps it").toBe(200);

    await openPanel(bob.page, "stickers");
    await bob.page.getByTestId("chat-stickers-edit").click();
    await bob.page.getByTestId("chat-sticker-remove").click();
    await expect(his).toHaveCount(0);
    await bob.page.keyboard.press("Escape");
    expect((await ann.page.request.get(address)).status()).toBe(404);
    expect((await bob.page.request.get((await theirs.getAttribute("src"))!)).status()).toBe(404);
    for (const page of [ann.page, bob.page]) {
      await askAfresh(page);
      await page.reload();
      await openChat(page);
      await expect(page.getByTestId("chat-personal-gone")).toHaveCount(2);
      await expect(page.getByTestId("chat-personal-gone").first()).toHaveText(en["chat.stickerGone"]);
    }

    const webp = await ann.page.evaluate(async () => {
      const canvas = Object.assign(document.createElement("canvas"), { width: 512, height: 512 });
      const context = canvas.getContext("2d")!;
      context.fillStyle = "rgb(30, 30, 220)";
      context.beginPath();
      context.arc(256, 256, 200, 0, Math.PI * 2);
      context.fill();
      const blob = await new Promise<Blob>((done) => canvas.toBlob((made) => done(made!), "image/webp", 0.9));
      return { type: blob.type, bytes: [...new Uint8Array(await blob.arrayBuffer())] };
    });
    expect(webp.type).toBe("image/webp");
    await openPanel(ann.page, "stickers");
    await ann.page.getByTestId("chat-sticker-file").setInputFiles({ name: "sticker.webp", mimeType: "image/webp", buffer: Buffer.from(webp.bytes) });
    await expect(mine).toHaveCount(1);
    const fromWebp = await pictureAt(ann.page, (await mine.locator("img").getAttribute("src"))!);
    expect([fromWebp.width, fromWebp.height, colourAt(fromWebp, 96, 96)]).toEqual([192, 192, "blue"]);
    expect(fromWebp.data[3], "a see-through corner stays see-through").toBe(0);
  });

  test("in the Android app (0.2.0 on): From WhatsApp opens the chooser in WhatsApp's stickers folder, and several chosen at once are each made a sticker; a browser and an app of 0.1.0 have no such button", async ({ browser }) => {
    test.setTimeout(240_000);
    const { ann } = await twoFriends(browser);
    const sheet = ann.page.getByTestId("chat-panel");
    const whatsapp = sheet.getByTestId("chat-sticker-whatsapp");
    const mine = sheet.getByTestId("chat-sticker-mine");

    await openChat(ann.page);
    await openPanel(ann.page, "stickers");
    await expect(sheet.getByTestId("chat-sticker-add")).toBeVisible();
    await expect(whatsapp).toHaveCount(0);

    await ann.page.context().addInitScript(() => {
      const folders: string[] = [];
      const app: Record<string, unknown> =
        localStorage.getItem("e2e-app-folders") === "yes"
          ? {
              onmessage: null,
              postMessage(text: string) {
                const said = JSON.parse(text) as { call: string; folder?: string };
                const answer = (message: object) => setTimeout(() => (app.onmessage as ((event: { data: string }) => void) | null)?.({ data: JSON.stringify(message) }), 5);
                if (said.call === "hello") answer({ kind: "hello", version: "0.2.0", folders: ["whatsapp-stickers", "whatsapp-gifs"], notify: false, token: "" });
                if (said.call === "pickFrom") {
                  folders.push(said.folder ?? "");
                  answer({ kind: "picking", folder: said.folder, known: true });
                }
              },
            }
          : { version: () => "0.1.0", pushToken: () => "", setStrings: () => {} };
      Object.assign(window, { KinoApp: app, e2eFolders: folders });
    });
    await ann.page.reload();
    await openChat(ann.page);
    await openPanel(ann.page, "stickers");
    await expect(sheet.getByTestId("chat-sticker-add")).toBeVisible();
    await expect(whatsapp, "an app of 0.1.0 cannot open the folder: no button").toHaveCount(0);

    await ann.page.evaluate(() => localStorage.setItem("e2e-app-folders", "yes"));
    const told: string[] = [];
    ann.page.on("request", (sent) => {
      if (new URL(sent.url()).pathname === "/api/push") told.push(sent.method());
    });
    await ann.page.reload();
    await openChat(ann.page);
    await openPanel(ann.page, "stickers");
    await expect(whatsapp).toHaveText(en["chat.stickerFromWhatsApp"]);
    expect(told, "notifications off: the phone is forgotten, once").toEqual(["DELETE"]);
    expect(await gridFaults(sheet.locator('[data-testid="chat-sticker-add"], [data-testid="chat-sticker-whatsapp"], [data-testid="chat-sticker-pick"]')), "the two buttons are squares of the grid").toEqual([]);

    const stickers = await ann.page.evaluate(async () => {
      const made: number[][] = [];
      for (const colour of ["rgb(30, 30, 220)", "rgb(220, 30, 30)"]) {
        const canvas = Object.assign(document.createElement("canvas"), { width: 512, height: 512 });
        const context = canvas.getContext("2d")!;
        context.fillStyle = colour;
        context.beginPath();
        context.arc(256, 256, 200, 0, Math.PI * 2);
        context.fill();
        const blob = await new Promise<Blob>((done) => canvas.toBlob((one) => done(one!), "image/webp", 0.9));
        made.push([...new Uint8Array(await blob.arrayBuffer())]);
      }
      return made;
    });
    const [chooser] = await Promise.all([ann.page.waitForEvent("filechooser"), whatsapp.click()]);
    expect(await ann.page.evaluate(() => (window as unknown as { e2eFolders: string[] }).e2eFolders), "the app was asked for WhatsApp's folder").toEqual(["whatsapp-stickers"]);
    expect(chooser.isMultiple(), "several can be chosen").toBe(true);
    await chooser.setFiles(stickers.map((bytes, at) => ({ name: `STK-${at}.webp`, mimeType: "image/webp", buffer: Buffer.from(bytes) })));
    await expect(mine).toHaveCount(2);
    await expect(sheet.getByTestId("chat-sticker-problem")).toHaveCount(0);
    const colours = await Promise.all((await mine.locator("img").all()).map(async (image) => colourAt(await pictureAt(ann.page, (await image.getAttribute("src"))!), 96, 96)));
    expect(colours.sort()).toEqual(["blue", "red"]);

    const [plain] = await Promise.all([ann.page.waitForEvent("filechooser"), sheet.getByTestId("chat-sticker-add").click()]);
    await plain.setFiles({ name: "wide.png", mimeType: "image/png", buffer: widePicture() });
    await expect(mine).toHaveCount(3);
    expect(await ann.page.evaluate(() => (window as unknown as { e2eFolders: string[] }).e2eFolders)).toEqual(["whatsapp-stickers"]);
  });

  test("stickers that move (MOVING_STICKERS on): an animated WebP is made one that moves, each picture shown as long as it was and its see-through kept, seen moving by the friend and reported as the WebP it is; an animated GIF moves too; a GIF whose pictures are all the same is a still", async ({ browser }) => {
    test.setTimeout(240_000);
    const { ann, bob } = await twoFriends(browser);
    await openChat(ann.page);
    const sheet = await openPanel(ann.page, "stickers");
    const mine = sheet.getByTestId("chat-sticker-mine");
    const file = ann.page.getByTestId("chat-sticker-file");
    await expect(sheet.getByTestId("chat-stickers-none")).toBeVisible();
    const ids = () => mine.evaluateAll((all) => all.map((each) => each.getAttribute("data-personal")!));
    const madeAfter = async (had: string[]) => {
      const id = (await ids()).find((each) => !had.includes(each))!;
      return movingAt(ann.page, (await sheet.locator(`[data-personal="${id}"] img`).getAttribute("src"))!);
    };

    await file.setInputFiles({ name: "moving.webp", mimeType: "image/webp", buffer: await movingFile("webp", [[220, 30, 30], [30, 200, 30], [30, 30, 220]], [200, 200, 200]) });
    await expect(mine).toHaveCount(1);
    await expect(sheet.getByTestId("chat-sticker-problem")).toHaveCount(0);
    const made = await madeAfter([]);
    expect(made.type).toBe("image/webp");
    expect([made.pages, made.loop, made.delays]).toEqual([3, 0, [200, 200, 200]]);
    expect(made.pictures.map((picture) => [picture.width, picture.height, colourAt(picture, 96, 96)])).toEqual([
      [192, 192, "red"],
      [192, 192, "green"],
      [192, 192, "blue"],
    ]);
    expect(made.pictures.map((picture) => seeThrough(picture, 2, 2)), "its corners stay see-through").toEqual([true, true, true]);
    await expect.poll(() => stickerLoaded(mine.locator("img"))).toBe(192);

    await mine.click();
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => stickerLoaded(lines(ann.page).first().getByTestId("chat-personal-sticker"))).toBe(192);
    await openChat(bob.page);
    const theirs = lines(bob.page).first().getByTestId("chat-personal-sticker");
    await expect.poll(() => stickerLoaded(theirs)).toBe(192);
    const seen = await movingAt(bob.page, (await theirs.getAttribute("src"))!);
    expect([seen.type, seen.pages]).toEqual(["image/webp", 3]);

    await fromMenu(bob.page, "chat-report");
    await bob.page.getByTestId("chat-report-send").click();
    await expect(bob.page.getByTestId("chat-report-sent")).toHaveText(en["chat.reportSent"]);
    await bob.page.getByTestId("chat-report-done").click();
    const [report] = await reportsAbout(bob.page, bob.name);
    expect(report?.attachments.map((each) => `${each.name} ${each.role}`)).toEqual(["chat.txt file", "sticker1.webp photo"]);
    const reported = await (await bob.page.request.get(`/api/admin/feedback/${report!.id}/files/${report!.attachments[1]!.id}`, { headers: AUTH })).body();
    expect((await sharp(reported, { animated: true }).metadata()).pages).toBe(3);

    await openPanel(ann.page, "stickers");
    let had = await ids();
    await file.setInputFiles({ name: "moving.gif", mimeType: "image/gif", buffer: await movingFile("gif", [[220, 30, 30], [30, 30, 220]], [400, 200]) });
    await expect(mine).toHaveCount(2);
    const gif = await madeAfter(had);
    expect([gif.type, gif.pages, gif.delays]).toEqual(["image/webp", 2, [400, 200]]);
    expect(gif.pictures.map((picture) => colourAt(picture, 96, 96))).toEqual(["red", "blue"]);

    had = await ids();
    await file.setInputFiles({ name: "still.gif", mimeType: "image/gif", buffer: await movingFile("gif", [[30, 200, 30], [30, 200, 30]], [300, 300]) });
    await expect(mine).toHaveCount(3);
    await expect(sheet.getByTestId("chat-sticker-problem")).toHaveCount(0);
    const still = await madeAfter(had);
    expect([still.type, still.pages, colourAt(still.pictures[0]!, 96, 96)]).toEqual(["image/png", 1, "green"]);
  });

  test("in the Android app with stickers that move on: WhatsApp GIFs opens the chooser in WhatsApp's GIFs folder, and a short video (as WhatsApp keeps a GIF) is made a sticker that moves; with the host's moving off there is no such button, and a picture that moves is made its first picture", async ({ browser }) => {
    test.setTimeout(240_000);
    const { ann } = await twoFriends(browser);
    const sheet = ann.page.getByTestId("chat-panel");
    const mine = sheet.getByTestId("chat-sticker-mine");
    const gifs = sheet.getByTestId("chat-sticker-whatsapp-gifs");
    const file = ann.page.getByTestId("chat-sticker-file");

    await openChat(ann.page);
    await openPanel(ann.page, "stickers");
    await expect(sheet.getByTestId("chat-sticker-add")).toBeVisible();
    await expect(gifs).toHaveCount(0);

    await ann.page.context().addInitScript(() => {
      const folders: string[] = [];
      const app: Record<string, unknown> = {
        onmessage: null,
        postMessage(text: string) {
          const said = JSON.parse(text) as { call: string; folder?: string };
          const answer = (message: object) => setTimeout(() => (app.onmessage as ((event: { data: string }) => void) | null)?.({ data: JSON.stringify(message) }), 5);
          if (said.call === "hello") answer({ kind: "hello", version: "0.2.0", folders: ["whatsapp-stickers", "whatsapp-gifs"], notify: false, token: "" });
          if (said.call === "pickFrom") {
            folders.push(said.folder ?? "");
            answer({ kind: "picking", folder: said.folder, known: true });
          }
        },
      };
      Object.assign(window, { KinoApp: app, e2eFolders: folders });
    });
    await ann.page.reload();
    await openChat(ann.page);
    await openPanel(ann.page, "stickers");
    await expect(gifs).toContainText(en["chat.stickerWhatsAppGifs"]);
    await expect(sheet.getByTestId("chat-sticker-whatsapp")).toBeVisible();
    expect(await gridFaults(sheet.locator('[data-testid="chat-sticker-add"], [data-testid="chat-sticker-whatsapp"], [data-testid="chat-sticker-whatsapp-gifs"], [data-testid="chat-sticker-pick"]')), "the three buttons are squares of the grid").toEqual([]);

    const video = await ann.page.evaluate(async () => {
      const canvas = Object.assign(document.createElement("canvas"), { width: 160, height: 120 });
      const context = canvas.getContext("2d")!;
      const paint = (colour: string) => {
        context.fillStyle = colour;
        context.fillRect(0, 0, 160, 120);
      };
      paint("rgb(220, 30, 30)");
      const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: "video/webm;codecs=vp8" });
      const parts: Blob[] = [];
      recorder.ondataavailable = (event) => parts.push(event.data);
      const stopped = new Promise((done) => (recorder.onstop = done));
      recorder.start();
      const began = performance.now();
      await new Promise<void>((done) => {
        const timer = setInterval(() => {
          const past = performance.now() - began;
          paint(past < 700 ? "rgb(220, 30, 30)" : "rgb(30, 30, 220)");
          if (past > 1400) {
            clearInterval(timer);
            done();
          }
        }, 40);
      });
      recorder.stop();
      await stopped;
      return [...new Uint8Array(await new Blob(parts).arrayBuffer())];
    });
    const [chooser] = await Promise.all([ann.page.waitForEvent("filechooser"), gifs.click()]);
    expect(await ann.page.evaluate(() => (window as unknown as { e2eFolders: string[] }).e2eFolders), "the app was asked for WhatsApp's GIFs folder").toEqual(["whatsapp-gifs"]);
    await expect(file, "the chooser offers videos and GIFs").toHaveAttribute("accept", "video/mp4,image/gif");
    await chooser.setFiles({ name: "VID-20261117-WA0001.webm", mimeType: "video/webm", buffer: Buffer.from(video) });
    await expect(mine).toHaveCount(1, { timeout: 30_000 });
    await expect(sheet.getByTestId("chat-sticker-problem")).toHaveCount(0);
    const made = await movingAt(ann.page, (await mine.locator("img").getAttribute("src"))!);
    expect(made.type).toBe("image/webp");
    expect(made.pages).toBeGreaterThanOrEqual(2);
    expect([...new Set(made.pictures.map((picture) => colourAt(picture, 96, 96)))].sort(), "red, then blue").toEqual(["blue", "red"]);
    expect(colourAt(made.pictures[0]!, 96, 96)).toBe("red");
    expect(
      made.pictures.every((picture) => seeThrough(picture, 96, 5) && seeThrough(picture, 96, 186) && !seeThrough(picture, 96, 96)),
      "fitted whole: the strips above and below a video wider than high are see-through",
    ).toBe(true);
    const shown = made.delays.reduce((all, delay) => all + delay, 0);
    expect(shown, "as long as the video, about").toBeGreaterThan(900);
    expect(shown).toBeLessThanOrEqual(2000);

    const [plain] = await Promise.all([ann.page.waitForEvent("filechooser"), sheet.getByTestId("chat-sticker-add").click()]);
    await expect(file).toHaveAttribute("accept", "image/*");
    await plain.setFiles({ name: "wide.png", mimeType: "image/png", buffer: widePicture() });
    await expect(mine).toHaveCount(2);

    await ann.page.route("**/api/features", async (route) => {
      const answer = await route.fetch();
      const { movingStickers: _on, ...features } = (await answer.json()) as Record<string, unknown>;
      await route.fulfill({ response: answer, json: features });
    });
    await ann.page.reload();
    await openChat(ann.page);
    await openPanel(ann.page, "stickers");
    await expect(sheet.getByTestId("chat-sticker-whatsapp")).toBeVisible();
    await expect(gifs).toHaveCount(0);
    const had = await mine.evaluateAll((all) => all.map((each) => each.getAttribute("data-personal")!));
    await file.setInputFiles({ name: "moving.webp", mimeType: "image/webp", buffer: await movingFile("webp", [[220, 30, 30], [30, 30, 220]], [200, 200]) });
    await expect(mine).toHaveCount(3);
    const id = (await mine.evaluateAll((all) => all.map((each) => each.getAttribute("data-personal")!))).find((each) => !had.includes(each))!;
    const first = await movingAt(ann.page, (await sheet.locator(`[data-personal="${id}"] img`).getAttribute("src"))!);
    expect([first.type, first.pages, colourAt(first.pictures[0]!, 96, 96)]).toEqual(["image/png", 1, "red"]);
  });

  test("in a chat that stays open: a picture that did not come for a moment is asked for again, not called gone; a friend's can still be saved once they take no messages; one the team takes down goes within five minutes (the judge, 17 Nov)", async ({ browser }) => {
    test.setTimeout(240_000);
    const ann = await phoneWithFriends(browser, "Ann");
    const account = fresh("Bob");
    const page = await openDevice(browser, PHONE, {}, async (context) => context.clock.install());
    await page.goto("/");
    await signUp(page, account);
    await turnOnFriends(page);
    const bob = { page, account, name: nameOf(account) };
    await befriend(ann.page, bob.page);
    const made = await ann.page.request.post(`/api/profiles/${await profileOf(ann.page)}/stickers`, { data: { data: stickerSquare() } });
    expect(made.status()).toBe(201);
    const id = ((await made.json()) as { id: string }).id;
    expect((await ann.page.request.post(`${await chatAddress(ann.page, bob.page)}/sticker`, { data: { id } })).status()).toBe(201);

    let late = () => {};
    const lateGate = new Promise<void>((resolve) => (late = resolve));
    let delivered: Promise<void> | undefined;
    const collection = /\/api\/profiles\/[^/]+\/stickers$/;
    await bob.page.route(collection, async (route) => {
      if (route.request().method() !== "GET" || delivered) return route.continue();
      delivered = (async () => {
        const answer = await route.fetch();
        await lateGate;
        await route.fulfill({ response: answer });
      })();
      await delivered;
    });

    let failing = 2;
    const pictures = /\/chat\/stickers\//;
    await bob.page.route(pictures, (route) => (failing-- > 0 ? route.abort("connectionreset") : route.continue()));
    await openChat(bob.page);
    await expect(bob.page.getByTestId("chat-personal-waiting")).toBeVisible();
    await expect(bob.page.getByTestId("chat-personal-gone")).toHaveCount(0);
    await bob.page.clock.fastForward(6_000);
    const theirs = lines(bob.page).first().getByTestId("chat-personal-sticker");
    await expect.poll(() => stickerLoaded(theirs)).toBe(192);
    await bob.page.unroute(pictures);

    await chose(ann.page, { friendsMessages: false });
    await expect(bob.page.getByTestId("chat-closed")).toBeVisible(SOON);
    await expect.poll(() => delivered !== undefined, { message: "Bob's page asked for his stickers" }).toBe(true);
    await lines(bob.page).first().getByTestId("chat-bubble").press("Enter");
    await expect(bob.page.getByTestId("chat-react-bar")).toHaveCount(0);
    await bob.page.getByTestId("chat-sticker-save").click();
    await expect(bob.page.getByTestId("chat-sticker-note")).toHaveText(en["chat.stickerSavedNote"]);
    late();
    await delivered;
    await bob.page.unroute(collection);
    await lines(bob.page).first().getByTestId("chat-bubble").press("Enter");
    await expect(bob.page.getByTestId("chat-sticker-save")).toBeDisabled();
    await expect(bob.page.getByTestId("chat-sticker-save")).toHaveText(en["chat.stickerSaved"]);
    await lines(bob.page).first().getByTestId("chat-bubble").press("Enter");
    await expect(bob.page.getByTestId("chat-sticker-save")).toHaveCount(0);

    expect((await bob.page.request.delete(`/api/admin/stickers/${id}`, { headers: AUTH })).status()).toBe(200);
    await expect(theirs).toBeVisible();
    await bob.page.clock.fastForward(5 * 60_000 + 31_000);
    await expect(bob.page.getByTestId("chat-personal-gone")).toHaveText(en["chat.stickerGone"], SOON);
    await expect(bob.page.getByTestId("chat-personal-sticker")).toHaveCount(0);
  });

  test("a host that did not answer whether they are on is asked again while the stickers stay open: a moment's lost network does not leave them off (the judge, 17 Nov)", async ({ browser }) => {
    test.setTimeout(180_000);
    const account = fresh("Ann");
    const page = await openDevice(browser, PHONE, {}, async (context) => context.clock.install());
    let down = true;
    await page.route("**/api/features", (route) => (down ? route.abort("connectionreset") : route.continue()));
    await page.goto("/");
    await signUp(page, account);
    await turnOnFriends(page);
    const bob = await phoneWithFriends(browser, "Bob");
    await befriend(page, bob.page);
    await openChat(page);
    const sheet = await openPanel(page, "stickers");
    await expect(sheet.getByTestId("chat-sticker-pick")).toHaveCount(STICKER_COUNT);
    await expect(sheet.getByTestId("chat-stickers-yours")).toHaveCount(0);
    down = false;
    await page.clock.fastForward(61_000);
    await expect(sheet.getByTestId("chat-stickers-yours")).toBeVisible(SOON);
  });

  test("on a TV that is only a remote: none of its own shows nothing of them; the profile's own come first, with nothing to add or edit there, the list scrolls to what the remote is on, and OK sends one, which the friend's phone sees", async ({ browser }) => {
    test.setTimeout(240_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await phoneWithFriends(browser, "Bob");
    await meetPhone(ann, bob);
    await tile(ann.page, bob.name).click();
    await ann.page.getByTestId("friend-chat").click();
    await ann.page.getByTestId("tv-chat-panel-btn").click();
    await expect(ann.page.getByTestId("chat-sticker-pick").first()).toBeFocused();
    await expect(ann.page.getByTestId("chat-stickers-yours")).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-chat-panel").locator("h2")).toHaveCount(0);
    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("tv-chat-panel")).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();

    const profile = await profileOf(ann.page);
    const made = await ann.page.request.post(`/api/profiles/${profile}/stickers`, { data: { data: stickerSquare() } });
    expect(made.status()).toBe(201);
    const id = ((await made.json()) as { id: string }).id;
    await ann.page.getByTestId("tv-chat-write").focus();
    await ann.page.keyboard.press("ArrowLeft");
    await expect(ann.page.getByTestId("tv-chat-panel-btn")).toBeFocused();
    await ann.page.keyboard.press("Enter");
    const page = ann.page.getByTestId("tv-chat-panel");
    await expect(page).toBeVisible();
    const mine = page.getByTestId("chat-sticker-mine");
    await expect(mine).toHaveCount(1);
    await expect(mine).toHaveAttribute("data-personal", id);
    await expect(page.getByTestId("chat-sticker-add")).toHaveCount(0);
    await expect(page.getByTestId("chat-stickers-edit")).toHaveCount(0);
    await expect(page.getByTestId("chat-sticker-file")).toHaveCount(0);
    const picks = page.getByTestId("chat-sticker-pick");
    await expect(picks.first()).toBeFocused();
    for (let row = 1; row <= 3; row++) await ann.page.keyboard.press("ArrowDown");
    await expect(picks.nth(21)).toBeFocused();
    await expect(picks.nth(21)).toBeInViewport({ ratio: 0.9 });
    for (let row = 1; row <= 4; row++) await ann.page.keyboard.press("ArrowUp");
    await expect(mine).toBeFocused();
    await expect(mine).toBeInViewport({ ratio: 0.9 });
    await expect.poll(() => stickerLoaded(mine.locator("img"))).toBe(192);
    expect(await outsideTheScreen(ann.page, "chat-stickers-yours")).toEqual([]);
    await expect(ann.page.getByTestId("tv-chat-panel-btn")).toBeInViewport();
    await ann.page.keyboard.press("Enter");
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await expect(tvLines(ann.page)).toHaveCount(1);
    await expect.poll(() => stickerLoaded(tvLines(ann.page).first().getByTestId("chat-personal-sticker"))).toBe(192);
    await expect(ann.page.getByTestId("chat-sticker-save")).toHaveCount(0);

    await openChat(bob.page);
    await expect.poll(() => stickerLoaded(lines(bob.page).first().getByTestId("chat-personal-sticker"))).toBe(192);
  });
});

const KLIPY_TEST_KEY = "TestKey_0123456789";
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const gifAddress = (id: string) => `https://static.klipy.com/ii/test/${id}-sm.webp`;
const GONE_GIF = "https://static.klipy.com/ii/gone/x-sm.webp";
const klipyEntry = (id: string) => ({
  id,
  slug: `gif-${id}`,
  title: `Gif ${id}`,
  type: "gif",
  file: { sm: { webp: { url: gifAddress(id), width: 220, height: 160, size: 900 } }, xs: { webp: { url: `https://static.klipy.com/ii/test/${id}-xs.webp`, width: 90, height: 65, size: 300 } } },
});

async function fakeKlipy(page: Page, { key = true } = {}): Promise<URL[]> {
  const asked: URL[] = [];
  if (key) await page.route("**/api/features", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ gifs: KLIPY_TEST_KEY }) }));
  await page.route(/^https:\/\/api\.klipy\.com\//, async (route) => {
    const address = new URL(route.request().url());
    asked.push(address);
    const words = address.searchParams.get("q") ?? "";
    const at = Number(address.searchParams.get("page") ?? "1");
    const ids = words === "" ? (at === 1 ? ["t1", "t2", "t3"] : ["t4", "t5"]) : words === "cat" ? ["c1"] : words === "many" ? Array.from({ length: 24 }, (_, n) => `m${(at - 1) * 24 + n + 1}`) : [];
    await route.fulfill({
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ result: true, data: { data: ids.map(klipyEntry), current_page: at, per_page: 24, has_next: (words === "" || words === "many") && at === 1 } }),
    });
  });
  await page.route(/^https:\/\/static\d?\.klipy\.com\//, (route) => (route.request().url().includes("/gone/") ? route.fulfill({ status: 404, body: "" }) : route.fulfill({ contentType: "image/gif", body: PIXEL })));
  return asked;
}

const srcs = (pictures: ReturnType<Page["getByTestId"]>) => pictures.locator("img").evaluateAll((all) => all.map((picture) => (picture as HTMLImageElement).src));

const gridFaults = (pictures: ReturnType<Page["getByTestId"]>) =>
  pictures.evaluateAll((all) => {
    const boxes = all.map((each) => each.getBoundingClientRect());
    const faults: string[] = [];
    boxes.forEach((box, at) => {
      if (Math.abs(box.width - box.height) > 1.5) faults.push(`${at} is ${Math.round(box.width)}x${Math.round(box.height)}`);
      boxes.slice(at + 1).forEach((other, past) => {
        if (box.left < other.right - 1 && other.left < box.right - 1 && box.top < other.bottom - 1 && other.top < box.bottom - 1) faults.push(`${at} lies over ${at + 1 + past}`);
      });
    });
    return faults;
  });

test.describe("GIFs in a chat", () => {
  test("on the phone: the panel's GIFs are KLIPY's Trending in its order, more of it, a search once typing stops; a press sends one, and the friend sees the picture (one KLIPY took away says so), with no GIFs where the site has no key", async ({ browser }) => {
    test.setTimeout(150_000);
    const { ann, bob } = await twoFriends(browser);
    const asked = await fakeKlipy(ann.page);
    await fakeKlipy(bob.page, { key: false });
    await openChat(ann.page);
    await ann.page.getByTestId("chat-panel-btn").click();
    const sheet = ann.page.getByTestId("chat-panel");
    await expect(sheet).toHaveAttribute("data-tab", "stickers");
    await expect(sheet.locator("[role='tab'][data-tab='gifs']")).toBeVisible();
    expect(asked, "nothing is asked of KLIPY before its tab is shown").toHaveLength(0);

    await openPanel(ann.page, "gifs");
    await expect(sheet).toBeVisible();
    await expect(ann.page.getByTestId("chat-gif-search")).toHaveAttribute("placeholder", "Search KLIPY");
    await expect(ann.page.getByTestId("chat-gif-powered")).toHaveText("Powered by KLIPY");
    const picks = ann.page.getByTestId("chat-gif-pick");
    await expect(picks).toHaveCount(3);
    expect(await srcs(picks)).toEqual(["t1", "t2", "t3"].map(gifAddress));
    await ann.page.getByTestId("chat-gif-more").click();
    await expect(picks).toHaveCount(5);
    expect(await srcs(picks)).toEqual(["t1", "t2", "t3", "t4", "t5"].map(gifAddress));
    await expect(ann.page.getByTestId("chat-gif-more")).toHaveCount(0);

    await ann.page.getByTestId("chat-gif-search").pressSequentially("cat", { delay: 60 });
    await expect(picks).toHaveCount(1);
    expect(await srcs(picks)).toEqual([gifAddress("c1")]);
    expect(asked.filter((address) => address.pathname.endsWith("/search"))).toHaveLength(1);
    await ann.page.getByTestId("chat-gif-search").fill("many");
    await expect(picks).toHaveCount(24);
    expect(await gridFaults(picks), "a full page of GIFs: squares, none over another").toEqual([]);
    await ann.page.getByTestId("chat-gif-search").fill("zzz");
    await expect(ann.page.getByTestId("chat-gif-none")).toHaveText(say(en["chat.gifNone"], { query: "zzz" }));
    await ann.page.getByTestId("chat-gif-search").fill("");
    await expect(picks).toHaveCount(3);
    const profile = (await profileOf(ann.page))!;
    expect(new Set(asked.map((address) => address.searchParams.get("customer_id"))).size).toBe(1);
    for (const address of asked) {
      expect(address.pathname.startsWith(`/api/v1/${KLIPY_TEST_KEY}/gifs/`), address.pathname).toBe(true);
      expect(address.searchParams.get("content_filter")).toBe("medium");
      expect(address.searchParams.get("per_page")).toBe("24");
      expect(address.toString()).not.toContain(profile);
    }

    await ann.page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(ann.page.getByTestId("chat")).toBeVisible();
    await expect(lines(ann.page)).toHaveCount(0);

    await ann.page.getByTestId("chat-panel-btn").click();
    await expect(sheet).toHaveAttribute("data-tab", "gifs");
    await expect(picks).toHaveCount(3);
    await picks.nth(1).click();
    await expect(sheet).toHaveCount(0);
    await expect(lines(ann.page)).toHaveCount(1);
    const mine = lines(ann.page).first().getByTestId("chat-gif");
    await expect(mine).toHaveAttribute("src", gifAddress("t2"));
    await expect.poll(() => mine.evaluate((picture) => (picture as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

    await openChat(bob.page);
    await expect(lines(bob.page).first().getByTestId("chat-gif")).toHaveAttribute("src", gifAddress("t2"));
    await bob.page.getByTestId("chat-panel-btn").click();
    await expect(bob.page.getByTestId("chat-panel-tab")).toHaveCount(2);
    await expect(bob.page.locator("[role='tab'][data-tab='gifs']")).toHaveCount(0);
    await bob.page.keyboard.press("Escape");
    await write(ann.page, GONE_GIF);
    await expect(lines(bob.page)).toHaveCount(2, SOON);
    await expect(lines(bob.page).nth(1).getByTestId("chat-gif-gone")).toHaveText(en["chat.gifGone"]);
    await write(ann.page, `look ${gifAddress("t3")}`);
    await expect(lines(bob.page)).toHaveCount(3, SOON);
    await expect(lines(bob.page).nth(2).getByTestId("chat-text")).toHaveText(`look ${gifAddress("t3")}`);
    await expect(lines(bob.page).nth(2).getByTestId("chat-gif")).toHaveCount(0);
  });

  test("on a hand-held screen showing the TV's pages: the panel's GIFs under the bar, a press sends one and the panel goes, all on the narrowest screen; a TV with only a remote has no GIFs tab, and shows the picture", async ({ browser }) => {
    test.setTimeout(180_000);
    const ann = await screenWithFriends(browser, "Ann", { viewport: { width: 320, height: 640 } });
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    await fakeKlipy(ann.page);
    await fakeKlipy(bob.page);
    await tile(ann.page, bob.name).click();
    await ann.page.getByTestId("friend-chat").click();
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    const button = ann.page.getByTestId("tv-chat-panel-btn");
    await expect(button).toBeVisible();
    expect(await outsideTheScreen(ann.page, "tv-chat", false)).toEqual([]);
    const box = await where(ann.page.getByTestId("tv-chat-box"));
    expect(box.width, "the box has the bar, but for the one button").toBeGreaterThan(170);

    const panel = await openPanel(ann.page, "gifs", "tv-chat");
    await expect(ann.page.getByTestId("tv-chat-gif-search")).toHaveAttribute("placeholder", "Search KLIPY");
    await expect(ann.page.getByTestId("tv-chat-gif-search")).not.toBeFocused();
    await expect(ann.page.getByTestId("chat-gif-pick")).toHaveCount(3);
    await expect(ann.page.getByTestId("tv-chat-gif-powered")).toHaveText("Powered by KLIPY");
    expect(await outsideTheScreen(ann.page, "tv-chat", false)).toEqual([]);
    await expect(ann.page.getByTestId("tv-chat-box"), "the bar stays over the panel").toBeInViewport();
    await expect(button).toHaveAttribute("aria-label", en["chat.panel"]);
    const picks = ann.page.getByTestId("chat-gif-pick");
    await ann.page.getByTestId("tv-chat-gif-search").fill("many");
    await expect(picks).toHaveCount(24);
    expect(await gridFaults(picks), "a full page of GIFs: squares, none over another").toEqual([]);
    await ann.page.getByTestId("tv-chat-gif-more").click();
    await expect(picks).toHaveCount(48);
    expect(await gridFaults(picks), "two pages of GIFs: squares, none over another").toEqual([]);
    const list = ann.page.getByTestId("tv-chat-gif-list");
    expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight + 100), "the list scrolls").toBe(true);
    const search = await where(ann.page.getByTestId("tv-chat-gif-search"));
    const powered = await where(ann.page.getByTestId("tv-chat-gif-powered"));
    expect((await where(picks.first())).width, "three or so to a row").toBeGreaterThan(70);
    await picks.last().scrollIntoViewIfNeeded();
    await expect(picks.last()).toBeInViewport();
    expect(await where(ann.page.getByTestId("tv-chat-gif-search")), "the search stays where it was").toEqual(search);
    expect(await where(ann.page.getByTestId("tv-chat-gif-powered")), "KLIPY's line stays where it was").toEqual(powered);
    expect(powered.y + powered.height, "KLIPY's line is on the screen").toBeLessThanOrEqual(640);
    expect(await outsideTheScreen(ann.page, "tv-chat", false)).toEqual([]);
    await button.click();
    await expect(panel).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-chat-box")).toBeFocused();
    await button.click();
    await expect(panel).toHaveAttribute("data-tab", "gifs");
    await expect(ann.page.getByTestId("tv-chat-box"), "the keyboard went down: the panel is in its place").not.toBeFocused();
    await expect(picks).toHaveCount(3);
    await ann.page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await expect(tvLines(ann.page)).toHaveCount(0);
    await button.click();
    await ann.page.getByTestId("chat-gif-pick").first().click();
    await expect(panel).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await expect(tvLines(ann.page).first().getByTestId("chat-gif")).toHaveAttribute("src", gifAddress("t1"));

    await look(bob.page);
    await tile(bob.page, ann.name).click();
    await bob.page.getByTestId("friend-chat").click();
    await expect(tvLines(bob.page).first().getByTestId("chat-gif")).toHaveAttribute("src", gifAddress("t1"));
    await expect.poll(() => tvLines(bob.page).first().getByTestId("chat-gif").evaluate((picture) => (picture as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await bob.page.getByTestId("tv-chat-panel-btn").click();
    await expect(bob.page.getByTestId("tv-chat-panel-tab"), "a TV that is only a remote: Titles and Stickers").toHaveCount(2);
    await expect(bob.page.locator("[role='tab'][data-tab='gifs']")).toHaveCount(0);
    await bob.page.keyboard.press("Escape");
    await expect(bob.page.getByTestId("tv-chat-panel")).toHaveCount(0);

    const sent = tvLines(ann.page).first().getByTestId("chat-bubble");
    const view = ann.page.getByTestId("chat-view");
    const take = ann.page.getByTestId("chat-takeback");
    await expect.poll(() => tvLines(ann.page).first().getByTestId("chat-gif").evaluate((picture) => (picture as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const small = await where(tvLines(ann.page).first().getByTestId("chat-gif"));
    await sent.click();
    await expect(view).toBeVisible();
    await expect(take).toHaveCount(0);
    const larger = await where(ann.page.getByTestId("chat-view-picture"));
    expect(larger.width, "larger than in the chat").toBeGreaterThan(small.width * 1.3);
    expect(larger.x >= 0 && larger.x + larger.width <= 320 && larger.y >= 0 && larger.y + larger.height <= 640, "inside the screen").toBe(true);
    await ann.page.keyboard.press("Escape");
    await expect(view).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await sent.click({ delay: 650 });
    await expect(take).toBeVisible();
    await expect(view, "the press that ended the hold is not one more press").toHaveCount(0);
    await expect(ann.page.getByTestId("chat-react-bar")).toBeVisible();
    const head = await where(ann.page.locator(".tv-chat-head"));
    const at = await where(take);
    expect(at.y >= head.y && at.y + at.height <= head.y + head.height, "Take back is in the top of the chat").toBe(true);
    expect(at.x + at.width, "beside the ⋯").toBeLessThanOrEqual((await where(ann.page.getByTestId("tv-chat-more"))).x + 1);
    expect(at.width, "big enough for a finger").toBeGreaterThanOrEqual(40);
    expect(await outsideTheScreen(ann.page, "tv-chat", false), "the chat with a message selected").toEqual([]);
    await ann.page.keyboard.press("Escape");
    await expect(take).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await ann.page.getByTestId("tv-chat-box").click();
    await ann.page.keyboard.type("Ready?");
    await ann.page.keyboard.press("Enter");
    await expect(tvLines(ann.page)).toHaveCount(2);
    const newest = tvLines(ann.page).nth(1).getByTestId("chat-bubble");
    await newest.click({ delay: 650 });
    await expect(take).toBeVisible();
    await expect(newest).toHaveAttribute("aria-expanded", "true");
    await ann.page.keyboard.press("Escape");
    await expect(take).toHaveCount(0);
    const cdp = await ann.page.context().newCDPSession(ann.page);
    const spot = await where(newest);
    const finger = { x: Math.round(spot.x + spot.width / 2), y: Math.round(spot.y + spot.height / 2) };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [finger] });
    await ann.page.waitForTimeout(650);
    await expect(newest).toHaveAttribute("aria-expanded", "true");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await ann.page.waitForTimeout(400);
    await expect(newest, "still selected").toHaveAttribute("aria-expanded", "true");
    await expect(ann.page.getByTestId("chat-reaction"), "no reaction put on by the finger's lifting").toHaveCount(0);
    await expect(view).toHaveCount(0);
    await ann.page.keyboard.press("Escape");
    await expect(take).toHaveCount(0);
    await sent.click({ delay: 650 });
    await take.click();
    await expect(tvLines(ann.page)).toHaveCount(1);
    await expect(tvLines(ann.page).first().getByTestId("chat-gif")).toHaveCount(0);
    await expect(take).toHaveCount(0);
    await expect(tvLines(bob.page)).toHaveCount(1, SOON);
    await expect(tvLines(bob.page).first().getByTestId("chat-gif")).toHaveCount(0);
  });
});

const seen = (line: ReturnType<Page["getByTestId"]>) =>
  line.evaluate((element) => {
    const list = element.closest(".chat-lines")!.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return box.bottom > list.top + 4 && box.top < list.bottom - 4;
  });
const saying = (all: ReturnType<Page["getByTestId"]>, words: string) => all.filter({ has: all.page().getByTestId("chat-text").filter({ hasText: words }) });
const counted = (at: number, count: number) => say(en["chat.searchCount"], { at: String(at), count: String(count) });
async function chatter(first: Page, second: Page, from: number, to: number) {
  for (let at = from; at <= to; at++) await writes(at % 2 ? first : second, at % 2 ? second : first, `filler ${at}`);
}

test.describe("searching a chat, and its GIFs and stickers", () => {
  test("on the phone: Search behind the ⋮ finds every word typed however it was written, the newest first; Enter, Earlier and Later go through what it found, each brought into view and lit, its words marked; Back shuts a picture shown larger and a selection first, then the search", async ({ browser }) => {
    test.setTimeout(180_000);
    const { ann, bob } = await twoFriends(browser);
    await writes(bob.page, ann.page, "Ne vedem mâine la cinema");
    await writes(ann.page, bob.page, "Mâine nu pot");
    await chatter(bob.page, ann.page, 1, 16);
    await writes(bob.page, ann.page, "Poate MAINE seara la Cinema City");
    await writes(bob.page, ann.page, "\u{1F37F}");
    await chatter(bob.page, ann.page, 17, 22);
    await openChat(ann.page);
    await expect(lines(ann.page)).toHaveCount(26);

    const page = ann.page;
    await page.getByTestId("chat-more").click();
    await expect(page.getByTestId("chat-menu")).toBeVisible();
    await page.getByTestId("chat-presence").dispatchEvent("pointerdown");
    await expect(page.getByTestId("chat-menu")).toBeHidden();
    await fromMenu(page, "chat-search-open");
    const bar = page.getByTestId("chat-search");
    const box = page.getByTestId("chat-search-box");
    const count = page.getByTestId("chat-search-count");
    const found = page.locator('[data-testid="chat-line"][data-found]');
    const current = page.locator('[data-testid="chat-line"][data-found="current"]');
    await expect(bar).toBeVisible();
    await expect(box).toBeFocused();
    await expect(page.getByTestId("chat-more")).toHaveCount(0);
    expect(await outsideTheSides(page, ["chat-search", "chat-search-older", "chat-search-newer", "chat-search-close"])).toEqual([]);

    await box.fill("maine");
    await expect(count).toHaveText(counted(1, 3));
    await expect(found).toHaveCount(3);
    await expect(current).toContainText("Poate MAINE seara");
    await expect(current.getByTestId("chat-found-words")).toHaveText("MAINE");
    await expect.poll(() => seen(current)).toBe(true);
    await box.press("Enter");
    await expect(count).toHaveText(counted(2, 3));
    await expect(current).toContainText("Mâine nu pot");
    await expect(current.getByTestId("chat-found-words")).toHaveText("Mâine");
    await expect.poll(() => seen(current)).toBe(true);
    await writes(bob.page, ann.page, "Si maine?");
    await expect(count).toHaveText(counted(3, 4), SOON);
    await expect(current).toContainText("Mâine nu pot");
    const older = page.getByTestId("chat-search-older");
    await older.focus();
    await page.keyboard.press("Enter");
    await expect(count).toHaveText(counted(4, 4));
    await expect(current).toContainText("Ne vedem mâine la cinema");
    await expect.poll(() => seen(current)).toBe(true);
    await expect(older).toHaveAttribute("aria-disabled", "true");
    await expect(older).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(count).toHaveText(counted(4, 4));
    await expect.poll(() => seen(saying(lines(page), "filler 22"))).toBe(false);
    await expect.poll(() => seen(saying(lines(page), "Si maine?"))).toBe(false);
    await page.getByTestId("chat-search-newer").click();
    await expect(count).toHaveText(counted(3, 4));
    await box.press("Shift+Enter");
    await expect(count).toHaveText(counted(2, 4));
    await box.press("Shift+Enter");
    await expect(count).toHaveText(counted(1, 4));
    await expect(current).toContainText("Si maine?");
    await expect(page.getByTestId("chat-search-newer")).toHaveAttribute("aria-disabled", "true");
    await box.fill("cinema   MÂINE");
    await expect(count).toHaveText(counted(1, 2));
    await expect(found).toHaveCount(2);
    await box.fill("teatru");
    await expect(count).toHaveText(en["chat.searchNone"]);
    await expect(found).toHaveCount(0);
    await expect(older).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("chat-search-newer")).toHaveAttribute("aria-disabled", "true");

    await box.fill("cinema");
    await expect(found).toHaveCount(2);
    await lines(page).filter({ has: page.getByTestId("chat-sticker") }).getByTestId("chat-bubble").click();
    await expect(page.getByTestId("chat-view")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("chat-view")).toHaveCount(0);
    await expect(bar).toBeVisible();
    await expect(found).toHaveCount(2);
    await saying(lines(page), "Mâine nu pot").getByTestId("chat-bubble").click();
    await expect(page.getByTestId("chat-react-bar")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("chat-react-bar")).toHaveCount(0);
    await expect(bar).toBeVisible();
    await saying(lines(page), "Mâine nu pot").getByTestId("chat-bubble").click();
    await page.getByTestId("chat-reply").click();
    await expect(page.getByTestId("chat-reply-strip")).toBeVisible();
    await expect(page.getByTestId("chat-input")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("chat-reply-strip")).toHaveCount(0);
    await expect(bar).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(bar).toHaveCount(0);
    await expect(page.getByTestId("chat")).toBeVisible();
    await expect(found).toHaveCount(0);
    await expect(page.getByTestId("chat-found-words")).toHaveCount(0);
    await expect(page.getByTestId("chat-more")).toBeVisible();
    await fromMenu(page, "chat-search-open");
    await expect(box).toHaveValue("");
    await expect(count).toHaveCount(0);
    await box.fill("pizza");
    await page.getByTestId("chat-search-close").click();
    await expect(bar).toHaveCount(0);
    await expect(page.getByTestId("chat")).toBeVisible();
  });

  test("on the phone: the chat's GIFs and stickers behind the ⋮, the newest first; a press shows its message in the chat, lit and not selected; none says so", async ({ browser }) => {
    test.setTimeout(150_000);
    const { ann, bob } = await twoFriends(browser);
    await fakeKlipy(ann.page, { key: false });
    await openChat(ann.page);
    const sheet = ann.page.getByTestId("chat-media-sheet");
    await fromMenu(ann.page, "chat-media-open");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(say(en["chat.mediaTitle"], { name: bob.name }));
    await expect(sheet.getByTestId("chat-media-none")).toHaveText(en["chat.mediaNone"]);
    await ann.page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(ann.page.getByTestId("chat")).toBeVisible();

    await writes(bob.page, ann.page, "https://static.klipy.com/ii/test/cat.gif");
    await writes(ann.page, bob.page, "\u{1F37F}");
    await chatter(bob.page, ann.page, 1, 20);
    await writes(bob.page, ann.page, "\u{1F3AC}");
    await expect(lines(ann.page)).toHaveCount(23, SOON);
    await fromMenu(ann.page, "chat-media-open");
    const tiles = sheet.getByTestId("chat-media-tile");
    await expect(tiles).toHaveCount(3);
    expect(await tiles.evaluateAll((all) => all.map((each) => each.getAttribute("data-kind")))).toEqual(["sticker", "sticker", "gif"]);
    await expect(tiles.nth(0)).toHaveAttribute("aria-label", new RegExp(bob.name));
    await expect(tiles.nth(1)).not.toHaveAttribute("aria-label", new RegExp(bob.name));
    for (const at of [0, 1, 2]) await expect.poll(() => tiles.nth(at).locator("img").evaluate((picture) => (picture as HTMLImageElement).complete && (picture as HTMLImageElement).naturalWidth > 0)).toBe(true);
    expect(await gridFaults(tiles)).toEqual([]);
    expect(await outsideTheSides(ann.page, ["chat-media-sheet", "chat-media"])).toEqual([]);

    await tiles.first().click();
    await expect(sheet).toHaveCount(0);
    await expect(lines(ann.page).last()).toHaveAttribute("data-shown", "true");
    await writes(bob.page, ann.page, "After the gallery");
    await expect(lines(ann.page)).toHaveCount(24, SOON);
    await expect.poll(() => seen(lines(ann.page).last())).toBe(true);

    await fromMenu(ann.page, "chat-media-open");
    await tiles.nth(2).click();
    await expect(sheet).toHaveCount(0);
    const gif = lines(ann.page).first();
    await expect(gif).toHaveAttribute("data-shown", "true");
    await expect.poll(() => seen(gif)).toBe(true);
    await expect.poll(() => seen(lines(ann.page).last())).toBe(false);
    await expect(ann.page.getByTestId("chat-react-bar")).toHaveCount(0);
    await expect(ann.page.getByTestId("chat")).toBeVisible();
    await writes(bob.page, ann.page, "While you read");
    await expect(lines(ann.page)).toHaveCount(25, SOON);
    expect(await seen(gif)).toBe(true);
    await write(ann.page, "Sent from up here");
    await expect(lines(ann.page)).toHaveCount(26);
    await expect.poll(() => seen(lines(ann.page).last())).toBe(true);
  });

  test("on the TV's pages: Search and the GIFs and stickers behind the ⋯ on a computer and on a hand-held screen; the search in place of the friend at the top, Back shutting it and giving the keys back to the ⋯; the gallery a page of its own whose press shows the message", async ({ browser }) => {
    test.setTimeout(200_000);
    const ann = await screenWithFriends(browser, "Ann", { desk: true });
    const bob = await screenWithFriends(browser, "Bob", { viewport: { width: 390, height: 844 } });
    await meet(ann, bob);
    await writes(bob.page, ann.page, "Ne vedem mâine la cinema");
    await chatter(bob.page, ann.page, 1, 14);
    await writes(bob.page, ann.page, "\u{1F37F}");
    await writes(ann.page, bob.page, "Mâine?");

    const page = ann.page;
    await look(page);
    await tile(page, bob.name).click();
    await page.getByTestId("friend-chat").click();
    await expect(tvLines(page)).toHaveCount(17);
    await page.getByTestId("tv-chat-more").click();
    const menu = page.getByTestId("tv-chat-menu");
    expect(await menu.locator("button").evaluateAll((all) => all.map((each) => each.getAttribute("data-testid")))).toEqual(["tv-chat-reply-last", "tv-chat-react-last", "tv-chat-takeback", "tv-chat-search-open", "tv-chat-media-open", "tv-chat-mute", "tv-chat-report"]);
    await page.getByTestId("tv-chat-search-open").click();
    const bar = page.getByTestId("chat-search");
    const count = page.getByTestId("chat-search-count");
    const found = page.getByTestId("tv-chat-lines").locator('[data-testid="chat-line"][data-found]');
    const current = page.getByTestId("tv-chat-lines").locator('[data-testid="chat-line"][data-found="current"]');
    await expect(bar).toBeVisible();
    await expect(page.getByTestId("chat-search-box")).toBeFocused();
    await expect(page.getByTestId("tv-chat-name")).toHaveCount(0);
    await expect(page.getByTestId("tv-chat-more")).toHaveCount(0);
    await page.keyboard.type("maine");
    await expect(count).toHaveText(counted(1, 2));
    await expect(current).toContainText("Mâine?");
    await page.keyboard.press("Enter");
    await expect(count).toHaveText(counted(2, 2));
    await expect(current).toContainText("Ne vedem mâine la cinema");
    await expect(current.getByTestId("chat-found-words")).toHaveText("mâine");
    await expect.poll(() => seen(current)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(bar).toHaveCount(0);
    await expect(page.getByTestId("tv-chat")).toBeVisible();
    await expect(page.getByTestId("tv-chat-name")).toHaveText(bob.name);
    await expect(found).toHaveCount(0);
    await expect(page.getByTestId("tv-chat-more")).toBeFocused();
    await page.getByTestId("tv-chat-more").click();
    await page.getByTestId("tv-chat-search-open").click();
    await page.keyboard.type("cinema");
    await page.getByTestId("tv-chat-box").click();
    await page.keyboard.type("hi");
    await page.keyboard.press("Escape");
    await expect(bar).toHaveCount(0);
    await expect(page.getByTestId("tv-chat-box")).toBeFocused();
    await expect(page.getByTestId("tv-chat-box")).toHaveValue("hi");
    await page.getByTestId("tv-chat-box").fill("");
    await page.getByTestId("tv-chat-more").click();
    await expect(menu).toBeVisible();
    await page.getByTestId("tv-chat-name").dispatchEvent("pointerdown");
    await expect(menu).toBeHidden();

    await page.getByTestId("tv-chat-more").click();
    await page.getByTestId("tv-chat-media-open").click();
    const gallery = page.getByTestId("tv-chat-media");
    await expect(gallery).toBeVisible();
    await expect(gallery).toContainText(say(en["chat.mediaTitle"], { name: bob.name }));
    await expect(gallery.getByTestId("chat-media-tile")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(gallery).toHaveCount(0);
    await expect(page.getByTestId("tv-chat")).toBeVisible();
    await page.getByTestId("tv-chat-more").click();
    await page.getByTestId("tv-chat-media-open").click();
    await gallery.getByTestId("chat-media-tile").click();
    await expect(gallery).toHaveCount(0);
    const sticker = tvLines(page).filter({ has: page.getByTestId("chat-sticker") });
    await expect(sticker).toHaveAttribute("data-shown", "true");
    await expect.poll(() => seen(sticker)).toBe(true);
    await page.getByTestId("tv-chat-more").click();
    await page.getByTestId("tv-chat-report").click();
    await page.getByTestId("tv-chat-report-cancel").click();
    await expect(page.getByTestId("tv-chat")).toBeVisible();
    await expect(sticker).not.toHaveAttribute("data-shown", "true");

    const phone = bob.page;
    await look(phone);
    await tile(phone, ann.name).click();
    await phone.getByTestId("friend-chat").click();
    await expect(tvLines(phone)).toHaveCount(17, SOON);
    await phone.getByTestId("tv-chat-more").click();
    await phone.getByTestId("tv-chat-search-open").click();
    await expect(phone.getByTestId("chat-search-box")).toBeFocused();
    await phone.getByTestId("chat-search-box").fill("cinema");
    await expect(phone.getByTestId("chat-search-count")).toHaveText(counted(1, 1));
    expect(await outsideTheScreen(phone, "tv-chat", false)).toEqual([]);
    await phone.getByTestId("chat-search-close").click();
    await expect(phone.getByTestId("chat-search")).toHaveCount(0);
    await expect(phone.getByTestId("tv-chat-more")).toBeFocused();
    await phone.getByTestId("tv-chat-more").click();
    await phone.getByTestId("tv-chat-media-open").click();
    await expect(phone.getByTestId("tv-chat-media")).toBeVisible();
    expect(await outsideTheScreen(phone, "tv-chat-media", false)).toEqual([]);
    await phone.getByTestId("tv-chat-media-back").click();
    await expect(phone.getByTestId("tv-chat")).toBeVisible();
  });
});

test.describe("the chat's panel of titles, GIFs and stickers", () => {
  test("on a computer: the one button opens the panel under the box, a click leaving the keys in the box and the button pressed with the keys putting them in it; a tab shows its pane, the tab used last opens next; Back shuts what was opened last first - the panel, an answer being written, the search", async ({ browser }) => {
    test.setTimeout(200_000);
    const ann = await screenWithFriends(browser, "Ann", { desk: true });
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    await writes(bob.page, ann.page, "Popcorn?");
    const asked = await fakeKlipy(ann.page);
    await look(ann.page);
    await tile(ann.page, bob.name).click();
    await ann.page.getByTestId("friend-chat").click();
    await expect(tvLines(ann.page)).toHaveCount(1);
    const box = ann.page.getByTestId("tv-chat-box");
    await expect(box).toBeFocused();
    const button = ann.page.getByTestId("tv-chat-panel-btn");
    const panel = ann.page.getByTestId("tv-chat-panel");

    await ann.page.keyboard.type("See you");
    await button.click();
    await expect(panel).toHaveAttribute("data-tab", "stickers");
    await expect(box).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(button).toHaveAttribute("aria-label", en["chat.panel"]);
    await expect(button).toHaveAttribute("aria-controls", (await panel.getAttribute("id"))!);
    await expect(panel.getByTestId("tv-chat-panel-tab")).toHaveCount(3);
    expect(asked, "nothing asked of KLIPY before its tab is shown").toHaveLength(0);
    expect(await outsideTheScreen(ann.page, "tv-chat")).toEqual([]);
    await expect(ann.page.getByTestId("tv-chat-name"), "the chat's head stays in view over the panel").toBeInViewport();
    expect(await gridFaults(panel.getByTestId("chat-sticker-pick")), "the stickers: squares, none over another").toEqual([]);
    await ann.page.keyboard.type(" at nine");
    await ann.page.keyboard.press("Enter");
    await expect(tvLines(ann.page)).toHaveCount(2);
    await expect(tvLines(ann.page).nth(1).getByTestId("chat-text")).toHaveText("See you at nine");
    await expect(panel, "words sent from the box leave the panel open").toBeVisible();

    const gifsTab = panel.locator("[role='tab'][data-tab='gifs']");
    await gifsTab.click();
    await expect(panel).toHaveAttribute("data-tab", "gifs");
    await expect(gifsTab).toBeFocused();
    await expect(gifsTab).toHaveAttribute("aria-selected", "true");
    await expect(panel.getByTestId("chat-gif-pick")).toHaveCount(3);
    expect(asked.length).toBeGreaterThan(0);
    expect(await outsideTheScreen(ann.page, "tv-chat")).toEqual([]);
    await ann.page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(button).toBeFocused();

    await ann.page.keyboard.press("Enter");
    await expect(panel).toHaveAttribute("data-tab", "gifs");
    await expect(ann.page.getByTestId("tv-chat-gif-search")).toBeFocused();
    await ann.page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(button).toBeFocused();

    await button.click();
    await expect(panel).toBeVisible();
    await button.click();
    await expect(panel).toHaveCount(0);
    await expect(box).toBeFocused();

    await tvLines(ann.page).first().getByTestId("chat-bubble").click();
    await ann.page.getByTestId("chat-reply").click();
    const strip = ann.page.getByTestId("chat-reply-strip");
    await expect(strip).toBeVisible();
    await expect(box).toBeFocused();
    await button.click();
    await expect(panel).toBeVisible();
    await ann.page.keyboard.type("Yes");
    await ann.page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(box).toBeFocused();
    await expect(strip).toBeVisible();
    await ann.page.keyboard.press("Escape");
    await expect(strip).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await expect(box).toHaveValue("Yes");

    await ann.page.getByTestId("tv-chat-more").click();
    await ann.page.getByTestId("tv-chat-search-open").click();
    const bar = ann.page.getByTestId("chat-search");
    await expect(bar).toBeVisible();
    await tvLines(ann.page).first().getByTestId("chat-bubble").click();
    await expect(ann.page.getByTestId("chat-reply")).toBeVisible();
    await button.click();
    await expect(panel).toBeVisible();
    await expect(ann.page.getByTestId("chat-reply"), "the selection went").toHaveCount(0);
    await ann.page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(bar).toBeVisible();
    await ann.page.keyboard.press("Escape");
    await expect(bar).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();

    await button.click();
    await panel.locator("[role='tab'][data-tab='stickers']").click();
    await panel.getByTestId("chat-sticker-pick").first().click();
    await expect(panel).toHaveCount(0);
    await expect(tvLines(ann.page)).toHaveCount(3);
    await expect(box).toBeFocused();
    await expect(box, "what was typed stays").toHaveValue("Yes");
  });
  test("on the phone: a picture shown larger over the open panel is put away first, then the panel, then the chat (one Back each); a message held while it is open is let go first", async ({ browser }) => {
    test.setTimeout(150_000);
    const { ann, bob } = await twoFriends(browser);
    await openChat(ann.page);
    await openChat(bob.page);
    await openPanel(bob.page, "stickers");
    await bob.page.getByTestId("chat-panel").getByTestId("chat-sticker-pick").first().click();
    await expect(lines(ann.page)).toHaveCount(1, SOON);
    await expect(lines(ann.page).first().locator(".chat-bubble-sticker img")).toBeVisible();
    const panel = await openPanel(ann.page, "stickers");
    const view = ann.page.getByTestId("chat-view");
    await lines(ann.page).first().getByTestId("chat-bubble").click();
    await expect(view).toBeVisible();
    await ann.page.keyboard.press("Escape");
    await expect(view).toHaveCount(0);
    await expect(panel, "the picture alone was put away").toBeVisible();
    await lines(ann.page).first().getByTestId("chat-bubble").scrollIntoViewIfNeeded();
    await ann.page.waitForTimeout(300);
    await lines(ann.page).first().getByTestId("chat-bubble").click({ delay: 650 });
    await expect(ann.page.getByTestId("chat-react-bar")).toBeVisible();
    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("chat-react-bar")).toHaveCount(0);
    await expect(panel).toBeVisible();
    await ann.page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(ann.page.getByTestId("chat-sheet")).toBeVisible();
    await openPanel(ann.page, "stickers");
    await ann.page.getByTestId("chat-more").click();
    await ann.page.getByTestId("chat-media-open").click();
    const gallery = ann.page.getByTestId("chat-media-sheet");
    await expect(gallery).toBeVisible();
    await expect(panel).toHaveCount(0);
    await ann.page.keyboard.press("Escape");
    await expect(gallery).toHaveCount(0);
    await expect(ann.page.getByTestId("chat-sheet")).toBeVisible();
    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("chat-sheet")).toHaveCount(0);
  });
});

async function savedOnServer(page: Page): Promise<string[]> {
  const answer = (await (await page.request.post(`/api/profiles/${await profileOf(page)}/sync`, { data: { since: 0 } })).json()) as { saved?: Array<{ key: string; deleted?: true }> };
  return (answer.saved ?? [])
    .filter((item) => !item.deleted)
    .map((item) => item.key)
    .sort();
}

async function hold(page: Page, line: ReturnType<Page["getByTestId"]>) {
  const bubble = line.getByTestId("chat-bubble");
  await bubble.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await bubble.click({ delay: 650 });
}

test.describe("saved GIFs and stickers", () => {
  test("on the phone: Save on a held GIF or sticker, anybody's, puts it first in its tab (a note says which), apart from KLIPY's grid and not in a search; a press there sends it; Remove from saved and Edit's cross let it go; the server keeps them, and another screen of the profile has them", async ({ browser }) => {
    test.setTimeout(200_000);
    const { ann, bob } = await twoFriends(browser);
    await fakeKlipy(ann.page);
    await fakeKlipy(bob.page);
    await writes(bob.page, ann.page, gifAddress("t2"));
    await writes(bob.page, ann.page, "\u{1F37F}");
    await openChat(ann.page);
    await expect(lines(ann.page)).toHaveCount(2);
    const save = ann.page.getByTestId("chat-picture-save");
    const note = ann.page.getByTestId("chat-saved-note");

    await hold(ann.page, lines(ann.page).nth(0));
    await expect(save).toHaveAttribute("aria-label", en["chat.pictureSave"]);
    await save.click();
    await expect(note).toHaveText(en["chat.savedGifNote"]);
    await expect(save, "the selection went").toHaveCount(0);
    await hold(ann.page, lines(ann.page).nth(1));
    await save.click();
    await expect(note).toHaveText(en["chat.savedStickerNote"]);
    await expect.poll(() => savedOnServer(ann.page), SOON).toEqual([`gif:${gifAddress("t2")}`, "sticker:popcorn"].sort());

    const panel = await openPanel(ann.page, "gifs");
    const saved = panel.getByTestId("chat-saved-pick");
    await expect(panel.getByTestId("chat-saved-gifs")).toBeVisible();
    await expect(saved).toHaveCount(1);
    expect(await srcs(saved)).toEqual([gifAddress("t2")]);
    const picks = panel.getByTestId("chat-gif-pick");
    await expect(picks).toHaveCount(3);
    expect(await srcs(picks)).toEqual(["t1", "t2", "t3"].map(gifAddress));
    expect((await where(saved.first())).y, "Saved is over Trending").toBeLessThan((await where(picks.first())).y);
    expect(await outsideTheScreen(ann.page, "chat-sheet", false)).toEqual([]);
    await panel.getByTestId("chat-gif-search").fill("cat");
    await expect(picks).toHaveCount(1);
    await expect(panel.getByTestId("chat-saved-gifs")).toHaveCount(0);
    await panel.getByTestId("chat-gif-search").fill("");
    await expect(saved).toHaveCount(1);
    await saved.first().click();
    await expect(panel).toHaveCount(0);
    await expect(lines(ann.page)).toHaveCount(3);
    await expect(lines(ann.page).nth(2).getByTestId("chat-gif")).toHaveAttribute("src", gifAddress("t2"));

    await openPanel(ann.page, "stickers");
    const savedStickers = panel.getByTestId("chat-saved-stickers");
    await expect(savedStickers.getByTestId("chat-saved-pick")).toHaveAttribute("data-saved", "sticker:popcorn");
    await expect(panel.getByRole("heading", { name: en["chat.stickersBuiltIn"] })).toBeVisible();
    await ann.page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);

    await hold(ann.page, lines(ann.page).nth(2));
    await expect(save).toHaveAttribute("aria-label", en["chat.pictureUnsave"]);
    await ann.page.keyboard.press("Escape");
    await hold(ann.page, lines(ann.page).nth(1));
    await expect(save).toHaveAttribute("aria-label", en["chat.pictureUnsave"]);
    await save.click();
    await expect(note).toHaveText(en["chat.unsavedNote"]);
    await openPanel(ann.page, "stickers");
    await expect(savedStickers).toHaveCount(0);

    await openPanel(ann.page, "gifs");
    await panel.getByTestId("chat-saved-edit").click();
    await expect(saved.first()).toBeDisabled();
    await panel.getByTestId("chat-saved-remove").click();
    await expect(panel.getByTestId("chat-saved-gifs")).toHaveCount(0);
    await expect(picks).toHaveCount(3);
    await expect.poll(() => savedOnServer(ann.page), SOON).toEqual([]);

    await ann.page.keyboard.press("Escape");
    await write(ann.page, "hi");
    await expect(lines(ann.page)).toHaveCount(4);
    await hold(ann.page, lines(ann.page).nth(3));
    await expect(ann.page.getByTestId("chat-reply")).toBeVisible();
    await expect(save).toHaveCount(0);

    const sent = await bob.page.request.post(`/api/profiles/${await profileOf(bob.page)}/sync`, { data: { since: 0, saved: [{ key: `gif:${gifAddress("t3")}`, at: Date.now(), text: gifAddress("t3") }] } });
    expect(sent.ok()).toBe(true);
    await bob.page.reload();
    await openChat(bob.page);
    const theirs = await openPanel(bob.page, "gifs");
    await expect(theirs.getByTestId("chat-saved-pick")).toHaveCount(1);
    expect(await srcs(theirs.getByTestId("chat-saved-pick"))).toEqual([gifAddress("t3")]);
  });

  test("on a computer: Save on a sticker clicked with the right button; the saved ones come first in the Stickers tab, and the keys stay in the panel when Edit's cross lets the last one go", async ({ browser }) => {
    test.setTimeout(150_000);
    const ann = await screenWithFriends(browser, "Ann", { desk: true });
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);
    await writes(bob.page, ann.page, "\u{1F37F}");
    await writes(bob.page, ann.page, "\u{1F3AC}");
    await look(ann.page);
    await tile(ann.page, bob.name).click();
    await ann.page.getByTestId("friend-chat").click();
    await expect(tvLines(ann.page)).toHaveCount(2);
    const save = ann.page.getByTestId("chat-picture-save");
    for (const at of [0, 1]) {
      await tvLines(ann.page).nth(at).getByTestId("chat-bubble").scrollIntoViewIfNeeded();
      await ann.page.waitForTimeout(300);
      await tvLines(ann.page).nth(at).getByTestId("chat-bubble").click({ button: "right" });
      await expect(save).toHaveAttribute("aria-label", en["chat.pictureSave"]);
      await save.click();
      await expect(ann.page.getByTestId("tv-chat-saved-note")).toHaveText(en["chat.savedStickerNote"]);
      await expect(ann.page.getByTestId("tv-chat-more"), "the keys go to the ⋯, as after any of these").toBeFocused();
    }

    await ann.page.getByTestId("tv-chat-panel-btn").click();
    const panel = ann.page.getByTestId("tv-chat-panel");
    await expect(panel).toHaveAttribute("data-tab", "stickers");
    const saved = panel.getByTestId("chat-saved-pick");
    await expect(saved).toHaveCount(2);
    expect(await saved.evaluateAll((all) => all.map((one) => one.getAttribute("data-saved"))), "the one saved last first").toEqual(["sticker:clapper", "sticker:popcorn"]);
    expect((await where(saved.first())).y, "Saved is over Kino's").toBeLessThan((await where(panel.getByTestId("chat-sticker-pick").first())).y);
    expect(await outsideTheScreen(ann.page, "tv-chat")).toEqual([]);
    expect(await gridFaults(saved), "a square").toEqual([]);

    const elsewhere = async (item: object) => {
      expect((await ann.page.request.post(`/api/profiles/${await profileOf(ann.page)}/sync`, { data: { since: 0, saved: [item] } })).ok()).toBe(true);
      await look(ann.page);
    };
    await elsewhere({ key: "sticker:heart", at: Date.now(), text: "\u{2764}\u{FE0F}" });
    await expect(saved).toHaveCount(3, SOON);
    await expect(saved.first()).toHaveAttribute("data-saved", "sticker:heart");
    await saved.first().focus();
    await elsewhere({ key: "sticker:heart", at: Date.now() + 1000, deleted: true });
    await expect(saved).toHaveCount(2, SOON);
    await expect(saved.first(), "the keys on the one that took its place").toBeFocused();
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();

    await panel.getByTestId("chat-saved-edit").focus();
    await ann.page.keyboard.press("Enter");
    await expect(panel.getByTestId("chat-saved-edit")).toHaveAttribute("aria-pressed", "true");
    const crosses = panel.getByTestId("chat-saved-remove");
    await expect(crosses).toHaveCount(2);
    await crosses.first().focus();
    await ann.page.keyboard.press("Enter");
    await expect(saved).toHaveCount(1);
    await expect(crosses.first()).toBeFocused();
    await ann.page.keyboard.press("Enter");
    await expect(panel.getByTestId("chat-saved-stickers")).toHaveCount(0);
    const keysOn = () =>
      ann.page.evaluate(() => {
        const on = document.activeElement;
        return on?.closest("[data-testid='tv-chat-panel']") && on.tagName === "BUTTON" ? "a button of the panel" : `${on?.tagName} ${on?.getAttribute("data-testid")}`;
      });
    await ann.page.waitForTimeout(600);
    expect(await keysOn()).toBe("a button of the panel");
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await expect.poll(() => savedOnServer(ann.page), SOON).toEqual([]);
  });
});