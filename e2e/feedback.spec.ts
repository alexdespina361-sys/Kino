import { expect, type APIRequestContext, type Browser, type Locator, type Page } from "@playwright/test";
import { FEEDBACK_TOKEN } from "./feedbackToken";
import { openDevice, openLibrary, openPairedPhone, openProfileByRemote, openTv, PHONE, RawPhone, readPairingCode, test, withLibrary } from "./helpers";

/**
 * The Feedback button: a phone and a TV send what is wrong, what could be better or an idea, with a picture of the screen that was circled, and the team
 * (here: the admin API with the e2e token, which is what scripts/feedback.mjs talks to) reads it, asks, and the sender answers. The server these run against
 * keeps nothing (DATA_DIR=memory) and does not limit the sends (see playwright.config.ts), and every test finds its report by a word of its own.
 */

const AUTH = { authorization: `Bearer ${FEEDBACK_TOKEN}` };
let counter = 0;
const word = () => `e2e${Date.now().toString(36)}x${++counter}`;

interface Report {
  id: string;
  kind: string;
  area: string;
  title: string;
  status: string;
  waiting: boolean;
  signedIn: boolean;
  answerable: boolean;
  severity?: string;
  frequency?: string;
  message: string;
  details: Record<string, string>;
  attachments: Array<{ id: string; name: string; mime: string; role: string; note?: string }>;
  context: {
    role?: string;
    handHeld?: boolean;
    device?: { viewport?: number[]; pointer?: string };
    where?: { path?: string; view?: string };
    trail?: string[];
    errors?: string[];
    playback?: { state?: string; title?: string; error?: string };
  };
  messages: Array<{ from: "user" | "team"; text: string; asks?: boolean }>;
}

/** The reports that have this word in them, as the team reads them. */
async function found(request: APIRequestContext, search: string): Promise<Report[]> {
  const listed = await request.get(`/api/admin/feedback?q=${encodeURIComponent(search)}&limit=20`, { headers: AUTH });
  expect(listed.status()).toBe(200);
  const items = ((await listed.json()) as { items: Array<{ id: string }> }).items;
  return Promise.all(items.map(async (item) => (await (await request.get(`/api/admin/feedback/${item.id}`, { headers: AUTH })).json()) as Report));
}

