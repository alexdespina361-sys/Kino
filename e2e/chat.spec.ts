import { expect, type Browser, type Page } from "@playwright/test";
import { en } from "../src/client/i18n/en";
import { it as italian } from "../src/client/i18n/it";
import { ro } from "../src/client/i18n/ro";
import { CHAT_REPORT_LINES, CHAT_TEXT_MAX } from "../src/shared";
import { FEEDBACK_TOKEN } from "./feedbackToken";
import { openDevice, openLibrary, openProfilePlace, openTvSignIn, PHONE, test } from "./helpers";

/**
 * The chat between two friends, on the phone and on the TV: writing and reading it, how what waits is told (a line, a number, a row in the bell, never a
 * popup), the switch "Friends can message me", taking a message back, muting, reporting, the end of a chat, and that all of it fits the narrowest
 * screens in the longest words. Every test makes its own accounts (the server keeps them in memory); the many messages some tests need are written the way
 * the page writes them (a POST), and what the page does with its box and its keys is tried on its own.
 */

test.use({ actionTimeout: 15_000 }); // (a wrong id fails in seconds, not when the test runs out of time)

let counter = 0;
/** A name short enough to be a profile's name as it is (a profile is named after the username, 16 letters at most). */
const fresh = (name: string) => ({ email: `${name}${++counter}x${Date.now().toString(36).slice(-4)}`, password: "kino-test-pass-1" }); // (a password that is not asked about)
type Account = ReturnType<typeof fresh>;
const nameOf = (account: Account) => account.email.charAt(0).toUpperCase() + account.email.slice(1);

/** A line of the words of a language with its blanks filled in: `{name}` and the like. */
const say = (text: string, params: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? "");

/** The page looks at its friends now, as it does when it comes back to the front (and every half minute). */
const look = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

const profileOf = (page: Page) => page.evaluate(() => localStorage.getItem("kino.profile"));

const WORDS = { en, ro, it: italian };
type Language = keyof typeof WORDS;

/** A chat that is open asks again every three seconds (CHAT_POLL_MS): a message written elsewhere is there within a few of them. */
const SOON = { timeout: 12_000 };

/** A message written the way a page does it, from `from`'s profile to `to`'s (for the many a test needs). */
async function writes(from: Page, to: Page, text: string) {
  const response = await from.request.post(`/api/profiles/${await profileOf(from)}/friends/${await profileOf(to)}/chat`, { data: { text } });
  expect(response.status(), text).toBe(201);
}

/** What the team's inbox holds about a word (the e2e server's token, which is what scripts/feedback.mjs talks to). */
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

/** The messages of a long chat: some words with spaces, one that is long and has none, as long as a message may be. */
const LONG = `Ne uităm la un film cu multe explozii și vorbim după aceea despre ce ne-a plăcut, ${"Supercalifragilisticexpialidocios".repeat(2)} și apoi mâncăm floricele de porumb cu suc de portocale, ${"și tot așa ".repeat(60)}`.slice(0, CHAT_TEXT_MAX);

type Box = { x: number; y: number; width: number; height: number };
const where = async (target: { boundingBox(): Promise<Box | null> }) => (await target.boundingBox())!;
const apart = (a: Box, b: Box) => a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5;

/* ------------------------------ phones ------------------------------ */

const newPhone = (browser: Browser, locale = "en-US") => openDevice(browser, { ...PHONE, locale });

async function signUp(page: Page, account: Account) {
  await page.getByTestId("account-button").click();
  await page.getByTestId("auth-switch").click();
  await expect(page.getByTestId("auth-form")).toHaveAttribute("data-mode", "signUp");
  await page.getByTestId("auth-email").fill(account.email);
  await page.getByTestId("auth-password").fill(account.password);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("account-card")).toBeVisible();
}

/** The account page is open: friends on, in the settings, and back. */
async function turnOnFriends(page: Page) {
  await page.getByTestId("menu-settings").click();
  await page.getByTestId("friends-switch").click();
  await expect(page.getByTestId("friends-switch")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape"); // (back to the account page)
  await expect(page.getByTestId("menu-friends")).toBeVisible();
}

/** The account page is open: the Friends page, once it has heard from the server. */
async function openFriendsPage(page: Page) {
  await page.getByTestId("menu-friends").click();
  await expect(page.getByTestId("friends-page")).toBeVisible();
}

/** The account page is shut: the phone is at its home screen. */
async function home(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("account-screen")).toHaveCount(0);
}

/** The account page, Friends and the page of the one friend, opened from the home screen. */
async function openFriendPage(page: Page) {
  await page.getByTestId("account-button").click();
  await openFriendsPage(page);
  await page.getByTestId("friend-row").click();
  await expect(page.getByTestId("friend-page")).toBeVisible();
}

/** The same, and the chat with the friend, open over their page. */
async function openChat(page: Page) {
  await openFriendPage(page);
  await page.getByTestId("friend-chat").click();
  await expect(page.getByTestId("chat")).toBeVisible();
}

/** The phone is at its home screen when nothing covers the button of the profile in its header. */
const atHome = (page: Page) =>
  page.evaluate(() => {
    const button = document.querySelector('[data-testid="account-button"]');
    if (!button) return false;
    const box = button.getBoundingClientRect();
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return top !== null && button.contains(top);
  });

/** The phone is anywhere in its pages or sheets: Back until it is at its home screen. */
async function backHome(page: Page) {
  for (let back = 0; back < 6 && !(await atHome(page)); back++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250); // (a page that is left slides away before the next Back is meant for the one under it)
  }
  await expect.poll(() => atHome(page)).toBe(true);
}

/** A new phone, signed up, with friends on: left on the account page. */
async function phoneWithFriends(browser: Browser, name: string, locale = "en-US") {
  const account = fresh(name);
  const page = await newPhone(browser, locale);
  await page.goto("/");
  await signUp(page, account);
  await turnOnFriends(page);
  return { page, account, name: nameOf(account) };
}
type Phone = Awaited<ReturnType<typeof phoneWithFriends>>;

/** `giver` makes a code and `taker` types it: two profiles that are friends. Both start on the account page, and are left on the home screen. */
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
    await page.keyboard.press("Escape"); // (the account page)
    await home(page);
  }
}

/** Two phones whose profiles are friends, both at their home screens. */
async function twoFriends(browser: Browser, locale = "en-US") {
  const ann = await phoneWithFriends(browser, "Ann", locale);
  const bob = await phoneWithFriends(browser, "Bob", locale);
  await befriend(ann.page, bob.page);
  return { ann, bob };
}

/** What is typed in the box of a chat is sent with the button. */
async function write(page: Page, text: string) {
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("chat-send").click();
}

const bell = (page: Page) => page.getByTestId("bell-button");
const badge = (page: Page) => page.getByTestId("bell-badge");
const lines = (page: Page) => page.getByTestId("chat-line");
const texts = (page: Page) => page.getByTestId("chat-text");