/** The one report that has the word (waits for it to be there). */
async function theReport(request: APIRequestContext, search: string): Promise<Report> {
  let all: Report[] = [];
  await expect.poll(async () => (all = await found(request, search)).length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(all).toHaveLength(1);
  return all[0]!;
}

async function fileOf(request: APIRequestContext, report: Report, role: string): Promise<Buffer> {
  const attachment = report.attachments.find((each) => each.role === role);
  expect(attachment, `a file of role ${role}`).toBeTruthy();
  const response = await request.get(`/api/admin/feedback/${report.id}/files/${attachment!.id}`, { headers: AUTH });
  expect(response.status()).toBe(200);
  return Buffer.from(await response.body());
}

const isPng = (bytes: Buffer) => bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
/** A picture of one pixel: enough for a page to take as a picture. */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const newPhone = (browser: Browser) => openDevice(browser, PHONE);

/** The phone's feedback, opened the way a person does it: the account button, then Feedback beside Settings. */
async function openFeedback(phone: Page): Promise<void> {
  await phone.goto("/");
  await phone.getByTestId("account-button").tap();
  await phone.getByTestId("menu-feedback").tap();
  await expect(phone.getByTestId("fb-start")).toBeVisible();
}

/** A drag over the picture that is being marked, between two places given as shares of its width and height. */
async function drag(page: Page, canvas: Locator, from: [number, number], to: [number, number]): Promise<void> {
  const box = (await canvas.boundingBox())!;
  const at = (point: [number, number]) => [box.x + box.width * point[0], box.y + box.height * point[1]] as const;
  await page.mouse.move(...at(from));
  await page.mouse.down();
  await page.mouse.move(...at([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]), { steps: 4 });
  await page.mouse.move(...at(to), { steps: 4 });
  await page.mouse.up();
}

/** The page's own picture of its screen, taken from the form and opened for marking. */
async function captureAndOpen(page: Page): Promise<Locator> {
  await page.getByTestId("fb-capture").click();
  await expect(page.getByTestId("fb-capture-bar")).toBeVisible();
  await page.getByTestId("fb-capture-now").click();
  const canvas = page.getByTestId("fb-annotate-canvas");
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  return canvas;
}

test.describe("feedback from a phone", () => {
  test("a problem with a picture of the screen, circled, reaches the team with the picture, the plain one behind it and what the page knew", async ({ browser, request }) => {
    const mark = word();
    const phone = await newPhone(browser);
    await openFeedback(phone);
    await phone.getByTestId("fb-kind-bug").tap();
    await expect(phone.getByTestId("fb-form")).toBeVisible();
    await expect(phone.getByTestId("fb-send")).toBeDisabled(); // (nothing to send yet)
    await phone.getByTestId("fb-text").fill(`${mark} The code box does nothing when I type six digits`);
    await phone.getByTestId("fb-severity-annoying").tap();

    const canvas = await captureAndOpen(phone);
    await expect(phone.getByTestId("fb-undo")).toBeDisabled();
    await drag(phone, canvas, [0.15, 0.3], [0.8, 0.5]);
    await expect(phone.getByTestId("fb-undo")).toBeEnabled();
    await phone.getByTestId("fb-annotate-done").tap();
    await expect(phone.getByTestId("fb-piece")).toHaveCount(1);
    await expect(phone.getByTestId("fb-piece")).toContainText("1 mark");
    await expect(phone.getByTestId("fb-send")).toBeEnabled();

    await phone.getByTestId("fb-send").tap();
    await expect(phone.getByTestId("fb-sent")).toBeVisible({ timeout: 15_000 });

    const report = await theReport(request, mark);
    expect(report).toMatchObject({ kind: "bug", severity: "annoying", status: "new", waiting: true, answerable: true, signedIn: false });
    expect(report.message).toContain("The code box does nothing");
    expect(report.attachments.map((each) => each.role).sort()).toEqual(["annotated", "screenshot"]);
    const marked = await fileOf(request, report, "annotated");
    const plain = await fileOf(request, report, "screenshot");
    expect(isPng(marked) && isPng(plain)).toBe(true);
    expect(marked.equals(plain)).toBe(false); // (the marks are on one of them)
    // What the page said about itself: the phone, the screen it was on, and the steps that led to the form (never what was typed).
    expect(report.context).toMatchObject({ role: "remote", handHeld: true });
    expect(report.context.device?.viewport).toEqual([390, 844]);
    expect(report.context.where?.path).toBe("/");
    const trail = (report.context.trail ?? []).join("\n");
    expect(trail).toContain("menu-feedback");
    expect(trail).not.toContain(mark);
    expect(trail).not.toContain("fb-"); // (the form's own presses are not the trouble)
    // The report is kept by this phone, so that the answer can find it.
    expect(await phone.evaluate(() => JSON.parse(localStorage.getItem("kino.feedback.receipts") ?? "[]").length)).toBe(1);
    // Nothing of a draft is left.
    expect(await phone.evaluate(() => localStorage.getItem("kino.feedback.draft"))).toBeNull();
  });

  test("something covered with a block is sent covered, and the plain picture behind it is not sent at all", async ({ browser, request }) => {
    const mark = word();
    const phone = await newPhone(browser);
    await openFeedback(phone);
    await phone.getByTestId("fb-kind-bug").tap();
    await phone.getByTestId("fb-text").fill(`${mark} the code on my screen is private`);
    const canvas = await captureAndOpen(phone);
    await phone.getByTestId("fb-tool-hide").tap();
    await drag(phone, canvas, [0.1, 0.1], [0.9, 0.6]);
    await phone.getByTestId("fb-annotate-done").tap();
    await expect(phone.getByTestId("fb-piece")).toHaveCount(1);
    await phone.getByTestId("fb-send").tap();
    await expect(phone.getByTestId("fb-sent")).toBeVisible({ timeout: 15_000 });
    const report = await theReport(request, mark);
    expect(report.attachments.map((each) => each.role)).toEqual(["annotated"]);
  });

  test("a picture from the device, a photo's note and a log file are sent as they are, and a file of another kind is turned away", async ({ browser, request }) => {
    const mark = word();
    const phone = await newPhone(browser);
    await openFeedback(phone);
    await phone.getByTestId("fb-kind-improve").tap();
    await phone.getByTestId("fb-text").fill(`${mark} the poster looks cut off`);

    await phone.getByTestId("fb-input-picture").setInputFiles({ name: "poster.png", mimeType: "image/png", buffer: PIXEL });
    await expect(phone.getByTestId("fb-piece")).toHaveCount(1);
    await phone.getByTestId("fb-piece-note").fill("the top of the poster");
    await phone.getByTestId("fb-input-file").setInputFiles({ name: "console.log", mimeType: "text/plain", buffer: Buffer.from("TypeError: x is undefined\n") });
    await expect(phone.getByTestId("fb-piece")).toHaveCount(2);
    await phone.getByTestId("fb-input-file").setInputFiles({ name: "movie.mkv", mimeType: "video/x-matroska", buffer: Buffer.from("not a picture") });
    await expect(phone.getByTestId("fb-pictures-problem")).toBeVisible();
    await expect(phone.getByTestId("fb-piece")).toHaveCount(2);

    // A piece can be taken off again.
    await phone.getByTestId("fb-remove").last().tap();
    await expect(phone.getByTestId("fb-piece")).toHaveCount(1);
    await phone.getByTestId("fb-input-file").setInputFiles({ name: "console.log", mimeType: "text/plain", buffer: Buffer.from("TypeError: x is undefined\n") });
    await expect(phone.getByTestId("fb-piece")).toHaveCount(2);

    await phone.getByTestId("fb-send").tap();
    await expect(phone.getByTestId("fb-sent")).toBeVisible({ timeout: 15_000 });
    const report = await theReport(request, mark);
    expect(report.kind).toBe("improve");
    expect(report.attachments.map((each) => [each.role, each.note ?? ""])).toEqual([
      ["screenshot", "the top of the poster"],
      ["file", ""],
    ]);
    expect(report.attachments[0]?.mime).toMatch(/^image\//);
    expect(report.attachments[1]?.mime).toBe("text/plain");
  });

  test("an idea about a place the person chose, in words alone, is sent as that: no picture is asked for", async ({ browser, request }) => {
    const mark = word();
    const phone = await newPhone(browser);
    await openFeedback(phone);
    await phone.getByTestId("fb-kind-idea").tap();
    await phone.getByTestId("fb-where-button").tap();
    await phone.getByTestId("fb-area-party").tap();
    await expect(phone.getByTestId("fb-form")).toBeVisible();
    await expect(phone.getByTestId("fb-where-button")).toContainText("Watch parties"); // (the place that was chosen is the one the form says)
    await phone.getByTestId("fb-text").fill(`${mark} a party where we can all draw on the screen`);
    await phone.getByTestId("fb-send").tap();
    await expect(phone.getByTestId("fb-sent")).toBeVisible({ timeout: 15_000 });
    const report = await theReport(request, mark);
    expect(report).toMatchObject({ kind: "idea", area: "party" });
    expect(report.attachments).toEqual([]);
  });

  test("what goes with the message can be switched off, and the form shows exactly what would be sent", async ({ browser, request }) => {
    const mark = word();
    const phone = await newPhone(browser);
    await openFeedback(phone);
    await phone.getByTestId("fb-kind-other").tap();
    await phone.getByTestId("fb-text").fill(`${mark} just saying thanks`);
    // Everything is on to begin with, and the text shown is what would go: the device, and the steps that led here.
    await phone.getByTestId("fb-preview").tap();
    const preview = phone.getByTestId("fb-preview-text");
    await expect(preview).toContainText("viewport");
    await expect(preview).toContainText("menu-feedback");
    await phone.getByTestId("fb-include-steps").tap();
    await expect(preview).not.toContainText("menu-feedback");
    await expect(preview).toContainText("viewport");
    await phone.getByTestId("fb-include-device").tap();
    await expect(preview).toContainText("Nothing. Only your words and pictures are sent.");
    await phone.getByTestId("fb-answer-switch").tap(); // (no answer wanted)
    await phone.getByTestId("fb-send").tap();
    await expect(phone.getByTestId("fb-sent")).toBeVisible({ timeout: 15_000 });
    const report = await theReport(request, mark);
    expect(report.answerable).toBe(false);
    expect(report.context.device).toBeUndefined();
    expect(report.context.trail ?? []).toEqual([]);
    // No answer was asked for, so this phone keeps no receipt.
    expect(await phone.evaluate(() => JSON.parse(localStorage.getItem("kino.feedback.receipts") ?? "[]").length)).toBe(0);
  });

  test("a send that fails twice is tried again by itself, and the team has the report once", async ({ browser, request }) => {
    const mark = word();
    const phone = await newPhone(browser);
    let tries = 0;
    await phone.route("**/api/feedback", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      tries += 1;
      return tries <= 2 ? route.fulfill({ status: 503, json: { error: "waking up" } }) : route.continue();
    });
    await openFeedback(phone);
    await phone.getByTestId("fb-kind-bug").tap();
    await phone.getByTestId("fb-text").fill(`${mark} sent over a bad connection`);
    await phone.getByTestId("fb-send").tap();
    await expect(phone.getByTestId("fb-sent")).toBeVisible({ timeout: 20_000 });
    expect(tries).toBe(3);
    await theReport(request, mark); // (exactly one: the helper says so)
  });

  test("a send that is turned away says so and keeps what was written, and the same report goes through when it is tried again", async ({ browser, request }) => {
    const mark = word();
    const phone = await newPhone(browser);
    let turnedAway = true;
    await phone.route("**/api/feedback", (route) => (route.request().method() === "POST" && turnedAway ? route.fulfill({ status: 429, headers: { "retry-after": "30" }, json: { error: "slow_down" } }) : route.continue()));
    await openFeedback(phone);
    await phone.getByTestId("fb-kind-bug").tap();
    await phone.getByTestId("fb-text").fill(`${mark} turned away once`);
    await phone.getByTestId("fb-send").tap();
    await expect(phone.getByTestId("fb-send-error")).toBeVisible();
    await expect(phone.getByTestId("fb-text")).toHaveValue(new RegExp(mark));
    expect(await found(request, mark)).toHaveLength(0);
    turnedAway = false;
    await phone.getByTestId("fb-send").tap();
    await expect(phone.getByTestId("fb-sent")).toBeVisible({ timeout: 15_000 });
    await theReport(request, mark);
  });

  test("what was written is kept as a draft when the form is closed, and offered again", async ({ browser }) => {
    const mark = word();
    const phone = await newPhone(browser);
    await openFeedback(phone);
    await phone.getByTestId("fb-kind-improve").tap();
    await phone.getByTestId("fb-text").fill(`${mark} the menu is too long`);
    await phone.getByTestId("fb-close").tap();
    await expect(phone.getByTestId("feedback")).toHaveCount(0); // (words are kept: nothing to ask about)
    await phone.getByTestId("menu-feedback").tap();
    await expect(phone.getByTestId("fb-draft")).toContainText(mark);
    await phone.getByTestId("fb-draft-continue").tap();
    await expect(phone.getByTestId("fb-text")).toHaveValue(new RegExp(mark));
    // Closing with a picture on it asks first, since a picture is not kept.
    await phone.getByTestId("fb-input-picture").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: PIXEL });
    await expect(phone.getByTestId("fb-piece")).toHaveCount(1);
    await phone.getByTestId("fb-close").tap();
    await expect(phone.getByTestId("fb-confirm")).toBeVisible();
    await phone.getByTestId("fb-leave-stay").tap();
    await expect(phone.getByTestId("fb-piece")).toHaveCount(1);
    await phone.getByTestId("fb-close").tap();
    await phone.getByTestId("fb-leave-go").tap();
    await expect(phone.getByTestId("feedback")).toHaveCount(0);
    await phone.getByTestId("menu-feedback").tap();
    await phone.getByTestId("fb-draft-discard").tap();
    await expect(phone.getByTestId("fb-draft")).toHaveCount(0);
  });

  test("the phone's Back goes back a step of the form, then closes it, and the page under it is still there", async ({ browser }) => {
    const phone = await newPhone(browser);
    await openFeedback(phone);
    await phone.getByTestId("fb-kind-bug").tap();
    await expect(phone.getByTestId("fb-form")).toBeVisible();
    await phone.goBack();
    await expect(phone.getByTestId("fb-start")).toBeVisible();
    await phone.goBack();
    await expect(phone.getByTestId("feedback")).toHaveCount(0);
    await expect(phone.getByTestId("account-screen")).toBeVisible();
  });

  test("an answer from the team comes back: a number on the button, the question, and the reply goes to the team", async ({ browser, request }) => {
    const mark = word();
    const phone = await newPhone(browser);
    await openFeedback(phone);
    await phone.getByTestId("fb-kind-idea").tap();
    await phone.getByTestId("fb-text").fill(`${mark} let me choose the picture quality for good`);
    await phone.getByTestId("fb-send").tap();
    await expect(phone.getByTestId("fb-sent")).toBeVisible({ timeout: 15_000 });
    const report = await theReport(request, mark);

    const asked = await request.post(`/api/admin/feedback/${report.id}/reply`, { headers: AUTH, data: { text: `Do you mean for every film, or only on this phone? (${mark})`, ask: true } });
    expect(asked.status()).toBe(201);

    // The page is opened again, as on another day: the account's menu says there is an answer, and so does the first screen of the form.
    await phone.goto("/");
    await phone.getByTestId("account-button").tap();
    await expect(phone.getByTestId("menu-feedback")).toContainText("1");
    await phone.getByTestId("menu-feedback").tap();
    await expect(phone.getByTestId("fb-unread")).toHaveText("1");
    await phone.getByTestId("fb-mine").tap();
    await expect(phone.getByTestId("fb-row")).toHaveCount(1);
    await expect(phone.getByTestId("fb-row")).toHaveAttribute("data-status", "needs_info");
    await phone.getByTestId("fb-row").tap();
    await expect(phone.getByTestId("fb-thread")).toBeVisible();
    await expect(phone.getByTestId("fb-needs-info")).toBeVisible();
    await expect(phone.getByTestId("fb-team-line")).toContainText("every film");
    await phone.getByTestId("fb-reply-text").fill(`For every film, please (${mark})`);
    await phone.getByTestId("fb-reply-send").tap();
    await expect(phone.getByTestId("fb-your-line")).toContainText("For every film");

    await expect.poll(async () => (await theReport(request, mark)).messages.map((line) => line.from)).toEqual(["team", "user"]);
    const after = await theReport(request, mark);
    expect(after.messages[1]?.text).toContain("For every film");
    expect(after.waiting).toBe(true); // (the team has not answered the answer)
  });
});

const films = Array.from({ length: 4 }, (_, i) => ({ id: `f${i}`, title: `Film number ${i + 1}`, year: 1990 + i, kind: "movie", url: `/fixtures/sample.mp4?n=${i}` }));
const withFilms = withLibrary({ updatedAt: Date.now(), rows: [{ id: "r1", title: "Classics", source: "Test Source", kind: "movie", items: films }] });

test.describe("feedback from a TV", () => {
  test("a remote is enough: to the Feedback button beside Settings, a kind, some words, Send, and Back to where it was", async ({ browser, request }) => {
    const mark = word();
    const tv = await openLibrary(browser, withFilms);
    await openProfileByRemote(tv);
    await expect(tv.getByTestId("tv-profile-feedback")).toBeVisible();
    // The remote starts where it did (the first button of the page), and Feedback is two buttons along: Sign in, Settings, Feedback.
    await expect(tv.getByTestId("tv-profile-signin")).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-profile-settings")).toBeFocused();
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("tv-profile-feedback")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("feedback")).toBeVisible();
    await expect(tv.getByTestId("fb-kind-bug")).toBeFocused(); // (the first choice has the remote)

    // The choices are in two rows: Right and Down move along them.
    await tv.keyboard.press("ArrowRight");
    await expect(tv.getByTestId("fb-kind-improve")).toBeFocused();
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("fb-kind-other")).toBeFocused();
    await tv.keyboard.press("ArrowUp");
    await tv.keyboard.press("ArrowLeft");
    await expect(tv.getByTestId("fb-kind-bug")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("fb-form")).toBeVisible();
    await expect(tv.getByTestId("fb-text")).toBeFocused();
    await tv.keyboard.type(`${mark} the film stops after a minute`);

    // Down, as often as it takes, reaches Send; OK sends.
    for (let press = 0; press < 40 && !(await tv.getByTestId("fb-send").evaluate((element) => element === document.activeElement)); press++) await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("fb-send")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("fb-sent")).toBeVisible({ timeout: 15_000 });

    // Back closes it, and the remote is on the button it came from.
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("feedback")).toHaveCount(0);
    await expect(tv.getByTestId("tv-profile-feedback")).toBeFocused();
    await expect(tv.getByTestId("tv-browse")).toHaveAttribute("data-view", "profile");

    const report = await theReport(request, mark);
    expect(report.kind).toBe("bug");
    expect(report.context.role).toBe("tv");
    // Only keys that press or leave something are noted, never what was typed.
    expect((report.context.trail ?? []).join("\n")).not.toContain(mark);
  });

  test("the keys of the form never reach the TV behind it", async ({ browser }) => {
    const tv = await openLibrary(browser, withFilms);
    await tv.getByTestId("tv-account-chip").click();
    await tv.getByTestId("tv-profile-feedback").click();
    await expect(tv.getByTestId("feedback")).toBeVisible();
    const view = () => tv.getByTestId("tv-browse").getAttribute("data-view");
    expect(await view()).toBe("profile");
    for (const key of ["ArrowLeft", "ArrowLeft", "ArrowUp", "ArrowUp", "ArrowDown", "ArrowRight", "m", "f"]) await tv.keyboard.press(key);
    await expect(tv.getByTestId("feedback")).toBeVisible();
    expect(await view()).toBe("profile");
    // Back leaves the form and not the page behind it.
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("feedback")).toHaveCount(0);
    expect(await view()).toBe("profile");
  });

  test("with a mouse: the picture of the TV's screen is taken and marked, and the team has it", async ({ browser, request }) => {
    const mark = word();
    const tv = await openLibrary(browser, withFilms);
    await tv.getByTestId("tv-account-chip").click();
    await tv.getByTestId("tv-profile-feedback").click();
    await tv.getByTestId("fb-kind-bug").click();
    await tv.getByTestId("fb-text").fill(`${mark} the corner buttons overlap`);
    const canvas = await captureAndOpen(tv);
    await tv.getByTestId("fb-tool-arrow").click();
    await drag(tv, canvas, [0.7, 0.1], [0.9, 0.3]);
    await tv.getByTestId("fb-annotate-done").click();
    await expect(tv.getByTestId("fb-piece")).toHaveCount(1);
    await tv.getByTestId("fb-send").click();
    await expect(tv.getByTestId("fb-sent")).toBeVisible({ timeout: 15_000 });
    const report = await theReport(request, mark);
    expect(report.attachments.map((each) => each.role).sort()).toEqual(["annotated", "screenshot"]);
    expect(isPng(await fileOf(request, report, "annotated"))).toBe(true);
    // The picture is of the page, not of the form: the library's tiles are in it. (A form's own words are not asked of the page: nothing here reads the pixels.)
    expect(report.context.where?.view).toBeTruthy();
  });
});