/** The ids of the parts that leave the screen's sides, or the page that scrolls sideways. */
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

    // Ann's chat with Bob has nothing in it yet, and says what a chat is kept as
    await openChat(ann.page);
    await expect(ann.page.getByTestId("chat-empty")).toBeVisible();
    await expect(ann.page.getByTestId("chat-privacy")).toContainText("without encryption");

    // she writes: the text is kept as the server will keep it (trimmed), the box is emptied and keeps the keyboard, the message is hers
    await write(ann.page, "  Hello Bob  ");
    await expect(lines(ann.page)).toHaveCount(1);
    await expect(lines(ann.page).first()).toHaveAttribute("data-mine", "true");
    await expect(texts(ann.page).first()).toHaveText("Hello Bob");
    await expect(ann.page.getByTestId("chat-input")).toHaveValue("");
    await expect(ann.page.getByTestId("chat-input")).toBeFocused();

    // Bob is on his home screen: the number on the bell is the only sign of it; nothing pops up
    await look(bob.page);
    await expect(badge(bob.page)).toHaveText("1");
    await expect(bob.page.getByTestId("account-toast")).toHaveCount(0);

    // the Friends page says it too: a line under her name, and on the Chat button of her page
    await openFriendPage(bob.page);
    await expect(bob.page.getByTestId("friend-chat-unread")).toHaveText(say(en["chat.unreadShort_one"], { count: "1" }));
    await bob.page.keyboard.press("Escape"); // (the friends)
    await expect(bob.page.getByTestId("friend-unread")).toHaveText(say(en["chat.unreadShort_one"], { count: "1" }));
    await bob.page.keyboard.press("Escape");
    await home(bob.page);

    // the bell lists her, and the row opens the chat with her (the bell closes behind it)
    await bell(bob.page).click();
    const row = bob.page.getByTestId("bell-chat-item");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveText(say(en["chat.unread_one"], { count: "1", name: ann.name }));
    await row.getByRole("button").click();
    await expect(bob.page.getByTestId("bell-sheet")).toHaveCount(0);
    await expect(bob.page.getByTestId("chat")).toBeVisible();
    await expect(lines(bob.page)).toHaveCount(1);
    await expect(lines(bob.page).first()).toHaveAttribute("data-mine", "false");
    await expect(texts(bob.page).first()).toHaveText("Hello Bob");

    // he answers, and her chat, which is open, has it within a few seconds without anything else being done
    await write(bob.page, "Hi Ann");
    await expect(lines(ann.page)).toHaveCount(2, SOON);
    await expect(lines(ann.page).nth(1)).toHaveAttribute("data-mine", "false");
    await expect(texts(ann.page).nth(1)).toHaveText("Hi Ann");

    // both have read everything: closing the chats leaves no number
    await bob.page.keyboard.press("Escape");
    await expect(bob.page.getByTestId("chat")).toHaveCount(0);
    await backHome(bob.page);
    await expect(badge(bob.page)).toHaveCount(0);
    await ann.page.keyboard.press("Escape");
    await backHome(ann.page);
    await expect(badge(ann.page)).toHaveCount(0);
  });

  test("a message of one's own can be taken back, and is gone for both; a friend can be muted without being told, and the messages are in the chat when it is opened", async ({ browser }) => {
    test.setTimeout(150_000);
    const { ann, bob } = await twoFriends(browser);
    await openChat(ann.page);
    await openChat(bob.page);
    await look(bob.page); // (the page under the chat is drawn again while it is open, as it is every half minute: Escape must still close the chat and nothing else)

    await write(ann.page, "Oops, wrong chat");
    await expect(lines(bob.page)).toHaveCount(1, SOON);
    // (a line of the friend's is only read; a line of one's own is pressed, and a button under it takes it back)
    await expect(bob.page.getByTestId("chat-bubble")).toHaveCount(0);
    await ann.page.getByTestId("chat-bubble").click();
    await ann.page.getByTestId("chat-takeback").click();
    await expect(lines(ann.page)).toHaveCount(0);
    await expect(ann.page.getByTestId("chat-empty")).toBeVisible();
    await expect(lines(bob.page)).toHaveCount(0, SOON);

    // Bob mutes her: his chat says so, hers says nothing of it
    await bob.page.getByTestId("chat-mute").click();
    await expect(bob.page.getByTestId("chat-muted")).toContainText(say(en["chat.muted"], { name: ann.name }));
    await expect(bob.page.getByTestId("chat-mute")).toHaveText(en["chat.unmute"]);
    await write(ann.page, "Are you there?");
    await expect(lines(ann.page)).toHaveCount(1);
    await expect(ann.page.getByTestId("chat-muted")).toHaveCount(0);
    await expect(lines(bob.page)).toHaveCount(1, SOON); // (muted is not hidden: the messages are in the chat)

    // out of the chat, nothing of her messages is told to him: no number, no row in the bell, no line on the friends page
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

    // Bob opens the chat again: both messages are there, and Unmute puts it back
    await openChat(bob.page);
    await expect(lines(bob.page)).toHaveCount(2);
    await bob.page.getByTestId("chat-mute").click();
    await expect(bob.page.getByTestId("chat-muted")).toHaveCount(0);
    await expect(bob.page.getByTestId("chat-mute")).toHaveText(en["chat.mute"]);
  });

  test("'Friends can message me' is on until it is turned off; a friend whose switch is off is not written to (the chat says so, in a plain line), and the box comes back when it is on again", async ({ browser }) => {
    test.setTimeout(150_000);
    const { ann, bob } = await twoFriends(browser);

    // Bob's settings: the switch is among the others, on, with the line that says what a chat is kept as
    await bob.page.getByTestId("account-button").click();
    await bob.page.getByTestId("menu-settings").click();
    const messages = bob.page.getByTestId("friends-messages");
    await expect(messages).toHaveAttribute("aria-checked", "true");
    await expect(messages).toContainText(en["chat.settingsSwitch"]);
    await expect(messages).toContainText("without encryption"); // (the line under the switch says what a chat is kept as)

    // Ann's chat is open and will take Bob's switch from the server when it looks again
    await openChat(ann.page);
    await expect(ann.page.getByTestId("chat-compose")).toBeVisible();
    await expect(ann.page.getByTestId("chat-closed")).toHaveCount(0);
    // (a chat that can't look again, to see what the server says to a message when the friend is off)
    await ann.page.route(/\/friends\/[^/]+\/chat(\?|$)/, (route) => (route.request().method() === "GET" ? route.abort("connectionfailed") : route.continue()));

    await messages.click();
    await expect(messages).toHaveAttribute("aria-checked", "false");
    const profile = await profileOf(bob.page);
    await expect
      .poll(async () => {
        const answer = (await (await bob.page.request.post(`/api/profiles/${profile}/sync`, { data: { since: 0 } })).json()) as { settings: Array<{ key: string; value?: unknown }> };
        return Object.fromEntries(answer.settings.map((item) => [item.key, item.value]));
      })
      .toMatchObject({ friends: true, friendsMessages: false });

    // Ann writes before she has heard of it: the server turns it away and the page says so in a plain line, the box gives way to it
    await write(ann.page, "Are you free tonight?");
    await expect(ann.page.getByTestId("chat-problem")).toHaveText(say(en["chat.error.chat_off"], { name: bob.name }));
    await expect(ann.page.getByTestId("chat-closed")).toHaveText(say(en["chat.closed"], { name: bob.name }));
    await expect(ann.page.getByTestId("chat-compose")).toHaveCount(0);
    await expect(lines(ann.page)).toHaveCount(0);

    // Bob's own chat with her says that he is not taking messages either, so that it is no surprise she can't answer
    await bob.page.keyboard.press("Escape");
    await expect(bob.page.getByTestId("menu-friends")).toBeVisible();
    await openFriendsPage(bob.page);
    await bob.page.getByTestId("friend-row").click();
    await bob.page.getByTestId("friend-chat").click();
    await expect(bob.page.getByTestId("chat-mine-off")).toHaveText(say(en["chat.mineOff"], { name: ann.name }));

    // on again: the other side has the box back when its chat looks
    await bob.page.keyboard.press("Escape");
    await bob.page.keyboard.press("Escape");
    await bob.page.keyboard.press("Escape");
    await bob.page.getByTestId("menu-settings").click();
    await bob.page.getByTestId("friends-messages").click();
    await expect(bob.page.getByTestId("friends-messages")).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(async () => {
        const answer = (await (await bob.page.request.post(`/api/profiles/${profile}/sync`, { data: { since: 0 } })).json()) as { settings: Array<{ key: string; value?: unknown }> };
        return Object.fromEntries(answer.settings.map((item) => [item.key, item.value]));
      })
      .toMatchObject({ friendsMessages: true });
    await ann.page.unroute(/\/friends\/[^/]+\/chat(\?|$)/);
    await expect(ann.page.getByTestId("chat-compose")).toBeVisible(SOON);
    await write(ann.page, "Are you free tonight?");
    await expect(lines(ann.page)).toHaveCount(1);
  });

  test("a report shows exactly the last messages it would send, sends nothing before the button, and then the team has them with the names and nothing else; the friend is not told", async ({ browser }) => {
    test.setTimeout(180_000);
    const { ann, bob } = await twoFriends(browser);
    // (more than a report holds: the first two of 22 messages are not in it)
    for (let at = 1; at <= 22; at++) await writes(at % 2 === 1 ? ann.page : bob.page, at % 2 === 1 ? bob.page : ann.page, `m${String(at).padStart(2, "0")} ${at % 2 === 1 ? "from Ann" : "from Bob"}`);

    await openChat(bob.page);
    await expect(lines(bob.page)).toHaveCount(22);
    await bob.page.getByTestId("chat-report").click();
    const sheet = bob.page.getByTestId("chat-report-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(say(en["chat.reportLead"], { name: ann.name }));
    const shown = sheet.getByTestId("chat-report-lines").getByTestId("chat-line");
    await expect(shown).toHaveCount(CHAT_REPORT_LINES);
    await expect(shown.first()).toContainText("m03");
    await expect(shown.last()).toContainText("m22");
    expect(await reportsAbout(bob.page, bob.name)).toHaveLength(0); // (looking is not sending)

    // leaving it sends nothing either
    await bob.page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    expect(await reportsAbout(bob.page, bob.name)).toHaveLength(0);

    // the button sends what was shown
    await bob.page.getByTestId("chat-report").click();
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

    // Ann is not told: her chat is as it was
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

    // Ann takes Bob off her friends
    await openFriendPage(ann.page);
    await ann.page.getByTestId("friend-remove").click();
    await ann.page.getByTestId("friend-unfriend-yes").click();
    await expect(ann.page.getByTestId("friend-row")).toHaveCount(0);

    // his open chat finds out when it looks: the line says it, and the box is gone
    await expect(bob.page.getByTestId("chat-ended")).toBeVisible(SOON);
    await expect(bob.page.getByTestId("chat-compose")).toHaveCount(0);
    await bob.page.keyboard.press("Escape");
    await expect(bob.page.getByTestId("friends-none")).toBeVisible(SOON); // (and her page goes with her)
  });

  // (the longest words on the narrowest phones: Romanian, 320 wide)
  test("every part of the chat is on the screen of the narrowest phone in Romanian: the Chat button with its number, the line of the friends page, the bell's row, the chat with a message as long as can be, the report, the setting", async ({ browser }) => {
    test.setTimeout(240_000);
    const { ann, bob } = await twoFriends(browser, "ro-RO");
    const widths = [320, 360, 390];
    const fit = async (ids: string[], what: string) => {
      for (const width of widths) {
        await bob.page.setViewportSize({ width, height: 700 });
        await expect.poll(() => outsideTheSides(bob.page, ids), { message: `${what}, ${width} wide` }).toEqual([]);
      }
    };

    // the chat with nothing in it says what a chat is kept as, and its two buttons keep clear of each other
    await openChat(bob.page);
    await expect(bob.page.getByTestId("chat-privacy")).toBeVisible();
    await fit(["chat-sheet", "chat", "chat-empty", "chat-privacy", "chat-mute", "chat-report", "chat-compose", "chat-input", "chat-send"], "the empty chat");
    for (const width of widths) {
      await bob.page.setViewportSize({ width, height: 700 });
      await expect.poll(async () => apart(await where(bob.page.getByTestId("chat-mute")), await where(bob.page.getByTestId("chat-report"))), { message: `Mute and Report, ${width} wide` }).toBe(true);
    }
    await bob.page.keyboard.press("Escape");
    await backHome(bob.page);

    // she writes a message as long as can be; what waits is told in the words of the language
    await writes(ann.page, bob.page, LONG);
    await look(bob.page);
    await expect(badge(bob.page)).toHaveText("1");
    await bell(bob.page).click();
    await expect(bob.page.getByTestId("bell-chat-item")).toHaveText(say(ro["chat.unread_one"], { count: "1", name: ann.name }));
    await fit(["bell-sheet", "bell-waiting", "bell-chat-item"], "the bell");
    await bob.page.getByTestId("bell-chat-item").getByRole("button").click();
    await expect(lines(bob.page)).toHaveCount(1);
    await fit(["chat-sheet", "chat", "chat-mute", "chat-report", "chat-compose", "chat-input", "chat-send"], "the chat");
    await expect(lines(bob.page).first().getByTestId("chat-text")).toHaveText(LONG);
    const overflow = await bob.page.getByTestId("chat-lines").evaluate((box) => [...box.querySelectorAll<HTMLElement>('[data-testid="chat-text"], .chat-bubble')].filter((part) => part.scrollWidth > part.clientWidth + 1).map((part) => part.className));
    expect(overflow, "text that runs out of its bubble").toEqual([]);

    // the report with all of it
    await bob.page.getByTestId("chat-report").click();
    await expect(bob.page.getByTestId("chat-report-lines")).toBeVisible();
    await fit(["chat-report-sheet", "chat-report-lines", "chat-report-send"], "the report");
    await bob.page.keyboard.press("Escape");
    await bob.page.keyboard.press("Escape"); // (the chat)
    await backHome(bob.page);

    // the number on the Chat button and the line of the list of friends, for a message that came after the chat was read ...
    await writes(ann.page, bob.page, "Cu plăcere, și mulțumesc pentru ieri!");
    await look(bob.page);
    await openFriendPage(bob.page);
    await expect(bob.page.getByTestId("friend-chat-unread")).toHaveText(say(ro["chat.unreadShort_one"], { count: "1" }));
    await fit(["friend-page", "friend-chat", "friend-chat-unread"], "the page of a friend");
    await bob.page.keyboard.press("Escape");
    await expect(bob.page.getByTestId("friend-unread")).toHaveText(say(ro["chat.unreadShort_one"], { count: "1" }));
    await fit(["friends-list", "friend-row", "friend-unread"], "the friends");

    // ... and the setting, with its line
    await bob.page.keyboard.press("Escape");
    await bob.page.getByTestId("menu-settings").click();
    await expect(bob.page.getByTestId("friends-messages")).toBeVisible();
    await fit(["friends-messages"], "the setting");
  });
});

/* ------------------------------ screens ------------------------------ */

interface Screen {
  page: Page;
  name: string;
}

const HD = { width: 1280, height: 720 };

/** A new screen, signed up with the email form, with the switch for friends turned on in the settings of the account. */
async function screenWithFriends(browser: Browser, name: string, options: { viewport?: { width: number; height: number }; language?: Language } = {}): Promise<Screen> {
  const account = fresh(name);
  const page = await openLibrary(browser, undefined, options.viewport ?? HD, options.language ? { "kino.lang": options.language } : {});
  await openTvSignIn(page);
  await page.getByTestId("tv-signin-email").click();
  await page.getByTestId("auth-switch").click();
  await expect(page.getByTestId("auth-form")).toHaveAttribute("data-mode", "signUp");
  await page.getByTestId("auth-email").fill(account.email);
  await page.getByTestId("auth-password").fill(account.password);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("tv-account-chip")).toContainText(nameOf(account));
  await openProfilePlace(page, "settings");
  await page.getByTestId("tv-friends-switch").click();
  await expect(page.getByTestId("tv-friends-switch")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("tv-account-back").click();
  await expect(page.locator('[data-entry="profile:friends"]')).toBeVisible();
  return { page, name: nameOf(account) };
}

/** A tile of the current page, by its title. */
const tile = (page: Page, title: string) => page.locator(`.tv-tile[title="${title}"]`);
const view = (page: Page) => page.getByTestId("tv-browse");