test.describe("feedback from a title that would not play", () => {
  test("the card has a quiet way to tell the team: the remote reaches it with Down, the form is on that problem with what the screen said, and Back returns to the card", async ({ browser, baseURL, request }) => {
    const mark = word();
    const tv = await openTv(browser);
    const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
    phone.cmd({ type: "LOAD", media: { title: `Broken ${mark}`, stream: { url: "/fixtures/nope.mp4", type: "mp4" } } });
    await expect(tv.getByTestId("tv-error")).toBeVisible({ timeout: 15_000 });
    await expect(tv.getByTestId("error-retry")).toBeFocused(); // (OK still tries again: telling the team is a press of Down away)
    await tv.keyboard.press("ArrowDown");
    await expect(tv.getByTestId("error-report")).toBeFocused();
    await tv.keyboard.press("Enter");

    // The kind is known, so the first screen is skipped: the form is on this problem, with the screen's own words to begin with.
    await expect(tv.getByTestId("fb-form")).toBeVisible();
    await expect(tv.getByTestId("fb-where-button")).toContainText("A title that will not play");
    await expect(tv.getByTestId("fb-text")).toHaveValue(/^It would not play\. The screen said: /);
    await expect(tv.getByTestId("fb-text")).toBeFocused();
    await tv.keyboard.press("Control+End");
    await tv.keyboard.type(` ${mark}`);
    for (let press = 0; press < 40 && !(await tv.getByTestId("fb-send").evaluate((element) => element === document.activeElement)); press++) await tv.keyboard.press("ArrowDown");
    await tv.keyboard.press("Enter");
    await expect(tv.getByTestId("fb-sent")).toBeVisible({ timeout: 15_000 });

    // Back closes the form, and the remote is on the card's button again.
    await tv.keyboard.press("Escape");
    await expect(tv.getByTestId("feedback")).toHaveCount(0);
    await expect(tv.getByTestId("tv-error")).toBeVisible();
    await expect(tv.getByTestId("error-report")).toBeFocused();

    const report = await theReport(request, mark);
    expect(report).toMatchObject({ kind: "bug", area: "wontplay" });
    expect(report.message).toMatch(/^It would not play\. The screen said: .+ /);
    // What the page knew: what was on, and that it failed (the card is not the player, so its own title is the one asked).
    expect(report.context.playback?.state).toBe("error");
    expect(report.context.playback?.title).toBe(`Broken ${mark}`);
    expect(report.context.playback?.error).toBeTruthy();
    phone.close();
  });

  // The card is the same in every language and on every screen: Romanian has the longest words, and the narrowest screen is a phone that plays on itself.
  for (const width of [320, 390, 899, 1280]) {
    test(`the card with its three buttons fits a screen ${width}px wide, in Romanian`, async ({ browser, baseURL }) => {
      const height = 700;
      const tv = await openTv(browser, { width, height }, { "kino.lang": "ro" });
      const phone = await RawPhone.connect(baseURL!, await readPairingCode(tv));
      phone.cmd({ type: "LOAD", media: { title: "A film with a rather long name for the card to carry", stream: { url: "/fixtures/nope.mp4", type: "mp4" } } });
      await expect(tv.getByTestId("tv-error")).toBeVisible({ timeout: 15_000 });
      await expect(tv.getByTestId("error-report")).toContainText("Raportează această problemă");
      for (const id of ["error-retry", "error-library", "error-report"]) {
        const box = (await tv.getByTestId(id).boundingBox())!;
        expect(box.x, `${id} starts inside the screen`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${id} ends inside the screen`).toBeLessThanOrEqual(width);
        expect(box.y + box.height, `${id} is above the bottom edge`).toBeLessThanOrEqual(height);
      }
      expect(await tv.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      phone.close();
    });
  }

  test("the phone that is the remote has a Report button on the line that says it, and a draft that was kept before stays where it was", async ({ browser, baseURL, request }) => {
    const mark = word();
    const tv = await openTv(browser);
    const phone = await openPairedPhone(browser, tv);
    const draft = JSON.stringify({ kind: "idea", area: "home", text: `an older draft ${mark}`, details: {}, at: Date.now() });
    await phone.evaluate((value) => localStorage.setItem("kino.feedback.draft", value), draft);

    await phone.getByTestId("url-input").fill(`${baseURL}/fixtures/does-not-exist.mp4`);
    await phone.getByTestId("play-url").click();
    await expect(phone.getByTestId("player-state")).toHaveAttribute("data-error", "SOURCE_NOT_DIRECTLY_PLAYABLE");
    await expect(phone.getByTestId("remote-report")).toBeVisible();

    // Opened and closed with nothing written: the draft the first screen would have offered is untouched.
    await phone.getByTestId("remote-report").tap();
    await expect(phone.getByTestId("fb-form")).toBeVisible();
    await expect(phone.getByTestId("fb-text")).toHaveValue(/^It would not play\. The screen said: This video can't be played on the TV\./);
    await phone.getByTestId("fb-close").tap();
    await expect(phone.getByTestId("feedback")).toHaveCount(0);
    expect(await phone.evaluate(() => localStorage.getItem("kino.feedback.draft"))).toBe(draft);

    // Sent with a few words more: the report has both, and the older draft is still there.
    await phone.getByTestId("remote-report").tap();
    const text = phone.getByTestId("fb-text");
    await text.fill(`${await text.inputValue()} ${mark}`);
    await phone.getByTestId("fb-send").tap();
    await expect(phone.getByTestId("fb-sent")).toBeVisible({ timeout: 15_000 });
    const report = await theReport(request, mark);
    expect(report).toMatchObject({ kind: "bug", area: "wontplay" });
    expect(report.message).toContain("This video can't be played on the TV.");
    expect(report.context.role).toBe("remote");
    // The phone has no video of its own: it tells how the TV's one was doing from the line that says so.
    expect(report.context.playback).toMatchObject({ state: "error", error: "SOURCE_NOT_DIRECTLY_PLAYABLE" });
    expect(await phone.evaluate(() => localStorage.getItem("kino.feedback.draft"))).toBe(draft);
  });
});