async function openFriendsView(page: Page) {
  await openProfilePlace(page, "friends");
  await expect(view(page)).toHaveAttribute("data-view", "friends");
}

/** `giver` shows a code and `taker` types it: two screens whose profiles are friends. Both are left on the page of their friends. */
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

/** A screen shows a code and a phone types it: the same friendship. The screen is left on the page of its friends. */
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

/**
 * `giver` tells what it watches and `taker` hears it (that is what lets the one ask the other to watch together, and gives the friend's page its
 * two more buttons). Both are on the page of their friends, and are left there.
 */
async function tellsWhatItWatches(giver: Screen, taker: Screen, words: (typeof WORDS)[Language] = en) {
  await tile(giver.page, words["friends.settingsTile"]).click();
  await giver.page.getByTestId("tv-friends-give").click();
  await giver.page.getByTestId("tv-friend-settings-done").click();
  await tile(taker.page, words["friends.settingsTile"]).click();
  await taker.page.getByTestId("tv-friends-get").click();
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

/**
 * Everything under `root` that is a control or says something and does not lie inside the screen. On a narrow screen (under 900 pixels wide,
 * where the pages are one column) a page is allowed to be longer than the screen, since it scrolls: only the sides are held to it.
 */
const outsideTheScreen = (page: Page, root: string, whole = true) =>
  page.evaluate(
    ([id, wholePage]) => {
      const lost: string[] = [];
      const base = document.querySelector(`[data-testid="${id}"]`);
      if (!base) return [`(nothing is shown as ${id})`];
      for (const element of base.querySelectorAll("button, input, h1, h2, p, svg")) {
        const box = element.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        const outside = box.left < -0.5 || box.right > innerWidth + 0.5 || (wholePage && (box.top < -0.5 || box.bottom > innerHeight + 0.5));
        if (outside) lost.push(element.getAttribute("data-testid") ?? `${element.tagName.toLowerCase()} "${(element.textContent ?? "").trim().slice(0, 30)}"`);
      }
      if (document.documentElement.scrollWidth > innerWidth) lost.push("(the page scrolls sideways)");
      return lost;
    },
    [root, whole] as const,
  );

/** The chat's lines on a screen. */
const tvLines = (page: Page) => page.getByTestId("tv-chat-lines").getByTestId("chat-line");

/** Write is pressed, the message typed and sent: the screen is back on the chat. */
async function tvWrite(page: Page, text: string) {
  await page.getByTestId("tv-chat-write").click();
  await page.getByTestId("tv-chat-input").fill(text);
  await page.getByTestId("tv-chat-send").click();
  await expect(page.getByTestId("tv-chat")).toBeVisible();
}

test.describe("the chat on the TV", () => {
  test("the remote walks to the Chat chip and into the chat; Write opens the page with the keys, Send puts the message in the chat, Back goes back a page at a time, and a message from the other screen comes to an open chat within seconds", async ({ browser }) => {
    test.setTimeout(240_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);

    // Bob's page: Back, the two halves, the two buttons to watch together, and the Chat chip last; the remote walks along the row to it
    await tile(ann.page, bob.name).click();
    await expect(ann.page.getByTestId("friend-chat")).toBeVisible();
    await ann.page.getByTestId("tv-friend-back").focus();
    for (let step = 0; step < 5; step++) await ann.page.keyboard.press("ArrowRight");
    await expect(ann.page.getByTestId("friend-chat")).toBeFocused();
    await ann.page.keyboard.press("Enter");

    // the chat is empty, says what it is kept as, and has the remote on Write
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await expect(ann.page.getByTestId("tv-chat-empty")).toBeVisible();
    await expect(ann.page.getByTestId("tv-chat-privacy")).toContainText("without encryption");
    await expect(ann.page.getByTestId("tv-chat-write")).toBeFocused();
    await ann.page.keyboard.press("Enter");

    // the page that writes: the field, and the keys of the page put marks in it; Back goes to the chat and keeps what was typed
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

    // sent: the chat, with the message, and the remote on Write again
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await expect(tvLines(ann.page)).toHaveCount(1);
    await expect(tvLines(ann.page).first().getByTestId("chat-text")).toHaveText("Hello Bob!");
    await expect(tvLines(ann.page).first()).toHaveAttribute("data-mine", "true");
    await expect(ann.page.getByTestId("tv-chat-write")).toBeFocused();

    // Bob's screen is on his friends: Ann's tile tells it, and so does the bell; her page has the number on the chip and her chat has the message
    await look(bob.page);
    await expect(tile(bob.page, ann.name)).toContainText(say(en["chat.unreadShort_one"], { count: "1" }));
    await expect(bob.page.getByTestId("tv-bell-badge")).toHaveText("1");
    await tile(bob.page, ann.name).click();
    await expect(bob.page.getByTestId("friend-chat-unread")).toContainText("1");
    await bob.page.getByTestId("friend-chat").click();
    await expect(tvLines(bob.page)).toHaveCount(1);
    await expect(tvLines(bob.page).first().getByTestId("chat-text")).toHaveText("Hello Bob!");
    await expect(tvLines(bob.page).first()).toHaveAttribute("data-mine", "false");

    // he answers; her chat is open, and has it within a few seconds
    await tvWrite(bob.page, "Hi Ann");
    await expect(tvLines(ann.page)).toHaveCount(2, SOON);
    await expect(tvLines(ann.page).nth(1).getByTestId("chat-text")).toHaveText("Hi Ann");

    // Back closes the chat and the remote is on the chip it came from; the number is gone
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

    // on the screen: nothing pops up, the tile and the bell say it
    await look(ann.page);
    await expect(tile(ann.page, bob.name)).toContainText(say(en["chat.unreadShort_other"], { count: "2" }));
    await expect(ann.page.getByTestId("tv-bell-badge")).toHaveText("1");
    await expect(ann.page.getByTestId("tv-chat")).toHaveCount(0);

    // the bell lists him, and the line opens the chat
    await ann.page.getByTestId("tv-bell").click();
    const line = ann.page.getByTestId("tv-bell-item");
    await expect(line).toHaveCount(1);
    await expect(line).toHaveAttribute("data-entry", `chat:${await profileOf(bob.page)}`);
    await expect(line).toContainText(say(en["chat.unread_other"], { count: "2", name: bob.name }));
    await line.click();
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    await expect(tvLines(ann.page)).toHaveCount(2);
    await expect(ann.page.getByTestId("tv-chat-write")).toBeFocused();

    // she answers from the screen; his phone has it in the open chat
    await tvWrite(ann.page, "Yes, hello!");
    await expect(lines(bob.page)).toHaveCount(3, SOON);
    await expect(texts(bob.page).nth(2)).toHaveText("Yes, hello!");

    // read: closing the chat leaves nothing on the screen, neither on the bell nor on the friend's tile
    await ann.page.keyboard.press("Escape");
    await expect(ann.page.getByTestId("tv-chat")).toHaveCount(0);
    await look(ann.page);
    await expect(ann.page.getByTestId("tv-bell-badge")).toHaveCount(0);
    await ann.page.getByTestId("rail-home").click();
    await openFriendsView(ann.page);
    await expect(tile(ann.page, bob.name)).toBeVisible();
    await expect(tile(ann.page, bob.name)).not.toContainText("new message");
  });

  test("the switch 'Friends can message me' is among the others in what is shared, on until it is turned off, with the line that says what a chat is kept as; a friend whose switch is off is not written to, and the chat says so", async ({ browser }) => {
    test.setTimeout(240_000);
    const ann = await screenWithFriends(browser, "Ann");
    const bob = await screenWithFriends(browser, "Bob");
    await meet(ann, bob);

    await tile(bob.page, en["friends.settingsTile"]).click();
    const messages = bob.page.getByTestId("tv-friends-messages");
    await expect(messages).toHaveAttribute("aria-checked", "true");
    await expect(messages).toContainText(en["chat.settingsSwitch"]);
    await expect(bob.page.getByTestId("tv-friends-messages-hint")).toContainText("without encryption");
    await messages.click();
    await expect(messages).toHaveAttribute("aria-checked", "false");
    const profile = await profileOf(bob.page);
    await expect
      .poll(async () => {
        const answer = (await (await bob.page.request.post(`/api/profiles/${profile}/sync`, { data: { since: 0 } })).json()) as { settings: Array<{ key: string; value?: unknown }> };
        return Object.fromEntries(answer.settings.map((item) => [item.key, item.value]));
      })
      .toMatchObject({ friends: true, friendsMessages: false });

    // Ann's chat with Bob says so, plainly, and has no Write: the remote is on Back
    await tile(ann.page, bob.name).click();
    await ann.page.getByTestId("friend-chat").click();
    await expect(ann.page.getByTestId("tv-chat-closed")).toHaveText(say(en["chat.closed"], { name: bob.name }));
    await expect(ann.page.getByTestId("tv-chat-write")).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-chat-back")).toBeFocused();

    // Bob's own chat with her says that he takes none either; Write is there (he may write to her), and the line says why she can't answer
    await bob.page.getByTestId("tv-friend-settings-done").click();
    await tile(bob.page, ann.name).click();
    await bob.page.getByTestId("friend-chat").click();
    await expect(bob.page.getByTestId("tv-chat-mine-off")).toHaveText(say(en["chat.mineOff"], { name: ann.name }));

    // on again: Ann's open chat has Write back within a few seconds
    await bob.page.keyboard.press("Escape");
    await bob.page.keyboard.press("Escape");
    await tile(bob.page, en["friends.settingsTile"]).click();
    await bob.page.getByTestId("tv-friends-messages").click();
    await expect(bob.page.getByTestId("tv-friends-messages")).toHaveAttribute("aria-checked", "true");
    await expect(ann.page.getByTestId("tv-chat-write")).toBeVisible(SOON);
    await expect(ann.page.getByTestId("tv-chat-closed")).toHaveCount(0);
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
    await ann.page.getByTestId("tv-chat-report").click();
    await expect(ann.page.getByTestId("tv-chat-reporting")).toBeVisible();
    await expect(ann.page.getByTestId("tv-chat-report-lines").getByTestId("chat-line")).toHaveCount(2);
    await expect(ann.page.getByTestId("tv-chat-report-cancel")).toBeFocused();
    await expect(ann.page.getByTestId("tv-chat-report-send")).toBeEnabled();
    expect(await reportsAbout(ann.page, ann.name)).toHaveLength(0);
    await ann.page.keyboard.press("Escape"); // (Back leaves it)
    await expect(ann.page.getByTestId("tv-chat-reporting")).toHaveCount(0);
    await expect(ann.page.getByTestId("tv-chat")).toBeVisible();
    expect(await reportsAbout(ann.page, ann.name)).toHaveLength(0);

    await ann.page.getByTestId("tv-chat-report").click();
    await ann.page.getByTestId("tv-chat-report-send").click();
    await expect(ann.page.getByTestId("tv-chat-report-sent")).toHaveText(en["chat.reportSent"]);
    expect(await reportsAbout(ann.page, ann.name)).toHaveLength(1);
    await ann.page.getByTestId("tv-chat-report-cancel").click(); // (Done)
    await expect(ann.page.getByTestId("tv-chat-reporting")).toHaveCount(0);
  });

  // (the chat's pages and the friend's page with the Chat chip on them, in the longest words and on the narrowest screens: a hand-held one has its pages in one column and slides the row of chips)
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
      // (Ann writes first: what a profile writes counts as having read everything before it. Then Bob writes three, which she has not read.)
      await writes(ann.page, bob.page, LONG);
      for (let at = 0; at < 3; at++) await writes(bob.page, ann.page, at === 0 ? LONG : `${words["chat.compose"]} ${at}`);

      // the row of chips: every one of them, the Chat chip with the number it has now, inside the screen when the remote is on it
      await look(page);
      await tile(page, bob.name).click();
      await expect(page.getByTestId("friend-chat-unread")).toContainText("3");
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
      // (and the remote gets to it along the row, without a chip lost: five presses from Back)
      await page.getByTestId("tv-friend-back").focus();
      for (let step = 0; step < 5; step++) await page.keyboard.press("ArrowRight");
      await expect(page.getByTestId("friend-chat")).toBeFocused();
      await page.keyboard.press("Enter");

      // the chat, with the messages
      await expect(page.getByTestId("tv-chat")).toBeVisible();
      await expect(tvLines(page)).toHaveCount(4);
      await fits("tv-chat", "the chat");
      const cut = await page.getByTestId("tv-chat-lines").evaluate((box) => [...box.querySelectorAll<HTMLElement>(".chat-text, .chat-bubble")].filter((part) => part.scrollWidth > part.clientWidth + 1).map((part) => part.className));
      expect(cut, "text that runs out of its bubble").toEqual([]);

      // the page that writes, with a message as long as can be in the field
      await page.getByTestId("tv-chat-write").click();
      await expect(page.getByTestId("tv-chat-compose")).toBeVisible();
      await page.getByTestId("tv-chat-input").fill(LONG);
      await fits("tv-chat-compose", "the page that writes");
      await page.keyboard.press("Escape");

      // the report
      await page.getByTestId("tv-chat-report").click();
      await expect(page.getByTestId("tv-chat-report-lines")).toBeVisible();
      await fits("tv-chat-reporting", "the report");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("friend-chat")).toBeFocused();

      // what is shared: eight switches and the line that says what a chat is kept as
      await page.getByTestId("tv-friend-back").click();
      await expect(view(page)).toHaveAttribute("data-view", "friends");
      await tile(page, words["friends.settingsTile"]).click();
      await expect(page.getByTestId("tv-friends-messages")).toBeVisible();
      await expect(page.getByTestId("tv-friends-messages-hint")).toBeVisible();
      await fits("tv-friend-settings", "the page of what is shared");
      for (const id of ["tv-friends-messages", "tv-friends-messages-hint"]) {
        await page.getByTestId(id).scrollIntoViewIfNeeded();
        const at = (await page.getByTestId(id).boundingBox())!;
        expect(at.x, `${id} from the left`).toBeGreaterThanOrEqual(-0.5);
        expect(at.x + at.width, `${id} to the right`).toBeLessThanOrEqual(screen.width + 0.5);
      }
    });
  }
});
